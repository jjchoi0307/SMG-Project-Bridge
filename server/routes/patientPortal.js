const express = require('express');
const { db } = require('../database');

const router = express.Router();

// ── GET /api/patient-portal/lookup/:id
// Public endpoint — no auth required. Used by the Bridge patient/caregiver app.
// Accepts patient_id (SMG-XXXXXXX) or insurance member_id as :id.
// Returns the safe patient-facing data subset needed to populate the app.
router.get('/lookup/:id', (req, res) => {
  const id = req.params.id.trim();

  // 1. Try exact patient_id match
  let patient = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(id);

  // 2. Fallback: look up by insurance member_id
  if (!patient) {
    const elig = db.prepare(
      'SELECT patient_id FROM eligibility WHERE member_id = ? LIMIT 1'
    ).get(id);
    if (elig) {
      patient = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(elig.patient_id);
    }
  }

  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const pid = patient.patient_id;

  const eligibility = db.prepare(`
    SELECT * FROM eligibility WHERE patient_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(pid);

  const pcp = db.prepare(
    'SELECT * FROM pcp_providers WHERE patient_id = ? LIMIT 1'
  ).get(pid);

  const medications = db.prepare(`
    SELECT * FROM medication_requests WHERE patient_id = ? AND status = 'Active'
    ORDER BY prescribed_date DESC LIMIT 10
  `).all(pid);

  const authorizations = db.prepare(`
    SELECT * FROM authorizations WHERE patient_id = ? ORDER BY requested_date DESC LIMIT 5
  `).all(pid);

  const labs = db.prepare(`
    SELECT * FROM lab_results WHERE patient_id = ?
    ORDER BY result_date DESC LIMIT 8
  `).all(pid);

  const pharmacy = db.prepare(`
    SELECT * FROM pharmacy_records WHERE patient_id = ?
    ORDER BY refill_due_date ASC LIMIT 8
  `).all(pid);

  const visitNotes = db.prepare(`
    SELECT * FROM visit_notes WHERE patient_id = ?
    ORDER BY visit_date DESC LIMIT 6
  `).all(pid);

  res.json({
    patient,
    eligibility: eligibility ? [eligibility] : [],
    pcp: pcp || null,
    medications,
    authorizations,
    labs,
    pharmacy,
    visitNotes,
  });
});

// ── POST /api/patient-portal/appointments
// Public — patient submits an appointment request from the Bridge app.
router.post('/appointments', (req, res) => {
  const { patientId, patientName, date, time, reason } = req.body;
  if (!patientId || !date) return res.status(400).json({ error: 'patientId and date required' });
  const id = 'req-' + Date.now();
  db.prepare(`
    INSERT INTO appointment_requests (id, patient_id, patient_name, preferred_date, preferred_time, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, patientId, patientName || '', date, time || 'morning', reason || 'General visit');
  res.json({ id, status: 'pending' });
});

// ── GET /api/patient-portal/appointments?patientId=xxx
// Public — patient polls their own appointment request list.
router.get('/appointments', (req, res) => {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId required' });
  const appointments = db.prepare(`
    SELECT * FROM appointment_requests WHERE patient_id = ? ORDER BY preferred_date ASC
  `).all(patientId);
  res.json({ appointments });
});

// ── POST /api/patient-portal/consents
// Public — caregiver submits a consent request.
router.post('/consents', (req, res) => {
  const { patientId, patientName, caregiverName, caregiverPhone, relationship, permissions } = req.body;
  if (!patientId || !caregiverName) return res.status(400).json({ error: 'patientId and caregiverName required' });
  const id = 'consent-' + Date.now();
  const p = permissions || {};
  db.prepare(`
    INSERT INTO caregiver_consents
      (id, patient_id, patient_name, caregiver_name, caregiver_phone, relationship, perms_appointments, perms_medications, perms_lab_results)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, patientId, patientName || '', caregiverName, caregiverPhone || '', relationship || '',
    p.appointments ? 1 : 0, p.medications ? 1 : 0, p.labResults ? 1 : 0);
  res.json({ id, status: 'pending' });
});

// ── GET /api/patient-portal/consents/:id
// Public — caregiver polls consent status by consent ID.
router.get('/consents/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM caregiver_consents WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Consent not found' });
  res.json({
    id: c.id,
    status: c.status,
    permissions: {
      appointments: !!c.perms_appointments,
      medications:  !!c.perms_medications,
      labResults:   !!c.perms_lab_results,
      visitNotes:   false,
    }
  });
});

module.exports = router;
