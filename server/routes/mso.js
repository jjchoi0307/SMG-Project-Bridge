const express = require('express');
const { db } = require('../database');
const { cached, invalidate } = require('../utils/cache');

const router = express.Router();

// ── POST /api/mso/eligibility  — create a new eligibility record
router.post('/eligibility', (req, res) => {
  const { patient_id, payer_name, plan_name, member_id, group_number,
          effective_date, term_date, status, plan_type, copay, deductible } = req.body;

  if (!patient_id || !payer_name)
    return res.status(400).json({ error: 'patient_id and payer_name required' });

  const patient = db.prepare('SELECT patient_id FROM patients WHERE patient_id = ?').get(patient_id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const info = db.prepare(`
    INSERT INTO eligibility
      (patient_id, payer_name, plan_name, member_id, group_number,
       effective_date, term_date, status, plan_type, copay, deductible, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(patient_id, payer_name, plan_name || null, member_id || null, group_number || null,
         effective_date || null, term_date || null, status || 'Active',
         plan_type || null, copay || null, deductible || null);

  invalidate('stats');
  res.json({ success: true, id: info.lastInsertRowid });
});

// ── POST /api/mso/claims  — create a new claim
router.post('/claims', (req, res) => {
  const { patient_id, dos, cpt_code, icd_codes, provider_name, provider_npi,
          billed_amount, allowed_amount, paid_amount, patient_resp,
          status, submission_date, claim_number } = req.body;

  if (!patient_id || !dos)
    return res.status(400).json({ error: 'patient_id and dos (date of service) required' });

  const patient = db.prepare('SELECT patient_id FROM patients WHERE patient_id = ?').get(patient_id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const info = db.prepare(`
    INSERT INTO claims
      (patient_id, claim_number, dos, cpt_code, icd_codes, provider_name, provider_npi,
       billed_amount, allowed_amount, paid_amount, patient_resp,
       status, submission_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(patient_id, claim_number || null, dos, cpt_code || null, icd_codes || null,
         provider_name || null, provider_npi || null,
         billed_amount ?? null, allowed_amount ?? null, paid_amount ?? null, patient_resp ?? null,
         status || 'Pending', submission_date || new Date().toISOString().split('T')[0]);

  invalidate('stats');
  res.json({ success: true, id: info.lastInsertRowid });
});

// ── GET /api/mso/eligibility  — paginated list of all eligibility records
router.get('/eligibility', (req, res) => {
  const { status = '', page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = status ? 'WHERE e.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) as c FROM eligibility e ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT e.*, p.first_name, p.last_name, p.dob, p.language, p.korean_name
    FROM eligibility e
    JOIN patients p ON e.patient_id = p.patient_id
    ${where}
    ORDER BY e.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), eligibility: rows });
});

// ── GET /api/mso/eligibility/by-member/:memberId  — find patient by insurance member_id (MUST be before /:pid)
router.get('/eligibility/by-member/:memberId', (req, res) => {
  const row = db.prepare(`
    SELECT e.*, p.first_name, p.last_name, p.dob, p.gender, p.phone,
           p.language, p.korean_name, p.address, p.city, p.state, p.zip
    FROM eligibility e
    JOIN patients p ON e.patient_id = p.patient_id
    WHERE e.member_id = ?
    ORDER BY e.updated_at DESC LIMIT 1
  `).get(req.params.memberId);
  if (!row) return res.status(404).json({ error: 'No patient found with that member ID' });
  res.json(row);
});

// ── GET /api/mso/eligibility/:pid
router.get('/eligibility/:pid', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM eligibility WHERE patient_id = ? ORDER BY updated_at DESC
  `).all(req.params.pid);
  res.json(rows);
});

// ── PUT /api/mso/eligibility/:id  — update status
router.put('/eligibility/:id', (req, res) => {
  const { status, verified_date } = req.body;
  db.prepare(`UPDATE eligibility SET status = ?, verified_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, verified_date || new Date().toISOString(), req.params.id);
  res.json({ success: true });
});

// ── GET /api/mso/claims/summary  — all claims with filters (MUST be before /claims/:pid)
router.get('/claims/summary', (req, res) => {
  const { status, page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) as c FROM claims c ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT c.*, p.first_name, p.last_name, p.dob, p.language, p.korean_name
    FROM claims c
    JOIN patients p ON c.patient_id = p.patient_id
    ${where}
    ORDER BY c.dos DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), claims: rows });
});

// ── GET /api/mso/claims/:pid  — claims for one patient
router.get('/claims/:pid', (req, res) => {
  const { status } = req.query;
  const where = status ? 'AND status = ?' : '';
  const params = [req.params.pid, ...(status ? [status] : [])];
  const rows = db.prepare(`
    SELECT * FROM claims WHERE patient_id = ? ${where} ORDER BY dos DESC
  `).all(...params);
  res.json(rows);
});

// ── PUT /api/mso/claims/:id  — update claim status
router.put('/claims/:id', (req, res) => {
  const { status, denial_reason, paid_date, paid_amount } = req.body;
  db.prepare(`
    UPDATE claims SET
      status = COALESCE(?, status),
      denial_reason = COALESCE(?, denial_reason),
      paid_date = COALESCE(?, paid_date),
      paid_amount = COALESCE(?, paid_amount),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status ?? null, denial_reason ?? null, paid_date ?? null, paid_amount ?? null, req.params.id);
  res.json({ success: true });
});

// ── GET /api/mso/auths  — paginated list of all authorizations
router.get('/auths', (req, res) => {
  const { status = '', page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = status ? 'WHERE a.status = ?' : '';
  const params = status ? [status] : [];

  const total = db.prepare(`SELECT COUNT(*) as c FROM authorizations a ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT a.*, p.first_name, p.last_name, p.dob, p.language, p.korean_name
    FROM authorizations a
    JOIN patients p ON a.patient_id = p.patient_id
    ${where}
    ORDER BY a.requested_date DESC, a.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), authorizations: rows });
});

// ── GET /api/mso/auths/:pid
router.get('/auths/:pid', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM authorizations WHERE patient_id = ? ORDER BY updated_at DESC
  `).all(req.params.pid);
  res.json(rows);
});

// ── POST /api/mso/auths  — create new auth request
router.post('/auths', (req, res) => {
  const { patient_id, auth_type, service_type, referring_provider, rendering_provider,
          requested_date, start_date, end_date, approved_units, notes } = req.body;

  if (!patient_id || !auth_type) return res.status(400).json({ error: 'patient_id and auth_type required' });

  const info = db.prepare(`
    INSERT INTO authorizations
      (patient_id, auth_type, service_type, referring_provider, rendering_provider,
       requested_date, start_date, end_date, approved_units, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
  `).run(patient_id, auth_type, service_type, referring_provider, rendering_provider,
         requested_date || new Date().toISOString().split('T')[0],
         start_date, end_date, approved_units, notes);

  res.json({ success: true, id: info.lastInsertRowid });
});

// ── PUT /api/mso/auths/:id
router.put('/auths/:id', (req, res) => {
  const { status, approved_date, denial_reason, approved_units, notes } = req.body;
  db.prepare(`
    UPDATE authorizations SET
      status = COALESCE(?, status),
      approved_date = COALESCE(?, approved_date),
      denial_reason = COALESCE(?, denial_reason),
      approved_units = COALESCE(?, approved_units),
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status ?? null, approved_date ?? null, denial_reason ?? null,
         approved_units ?? null, notes ?? null, req.params.id);
  res.json({ success: true });
});

// ── GET /api/mso/payer-summary  — eligibility + claims aggregated by payer (cached 60s)
router.get('/payer-summary', (req, res) => {
  const data = cached('mso:payer-summary', 60_000, () => {
    const payers = db.prepare(`
      SELECT
        e.payer_name,
        COUNT(DISTINCT e.patient_id)                                          AS members,
        SUM(CASE WHEN e.status = 'Active' THEN 1 ELSE 0 END)                 AS active,
        SUM(CASE WHEN e.status IN ('Inactive','Termed') THEN 1 ELSE 0 END)   AS inactive,
        e.plan_type
      FROM eligibility e
      WHERE e.payer_name IS NOT NULL AND e.payer_name != ''
      GROUP BY e.payer_name
      ORDER BY members DESC
      LIMIT 20
    `).all();

    const claimsByPayer = db.prepare(`
      SELECT
        c.provider_name                        AS payer_name,
        COUNT(*)                               AS claim_count,
        SUM(c.billed_amount)                   AS total_billed,
        SUM(c.paid_amount)                     AS total_paid,
        SUM(CASE WHEN c.status = 'Denied' THEN 1 ELSE 0 END) AS denied
      FROM claims c
      WHERE c.provider_name IS NOT NULL AND c.provider_name != ''
      GROUP BY c.provider_name
      ORDER BY total_billed DESC
      LIMIT 20
    `).all();

    return { payers, claimsByPayer };
  });
  res.json(data);
});

// ── GET /api/mso/dashboard  — MSO aggregate stats (cached 60s)
router.get('/dashboard', (req, res) => {
  const data = cached('mso:dashboard', 60_000, () => {
    const elig = db.prepare(`
      SELECT status, COUNT(*) as count FROM eligibility GROUP BY status
    `).all();

    const claims = db.prepare(`
      SELECT status, COUNT(*) as count, SUM(billed_amount) as total_billed, SUM(paid_amount) as total_paid
      FROM claims GROUP BY status
    `).all();

    const auths = db.prepare(`
      SELECT status, COUNT(*) as count FROM authorizations GROUP BY status
    `).all();

    const recentClaims = db.prepare(`
      SELECT c.*, p.first_name, p.last_name
      FROM claims c JOIN patients p ON c.patient_id = p.patient_id
      ORDER BY c.updated_at DESC LIMIT 10
    `).all();

    const pendingAuths = db.prepare(`
      SELECT a.*, p.first_name, p.last_name
      FROM authorizations a JOIN patients p ON a.patient_id = p.patient_id
      WHERE a.status = 'Pending'
      ORDER BY a.requested_date ASC LIMIT 10
    `).all();

    return { eligibility: elig, claims, authorizations: auths, recentClaims, pendingAuths };
  });
  res.json(data);
});

module.exports = router;
