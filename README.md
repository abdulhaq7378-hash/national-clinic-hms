# National Clinic HMS

Hospital Management System for **National Clinic, Aurangabad, Maharashtra**.

A single system for the whole clinic: patient registration, appointments, the OPD
token queue, doctor consultations, prescriptions, referrals, billing, pharmacy,
laboratory, inpatient beds, the operation theatre, reports, analytics and a
tamper-resistant audit trail.

Every patient has one record. Each module posts to that record, so the same
patient stays linked from booking through consultation, pharmacy, laboratory and
the final invoice.

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [MongoDB setup](#mongodb-setup)
- [Running in development](#running-in-development)
- [Demo data and development accounts](#demo-data-and-development-accounts)
- [First run at the hospital](#first-run-at-the-hospital)
- [Production build and deployment](#production-build-and-deployment)
- [Roles and permissions](#roles-and-permissions)
- [API overview](#api-overview)
- [Security](#security)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)

---

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend (`/hms`) | React 19, Vite, React Router, TanStack Query, TypeScript |
| Backend (`/server`) | Node.js, Express 5, Mongoose 9, TypeScript |
| Database | MongoDB (replica set required in production) |
| Shared (`/shared`) | Roles, permissions, status enums and zod validation schemas used by both sides |

The backend is layered: `routes` (HTTP and validation) to `controllers` (request
and response) to `services` (business rules, transactions, audit) to
`repositories` and `models` (data access). Business logic never lives in React
components; the frontend only calls the API.

Live updates use Server-Sent Events (`GET /api/events`). The server publishes
small events carrying identifiers only, and the client refetches through the
normal authorized endpoints. There is no interval polling.

---

## Prerequisites

- **Node.js 22.12 or newer** (24 LTS recommended) and npm 10+
- **MongoDB 6 or newer**, running as a replica set (see below)
- A modern browser

---

## Installation

```bash
npm install
```

This installs all three workspaces (`shared`, `server`, `hms`). Then create your
configuration file:

```bash
cp .env.example .env
npm run generate-secret
```

Put the generated value in `JWT_ACCESS_SECRET` in `.env`.

---

## Environment variables

One `.env` file at the repository root serves the whole project. See
[`.env.example`](.env.example) for the full list with comments.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string. Use `memory` in development for a throwaway in-memory database. |
| `MONGODB_DB_NAME` | Database name, for example `national_clinic`. |
| `JWT_ACCESS_SECRET` | Signing secret for access tokens. Required in production, at least 32 characters. |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS` | Session lifetimes (default 15 minutes / 7 days). |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API. |
| `COOKIE_SECURE` | Send the refresh cookie only over HTTPS. Defaults to true in production. |
| `TRUST_PROXY` | Number of reverse proxies in front of the API, so client IPs are logged correctly. |
| `RATE_LIMIT_*`, `LOGIN_*` | Request limits and account lockout after repeated failed sign-ins. |
| `SERVE_WEB_DIST` | Optional: serve the built frontend from the API server. |
| `BOOTSTRAP_ADMIN_*` | Optional: create the first administrator on first start. |
| `VITE_API_URL` | API base URL for the browser (`/api` when served from the same origin). |
| `VITE_DEV_API_PROXY` | Where the Vite dev server forwards `/api`. |

Secrets are never hard-coded and never reach the browser: only `VITE_*`
variables are exposed to the frontend bundle. Do not commit `.env`.

---

## MongoDB setup

Billing, dispensing, admissions and invoicing use multi-document transactions,
which MongoDB only provides on a replica set. **A single-node replica set is
enough** and the server refuses to start in production without one.

**MongoDB Atlas** is already a replica set. Use the connection string as given.

**Self-hosted single node:** add to `mongod.conf`

```yaml
replication:
  replSetName: rs0
```

then restart MongoDB and initiate the set once:

```bash
mongosh --eval "rs.initiate()"
```

Connection string: `mongodb://127.0.0.1:27017/?replicaSet=rs0`

Create a dedicated database user for the application with `readWrite` on the
hospital database. For extra protection of the audit trail, see
[Security](#security).

---

## Running in development

Two terminals are not needed; one command starts both servers:

```bash
npm run dev
```

- API: <http://localhost:4000> (health check at `/api/health`)
- HMS: <http://localhost:5173>

To explore the system without installing MongoDB, use the in-memory database
with demo data (downloads a MongoDB binary on first use):

```bash
npm run dev:demo
```

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start API and HMS together |
| `npm run dev:demo` | Same, with an in-memory database and demo data |
| `npm run build` | Type-check and build all workspaces |
| `npm start` | Run the built API server |
| `npm test` | Run the backend workflow test suite |
| `npm run typecheck` | Type-check everything without building |
| `npm run seed -- --general-ward-beds=8` | Create the hospital's wards and beds |
| `npm run seed:demo` | Load demo data into a database whose name contains `demo` |
| `npm run create-admin` | Create an administrator account |
| `npm run generate-secret` | Print a random value for `JWT_ACCESS_SECRET` |

---

## Demo data and development accounts

Demo data lives in `server/src/seed/demo/` and is clearly separated from the rest
of the code. It refuses to load in production, and outside the in-memory mode it
only loads into a database whose name contains `demo` or `test`, so removing it
is simply dropping that database.

Demo accounts (development only) are:

| Role | Email |
| --- | --- |
| Administrator | `admin@demo.nationalclinic.local` |
| Doctor | `doctor1@demo.nationalclinic.local`, `doctor2@demo.nationalclinic.local` |
| Receptionist | `reception@demo.nationalclinic.local` |
| Nurse | `nurse@demo.nationalclinic.local` |
| Pharmacist | `pharmacy@demo.nationalclinic.local` |
| Laboratory | `lab@demo.nationalclinic.local` |
| Billing | `billing@demo.nationalclinic.local` |
| Management | `management@demo.nationalclinic.local` |

All demo accounts share one password: the value of `DEMO_PASSWORD` in `.env`. If
that variable is empty, a random password is generated and printed in the server
log at startup.

Demo prices, medicines and laboratory reference ranges are placeholders. Replace
them with the hospital's own values before real use.

---

## First run at the hospital

1. Set up MongoDB and `.env` as above, with a real `MONGODB_URI`.
2. Create the first administrator:

   ```bash
   ADMIN_NAME="Full Name" ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="..." npm run create-admin
   ```

3. Create the ward and bed structure (three private rooms and two general wards).
   Pass the number of beds per general ward:

   ```bash
   npm run seed -- --general-ward-beds=8
   ```

4. Sign in as the administrator and complete the setup in **Settings**:
   - Hospital details, registration number and GSTIN (printed on documents)
   - **Price list**: consultation, follow-up, room per day, procedures
   - OPD sessions and how token numbers restart
   - Modules: the operation theatre stays off until the facility is ready
   - Laboratory test catalog with the hospital's own reference ranges
   - Daily charge for every bed
5. Create staff accounts under **Users**. For each doctor, add the doctor profile
   with specialization, consultation fee and weekly OPD hours; appointments can
   only be booked inside those hours.

---

## Deploying a shared instance (Render and MongoDB Atlas)

This puts the system on a public HTTPS address so others can use it without
anything running on your PC. Both services below have a free tier.
[`render.yaml`](render.yaml) already holds the configuration.

**1. Database (MongoDB Atlas)**

1. Create a free account and an **M0** cluster (Atlas clusters are replica sets,
   which this application requires).
2. Database Access: add a user with a strong password and the **readWrite** role.
3. Network Access: allow `0.0.0.0/0`. Render's outbound IPs are not fixed on the
   free plan, so restricting by IP is not possible there.
4. Copy the connection string, which looks like
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/`.

**2. Web service (Render)**

1. Create an account and choose **New > Blueprint**, then select this repository.
   Render reads `render.yaml` and creates the service.
2. Fill in the values it asks for:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | The Atlas connection string |
   | `MONGODB_DB_NAME` | `national_clinic` (or `national_clinic_demo` for a demo instance) |
   | `CORS_ORIGINS` | The service URL, for example `https://national-clinic-hms.onrender.com` |
   | `BOOTSTRAP_ADMIN_NAME` / `_EMAIL` / `_PASSWORD` | The first administrator account |

   `JWT_ACCESS_SECRET` is generated by Render. Never put any of these in git.
3. Deploy. The first build takes a few minutes. Check `/api/health` returns
   `"status": "ok"`, then sign in with the bootstrap administrator.
4. Remove the three `BOOTSTRAP_ADMIN_*` variables once that account exists, and
   change the password after the first sign-in.

**3. Optional: load demo data into a demo instance**

Run this from your own machine, pointing at the Atlas database. The demo seed
refuses to run against a database whose name does not contain `demo`:

```bash
MONGODB_URI="mongodb+srv://..." MONGODB_DB_NAME=national_clinic_demo npm run seed:demo
```

**Notes on the free tier:** the service sleeps after about 15 minutes of
inactivity, so the first request afterwards takes roughly a minute. Free
instances are fine for showing the system to colleagues, but a paid instance,
scheduled backups and a custom domain are required before the hospital uses it
with real patient records.

## Production build and deployment

```bash
npm run build
NODE_ENV=production npm start
```

The build outputs `server/dist` and `hms/dist`.

Serve the frontend either from a web server (Nginx) or from the API itself by
setting `SERVE_WEB_DIST=../hms/dist`, which keeps everything on one origin.

A deployment checklist:

- `NODE_ENV=production`, a strong `JWT_ACCESS_SECRET`, `COOKIE_SECURE=true`
- MongoDB replica set with authentication, and automated backups you have restored at least once
- HTTPS in front of the API, with `TRUST_PROXY` set to the number of proxies
- `CORS_ORIGINS` limited to the hospital's own domain
- A process manager (systemd or pm2) to restart the API
- Log rotation and off-site backups

Run the API behind a reverse proxy such as Nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;   # required for live updates
}
```

---

## Roles and permissions

Eight roles ship with the system: Administrator, Doctor, Receptionist, Nurse,
Pharmacist, Laboratory Staff, Billing Staff and Hospital Management.

Permissions are defined in `shared/src/roles.ts` and enforced by the API on every
request. The frontend uses the same map only to decide what to display, so hiding
a button is never the only protection. The full matrix is visible in the
application under **Users > Role permissions**.

Clinical records carry an extra rule: when
*Doctors can open clinical records only for their own patients* is enabled in
Settings, a doctor sees the clinical record only for patients they have treated.
Any other record needs **emergency access**, which asks for a reason and writes
it to the audit log with a 12 hour time limit.

---

## API overview

All endpoints are under `/api` and return `{ "success": true, "data": ..., "meta": ... }`
or `{ "success": false, "error": { "code", "message", "details" } }`.

| Area | Endpoints |
| --- | --- |
| Auth | `/api/auth/login`, `/refresh`, `/logout`, `/me`, `/change-password` |
| Patients | `/api/patients`, `/:id/timeline`, `/:id/history`, `/:id/documents`, `/:id/emergency-access` |
| Appointments | `/api/appointments`, `/slots`, `/:id/reschedule`, `/:id/status` |
| Reception queue | `/api/queue`, `/walk-in`, `/check-in`, `/call-next`, `/:id/action`, `/:id/vitals` |
| Clinical | `/api/consultations`, `/api/prescriptions`, `/api/referrals` |
| Billing | `/api/billing/charges`, `/invoices`, `/invoices/:id/payments`, `/refunds` |
| Pharmacy | `/api/pharmacy/medicines`, `/stock-in`, `/adjustments`, `/dispense`, `/transactions`, `/alerts` |
| Laboratory | `/api/laboratory/tests`, `/orders`, `/orders/:id/collect`, `/results`, `/verify`, `/release`, `/amend` |
| Inpatient | `/api/wards`, `/api/beds/board`, `/api/admissions`, `/:id/transfer`, `/:id/discharge` |
| Operation theatre | `/api/ot` (only when the module is enabled) |
| Insights | `/api/reports`, `/api/analytics`, `/api/audit`, `/api/dashboard` |
| Live updates | `/api/events` (Server-Sent Events) |
| Configuration | `/api/settings`, `/api/services`, `/api/users`, `/api/doctors` |

A future public website can create appointments through the same
`POST /api/appointments` service layer with `source: "website"`; reception is
notified automatically and the booking appears in the HMS immediately.

---

## Security

- Passwords hashed with bcrypt (cost 12); hashes are never returned by the API
- Short-lived access tokens with rotating refresh tokens in an HttpOnly,
  SameSite=Strict cookie; reusing a rotated token revokes the whole session family
- Account lockout after repeated failed sign-ins, and rate limiting on the API
- Every request body, query and parameter validated with zod before use
- Security headers (helmet, Content Security Policy), configurable CORS
- Errors never leak internals; details are logged server-side only
- Request logs record method, path and status only, never query strings or bodies
- Audit log records sign-ins, record changes and access to clinical data, with
  user, action, record, time, IP address and relevant identifiers. The
  application refuses to modify or delete entries and exposes no route that could.

For defence in depth, give the application's database user insert-only rights on
`audit_logs`, for example:

```js
db.createRole({
  role: "hmsApp",
  privileges: [
    { resource: { db: "national_clinic", collection: "audit_logs" },
      actions: ["find", "insert", "createIndex"] }
  ],
  roles: [{ role: "readWrite", db: "national_clinic" }]
})
```

Clinical records are never overwritten: completed consultations are locked and
take addenda, medical history entries are amended rather than edited, corrected
laboratory results keep every previous version, and stock is adjusted through
recorded transactions instead of edits.

---

## Tests

```bash
npm test
```

The suite runs against a real MongoDB replica set started in memory and walks the
whole hospital workflow: authentication and session rotation, role permissions,
patient registration and duplicate detection, appointments and double-booking,
the token queue, consultations, prescriptions, first-expiry-first-out dispensing,
invoices and payments, laboratory verification and corrections, beds and
discharge charges, the operation theatre module gate, referrals, reports,
analytics and the append-only audit log.

---

## Project structure

```
/shared          Roles, permissions, enums, zod schemas, shared helpers
/server
  /src
    /config      Environment validation
    /controllers HTTP request and response handling
    /routes      Endpoints, permissions and input validation
    /services    Business rules, transactions, audit, notifications
    /repositories Query building and aggregations
    /models      Mongoose schemas and indexes
    /middleware  Authentication, authorization, validation, errors, rate limits
    /realtime    Event bus and Server-Sent Events stream
    /seed        Base setup and isolated demo data
    /scripts     Seed and administrator creation
  /test          Workflow test suite
/hms
  /src
    /components  Reusable interface building blocks
    /features    Cross-page building blocks (booking, vitals, prescribing)
    /pages       One folder per module
    /layouts     Application shell and navigation
    /hooks       Query helpers and live updates
    /services    API client and event stream
    /contexts    Authentication and notifications
    /utils       Formatting helpers
/scripts         Repository-level helper scripts
```

---

## Known limitations

- **Room charges** are calculated per calendar day with a minimum of one day.
  Confirm this matches the hospital's billing practice before going live.
- **PDF export** is produced through the browser's print dialog (Print, then Save
  as PDF). Reports, invoices, prescriptions and laboratory reports have print
  layouts; a server-side PDF generator can be added later.
- **Live updates** use an in-process event bus, which suits a single API server.
  Running several instances needs a shared broker (Redis or MongoDB change
  streams) behind the same `publish()` function.
- **Role permissions** are defined in code rather than edited in the interface, so
  changing them requires a software update.
- **Uploaded documents** are stored in MongoDB GridFS. Include them in backups.
- The **public patient website** is intentionally not part of this project.
