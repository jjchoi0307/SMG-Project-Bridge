# SMG Bridge

Healthcare data operations platform for SMG MSO — unifies siloed patient data from eligibility files, PCP offices, and pharmacies into a single, role-scoped hub with five web portals.

---

## Overview

SMG Bridge solves a core problem in managed care: patient data lives in three separate silos (insurance eligibility files, PCP office systems, pharmacy records) and no one stakeholder has a unified view. Bridge imports, reconciles, and surfaces that data through purpose-built portals for each role.

**Key capabilities:**
- Bulk Excel/CSV import with automatic ETL and idempotent upserts
- Real-time progress updates via Server-Sent Events
- Multi-tenant data scoping — brokers see only their org, physicians see only their panel
- Audit trail on all write operations
- CSV exports for all data types
- Prior auth, claims, lab result, and pharmacy refill tracking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 22+, Express 4 |
| Database | SQLite (built-in `node:sqlite`, WAL mode) |
| Frontend | Vanilla JS, HTML5/CSS3 — no build step |
| File watching | Chokidar 3 (auto-import on file drop into `/uploads`) |
| Excel parsing | SheetJS (xlsx 0.18) |
| Real-time | Server-Sent Events (SSE) |
| Auth | Session tokens with scrypt hashing — Clerk/Auth0 migration path built in |

> **Node.js 22+ is required.** The project uses the experimental `node:sqlite` built-in module. The `--experimental-sqlite` flag is set automatically in all npm scripts.

---

## Quick Start

```bash
git clone <repo-url>
cd "SMG - Project Bridge"
npm install
npm run seed        # optional: load synthetic patient data from dummy-data/*.xlsx
npm run dev         # starts server at http://localhost:3000
```

To run in production:

```bash
npm start
```

---

## Five Portals

Each portal is a self-contained static HTML file served from `/client/`.

| Portal | File | Role(s) | Access |
|---|---|---|---|
| Admin | `/bridge-admin.html` | `admin` | All data, no filters |
| SMG Internal | `/bridge-smg.html` | `coordinator`, `ops`, `physrel`, `leadership`, `product` | All data |
| Broker | `/bridge-broker.html` | `broker` | Org-scoped patients only |
| Doctor | `/bridge-doctor.html` | `physician` | Own patient panel (by NPI) |
| Member | `/bridge-members-v2.html` | `patient` | Self-service |

The server routes unknown paths to `bridge-admin.html` as the catch-all.

---

## Project Structure

```
SMG - Project Bridge/
├── server/
│   ├── index.js              # Express entry point (port 3000)
│   ├── database.js           # SQLite schema + auto-migration on startup
│   ├── seed.js               # Seeds DB from dummy-data/*.xlsx
│   ├── routes/
│   │   ├── auth.js           # Login, logout, session management
│   │   ├── patients.js       # Patient CRUD, search, KPIs, population intel
│   │   ├── mso.js            # Eligibility, claims, prior authorizations
│   │   ├── pcp.js            # Provider panels, labs, medications
│   │   ├── pharmacy.js       # Refill tracking, pharmacy requests
│   │   ├── upload.js         # Bulk .xlsx import + SSE progress stream
│   │   └── export.js         # CSV exports for all data types
│   ├── middleware/
│   │   ├── requireAuth.js    # Token verification (local / Clerk / Auth0)
│   │   └── orgScope.js       # Row-level data scoping by role
│   └── utils/
│       ├── cache.js          # TTL in-memory cache (30–60s for dashboards)
│       ├── auditLog.js       # Automatic write-op audit middleware
│       ├── excelParser.js    # XLSX → patient records ETL
│       └── fileWatcher.js    # Chokidar watcher for /uploads auto-import
├── client/                   # Static HTML portal files
├── dummy-data/               # XLSX seed files (tracked in git)
├── docs/
│   └── SMG_BRIDGE_DOCUMENTATION.md   # Full technical reference (703 lines)
├── data/                     # SQLite DB — auto-created, gitignored
├── uploads/                  # Uploaded files — gitignored
└── package.json
```

---

## API Overview

Base URL: `http://localhost:3000/api`

All endpoints except `/api/auth/*` require:
```
Authorization: Bearer <session-token>
```

| Module | Base path | Key endpoints |
|---|---|---|
| Auth | `/api/auth` | `POST /login`, `POST /logout`, `GET /me` |
| Patients | `/api/patients` | list, get, update, `/stats`, `/intel` |
| MSO | `/api/mso` | eligibility, claims, prior auths, payer summary |
| PCP | `/api/pcp` | provider panel, labs, medications, dashboard |
| Pharmacy | `/api/pharmacy` | refills due, requests, real-time broadcast |
| Upload | `/api/upload` | `POST /` (bulk xlsx), `GET /events` (SSE stream) |
| Export | `/api/export` | CSV for patients, eligibility, claims, labs, auths, pharmacy |

Health check: `GET /api/health` → `{ status: 'ok', timestamp, version }`

Full endpoint reference with request/response shapes: [`docs/SMG_BRIDGE_DOCUMENTATION.md`](./docs/SMG_BRIDGE_DOCUMENTATION.md)

---

## Authentication & Role-Based Access

**Local auth flow:**
1. `POST /api/auth/login` with `{ username, password }`
2. Server verifies scrypt hash, creates a random 32-byte session token (7-day TTL)
3. Client sends `Authorization: Bearer <token>` on all subsequent requests
4. `requireAuth.js` middleware validates token against the `sessions` table

**Data scoping by role** (applied automatically in every patient query):

| Role | Filter |
|---|---|
| `admin`, `coordinator`, `ops`, `physrel`, `leadership`, `product` | No filter — all data |
| `broker` | `WHERE org_id = user.orgId` |
| `physician` | `WHERE patient_id IN (SELECT patient_id FROM pcp_providers WHERE provider_npi = user.npi)` |

**Migrating to Clerk or Auth0:** Set `BRIDGE_AUTH_MODE=clerk` (or `auth0`) and replace the `verifyToken()` function in `server/middleware/requireAuth.js` with the provider's JWT verification. All downstream code uses a standardized `req.user` shape and will work unchanged.

---

## Environment Variables

Create a `.env` file in the project root (no `.env.example` is provided — these are the available options):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listening port |
| `BRIDGE_AUTH_ENABLED` | `true` | Set to `false` to bypass auth entirely (dev/testing only) |
| `BRIDGE_AUTH_MODE` | `local` | `local` \| `clerk` \| `auth0` |
| `CLERK_SECRET_KEY` | — | Required if `BRIDGE_AUTH_MODE=clerk` |
| `AUTH0_DOMAIN` | — | Required if `BRIDGE_AUTH_MODE=auth0` |
| `AUTH0_AUDIENCE` | — | Required if `BRIDGE_AUTH_MODE=auth0` |

---

## Demo Credentials

All seeded accounts share the default password: **`smg2026`** or **`smgadmin`**

| Username | Role | Portal |
|---|---|---|
| `smgadmin` | admin | Admin |
| `coord.smg` | coordinator | SMG |
| `ops.smg` | operations | SMG |
| `physrel.smg` | physician relations | SMG |
| `lead.smg` | leadership | SMG |
| `doctor.park` | physician | Doctor (Dr. James Park) |
| `doctor.lee` | physician | Doctor (Dr. Sarah Lee) |
| `doctor.yoon` | physician | Doctor (Dr. Robert Yoon) |
| `broker.chen` | broker | Broker (Calvin Chen) |
| `broker.kim` | broker | Broker (Kim Brokers) |

The seed process loads ~10,000 synthetic patients from `dummy-data/*.xlsx`.

---

## Development Notes

- **No build step** for the frontend — edit `.html` files in `client/` directly
- **Schema auto-migrates** on every server startup — `server/database.js` handles missing columns from older versions
- **Drop-and-import** — drop any `.xlsx` file into `/uploads/` and Chokidar picks it up automatically
- **SSE streams:**
  - `/api/upload/events` — real-time upload progress and completion events
  - Pharmacy route broadcasts refill request status updates
  - 25-second heartbeat keeps connections alive
- **Dashboard caching** — expensive aggregate queries are cached in memory for 30–60 seconds, scoped by `org_id` or `npi`

---

## Further Reading

[`docs/SMG_BRIDGE_DOCUMENTATION.md`](./docs/SMG_BRIDGE_DOCUMENTATION.md) — comprehensive technical reference covering:
- Full database schema (15 tables with indexes and constraints)
- Complete API endpoint reference with request/response shapes
- Stakeholder map and portal feature details
- Architecture diagrams and data flow
