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

    -- Appointment requests (from patient portal)
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id              TEXT PRIMARY KEY,
      patient_id      TEXT,
      patient_name    TEXT,
      preferred_date  TEXT,
      preferred_time  TEXT DEFAULT 'morning',
      reason          TEXT,
      status          TEXT DEFAULT 'pending',
      scheduled_time  TEXT,
      new_date        TEXT,
      submitted_at    TEXT DEFAULT (datetime('now')),
      confirmed_at    TEXT,
      rescheduled_at  TEXT,
      cancelled_at    TEXT,
      confirmed_by    TEXT
    );

    -- Caregiver consent requests (from patient portal)
    CREATE TABLE IF NOT EXISTS caregiver_consents (
      id                 TEXT PRIMARY KEY,
      patient_id         TEXT,
      patient_name       TEXT,
      caregiver_name     TEXT,
      caregiver_phone    TEXT,
      relationship       TEXT,
      perms_appointments INTEGER DEFAULT 0,
      perms_medications  INTEGER DEFAULT 0,
      perms_lab_results  INTEGER DEFAULT 0,
      status             TEXT DEFAULT 'pending',
      submitted_at       TEXT DEFAULT (datetime('now')),
      responded_at       TEXT
    );

    -- Doctor/PCP visit notes (After Visit Summaries)
    CREATE TABLE IF NOT EXISTS visit_notes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id       TEXT REFERENCES patients(patient_id),
      visit_type       TEXT DEFAULT 'Follow-up',  -- Annual Wellness | Follow-up | Sick Visit | Telehealth
      visit_date       TEXT,
      provider_name    TEXT,
      provider_npi     TEXT,
      practice_name    TEXT,
      reason_for_visit TEXT,
      discussion       TEXT,
      diagnoses        TEXT,                       -- JSON array string: ["Diagnosis 1","Diagnosis 2"]
      medications      TEXT,                       -- plain text summary
      next_steps       TEXT,                       -- JSON array string: ["Step 1","Step 2"]
      signed_at        TEXT,
      source_file      TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for fast lookups by patient
    CREATE INDEX IF NOT EXISTS idx_patients_pid      ON patients(patient_id);
    CREATE INDEX IF NOT EXISTS idx_eligibility_pid   ON eligibility(patient_id);
    CREATE INDEX IF NOT EXISTS idx_claims_pid        ON claims(patient_id);
    CREATE INDEX IF NOT EXISTS idx_auths_pid         ON authorizations(patient_id);
    CREATE INDEX IF NOT EXISTS idx_labs_pid          ON lab_results(patient_id);
    CREATE INDEX IF NOT EXISTS idx_medrx_pid         ON medication_requests(patient_id);
    CREATE INDEX IF NOT EXISTS idx_pharmacy_pid      ON pharmacy_records(patient_id);
    CREATE INDEX IF NOT EXISTS idx_visit_notes_pid   ON visit_notes(patient_id);

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
    CREATE INDEX IF NOT EXISTS idx_patients_name        ON patients(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_appt_patient         ON appointment_requests(patient_id);
    CREATE INDEX IF NOT EXISTS idx_appt_status          ON appointment_requests(status);
    CREATE INDEX IF NOT EXISTS idx_appt_date            ON appointment_requests(preferred_date);
    CREATE INDEX IF NOT EXISTS idx_consent_patient      ON caregiver_consents(patient_id);
    CREATE INDEX IF NOT EXISTS idx_consent_status       ON caregiver_consents(status);
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

// Seed demo appointment and consent data if tables are empty
function seedDemoPortalData() {
  const apptCount = db.prepare('SELECT COUNT(*) as cnt FROM appointment_requests').get().cnt;
  if (apptCount > 0) return; // already seeded

  function dOff(days) {
    const dt = new Date(); dt.setDate(dt.getDate() + days);
    return dt.toISOString().split('T')[0];
  }
  const now = new Date();
  const d1 = new Date(now - 86400000), d2 = new Date(now - 172800000), d3 = new Date(now - 259200000);

  const insertAppt = db.prepare(`
    INSERT OR IGNORE INTO appointment_requests
      (id, patient_id, patient_name, preferred_date, preferred_time, reason, status, scheduled_time, new_date, submitted_at, confirmed_at, rescheduled_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const appts = [
    ['appt_c1','SMG-0001234','','',          dOff(-3),'morning','Annual wellness exam',                        'confirmed','09:00',null,new Date(now-345600000).toISOString(),d3.toISOString(),null],
    ['appt_c2','SMG-0003456','',             dOff(-3),'morning','Diabetes management — A1C results review',    'confirmed','10:30',null,new Date(now-432000000).toISOString(),d3.toISOString(),null],
    ['appt_c3','SMG-0007890','',             dOff(-2),'morning','Blood pressure medication follow-up',         'confirmed','09:00',null,new Date(now-259200000).toISOString(),d2.toISOString(),null],
    ['appt_c7','SMG-0009012','',             dOff(0), 'morning','Routine checkup and immunization',            'confirmed','09:00',null,d2.toISOString(),                   d1.toISOString(),null],
    ['appt_c8','SMG-0010123','',             dOff(0), 'morning','Chest pain — non-emergency evaluation',       'confirmed','10:30',null,d2.toISOString(),                   d1.toISOString(),null],
    ['appt_c10','SMG-0005678','',            dOff(1), 'morning','Follow-up after hospitalization',             'confirmed','09:00',null,d1.toISOString(),                   now.toISOString(),null],
    ['appt_c11','SMG-0012345','',            dOff(1), 'morning','Hypertension management review',              'confirmed','11:30',null,d1.toISOString(),                   now.toISOString(),null],
    ['appt_r1','SMG-0017890','',             dOff(-1),'morning','Physical therapy referral — knee',            'rescheduled','10:00',dOff(3),d2.toISOString(),null,d1.toISOString()],
    ['appt_r2','SMG-0018901','',             dOff(1), 'morning','Diabetes check-up',                          'rescheduled','13:00',dOff(5),d1.toISOString(),null,now.toISOString()],
    ['appt_p1','SMG-0001234','',             dOff(2), 'morning','Annual checkup and blood pressure follow-up', 'pending',null,null,now.toISOString(),null,null],
    ['appt_p2','SMG-0013456','',             dOff(2), 'afternoon','Persistent headaches — neurological assessment','pending',null,null,d1.toISOString(),null,null],
    ['appt_p3','SMG-0014567','',             dOff(3), 'morning','New patient general exam',                   'pending',null,null,now.toISOString(),null,null],
    ['appt_p4','SMG-0006789','',             dOff(4), 'morning','새 환자 - 전반적인 건강 검진 (New patient general exam)','pending',null,null,d1.toISOString(),null,null],
    ['appt_p5','SMG-0015678','',             dOff(5), 'afternoon','Thyroid function review — medication adjustment','pending',null,null,now.toISOString(),null,null],
    ['appt_p6','SMG-0016789','',             dOff(6), 'evening','Physical therapy referral — lower back pain', 'pending',null,null,d1.toISOString(),null,null],
  ];

  for (const a of appts) {
    try { insertAppt.run(a[0],a[1],a[2],a[3],a[4],a[5],a[6],a[7],a[8],a[9],a[10],a[11]); } catch(_) {}
  }

  const consentCount = db.prepare('SELECT COUNT(*) as cnt FROM caregiver_consents').get().cnt;
  if (consentCount > 0) return;

  const insertConsent = db.prepare(`
    INSERT OR IGNORE INTO caregiver_consents
      (id, patient_id, patient_name, caregiver_name, caregiver_phone, relationship, perms_appointments, perms_medications, perms_lab_results, status, submitted_at, responded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const consents = [
    ['consent_d1','SMG-0001234','박순자 (Sonja Park)',  '박민준 (Min Park)',      '(213) 555-0142','Son',           1,1,1,'pending', now.toISOString(),null],
    ['consent_d2','SMG-0002345','김영희 (Young Kim)',   '김지수 (Jisoo Kim)',     '(310) 555-0287','Daughter',      1,0,0,'pending', d1.toISOString(), null],
    ['consent_d3','SMG-0003456','이철수 (Chul Lee)',    '이서연 (Seoyeon Lee)',   '(714) 555-0391','Daughter-in-law',1,1,1,'approved',d2.toISOString(),d1.toISOString()],
    ['consent_d4','SMG-0004567','최명자 (Myungja Choi)','최동현 (Donghyun Choi)','(626) 555-0489','Son',           1,1,0,'declined',d3.toISOString(),d2.toISOString()],
    ['consent_d5','SMG-0005678','정혜숙 (Hyesuk Jung)', '정수아 (Sua Jung)',      '(909) 555-0531','Granddaughter', 1,1,1,'pending', now.toISOString(),null],
  ];

  for (const c of consents) {
    try { insertConsent.run(...c); } catch(_) {}
  }

  console.log('[DB] Portal demo data seeded (appointments + caregiver consents)');
}

module.exports = { db, initDb, seedDemoPortalData };

// Re-export seedUsers lazily to avoid circular dependency (auth.js imports db)
function getSeedUsers() { return require('./utils/auth').seedUsers; }
module.exports.seedUsers = () => getSeedUsers()();
