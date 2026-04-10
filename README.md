# SMG Bridge

Healthcare data operations platform for SMG MSO (AMM) — unifies siloed patient data from eligibility files, PCP offices, and pharmacies into a single, role-scoped hub with six web portals, including a patient-facing mobile app with caregiver support.

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
- Appointment calendar — 2-panel month view connecting confirmed appointments with pending requests; doctors and admins can confirm, reschedule, or cancel inline
- Patient-facing mobile app with caregiver view, dynamic after-visit summaries, and live appointment confirmation feedback

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
| Auth | Disabled by default for demo — Clerk/Auth0 migration path built in |

> **Node.js 22+ is required.** The project uses the experimental `node:sqlite` built-in module. The `--experimental-sqlite` flag is set automatically in all npm scripts.

---

## Quick Start

### First-Time Setup (No Technical Experience Required)

**Step 1 — Install Node.js**

Go to [nodejs.org](https://nodejs.org) → click the green **LTS** button → download and install. Click through the installer defaults.

Verify it worked: open Terminal (Mac) or Command Prompt (Windows) and type `node -v`. You should see `v22` or higher.

**Step 2 — Download the project**

Go to [github.com/jjchoi0307/SMG-Project-Bridge](https://github.com/jjchoi0307/SMG-Project-Bridge) → click the green **`<> Code`** button → click **Download ZIP** → extract the folder.

**Step 3 — Open Terminal in that folder**

- **Mac:** Right-click the extracted folder → "New Terminal at Folder"
- **Windows:** Hold Shift + right-click the folder → "Open PowerShell window here"

**Step 4 — Run these commands** (copy-paste each line, press Enter after each)

```bash
npm install
npm run seed
node server/seed-visit-notes.js
npm run dev
```

Wait for the terminal to say **`SMG Bridge running on http://localhost:3000`**

**Step 5 — Open the app**

Open Chrome or Safari and go to: **http://localhost:3000**

The Admin Portal opens automatically — no login required.

**To stop the server:** Press `Ctrl + C` in the Terminal window.

---

### Portal URLs

| Portal | URL |
|---|---|
| Admin | http://localhost:3000 |
| Doctor | http://localhost:3000/bridge-doctor.html |
| Patient App | http://localhost:3000/bridge-members-v2.html |

**Doctor login sample NPIs:** `4455667788` · `5544332211` · `0987654321`

**Patient App sample IDs:** `SMG-2047` · `SMG-2217` · `SMG-3868`

---

### Developer Quick Start

```bash
git clone https://github.com/jjchoi0307/SMG-Project-Bridge.git
cd "SMG - Project Bridge"
npm install
npm run seed              # load synthetic patient data from dummy-data/*.xlsx
node server/seed-visit-notes.js   # seed doctor visit notes for all patients (run once)
npm run dev               # starts server at http://localhost:3000
```

To run in production:

```bash
npm start
```

If you see `EADDRINUSE: address already in use :::3000`, kill the existing process first:

```bash
lsof -ti :3000 | xargs kill -9 && npm run dev
```

---

## Six Portals

Each portal is a self-contained static HTML file served from `/client/`.

| Portal | File | Role(s) | Access |
|---|---|---|---|
| Admin | `bridge-admin.html` | `admin` | All data, no filters |
| SMG Internal | `bridge-smg.html` | `coordinator`, `ops`, `physrel`, `leadership`, `product` | All data |
| Broker | `bridge-broker.html` | `broker` | Org-scoped patients only |
| Doctor | `bridge-doctor.html` | `physician` | Own patient panel (by NPI) |
| Member (Patient + Caregiver) | `bridge-members-v2.html` | `patient`, `caregiver` | Self-service, public endpoint |

The server routes unknown paths to `bridge-admin.html` as the catch-all.

---

## Admin Portal

`bridge-admin.html` is the full-access operations hub for the SMG team.

**Sidebar sections:**

| Section | Pages |
|---|---|
| Data | Upload Files, Patient Registry, Eligibility, Claims, Authorizations |
| Clinical | Lab Results, Pharmacy |
| Patient Portal | Today's Schedule, **Appointment Calendar**, Caregiver Consents |
| Member Portals | Bridge v2 (patient app launcher) |

### Appointment Calendar

The appointment calendar replaces the old flat request queue. It provides a 2-panel view:

- **Left panel** — mini monthly grid with color-coded dot indicators per day (green = confirmed, amber = pending, purple = rescheduled) and a scrollable list of all pending requests sorted by date
- **Right panel** — day detail showing time-sorted confirmed appointments, pending request cards with inline time-selector and confirm / reschedule / cancel actions, and rescheduled entries with their original date

Appointment data is shared with the doctor portal and patient app through `localStorage` (`bridge_appt_requests`). When a request is confirmed with a scheduled time, it flows back to the patient's "Upcoming Visits" view automatically.

---

## Doctor Portal

`bridge-doctor.html` is an NPI-scoped portal — a doctor enters their name and 10-digit NPI at login to access only their patient panel.

**Sidebar sections:**

| Section | Pages |
|---|---|
| Data Management | Patient List, Eligibility, Claims |
| MSO Operations | Authorizations, Pharmacy, Medications |
| Clinical | Lab Results, Today's Schedule |
| Patient Portal | **Appointment Calendar**, Caregiver Consents, Launch Bridge App |

All data queries are scoped to the doctor's NPI via `pcp_providers` JOINs. The appointment calendar and caregiver consent sections share the same `localStorage` keys as the admin portal, so confirmations made in either portal are visible in both.

**Demo NPIs:**

| Doctor | NPI |
|---|---|
| Dr. Oh, Michael | `4455667788` |
| Dr. Choi, Brian | `5544332211` |
| Dr. Park, Steven | `0987654321` |

---

## Member App — Patient & Caregiver

`bridge-members-v2.html` is a bilingual (English/Korean) mobile-first app with two modes: **Patient** and **Caregiver**.

### Patient View

Accessed by entering an SMG Member ID (`SMG-XXXXXXX`) or insurance member ID — no login required.

**Home tab**
- Morning mood check-in (Good / OK / Down)
- My Meds shortcut showing today's status
- Upcoming appointment with PCP name

**My Meds tab**
- Full medication list pulled from `pharmacy_records` (falls back to `medication_requests`)
- Expandable cards with dosage, pharmacy, refills remaining
- "I've taken my meds" confirmation button — updates caregiver view in real time

**My Visit tab**
- **Action Needed** — dynamic alerts per patient (annual wellness overdue, pending/approved authorizations)
- **Upcoming Visits** — confirmed appointment requests appear here as date-boxed cards (month, day, confirmed time, "Confirmed ✓" badge) alongside the static PCP and specialist referral cards. Confirmation flows directly from the admin or doctor portal — no manual step required.
- **Awaiting Confirmation** — pending requests the patient has submitted show with amber styling and "Your care team will confirm soon." Once a doctor confirms and sets a time, the card moves up to Upcoming Visits automatically.
- **Approvals & Authorizations** — real-time status from the admin portal
- **Transport** — tap to call PCP office or SMG at (562) 766-2000

**Records tab**
- Lab Results — most recent results with Normal / High / Low / Critical flags
- Prescriptions — active medications with prescriber and refill info
- After Visit Summaries — expandable doctor notes with reason for visit, diagnoses, next steps, and provider signature. Seeded with 2–3 notes per patient across all 10,000+ patients.

### Caregiver View

Caregivers connect to a family member's account using the member's SMG ID.

**Today's Update card**
- MOOD (left) and MEDS (right) signal pills — update live as the patient checks in
- Dynamic status message:
  - Score ≥ 80: *Everything looks good 💚*
  - Score 60–79: *A little check-in would be nice*
  - Score < 60: *She'd love to hear from you today 💛*
- "Remind Mom" button sends an in-app nudge
- Quiet state shown when patient is fully checked in

---

## Project Structure

```
SMG - Project Bridge/
├── server/
│   ├── index.js                  # Express entry point (port 3000)
│   ├── database.js               # SQLite schema + auto-migration on startup
│   ├── seed.js                   # Seeds DB from dummy-data/*.xlsx
│   ├── seed-visit-notes.js       # Seeds visit notes for all patients (run once)
│   ├── routes/
│   │   ├── auth.js               # Login, logout, session management
│   │   ├── patientPortal.js      # Public patient lookup — no auth required
│   │   ├── patients.js           # Patient CRUD, search, KPIs, population intel
│   │   ├── mso.js                # Eligibility, claims, prior authorizations
│   │   ├── pcp.js                # Provider panels, labs, medications, pharmacy, panel-meds
│   │   ├── pharmacy.js           # Refill tracking, pharmacy requests
│   │   ├── upload.js             # Bulk .xlsx import + SSE progress stream
│   │   └── export.js             # CSV exports for all data types
│   ├── middleware/
│   │   ├── requireAuth.js        # Token verification — OFF by default for demo
│   │   └── orgScope.js           # Row-level data scoping by role
│   └── utils/
│       ├── cache.js              # TTL in-memory cache (30–60s for dashboards)
│       ├── audit.js              # Automatic write-op audit middleware
│       ├── watcher.js            # Chokidar watcher for /uploads auto-import
│       └── auth.js               # scrypt hashing, session creation/verification
├── client/                       # Static HTML portal files
├── dummy-data/                   # XLSX seed files (tracked in git)
├── docs/
│   └── SMG_BRIDGE_DOCUMENTATION.md   # Full technical reference
├── data/                         # SQLite DB — auto-created, gitignored
├── uploads/                      # Uploaded files — gitignored
└── package.json
```

---

## API Overview

Base URL: `http://localhost:3000/api`

Authentication is **disabled by default**. All endpoints are open in demo mode. To enable, set `BRIDGE_AUTH_ENABLED=true`.

| Module | Base path | Key endpoints |
|---|---|---|
| Auth | `/api/auth` | `POST /login`, `POST /logout`, `GET /me` |
| Patient Portal | `/api/patient-portal` | `GET /lookup/:id` — public, no auth |
| Patients | `/api/patients` | list, get, update, `/stats`, `/intel` |
| MSO | `/api/mso` | eligibility (`?npi=`), claims (`?npi=`), prior auths, payer summary |
| PCP | `/api/pcp` | panel (`?npi=`), panel/stats, labs, medications, pharmacy (`?npi=`), panel-meds (`?npi=`) |
| Pharmacy | `/api/pharmacy` | refills due, requests, real-time broadcast |
| Upload | `/api/upload` | `POST /` (bulk xlsx), `GET /events` (SSE stream) |
| Export | `/api/export` | CSV for patients, eligibility, claims, labs, auths, pharmacy |

Health check: `GET /api/health` → `{ status: 'ok', timestamp, version }`

### NPI Scoping on MSO Routes

The MSO eligibility and claims endpoints accept an optional `?npi=` query parameter. When provided, results are filtered to patients on that doctor's panel via a `pcp_providers` subquery — giving doctor portals a scoped view of their own patients' insurance and claims data without a separate data store.

```
GET /api/mso/eligibility?npi=4455667788
GET /api/mso/claims/summary?npi=4455667788
GET /api/pcp/pharmacy?npi=4455667788
GET /api/pcp/panel-meds?npi=4455667788
```

### Public Patient Lookup

```
GET /api/patient-portal/lookup/:id
```

Accepts an SMG patient ID (`SMG-XXXXXXX`) or an insurance member ID. Returns:
- Patient demographics
- Eligibility / insurance plan
- PCP provider
- Active medications + pharmacy records
- Authorizations
- Lab results
- Visit notes (after visit summaries)

No authentication token required.

---

## Authentication

Auth is **off by default** for demo and local development. All API routes are accessible without a token.

To enable auth for production:

```bash
BRIDGE_AUTH_ENABLED=true node server/index.js
```

**Local auth flow (when enabled):**
1. `POST /api/auth/login` with `{ username, password }`
2. Server verifies scrypt hash, creates a random 32-byte session token (7-day TTL)
3. Client sends `Authorization: Bearer <token>` on all subsequent requests

**Data scoping by role** (applied automatically in every patient query):

| Role | Filter |
|---|---|
| `admin`, `coordinator`, `ops`, `physrel`, `leadership`, `product` | No filter — all data |
| `broker` | `WHERE org_id = user.orgId` |
| `physician` | `WHERE patient_id IN (SELECT patient_id FROM pcp_providers WHERE provider_npi = user.npi)` |

**Migrating to Clerk or Auth0:** Set `BRIDGE_AUTH_MODE=clerk` (or `auth0`) and follow the migration comments in `server/middleware/requireAuth.js`. All downstream code uses a standardized `req.user` shape and will work unchanged.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listening port |
| `BRIDGE_AUTH_ENABLED` | `false` | Set to `true` to enforce auth |
| `BRIDGE_AUTH_MODE` | `local` | `local` \| `clerk` \| `auth0` |
| `CLERK_SECRET_KEY` | — | Required if `BRIDGE_AUTH_MODE=clerk` |
| `AUTH0_DOMAIN` | — | Required if `BRIDGE_AUTH_MODE=auth0` |
| `AUTH0_AUDIENCE` | — | Required if `BRIDGE_AUTH_MODE=auth0` |

---

## Demo Credentials

Only relevant when `BRIDGE_AUTH_ENABLED=true`. All seeded accounts use password **`smg2026`** (or **`smgadmin`** for the admin account).

| Username | Role | Portal |
|---|---|---|
| `admin` | admin | Admin |
| `coord.smg` | coordinator | SMG |
| `ops.smg` | operations | SMG |
| `physrel.smg` | physician relations | SMG |
| `lead.smg` | leadership | SMG |
| `product.smg` | product | SMG |
| `doctor.park` | physician | Doctor (Dr. James Park) |
| `doctor.lee` | physician | Doctor (Dr. Sarah Lee) |
| `doctor.yoon` | physician | Doctor (Dr. Robert Yoon) |
| `broker.chen` | broker | Broker (Calvin Chen) |
| `broker.kim` | broker | Broker (Kim Brokers) |

The seed process loads ~10,000 synthetic patients from `dummy-data/*.xlsx`. `seed-visit-notes.js` generates ~25,000 after-visit summary notes across all patients.

---

## Development Notes

- **No build step** for the frontend — edit `.html` files in `client/` directly
- **Schema auto-migrates** on every server startup — `server/database.js` handles missing columns from older versions, including the `visit_notes` table
- **Drop-and-import** — drop any `.xlsx` file into `/uploads/` and Chokidar picks it up automatically
- **Appointment data** — shared between portals via `localStorage` keys `bridge_appt_requests` and `bridge_caregiver_consents`. No server persistence required for demo; a real deployment would store these server-side.
- **SSE streams:**
  - `/api/upload/events` — real-time upload progress and completion events
  - Pharmacy route broadcasts refill request status updates
  - 25-second heartbeat keeps connections alive
- **Dashboard caching** — expensive aggregate queries are cached in memory for 30–60 seconds, scoped by `org_id` or `npi`
- **Language support** — the member app supports English and Korean throughout; toggle with the EN / 한국어 button

---

## Further Reading

[`docs/SMG_BRIDGE_DOCUMENTATION.md`](./docs/SMG_BRIDGE_DOCUMENTATION.md) — comprehensive technical reference covering:
- Full database schema (16 tables with indexes and constraints)
- Complete API endpoint reference with request/response shapes
- Stakeholder map and portal feature details
- Architecture diagrams and data flow
