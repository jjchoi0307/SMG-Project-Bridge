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
