#!/usr/bin/env node
/**
 * SMG Bridge — Unified Executive Demo Generator
 * ──────────────────────────────────────────────
 * Usage: npm run demo   (requires seeded database)
 * Output: client/bridge-demo.html  (~2MB, no server needed)
 *
 * Architecture:
 *  - Each portal (admin / doctor / members) is its own complete HTML
 *  - A global mock-fetch intercepts every /api/* call → returns real DB data
 *  - Portals are base64-encoded and loaded into an <iframe> via blob URL
 *    (this keeps each portal's JS in its own scope, no naming conflicts)
 *  - A switcher bar at the bottom lets you toggle between all 3 portals
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ── Config ────────────────────────────────────────────────────────────────
const ROOT        = __dirname;
const DB_PATH     = path.join(ROOT, 'data', 'bridge.db');
const LOGO_PATH   = path.join(ROOT, 'smg.logo.transparent.v1.png');
const ADMIN_SRC   = path.join(ROOT, 'client', 'bridge-admin.html');
const DOCTOR_SRC  = path.join(ROOT, 'client', 'bridge-doctor.html');
const MEMBERS_SRC = path.join(ROOT, 'client', 'bridge-members-v2.html');
const OUT_PATH    = path.join(ROOT, 'client', 'bridge-demo.html');

function die(msg) { console.error('\u2717', msg); process.exit(1); }
function ok(msg)  { console.log('\u2713', msg); }

if (!fs.existsSync(DB_PATH))     die('No database. Run: npm run seed');
if (!fs.existsSync(LOGO_PATH))   die('Logo not found: ' + LOGO_PATH);
if (!fs.existsSync(ADMIN_SRC))   die('Missing: client/bridge-admin.html');
if (!fs.existsSync(DOCTOR_SRC))  die('Missing: client/bridge-doctor.html');
if (!fs.existsSync(MEMBERS_SRC)) die('Missing: client/bridge-members-v2.html');

// ── Database queries ──────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
ok('Querying database...');

// 40 patients: 16 Korean, 12 Spanish, 12 other
const korPids  = db.prepare("SELECT patient_id FROM patients WHERE language='Korean'  ORDER BY RANDOM() LIMIT 16").all().map(r => r.patient_id);
const spaPids  = db.prepare("SELECT patient_id FROM patients WHERE language='Spanish' ORDER BY RANDOM() LIMIT 12").all().map(r => r.patient_id);
const othPids  = db.prepare("SELECT patient_id FROM patients WHERE language NOT IN ('Korean','Spanish') ORDER BY RANDOM() LIMIT 12").all().map(r => r.patient_id);
const pids     = [...korPids, ...spaPids, ...othPids];
const ph       = pids.map(() => '?').join(',');

const patients = db.prepare(
  `SELECT p.*, pr.provider_name AS pcp_name, pr.provider_npi AS pcp_npi, pr.practice_name AS pcp_practice
   FROM patients p
   LEFT JOIN pcp_providers pr ON pr.patient_id = p.patient_id AND pr.status = 'Active'
   WHERE p.patient_id IN (${ph})`
).all(...pids);

ok(`Loaded ${patients.length} patients`);

const eligibility = db.prepare(`SELECT * FROM eligibility WHERE patient_id IN (${ph}) ORDER BY updated_at DESC`).all(...pids);
const claims      = db.prepare(`SELECT c.*, p.first_name, p.last_name, p.language, p.korean_name FROM claims c JOIN patients p ON c.patient_id=p.patient_id WHERE c.patient_id IN (${ph}) ORDER BY c.dos DESC LIMIT 120`).all(...pids);
const labs        = db.prepare(`SELECT l.*, p.first_name, p.last_name, p.language, p.korean_name FROM lab_results l JOIN patients p ON l.patient_id=p.patient_id WHERE l.patient_id IN (${ph}) ORDER BY l.result_date DESC LIMIT 120`).all(...pids);
const auths       = db.prepare(`SELECT a.*, p.first_name, p.last_name, p.language, p.korean_name FROM authorizations a JOIN patients p ON a.patient_id=p.patient_id WHERE a.patient_id IN (${ph}) ORDER BY a.requested_date DESC LIMIT 80`).all(...pids);
const pharmacy    = db.prepare(`SELECT ph.*, p.first_name, p.last_name, p.language, p.korean_name FROM pharmacy_records ph JOIN patients p ON ph.patient_id=p.patient_id WHERE ph.patient_id IN (${ph}) ORDER BY ph.refill_due_date ASC LIMIT 80`).all(...pids);
const medications = db.prepare(`SELECT * FROM medication_requests WHERE patient_id IN (${ph}) AND status='Active' LIMIT 80`).all(...pids);
const visitNotes  = db.prepare(`SELECT * FROM visit_notes WHERE patient_id IN (${ph}) ORDER BY visit_date DESC LIMIT 60`).all(...pids);
const pcpRecs     = db.prepare(`SELECT * FROM pcp_providers WHERE patient_id IN (${ph}) AND status='Active'`).all(...pids);

// Get unique NPIs in our dataset
const uniqueNpis = [...new Set(pcpRecs.map(p => p.provider_npi).filter(Boolean))].slice(0, 3);

// Aggregate stats (from full database, not just sample)
const stats = {
  totalPatients:    db.prepare('SELECT COUNT(*) AS n FROM patients').get().n,
  activeEligibility:db.prepare("SELECT COUNT(*) AS n FROM eligibility WHERE status='Active'").get().n,
  pendingClaims:    db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status='Pending'").get().n,
  pendingAuths:     db.prepare("SELECT COUNT(*) AS n FROM authorizations WHERE status='Pending'").get().n,
  criticalLabs:     db.prepare("SELECT COUNT(*) AS n FROM lab_results WHERE flag='Critical'").get().n,
  refillsDue:       db.prepare("SELECT COUNT(*) AS n FROM pharmacy_records WHERE refill_due_date <= date('now','+7 days')").get().n,
  totalFiles:       (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM upload_logs').get().n; } catch(e) { return 0; } })(),
  lastSync:         new Date().toISOString(),
};

ok(`Stats: ${stats.totalPatients.toLocaleString()} patients · ${stats.activeEligibility.toLocaleString()} active elig · ${stats.pendingClaims} pending claims`);

// ── Logo → base64 data URI ─────────────────────────────────────────────────
const logoURI = 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');

// ── Build the seed data using REAL patient IDs ────────────────────────────
function buildSeedScript(pts) {
  // Pick patients for seed data
  const sp = pts.slice(0, 19);
  function pid(i) { return sp[Math.min(i, sp.length - 1)].patient_id; }
  function pname(i) {
    const p = sp[Math.min(i, sp.length - 1)];
    return (p.first_name || '') + ' ' + (p.last_name || '');
  }
  function pkname(i) {
    const p = sp[Math.min(i, sp.length - 1)];
    return p.korean_name || '';
  }

  const consents = [0,1,2,3,4].map((i, idx) => ({
    id: 'consent_d' + (idx+1),
    patientId: pid(i),
    patientName: pname(i) + (pkname(i) ? ' (' + pkname(i) + ')' : ''),
    caregiverName: ['박민준 (Min Park)', '김지수 (Jisoo Kim)', '이서연 (Seoyeon Lee)', 'Alex Choi', 'Maria Lopez'][idx],
    caregiverPhone: ['(213) 555-0142','(310) 555-0287','(714) 555-0391','(626) 555-0489','(909) 555-0531'][idx],
    relationship: ['Son','Daughter','Daughter-in-law','Son','Granddaughter'][idx],
    permissions: {
      appointments: true,
      medications: idx < 3,
      labResults: idx < 2,
      visitNotes: idx === 2,
    },
    status: ['pending','pending','approved','declined','pending'][idx],
    requestedAt: new Date(Date.now() - idx * 86400000).toISOString(),
    respondedAt: idx >= 2 ? new Date(Date.now() - (idx-1) * 86400000).toISOString() : null,
  }));

  return `
<!-- Demo seed override — uses real patient IDs from this database -->
<script id="smg-demo-seed-override">
(function () {
  'use strict';
  var _SP = ${JSON.stringify(sp.map(p => ({
    id:  p.patient_id,
    name: (p.first_name || '') + ' ' + (p.last_name || ''),
    ko:   p.korean_name || '',
  })))};

  function dOff(d) {
    var dt = new Date(); dt.setDate(dt.getDate() + d);
    return dt.toISOString().split('T')[0];
  }
  function pid(i)   { return _SP[Math.min(i, _SP.length - 1)].id; }
  function pname(i) { var p = _SP[Math.min(i,_SP.length-1)]; return p.name + (p.ko ? ' (' + p.ko + ')' : ''); }

  function doSeed() {
    var now = new Date();
    var d1  = new Date(now - 86400000);
    var d2  = new Date(now - 172800000);
    var d3  = new Date(now - 259200000);
    var reqs = [
      // Confirmed — past 3 days
      {id:'appt_c1', patientId:pid(0),  date:dOff(-3), scheduledTime:'09:00', reason:'Annual wellness exam',                         status:'confirmed',  confirmedAt:d3.toISOString(), submittedAt:new Date(now-345600000).toISOString()},
      {id:'appt_c2', patientId:pid(1),  date:dOff(-3), scheduledTime:'10:30', reason:'Diabetes management — A1C results review',    status:'confirmed',  confirmedAt:d3.toISOString(), submittedAt:new Date(now-432000000).toISOString()},
      {id:'appt_c3', patientId:pid(2),  date:dOff(-2), scheduledTime:'09:00', reason:'Blood pressure medication follow-up',         status:'confirmed',  confirmedAt:d2.toISOString(), submittedAt:new Date(now-259200000).toISOString()},
      {id:'appt_c4', patientId:pid(3),  date:dOff(-2), scheduledTime:'14:00', reason:'Post-surgery check-in',                       status:'confirmed',  confirmedAt:d2.toISOString(), submittedAt:new Date(now-345600000).toISOString()},
      {id:'appt_c5', patientId:pid(4),  date:dOff(-1), scheduledTime:'09:30', reason:'Knee pain evaluation',                        status:'confirmed',  confirmedAt:d1.toISOString(), submittedAt:new Date(now-172800000).toISOString()},
      {id:'appt_c6', patientId:pid(5),  date:dOff(-1), scheduledTime:'11:00', reason:'Prescription refill — Metformin 500mg',      status:'confirmed',  confirmedAt:d1.toISOString(), submittedAt:new Date(now-259200000).toISOString()},
      // Confirmed — today
      {id:'appt_c7', patientId:pid(6),  date:dOff(0),  scheduledTime:'09:00', reason:'Routine checkup and immunization',            status:'confirmed',  confirmedAt:d1.toISOString(), submittedAt:d2.toISOString()},
      {id:'appt_c8', patientId:pid(7),  date:dOff(0),  scheduledTime:'10:30', reason:'Chest pain — non-emergency evaluation',      status:'confirmed',  confirmedAt:d1.toISOString(), submittedAt:d2.toISOString()},
      {id:'appt_c9', patientId:pid(8),  date:dOff(0),  scheduledTime:'14:00', reason:'Annual wellness exam follow-up',              status:'confirmed',  confirmedAt:now.toISOString(),submittedAt:d1.toISOString()},
      // Confirmed — tomorrow
      {id:'appt_c10',patientId:pid(9),  date:dOff(1),  scheduledTime:'09:00', reason:'Follow-up after hospitalization',             status:'confirmed',  confirmedAt:now.toISOString(),submittedAt:d1.toISOString()},
      {id:'appt_c11',patientId:pid(10), date:dOff(1),  scheduledTime:'11:30', reason:'Hypertension management review',              status:'confirmed',  confirmedAt:now.toISOString(),submittedAt:d1.toISOString()},
      // Rescheduled
      {id:'appt_r1', patientId:pid(11), date:dOff(-1), newDate:dOff(3),  scheduledTime:'10:00', reason:'Physical therapy referral — knee',status:'rescheduled',rescheduledAt:d1.toISOString(),submittedAt:d2.toISOString()},
      {id:'appt_r2', patientId:pid(12), date:dOff(1),  newDate:dOff(5),  scheduledTime:'13:00', reason:'Diabetes check-up',               status:'rescheduled',rescheduledAt:now.toISOString(),submittedAt:d1.toISOString()},
      // Pending — upcoming
      {id:'appt_p1', patientId:pid(0),  date:dOff(2),  time:'morning',   reason:'Annual checkup and blood pressure follow-up',     status:'pending',    submittedAt:now.toISOString()},
      {id:'appt_p2', patientId:pid(13), date:dOff(2),  time:'afternoon', reason:'Persistent headaches — neurological assessment',  status:'pending',    submittedAt:d1.toISOString()},
      {id:'appt_p3', patientId:pid(14), date:dOff(3),  time:'morning',   reason:'새 환자 - 전반적인 건강 검진 (New patient general exam)', status:'pending',    submittedAt:now.toISOString()},
      {id:'appt_p4', patientId:pid(15), date:dOff(4),  time:'morning',   reason:'새 환자 - 전반적인 건강 검진 (New patient general exam)', status:'pending',    submittedAt:d1.toISOString()},
      {id:'appt_p5', patientId:pid(16), date:dOff(5),  time:'afternoon', reason:'Thyroid function review — medication adjustment',  status:'pending',    submittedAt:now.toISOString()},
      {id:'appt_p6', patientId:pid(17), date:dOff(6),  time:'evening',   reason:'Physical therapy referral — lower back pain',     status:'pending',    submittedAt:d1.toISOString()},
    ];
    var consents = ${JSON.stringify(consents)};
    localStorage.setItem('bridge_appt_requests', JSON.stringify(reqs));
    localStorage.setItem('bridge_caregiver_consents', JSON.stringify(consents));
    if (typeof updatePortalBadges === 'function') updatePortalBadges();
    if (typeof loadConsents === 'function') loadConsents();
  }

  // Override initDemoDataIfEmpty and seedDemoData so the portal uses our real IDs
  window.addEventListener('load', function () {
    doSeed();
    if (typeof updatePortalBadges === 'function') updatePortalBadges();
    if (typeof loadApptCalendar === 'function' && document.getElementById('page-apptQueue') && document.getElementById('page-apptQueue').classList.contains('active')) {
      loadApptCalendar();
    }
  });

  // Also seed immediately (before portal's DOMContentLoaded can seed fake IDs)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doSeed);
  } else {
    doSeed();
  }
})();
</script>
`;
}

// ── Mock fetch script ──────────────────────────────────────────────────────
function buildMockFetch(data) {
  const D = JSON.stringify(data);

  // Safe to embed because JSON.stringify escapes </script> as <\/script>
  // We add the extra replacement just in case some engines differ
  const safeD = D.replace(/<\/script>/gi, '<\\/script>').replace(/<!--/g, '<\\!--');

  return `
<script id="smg-mock-fetch">
(function () {
  'use strict';
  var D = ${safeD};

  function ok(data, s) { s=s||200; return {ok:s<400,status:s,json:function(){return Promise.resolve(data);},text:function(){return Promise.resolve(JSON.stringify(data));}}; }
  function qs(url) { var q={},s=(url.split('?')[1]||''); s.split('&').forEach(function(p){if(!p)return;var kv=p.split('=');q[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'');}); return q; }
  function bp(url) { return url.replace(/^.*\\/api/,'').split('?')[0]; }
  function pg(arr,q) { var lim=parseInt(q.limit)||200,page=parseInt(q.page)||1,off=(page-1)*lim; return {rows:arr.slice(off,off+lim),total:arr.length,page:page,limit:lim}; }
  function npi(arr,n,k) { if(!n)return arr; var ids=D.pcp.filter(function(p){return p.provider_npi===n;}).map(function(p){return p.patient_id;}); return arr.filter(function(r){return ids.indexOf(r[k||'patient_id'])!==-1;}); }
  function jp(rows) { return rows.map(function(r){var p=D.patients.find(function(x){return x.patient_id===r.patient_id;})||{};return Object.assign({},r,{first_name:p.first_name,last_name:p.last_name,dob:p.dob,language:p.language,korean_name:p.korean_name});}); }

  var _of = window.fetch.bind(window);
  window.fetch = function(url, opts) {
    if (typeof url==='string' && url.indexOf('/api/')!==-1) return mf(url, opts||{});
    return _of(url, opts);
  };

  function mf(url, opts) {
    var b=bp(url), q=qs(url), m=(opts.method||'GET').toUpperCase();

    // Write ops
    if (m==='PUT'||m==='POST') {
      try {
        var body=JSON.parse(opts.body||'{}');
        if (b.match(/\\/mso\\/claims\\/\\d+/))     { var r=D.claims.find(function(c){return c.id===parseInt(b.split('/').pop());}); if(r&&body.status){r.status=body.status; if(body.denial_reason)r.denial_reason=body.denial_reason; if(body.paid_amount!=null)r.paid_amount=body.paid_amount;} }
        if (b.match(/\\/mso\\/auths\\/\\d+/))      { var r=D.auths.find(function(a){return a.id===parseInt(b.split('/').pop());}); if(r&&body.status){r.status=body.status; if(body.denial_reason)r.denial_reason=body.denial_reason; if(body.approved_date)r.approved_date=body.approved_date;} }
        if (b.match(/\\/mso\\/eligibility\\/\\d+/)){ var r=D.eligibility.find(function(e){return e.id===parseInt(b.split('/').pop());}); if(r&&body.status)r.status=body.status; }
        if (b==='/auth/login') { var npiv=body.npi||body.username||''; return Promise.resolve(ok({token:'demo_'+npiv,user:{id:1,username:npiv||'admin',role:npiv?'physician':'admin',npi:npiv||null}})); }
      } catch(e) {}
      return Promise.resolve(ok({success:true,id:Math.floor(Math.random()*999999)}));
    }

    // Auth
    if(b==='/auth/me') return Promise.resolve(ok({id:1,username:'admin',role:'admin',orgId:null,npi:null}));

    // Stats
    if(b==='/patients/stats') return Promise.resolve(ok(D.stats));

    // Files
    if(b==='/upload/files') return Promise.resolve(ok([
      {id:1,filename:'eligibility_2026_q1.xlsx',status:'processed',records_imported:4127,uploaded_at:'2026-03-28T10:22:00'},
      {id:2,filename:'claims_march_2026.xlsx',status:'processed',records_imported:2841,uploaded_at:'2026-03-25T14:30:00'},
      {id:3,filename:'patient_registry_amm.xlsx',status:'processed',records_imported:D.stats.totalPatients,uploaded_at:'2026-03-20T09:15:00'},
      {id:4,filename:'lab_results_q1.xlsx',status:'processed',records_imported:18293,uploaded_at:'2026-03-15T11:00:00'},
      {id:5,filename:'pharmacy_records_2026.xlsx',status:'processed',records_imported:9847,uploaded_at:'2026-03-10T13:45:00'},
    ]));

    // Patients list
    if(b==='/patients') {
      var pts=D.patients.slice(), srch=(q.search||q.q||'').toLowerCase();
      if(srch) pts=pts.filter(function(p){return(p.first_name+' '+p.last_name+' '+p.patient_id+' '+(p.korean_name||'')+(p.phone||'')).toLowerCase().indexOf(srch)!==-1;});
      var r=pg(pts,q); return Promise.resolve(ok({patients:r.rows,total:r.total,page:r.page,limit:r.limit}));
    }

    // Patient by ID (drawer / calendar name lookup)
    if(b.match(/^\\/patients\\/[^\\/]+$/)&&b.indexOf('stats')===-1&&b.indexOf('intel')===-1) {
      var pid=decodeURIComponent(b.split('/')[2]);
      var pt=D.patients.find(function(p){return p.patient_id===pid;});
      if(!pt) return Promise.resolve(ok({error:'Not found'},404));
      return Promise.resolve(ok({patient:pt}));
    }

    // Intel
    if(b==='/patients/intel') return Promise.resolve(ok({
      languageBreakdown:[{language:'Korean',count:Math.floor(D.stats.totalPatients*.48)},{language:'Spanish',count:Math.floor(D.stats.totalPatients*.28)},{language:'English',count:Math.floor(D.stats.totalPatients*.24)}],
      riskScore:{high:412,medium:2341,low:D.stats.totalPatients-2753},
      ageGroups:[{group:'65+',count:3847},{group:'55-64',count:2891},{group:'45-54',count:1923},{group:'<45',count:1586}],
      chronicConditions:[{condition:'Hypertension',count:4234},{condition:'Diabetes',count:3187},{condition:'High Cholesterol',count:2891}],
    }));

    // Eligibility
    if(b==='/mso/eligibility') { var rows=jp(D.eligibility); if(q.status)rows=rows.filter(function(r){return r.status===q.status;}); rows=npi(rows,q.npi); var r=pg(rows,q); return Promise.resolve(ok({eligibility:r.rows,total:r.total,page:r.page,limit:r.limit})); }
    if(b.match(/^\\/mso\\/eligibility\\/[^\\/]+$/)&&b.indexOf('by-member')===-1) { var seg=b.split('/')[3]; if(isNaN(parseInt(seg))){var pid=decodeURIComponent(seg); return Promise.resolve(ok(D.eligibility.filter(function(e){return e.patient_id===pid;})));} return Promise.resolve(ok({success:true})); }
    if(b.indexOf('/mso/eligibility/by-member/')!==-1) { var mid=decodeURIComponent(b.split('/').pop()); var e=D.eligibility.find(function(x){return x.member_id===mid;}); if(!e)return Promise.resolve(ok({error:'Not found'},404)); var p=D.patients.find(function(x){return x.patient_id===e.patient_id;})||{}; return Promise.resolve(ok(Object.assign({},e,p))); }

    // Claims
    if(b==='/mso/claims/summary') { var rows=D.claims.slice(); if(q.status)rows=rows.filter(function(r){return r.status===q.status;}); rows=npi(rows,q.npi); var r=pg(rows,q); return Promise.resolve(ok({claims:r.rows,total:r.total,page:r.page,limit:r.limit})); }
    if(b.match(/^\\/mso\\/claims\\/[^\\/]+$/)&&b.indexOf('summary')===-1) { var seg=b.split('/')[3]; if(isNaN(parseInt(seg))){var pid=decodeURIComponent(seg); var rows=D.claims.filter(function(c){return c.patient_id===pid;}); if(q.status)rows=rows.filter(function(r){return r.status===q.status;}); return Promise.resolve(ok(rows));}  return Promise.resolve(ok({success:true})); }

    // Auths
    if(b==='/mso/auths') { var rows=jp(D.auths); if(q.status)rows=rows.filter(function(r){return r.status===q.status;}); var r=pg(rows,q); return Promise.resolve(ok({authorizations:r.rows,total:r.total,page:r.page,limit:r.limit})); }
    if(b.match(/^\\/mso\\/auths\\/[^\\/]+$/)) { var seg=b.split('/')[3]; if(isNaN(parseInt(seg))){var pid=decodeURIComponent(seg); return Promise.resolve(ok(D.auths.filter(function(a){return a.patient_id===pid;})));} return Promise.resolve(ok({success:true})); }

    // Labs
    if(b==='/pcp/labs') { var rows=jp(D.labs); if(q.flag)rows=rows.filter(function(r){return r.flag===q.flag;}); rows=npi(rows,q.npi); var r=pg(rows,q); return Promise.resolve(ok({labs:r.rows,total:r.total,page:r.page,limit:r.limit})); }
    if(b.match(/^\\/pcp\\/labs\\/[^\\/]+$/)) { var pid=decodeURIComponent(b.split('/')[3]); return Promise.resolve(ok(D.labs.filter(function(l){return l.patient_id===pid;}))); }

    // Pharmacy
    if(b==='/pharmacy/refills-due'||b==='/pcp/pharmacy') { var rows=jp(D.pharmacy); rows=npi(rows,q.npi); var r=pg(rows,q); return Promise.resolve(ok({patients:r.rows,total:r.total})); }
    if(b==='/pharmacy/requests') return Promise.resolve(ok({requests:[],total:0}));
    if(b==='/pcp/panel-meds'||b==='/pcp/medications') return Promise.resolve(ok(npi(D.medications,q.npi)));

    // MSO payer/dashboard
    if(b==='/mso/payer-summary') return Promise.resolve(ok({payers:[{payer_name:'Blue Shield of California',members:3412,active:2891,inactive:521,plan_type:'PPO/HMO'},{payer_name:'LA Care Health Plan',members:2847,active:2401,inactive:446,plan_type:'HMO/Medi-Cal'},{payer_name:'Health Net',members:1923,active:1644,inactive:279,plan_type:'HMO/PPO'},{payer_name:'Molina Healthcare',members:1241,active:1056,inactive:185,plan_type:'Medi-Cal'},{payer_name:'Anthem Blue Cross',members:824,active:399,inactive:425,plan_type:'HMO/EPO'}],claimsByPayer:[{payer_name:'Blue Shield of California',claim_count:4219,total_billed:892400,total_paid:714000,denied:312},{payer_name:'LA Care Health Plan',claim_count:3841,total_billed:641200,total_paid:512000,denied:198}]}));
    if(b==='/mso/dashboard') return Promise.resolve(ok({eligibility:[{status:'Active',count:D.stats.activeEligibility},{status:'Inactive',count:1241},{status:'Termed',count:615}],claims:[{status:'Paid',count:12847,total_billed:2891200,total_paid:2312000},{status:'Pending',count:D.stats.pendingClaims,total_billed:124000,total_paid:0},{status:'Denied',count:891,total_billed:289000,total_paid:0}],authorizations:[{status:'Approved',count:1247},{status:'Pending',count:D.stats.pendingAuths},{status:'Denied',count:312}],recentClaims:D.claims.slice(0,10),pendingAuths:D.auths.filter(function(a){return a.status==='Pending';}).slice(0,10)}));

    // Schedule
    if(b==='/schedule/today') return Promise.resolve(ok({appointments:[]}));

    // PCP panel
    if(b==='/pcp/panel') { var rows=npi(D.patients,q.npi); var r=pg(rows,q); return Promise.resolve(ok({patients:r.rows,total:r.total,page:r.page,limit:r.limit})); }
    if(b==='/pcp/panel/stats') { var n=q.npi?npi(D.patients,q.npi).length:D.patients.length; return Promise.resolve(ok({totalPanelPatients:n,activeEligibility:Math.floor(n*.82),pendingClaims:Math.floor(n*.12),pendingAuths:Math.floor(n*.04),criticalLabs:Math.floor(n*.008),refillsDue:Math.floor(n*.06),eligSummary:[{status:'Active',count:Math.floor(n*.82)},{status:'Inactive',count:Math.floor(n*.18)}],claimsSummary:[{status:'Paid',count:Math.floor(n*1.2)},{status:'Pending',count:Math.floor(n*.12)},{status:'Denied',count:Math.floor(n*.08)}]})); }

    // Patient portal lookup (v2 app)
    if(b.indexOf('/patient-portal/lookup/')!==-1) {
      var sid=decodeURIComponent(b.split('/').pop());
      var pt=D.patients.find(function(p){return p.patient_id===sid;});
      if(!pt){var e=D.eligibility.find(function(x){return x.member_id===sid;}); if(e)pt=D.patients.find(function(p){return p.patient_id===e.patient_id;});}
      if(!pt) return Promise.resolve(ok({error:'Patient not found'},404));
      var pid=pt.patient_id, pcpR=D.pcp.find(function(p){return p.patient_id===pid;})||null;
      return Promise.resolve(ok({patient:pt,eligibility:D.eligibility.filter(function(e){return e.patient_id===pid;}),pcp:pcpR,medications:D.medications.filter(function(m){return m.patient_id===pid;}),authorizations:D.auths.filter(function(a){return a.patient_id===pid;}),labs:D.labs.filter(function(l){return l.patient_id===pid;}),pharmacy:D.pharmacy.filter(function(p){return p.patient_id===pid;}),visitNotes:D.visitNotes.filter(function(v){return v.patient_id===pid;})}));
    }

    // Fallback
    return Promise.resolve(ok({success:true,data:[],patients:[],labs:[],claims:[],authorizations:[],eligibility:[],total:0}));
  }
})();
</script>
`;
}

// ── Admin auto-login script ────────────────────────────────────────────────
const ADMIN_AUTOLOGIN = `
<script id="smg-demo-autologin">
/* Set session before the portal's DOMContentLoaded checks for it */
(function () {
  localStorage.setItem('bridge_token', 'demo_admin_2026');
  localStorage.setItem('bridge_user', JSON.stringify({id:1,username:'admin',role:'admin',orgId:null,npi:null}));
})();
</script>
`;

// ── Modify each portal HTML ────────────────────────────────────────────────
function modifyPortal(srcPath, opts) {
  let html = fs.readFileSync(srcPath, 'utf8');

  // Embed logo (replace all img src and CSS url references)
  html = html.replace(/src="smg\.logo\.transparent\.v1\.png"/g, `src="${logoURI}"`);
  html = html.replace(/url\(['"]?smg\.logo\.transparent\.v1\.png['"]?\)/g, `url('${logoURI}')`);

  // Inject mock fetch immediately after <head> (must run before any other script)
  html = html.replace('<head>', '<head>\n' + opts.mockFetch);

  // Inject seed override
  html = html.replace('<head>', '<head>\n' + opts.seedScript);

  // Inject auto-login for admin
  if (opts.autoLogin) {
    html = html.replace('<head>', '<head>\n' + ADMIN_AUTOLOGIN);
  }

  return html;
}

// ── Build demo data object (exclude huge fields to keep size down) ─────────
// Trim visit note bodies to 500 chars to reduce JSON size
const trimmedNotes = visitNotes.map(n => {
  const out = Object.assign({}, n);
  if (out.note_text && out.note_text.length > 500) out.note_text = out.note_text.slice(0, 500) + '…';
  if (out.summary   && out.summary.length   > 400) out.summary   = out.summary.slice(0, 400) + '…';
  return out;
});

const DEMO_DATA = {
  patients, eligibility, claims, labs, auths, pharmacy,
  medications, visitNotes: trimmedNotes, pcp: pcpRecs, stats,
};

ok('Building portal HTML...');

const mockFetchScript = buildMockFetch(DEMO_DATA);
const seedScript      = buildSeedScript(patients);

const adminHtml   = modifyPortal(ADMIN_SRC,   { mockFetch: mockFetchScript, seedScript, autoLogin: true  });
const doctorHtml  = modifyPortal(DOCTOR_SRC,  { mockFetch: mockFetchScript, seedScript, autoLogin: false });
const membersHtml = modifyPortal(MEMBERS_SRC, { mockFetch: mockFetchScript, seedScript, autoLogin: false });

// Encode portals as UTF-8 base64
const adminB64   = Buffer.from(adminHtml,   'utf8').toString('base64');
const doctorB64  = Buffer.from(doctorHtml,  'utf8').toString('base64');
const membersB64 = Buffer.from(membersHtml, 'utf8').toString('base64');

ok('Encoded portals as base64');

// ── Pick sample patient IDs for the demo guide ────────────────────────────
const korSamples = patients.filter(p => p.language === 'Korean').slice(0, 3);
const engSamples = patients.filter(p => p.language !== 'Korean').slice(0, 2);

// ── Build the outer wrapper HTML ──────────────────────────────────────────
const wrapperHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SMG Bridge — Executive Demo</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { height:100%; overflow:hidden; background:#030910; font-family:Inter,-apple-system,sans-serif; }
  #portal-frame { position:absolute; top:0; left:0; right:0; bottom:44px; border:none; width:100%; background:#0D1421; }
  #demo-sw { position:fixed; bottom:0; left:0; right:0; height:44px; background:#030910; border-top:2px solid #6366F1; z-index:99999; display:flex; align-items:center; justify-content:center; gap:8px; }
  .sw-btn { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); color:#7A9AB8; border-radius:7px; padding:6px 16px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; transition:all .15s; letter-spacing:.3px; }
  .sw-btn:hover  { background:rgba(255,255,255,.12); color:#E2E8F0; }
  .sw-btn.active { background:rgba(99,102,241,.18); border-color:rgba(99,102,241,.5); color:#818CF8; }
  .sw-label { font-size:9px; font-weight:800; color:#3D5A75; letter-spacing:1.2px; text-transform:uppercase; }
  .sw-note  { font-size:10px; color:#3D5A75; margin-left:12px; }
  #loading-msg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#3D5A75; font-size:13px; font-weight:600; letter-spacing:.3px; }
</style>
</head>
<body>
  <div id="loading-msg">Loading Admin Portal…</div>
  <iframe id="portal-frame" src="about:blank" allowfullscreen
    onload="document.getElementById('loading-msg').style.display='none'"></iframe>

  <div id="demo-sw">
    <span class="sw-label" style="margin-right:10px;">SMG BRIDGE</span>
    <button class="sw-btn active" id="btn-admin"   onclick="switchPortal('admin')">🖥 Admin Portal</button>
    <button class="sw-btn"        id="btn-doctor"  onclick="switchPortal('doctor')">🩺 Clinical Portal</button>
    <button class="sw-btn"        id="btn-members" onclick="switchPortal('members')">📱 Patient App</button>
    <span class="sw-note">Demo Mode · Real Data · No Server Required</span>
  </div>

<script>
/* Portal HTML (UTF-8, base64-encoded) */
var PORTALS = {
  admin:   '${adminB64}',
  doctor:  '${doctorB64}',
  members: '${membersB64}',
};

var activeUrl = null;
var cache     = {};   // keep decoded blobs so we don't re-decode on every switch

function decodeB64(b64) {
  // Decode base64 → UTF-8 bytes → string (handles Korean / non-ASCII)
  var bin   = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function switchPortal(mode) {
  /* Update button states */
  ['admin','doctor','members'].forEach(function(m) {
    var btn = document.getElementById('btn-' + m);
    if (btn) btn.className = 'sw-btn' + (m === mode ? ' active' : '');
  });

  document.getElementById('loading-msg').style.display = 'block';

  /* Use cached blob URL if available */
  if (cache[mode]) {
    document.getElementById('portal-frame').src = cache[mode];
    return;
  }

  /* Decode and create blob URL */
  var html = decodeB64(PORTALS[mode]);
  var blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  cache[mode] = url;
  document.getElementById('portal-frame').src = url;
}

/* Auto-load admin on page open */
window.addEventListener('DOMContentLoaded', function () {
  switchPortal('admin');
});
</script>
</body>
</html>`;

// ── Write output ───────────────────────────────────────────────────────────
fs.writeFileSync(OUT_PATH, wrapperHtml, 'utf8');
const sizeKB = Math.round(fs.statSync(OUT_PATH).size / 1024);

ok('');
ok('Output : ' + OUT_PATH);
ok('Size   : ' + sizeKB + ' KB  (' + (sizeKB/1024).toFixed(1) + ' MB)');
ok('');
ok('What\'s included:');
ok('  Admin Portal    — ' + stats.totalPatients.toLocaleString() + ' patients, live dashboard, interactive calendar, consents');
ok('  Clinical Portal — NPI login → scoped patient panel  (sample NPIs below)');
ok('  Patient App     — bilingual EN/한국어, appointment flow, meds, visit notes');
ok('');

if (uniqueNpis.length > 0) {
  console.log('Sample NPIs for Clinical Portal:');
  uniqueNpis.forEach(function(npi) {
    const doc = pcpRecs.find(function(p) { return p.provider_npi === npi; });
    console.log('  ' + npi + (doc ? '  —  ' + doc.provider_name : ''));
  });
  console.log('');
}

console.log('Sample Patient IDs for the Patient App:');
korSamples.concat(engSamples).forEach(function(p) {
  console.log('  ' + p.patient_id + '  —  ' + p.first_name + ' ' + p.last_name + (p.korean_name ? ' (' + p.korean_name + ')' : ''));
});
console.log('');
ok('Send client/bridge-demo.html — opens in Chrome or Safari, no install needed.');
