const express = require("express");
const path = require("path");
const cors = require("cors");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use((req, res, next) => {
  if (/\.(html|css|js)$/i.test(req.path || "")) {
    res.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  }
  next();
});
app.use(express.static(path.join(__dirname)));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to your environment or .env file.");
  process.exit(1);
}

const prisma = new PrismaClient();
const sessions = new Map();

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "ChangeMe123!";
const DEFAULT_MEMBER_PASS = process.env.DEFAULT_MEMBER_PASS || "Welcome123!";
const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL || "info@thehsf.org.za";
const WHATSAPP_ALERT_TO = process.env.TWILIO_WHATSAPP_TO || "whatsapp:+27712447875";
const ALLOWED_ROLES = ["admin", "member", "viewer"];

function text(v) {
  return String(v || "").trim();
}

function positiveInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.fullName,
    username: row.username,
    role: row.role,
    isActive: Boolean(row.isActive),
    lastLogin: row.lastLogin || null,
    updatedAt: row.updatedAt || null
  };
}

async function ensureSeedData() {
  const metricsDefaults = ["pageVisits", "donate_click", "volunteer_click", "form_submissions"];
  for (const key of metricsDefaults) {
    const existing = await prisma.metric.findUnique({ where: { key } });
    if (!existing) {
      await prisma.metric.create({ data: { key, value: 0 } });
    }
  }

  const existingKpi = await prisma.kpi.findUnique({ where: { id: 1 } });
  if (!existingKpi) {
    await prisma.kpi.create({
      data: {
        id: 1,
        kitsDistributed: 420,
        beneficiariesServed: 180,
        schoolPartners: 12,
        updatedAt: new Date()
      }
    });
  }

  const usersCount = await prisma.user.count();
  if (!usersCount) {
    const now = new Date();
    const defaultUsers = [
      ["System Administrator", ADMIN_USER, hashPassword(ADMIN_PASS), "admin", true, now],
      ["Sarah Mpuru", "sarah.mpuru", hashPassword(DEFAULT_MEMBER_PASS), "member", true, now],
      ["Hope Makgopa", "hope.makgopa", hashPassword(DEFAULT_MEMBER_PASS), "member", true, now],
      ["Morongwa Mpuru", "morongwa.mpuru", hashPassword(DEFAULT_MEMBER_PASS), "member", true, now],
      ["Bongiwe Mdluli", "bongiwe.mdluli", hashPassword(DEFAULT_MEMBER_PASS), "member", true, now]
    ];

    await prisma.user.createMany({
      data: defaultUsers.map(([fullName, username, passwordHash, role, isActive, updatedAt]) => ({
        fullName,
        username: String(username).toLowerCase(),
        passwordHash,
        role,
        isActive,
        updatedAt
      }))
    });
  }

  const teamCount = await prisma.teamMember.count();
  if (!teamCount) {
    const now = new Date();
    await prisma.teamMember.createMany({
      data: [
        {
          name: "Hope Makgopa",
          role: "Community Operations",
          bio: "A qualified chef supporting nutrition-sensitive care and dignity-focused outreach.",
          photoUrl: "assets/team/mohlago.png",
          sortOrder: 1,
          updatedAt: now
        },
        {
          name: "Sarah Mpuru",
          role: "Education Support",
          bio: "A qualified teacher focused on learner confidence and attendance outcomes.",
          photoUrl: "assets/team/sarah.jpeg",
          sortOrder: 2,
          updatedAt: now
        },
        {
          name: "Morongwa Mpuru",
          role: "Social Support",
          bio: "A qualified social worker strengthening family follow-up and beneficiary care.",
          photoUrl: "assets/team/morongwa.png",
          sortOrder: 3,
          updatedAt: now
        },
        {
          name: "Bongiwe Mdluli",
          role: "Learner & Sponsor Support",
          bio: "Responsible for learner and sponsor support.",
          photoUrl: "assets/team/bongi.png",
          sortOrder: 4,
          updatedAt: now
        }
      ]
    });
  }

  const galleryCount = await prisma.galleryItem.count();
  if (!galleryCount) {
    const now = new Date();
    await prisma.galleryItem.createMany({
      data: [
        {
          imageUrl: "https://cdn.pixabay.com/photo/2022/10/17/11/38/children-7527411_640.jpg",
          caption: "Support that keeps learners in school.",
          altText: "African children receiving support",
          sortOrder: 1,
          updatedAt: now
        },
        {
          imageUrl: "https://cdn.pixabay.com/photo/2019/12/05/17/02/child-4675664_640.jpg",
          caption: "Dignity-centered outreach in vulnerable communities.",
          altText: "African child in under-resourced environment",
          sortOrder: 2,
          updatedAt: now
        },
        {
          imageUrl: "https://cdn.pixabay.com/photo/2023/03/16/03/02/african-7855837_640.jpg",
          caption: "Every child deserves hygiene dignity and care.",
          altText: "African child portrait",
          sortOrder: 3,
          updatedAt: now
        }
      ]
    });
  }
}

async function getPublicContent() {
  const team = await prisma.teamMember.findMany({
    select: { id: true, name: true, role: true, bio: true, photoUrl: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
  });
  const gallery = await prisma.galleryItem.findMany({
    select: { id: true, imageUrl: true, caption: true, altText: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
  });
  return { team, gallery };
}

async function incMetric(key) {
  await prisma.metric.update({ where: { key }, data: { value: { increment: 1 } } });
}

async function getMetric(key) {
  const row = await prisma.metric.findUnique({ where: { key } });
  return row ? row.value : 0;
}

async function getStats() {
  const pageVisits = await getMetric("pageVisits");
  const donateClick = await getMetric("donate_click");
  const volunteerClick = await getMetric("volunteer_click");
  const formSubmissions = await getMetric("form_submissions");
  const interactionCount = pageVisits + donateClick + volunteerClick + formSubmissions;
  const messageCount = await prisma.interaction.count();
  const conversionRate = pageVisits > 0 ? Number(((messageCount / pageVisits) * 100).toFixed(1)) : 0;

  return {
    pageVisits,
    donateClick,
    volunteerClick,
    formSubmissions,
    interactionCount,
    messageCount,
    conversionRate
  };
}

async function sendNotifications(entry) {
  const promises = [];

  if (process.env.SMTP_HOST && ALERT_TO_EMAIL) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined
    });

    promises.push(
      transporter.sendMail({
        from: process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER,
        to: ALERT_TO_EMAIL,
        subject: `New NGO interaction: ${entry.interest}`,
        text: `${entry.name} (${entry.email})\nInterest: ${entry.interest}\n\n${entry.message}`
      })
    );
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM && WHATSAPP_ALERT_TO) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    promises.push(
      client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: WHATSAPP_ALERT_TO,
        body: `New request: ${entry.name} | ${entry.interest}`
      })
    );
  }

  if (promises.length) {
    await Promise.allSettled(promises);
  }
}

function authMiddleware(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (roles.length && !roles.includes(session.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    req.user = {
      id: session.id,
      fullName: session.fullName,
      username: session.username,
      role: session.role
    };

    next();
  };
}

app.post("/api/auth/login", async (req, res) => {
  const username = text(req.body?.username).toLowerCase();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true, fullName: true, username: true, passwordHash: true, role: true, isActive: true }
  });

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: "User account is inactive" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    role: user.role,
    expiresAt: Date.now() + 1000 * 60 * 60 * 8
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), updatedAt: new Date() }
  });

  return res.json({
    token,
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role
    }
  });
});

async function getInventorySnapshot() {
  const summary = await prisma.$queryRaw`
    SELECT itemName, category, quantityOnHand, lastUpdated FROM (
      SELECT itemName, category,
        SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) AS quantityOnHand,
        MAX(createdAt) AS lastUpdated
      FROM inventory_transactions
      GROUP BY itemName, category
    ) AS inv
    WHERE quantityOnHand <> 0
    ORDER BY category ASC, itemName ASC
  `;

  const transactions = await prisma.$queryRaw`
    SELECT id, itemName, category, quantity, direction, note, recordedBy, createdAt
    FROM inventory_transactions
    ORDER BY createdAt DESC, id DESC
    LIMIT 200
  `;

  return { summary, transactions };
}

app.post("/api/public/visit", async (_req, res) => {
  await incMetric("pageVisits");
  res.json({ ok: true });
});

app.post("/api/public/action", async (req, res) => {
  const { type } = req.body || {};
  const allowed = ["donate_click", "volunteer_click"];
  if (!allowed.includes(type)) {
    return res.status(400).json({ error: "Invalid action type" });
  }

  await incMetric(type);
  await prisma.action.create({ data: { type, createdAt: new Date() } });
  res.json({ ok: true });
});

app.post("/api/public/interactions", async (req, res) => {
  const { name, email, interest, message } = req.body || {};
  if (!name || !email || !interest || !message) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const entry = {
    date: new Date().toISOString().slice(0, 10),
    name: text(name),
    email: text(email),
    interest: text(interest),
    message: text(message)
  };

  await prisma.interaction.create({ data: entry });
  await incMetric("form_submissions");
  await sendNotifications(entry);

  res.json({ ok: true });
});

app.get("/api/public/dashboard", async (_req, res) => {
  const kpis = await prisma.kpi.findUnique({
    where: { id: 1 },
    select: { kitsDistributed: true, beneficiariesServed: true, schoolPartners: true }
  });
  const stats = await getStats();
  res.json({ kpis, stats });
});

app.get("/api/public/content", async (_req, res) => {
  const content = await getPublicContent();
  res.json(content);
});

app.get("/api/admin/overview", authMiddleware(), async (req, res) => {
  const kpis = await prisma.kpi.findUnique({
    where: { id: 1 },
    select: { kitsDistributed: true, beneficiariesServed: true, schoolPartners: true, updatedAt: true }
  });
  const stats = await getStats();
  res.json({ kpis, stats, user: req.user });
});

app.get("/api/admin/interactions", authMiddleware(), async (_req, res) => {
  const rows = await prisma.interaction.findMany({
    select: { date: true, name: true, email: true, interest: true, message: true },
    orderBy: { id: "desc" }
  });
  res.json({ interactions: rows });
});

app.put("/api/admin/kpis", authMiddleware(["admin"]), async (req, res) => {
  const { kitsDistributed, beneficiariesServed, schoolPartners } = req.body || {};
  await prisma.kpi.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      kitsDistributed: positiveInt(kitsDistributed),
      beneficiariesServed: positiveInt(beneficiariesServed),
      schoolPartners: positiveInt(schoolPartners),
      updatedAt: new Date()
    },
    update: {
      kitsDistributed: positiveInt(kitsDistributed),
      beneficiariesServed: positiveInt(beneficiariesServed),
      schoolPartners: positiveInt(schoolPartners),
      updatedAt: new Date()
    }
  });
  const kpis = await prisma.kpi.findUnique({
    where: { id: 1 },
    select: { kitsDistributed: true, beneficiariesServed: true, schoolPartners: true, updatedAt: true }
  });
  res.json({ ok: true, kpis });
});

app.get("/api/admin/content", authMiddleware(), async (_req, res) => {
  const content = await getPublicContent();
  res.json(content);
});

app.post("/api/admin/team", authMiddleware(["admin"]), async (req, res) => {
  const { name, role, bio, photoUrl, sortOrder } = req.body || {};
  const clean = {
    name: text(name),
    role: text(role),
    bio: text(bio),
    photoUrl: text(photoUrl),
    sortOrder: positiveInt(sortOrder, 0)
  };

  if (!clean.name || !clean.role || !clean.bio || !clean.photoUrl) {
    return res.status(400).json({ error: "Name, role, bio, and photo URL are required." });
  }

  await prisma.teamMember.create({
    data: {
      name: clean.name,
      role: clean.role,
      bio: clean.bio,
      photoUrl: clean.photoUrl,
      sortOrder: clean.sortOrder,
      updatedAt: new Date()
    }
  });

  const content = await getPublicContent();
  res.json({ ok: true, team: content.team });
});

app.put("/api/admin/team/:id", authMiddleware(["admin"]), async (req, res) => {
  const id = positiveInt(req.params.id, -1);
  if (id < 0) return res.status(400).json({ error: "Invalid team member id." });

  const { name, role, bio, photoUrl, sortOrder } = req.body || {};
  const clean = {
    name: text(name),
    role: text(role),
    bio: text(bio),
    photoUrl: text(photoUrl),
    sortOrder: positiveInt(sortOrder, 0)
  };

  if (!clean.name || !clean.role || !clean.bio || !clean.photoUrl) {
    return res.status(400).json({ error: "Name, role, bio, and photo URL are required." });
  }

  const existing = await prisma.teamMember.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Team member not found." });

  await prisma.teamMember.update({
    where: { id },
    data: {
      name: clean.name,
      role: clean.role,
      bio: clean.bio,
      photoUrl: clean.photoUrl,
      sortOrder: clean.sortOrder,
      updatedAt: new Date()
    }
  });

  const content = await getPublicContent();
  res.json({ ok: true, team: content.team });
});

app.delete("/api/admin/team/:id", authMiddleware(["admin"]), async (req, res) => {
  const id = positiveInt(req.params.id, -1);
  if (id < 0) return res.status(400).json({ error: "Invalid team member id." });

  const existing = await prisma.teamMember.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Team member not found." });

  await prisma.teamMember.delete({ where: { id } });

  const content = await getPublicContent();
  res.json({ ok: true, team: content.team });
});

app.post("/api/admin/gallery", authMiddleware(["admin"]), async (req, res) => {
  const { imageUrl, caption, altText, sortOrder } = req.body || {};
  const clean = {
    imageUrl: text(imageUrl),
    caption: text(caption),
    altText: text(altText),
    sortOrder: positiveInt(sortOrder, 0)
  };

  if (!clean.imageUrl || !clean.caption) {
    return res.status(400).json({ error: "Image URL and caption are required." });
  }

  await prisma.galleryItem.create({
    data: {
      imageUrl: clean.imageUrl,
      caption: clean.caption,
      altText: clean.altText || clean.caption,
      sortOrder: clean.sortOrder,
      updatedAt: new Date()
    }
  });

  const content = await getPublicContent();
  res.json({ ok: true, gallery: content.gallery });
});

app.put("/api/admin/gallery/:id", authMiddleware(["admin"]), async (req, res) => {
  const id = positiveInt(req.params.id, -1);
  if (id < 0) return res.status(400).json({ error: "Invalid gallery item id." });

  const { imageUrl, caption, altText, sortOrder } = req.body || {};
  const clean = {
    imageUrl: text(imageUrl),
    caption: text(caption),
    altText: text(altText),
    sortOrder: positiveInt(sortOrder, 0)
  };

  if (!clean.imageUrl || !clean.caption) {
    return res.status(400).json({ error: "Image URL and caption are required." });
  }

  const existing = await prisma.galleryItem.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Gallery item not found." });

  await prisma.galleryItem.update({
    where: { id },
    data: {
      imageUrl: clean.imageUrl,
      caption: clean.caption,
      altText: clean.altText || clean.caption,
      sortOrder: clean.sortOrder,
      updatedAt: new Date()
    }
  });

  const content = await getPublicContent();
  res.json({ ok: true, gallery: content.gallery });
});

app.delete("/api/admin/gallery/:id", authMiddleware(["admin"]), async (req, res) => {
  const id = positiveInt(req.params.id, -1);
  if (id < 0) return res.status(400).json({ error: "Invalid gallery item id." });

  const existing = await prisma.galleryItem.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Gallery item not found." });

  await prisma.galleryItem.delete({ where: { id } });

  const content = await getPublicContent();
  res.json({ ok: true, gallery: content.gallery });
});

app.get("/api/admin/users", authMiddleware(["admin"]), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, username: true, role: true, isActive: true, lastLogin: true, updatedAt: true },
    orderBy: [{ role: "asc" }, { fullName: "asc" }]
  });
  res.json({ users: users.map(publicUser) });
});

app.post("/api/admin/users", authMiddleware(["admin"]), async (req, res) => {
  const fullName = text(req.body?.fullName);
  const username = text(req.body?.username).toLowerCase();
  const password = String(req.body?.password || "");
  const role = text(req.body?.role).toLowerCase() || "member";
  const isActive = req.body?.isActive !== false;

  if (!fullName || !username || !password) {
    return res.status(400).json({ error: "Full name, username, and password are required." });
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid user role." });
  }

  try {
    await prisma.user.create({
      data: {
        fullName,
        username,
        passwordHash: hashPassword(password),
        role,
        isActive: toBool(isActive),
        updatedAt: new Date()
      }
    });
  } catch (err) {
    if (String(err.code) === "P2002") {
      return res.status(400).json({ error: "Username already exists." });
    }
    throw err;
  }

  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, username: true, role: true, isActive: true, lastLogin: true, updatedAt: true },
    orderBy: [{ role: "asc" }, { fullName: "asc" }]
  });
  res.json({ ok: true, users: users.map(publicUser) });
});

app.put("/api/admin/users/:id", authMiddleware(["admin"]), async (req, res) => {
  const id = positiveInt(req.params.id, -1);
  if (id < 0) return res.status(400).json({ error: "Invalid user id." });

  const fullName = text(req.body?.fullName);
  const username = text(req.body?.username).toLowerCase();
  const password = String(req.body?.password || "");
  const role = text(req.body?.role).toLowerCase() || "member";
  const isActive = toBool(req.body?.isActive);

  if (!fullName || !username) {
    return res.status(400).json({ error: "Full name and username are required." });
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid user role." });
  }

  const current = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } });
  if (!current) return res.status(404).json({ error: "User not found." });

  if (current.role === "admin" && role !== "admin") {
    const adminCount = await prisma.user.count({ where: { role: "admin", isActive: true } });
    if (adminCount <= 1) {
      return res.status(400).json({ error: "At least one active admin is required." });
    }
  }

  if (current.role === "admin" && current.isActive && !isActive) {
    const adminCount = await prisma.user.count({ where: { role: "admin", isActive: true } });
    if (adminCount <= 1) {
      return res.status(400).json({ error: "At least one active admin is required." });
    }
  }

  try {
    if (password) {
      await prisma.user.update({
        where: { id },
        data: {
          fullName,
          username,
          passwordHash: hashPassword(password),
          role,
          isActive,
          updatedAt: new Date()
        }
      });
    } else {
      await prisma.user.update({
        where: { id },
        data: {
          fullName,
          username,
          role,
          isActive,
          updatedAt: new Date()
        }
      });
    }
  } catch (err) {
    if (String(err.code) === "P2002") {
      return res.status(400).json({ error: "Username already exists." });
    }
    throw err;
  }

  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, username: true, role: true, isActive: true, lastLogin: true, updatedAt: true },
    orderBy: [{ role: "asc" }, { fullName: "asc" }]
  });
  res.json({ ok: true, users: users.map(publicUser) });
});

app.get("/api/admin/inventory", authMiddleware(), async (_req, res) => {
  const inventory = await getInventorySnapshot();
  res.json(inventory);
});

app.post("/api/admin/inventory", authMiddleware(["admin", "member"]), async (req, res) => {
  const itemName = text(req.body?.itemName);
  const category = text(req.body?.category) || "General";
  const quantity = positiveInt(req.body?.quantity, 0);
  const direction = text(req.body?.direction).toLowerCase();
  const note = text(req.body?.note);

  if (!itemName || quantity <= 0 || !["in", "out"].includes(direction)) {
    return res.status(400).json({ error: "Item name, movement type, and a positive quantity are required." });
  }

  if (direction === "out") {
    const stockRows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END), 0) AS quantityOnHand
      FROM inventory_transactions
      WHERE itemName = ${itemName} AND category = ${category}
    `;
    const rawStock = stockRows?.[0]?.quantityonhand ?? stockRows?.[0]?.quantityOnHand ?? 0;
    const currentStock = Number(rawStock || 0);
    if (currentStock < quantity) {
      return res.status(400).json({ error: `Only ${currentStock} ${itemName} currently in stock.` });
    }
  }

  await prisma.inventoryTransaction.create({
    data: {
      itemName,
      category,
      quantity,
      direction,
      note,
      recordedBy: text(req.user?.fullName) || "Staff",
      createdAt: new Date()
    }
  });

  const inventory = await getInventorySnapshot();
  res.json({ ok: true, ...inventory });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

ensureSeedData()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Heaven Sent Foundation platform running on port ${PORT}`);
      console.log("Database: Prisma (PostgreSQL)");
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
