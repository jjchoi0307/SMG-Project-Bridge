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

module.exports = router;
