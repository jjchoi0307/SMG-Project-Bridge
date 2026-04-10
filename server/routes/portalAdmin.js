const express = require('express');
const { db } = require('../database');

const router = express.Router();

// ── Normalize a DB row to the shape clients expect ──────────────────────────
function normalizeAppt(r) {
  return {
    id:           r.id,
    patientId:    r.patient_id,
    patientName:  r.patient_name || '',
    date:         r.preferred_date,
    time:         r.preferred_time,
    reason:       r.reason,
    status:       r.status,
    scheduledTime: r.scheduled_time,
    newDate:      r.new_date,
    submittedAt:  r.submitted_at,
    confirmedAt:  r.confirmed_at,
    rescheduledAt: r.rescheduled_at,
    cancelledAt:  r.cancelled_at,
  };
}

function normalizeConsent(c) {
  return {
    id:            c.id,
    patientId:     c.patient_id,
    patientName:   c.patient_name || '',
    caregiverName: c.caregiver_name,
    caregiverPhone: c.caregiver_phone,
    relationship:  c.relationship,
    status:        c.status,
    requestedAt:   c.submitted_at,
    respondedAt:   c.responded_at,
    permissions: {
      appointments: !!c.perms_appointments,
      medications:  !!c.perms_medications,
      labResults:   !!c.perms_lab_results,
      visitNotes:   false,
    },
  };
}

// ── GET /api/appointments
// Returns all appointment requests, with optional ?status= and ?date= filters.
router.get('/appointments', (req, res) => {
  const { status, date } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const where = [], params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (date)   { where.push('(preferred_date = ? OR new_date = ?)'); params.push(date, date); }
  const sql = 'SELECT * FROM appointment_requests'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY preferred_date ASC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  const pending = db.prepare("SELECT COUNT(*) as cnt FROM appointment_requests WHERE status='pending'").get().cnt;
  res.json({ appointments: rows.map(normalizeAppt), pendingCount: pending });
});

// ── PUT /api/appointments/:id
// Admin/doctor confirms, reschedules, or cancels an appointment.
router.put('/appointments/:id', (req, res) => {
  const { status, scheduledTime, newDate } = req.body;
  const r = db.prepare('SELECT * FROM appointment_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Appointment not found' });
  const now = new Date().toISOString();
  if (status === 'confirmed') {
    db.prepare('UPDATE appointment_requests SET status=?, scheduled_time=?, confirmed_at=? WHERE id=?')
      .run('confirmed', scheduledTime || '09:00', now, req.params.id);
  } else if (status === 'rescheduled') {
    if (!newDate) return res.status(400).json({ error: 'newDate required for rescheduled status' });
    db.prepare('UPDATE appointment_requests SET status=?, new_date=?, scheduled_time=?, rescheduled_at=? WHERE id=?')
      .run('rescheduled', newDate, scheduledTime || '09:00', now, req.params.id);
  } else if (status === 'cancelled') {
    db.prepare('UPDATE appointment_requests SET status=?, cancelled_at=? WHERE id=?')
      .run('cancelled', now, req.params.id);
  } else {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updated = db.prepare('SELECT * FROM appointment_requests WHERE id = ?').get(req.params.id);
  res.json(normalizeAppt(updated));
});

// ── GET /api/consents
// Returns all caregiver consent records with optional ?status= and ?search= filters.
router.get('/consents', (req, res) => {
  const { status, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 500, 1000);
  const where = [], params = [];
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (search) {
    const s = '%' + search + '%';
    where.push('(patient_name LIKE ? OR caregiver_name LIKE ? OR patient_id LIKE ?)');
    params.push(s, s, s);
  }
  const sql = 'SELECT * FROM caregiver_consents'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY submitted_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM caregiver_consents').get().cnt;
  const pending = db.prepare("SELECT COUNT(*) as cnt FROM caregiver_consents WHERE status='pending'").get().cnt;
  res.json({ consents: rows.map(normalizeConsent), total, pendingCount: pending });
});

// ── PUT /api/consents/:id
// Admin/doctor approves or declines a caregiver consent request.
router.put('/consents/:id', (req, res) => {
  const { status } = req.body;
  if (!['approved', 'declined'].includes(status)) return res.status(400).json({ error: 'status must be approved or declined' });
  const c = db.prepare('SELECT * FROM caregiver_consents WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Consent not found' });
  db.prepare('UPDATE caregiver_consents SET status=?, responded_at=? WHERE id=?')
    .run(status, new Date().toISOString(), req.params.id);
  const updated = db.prepare('SELECT * FROM caregiver_consents WHERE id = ?').get(req.params.id);
  res.json(normalizeConsent(updated));
});

module.exports = router;
