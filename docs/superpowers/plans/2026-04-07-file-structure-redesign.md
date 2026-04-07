# File Structure Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the project root into `client/`, `testing/`, `dummy-data/`, and `docs/` directories, update all references, and add a `npm run seed` script for DB initialization from dummy data.

**Architecture:** Pure file moves + targeted reference updates. No new dependencies. The seed script reuses the existing `processExcelFile` function from `server/utils/excel.js` and `initDb` from `server/database.js`. The server gains a second `express.static` path for `client/`.

**Tech Stack:** Node.js (Express, node:sqlite), existing `xlsx` npm package, Python 3 (testing scripts — no changes to logic).

---

## File Map

| Action | Path |
|--------|------|
| Modify | `.gitignore` |
| Create dir + move 8 files | `client/bridge-*.html` |
| Modify | `server/index.js` |
| Create dir + move 4 files + 1 dir | `testing/` |
| Modify | `testing/rlm-testing-agent-patient.py` |
| Create dir + move 12 files | `dummy-data/*.xlsx` |
| Create dir + move 2 files | `docs/SMG_BRIDGE_DOCUMENTATION.md`, `docs/testing-objectives-senior-patients.md` |
| Delete | `"terminal saved output (1105-317).txt"` |
| Create | `server/seed.js` |
| Modify | `package.json` |

---

## Task 1: Fix .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Open `.gitignore` and replace its contents**

Replace the entire file with:

```
node_modules/
.env
.env.local
dist/
build/
.next/
*.log
.DS_Store
__pycache__/
*.pyc
uploads/
data/
testing/rlm_results/
*.xlsx
*.pdf
*.png
!dummy-data/*.xlsx
```

Changes from current:
- Removed duplicate `node_modules/` line
- Added `testing/rlm_results/` (output dir after scripts move)
- Added `!dummy-data/*.xlsx` exception so seed files are tracked

- [ ] **Step 2: Verify git sees the change**

```bash
git diff .gitignore
```

Expected: shows removal of one `node_modules/` line and addition of `testing/rlm_results/` and `!dummy-data/*.xlsx`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: fix .gitignore — remove duplicate, add dummy-data exception"
```

---

## Task 2: Move HTML files to `client/` and update server

**Files:**
- Create dir: `client/`
- Move: all `bridge-*.html` files from root → `client/`
- Modify: `server/index.js` (lines 20 and 44)

- [ ] **Step 1: Create `client/` and move all HTML files**

```bash
mkdir client
mv bridge-admin.html bridge-broker.html bridge-caregiver.html bridge-doctor.html \
   bridge-members.html bridge-members-v2.html bridge-patient.html bridge-smg.html \
   client/
```

- [ ] **Step 2: Verify the move**

```bash
ls client/
```

Expected output:
```
bridge-admin.html   bridge-caregiver.html  bridge-members-v2.html  bridge-smg.html
bridge-broker.html  bridge-doctor.html     bridge-members.html     bridge-patient.html
```

- [ ] **Step 3: Update `server/index.js` — add `client/` static path and fix catch-all**

Find this block in `server/index.js` (around line 19–20):
```js
// ── Serve static files (existing HTML views + assets)
app.use(express.static(path.join(__dirname, '..')));
```

Replace with:
```js
// ── Serve static files
app.use(express.static(path.join(__dirname, '..', 'client')));  // portal HTML files
app.use(express.static(path.join(__dirname, '..')));             // root assets (logo, etc.)
```

Then find the catch-all (around line 43–45):
```js
// ── Catch-all: serve admin portal for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'bridge-admin.html'));
});
```

Replace with:
```js
// ── Catch-all: serve admin portal for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'bridge-admin.html'));
});
```

- [ ] **Step 4: Smoke-test the server**

```bash
node --experimental-sqlite server/index.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/bridge-admin.html
```

Expected: `200`

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health
```

Expected: `200`

Then kill the background server:
```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add client/ server/index.js
git commit -m "refactor: move HTML portals to client/ and update static serving"
```

---

## Task 3: Move Python scripts and rlm_results to `testing/`

**Files:**
- Create dir: `testing/`
- Move: `100-testing-agents-(seniors-patients).py`, `rlm-testing-agent-patient.py`, `run-100-reviews.py`, `stress-test-upload.py`, `rlm_results/`
- Modify: `testing/rlm-testing-agent-patient.py` (line 57)

- [ ] **Step 1: Create `testing/` and move files**

```bash
mkdir testing
mv "100-testing-agents-(seniors-patients).py" \
   rlm-testing-agent-patient.py \
   run-100-reviews.py \
   stress-test-upload.py \
   rlm_results \
   testing/
```

- [ ] **Step 2: Verify the move**

```bash
ls testing/
```

Expected:
```
100-testing-agents-(seniors-patients).py  rlm_results/
rlm-testing-agent-patient.py              run-100-reviews.py
stress-test-upload.py
```

- [ ] **Step 3: Fix `results_dir` in `testing/rlm-testing-agent-patient.py`**

Find this block (around line 54–59):
```python
CONFIG = {
    "model": "claude-opus-4-6",
    "max_tokens": 1500,
    "results_dir": "rlm_results",
    "use_api": False,
}
```

Replace with:
```python
CONFIG = {
    "model": "claude-opus-4-6",
    "max_tokens": 1500,
    "results_dir": str(Path(__file__).parent / "rlm_results"),
    "use_api": False,
}
```

`Path` is already imported at the top of the file (line 32: `from pathlib import Path`), so no new import needed.

- [ ] **Step 4: Verify the script parses without error**

```bash
cd testing && python3 -c "import ast; ast.parse(open('rlm-testing-agent-patient.py').read()); print('OK')"
cd ..
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add testing/
git commit -m "refactor: move testing scripts to testing/ and fix results_dir path"
```

---

## Task 4: Move dummy data to `dummy-data/` (tracked in git)

**Files:**
- Create dir: `dummy-data/`
- Move: all `*.xlsx` files from root → `dummy-data/`

- [ ] **Step 1: Create `dummy-data/` and move xlsx files**

```bash
mkdir dummy-data
mv sample-patients-demo.xlsx \
   smg-300-dummy-patients.xlsx \
   smg-batch-01-patients-0301-1300.xlsx \
   smg-batch-02-patients-1301-2300.xlsx \
   smg-batch-03-patients-2301-3300.xlsx \
   smg-batch-04-patients-3301-4300.xlsx \
   smg-batch-05-patients-4301-5300.xlsx \
   smg-batch-06-patients-5301-6300.xlsx \
   smg-batch-07-patients-6301-7300.xlsx \
   smg-batch-08-patients-7301-8300.xlsx \
   smg-batch-09-patients-8301-9300.xlsx \
   smg-batch-10-patients-9301-10000.xlsx \
   dummy-data/
```

- [ ] **Step 2: Verify git tracks the files (not ignored)**

```bash
git status dummy-data/
```

Expected: files listed under "Changes to be committed" or "Untracked files" — NOT under "Ignored files". If they're ignored, the `.gitignore` `!dummy-data/*.xlsx` exception from Task 1 was not applied correctly.

- [ ] **Step 3: Commit**

```bash
git add dummy-data/
git commit -m "chore: move dummy patient data to dummy-data/ (tracked in git)"
```

---

## Task 5: Move docs and delete ephemeral file

**Files:**
- Move: `SMG_BRIDGE_DOCUMENTATION.md` → `docs/`
- Move: `testing-objectives-senior-patients.md` → `docs/`
- Delete: `"terminal saved output (1105-317).txt"`

- [ ] **Step 1: Move documentation files to `docs/`**

```bash
mv SMG_BRIDGE_DOCUMENTATION.md testing-objectives-senior-patients.md docs/
```

- [ ] **Step 2: Delete the ephemeral terminal output file**

```bash
rm "terminal saved output (1105-317).txt"
```

- [ ] **Step 3: Verify root is clean**

```bash
ls *.md *.txt 2>/dev/null
```

Expected: no output (no loose markdown or text files at root).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move docs to docs/ and delete ephemeral terminal output file"
```

---

## Task 6: Create `server/seed.js` and add `npm run seed`

**Files:**
- Create: `server/seed.js`
- Modify: `package.json`

- [ ] **Step 1: Create `server/seed.js`**

Create the file with this exact content:

```js
/**
 * seed.js — Load all dummy-data/*.xlsx files into data/bridge.db
 *
 * Usage: node --experimental-sqlite server/seed.js
 * npm:   npm run seed
 *
 * Idempotent: existing patients are updated, not duplicated.
 * Run from the project root.
 */

const path = require('path');
const fs   = require('fs');
const { initDb, seedUsers } = require('./database');
const { processExcelFile }  = require('./utils/excel');
const { db } = require('./database');

const DUMMY_DATA_DIR = path.join(__dirname, '..', 'dummy-data');

function registerFile(filepath) {
  const filename = path.basename(filepath);
  // Insert if not already registered; ignore if already exists
  db.prepare(`
    INSERT OR IGNORE INTO excel_files (filename, filepath, status, uploaded_by)
    VALUES (?, ?, 'pending', 'seed')
  `).run(filename, filepath);
  return db.prepare('SELECT id FROM excel_files WHERE filepath = ?').get(filepath).id;
}

function main() {
  // Boot DB schema + default users
  initDb();
  seedUsers();

  const files = fs.readdirSync(DUMMY_DATA_DIR)
    .filter(f => f.endsWith('.xlsx'))
    .map(f => path.join(DUMMY_DATA_DIR, f))
    .sort();

  if (files.length === 0) {
    console.log('[SEED] No .xlsx files found in dummy-data/');
    return;
  }

  console.log(`[SEED] Found ${files.length} files — seeding...`);

  let totalRows = 0;
  for (const filepath of files) {
    const fileId = registerFile(filepath);
    const result = processExcelFile(filepath, fileId, null);
    if (result.success) {
      totalRows += result.rows;
      console.log(`[SEED] ✓ ${path.basename(filepath)} — ${result.rows} rows`);
    } else {
      console.error(`[SEED] ✗ ${path.basename(filepath)} — ${result.error}`);
    }
  }

  const patientCount = db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
  console.log(`\n[SEED] Done. ${totalRows} rows processed. DB now has ${patientCount} patients.`);
}

main();
```

- [ ] **Step 2: Add `seed` script to `package.json`**

Find this block in `package.json`:
```json
"scripts": {
    "start": "node --experimental-sqlite server/index.js",
    "dev": "nodemon --exec 'node --experimental-sqlite' server/index.js"
  },
```

Replace with:
```json
"scripts": {
    "start": "node --experimental-sqlite server/index.js",
    "dev":   "nodemon --exec 'node --experimental-sqlite' server/index.js",
    "seed":  "node --experimental-sqlite server/seed.js"
  },
```

- [ ] **Step 3: Run the seed script and verify output**

```bash
npm run seed
```

Expected output (abridged):
```
[DB] Schema initialized
[AUTH] Seeded default users
[SEED] Found 12 files — seeding...
[SEED] ✓ sample-patients-demo.xlsx — N rows
[SEED] ✓ smg-300-dummy-patients.xlsx — N rows
...
[SEED] Done. NNNN rows processed. DB now has NNNN patients.
```

If you see `[SEED] ✗ <file> — <error>`, the xlsx file may be malformed or use unexpected column headers. Non-fatal — other files continue.

- [ ] **Step 4: Verify idempotency — run seed a second time**

```bash
npm run seed
```

Expected: same patient count in the final line as the first run. Rows are updated, not duplicated.

- [ ] **Step 5: Commit**

```bash
git add server/seed.js package.json
git commit -m "feat: add server/seed.js and npm run seed for DB initialization from dummy-data"
```

---

## Task 7: Final verification

- [ ] **Step 1: Check root directory is clean**

```bash
ls -1
```

Expected root contents:
```
client/
data/
docs/
dummy-data/
node_modules/
package-lock.json
package.json
server/
smg.logo.transparent.v1.png
testing/
uploads/
```

No loose `.html`, `.py`, `.xlsx`, `.txt`, or `.md` files at root.

- [ ] **Step 2: Verify server still starts and serves HTML**

```bash
node --experimental-sqlite server/index.js &
sleep 2
curl -s -o /dev/null -w "admin: %{http_code}\n" http://localhost:3000/bridge-admin.html
curl -s -o /dev/null -w "patient: %{http_code}\n" http://localhost:3000/bridge-patient.html
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:3000/api/health
kill %1
```

Expected:
```
admin: 200
patient: 200
health: 200
```

- [ ] **Step 3: Verify dummy-data is tracked in git**

```bash
git ls-files dummy-data/ | head -5
```

Expected: lists `dummy-data/sample-patients-demo.xlsx` and other files (not empty).

- [ ] **Step 4: Final commit if any loose changes remain**

```bash
git status
```

If clean: done. If there are unstaged changes (e.g., from smoke-test artifacts), stage and commit them:

```bash
git add -A
git commit -m "chore: final cleanup after file structure reorganization"
```
