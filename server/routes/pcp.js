const express = require('express');
const { db } = require('../database');
const { cached } = require('../utils/cache');

const router = express.Router();

// ── GET /api/pcp/providers  — all unique PCP providers (for doctor/SMG portal dropdowns)
router.get('/providers', (req, res) => {
  const rows = db.prepare(`
    SELECT provider_npi, provider_name, specialty, practice_name, practice_phone,
           COUNT(*) as patient_count
    FROM pcp_providers
    WHERE status = 'Active' AND provider_npi IS NOT NULL AND provider_npi != ''
    GROUP BY provider_npi
    ORDER BY patient_count DESC
  `).all();
  res.json(rows);
});

// ── GET /api/pcp/panel/stats?npi=...  — summary stats for a doctor's panel (MUST be before /:pid)
router.get('/panel/stats', (req, res) => {
  const { npi } = req.query;
  if (!npi) return res.status(400).json({ error: 'npi required' });

  const providerInfo = db.prepare(
    `SELECT provider_name, practice_name FROM pcp_providers WHERE provider_npi = ? LIMIT 1`
  ).get(npi);

  if (!providerInfo) return res.status(404).json({ error: 'No patients found for this NPI' });

  const panelCount = db.prepare(
    `SELECT COUNT(*) as c FROM pcp_providers WHERE provider_npi = ? AND status = 'Active'`
  ).get(npi).c;

  const criticalLabs = db.prepare(`
    SELECT lr.*, p.first_name, p.last_name, p.phone, p.korean_name
    FROM lab_results lr
    JOIN pcp_providers pp ON lr.patient_id = pp.patient_id
    JOIN patients p ON lr.patient_id = p.patient_id
    WHERE pp.provider_npi = ? AND lr.flag = 'Critical'
    ORDER BY lr.result_date DESC LIMIT 20
  `).all(npi);

  const pendingAuths = db.prepare(`
    SELECT a.*, p.first_name, p.last_name, p.dob, p.gender
    FROM authorizations a
    JOIN pcp_providers pp ON a.patient_id = pp.patient_id
    JOIN patients p ON a.patient_id = p.patient_id
    WHERE pp.provider_npi = ? AND a.status = 'Pending'
    ORDER BY a.requested_date ASC LIMIT 10
  `).all(npi);

  const pendingClaimsCount = db.prepare(`
    SELECT COUNT(*) as c FROM claims c
    JOIN pcp_providers pp ON c.patient_id = pp.patient_id
    WHERE pp.provider_npi = ? AND c.status = 'Pending'
  `).get(npi).c;

  const refillsDue = db.prepare(`
    SELECT COUNT(*) as c FROM pharmacy_records pr
    JOIN pcp_providers pp ON pr.patient_id = pp.patient_id
    WHERE pp.provider_npi = ? AND pr.refill_due_date <= date('now', '+7 days') AND pr.status = 'Active'
  `).get(npi).c;

  res.json({
    providerName: providerInfo.provider_name,
    practiceName: providerInfo.practice_name,
    panelCount,
    criticalLabs,
    pendingAuths,
    pendingClaimsCount,
    refillsDue,
  });
});

// ── GET /api/pcp/panel?npi=...  — paginated patient list for a doctor's NPI (MUST be before /:pid)
router.get('/panel', (req, res) => {
  const { npi, q, page = 1, limit = 25 } = req.query;
  if (!npi) return res.status(400).json({ error: 'npi required' });
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = `WHERE pp.provider_npi = ? AND pp.status = 'Active'`;
  let params = [npi];

  if (q) {
    where += ` AND (p.last_name LIKE ? OR p.first_name LIKE ? OR p.patient_id LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM pcp_providers pp
    JOIN patients p ON pp.patient_id = p.patient_id
    ${where}
  `).get(...params).c;

  const patients = db.prepare(`
    SELECT p.*, pp.provider_name, pp.practice_name,
      (SELECT status FROM eligibility WHERE patient_id = p.patient_id ORDER BY updated_at DESC LIMIT 1) AS elig_status,
      (SELECT member_id FROM eligibility WHERE patient_id = p.patient_id ORDER BY updated_at DESC LIMIT 1) AS member_id,
      (SELECT COUNT(*) FROM lab_results WHERE patient_id = p.patient_id AND flag = 'Critical') AS critical_lab_count,
      (SELECT COUNT(*) FROM authorizations WHERE patient_id = p.patient_id AND status = 'Pending') AS pending_auths
    FROM pcp_providers pp
    JOIN patients p ON pp.patient_id = p.patient_id
    ${where}
    ORDER BY p.last_name ASC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), patients });
});

// ── GET /api/pcp/labs  — paginated list of all lab results (MUST be before /:pid)
router.get('/labs', (req, res) => {
  const { flag = '', page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const where = flag ? 'WHERE lr.flag = ?' : '';
  const params = flag ? [flag] : [];

  const total = db.prepare(`SELECT COUNT(*) as c FROM lab_results lr ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT lr.*, p.first_name, p.last_name, p.phone, p.language, p.korean_name
    FROM lab_results lr
    JOIN patients p ON lr.patient_id = p.patient_id
    ${where}
    ORDER BY lr.result_date DESC, lr.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), labs: rows });
});

// ── GET /api/pcp/labs/:pid  — labs for one patient
router.get('/labs/:pid', (req, res) => {
  const { flag, limit = 50 } = req.query;
  const where = flag ? 'AND flag = ?' : '';
  const params = [req.params.pid, ...(flag ? [flag] : []), parseInt(limit)];
  const rows = db.prepare(`
    SELECT * FROM lab_results WHERE patient_id = ? ${where}
    ORDER BY result_date DESC LIMIT ?
  `).all(...params);
  res.json(rows);
});

// ── POST /api/pcp/labs  — add a lab result manually
router.post('/labs', (req, res) => {
  const { patient_id, test_name, result_value, unit, reference_range, flag,
          ordered_by, collection_date, result_date, lab_name, notes } = req.body;

  if (!patient_id || !test_name) return res.status(400).json({ error: 'patient_id and test_name required' });

  const info = db.prepare(`
    INSERT INTO lab_results
      (patient_id, test_name, result_value, unit, reference_range, flag,
       ordered_by, collection_date, result_date, lab_name, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Final')
  `).run(patient_id, test_name, result_value, unit, reference_range, flag || 'Normal',
         ordered_by, collection_date, result_date || new Date().toISOString().split('T')[0],
         lab_name, notes);

  res.json({ success: true, id: info.lastInsertRowid });
});

// ── GET /api/pcp/medications/:pid  — active medications
router.get('/medications/:pid', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM medication_requests WHERE patient_id = ? AND status = 'Active'
    ORDER BY prescribed_date DESC
  `).all(req.params.pid);
  res.json(rows);
});

// ── POST /api/pcp/medications  — add medication request
router.post('/medications', (req, res) => {
  const { patient_id, medication_name, dosage, frequency, quantity, days_supply,
          prescriber_name, prescriber_npi, prescribed_date, notes } = req.body;

  if (!patient_id || !medication_name) return res.status(400).json({ error: 'patient_id and medication_name required' });

  const info = db.prepare(`
    INSERT INTO medication_requests
      (patient_id, medication_name, dosage, frequency, quantity, days_supply,
       prescriber_name, prescriber_npi, prescribed_date, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')
  `).run(patient_id, medication_name, dosage, frequency, quantity, days_supply,
         prescriber_name, prescriber_npi,
         prescribed_date || new Date().toISOString().split('T')[0], notes);

  res.json({ success: true, id: info.lastInsertRowid });
});

// ── PUT /api/pcp/medications/:id  — update status (discontinue, etc.)
router.put('/medications/:id', (req, res) => {
  const { status, notes } = req.body;
  db.prepare(`UPDATE medication_requests SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(status, notes ?? null, req.params.id);
  res.json({ success: true });
});

// ── GET /api/pcp/dashboard  — PCP-wide clinical alerts (cached 60s)
router.get('/dashboard', (req, res) => {
  const data = cached('pcp:dashboard', 60_000, () => {
    const criticalLabs = db.prepare(`
      SELECT lr.*, p.first_name, p.last_name, p.phone
      FROM lab_results lr JOIN patients p ON lr.patient_id = p.patient_id
      WHERE lr.flag = 'Critical'
      ORDER BY lr.result_date DESC LIMIT 20
    `).all();

    const abnormalLabs = db.prepare(`
      SELECT COUNT(*) as c FROM lab_results WHERE flag IN ('High','Low','Critical')
    `).get().c;

    const activeMeds = db.prepare(`
      SELECT COUNT(*) as c FROM medication_requests WHERE status = 'Active'
    `).get().c;

    const topConditions = db.prepare(`
      SELECT icd_codes, COUNT(*) as count
      FROM claims WHERE icd_codes != ''
      GROUP BY icd_codes ORDER BY count DESC LIMIT 10
    `).all();

    return { criticalLabs, abnormalLabs, activeMeds, topConditions };
  });
  res.json(data);
});

// ── GET /api/pcp/:pid  — patient's PCP and clinical data (MUST be last — catches all /:pid)
router.get('/:pid', (req, res) => {
  const pcp  = db.prepare('SELECT * FROM pcp_providers WHERE patient_id = ? LIMIT 1').get(req.params.pid);
  const labs = db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY result_date DESC').all(req.params.pid);
  const meds = db.prepare('SELECT * FROM medication_requests WHERE patient_id = ? ORDER BY prescribed_date DESC').all(req.params.pid);
  res.json({ pcp, labs, medications: meds });
});

module.exports = router;
