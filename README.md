# SMG Bridge

Healthcare data operations platform for **SMG MSO (AMM)** — unifies siloed patient data from eligibility files, PCP offices, and pharmacies into a single, role-scoped hub. Four purpose-built surfaces (Admin, Clinical, Patient, Caregiver) sit behind a common portal hub and staff sign-in, with supporting legacy portals for brokers and SMG operations.

**Demo anchor date:** Friday, April 24, 2026. All calendars, headers, schedules, recent activity, claims, auths, labs, Rx last-fill dates, and upcoming visits read as if the app were running on that date.

---

## Overview

SMG Bridge solves a core problem in managed care: patient data lives in three separate silos (insurance eligibility files, PCP office systems, pharmacy records) and no one stakeholder has a unified view. Bridge imports, reconciles, and surfaces that data through purpose-built portals for each role.

**Two design directions, one platform:**

| Direction | Surfaces | Type system | Palette |
|---|---|---|---|
| **A · Clinical Calm** | Admin Portal, Clinical Portal, Sign-In | IBM Plex Sans / Serif / Mono | Paper `#F6F5F0`, navy `#1B3E7A` |
| **B · Warm Human** | Patient App, Caregiver App | Pretendard + Fraunces | Warm paper `#FAF6EF`, emerald `#1C5430` |

**Key capabilities:**
- **Portal Hub** (`/`) — landing page with 4 cards; each click clears any stale session and crossfades into the target surface
- **Staff sign-in SPA** — 7-screen flow (picker → form → MFA → SSO handoff → returning → locked → request-access); gates both admin and clinical portals; writes signed-in identity into `localStorage` so the name/email/role persist into the portal chrome
- **Bulk Excel/CSV import** with automatic ETL and idempotent upserts
- **Real-time progress** updates via Server-Sent Events
- **Multi-tenant scoping** — brokers see only their org, physicians see only their panel
- **Full-system audit trail** on every write operation, plus a per-user audit modal in the clinical portal
- **CSV exports** for all data types
- **Prior auth, claims, lab result, and pharmacy refill tracking** with working filter chips and search on every data page
- **Appointment calendar** — 2-panel month view connecting confirmed appointments with pending requests; fully navigable (Prev / Today / Next / Month toggle); doctors and admins can confirm, reschedule, or cancel inline; backed by server-side SQLite
- **Server-persisted caregiver consent requests** — patients submit from the mobile app; doctors and admins approve or decline from their portals; changes reflect immediately across all sessions
- **Care Gaps tab** in the doctor patient drawer — auto-computed per patient from pending/denied authorizations, critical/elevated labs, annual wellness visit history, and expired authorizations
- **Patient & caregiver phone apps** — separate 393×852 iPhone-frame SPAs with their own phone-number OTP sign-in flow; bilingual (patient supports EN/KO; caregiver EN/KO)

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

The Portal Hub opens — pick Admin, Clinical, Patient, or Caregiver.

**To stop the server:** Press `Ctrl + C` in the Terminal window.

---

### Portal URLs

| Surface | URL | Auth |
|---|---|---|
| **Portal Hub** (landing) | http://localhost:3000 | None |
| **Staff Sign-In** | http://localhost:3000/bridge-signin.html | — |
| Admin Portal | http://localhost:3000/bridge-admin.html | Requires `smg-staff-authed === 'admin'` |
| Clinical Portal | http://localhost:3000/bridge-doctor.html | Requires `smg-staff-authed === 'clinical'` |
| Patient App | http://localhost:3000/bridge-patient.html | Phone OTP (demo: any digits) |
| Caregiver App | http://localhost:3000/bridge-caregiver.html | Invite code + OTP |
| Legacy member lookup | http://localhost:3000/bridge-members-v2.html | Public (SMG Member ID) |

**Staff sign-in demo credentials** (used by the hub → sign-in → admin/clinical flow):

- Email: anything ending in `@amm.cc` (admin) or `@smgmedical.net` (clinical). The display name on top of the portal is derived from the local part — `jordan.smith@amm.cc` → `Jordan Smith`.
- Password: `demo` (instant success), any password ≥8 chars (success), `locked` (goes straight to the locked-out screen), any <8 chars (increments failed attempts, locks after 5).
- MFA code: any 6 digits *except* `000000` (which rejects and clears).

**Doctor login sample NPIs** (for the legacy per-doctor portal data, still used for data scoping): `4455667788` · `5544332211` · `0987654321`

**Patient/Caregiver phone-app demo:** the sign-in is decorative — tap through welcome → phone → OTP → Face ID. The apps don't currently link to a specific member ID; they render the same sample family (Susan Park / 박수잔).

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

## Surfaces

Each surface is a self-contained static HTML file served from `/client/`.

**Primary surfaces** (linked from the hub):

| Surface | File | Role(s) | Auth gate |
|---|---|---|---|
| Portal Hub | `index.html` | All users | None — landing page |
| Staff Sign-In | `bridge-signin.html` | Staff | — |
| Admin Portal | `bridge-admin.html` | `admin` | Redirects to sign-in unless `smg-staff-authed === 'admin'` |
| Clinical Portal | `bridge-doctor.html` | `physician` | Redirects to sign-in unless `smg-staff-authed === 'clinical'` |
| Patient App | `bridge-patient.html` | `patient` | Phone OTP (localStorage `smg-authed`) |
| Caregiver App | `bridge-caregiver.html` | `caregiver` | Invite code + OTP (localStorage `smg-cg-authed`) |

**Legacy / internal surfaces** (still served, not surfaced from the hub):

| Surface | File | Purpose |
|---|---|---|
| SMG Internal | `bridge-smg.html` | Coordinator / ops / leadership view |
| Broker | `bridge-broker.html` | Org-scoped broker dashboard |
| Member lookup v2 | `bridge-members-v2.html` | Public SMG-ID lookup (submits appointment & consent requests to server) |
| Member lookup v1 | `bridge-members.html` | Older patient lookup prototype |

The server routes unknown paths to `bridge-admin.html` as the catch-all.

### Navigation flow

```
      http://localhost:3000/
              ↓
         ┌─ Portal Hub (index.html) ─┐
         ↓                            ↓
    Staff card                Patient/Caregiver card
         ↓                            ↓
   bridge-signin.html          bridge-patient.html
   (picker → form → MFA        bridge-caregiver.html
    → biometric)               (direct to phone sign-in)
         ↓
   bridge-admin.html
   bridge-doctor.html
```

Every hub card click clears the relevant `localStorage` keys and crossfades into the next page, so demos always start clean.

---

## Staff Sign-In

`bridge-signin.html` implements the full staff sign-in contract (see `../SMG Bridge Portal Sign-In.html` spec) as a single-file SPA with 7 screens.

| # | Screen | Path | Purpose |
|---|---|---|---|
| 1 | **Portal Picker** | `/bridge-signin.html` | Admin vs Clinical card picker + patient/caregiver nudge to App/Play store |
| 2 | **Sign-In Form** | `?portal=admin` / `?portal=clinical` | "Continue with AMM Email" / "Continue with SMGMedical Email" SSO button, then email + password fallback; shows errors + attempt countdown; Shared-device toggle |
| 3 | **MFA** | `?screen=mfa&portal=…` | 6-digit authenticator code with auto-advance, paste-to-fill, Backspace-back, 30-second resend countdown |
| 4 | **SSO Handoff** | `?screen=sso&portal=…` | Brief "Redirecting to AMM/SMGMedical Email…" interstitial with animated dots and OIDC caption |
| 5 | **Returning User** | `?screen=welcome&portal=…` | Time-of-day greeting, identity card, "Unlock with Touch ID" (gated on `navigator.credentials`), inactivity callout |
| 6 | **Locked** | `?screen=locked&portal=…` | Lockout screen with incident card (incident ID, times, IP), IdP-reset + tel:IT CTAs, suspicious-activity report |
| 7 | **Request Access** | `?screen=request&portal=…` | New-staff request form — admin has role chips (Operations / Eligibility / Claims / Billing / Compliance); clinical has NPI field + specialty chips |

On success, the sign-in writes:

```
smg-staff-authed = 'admin' | 'clinical'
smg-staff-email  = <typed email>
smg-staff-name   = <derived from local part — e.g., jin.kim@amm.cc → Jin Kim>
smg-staff-role   = Ops · Admin | PCP · SMG Koreatown
```

These values are read on every portal load by `applySessionIdentity()`, which updates the top-bar name/role/avatar, the user-menu popover card, and (admin only) the sidebar footer block — so the identity the user typed at sign-in persists consistently into the portal chrome.

**Layout** — 1440×900 artboard split 624px brand pane (paper-deep, 48px grid lines, 56pt Fraunces headline, italic subtitle, meta strip with Version / Deployed / Status) + form shell (max-width 440/460/500px depending on screen, with top-bar host/help/English pill and mono legal footer).

---

## Admin Portal

`bridge-admin.html` is the full-access operations hub for the SMG team.

**Top bar** (clickable, with popovers):

- **Workspace switcher** ("SMG MSO · Los Angeles ▾") — popover lets you switch to Orange County / San Diego
- **Search** ("⌘K") — global cmdk palette over patients, claims, auths, Rx
- **Environment pill** (`PROD`) — static chip
- **Notifications bell** — popover with 5 sample items (upload finished, lab intake error, caregiver consent pending, monthly adherence report, prior auth approved); "Mark all read" clears the unread dot; clicking an item jumps to its home page
- **User avatar** (Jin Kim → live-synced from sign-in) — popover with Profile & preferences (→ Settings), My audit log (→ Audit page), Switch portal…, Help & support (→ modal), Sign out (red)

**Sidebar sections:**

| Section | Pages |
|---|---|
| Data | Upload Files, Patient Registry, Eligibility, Claims, Authorizations |
| Clinical | Lab Results, Pharmacy |
| Patient Portal | Today's Schedule, **Appointment Calendar**, Caregiver Consents |
| Member Portals | Bridge v2 (patient app launcher) |

The **sidebar footer** (avatar + name + role) also opens the same user popover — one source of truth for account actions.

### Filter Chips + Search

Every `.filter-bar` on every data page auto-wires on page render via `wireFilterChips()`. Chips are grouped automatically by the vertical spacers between them; clicking a chip makes it the sole active chip in its group, and active chips contribute case-insensitive substring queries AND'd across groups. The search input in the same bar ANDs with chip filters. Parenthetical counts ("Active (9,712)") and prefixes like `Plan:` / `PCP:` / `Segment:` are stripped before matching.

**Live on:** Patient Registry (Active/Pending/Termed + Plan + PCP + Flagged), Eligibility, Claims (Paid/Pending/Denied/Appealed + Provider), Authorizations (Pending/Approved/Denied/Draft), Lab Results (Critical / HbA1c / Lipid / BMP-CMP), Meds (Overdue/Due/Refilled + Drug class), Schedule (Provider + Clinic), Caregiver Consents (status + scope), plus every panel/care-gap/labs/referrals filter in the Clinical portal.

### Appointment Calendar

Week-grid view with functional navigation:

- **Prev / Next** — shift `CAL_STATE.weekOffset` by ±1 week, title and grid update ("April 27 — May 1, 2026", "April 13 — April 17, 2026", etc.)
- **Today** — resets to offset 0 (the current anchor week, April 20 — 24, 2026), highlighted as primary
- **Month** — toggles a real 7×N month grid with per-day appointment counts; today highlighted with navy border + accent fill; click any day to zoom back into its week
- **+ New appointment** — opens modal

Each appointment tile now carries its own MRN (`SMG-00412`, `SMG-00587`, etc.) so clicking Yoon vs Park vs Lee opens the right patient chart. Previously all tiles hardcoded `SMG-00587`.

Appointment requests are still stored server-side in the `appointment_requests` table. Patients submit requests from the mobile app via `POST /api/patient-portal/appointments`; admin and doctor portals confirm/reschedule/cancel via `PUT /api/appointments/:id`. localStorage acts as a client-side cache synced from the server — all portals share the same live data regardless of device or browser.

### Caregiver Consents

Patients grant caregivers access from the mobile app consent flow. Consent requests land in the `caregiver_consents` table (`POST /api/patient-portal/consents`) and appear in both the admin and doctor portals for review. Approve or decline inline; the patient app polls for the decision and unlocks the caregiver account when approved. Permissions are granular: appointments, medications, and lab results can be toggled independently. Visit notes and benefits details are never accessible to caregivers regardless of consent state.

---

## Clinical Portal

`bridge-doctor.html` is an NPI-scoped clinical portal. Enter via the hub → sign-in → Clinical card. Signed-in identity derives from the entered email (e.g. `sarah.park@smgmedical.net` → Dr. Sarah Park).

**Top bar:**

- **Next patient** chip (`Next · 8 min · Kim, Soonja`) — click to jump to that chart
- **? help icon** — opens the shortcut cheatsheet
- **Notifications bell** popover — 5 clinical items (new lab result, caregiver message, care gap alert, prior auth approved, schedule confirmed); items jump to Labs / Messages / Gaps / Auths / Home
- **User avatar** (Dr. Sarah Park → derived from sign-in email) — popover with Profile & preferences (→ Preferences page with Profile card + NPI + clinical defaults + MFA), **My audit log** (→ modal showing time · READ/WRITE/AUTH badge · action · patient · IP for the last 8 actions, with 7-year HIPAA retention note), Switch portal…, Help & support (→ modal with Clinical IT line, live chat, 5 clinical FAQs, shortcut cheat), Sign out

**Sidebar sections:**

| Section | Pages |
|---|---|
| Data Management | Patient List, Eligibility, Claims |
| MSO Operations | Authorizations, Pharmacy, Medications |
| Clinical | Lab Results, Today's Schedule |
| Patient Portal | **Appointment Calendar**, Caregiver Consents, Launch Bridge App |

All data queries are scoped to the doctor's NPI via `pcp_providers` JOINs. Appointment and consent data is server-persisted and synced in real time — changes made in the doctor portal are immediately visible in the admin portal and patient app.

**Filter chips** — the same `wireFilterChips()` system runs on the clinical portal (panel / care gaps / labs / referrals). Escape closes both the nav popovers AND any open gap tooltip.

**Voice dictation** — the visit-note editor supports ElevenLabs Scribe STT; set your API key in Preferences.

**Drag-to-resize** — the patient chart's left and right rails can be dragged to resize; widths persist to localStorage.

### Care Gaps

The patient drawer in the doctor portal includes a **Care Gaps** tab. When a patient record is opened, the tab is auto-populated by analyzing:

- **Pending authorizations** — any auth with status `Pending` or `In Review`, with a note to follow up if >5 business days
- **Denied authorizations** — flags for appeal or alternative plan
- **Critical lab results** — flag = `Critical`, requires immediate attention
- **Elevated lab results** — flag = `High`, above reference range
- **Annual wellness visit** — checks `visit_notes` for a visit of type `Annual Wellness`; flags if missing or >12 months ago
- **Expired authorizations** — auth status `Expired`, may need re-authorization

Each gap is color-coded: red border for critical severity, amber for high. If no gaps are found, the tab shows a green confirmation message.

**Demo NPIs:**

| Doctor | NPI |
|---|---|
| Dr. Oh, Michael | `4455667788` |
| Dr. Choi, Brian | `5544332211` |
| Dr. Park, Steven | `0987654321` |

---

## Patient App

`bridge-patient.html` is a bilingual (EN/KO) iPhone-frame SPA for SMG members. 393×852 phone frame on desktop, fills the viewport on real phones. Direction B "Warm Human" — Pretendard + Fraunces, warm paper `#FAF6EF`, emerald.

**Sign-in flow** (own, separate from staff sign-in):
- Welcome role-picker — "저는 SMG 회원이에요 / I'm an SMG member" vs "부모님을 돌봐드려요 / I'm caring for a parent" (the latter redirects to `bridge-caregiver.html`)
- Phone entry — **US-only** (Korean country option was removed — all SMG patients are US-based). Placeholder `(213) 555-0100`, formatter produces `(xxx) xxx-xxxx`.
- OTP — 6-digit keypad, `000000` rejects for demo
- Face ID — opt-in with fallback

Sets `smg-authed` in localStorage; cleared by hub on demo restart.

**Home tab** — morning mood check-in (Good / OK / Down), meds shortcut, upcoming appointment with PCP name.

**My Meds tab** — full medication list from `pharmacy_records`; expandable cards with dosage, pharmacy, refills remaining; "I've taken my meds" confirmation.

**My Visit tab**
- **Action Needed** — dynamic alerts (annual wellness overdue, pending/approved auths)
- **Upcoming Visits** — confirmed request cards with date box + "Confirmed ✓" badge; next annual wellness currently set to **May 8** (pushed forward from the old March 28 anchor)
- **Awaiting Confirmation** — pending requests in amber; move to Upcoming once confirmed from the clinical portal
- **Approvals & Authorizations** — three states only: **Approved** (provider + expiration), **In Progress**, **Error** (never raw denial; directs to PCP office)
- **Transport** — tap to call PCP office or SMG

**Records tab**
- **Vitals** — BP, BMI, weight from most recent doctor-confirmed visit
- **Lab Results** — latest signed results with last-3-visit comparison, neutral contextual message. Lab cards show `APR 22` / `APR 20` as the latest dates. No Critical/High/Low flags shown to patients.
- **Prescriptions** — active meds with prescriber and refill info

> **Compliance**: After-Visit Summaries are never shown to patients or caregivers. Doctor notes contain billing/coding shorthand inappropriate for patient display (Dr. Chang's office, April 2026).

## Caregiver App

`bridge-caregiver.html` is the parallel iPhone-frame app for family caregivers. Same Warm Human direction, caregiver-specific warm-peach accents (`--cg-ok` / `--cg-watch` / `--cg-attn`).

**Sign-in flow**:
- Welcome role-picker (mirrors patient app — "SMG member" card redirects to the patient app; "caring for a parent" continues)
- Invite code — 6-character alphanumeric from Mom's phone. Input is a full-overlay transparent field; the styled slots are purely visual. (Was previously a broken 1×1 hidden input — fixed.)
- OTP
- Face ID

Sets `smg-cg-authed` in localStorage.

**Home tab** — three moods for Mom (ok / watch / attn) with status chips, mood quote card, action panel (e.g., "Call Mom now" / "Remind to take meds"), and today's activity timeline.

**Meds tab** — weekly adherence strip, AM/PM/Night medication groups with taken/missed state, refill alert (Lisinopril 3 days left with inline "Request refill" button), persistent "Remind Mom" CTA.

**Visits tab** — next upcoming visit (currently **May 8** annual wellness with Dr. Park), "I'll be there" / "Join by video" / "Mom need a ride?" quick actions, prep-for-visit flow, and past-visit list (MAR 21 A1C follow-up / FEB 12 flu shot / JAN 15 annual wellness).

**Labs tab** — A1C trend card (5-month bar chart, trending down from 7.8 → 7.2), recent result list with plain-language explanations, "Ask the doctor" prompt.

**Mom tab** — profile hero, unread messages from care team, care team contact list (Dr. Park, Nurse Lee, CVS, co-caregiver), compose-message flow.

**Caregiver data access — compliance boundaries**

Caregivers can be granted access to: appointments, medications, and lab results (with patient consent). The following are never accessible to caregivers regardless of consent:

- Insurance benefits, benefit usage counts, grocery/dental/financial allowances — exploitation risk, especially for dementia patients (~10–15% of SMG panel)
- After Visit Summaries and doctor notes
- Insurance plan details and member ID

The Mom tab shows only the patient's PCP name + practice and referral/auth status using the same Approved / In Progress / Error display as the patient app.

## Legacy member lookup (v2)

`bridge-members-v2.html` is the older web-based patient lookup that's still served at its URL. It's not surfaced from the hub but remains the endpoint used by the server's appointment- and consent-request POST flows. Patients can submit from this surface using an SMG Member ID (`SMG-XXXXXXX`) and the server persists to `appointment_requests` / `caregiver_consents` for the admin and clinical portals to consume.

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
│   │   ├── patientPortal.js      # Public patient lookup + appointment/consent submission (no auth)
│   │   ├── portalAdmin.js        # Protected CRUD for appointments and caregiver consents
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
├── client/
│   ├── index.html                # Portal Hub (landing)
│   ├── bridge-signin.html        # Staff sign-in SPA (7 screens)
│   ├── bridge-admin.html         # Admin portal (Direction A · Clinical Calm)
│   ├── bridge-doctor.html        # Clinical portal (Direction A)
│   ├── bridge-patient.html       # Patient phone app (Direction B · Warm Human)
│   ├── bridge-caregiver.html     # Caregiver phone app (Direction B)
│   ├── bridge-members-v2.html    # Legacy public member lookup
│   ├── bridge-smg.html           # SMG internal (legacy)
│   └── bridge-broker.html        # Broker (legacy)
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
| Patient Portal | `/api/patient-portal` | `GET /lookup/:id`, `POST /appointments`, `GET /appointments?patientId=`, `POST /consents`, `GET /consents/:id` — all public, no auth |
| Portal Admin | `/api/appointments`, `/api/consents` | `GET /appointments`, `PUT /appointments/:id`, `GET /consents`, `PUT /consents/:id` — protected |
| Patients | `/api/patients` | list, get (includes `visitNotes`), update, `/stats`, `/intel` |
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

### Public Patient Endpoints

All `/api/patient-portal/*` routes are public — no auth token required.

```
GET  /api/patient-portal/lookup/:id           # patient demographics, eligibility, meds, labs, auths, visit notes
POST /api/patient-portal/appointments         # patient submits appointment request
GET  /api/patient-portal/appointments?patientId=  # patient polls their request list
POST /api/patient-portal/consents             # caregiver submits consent request
GET  /api/patient-portal/consents/:id         # caregiver polls consent decision
```

`GET /lookup/:id` accepts an SMG patient ID (`SMG-XXXXXXX`) or an insurance member ID.

`POST /appointments` body: `{ patientId, patientName, preferredDate, preferredTime, reason }`

`POST /consents` body: `{ patientId, patientName, caregiverName, caregiverPhone, relationship, permsAppointments, permsMedications, permsLabResults }`

`GET /consents/:id` returns `{ id, status, permissions: { appointments, medications, labResults, visitNotes } }` — the patient app polls this until `status` changes from `pending`.

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
- **Demo date anchor**: Friday, April 24, 2026. Week-view calendar is Apr 20–24, upcoming annual wellness is May 8, recent activity is mid-April, past visits are Mar 21 / Feb 12 / Jan 15. To re-anchor, edit `/tmp/update-dates.js` (kept as a reference mapping) and re-run it over the HTMLs.
- **Page transitions**: every portal has `html { background: <paper> }` so there's no white flash during navigation, plus a `body { animation: pageIn 220ms }` fade-in. Hub cards fade out on click (`body.leaving { opacity: 0 }`) before navigating, producing a crossfade. `prefers-reduced-motion` disables all motion.
- **Staff auth gate** — `bridge-admin.html` and `bridge-doctor.html` each have a head-script that checks `localStorage.smg-staff-authed`. If the value doesn't match the portal, the gate clears any stale session and redirects to `/bridge-signin.html`. To bypass during development, add `?bypass-auth` to the URL.
- **Filter chip system** — `wireFilterChips()` in both admin and clinical auto-attaches click handlers to every `.chip` inside every `.filter-bar` after a page renders. One chip active per auto-detected group; "All …" chips match everything; search input ANDs with chip filters. Adding a new filter-bar needs zero JS — just the markup.
- **Calendar navigation** — `CAL_STATE.weekOffset` drives Prev/Today/Next; `CAL_STATE.mode` toggles between week and month grids; sample data lives only on offset 0 so other weeks render as an empty calendar.
- **Schema auto-migrates** on every server startup — `server/database.js` handles missing columns from older versions, including the `visit_notes` table
- **Drop-and-import** — drop any `.xlsx` file into `/uploads/` and Chokidar picks it up automatically
- **Appointment and consent data** — persisted server-side in `appointment_requests` and `caregiver_consents` SQLite tables. localStorage serves as a read-through cache (`syncPortalCaches()` hydrates it from the API on every calendar/consent load). All portals write through the API so data is consistent across devices and browsers.
- **SSE streams:**
  - `/api/upload/events` — real-time upload progress and completion events
  - Pharmacy route broadcasts refill request status updates
  - 25-second heartbeat keeps connections alive
- **Dashboard caching** — expensive aggregate queries are cached in memory for 30–60 seconds, scoped by `org_id` or `npi`
- **Language support** — the patient and caregiver apps are bilingual EN/KO; toggle with the EN / 한국어 button. The admin, clinical, and sign-in surfaces are English-only (staff-facing per spec).
- **Audits** — run the in-repo jsdom tests:
  - `node /tmp/audit-signin.js` — 44 sign-in flow assertions
  - `node /tmp/audit-caregiver.js` — 90 caregiver interaction assertions
  - `node /tmp/test-filter-real.js` — 18 filter-chip + calendar-nav assertions (requires `jsdom` in node_modules)

---

## Further Reading

[`docs/SMG_BRIDGE_DOCUMENTATION.md`](./docs/SMG_BRIDGE_DOCUMENTATION.md) — comprehensive technical reference covering:
- Full database schema (16 tables with indexes and constraints)
- Complete API endpoint reference with request/response shapes
- Stakeholder map and portal feature details
- Architecture diagrams and data flow
