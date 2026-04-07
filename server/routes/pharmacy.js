const express = require('express');
const { db } = require('../database');
const { broadcast } = require('../utils/watcher');
const { cached } = require('../utils/cache');

const router = express.Router();

// ── GET /api/pharmacy/requests  — all pharmacy requests (admin queue view)
// MUST be before /:pid to avoid route conflict
router.get('/requests', (req, res) => {
  const { status = '', limit = 100, offset = 0 } = req.query;
  const whereClause = status ? 'WHERE pr.status = ?' : '';
  const params = status ? [status, parseInt(limit), parseInt(offset)] : [parseInt(limit), parseInt(offset)];

  const rows = db.prepare(`
    SELECT pr.*,
      p.first_name, p.last_name, p.phone, p.language
    FROM pharmacy_requests pr
    LEFT JOIN patients p ON pr.patient_id = p.patient_id
    ${whereClause}
    ORDER BY pr.requested_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM pharmacy_requests ${whereClause}
  `).get(...(status ? [status] : [])).c;

  res.json({ requests: rows, total });
});

// ── GET /api/pharmacy/refills/due  — all patients with refills due in next N days
router.get('/refills/due', (req, res) => {
  const { days = 7 } = req.query;
  const rows = db.prepare(`
    SELECT pr.*, p.first_name, p.last_name, p.phone, p.language,
      pcp.provider_name as pcp_name
    FROM pharmacy_records pr
    JOIN patients p ON pr.patient_id = p.patient_id
    LEFT JOIN pcp_providers pcp ON pr.patient_id = pcp.patient_id
    WHERE pr.status = 'Active'
      AND pr.refill_due_date <= date('now', '+' || ? || ' days')
      AND pr.refill_due_date >= date('now', '-1 days')
    ORDER BY pr.refill_due_date ASC
  `).all(parseInt(days));
  res.json(rows);
});

// ── GET /api/pharmacy/dashboard  — pharmacy-wide stats (cached 60s)
router.get('/dashboard', (req, res) => {
  const data = cached('pharmacy:dashboard', 60_000, () => {
    const dueSoon = db.prepare(`
      SELECT COUNT(*) as c FROM pharmacy_records
      WHERE status = 'Active' AND refill_due_date <= date('now', '+7 days')
    `).get().c;

    const overdue = db.prepare(`
      SELECT COUNT(*) as c FROM pharmacy_records
      WHERE status = 'Active' AND refill_due_date < date('now')
    `).get().c;

    const pendingRequests = db.prepare(`
      SELECT COUNT(*) as c FROM pharmacy_requests WHERE status IN ('Sent','Processing')
    `).get().c;

    const topMeds = db.prepare(`
      SELECT medication_name, COUNT(*) as count
      FROM pharmacy_records WHERE status = 'Active'
      GROUP BY medication_name ORDER BY count DESC LIMIT 10
    `).all();

    return { dueSoon, overdue, pendingRequests, topMeds };
  });
  res.json(data);
});

// ── POST /api/pharmacy/request  — inject a refill/transfer request to pharmacy
router.post('/request', (req, res) => {
  const {
    patient_id, pharmacy_record_id, request_type,
    medication_name, pharmacy_name, requested_by, notes
  } = req.body;

  if (!patient_id || !request_type) {
    return res.status(400).json({ error: 'patient_id and request_type required' });
  }

  const patient = db.prepare('SELECT patient_id FROM patients WHERE patient_id = ?').get(patient_id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const info = db.prepare(`
    INSERT INTO pharmacy_requests
      (patient_id, pharmacy_record_id, request_type, medication_name, pharmacy_name, requested_by, status)
    VALUES (?, ?, ?, ?, ?, ?, 'Processing')
  `).run(patient_id, pharmacy_record_id || null, request_type,
         medication_name, pharmacy_name, requested_by || 'SMG Bridge');

  const reqId = info.lastInsertRowid;

  broadcast('pharmacy-request', {
    requestId: reqId,
    patient_id,
    medication_name,
    pharmacy_name,
    request_type,
    status: 'Processing',
    requested_by: requested_by || 'SMG Bridge',
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    requestId: reqId,
    status: 'Processing',
    message: `${request_type} request sent to ${pharmacy_name || 'pharmacy'} for ${medication_name}`,
    timestamp: new Date().toISOString(),
  });
});

// ── PUT /api/pharmacy/request/:id  — update request status
router.put('/request/:id', (req, res) => {
  const { status, response_msg } = req.body;
  db.prepare(`
    UPDATE pharmacy_requests SET
      status = ?,
      response_msg = ?,
      completed_at = CASE WHEN ? IN ('Completed','Failed') THEN datetime('now') ELSE completed_at END
    WHERE id = ?
  `).run(status, response_msg || null, status, req.params.id);

  broadcast('pharmacy-request-updated', { requestId: parseInt(req.params.id), status, timestamp: new Date().toISOString() });
  res.json({ success: true });
});

// ── GET /api/pharmacy/:pid  — patient's pharmacy records
router.get('/:pid', (req, res) => {
  const records = db.prepare(`
    SELECT pr.*,
      (SELECT COUNT(*) FROM pharmacy_requests WHERE pharmacy_record_id = pr.id AND status IN ('Sent','Processing')) as pending_requests
    FROM pharmacy_records pr
    WHERE pr.patient_id = ?
    ORDER BY pr.refill_due_date ASC
  `).all(req.params.pid);
  res.json(records);
});

// ── GET /api/pharmacy/:pid/requests  — pharmacy request history for one patient
router.get('/:pid/requests', (req, res) => {
  const requests = db.prepare(`
    SELECT * FROM pharmacy_requests WHERE patient_id = ? ORDER BY requested_at DESC
  `).all(req.params.pid);
  res.json(requests);
});

module.exports = router;
