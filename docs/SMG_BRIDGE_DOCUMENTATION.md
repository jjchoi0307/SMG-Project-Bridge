# SMG Bridge — Technical Documentation

**Version:** 1.0.0
**Stack:** Node.js · Express · SQLite · Chokidar · XLSX
**Server port:** 3000 (configurable via `PORT` env var)

---

## 1. What Is SMG Bridge?

SMG Bridge is a healthcare data operations platform built for SMG MSO (Management Services Organization). It unifies data from three historically siloed sources — AMM/MSO records, PCP office data, and pharmacy data — into a single live system with five role-specific portals.

The core problem it solves: patient data for a Korean-American Medicare Advantage panel lives across spreadsheets from multiple sources (eligibility files, claims exports, lab reports, pharmacy records). Before Bridge, staff reconciled this manually. Bridge ingests all of it via Excel upload, normalizes it into a relational database, and serves it in real time to every stakeholder who needs it — operations, physicians, brokers, and patients.

### Five Portals

| Portal | File | Audience |
|--------|------|----------|
| Admin | `bridge-admin.html` | Internal SMG operations — full data access |
| SMG Internal | `bridge-smg.html` | SMG leadership, coordinators, physician relations |
| Broker | `bridge-broker.html` | External insurance brokers |
| Doctor | `bridge-doctor.html` | PCP physicians with panel access |
| Member App | `bridge-members-v2.html` | Patients and their caregivers |

---

## 2. Architecture

```
┌────────────────────────────────────────────────────┐
│                    Client Layer                     │
│  bridge-admin.html  bridge-smg.html  bridge-        │
│  broker.html  bridge-doctor.html  bridge-members    │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP + SSE
┌──────────────────────▼─────────────────────────────┐
│              Express Server (server/index.js)        │
│                                                      │
│  Middleware stack:                                   │
│    cors → json(10mb) → urlencoded → auditMiddleware │
│                                                      │
│  Routes:                                             │
│    /api/upload    /api/patients    /api/mso          │
│    /api/pharmacy  /api/pcp         /api/auth         │
│    /api/export    /api/health                        │
│                                                      │
│  Utilities:                                          │
│    cache.js  excel.js  watcher.js  auth.js  audit.js│
└──────────────────────┬─────────────────────────────┘
                       │ node:sqlite
┌──────────────────────▼─────────────────────────────┐
│             SQLite (data/bridge.db)                  │
│  WAL mode · Foreign key constraints · 15 tables     │
└────────────────────────────────────────────────────┘
                       │ Chokidar
┌──────────────────────▼─────────────────────────────┐
│           uploads/ directory (watched)               │
│  .xlsx / .xls / .csv  up to 50MB per file           │
└────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

- **`node:sqlite` (built-in)** — No external DB dependencies. The experimental SQLite module ships with Node.js v22+, eliminating `better-sqlite3` or `sqlite3` npm packages while retaining synchronous query execution.
- **WAL mode** — Write-Ahead Logging allows concurrent reads during writes, critical for SSE streaming while bulk imports are running.
- **SSE over WebSockets** — Server-Sent Events are used for real-time push. One-directional (server → client) is sufficient since clients pull data reactively.
- **In-memory cache** — Dashboard stats cached with TTL (30–60s). Cache is invalidated on every write operation via `invalidate(prefix)`.

---

## 3. Database Schema

### `patients` — Core registry
The central table. Every other table links to a row here via `patient_id`.

| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | TEXT UNIQUE | External ID from Excel (e.g., `SMG-001`) |
| `last_name, first_name, middle_name` | TEXT | |
| `dob, gender` | TEXT | |
| `phone, email` | TEXT | |
| `address, city, state, zip` | TEXT | |
| `language` | TEXT | Default: `English` |
| `korean_name` | TEXT | Korean script for Korean-language patients |
| `assigned_broker` | TEXT | Links patient to broker portal (migration-added) |
| `source_file` | TEXT | Which Excel import created this record |
| `created_at, updated_at` | TEXT | ISO timestamps |

### `eligibility` — Insurance coverage
| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `payer_name` | TEXT | LA Care, Aetna, Health Net, etc. |
| `plan_name, plan_type` | TEXT | HMO \| PPO \| Medicare Advantage \| Medicaid |
| `member_id, group_number` | TEXT | Insurance identifiers |
| `effective_date, term_date` | TEXT | Coverage window |
| `status` | TEXT | Active \| Inactive \| Pending \| Termed |
| `copay, deductible` | TEXT | |
| `verified_date` | TEXT | Last eligibility verification |

### `claims` — Billing and claims status
| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `claim_number, dos` | TEXT | Date of service |
| `cpt_code, icd_codes` | TEXT | icd_codes is comma-separated |
| `provider_name, provider_npi` | TEXT | |
| `billed_amount, allowed_amount, paid_amount, patient_resp` | REAL | |
| `status` | TEXT | Pending \| Approved \| Denied \| Paid \| Appeal |
| `denial_reason, submission_date, paid_date` | TEXT | |

### `authorizations` — Prior auth / referrals
| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `auth_type` | TEXT | Referral \| Prior Auth \| Procedure |
| `service_type` | TEXT | What service is being authorized |
| `referring_provider, rendering_provider` | TEXT | |
| `requested_date, approved_date, start_date, end_date` | TEXT | |
| `approved_units, used_units` | INTEGER | |
| `status` | TEXT | Pending \| Approved \| Denied \| Expired |
| `denial_reason, notes` | TEXT | |

### `lab_results` — Clinical lab data
| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `test_name, test_code` | TEXT | |
| `result_value, unit, reference_range` | TEXT | |
| `flag` | TEXT | Normal \| High \| Low \| Critical |
| `ordered_by, ordering_npi` | TEXT | |
| `collection_date, result_date` | TEXT | |
| `lab_name` | TEXT | Quest, LabCorp, etc. |
| `status` | TEXT | Pending \| Preliminary \| Final \| Corrected |

### `medication_requests` — E-prescriptions from PCP
Prescriptions written by physicians. Distinct from what the pharmacy has dispensed.

| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `medication_name, ndc_code` | TEXT | |
| `dosage, frequency, quantity, days_supply` | TEXT/INT | |
| `prescriber_name, prescriber_npi` | TEXT | |
| `prescribed_date` | TEXT | |
| `status` | TEXT | Active \| Discontinued \| Pending \| Denied |

### `pharmacy_records` — Dispensed medications
What the pharmacy has actually filled. Tracks refill schedule.

| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `medication_name, ndc_code, dosage, quantity, days_supply` | TEXT/INT | |
| `pharmacy_name, pharmacy_phone, pharmacy_address` | TEXT | |
| `fill_date, refill_due_date` | TEXT | |
| `refills_remaining` | INTEGER | |
| `status` | TEXT | Active \| Expired \| Discontinued |
| `last_fill_status` | TEXT | Filled \| Partial \| On-Hold \| Transferred |

### `pharmacy_requests` — Outbound pharmacy requests
Actions taken from Bridge (refill requests, transfers) sent to the pharmacy.

| Column | Type | Notes |
|--------|------|-------|
| `patient_id, pharmacy_record_id` | FK | |
| `request_type` | TEXT | Refill \| Transfer \| Prior Auth \| Override |
| `medication_name, pharmacy_name, requested_by` | TEXT | |
| `status` | TEXT | Sent \| Processing \| Completed \| Failed |
| `response_msg, completed_at` | TEXT | |

### `pcp_providers` — Physician assignments
Links patients to their primary care physician. A patient can have one active PCP.

| Column | Type | Notes |
|--------|------|-------|
| `patient_id` | FK → patients | |
| `provider_name, provider_npi` | TEXT | NPI is the lookup key for doctor portal |
| `specialty, practice_name, practice_phone, practice_address` | TEXT | |
| `assigned_date, status` | TEXT | |

### `users` — Auth accounts
| Column | Type | Notes |
|--------|------|-------|
| `username` | TEXT UNIQUE | |
| `password_hash` | TEXT | `salt:hash` format (scrypt) |
| `full_name, role` | TEXT | physician \| coordinator \| operations \| physrel \| leadership \| product \| broker \| admin |
| `portal` | TEXT | doctor \| smg \| broker \| admin |

### `sessions` — Active login tokens
| Column | Type | Notes |
|--------|------|-------|
| `token` | TEXT PK | 64-char hex, random |
| `user_id` | FK → users | |
| `expires_at` | TEXT | 7-day TTL from creation |

### `audit_log` — Write operation trail
Every successful POST, PUT, or DELETE operation is recorded here.

| Column | Type | Notes |
|--------|------|-------|
| `username, action` | TEXT | CREATE \| UPDATE \| DELETE |
| `table_name, record_id` | TEXT | Which table and which row |
| `changes_json` | TEXT | Full request body as JSON |
| `ip_address` | TEXT | |

### Indexes

```sql
idx_patients_pid          ON patients(patient_id)
idx_patients_name         ON patients(last_name, first_name)
idx_eligibility_pid       ON eligibility(patient_id)
idx_eligibility_member    ON eligibility(member_id)
idx_claims_pid            ON claims(patient_id)
idx_claims_status         ON claims(status)
idx_auths_pid             ON authorizations(patient_id)
idx_auths_status          ON authorizations(status)
idx_labs_pid              ON lab_results(patient_id)
idx_labs_flag             ON lab_results(flag)
idx_pharmacy_pid          ON pharmacy_records(patient_id)
idx_pharmacy_refill       ON pharmacy_records(refill_due_date, status)
idx_pcp_npi               ON pcp_providers(provider_npi)
idx_audit_table           ON audit_log(table_name, created_at)
```

---

## 4. Backend Systems

### 4.1 File Import Pipeline (`server/utils/excel.js`)

This is the core ETL process. When an Excel file lands in the uploads directory (by upload or file watcher), it goes through:

**Step 1 — Sheet detection**
Headers are read and compared against known column name synonyms to determine what type of data the sheet contains:

```
patients      → patient_id, last_name, first_name, dob, ...
eligibility   → payer_name, member_id, plan_name, effective_date, ...
claims        → dos, cpt_code, icd_codes, billed_amount, ...
authorizations → auth_type, service_type, requesting_date, ...
labs          → test_name, result_value, flag, result_date, ...
medications   → medication_name, ndc_code, dosage, prescribed_date, ...
pharmacy      → medication_name, fill_date, refill_due_date, ...
pcp           → provider_name, provider_npi, specialty, ...
```

Each column type supports multiple synonym names. For example, `assigned_broker` maps to: `assigned_broker`, `broker`, `broker_license`, `broker_id`, `broker_name`, `broker_agent`. This tolerates variations in how different source systems name their columns.

**Step 2 — Date normalization**
Dates arrive in multiple formats from different source systems:

```
"3/15/2026"           → 2026-03-15
"03/15/2026"          → 2026-03-15
"2026-03-15"          → 2026-03-15 (passthrough)
"15-Mar-2026"         → 2026-03-15
46000 (Excel serial)  → YYYY-MM-DD (Excel epoch offset)
```

**Step 3 — Upsert logic**
Patient records are inserted with `INSERT OR IGNORE` and then updated via `UPDATE ... WHERE patient_id = ?`. This means re-importing the same file updates existing records rather than creating duplicates.

Non-patient records (claims, labs, etc.) are cleaned before re-import: all records with `source_file = <filename>` are deleted first, then fresh records are inserted. This prevents duplication when files are re-processed.

**Step 4 — Status tracking**
The `excel_files` table tracks each file's processing state:
- `pending` → registered but not yet processed
- `processing` → active import in progress
- `done` → successfully imported, row_count updated
- `error` → import failed, error_msg populated

---

### 4.2 Real-Time Sync (SSE + File Watcher)

Bridge uses two mechanisms for real-time updates:

**File Watcher (`server/utils/watcher.js`)**
Chokidar watches the `uploads/` directory. When a file is created or modified:
1. `reprocessFile(filepath)` is called after a 2-second stabilization delay
2. The file is re-ingested through the same pipeline as a manual upload
3. A `file-updated` or `file-added` SSE event is broadcast to all connected clients

This means dropping a new Excel file into the uploads folder automatically syncs it without using the UI.

**Server-Sent Events (`GET /api/upload/events`)**
Each browser tab that opens a Bridge portal establishes a persistent SSE connection. The server holds a `sseClients` array of active response objects.

```
Client connects    →  headers set, "connected" event sent, client added to array
Heartbeat (25s)    →  ": heartbeat\n\n" written to keep connection alive
upload-complete    →  broadcast when POST /api/upload finishes processing
file-updated       →  broadcast when watcher detects a file change
file-added         →  broadcast when watcher sees a new file
pharmacy-request   →  broadcast when a refill request is sent
pharmacy-request-updated → broadcast when request status changes
Client disconnects →  removed from sseClients array
```

Each portal's JavaScript connects to this stream and re-fetches relevant data on each event, keeping dashboards current without manual refresh.

---

### 4.3 Cache (`server/utils/cache.js`)

A simple in-memory TTL cache prevents re-running expensive aggregate queries on every dashboard load.

```javascript
cached('stats:patients', 30_000, () => { /* 8 COUNT queries */ })
cached('mso:dashboard',  60_000, () => { /* 5 queries */ })
cached('mso:payer-summary', 60_000, () => { /* 2 GROUP BY queries */ })
cached('pharmacy:dashboard', 60_000, () => { /* 3 queries */ })
cached('pcp:dashboard',  60_000, () => { /* 3 queries */ })
```

After any write operation, the affected cache namespace is invalidated:
```javascript
invalidate('stats')     // clears stats:patients
invalidate('mso')       // clears mso:dashboard, mso:payer-summary
```

`flush()` is called after bulk imports to clear everything.

---

### 4.4 Audit Logging (`server/utils/audit.js`)

Every POST, PUT, or DELETE that succeeds is recorded in `audit_log` without any changes to the route handlers themselves. This works by intercepting `res.json`:

```javascript
function auditMiddleware(req, res, next) {
  if (!['POST','PUT','DELETE'].includes(req.method)) return next();
  const table = resolveTable(req.originalUrl);  // regex match
  if (!table) return next();

  const orig = res.json.bind(res);
  res.json = function(body) {
    if (body && !body.error) {
      db.prepare(`INSERT INTO audit_log ...`)
        .run(action, table, recordId, JSON.stringify(req.body), req.ip);
    }
    return orig(body);  // call original res.json
  };
  next();
}
```

The middleware wraps `res.json` before the route handler runs. When the route calls `res.json({ success: true })`, the wrapper fires first, writes the audit record, then calls the original response. Errors are swallowed silently so audit failures never break the main request.

---

### 4.5 Authentication (`server/utils/auth.js`)

**Password hashing:**
```
hashPassword(pw)  →  scrypt(pw, randomBytes(16), 64)  →  "hex_salt:hex_hash"
verifyPassword(pw, stored)  →  timing-safe comparison via crypto.timingSafeEqual
```

**Session tokens:**
```
createSession(userId)  →  randomBytes(32).toString('hex')  (64 chars)
                       →  INSERT INTO sessions (token, user_id, expires_at = now+7d)
verifySession(token)   →  SELECT user WHERE token = ? AND expires_at > now()
```

**Default seeded accounts (password: `smg2026`, admin: `smgadmin`):**

| Username | Role | Portal |
|----------|------|--------|
| `doctor.park` | physician | doctor |
| `doctor.lee` | physician | doctor |
| `doctor.yoon` | physician | doctor |
| `coord.smg` | coordinator | smg |
| `ops.smg` | operations | smg |
| `physrel.smg` | physrel | smg |
| `lead.smg` | leadership | smg |
| `product.smg` | product | smg |
| `broker.chen` | broker | broker |
| `broker.kim` | broker | broker |
| `admin` | admin | admin |

---

## 5. API Reference

### `/api/patients`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/patients` | Paginated patient list. Params: `q`, `broker`, `page`, `limit`, `sort`, `dir` |
| GET | `/api/patients/stats` | Dashboard counts (cached 30s) |
| GET | `/api/patients/intel` | Population + clinical aggregate for SMG portal |
| GET | `/api/patients/:pid` | Full patient profile (all linked records) |
| PUT | `/api/patients/:pid` | Update patient demographics |

The list endpoint supports simultaneous search (`q`) and broker filter (`broker`), joined with AND:
```sql
WHERE (last_name LIKE ? OR first_name LIKE ? OR patient_id LIKE ? OR phone LIKE ? OR email LIKE ?)
AND assigned_broker = ?
```

The full profile endpoint (`/:pid`) returns everything in one call: patient demographics, all eligibility records, all claims, all authorizations, all lab results, all medication requests, all pharmacy records, PCP info, and recent pharmacy requests.

---

### `/api/mso`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/eligibility` | Create eligibility record |
| GET | `/eligibility` | Paginated eligibility list |
| GET | `/eligibility/by-member/:memberId` | Lookup by insurance member ID |
| GET | `/eligibility/:pid` | All eligibility for one patient |
| PUT | `/eligibility/:id` | Update status / verified date |
| POST | `/claims` | Create claim |
| GET | `/claims/summary` | Paginated claims with filters |
| GET | `/claims/:pid` | Claims for one patient |
| PUT | `/claims/:id` | Update claim (COALESCE — only provided fields change) |
| POST | `/auths` | Create authorization |
| GET | `/auths` | Paginated authorizations |
| GET | `/auths/:pid` | Authorizations for one patient |
| PUT | `/auths/:id` | Update authorization |
| GET | `/payer-summary` | Payer breakdown aggregated from eligibility (cached 60s) |
| GET | `/dashboard` | MSO aggregate stats (cached 60s) |

---

### `/api/pharmacy`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/requests` | Admin queue of outbound pharmacy requests |
| GET | `/refills/due` | Patients with refills due in next N days |
| GET | `/dashboard` | Summary stats (cached 60s) |
| POST | `/request` | Send a refill/transfer/override request to pharmacy |
| PUT | `/request/:id` | Update request status |
| GET | `/:pid` | Patient's pharmacy records |
| GET | `/:pid/requests` | Patient's request history |

When a pharmacy request is created, an SSE `pharmacy-request` event is broadcast immediately to all connected clients, including the medication name and patient ID.

---

### `/api/pcp`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/providers` | Distinct providers with patient count |
| GET | `/panel/stats?npi=` | Panel summary for a physician |
| GET | `/panel?npi=` | Paginated patient list for NPI |
| GET | `/labs` | All lab results (paginated, filterable by flag) |
| GET | `/labs/:pid` | Labs for one patient |
| POST | `/labs` | Create lab result |
| GET | `/medications/:pid` | Active medications for one patient |
| POST | `/medications` | Create medication request |
| PUT | `/medications/:id` | Update medication status |
| GET | `/dashboard` | PCP aggregate stats (cached 60s) |
| GET | `/:pid` | Patient's PCP + labs + medications |

The panel endpoint (`/panel?npi=`) is the doctor portal's primary data feed. It returns the patient list for a specific NPI, enriched with eligibility status, critical lab count, and pending auth count.

---

### `/api/export`

All export routes return `text/csv` with an attachment header, triggerable directly from `<a href>` or `window.open()`.

| Path | Filename | Filters |
|------|----------|---------|
| `/export/patients` | `smg_patients.csv` | `q`, `language` |
| `/export/eligibility` | `smg_eligibility.csv` | `status` |
| `/export/claims` | `smg_claims.csv` | `status` |
| `/export/labs` | `smg_labs.csv` | `flag` |
| `/export/authorizations` | `smg_authorizations.csv` | `status` |
| `/export/pharmacy` | `smg_pharmacy.csv` | — |

CSV generation handles quoting: values containing commas, quotes, or newlines are wrapped in double-quotes with internal quotes doubled.

---

### `/api/upload`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Upload Excel/CSV files (multipart, `files[]`) |
| GET | `/files` | List all uploaded files with status |
| DELETE | `/:id` | Delete file + all imported records |
| GET | `/events` | SSE stream (persistent connection) |

---

### `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | Username + password → token |
| POST | `/logout` | Invalidate session token |
| GET | `/me` | Current user from token |
| GET | `/users` | All user accounts |

---

## 6. Portal Feature Detail

### Admin Portal (`bridge-admin.html`)

Desktop-only portal. Sidebar navigation with 8 sections.

**Dashboard**
- 8 stat cards: total patients, active eligibility, pending claims, pending auths, critical labs (distinct patients), refills due, total source files, last sync timestamp
- Navigation badges on sidebar items (patient count, pending claims, pending auths)
- Badges update on every `loadDashboard()` call, triggered by SSE events and manual navigation

**Upload**
- Drag-and-drop or click-to-select
- Up to 200 files, 50MB each, `.xlsx / .xls / .csv`
- File processing table with live status pills
- SSE-connected: file status updates without page refresh
- Delete button removes file record and all data imported from that file

**Patients**
- Full-text search (name, ID, phone — debounced 300ms)
- Filter chips: All / Active Eligibility / Pending Claims
- Sort by any column header (click to toggle asc/desc)
- Paginated table with eligibility status badge, claim count, pending auth count, Rx count
- **Detail drawer** (slides in from right):
  - 5 tabs: Overview, Labs, Pharmacy, Authorizations, Audit Log
  - Inline pharmacy refill request form
  - Audit log shows every write on this patient's records

**Eligibility / Claims / Authorizations / Labs / Pharmacy**
- Filter chips per page (by status, flag, etc.)
- Paginated tables with status badges
- **Export CSV button** on each page — triggers `/api/export/<resource>` download
- SSE-aware: refreshes active page on `upload-complete` event

**Portals page**
- Direct links to all five portals
- Search-by-patient feature that opens bridge-members-v2.html pre-loaded with a specific patient's data

---

### SMG Internal Portal (`bridge-smg.html`)

Mobile-first phone mockup (393×852px). Audience: SMG leadership, coordinators, physician relations.

**Tabs**
1. **Pulse** — Live stat tiles, color-coded alert feed, SSE-driven
2. **Members** — Member search, at-risk members list (live from `/api/patients`), language filters
3. **Physicians** — Provider network from `/api/pcp/providers`, churn risk signals
4. **Brokers** — Broker escalations from `/api/mso/auths?status=Pending`
5. **Payer** — Live payer breakdown (top payer banner + member count table from `/api/mso/payer-summary`), quality metrics, competitive position
6. **Intel** — Live population overview (language breakdown from `/api/patients/intel`), clinical summary (critical labs, abnormal labs, overdue refills, auth status), app performance metrics, drop-off analysis, simulation run log

All live sections refresh on `upload-complete` and `file-updated` SSE events.

---

### Broker Portal (`bridge-broker.html`)

Mobile phone mockup. Audience: external insurance brokers.

**Login screen:** Name, last name, agency, license number, tier selection (Standard / SMG ONE)

**Tabs**
1. **Referrals** — Live from `/api/mso/auths`. Status mapped: Approved → green, Denied → Delayed/red, >10 days open → Delayed, >5 days → In Review, else → Pending. Chip filters, detail overlay with live status check
2. **Members** — Filtered to broker's license via `?broker=LICENSE`. Search input with debounce. Fallback to all patients if no assigned members found
3. **Why SMG** — Performance statistics, value proposition, quarterly quotes
4. **Escalations** — Escalation form pre-filled with broker identity

---

### Doctor Portal (`bridge-doctor.html`)

Mobile phone mockup. Audience: PCP physicians.

**Login:** Name, NPI number, specialty. Panel data is scoped entirely to the provided NPI.

**Tabs**
1. **Today** — Overnight critical lab alerts (from panel stats), pending authorization nudge cards with inline Approve/Skip. Approve calls `PUT /api/mso/auths/:id` with `status: Approved`
2. **Panel** — Patient list from `/api/pcp/panel?npi=`. Search. Each patient row shows eligibility status, critical lab flag, pending auth indicator
3. **Revenue** — Real billing data from `/api/mso/claims/summary`. Shows total billed, paid, pending, average billed amount, HCC-eligible pending claims
4. **Patients** — Extended patient view with detail overlays
5. **Messages** — Message thread UI

**Language toggle:** EN / 한국어 button persists in tab bar after greeting dismissal. Applies Korean text to all `data-en` / `data-ko` elements. Tab switching re-applies language state.

---

### Member App (`bridge-members-v2.html`)

Mobile phone mockup. Audience: patients and their family caregivers. Three modes: Patient, Bridged Patient (on caregiver device), Caregiver.

**Login:** First name + member ID (patient_id or insurance member_id). Lookup tries `GET /api/patients/:id`, falls back to `GET /api/mso/eligibility/by-member/:id`.

If lookup fails: `clearPatientData()` blanks all fields so no demo data bleeds through. A "Couldn't load health data" notice appears for 5 seconds.

**Patient tabs**
1. **Home** — Greeting with first name, mood check-in (3-button emoji), active medications, upcoming visits, health score ring
2. **Meds** — Active medication cards with "Mark taken" button, refill due dates
3. **Visits** — Appointment history, upcoming appointments with date badges
4. **Plan** — Payer name, member ID, PCP name, benefits summary
5. **Messages** — Message thread

**Caregiver mode** adds a second paired phone view showing the patient's data.

---

## 7. Data Seeding (Demo)

The database ships with 10,000 synthetic patients and the following generated data:

| Table | Record Count |
|-------|-------------|
| patients | 10,000 |
| eligibility | 20,000 |
| claims | 50,086 |
| authorizations | 19,860 |
| lab_results | 69,966 |
| pharmacy_records | 25,135 |
| pcp_providers | 20,000 |
| medication_requests | 37 |

**Language distribution:** 52.6% Korean, 22.5% English, remainder Vietnamese/Chinese/Tagalog/other

**Korean names:** All 5,262 Korean-language patients have Korean script names (e.g., `남지연`, `박경준`), generated from common Korean surnames and given names.

**Broker assignment:** 150 patients (SMG-001 through SMG-150) are assigned to demo broker `CA-0123456`.

---

## 8. Demo Credentials

| Portal | Entry Point | Credential |
|--------|-------------|------------|
| Admin | `bridge-admin.html` | No login in demo mode |
| SMG Internal | `bridge-smg.html` | No login in demo mode |
| Doctor | `bridge-doctor.html` | NPI: `4455667788` (Dr. Oh, Michael) |
| Doctor | `bridge-doctor.html` | NPI: `5544332211` (Dr. Choi, Brian) |
| Broker | `bridge-broker.html` | License: `CA-0123456` |
| Member App | `bridge-members-v2.html` | Member ID: `MOL695501` (Jiyeon Nam) |
| Member App | `bridge-members-v2.html` | Member ID: `UNI105935` (Nancy Jeon) |

A floating **Demo Guide** button (bottom-right corner of the admin portal) lists all credentials with click-to-copy functionality.

---

## 9. Running Locally

```bash
# Install dependencies
npm install

# Start server (standard)
npm start

# Development mode (auto-reload on changes)
npm run dev
```

Server starts on `http://localhost:3000`. The admin portal loads at the root path. All other portals are static HTML files opened directly in the browser.

The SQLite database and uploads directory are auto-created on first boot. Default user accounts are seeded idempotently on every boot.

---

## 10. File Structure

```
SMG - Project Bridge/
├── server/
│   ├── index.js              # Express app entry point
│   ├── database.js           # Schema init + migrations
│   ├── routes/
│   │   ├── patients.js       # /api/patients
│   │   ├── mso.js            # /api/mso
│   │   ├── pharmacy.js       # /api/pharmacy
│   │   ├── pcp.js            # /api/pcp
│   │   ├── auth.js           # /api/auth
│   │   ├── export.js         # /api/export
│   │   └── upload.js         # /api/upload
│   └── utils/
│       ├── excel.js          # ETL pipeline
│       ├── watcher.js        # File system watcher + SSE broadcast
│       ├── cache.js          # In-memory TTL cache
│       ├── auth.js           # scrypt hashing + session management
│       └── audit.js          # Write-operation audit middleware
├── data/
│   └── bridge.db             # SQLite database (auto-created)
├── uploads/                  # Watched directory for Excel files
├── bridge-admin.html         # Admin portal
├── bridge-smg.html           # SMG internal portal
├── bridge-broker.html        # Broker portal
├── bridge-doctor.html        # Doctor portal
├── bridge-members-v2.html    # Member / caregiver app
└── package.json
```

---

*SMG Bridge — built for SMG MSO. All demo data is synthetic.*
