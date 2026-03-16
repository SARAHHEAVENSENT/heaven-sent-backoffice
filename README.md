# Heaven Sent Foundation Platform

This project includes:
- Public NGO website
- Staff back office with login
- Node.js API + Prisma/PostgreSQL database

## Local Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Add your Prisma connection string in `.env`:
   ```bash
   DATABASE_URL="your-postgres-url"
   ```
3. Generate Prisma client:
   ```bash
   npm run db:generate
   ```
4. Start:
   ```bash
   npm start
   ```
5. Open:
   - Public: `http://localhost:3000`
   - Back office: `http://localhost:3000/backoffice.html`

## Back Office Login
Default credentials:
- Username: `admin`
- Password: `ChangeMe123!`

Set secure credentials in production with env vars:
- `ADMIN_USER`
- `ADMIN_PASS`

## Required Environment Variables
Minimum for deployment:
- `PORT` (usually provided by hosting platform)
- `DATABASE_URL` (PostgreSQL connection string)
- `ADMIN_USER`
- `ADMIN_PASS`

Optional notification variables:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_FROM_EMAIL`, `ALERT_TO_EMAIL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO`

## Migrate SQLite to Postgres (optional)
If you have existing data in `ngo.db`, migrate it into Postgres:
```bash
set DATABASE_URL=your-postgres-url
set SQLITE_DB_PATH=.\ngo.db
node scripts\migrate-sqlite-to-postgres.js
```
If the target database is not empty, add:
```bash
set FORCE_IMPORT=true
```

## Deploy (Recommended: Node host with Postgres)
This app uses Prisma with PostgreSQL.

### 1. Push code to GitHub
From project folder:
```bash
git init
git add .
git commit -m "Initial Heaven Sent platform"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

### 2. Create Render Web Service
1. Go to Render dashboard: <https://dashboard.render.com>
2. New -> Web Service
3. Connect your GitHub repo
4. Configure:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`

### 3. Add DATABASE_URL
Set the Prisma connection string in your host environment:
- `DATABASE_URL=<your-postgres-connection-string>`

### 4. Add Admin and Alert Env Vars
Set these in Render Environment:
- `ADMIN_USER=<your-admin-username>`
- `ADMIN_PASS=<your-strong-password>`
- `ALERT_TO_EMAIL=info@thehsf.org.za`
- `TWILIO_WHATSAPP_TO=whatsapp:+27712447875`

Then add SMTP/Twilio values only if you want live alerts.

### 5. Deploy
Click **Deploy latest commit**.

After deploy:
- Public site: `https://<your-service>.onrender.com`
- Back office: `https://<your-service>.onrender.com/backoffice.html`
- Health check: `https://<your-service>.onrender.com/healthz`

## Notes
- PostgreSQL is production-ready and works well with Prisma.
- If you are migrating from SQLite, use the migration script in `scripts/migrate-sqlite-to-postgres.js`.

## Multi-User Back Office Access
On first run, the system creates member accounts automatically:
- `admin` (role: admin, password from `ADMIN_PASS`)
- `sarah.mpuru` (member)
- `hope.makgopa` (member)
- `morongwa.mpuru` (member)
- `bongiwe.mdluli` (member)

Default member password:
- `Welcome123!` (change this immediately in Back Office -> Users & Access)

Only `admin` can:
- Authorize/deactivate users
- Create login details for new members
- Manage Team and Gallery content
- Update public KPIs
