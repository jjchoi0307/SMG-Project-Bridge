const express = require('express');
const { db } = require('../database');
const { cached, invalidate } = require('../utils/cache');

const router = express.Router();

// ── GET /api/patients  — paginated list with search + optional broker filter
router.get('/', (req, res) => {
  const { q, broker, page = 1, limit = 50, sort = 'last_name', dir = 'asc' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const allowed = ['last_name','first_name','dob','patient_id','updated_at'];
  const sortCol = allowed.includes(sort) ? sort : 'last_name';
  const sortDir = dir === 'desc' ? 'DESC' : 'ASC';

  const conditions = [];
  const params = [];

  if (q) {
    const like = `%${q}%`;
    conditions.push(`(last_name LIKE ? OR first_name LIKE ? OR patient_id LIKE ? OR phone LIKE ? OR email LIKE ?)`);
    params.push(like, like, like, like, like);
  }
  if (broker) {
    conditions.push(`assigned_broker = ?`);
    params.push(broker);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as c FROM patients ${whereClause}`).get(...params).c;
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT status FROM eligibility WHERE patient_id = p.patient_id ORDER BY updated_at DESC LIMIT 1) AS elig_status,
      (SELECT provider_name FROM pcp_providers WHERE patient_id = p.patient_id LIMIT 1) AS pcp_name,
      (SELECT COUNT(*) FROM claims WHERE patient_id = p.patient_id) AS claim_count,
      (SELECT COUNT(*) FROM authorizations WHERE patient_id = p.patient_id AND status = 'Pending') AS pending_auths,
      (SELECT COUNT(*) FROM pharmacy_records WHERE patient_id = p.patient_id) AS rx_count
    FROM patients p
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), patients: rows });
});

// ── GET /api/patients/stats  — dashboard summary stats (cached 30s)
router.get('/stats', (req, res) => {
  const stats = cached('stats:patients', 30_000, () => ({
    totalPatients:     db.prepare('SELECT COUNT(*) as c FROM patients').get().c,
    activeEligibility: db.prepare("SELECT COUNT(DISTINCT patient_id) as c FROM eligibility WHERE status = 'Active'").get().c,
    pendingClaims:     db.prepare("SELECT COUNT(*) as c FROM claims WHERE status = 'Pending'").get().c,
    pendingAuths:      db.prepare("SELECT COUNT(*) as c FROM authorizations WHERE status = 'Pending'").get().c,
    criticalLabs:      db.prepare("SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag = 'Critical'").get().c,
    refillsDue:        db.prepare(`SELECT COUNT(*) as c FROM pharmacy_records WHERE refill_due_date <= date('now', '+7 days') AND status = 'Active'`).get().c,
    totalFiles:        db.prepare('SELECT COUNT(*) as c FROM excel_files').get().c,
    lastSync:          db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(MAX(last_synced), MAX(uploaded_at))) as s FROM excel_files").get().s,
  }));
  res.json(stats);
});

// ── GET /api/patients/intel  — population & clinical intel for SMG dashboard (MUST be before /:pid)
router.get('/intel', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) as c FROM patients').get().c;
  const korean  = db.prepare("SELECT COUNT(*) as c FROM patients WHERE language = 'Korean'").get().c;
  const english = db.prepare("SELECT COUNT(*) as c FROM patients WHERE language = 'English' OR language IS NULL OR language = ''").get().c;
  const other   = Math.max(0, total - korean - english);

  const criticalLabs = db.prepare("SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag = 'Critical'").get().c;
  const abnormalLabs = db.prepare("SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag IN ('High','Low','Critical')").get().c;

  const activeMeds  = db.prepare("SELECT COUNT(*) as c FROM pharmacy_records WHERE status = 'Active'").get().c;
  const overdueMeds = db.prepare("SELECT COUNT(*) as c FROM pharmacy_records WHERE status = 'Active' AND refill_due_date < date('now')").get().c;

  const topConditions = db.prepare(`
    SELECT icd_codes, COUNT(*) as count FROM claims
    WHERE icd_codes IS NOT NULL AND icd_codes != ''
    GROUP BY icd_codes ORDER BY count DESC LIMIT 6
  `).all();

  const pendingAuths  = db.prepare("SELECT COUNT(*) as c FROM authorizations WHERE status = 'Pending'").get().c;
  const approvedAuths = db.prepare("SELECT COUNT(*) as c FROM authorizations WHERE status = 'Approved'").get().c;
  const deniedAuths   = db.prepare("SELECT COUNT(*) as c FROM authorizations WHERE status = 'Denied'").get().c;

  res.json({
    total, korean, english, other,
    criticalLabs, abnormalLabs,
    activeMeds, overdueMeds,
    topConditions,
    pendingAuths, approvedAuths, deniedAuths,
  });
});

// ── GET /api/patients/:pid  — full patient profile
router.get('/:pid', (req, res) => {
  const { pid } = req.params;
  const patient = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(pid);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const eligibility    = db.prepare('SELECT * FROM eligibility WHERE patient_id = ? ORDER BY updated_at DESC').all(pid);
  const claims         = db.prepare('SELECT * FROM claims WHERE patient_id = ? ORDER BY dos DESC').all(pid);
  const authorizations = db.prepare('SELECT * FROM authorizations WHERE patient_id = ? ORDER BY updated_at DESC').all(pid);
  const labs           = db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY result_date DESC').all(pid);
  const medications    = db.prepare('SELECT * FROM medication_requests WHERE patient_id = ? ORDER BY prescribed_date DESC').all(pid);
  const pharmacy       = db.prepare('SELECT * FROM pharmacy_records WHERE patient_id = ? ORDER BY refill_due_date ASC').all(pid);
  const pcp            = db.prepare('SELECT * FROM pcp_providers WHERE patient_id = ? LIMIT 1').get(pid);
  const phRequests     = db.prepare('SELECT * FROM pharmacy_requests WHERE patient_id = ? ORDER BY requested_at DESC LIMIT 20').all(pid);

  res.json({
    patient,
    eligibility,
    claims,
    authorizations,
    labs,
    medications,
    pharmacy,
    pcp,
    pharmacyRequests: phRequests,
  });
});

// ── PUT /api/patients/:pid  — update patient fields
router.put('/:pid', (req, res) => {
  const { pid } = req.params;
  const allowed = ['first_name','last_name','dob','gender','phone','email','address','city','state','zip','language'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields' });

  updates.updated_at = new Date().toISOString();
  const cols = Object.keys(updates);
  db.prepare(`UPDATE patients SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE patient_id = ?`)
    .run(...cols.map(c => updates[c]), pid);

  res.json({ success: true });
});

module.exports = router;
