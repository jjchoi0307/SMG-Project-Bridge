/**
 * seed-visit-notes.js
 * Generates 2–3 realistic After Visit Summary (AVS) notes per patient
 * and inserts them into the visit_notes table.
 *
 * Run once: node server/seed-visit-notes.js
 */

'use strict';

const { db, initDb } = require('./database');

initDb();

// ── Templates ────────────────────────────────────────────────────────────────

const visitTypes = ['Annual Wellness', 'Follow-up', 'Follow-up', 'Sick Visit', 'Telehealth'];

const diagnosesByType = {
  'Annual Wellness': [
    ['Type 2 diabetes — stable, well controlled', 'High blood pressure — stable on medication'],
    ['Hypertension — controlled', 'Hyperlipidemia — improving'],
    ['Obesity — working on lifestyle changes', 'Pre-diabetes — diet management'],
    ['Chronic kidney disease stage 2 — monitoring', 'Anemia — under treatment'],
    ['Hypothyroidism — TSH normal on current dose', 'Vitamin D deficiency — supplementing'],
  ],
  'Follow-up': [
    ['High blood pressure — watching closely', 'Type 2 diabetes — stable'],
    ['Hypertension — medication adjusted', 'Anxiety — improving with therapy'],
    ['Asthma — well controlled', 'Seasonal allergies — symptomatic relief'],
    ['Osteoarthritis — pain management ongoing', 'GERD — reducing symptoms'],
    ['Heart failure — compensated', 'Atrial fibrillation — rate controlled'],
  ],
  'Sick Visit': [
    ['Acute upper respiratory infection — viral'],
    ['Urinary tract infection — antibiotics prescribed'],
    ['Acute sinusitis — symptomatic treatment'],
    ['Lower back pain — muscle strain'],
    ['Acute bronchitis — supportive care'],
  ],
  'Telehealth': [
    ['Medication refill review — no changes needed', 'Blood pressure monitoring — stable'],
    ['Lab result review — all values improved', 'Diabetes management check-in'],
    ['Post-procedure follow-up — healing well'],
    ['Mental health check-in — stable'],
    ['Preventive care consultation'],
  ],
};

const reasonsByType = {
  'Annual Wellness': [
    'Annual wellness exam and preventive care review.',
    'Yearly health check-up and routine screening.',
    'Annual physical and chronic disease management review.',
  ],
  'Follow-up': [
    'Blood pressure follow-up and routine medication review.',
    'Follow-up visit for chronic condition management.',
    'Medication adjustment and symptom monitoring follow-up.',
    'Post-lab result review and care plan update.',
  ],
  'Sick Visit': [
    'Acute illness evaluation and treatment.',
    'Symptom assessment and management.',
    'Urgent care visit for new-onset symptoms.',
  ],
  'Telehealth': [
    'Virtual visit for medication refill and monitoring.',
    'Telehealth consultation for lab result review.',
    'Remote check-in for chronic disease management.',
  ],
};

const discussionsByType = {
  'Annual Wellness': [
    'Overall, you are doing well. Your weight, heart rate, and oxygen levels all look healthy. We talked about your chronic conditions — both are being managed. I ordered blood tests to check your key values. We also discussed preventive screenings and exercise goals.',
    'Your vitals were normal today. We reviewed your medications and there were no changes needed. I encouraged you to maintain your current exercise routine and diet. Preventive labs have been ordered.',
    'A comprehensive health review was completed today. All your screenings are up to date. We discussed nutrition, physical activity, and medication adherence. Labs were ordered to monitor your chronic conditions.',
  ],
  'Follow-up': [
    'Your blood pressure was a little elevated today. We\'re keeping a close watch. Your blood sugar is stable — good job staying consistent with your diet. We reviewed your current medications and there are no changes.',
    'Lab results from your last visit look improved. We discussed your progress and adjusted your medication slightly. Continue with your current lifestyle plan.',
    'You\'re making good progress. Symptoms have improved since last visit. We reviewed your medication schedule and discussed the importance of adherence.',
    'Your condition is well controlled. We reviewed your recent home monitoring data and everything looks stable. Keep up the great work.',
  ],
  'Sick Visit': [
    'You came in today with symptoms consistent with a viral infection. I recommended rest, fluids, and over-the-counter symptomatic relief. Antibiotics are not needed at this time.',
    'Your symptoms were evaluated and a short course of treatment was prescribed. Rest and stay well hydrated. Call the office if symptoms worsen in the next 48 hours.',
    'Examination revealed mild inflammation. A short course of treatment has been started. Follow up if not improving in 5–7 days.',
  ],
  'Telehealth': [
    'We connected via telehealth today to review your recent labs and current medications. Everything looks stable. No medication changes at this time.',
    'Virtual visit completed. Your blood pressure readings at home are within target range. Continue current medications.',
    'We reviewed your progress remotely. You\'re doing well. Refills have been sent to your pharmacy.',
  ],
};

const nextStepsByType = {
  'Annual Wellness': [
    ['Complete blood work at any SMG lab location', 'Return for follow-up in 6–8 weeks', 'Continue all current medications as directed', 'Aim for 30 minutes of light exercise most days'],
    ['Schedule any overdue screenings', 'Return for annual wellness next year', 'Maintain healthy diet and exercise routine', 'Take all medications as prescribed'],
    ['Complete ordered labs within 2 weeks', 'Follow up in 3 months to review results', 'Continue current medications — no changes', 'Stay hydrated and maintain healthy weight'],
  ],
  'Follow-up': [
    ['Return in 4 weeks — appointment will be scheduled', 'Continue taking all medications as directed', 'Monitor blood pressure at home daily', 'Reduce sodium intake — aim for less than 2,300mg per day'],
    ['Follow up in 6 weeks or sooner if symptoms change', 'Take new medication as prescribed — one tablet daily with food', 'Call office if you experience any side effects'],
    ['Continue current medications — no changes at this time', 'Check in with office in 8 weeks', 'Keep a symptom diary to track any changes'],
  ],
  'Sick Visit': [
    ['Rest at home and increase fluid intake', 'Take medications as prescribed for the next 7 days', 'Return to office or call if symptoms worsen or don\'t improve in 5 days'],
    ['Complete the full course of antibiotics — do not stop early', 'Rest and increase fluids', 'Return if fever persists beyond 3 days'],
    ['Use over-the-counter medications for symptomatic relief', 'Apply ice or heat as directed', 'Limit activity for the next few days and follow up if needed'],
  ],
  'Telehealth': [
    ['Pick up prescription refills from your pharmacy', 'Continue home monitoring and log your readings', 'Return for in-person visit in 3 months'],
    ['No medication changes — continue as directed', 'Schedule in-person follow-up in 2 months', 'Call if any new symptoms arise'],
    ['Labs ordered — please complete within 1 week', 'Follow up after lab results are received', 'Continue all medications as prescribed'],
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dateOffset(days) {
  const d = new Date('2026-04-07');
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function signedAt(dateStr) {
  const hrs = [9,10,11,13,14,15,16];
  const mins = ['00','15','30','45'];
  return dateStr + 'T' + pick(hrs).toString().padStart(2,'0') + ':' + pick(mins) + ':00';
}

// ── Seed ─────────────────────────────────────────────────────────────────────

const patients = db.prepare(`
  SELECT p.patient_id, p.first_name, p.last_name,
         pc.provider_name, pc.practice_name, pc.provider_npi
  FROM patients p
  LEFT JOIN pcp_providers pc ON p.patient_id = pc.patient_id
`).all();

console.log(`[seed-visit-notes] Found ${patients.length} patients. Generating notes...`);

// Check if already seeded
const existing = db.prepare('SELECT COUNT(*) as c FROM visit_notes').get().c;
if (existing > 0) {
  console.log(`[seed-visit-notes] Already seeded (${existing} records). Skipping.`);
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO visit_notes
    (patient_id, visit_type, visit_date, provider_name, provider_npi, practice_name,
     reason_for_visit, discussion, diagnoses, medications, next_steps, signed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function insertMany(rows) {
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      insert.run(
        r.patient_id, r.visit_type, r.visit_date, r.provider_name,
        r.provider_npi, r.practice_name, r.reason_for_visit,
        r.discussion, r.diagnoses, r.medications, r.next_steps, r.signed_at
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const rows = [];

for (const pt of patients) {
  const provName  = pt.provider_name  || 'Dr. James Park';
  const provNpi   = pt.provider_npi   || '1234567890';
  const pracName  = pt.practice_name  || 'SMG Medical Group';

  // Determine how many notes: 2 or 3
  const numNotes = (Math.random() < 0.5) ? 2 : 3;

  // Note offsets: most recent first
  // Annual wellness ~90–180 days ago, follow-ups more recent
  const offsets = numNotes === 3
    ? [pick([14,21,28,35]), pick([45,60,75,90]), pick([120,150,180])]
    : [pick([21,28,42,56]), pick([90,120,150,180])];

  offsets.sort((a, b) => a - b); // ascending so we can pair with types

  // Assign visit types: oldest = Annual Wellness, rest = Follow-up or other
  const types = [];
  types.push('Annual Wellness');
  for (let i = 1; i < numNotes; i++) {
    types.push(pick(['Follow-up', 'Follow-up', 'Telehealth']));
  }
  // Reverse so most recent is first in array (we'll insert in date order)
  // Actually keep them date-ordered oldest → newest
  types.reverse(); // now first element matches smallest offset (most recent)

  // Build note rows
  for (let i = 0; i < numNotes; i++) {
    const vtype    = types[i];
    const daysAgo  = offsets[numNotes - 1 - i]; // match offsets from largest to smallest
    const vdate    = dateOffset(daysAgo);
    const diagList = pick(diagnosesByType[vtype] || diagnosesByType['Follow-up']);
    const nexList  = pick(nextStepsByType[vtype] || nextStepsByType['Follow-up']);
    // Build a simple medications summary from diagnoses
    const medsText = diagList.length > 1
      ? 'Continue all current medications as prescribed.'
      : 'No medication changes at this time.';

    rows.push({
      patient_id:       pt.patient_id,
      visit_type:       vtype,
      visit_date:       vdate,
      provider_name:    provName,
      provider_npi:     provNpi,
      practice_name:    pracName,
      reason_for_visit: pick(reasonsByType[vtype] || reasonsByType['Follow-up']),
      discussion:       pick(discussionsByType[vtype] || discussionsByType['Follow-up']),
      diagnoses:        JSON.stringify(diagList),
      medications:      medsText,
      next_steps:       JSON.stringify(nexList),
      signed_at:        signedAt(vdate),
    });
  }
}

console.log(`[seed-visit-notes] Inserting ${rows.length} visit notes...`);
insertMany(rows);
console.log('[seed-visit-notes] Done!');
