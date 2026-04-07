const express = require('express');
const { db }  = require('../database');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape  = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\r\n');
}

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows));
}

// ── GET /api/export/patients  — all patients (optionally filtered by q, language)
router.get('/patients', (req, res) => {
  const { q, language } = req.query;
  let where = [];
  let params = [];
  if (q) {
    where.push('(last_name LIKE ? OR first_name LIKE ? OR patient_id LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (language) { where.push('language = ?'); params.push(language); }

  const sql = `SELECT patient_id, last_name, first_name, dob, gender, phone, email,
    address, city, state, zip, language, korean_name, created_at
    FROM patients ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_name, first_name`;
  const rows = db.prepare(sql).all(...params);
  sendCsv(res, 'smg_patients.csv', rows);
});

// ── GET /api/export/eligibility  — eligibility records
router.get('/eligibility', (req, res) => {
  const { status } = req.query;
  const where  = status ? 'WHERE e.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT e.id, p.patient_id, p.last_name, p.first_name, p.dob,
           e.payer_name, e.plan_name, e.plan_type, e.member_id, e.group_number,
           e.effective_date, e.term_date, e.status, e.copay, e.deductible, e.verified_date
    FROM eligibility e
    JOIN patients p ON e.patient_id = p.patient_id
    ${where}
    ORDER BY p.last_name, p.first_name
  `).all(...params);
  sendCsv(res, 'smg_eligibility.csv', rows);
});

// ── GET /api/export/claims  — claims
router.get('/claims', (req, res) => {
  const { status } = req.query;
  const where  = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT c.id, p.patient_id, p.last_name, p.first_name,
           c.claim_number, c.dos, c.cpt_code, c.icd_codes,
           c.provider_name, c.provider_npi,
           c.billed_amount, c.allowed_amount, c.paid_amount, c.patient_resp,
           c.status, c.denial_reason, c.submission_date, c.paid_date
    FROM claims c
    JOIN patients p ON c.patient_id = p.patient_id
    ${where}
    ORDER BY c.dos DESC
  `).all(...params);
  sendCsv(res, 'smg_claims.csv', rows);
});

// ── GET /api/export/labs  — lab results
router.get('/labs', (req, res) => {
  const { flag } = req.query;
  const where  = flag ? 'WHERE lr.flag = ?' : '';
  const params = flag ? [flag] : [];
  const rows = db.prepare(`
    SELECT lr.id, p.patient_id, p.last_name, p.first_name,
           lr.test_name, lr.test_code, lr.result_value, lr.unit,
           lr.reference_range, lr.flag, lr.ordered_by,
           lr.collection_date, lr.result_date, lr.lab_name, lr.status, lr.notes
    FROM lab_results lr
    JOIN patients p ON lr.patient_id = p.patient_id
    ${where}
    ORDER BY lr.result_date DESC
  `).all(...params);
  sendCsv(res, 'smg_labs.csv', rows);
});

// ── GET /api/export/authorizations  — authorizations
router.get('/authorizations', (req, res) => {
  const { status } = req.query;
  const where  = status ? 'WHERE a.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT a.id, p.patient_id, p.last_name, p.first_name,
           a.auth_number, a.auth_type, a.service_type,
           a.referring_provider, a.rendering_provider,
           a.requested_date, a.approved_date, a.start_date, a.end_date,
           a.approved_units, a.used_units, a.status, a.denial_reason, a.notes
    FROM authorizations a
    JOIN patients p ON a.patient_id = p.patient_id
    ${where}
    ORDER BY a.requested_date DESC
  `).all(...params);
  sendCsv(res, 'smg_authorizations.csv', rows);
});

// ── GET /api/export/pharmacy  — pharmacy records
router.get('/pharmacy', (req, res) => {
  const rows = db.prepare(`
    SELECT pr.id, p.patient_id, p.last_name, p.first_name,
           pr.medication_name, pr.dosage, pr.quantity, pr.days_supply,
           pr.pharmacy_name, pr.pharmacy_phone,
           pr.fill_date, pr.refill_due_date, pr.refills_remaining,
           pr.status, pr.last_fill_status
    FROM pharmacy_records pr
    JOIN patients p ON pr.patient_id = p.patient_id
    ORDER BY pr.refill_due_date ASC
  `).all();
  sendCsv(res, 'smg_pharmacy.csv', rows);
});

module.exports = router;
