const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bridge.db'));

// Enable WAL mode for better concurrent read performance
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function initDb() {
  db.exec(`
    -- Tracks every uploaded Excel file
    CREATE TABLE IF NOT EXISTS excel_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT NOT NULL,
      filepath    TEXT NOT NULL UNIQUE,
      sheet_name  TEXT,
      row_count   INTEGER DEFAULT 0,
      status      TEXT DEFAULT 'pending',   -- pending | processing | done | error
      error_msg   TEXT,
      org_id      TEXT,                     -- org that uploaded this file
      uploaded_by TEXT,                     -- username of uploader
      uploaded_at TEXT DEFAULT (datetime('now')),
      last_synced TEXT
    );

    -- Core patient registry
    CREATE TABLE IF NOT EXISTS patients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id    TEXT UNIQUE,            -- external ID from Excel
      last_name     TEXT,
      first_name    TEXT,
      middle_name   TEXT,
      dob           TEXT,
      gender        TEXT,
      phone         TEXT,
      email         TEXT,
      address       TEXT,
      city          TEXT,
      state         TEXT,
      zip           TEXT,
      language      TEXT DEFAULT 'English',
      korean_name   TEXT,                   -- Korean script name for Korean-language patients
      org_id        TEXT,                   -- tenant/organization ID (Clerk org ID or broker ID)
      source_file   TEXT,                   -- which Excel file this came from
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- MSO Eligibility data
    CREATE TABLE IF NOT EXISTS eligibility (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id      TEXT REFERENCES patients(patient_id),
      payer_name      TEXT,
      plan_name       TEXT,
      member_id       TEXT,
      group_number    TEXT,
      effective_date  TEXT,
      term_date       TEXT,
      status          TEXT DEFAULT 'Active',   -- Active | Inactive | Pending | Termed
      plan_type       TEXT,                    -- HMO | PPO | Medicare Advantage | Medicaid
      copay           TEXT,
      deductible      TEXT,
      verified_date   TEXT,
      source_file     TEXT,
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- Claims status
    CREATE TABLE IF NOT EXISTS claims (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      claim_number     TEXT,
      dos              TEXT,                   -- date of service
      cpt_code         TEXT,
      icd_codes        TEXT,                   -- comma-separated
      provider_name    TEXT,
      provider_npi     TEXT,
      billed_amount    REAL,
      allowed_amount   REAL,
      paid_amount      REAL,
      patient_resp     REAL,
      status           TEXT DEFAULT 'Pending', -- Pending | Approved | Denied | Paid | Appeal
      denial_reason    TEXT,
      submission_date  TEXT,
      paid_date        TEXT,
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- Authorization / Prior Auth
    CREATE TABLE IF NOT EXISTS authorizations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      auth_number      TEXT,
      auth_type        TEXT,                   -- Referral | Prior Auth | Procedure
      service_type     TEXT,
      referring_provider TEXT,
      rendering_provider TEXT,
      requested_date   TEXT,
      approved_date    TEXT,
      start_date       TEXT,
      end_date         TEXT,
      approved_units   INTEGER,
      used_units       INTEGER DEFAULT 0,
      status           TEXT DEFAULT 'Pending', -- Pending | Approved | Denied | Expired
      denial_reason    TEXT,
      notes            TEXT,
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- PCP / Lab results
    CREATE TABLE IF NOT EXISTS lab_results (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      test_name        TEXT,
      test_code        TEXT,
      result_value     TEXT,
      unit             TEXT,
      reference_range  TEXT,
      flag             TEXT,                   -- Normal | High | Low | Critical
      ordered_by       TEXT,
      ordering_npi     TEXT,
      collection_date  TEXT,
      result_date      TEXT,
      lab_name         TEXT,
      status           TEXT DEFAULT 'Final',   -- Pending | Preliminary | Final | Corrected
      notes            TEXT,
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- PCP Medication requests (e-prescriptions, renewals)
    CREATE TABLE IF NOT EXISTS medication_requests (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      medication_name  TEXT,
      ndc_code         TEXT,
      dosage           TEXT,
      frequency        TEXT,
      quantity         INTEGER,
      days_supply      INTEGER,
      prescriber_name  TEXT,
      prescriber_npi   TEXT,
      prescribed_date  TEXT,
      status           TEXT DEFAULT 'Active',  -- Active | Discontinued | Pending | Denied
      notes            TEXT,
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- Pharmacy records (dispensed medications + refill tracking)
    CREATE TABLE IF NOT EXISTS pharmacy_records (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      medication_name  TEXT,
      ndc_code         TEXT,
      dosage           TEXT,
      quantity         INTEGER,
      days_supply      INTEGER,
      pharmacy_name    TEXT,
      pharmacy_phone   TEXT,
      pharmacy_address TEXT,
      fill_date        TEXT,
      refill_due_date  TEXT,
      refills_remaining INTEGER DEFAULT 0,
      status           TEXT DEFAULT 'Active',  -- Active | Expired | Discontinued
      last_fill_status TEXT,                   -- Filled | Partial | On-Hold | Transferred
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- Pharmacy injection requests (outbound requests sent to pharmacy)
    CREATE TABLE IF NOT EXISTS pharmacy_requests (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      pharmacy_record_id INTEGER REFERENCES pharmacy_records(id),
      request_type     TEXT,                   -- Refill | Transfer | Prior Auth | Override
      medication_name  TEXT,
      pharmacy_name    TEXT,
      requested_by     TEXT,
      requested_at     TEXT DEFAULT (datetime('now')),
      status           TEXT DEFAULT 'Sent',    -- Sent | Processing | Completed | Failed
      response_msg     TEXT,
      completed_at     TEXT
    );

    -- PCP providers associated with patients
    CREATE TABLE IF NOT EXISTS pcp_providers (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      provider_name    TEXT,
      provider_npi     TEXT,
      specialty        TEXT,
      practice_name    TEXT,
      practice_phone   TEXT,
      practice_address TEXT,
      assigned_date    TEXT,
      status           TEXT DEFAULT 'Active',
      source_file      TEXT,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for fast lookups by patient
    CREATE INDEX IF NOT EXISTS idx_patients_pid      ON patients(patient_id);
    CREATE INDEX IF NOT EXISTS idx_eligibility_pid   ON eligibility(patient_id);
    CREATE INDEX IF NOT EXISTS idx_claims_pid        ON claims(patient_id);
    CREATE INDEX IF NOT EXISTS idx_auths_pid         ON authorizations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_labs_pid          ON lab_results(patient_id);
    CREATE INDEX IF NOT EXISTS idx_medrx_pid         ON medication_requests(patient_id);
    CREATE INDEX IF NOT EXISTS idx_pharmacy_pid      ON pharmacy_records(patient_id);

    -- Auth: user accounts per portal
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT,
      role          TEXT,           -- physician | coordinator | operations | physrel | leadership | product | broker | admin
      portal        TEXT,           -- doctor | smg | broker | admin
      org_id        TEXT,           -- Clerk/Auth0 organization ID (tenant scoping)
      external_id   TEXT,           -- Clerk/Auth0 user ID (set on first SSO login)
      npi           TEXT,           -- NPI number (physician accounts only)
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Auth: active sessions
    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      expires_at  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- Audit trail: every write operation on patient data
    CREATE TABLE IF NOT EXISTS audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT,
      action       TEXT,            -- CREATE | UPDATE | DELETE
      table_name   TEXT,
      record_id    TEXT,
      changes_json TEXT,
      ip_address   TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name, created_at);

    -- Indexes for filter/search queries (previously full table scans)
    CREATE INDEX IF NOT EXISTS idx_eligibility_member ON eligibility(member_id);
    CREATE INDEX IF NOT EXISTS idx_pcp_npi            ON pcp_providers(provider_npi);
    CREATE INDEX IF NOT EXISTS idx_labs_flag          ON lab_results(flag);
    CREATE INDEX IF NOT EXISTS idx_pharmacy_refill    ON pharmacy_records(refill_due_date, status);
    CREATE INDEX IF NOT EXISTS idx_claims_status      ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_auths_status       ON authorizations(status);
    CREATE INDEX IF NOT EXISTS idx_patients_name      ON patients(last_name, first_name);
  `);

  // Migrations: add columns that may not exist in older DB files
  const migrations = [
    // v1 → v2
    "ALTER TABLE patients ADD COLUMN assigned_broker TEXT",
    // v2 → v3: multi-tenancy + provider auth
    "ALTER TABLE patients    ADD COLUMN org_id       TEXT",
    "ALTER TABLE excel_files ADD COLUMN org_id       TEXT",
    "ALTER TABLE excel_files ADD COLUMN uploaded_by  TEXT",
    "ALTER TABLE users       ADD COLUMN org_id       TEXT",
    "ALTER TABLE users       ADD COLUMN external_id  TEXT",
    "ALTER TABLE users       ADD COLUMN npi          TEXT",
    "ALTER TABLE audit_log   ADD COLUMN user_id      TEXT",
    // v3 → v4: performance indexes
    "CREATE INDEX IF NOT EXISTS idx_patients_org      ON patients(org_id)",
    "CREATE INDEX IF NOT EXISTS idx_elig_pid_updated  ON eligibility(patient_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_auths_pid_status  ON authorizations(patient_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_claims_pid_status ON claims(patient_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_pharmacy_pid_due  ON pharmacy_records(patient_id, refill_due_date)",
    "CREATE INDEX IF NOT EXISTS idx_users_external    ON users(external_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_org         ON users(org_id)",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) {} // ignore "duplicate column" / "already exists" errors
  }

  console.log('[DB] Schema initialized');
}

module.exports = { db, initDb };

// Re-export seedUsers lazily to avoid circular dependency (auth.js imports db)
function getSeedUsers() { return require('./utils/auth').seedUsers; }
module.exports.seedUsers = () => getSeedUsers()();
