const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "ngo.db");
const FORCE_IMPORT = String(process.env.FORCE_IMPORT || "").toLowerCase() === "true";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to your environment or .env file.");
  process.exit(1);
}

const prisma = new PrismaClient();
const sqlite = new sqlite3.Database(SQLITE_DB_PATH);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqlite.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function setSequence(tx, tableName) {
  await tx.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${tableName}"','id'), COALESCE(MAX("id"), 1)) FROM "${tableName}"`
  );
}

async function main() {
  console.log(`Reading SQLite data from: ${SQLITE_DB_PATH}`);

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !FORCE_IMPORT) {
    console.error("Target database is not empty. Set FORCE_IMPORT=true to overwrite.");
    process.exit(1);
  }

  const [
    metrics,
    actions,
    interactions,
    kpis,
    teamMembers,
    galleryItems,
    users,
    inventoryTransactions
  ] = await Promise.all([
    all("SELECT key, value FROM metrics"),
    all("SELECT id, type, createdAt FROM actions"),
    all("SELECT id, date, name, email, interest, message FROM interactions"),
    all("SELECT id, kitsDistributed, beneficiariesServed, schoolPartners, updatedAt FROM kpis"),
    all("SELECT id, name, role, bio, photoUrl, sortOrder, updatedAt FROM team_members"),
    all("SELECT id, imageUrl, caption, altText, sortOrder, updatedAt FROM gallery_items"),
    all("SELECT id, fullName, username, passwordHash, role, isActive, lastLogin, updatedAt FROM users"),
    all("SELECT id, itemName, category, quantity, direction, note, recordedBy, createdAt FROM inventory_transactions")
  ]);

  await prisma.$transaction(
    async (tx) => {
      if (FORCE_IMPORT) {
        await tx.$executeRawUnsafe('TRUNCATE TABLE "actions","interactions","kpis","team_members","gallery_items","users","inventory_transactions","metrics" RESTART IDENTITY CASCADE');
      }

      if (metrics.length) {
        await tx.metric.createMany({ data: metrics, skipDuplicates: true });
      }

      if (kpis.length) {
        await tx.kpi.createMany({
          data: kpis.map((row) => ({
            id: row.id,
            kitsDistributed: row.kitsDistributed,
            beneficiariesServed: row.beneficiariesServed,
            schoolPartners: row.schoolPartners,
            updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
          })),
          skipDuplicates: true
        });
      }

      if (teamMembers.length) {
        await tx.teamMember.createMany({
          data: teamMembers.map((row) => ({
            id: row.id,
            name: row.name,
            role: row.role,
            bio: row.bio,
            photoUrl: row.photoUrl,
            sortOrder: row.sortOrder,
            updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
          }))
        });
      }

      if (galleryItems.length) {
        await tx.galleryItem.createMany({
          data: galleryItems.map((row) => ({
            id: row.id,
            imageUrl: row.imageUrl,
            caption: row.caption,
            altText: row.altText,
            sortOrder: row.sortOrder,
            updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
          }))
        });
      }

      if (users.length) {
        await tx.user.createMany({
          data: users.map((row) => ({
            id: row.id,
            fullName: row.fullName,
            username: String(row.username || "").toLowerCase(),
            passwordHash: row.passwordHash,
            role: row.role,
            isActive: Boolean(row.isActive),
            lastLogin: row.lastLogin ? new Date(row.lastLogin) : null,
            updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
          }))
        });
      }

      if (actions.length) {
        await tx.action.createMany({
          data: actions.map((row) => ({
            id: row.id,
            type: row.type,
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
          }))
        });
      }

      if (interactions.length) {
        await tx.interaction.createMany({
          data: interactions.map((row) => ({
            id: row.id,
            date: row.date,
            name: row.name,
            email: row.email,
            interest: row.interest,
            message: row.message
          }))
        });
      }

      if (inventoryTransactions.length) {
        await tx.inventoryTransaction.createMany({
          data: inventoryTransactions.map((row) => ({
            id: row.id,
            itemName: row.itemName,
            category: row.category,
            quantity: row.quantity,
            direction: row.direction,
            note: row.note,
            recordedBy: row.recordedBy,
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
          }))
        });
      }

      await setSequence(tx, "actions");
      await setSequence(tx, "interactions");
      await setSequence(tx, "team_members");
      await setSequence(tx, "gallery_items");
      await setSequence(tx, "users");
      await setSequence(tx, "inventory_transactions");
    },
    { timeout: 120000 }
  );

  console.log("Migration completed.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    sqlite.close();
  });
