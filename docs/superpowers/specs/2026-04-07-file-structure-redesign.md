# File Structure Redesign
**Date:** 2026-04-07
**Status:** Approved

## Goal
Reorganize the project root from a flat mix of HTML, Python scripts, data files, and docs into a clean directory-per-concern layout. Enable dummy patient data to be tracked in git for DB seeding.

---

## Directory Structure (target)

```
SMG - Project Bridge/
├── client/                        # All portal HTML UIs
│   ├── bridge-admin.html
│   ├── bridge-broker.html
│   ├── bridge-caregiver.html
│   ├── bridge-doctor.html
│   ├── bridge-members.html
│   ├── bridge-members-v2.html
│   ├── bridge-patient.html
│   └── bridge-smg.html
│
├── server/                        # Node.js Express backend (unchanged internally)
│   ├── index.js
│   ├── database.js
│   ├── middleware/
│   ├── routes/
│   └── utils/
│
├── testing/                       # Python simulation & stress-test scripts
│   ├── 100-testing-agents-(seniors-patients).py
│   ├── rlm-testing-agent-patient.py
│   ├── run-100-reviews.py
│   ├── stress-test-upload.py
│   └── rlm_results/               # Output directory (gitignored)
│
├── dummy-data/                    # Curated patient seed data — tracked in git
│   ├── sample-patients-demo.xlsx
│   ├── smg-300-dummy-patients.xlsx
│   ├── smg-batch-01-patients-0301-1300.xlsx
│   ├── smg-batch-02-patients-1301-2300.xlsx
│   ├── smg-batch-03-patients-2301-3300.xlsx
│   ├── smg-batch-04-patients-3301-4300.xlsx
│   ├── smg-batch-05-patients-4301-5300.xlsx
│   ├── smg-batch-06-patients-5301-6300.xlsx
│   ├── smg-batch-07-patients-6301-7300.xlsx
│   ├── smg-batch-08-patients-7301-8300.xlsx
│   ├── smg-batch-09-patients-8301-9300.xlsx
│   └── smg-batch-10-patients-9301-10000.xlsx
│
├── docs/                          # Project documentation
│   ├── SMG_BRIDGE_DOCUMENTATION.md
│   ├── testing-objectives-senior-patients.md
│   └── superpowers/specs/         # Design specs (this file lives here)
│
├── data/                          # Runtime SQLite DB — gitignored
├── uploads/                       # Runtime upload staging — gitignored
├── package.json
├── package-lock.json
├── smg.logo.transparent.v1.png
└── .gitignore
```

**Deleted:** `"terminal saved output (1105-317).txt"` — ephemeral, no value in source control.

---

## Reference Updates

### `server/index.js`
Two changes required:
1. `express.static` — add `client/` as a static path so HTML files are reachable by browser:
   ```js
   app.use(express.static(path.join(__dirname, '..', 'client')));
   app.use(express.static(path.join(__dirname, '..')));  // keep for logo + root assets
   ```
2. Catch-all route — update hardcoded HTML path:
   ```js
   // before
   res.sendFile(path.join(__dirname, '..', 'bridge-admin.html'));
   // after
   res.sendFile(path.join(__dirname, '..', 'client', 'bridge-admin.html'));
   ```

### `testing/rlm-testing-agent-patient.py`
The `results_dir` config key uses a relative path (`"rlm_results"`). After the script moves to `testing/`, it must be run from the `testing/` directory (or the path updated to `"rlm_results"` relative to `testing/`). Update the config to use `Path(__file__).parent / "rlm_results"` so it always resolves correctly regardless of CWD.

### `testing/run-100-reviews.py`
References `bridge-patient.html` in string literals (comments, report text) only — no filesystem path. No update needed.

### `testing/stress-test-upload.py`
Only references a server URL, not local file paths. No update needed.

---

## .gitignore Changes

```diff
- node_modules/      # remove duplicate
  .env
  .env.local
  dist/
  build/
  .next/
  *.log
  .DS_Store
  __pycache__/
  *.pyc
  node_modules/
  uploads/
  data/
+ testing/rlm_results/
  *.xlsx
  *.pdf
  *.png
+ !dummy-data/*.xlsx  # allow tracked seed data
```

---

## DB Seed Script

**New file:** `server/seed.js`

- Reads all `.xlsx` files from `dummy-data/` using the existing `excel.js` parser
- Inserts patients into `data/bridge.db` using the existing `initDb()` schema
- Idempotent: skips rows where `patient_id` already exists (uses `INSERT OR IGNORE`)
- Runs standalone (not imported by server): `node --experimental-sqlite server/seed.js`

**`package.json` addition:**
```json
"scripts": {
  "start": "node --experimental-sqlite server/index.js",
  "dev":   "nodemon --exec 'node --experimental-sqlite' server/index.js",
  "seed":  "node --experimental-sqlite server/seed.js"
}
```

---

## Constraints
- All existing API routes and server internals remain unchanged.
- `dummy-data/` xlsx files will be large in git — acceptable for a private/internal repo, and batching means no single file is enormous.
- The `smg.logo.transparent.v1.png` stays at root (referenced directly in HTML files by path; moving it would require updating all 6+ HTML files and is out of scope).
