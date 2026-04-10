const express = require('express');
const { db } = require('../database');
const { cached, invalidate } = require('../utils/cache');
const { patientScope, patientIdScope, mergeWhere } = require('../utils/orgScope');

const router = express.Router();

// ── GET /api/patients  — paginated list with search + org scoping
router.get('/', (req, res) => {
  const { q, broker, page = 1, limit = 50, sort = 'last_name', dir = 'asc' } = req.query;
  const offset  = (parseInt(page) - 1) * parseInt(limit);
  const allowed = ['last_name', 'first_name', 'dob', 'patient_id', 'updated_at'];
  const sortCol = allowed.includes(sort) ? sort : 'last_name';
  const sortDir = dir === 'desc' ? 'DESC' : 'ASC';

  // Base conditions
  const conditions = [];
  const params     = [];

  if (q) {
    const like = `%${q}%`;
    conditions.push('(p.last_name LIKE ? OR p.first_name LIKE ? OR p.patient_id LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)');
    params.push(like, like, like, like, like);
  }
  if (broker) {
    conditions.push('p.assigned_broker = ?');
    params.push(broker);
  }

  // Org scope — broker sees only their org; physician sees only their panel
  const scope = patientScope(req.user);
  const where = mergeWhere(conditions, scope.conditions);
  const allParams = [...params, ...scope.params];

  const total = db.prepare(`SELECT COUNT(*) as c FROM patients p ${where}`).get(...allParams).c;

  // ── Fetch paginated patient IDs (base data only — avoids N+1) ─────────────
  const patientRows = db.prepare(`
    SELECT p.*
    FROM patients p
    ${where}
    ORDER BY p.${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...allParams, parseInt(limit), offset);

  if (patientRows.length === 0) {
    return res.json({ total, page: parseInt(page), limit: parseInt(limit), patients: [] });
  }

  // ── Fetch aggregates for this page's patient IDs in 5 set-based queries ───
  // This replaces 5 correlated subqueries (250 queries per page) with 5 bulk queries.
  const pids        = patientRows.map(p => p.patient_id);
  const holders     = pids.map(() => '?').join(',');

  const eligRows = db.prepare(`
    SELECT e.patient_id, e.status
    FROM eligibility e
    INNER JOIN (
      SELECT patient_id, MAX(updated_at) AS max_u FROM eligibility
      WHERE patient_id IN (${holders}) GROUP BY patient_id
    ) latest ON e.patient_id = latest.patient_id AND e.updated_at = latest.max_u
  `).all(...pids);
  const eligMap = Object.fromEntries(eligRows.map(r => [r.patient_id, r.status]));

  const pcpRows = db.prepare(`
    SELECT patient_id, provider_name FROM pcp_providers
    WHERE patient_id IN (${holders})
    GROUP BY patient_id
  `).all(...pids);
  const pcpMap = Object.fromEntries(pcpRows.map(r => [r.patient_id, r.provider_name]));

  const claimRows = db.prepare(`
    SELECT patient_id, COUNT(*) as c FROM claims
    WHERE patient_id IN (${holders}) GROUP BY patient_id
  `).all(...pids);
  const claimMap = Object.fromEntries(claimRows.map(r => [r.patient_id, r.c]));

  const authRows = db.prepare(`
    SELECT patient_id, COUNT(*) as c FROM authorizations
    WHERE patient_id IN (${holders}) AND status = 'Pending' GROUP BY patient_id
  `).all(...pids);
  const authMap = Object.fromEntries(authRows.map(r => [r.patient_id, r.c]));

  const rxRows = db.prepare(`
    SELECT patient_id, COUNT(*) as c FROM pharmacy_records
    WHERE patient_id IN (${holders}) GROUP BY patient_id
  `).all(...pids);
  const rxMap = Object.fromEntries(rxRows.map(r => [r.patient_id, r.c]));

  const patients = patientRows.map(p => ({
    ...p,
    elig_status:   eligMap[p.patient_id]  || null,
    pcp_name:      pcpMap[p.patient_id]   || null,
    claim_count:   claimMap[p.patient_id] || 0,
    pending_auths: authMap[p.patient_id]  || 0,
    rx_count:      rxMap[p.patient_id]    || 0,
  }));

  res.json({ total, page: parseInt(page), limit: parseInt(limit), patients });
});

// ── GET /api/patients/stats  — dashboard summary stats (cached 30s)
router.get('/stats', (req, res) => {
  const scope = patientIdScope(req.user);
  const scopeWhere = scope.conditions.length
    ? `WHERE ${scope.conditions.join(' AND ')}`
    : '';

  // Build a cache key scoped to the user's org so different tenants get different caches
  const cacheKey = `stats:patients:${req.user?.orgId || req.user?.npi || 'all'}`;

  const stats = cached(cacheKey, 30_000, () => ({
    totalPatients:     db.prepare(`SELECT COUNT(*) as c FROM patients p ${scopeWhere.replace(/patient_id/g, 'p.patient_id')}`).get(...scope.params).c,
    activeEligibility: db.prepare(`SELECT COUNT(DISTINCT patient_id) as c FROM eligibility WHERE status = 'Active' ${scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : ''}`).get(...scope.params).c,
    pendingClaims:     db.prepare(`SELECT COUNT(*) as c FROM claims WHERE status = 'Pending' ${scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : ''}`).get(...scope.params).c,
    pendingAuths:      db.prepare(`SELECT COUNT(*) as c FROM authorizations WHERE status = 'Pending' ${scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : ''}`).get(...scope.params).c,
    criticalLabs:      db.prepare(`SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag = 'Critical' ${scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : ''}`).get(...scope.params).c,
    refillsDue:        db.prepare(`SELECT COUNT(*) as c FROM pharmacy_records WHERE refill_due_date <= date('now', '+7 days') AND status = 'Active' ${scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : ''}`).get(...scope.params).c,
    totalFiles:        db.prepare('SELECT COUNT(*) as c FROM excel_files').get().c,
    lastSync:          db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(MAX(last_synced), MAX(uploaded_at))) as s FROM excel_files").get().s,
  }));
  res.json(stats);
});

// ── GET /api/patients/intel  — population + clinical intel (MUST be before /:pid)
router.get('/intel', (req, res) => {
  const scope = patientIdScope(req.user);
  const extra = scope.conditions.length ? 'AND ' + scope.conditions.join(' AND ') : '';

  const total   = db.prepare(`SELECT COUNT(*) as c FROM patients WHERE 1=1 ${extra}`).get(...scope.params).c;
  const korean  = db.prepare(`SELECT COUNT(*) as c FROM patients WHERE language = 'Korean' ${extra}`).get(...scope.params).c;
  const english = db.prepare(`SELECT COUNT(*) as c FROM patients WHERE (language = 'English' OR language IS NULL OR language = '') ${extra}`).get(...scope.params).c;
  const other   = Math.max(0, total - korean - english);

  const criticalLabs = db.prepare(`SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag = 'Critical' ${extra}`).get(...scope.params).c;
  const abnormalLabs = db.prepare(`SELECT COUNT(DISTINCT patient_id) as c FROM lab_results WHERE flag IN ('High','Low','Critical') ${extra}`).get(...scope.params).c;

  const activeMeds  = db.prepare(`SELECT COUNT(*) as c FROM pharmacy_records WHERE status = 'Active' ${extra}`).get(...scope.params).c;
  const overdueMeds = db.prepare(`SELECT COUNT(*) as c FROM pharmacy_records WHERE status = 'Active' AND refill_due_date < date('now') ${extra}`).get(...scope.params).c;

  const topConditions = db.prepare(`
    SELECT icd_codes, COUNT(*) as count FROM claims
    WHERE icd_codes IS NOT NULL AND icd_codes != '' ${extra}
    GROUP BY icd_codes ORDER BY count DESC LIMIT 6
  `).all(...scope.params);

  const pendingAuths  = db.prepare(`SELECT COUNT(*) as c FROM authorizations WHERE status = 'Pending' ${extra}`).get(...scope.params).c;
  const approvedAuths = db.prepare(`SELECT COUNT(*) as c FROM authorizations WHERE status = 'Approved' ${extra}`).get(...scope.params).c;
  const deniedAuths   = db.prepare(`SELECT COUNT(*) as c FROM authorizations WHERE status = 'Denied' ${extra}`).get(...scope.params).c;

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
  const scope   = patientScope(req.user);
  const where   = mergeWhere(['p.patient_id = ?'], scope.conditions);

  const patient = db.prepare(`SELECT p.* FROM patients p ${where}`).get(pid, ...scope.params);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const eligibility    = db.prepare('SELECT * FROM eligibility WHERE patient_id = ? ORDER BY updated_at DESC').all(pid);
  const claims         = db.prepare('SELECT * FROM claims WHERE patient_id = ? ORDER BY dos DESC').all(pid);
  const authorizations = db.prepare('SELECT * FROM authorizations WHERE patient_id = ? ORDER BY updated_at DESC').all(pid);
  const labs           = db.prepare('SELECT * FROM lab_results WHERE patient_id = ? ORDER BY result_date DESC').all(pid);
  const medications    = db.prepare('SELECT * FROM medication_requests WHERE patient_id = ? ORDER BY prescribed_date DESC').all(pid);
  const pharmacy       = db.prepare('SELECT * FROM pharmacy_records WHERE patient_id = ? ORDER BY refill_due_date ASC').all(pid);
  const pcp            = db.prepare('SELECT * FROM pcp_providers WHERE patient_id = ? LIMIT 1').get(pid);
  const phRequests     = db.prepare('SELECT * FROM pharmacy_requests WHERE patient_id = ? ORDER BY requested_at DESC LIMIT 20').all(pid);
  const visitNotes     = db.prepare('SELECT * FROM visit_notes WHERE patient_id = ? ORDER BY visit_date DESC').all(pid);

  res.json({ patient, eligibility, claims, authorizations, labs, medications, pharmacy, pcp, pharmacyRequests: phRequests, visitNotes });
});

// ── PUT /api/patients/:pid  — update patient fields
router.put('/:pid', (req, res) => {
  const { pid }   = req.params;
  const scope     = patientScope(req.user);
  const checkWhere = mergeWhere(['patient_id = ?'], scope.conditions);

  const exists = db.prepare(`SELECT patient_id FROM patients p ${checkWhere}`).get(pid, ...scope.params);
  if (!exists) return res.status(404).json({ error: 'Patient not found' });

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
