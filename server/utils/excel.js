const XLSX = require('xlsx');
const { db } = require('../database');

// ─────────────────────────────────────────────
//  Date normalization → YYYY-MM-DD
// ─────────────────────────────────────────────
const DATE_FIELDS = new Set([
  'dob','effective_date','term_date','verified_date',
  'dos','submission_date','paid_date',
  'requested_date','approved_date','start_date','end_date',
  'collection_date','result_date',
  'prescribed_date','fill_date','refill_due_date','assigned_date',
]);

function normalizeDate(val) {
  if (val === null || val === undefined || val === '') return val;
  // Native Date object (XLSX cellDates:true)
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
  // M/D/YYYY or MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  // D-Mon-YYYY  e.g. 15-Mar-2026
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmy) {
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const m = months[dmy[2].toLowerCase()];
    if (m) return `${dmy[3]}-${m}-${dmy[1].padStart(2,'0')}`;
  }
  // Excel serial number (integer 40000–50000 covers 2009–2036)
  if (/^\d{4,5}$/.test(s)) {
    const serial = parseInt(s);
    if (serial > 25569 && serial < 60000) {
      return new Date((serial - 25569) * 86400000).toISOString().split('T')[0];
    }
  }
  return s;
}

// ─────────────────────────────────────────────
//  Column name normalization
// ─────────────────────────────────────────────
function normalizeKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Map common Excel column names → our DB field names
const PATIENT_MAP = {
  patient_id: ['patient_id','id','member_id','memberid','patient_number','pt_id'],
  last_name:  ['last_name','lastname','lname','surname','family_name'],
  first_name: ['first_name','firstname','fname','given_name'],
  middle_name:['middle_name','middlename','middle_initial','mi'],
  dob:        ['dob','date_of_birth','birthdate','birth_date','dateofbirth'],
  gender:     ['gender','sex','gender_code'],
  phone:      ['phone','phone_number','telephone','cell','mobile','contact_number'],
  email:      ['email','email_address','e_mail'],
  address:    ['address','street','street_address','addr'],
  city:       ['city','city_name'],
  state:      ['state','state_code','state_abbr'],
  zip:        ['zip','zipcode','zip_code','postal_code'],
  language:   ['language','preferred_language','lang'],
  korean_name:     ['korean_name','korean name','korean_name_hangul','name_korean','name_kr','한국어 이름','한글이름'],
  assigned_broker: ['assigned_broker','broker','broker_license','broker_id','broker_name','broker_agent'],
};

const ELIGIBILITY_MAP = {
  payer_name:     ['payer','payer_name','insurance_company','insurer'],
  plan_name:      ['plan','plan_name','plan_description','benefit_plan'],
  member_id:      ['member_id','memberid','subscriber_id','insurance_id'],
  group_number:   ['group','group_number','group_id','group_#'],
  effective_date: ['effective_date','eff_date','coverage_start','start_date'],
  term_date:      ['term_date','termination_date','coverage_end','end_date'],
  status:         ['status','eligibility_status','coverage_status','elig_status'],
  plan_type:      ['plan_type','insurance_type','coverage_type'],
  copay:          ['copay','co_pay','copayment'],
  deductible:     ['deductible','ded'],
  verified_date:  ['verified_date','verification_date','last_verified'],
};

const CLAIMS_MAP = {
  claim_number:    ['claim_number','claim_id','claim_#','claimid'],
  dos:             ['dos','date_of_service','service_date','visit_date'],
  cpt_code:        ['cpt','cpt_code','procedure_code','service_code'],
  icd_codes:       ['icd','icd_code','icd_codes','diagnosis_code','dx_code'],
  provider_name:   ['provider','provider_name','rendering_provider','physician'],
  provider_npi:    ['npi','provider_npi','rendering_npi'],
  billed_amount:   ['billed','billed_amount','charge_amount','charges'],
  allowed_amount:  ['allowed','allowed_amount'],
  paid_amount:     ['paid','paid_amount','payment'],
  patient_resp:    ['patient_responsibility','patient_resp','copay_amount','patient_owe'],
  status:          ['status','claim_status','payment_status'],
  denial_reason:   ['denial_reason','denial_code','deny_reason'],
  submission_date: ['submission_date','submitted_date','filed_date'],
  paid_date:       ['paid_date','payment_date','check_date'],
};

const AUTH_MAP = {
  auth_number:        ['auth_number','auth_#','authorization_number','auth_id'],
  auth_type:          ['auth_type','type','authorization_type'],
  service_type:       ['service_type','service','procedure'],
  referring_provider: ['referring_provider','referring_physician','referral_from'],
  rendering_provider: ['rendering_provider','rendering_physician','specialist'],
  requested_date:     ['requested_date','request_date','submission_date'],
  approved_date:      ['approved_date','approval_date'],
  start_date:         ['start_date','auth_start','valid_from'],
  end_date:           ['end_date','auth_end','valid_to','expiration_date'],
  approved_units:     ['approved_units','units','visits_approved','authorized_visits'],
  used_units:         ['used_units','units_used','visits_used'],
  status:             ['status','auth_status','authorization_status'],
  denial_reason:      ['denial_reason','deny_reason','denial_code'],
  notes:              ['notes','comments','remarks'],
};

const LAB_MAP = {
  test_name:       ['test_name','test','lab_test','panel','result_name'],
  test_code:       ['test_code','loinc','loinc_code','order_code'],
  result_value:    ['result','result_value','value'],
  unit:            ['unit','units','uom'],
  reference_range: ['reference_range','ref_range','normal_range','range'],
  flag:            ['flag','abnormal_flag','result_flag'],
  ordered_by:      ['ordered_by','ordering_provider','physician','doctor'],
  ordering_npi:    ['ordering_npi','provider_npi','npi'],
  collection_date: ['collection_date','collected_date','specimen_date'],
  result_date:     ['result_date','reported_date'],
  lab_name:        ['lab','lab_name','laboratory'],
  status:          ['status','result_status'],
  notes:           ['notes','comments','interpretation'],
};

const MED_REQUEST_MAP = {
  medication_name:  ['medication','medication_name','drug_name','drug','rx_name'],
  ndc_code:         ['ndc','ndc_code','national_drug_code'],
  dosage:           ['dosage','dose','strength','sig'],
  frequency:        ['frequency','freq','directions'],
  quantity:         ['quantity','qty','amount'],
  days_supply:      ['days_supply','days','day_supply'],
  prescriber_name:  ['prescriber','prescriber_name','prescribing_physician','doctor'],
  prescriber_npi:   ['prescriber_npi','prescriber_id','npi'],
  prescribed_date:  ['prescribed_date','prescription_date','rx_date','date_written'],
  status:           ['status','rx_status','prescription_status'],
  notes:            ['notes','comments','instructions'],
};

const PHARMACY_MAP = {
  medication_name:  ['medication','medication_name','drug_name','drug'],
  ndc_code:         ['ndc','ndc_code'],
  dosage:           ['dosage','dose','strength'],
  quantity:         ['quantity','qty','dispensed_quantity'],
  days_supply:      ['days_supply','days'],
  pharmacy_name:    ['pharmacy','pharmacy_name','dispensing_pharmacy'],
  pharmacy_phone:   ['pharmacy_phone','pharmacy_telephone'],
  pharmacy_address: ['pharmacy_address','pharmacy_location'],
  fill_date:        ['fill_date','dispense_date','filled_date','last_fill'],
  refill_due_date:  ['refill_due_date','refill_due','refill_date','next_fill','due_date','next_refill_date'],
  refills_remaining:['refills_remaining','refills_left','refills'],
  status:           ['status','rx_status','fill_status'],
  last_fill_status: ['last_fill_status','fill_result'],
};

const PCP_MAP = {
  provider_name:    ['pcp','pcp_name','provider_name','primary_care','doctor','physician'],
  provider_npi:     ['pcp_npi','provider_npi','npi'],
  specialty:        ['specialty','speciality'],
  practice_name:    ['practice','practice_name','clinic','office'],
  practice_phone:   ['practice_phone','office_phone','provider_phone'],
  practice_address: ['practice_address','office_address','provider_address'],
  assigned_date:    ['assigned_date','pcp_assigned_date','effective_date'],
  status:           ['status','pcp_status'],
};

// ─────────────────────────────────────────────
//  Map a row's keys → our field names
// ─────────────────────────────────────────────
function mapRow(row, fieldMap) {
  const normalizedRow = {};
  for (const [k, v] of Object.entries(row)) {
    normalizedRow[normalizeKey(k)] = v;
  }

  const result = {};
  for (const [field, aliases] of Object.entries(fieldMap)) {
    for (const alias of aliases) {
      const val = normalizedRow[alias];
      if (val !== undefined && val !== null && val !== '') {
        if (DATE_FIELDS.has(field)) {
          result[field] = normalizeDate(val);
        } else if (typeof val === 'number') {
          result[field] = val;                     // preserve numeric type
        } else {
          result[field] = String(val).trim();
        }
        break;
      }
    }
  }
  return result;
}

// ─────────────────────────────────────────────
//  Detect sheet type from column headers
// ─────────────────────────────────────────────
function detectSheetType(headers) {
  const nh = headers.map(normalizeKey);
  const has = (arr) => arr.some(k => nh.includes(k));

  if (has(['claim_number','claimid','claim_#','cpt_code','cpt','date_of_service','dos'])) return 'claims';
  if (has(['auth_number','auth_#','authorization_number','auth_id'])) return 'authorizations';
  if (has(['test_name','loinc','result_value','lab_test','collection_date'])) return 'labs';
  if (has(['pharmacy_name','fill_date','refill_due','dispensing_pharmacy'])) return 'pharmacy';
  if (has(['prescribed_date','rx_date','date_written','prescribing_physician'])) return 'medications';
  if (has(['payer_name','payer','eligibility_status','elig_status','coverage_start'])) return 'eligibility';
  if (has(['pcp','pcp_name','primary_care_provider'])) return 'pcp';
  // Default: patients
  return 'patients';
}

// ─────────────────────────────────────────────
//  Upsert helpers
// ─────────────────────────────────────────────
function upsertPatient(row, sourceFile, orgId) {
  const data = mapRow(row, PATIENT_MAP);
  if (!data.patient_id && !data.last_name) return null;

  // Generate a patient_id if missing
  if (!data.patient_id) {
    data.patient_id = `AUTO_${data.last_name}_${data.first_name || ''}_${data.dob || ''}`.replace(/\s+/g,'_').toUpperCase();
  }

  const existing = db.prepare('SELECT id FROM patients WHERE patient_id = ?').get(data.patient_id);
  if (existing) {
    const fields = Object.keys(data).filter(k => k !== 'patient_id');
    if (fields.length > 0) {
      db.prepare(`UPDATE patients SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now'), source_file = ? WHERE patient_id = ?`)
        .run(...fields.map(f => data[f]), sourceFile, data.patient_id);
    }
  } else {
    data.source_file = sourceFile;
    if (orgId) data.org_id = orgId;
    const cols = Object.keys(data);
    db.prepare(`INSERT OR IGNORE INTO patients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map(k => data[k]));
  }
  return data.patient_id;
}

function upsertEligibility(row, patientId, sourceFile) {
  const data = mapRow(row, ELIGIBILITY_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR REPLACE INTO eligibility (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function insertClaim(row, patientId, sourceFile) {
  const data = mapRow(row, CLAIMS_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR IGNORE INTO claims (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function upsertAuth(row, patientId, sourceFile) {
  const data = mapRow(row, AUTH_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR REPLACE INTO authorizations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function insertLab(row, patientId, sourceFile) {
  const data = mapRow(row, LAB_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR IGNORE INTO lab_results (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function upsertMedRequest(row, patientId, sourceFile) {
  const data = mapRow(row, MED_REQUEST_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR REPLACE INTO medication_requests (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function upsertPharmacy(row, patientId, sourceFile) {
  const data = mapRow(row, PHARMACY_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR REPLACE INTO pharmacy_records (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

function upsertPcp(row, patientId, sourceFile) {
  const data = mapRow(row, PCP_MAP);
  data.patient_id = patientId;
  data.source_file = sourceFile;
  data['updated_at'] = new Date().toISOString();
  const cols = Object.keys(data);
  db.prepare(`INSERT OR REPLACE INTO pcp_providers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map(k => data[k]));
}

// ─────────────────────────────────────────────
//  Main: process one Excel file
// ─────────────────────────────────────────────
function processExcelFile(filepath, fileId, orgId = null) {
  const filename = require('path').basename(filepath);
  let totalRows = 0;

  // Update status
  db.prepare("UPDATE excel_files SET status = 'processing' WHERE id = ?").run(fileId);

  try {
    // Clear existing data from this source file before re-inserting (prevents duplicates on reprocess)
    const cleanupTables = ['pharmacy_records','lab_results','medication_requests','claims','authorizations','eligibility','pcp_providers'];
    for (const tbl of cleanupTables) {
      db.prepare(`DELETE FROM ${tbl} WHERE source_file = ?`).run(filename);
    }

    const workbook = XLSX.readFile(filepath, { cellDates: true });

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) continue;

      const headers = Object.keys(rows[0]);
      const sheetType = detectSheetType(headers);
      console.log(`[EXCEL] Sheet "${sheetName}" → type: ${sheetType}, rows: ${rows.length}`);

      db.exec('BEGIN');
      try {
        for (const row of rows) {
          try {
            if (sheetType === 'patients') {
              upsertPatient(row, filename, orgId);
            } else {
              const patientData = mapRow(row, PATIENT_MAP);
              let pid = patientData.patient_id;

              if (!pid) {
                if (patientData.last_name && patientData.dob) {
                  const found = db.prepare(
                    'SELECT patient_id FROM patients WHERE last_name = ? AND dob = ? LIMIT 1'
                  ).get(patientData.last_name, patientData.dob);
                  if (found) pid = found.patient_id;
                }
              } else {
                const found = db.prepare('SELECT patient_id FROM patients WHERE patient_id = ?').get(pid);
                if (!found) upsertPatient(row, filename, orgId);
              }

              if (!pid) pid = upsertPatient(row, filename, orgId);

              if (pid) {
                if (sheetType === 'eligibility')         upsertEligibility(row, pid, filename);
                else if (sheetType === 'claims')         insertClaim(row, pid, filename);
                else if (sheetType === 'authorizations') upsertAuth(row, pid, filename);
                else if (sheetType === 'labs')           insertLab(row, pid, filename);
                else if (sheetType === 'medications')    upsertMedRequest(row, pid, filename);
                else if (sheetType === 'pharmacy')       upsertPharmacy(row, pid, filename);
                else if (sheetType === 'pcp')            upsertPcp(row, pid, filename);
              }
            }
            totalRows++;
          } catch (rowErr) {
            console.warn(`[EXCEL] Row error in ${sheetName}:`, rowErr.message);
          }
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    }

    db.prepare("UPDATE excel_files SET status = 'done', row_count = ?, last_synced = datetime('now') WHERE id = ?")
      .run(totalRows, fileId);
    console.log(`[EXCEL] Done: ${filename} — ${totalRows} rows processed`);
    return { success: true, rows: totalRows };

  } catch (err) {
    db.prepare("UPDATE excel_files SET status = 'error', error_msg = ? WHERE id = ?")
      .run(err.message, fileId);
    console.error(`[EXCEL] Error processing ${filename}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
//  Re-process all files for a given patient_id
//  (called when a file is updated on disk)
// ─────────────────────────────────────────────
function reprocessFile(filepath) {
  const filename = require('path').basename(filepath);
  const fileRow = db.prepare('SELECT id FROM excel_files WHERE filepath = ?').get(filepath);
  if (!fileRow) {
    console.warn(`[WATCHER] File not registered: ${filepath}`);
    return;
  }
  console.log(`[WATCHER] Re-processing updated file: ${filename}`);
  processExcelFile(filepath, fileRow.id);
}

module.exports = { processExcelFile, reprocessFile, detectSheetType };
