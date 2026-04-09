#!/usr/bin/env node
/**
 * SMG Bridge — Unified Executive Demo Generator
 * ──────────────────────────────────────────────
 * Usage: node generate-demo.js
 * Output: client/bridge-demo.html
 *
 * Reads real patient data from the SQLite database, injects a mock-fetch
 * layer into all 3 portal HTML files, and produces one self-contained file
 * that works by double-clicking — no server required.
 *
 * Portal switcher at the bottom lets you move between:
 *   Admin Portal → Clinical Portal → Patient App
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ── Paths ─────────────────────────────────────────────────────────────────
const ROOT        = __dirname;
const DB_PATH     = path.join(ROOT, 'data', 'bridge.db');
const LOGO_PATH   = path.join(ROOT, 'smg.logo.transparent.v1.png');
const ADMIN_SRC   = path.join(ROOT, 'client', 'bridge-admin.html');
const DOCTOR_SRC  = path.join(ROOT, 'client', 'bridge-doctor.html');
const MEMBERS_SRC = path.join(ROOT, 'client', 'bridge-members-v2.html');
const OUT_PATH    = path.join(ROOT, 'client', 'bridge-demo.html');

// ── Guards ────────────────────────────────────────────────────────────────
function die(msg) { console.error('✗', msg); process.exit(1); }
function ok(msg)  { console.log('✓', msg); }

if (!fs.existsSync(DB_PATH))     die('Database not found. Run: npm run seed');
if (!fs.existsSync(LOGO_PATH))   die('Logo not found: ' + LOGO_PATH);
if (!fs.existsSync(ADMIN_SRC))   die('Missing: client/bridge-admin.html');
if (!fs.existsSync(DOCTOR_SRC))  die('Missing: client/bridge-doctor.html');
if (!fs.existsSync(MEMBERS_SRC)) die('Missing: client/bridge-members-v2.html');

// ── Database queries ──────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);

ok('Querying patients...');

// 40 patients: prioritise Korean language, then Spanish, then English
// Sample 40 patients: 16 Korean, 12 Spanish, 12 other
const koreanPids  = db.prepare("SELECT patient_id FROM patients WHERE language = 'Korean'  ORDER BY RANDOM() LIMIT 16").all().map(function(r){ return r.patient_id; });
const spanishPids = db.prepare("SELECT patient_id FROM patients WHERE language = 'Spanish' ORDER BY RANDOM() LIMIT 12").all().map(function(r){ return r.patient_id; });
const otherPids   = db.prepare("SELECT patient_id FROM patients WHERE language NOT IN ('Korean','Spanish') ORDER BY RANDOM() LIMIT 12").all().map(function(r){ return r.patient_id; });
const allSamplePids = koreanPids.concat(spanishPids).concat(otherPids);
const samplePidHold = allSamplePids.map(function(){ return '?'; }).join(',');

const patients = db.prepare(
  'SELECT p.*, pr.provider_name AS pcp_name, pr.provider_npi AS pcp_npi, pr.practice_name AS pcp_practice ' +
  'FROM patients p LEFT JOIN pcp_providers pr ON pr.patient_id = p.patient_id AND pr.status = \'Active\' ' +
  'WHERE p.patient_id IN (' + samplePidHold + ')'
).all(...allSamplePids);

const pids    = patients.map(function(p) { return p.patient_id; });
const pidHold = pids.map(function() { return '?'; }).join(',');

ok('Querying related records for ' + pids.length + ' patients...');

const eligibility = db.prepare(
  'SELECT * FROM eligibility WHERE patient_id IN (' + pidHold + ') ORDER BY updated_at DESC'
).all(...pids);

const claims = db.prepare(
  'SELECT c.*, p.first_name, p.last_name, p.language, p.korean_name ' +
  'FROM claims c JOIN patients p ON c.patient_id = p.patient_id ' +
  'WHERE c.patient_id IN (' + pidHold + ') ORDER BY c.dos DESC LIMIT 120'
).all(...pids);

const labs = db.prepare(
  'SELECT l.*, p.first_name, p.last_name, p.language, p.korean_name ' +
  'FROM lab_results l JOIN patients p ON l.patient_id = p.patient_id ' +
  'WHERE l.patient_id IN (' + pidHold + ') ORDER BY l.result_date DESC LIMIT 120'
).all(...pids);

const auths = db.prepare(
  'SELECT a.*, p.first_name, p.last_name, p.language, p.korean_name ' +
  'FROM authorizations a JOIN patients p ON a.patient_id = p.patient_id ' +
  'WHERE a.patient_id IN (' + pidHold + ') ORDER BY a.requested_date DESC LIMIT 80'
).all(...pids);

const pharmacy = db.prepare(
  'SELECT ph.*, p.first_name, p.last_name, p.language, p.korean_name ' +
  'FROM pharmacy_records ph JOIN patients p ON ph.patient_id = p.patient_id ' +
  'WHERE ph.patient_id IN (' + pidHold + ') ORDER BY ph.refill_due_date ASC LIMIT 80'
).all(...pids);

const medications = db.prepare(
  "SELECT * FROM medication_requests WHERE patient_id IN (" + pidHold + ") AND status = 'Active' LIMIT 80"
).all(...pids);

const visitNotes = db.prepare(
  'SELECT * FROM visit_notes WHERE patient_id IN (' + pidHold + ') ORDER BY visit_date DESC LIMIT 80'
).all(...pids);

const pcpRecords = db.prepare(
  "SELECT * FROM pcp_providers WHERE patient_id IN (" + pidHold + ") AND status = 'Active'"
).all(...pids);

// Aggregate stats
const totalPatients   = db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
const activeElig      = db.prepare("SELECT COUNT(*) AS n FROM eligibility WHERE status = 'Active'").get().n;
const pendingClaims   = db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'Pending'").get().n;
const pendingAuths    = db.prepare("SELECT COUNT(*) AS n FROM authorizations WHERE status = 'Pending'").get().n;
const criticalLabs    = db.prepare("SELECT COUNT(*) AS n FROM lab_results WHERE flag = 'Critical'").get().n;
const refillsDue      = db.prepare("SELECT COUNT(*) AS n FROM pharmacy_records WHERE refill_due_date <= date('now','+7 days')").get().n;

let totalFiles = 0;
try { totalFiles = db.prepare('SELECT COUNT(*) AS n FROM upload_logs').get().n; } catch(e) {}

const stats = {
  totalPatients, activeEligibility: activeElig,
  pendingClaims, pendingAuths, criticalLabs, refillsDue,
  totalFiles, lastSync: new Date().toISOString()
};

ok('Stats: ' + totalPatients + ' patients, ' + activeElig + ' active elig, ' + pendingClaims + ' pending claims');

// ── DEMO_DATA object ──────────────────────────────────────────────────────
const DEMO_DATA = {
  patients, eligibility, claims, labs, auths, pharmacy,
  medications, visitNotes, pcp: pcpRecords, stats,
};

// ── Logo → base64 ─────────────────────────────────────────────────────────
const logoURI = 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');

// ── Mock fetch script (injected into every portal) ────────────────────────
// language=JavaScript
function buildMockFetchScript(demoData) {
  return `
<script id="smg-demo-mock">
/* ═══════════════════════════════════════════════════════════════
   SMG Bridge Demo — Mock API Layer
   All /api/* calls are intercepted and served from embedded data.
   No server required.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var D = ${JSON.stringify(demoData)};

  /* ── helpers ── */
  function mkR(data, status) {
    status = status || 200;
    return { ok: status < 400, status: status,
      json: function() { return Promise.resolve(data); },
      text: function() { return Promise.resolve(JSON.stringify(data)); } };
  }
  function parseQs(url) {
    var q = {}, s = (url.split('?')[1] || '');
    s.split('&').forEach(function(p) {
      if (!p) return;
      var kv = p.split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return q;
  }
  function basePath(url) { return url.replace(/^.*\\/api/, '').split('?')[0]; }
  function paginate(arr, q) {
    var limit = parseInt(q.limit) || 200;
    var page  = parseInt(q.page)  || 1;
    var off   = (page - 1) * limit;
    return { rows: arr.slice(off, off + limit), total: arr.length, page: page, limit: limit };
  }
  function npiFilter(arr, npi) {
    if (!npi) return arr;
    var pids = D.pcp.filter(function(p){ return p.provider_npi === npi; }).map(function(p){ return p.patient_id; });
    return arr.filter(function(r){ return pids.indexOf(r.patient_id) !== -1; });
  }
  function joinPt(rows) {
    return rows.map(function(r) {
      var p = D.patients.find(function(x){ return x.patient_id === r.patient_id; }) || {};
      return Object.assign({}, r, { first_name: p.first_name, last_name: p.last_name, dob: p.dob, language: p.language, korean_name: p.korean_name });
    });
  }

  /* ── intercept fetch ── */
  var _orig = window.fetch.bind(window);
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.indexOf('/api/') !== -1) {
      return mockFetch(url, opts || {});
    }
    return _orig(url, opts);
  };

  /* ── mock router ── */
  function mockFetch(url, opts) {
    var b = basePath(url);
    var q = parseQs(url);
    var method = (opts.method || 'GET').toUpperCase();

    /* ── write operations: update in-memory state ── */
    if (method === 'PUT' || method === 'POST') {
      try {
        var body = JSON.parse(opts.body || '{}');
        if (b.match(/^\\/mso\\/claims\\//)) {
          var id = parseInt(b.split('/').pop());
          var rec = D.claims.find(function(c){ return c.id === id; });
          if (rec && body.status) { rec.status = body.status; if (body.denial_reason) rec.denial_reason = body.denial_reason; if (body.paid_amount != null) rec.paid_amount = body.paid_amount; }
        }
        if (b.match(/^\\/mso\\/auths\\//)) {
          var id = parseInt(b.split('/').pop());
          var rec = D.auths.find(function(a){ return a.id === id; });
          if (rec && body.status) { rec.status = body.status; if (body.denial_reason) rec.denial_reason = body.denial_reason; if (body.approved_date) rec.approved_date = body.approved_date; if (body.notes) rec.notes = body.notes; }
        }
        if (b.match(/^\\/mso\\/eligibility\\//)) {
          var id = parseInt(b.split('/').pop());
          var rec = D.eligibility.find(function(e){ return e.id === id; });
          if (rec && body.status) rec.status = body.status;
        }
      } catch(e) {}
      if (b === '/auth/login') {
        var npi = body.npi || body.username || '';
        return Promise.resolve(mkR({ token: 'demo_' + npi, user: { id:1, username: npi||'admin', role: npi ? 'physician' : 'admin', npi: npi||null } }));
      }
      return Promise.resolve(mkR({ success: true, id: Math.floor(Math.random() * 999999) }));
    }

    /* ── read routes ── */

    // Auth
    if (b === '/auth/me') return Promise.resolve(mkR({ id:1, username:'admin', role:'admin', orgId:null, npi:null }));

    // Stats
    if (b === '/patients/stats') return Promise.resolve(mkR(D.stats));

    // Files
    if (b === '/upload/files') return Promise.resolve(mkR([
      {id:1,filename:'eligibility_2026_q1.xlsx',status:'processed',records_imported:4127,uploaded_at:'2026-03-28T10:22:00'},
      {id:2,filename:'claims_march_2026.xlsx',status:'processed',records_imported:2841,uploaded_at:'2026-03-25T14:30:00'},
      {id:3,filename:'patient_registry_amm.xlsx',status:'processed',records_imported:D.stats.totalPatients,uploaded_at:'2026-03-20T09:15:00'},
      {id:4,filename:'lab_results_q1.xlsx',status:'processed',records_imported:18293,uploaded_at:'2026-03-15T11:00:00'},
      {id:5,filename:'pharmacy_records_2026.xlsx',status:'processed',records_imported:9847,uploaded_at:'2026-03-10T13:45:00'},
    ]));

    // Patients list
    if (b === '/patients') {
      var pts = D.patients.slice();
      var srch = (q.search || q.q || '').toLowerCase();
      if (srch) pts = pts.filter(function(p){
        return (p.first_name+' '+p.last_name+' '+p.patient_id+' '+(p.korean_name||'')+(p.phone||'')).toLowerCase().indexOf(srch) !== -1;
      });
      var pg = paginate(pts, q);
      return Promise.resolve(mkR({ patients: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }

    // Patient by ID (for name enrichment, drawer, etc.)
    if (b.match(/^\\/patients\\/[^\\/]+$/) && b.indexOf('stats') === -1 && b.indexOf('intel') === -1) {
      var pid = decodeURIComponent(b.split('/')[2]);
      var pt = D.patients.find(function(p){ return p.patient_id === pid; });
      if (!pt) return Promise.resolve(mkR({ error: 'Not found' }, 404));
      return Promise.resolve(mkR({ patient: pt }));
    }

    // Population intel
    if (b === '/patients/intel') return Promise.resolve(mkR({
      languageBreakdown: [{language:'Korean',count:Math.floor(D.stats.totalPatients*.48)},{language:'Spanish',count:Math.floor(D.stats.totalPatients*.28)},{language:'English',count:Math.floor(D.stats.totalPatients*.24)}],
      riskScore:         {high:412,medium:2341,low:D.stats.totalPatients-2753},
      ageGroups:         [{group:'65+',count:3847},{group:'55-64',count:2891},{group:'45-54',count:1923},{group:'<45',count:1586}],
      chronicConditions: [{condition:'Hypertension',count:4234},{condition:'Diabetes',count:3187},{condition:'High Cholesterol',count:2891},{condition:'Heart Disease',count:1247}],
    }));

    // Eligibility list
    if (b === '/mso/eligibility') {
      var rows = joinPt(D.eligibility);
      if (q.status) rows = rows.filter(function(r){ return r.status === q.status; });
      rows = npiFilter(rows, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ eligibility: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }
    // Eligibility by patient
    if (b.match(/^\\/mso\\/eligibility\\/[^\\/]+$/) && b.indexOf('by-member') === -1) {
      var seg = b.split('/')[3];
      if (isNaN(parseInt(seg))) {
        var pid = decodeURIComponent(seg);
        return Promise.resolve(mkR(D.eligibility.filter(function(e){ return e.patient_id === pid; })));
      }
      return Promise.resolve(mkR({ success: true }));
    }
    // Eligibility by member ID
    if (b.indexOf('/mso/eligibility/by-member/') !== -1) {
      var mid = decodeURIComponent(b.split('/').pop());
      var e = D.eligibility.find(function(x){ return x.member_id === mid; });
      if (!e) return Promise.resolve(mkR({ error: 'Not found' }, 404));
      var p = D.patients.find(function(x){ return x.patient_id === e.patient_id; }) || {};
      return Promise.resolve(mkR(Object.assign({}, e, p)));
    }

    // Claims summary
    if (b === '/mso/claims/summary') {
      var rows = D.claims.slice();
      if (q.status) rows = rows.filter(function(r){ return r.status === q.status; });
      rows = npiFilter(rows, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ claims: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }
    // Claims by patient
    if (b.match(/^\\/mso\\/claims\\/[^\\/]+$/) && b.indexOf('summary') === -1) {
      var seg = b.split('/')[3];
      if (isNaN(parseInt(seg))) {
        var pid = decodeURIComponent(seg);
        var rows = D.claims.filter(function(c){ return c.patient_id === pid; });
        if (q.status) rows = rows.filter(function(r){ return r.status === q.status; });
        return Promise.resolve(mkR(rows));
      }
      return Promise.resolve(mkR({ success: true }));
    }

    // Authorizations list
    if (b === '/mso/auths') {
      var rows = joinPt(D.auths);
      if (q.status) rows = rows.filter(function(r){ return r.status === q.status; });
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ authorizations: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }
    // Auths by patient
    if (b.match(/^\\/mso\\/auths\\/[^\\/]+$/)) {
      var seg = b.split('/')[3];
      if (isNaN(parseInt(seg))) {
        var pid = decodeURIComponent(seg);
        return Promise.resolve(mkR(D.auths.filter(function(a){ return a.patient_id === pid; })));
      }
      return Promise.resolve(mkR({ success: true }));
    }

    // Labs list
    if (b === '/pcp/labs' || b.match(/^\\/pcp\\/labs$/)) {
      var rows = joinPt(D.labs);
      if (q.flag) rows = rows.filter(function(r){ return r.flag === q.flag; });
      rows = npiFilter(rows, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ labs: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }
    // Labs by patient
    if (b.match(/^\\/pcp\\/labs\\/[^\\/]+$/)) {
      var pid = decodeURIComponent(b.split('/')[3]);
      return Promise.resolve(mkR(D.labs.filter(function(l){ return l.patient_id === pid; })));
    }

    // Pharmacy
    if (b === '/pharmacy/refills-due') {
      var rows = joinPt(D.pharmacy);
      rows = npiFilter(rows, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ patients: pg.rows, total: pg.total }));
    }
    if (b === '/pharmacy/requests') return Promise.resolve(mkR({ requests: [], total: 0 }));
    if (b === '/pcp/pharmacy') {
      var rows = joinPt(D.pharmacy);
      rows = npiFilter(rows, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ patients: pg.rows, total: pg.total }));
    }
    if (b === '/pcp/panel-meds') return Promise.resolve(mkR(npiFilter(D.medications, q.npi)));
    if (b === '/pcp/medications') return Promise.resolve(mkR(npiFilter(D.medications, q.npi)));

    // MSO dashboard/payer-summary
    if (b === '/mso/payer-summary') return Promise.resolve(mkR({
      payers: [
        {payer_name:'Blue Shield of California',members:3412,active:2891,inactive:521,plan_type:'PPO/HMO'},
        {payer_name:'LA Care Health Plan',members:2847,active:2401,inactive:446,plan_type:'HMO/Medi-Cal'},
        {payer_name:'Health Net',members:1923,active:1644,inactive:279,plan_type:'HMO/PPO'},
        {payer_name:'Molina Healthcare',members:1241,active:1056,inactive:185,plan_type:'Medi-Cal'},
        {payer_name:'Anthem Blue Cross',members:824,active:399,inactive:425,plan_type:'HMO/EPO'},
      ],
      claimsByPayer: [
        {payer_name:'Blue Shield of California',claim_count:4219,total_billed:892400,total_paid:714000,denied:312},
        {payer_name:'LA Care Health Plan',claim_count:3841,total_billed:641200,total_paid:512000,denied:198},
        {payer_name:'Health Net',claim_count:2912,total_billed:487300,total_paid:389000,denied:142},
      ],
    }));
    if (b === '/mso/dashboard') return Promise.resolve(mkR({
      eligibility:    [{status:'Active',count:D.stats.activeEligibility},{status:'Inactive',count:1241},{status:'Termed',count:615}],
      claims:         [{status:'Paid',count:12847,total_billed:2891200,total_paid:2312000},{status:'Pending',count:D.stats.pendingClaims,total_billed:124000,total_paid:0},{status:'Denied',count:891,total_billed:289000,total_paid:0}],
      authorizations: [{status:'Approved',count:1247},{status:'Pending',count:D.stats.pendingAuths},{status:'Denied',count:312}],
      recentClaims:   D.claims.slice(0, 10),
      pendingAuths:   D.auths.filter(function(a){ return a.status === 'Pending'; }).slice(0, 10),
    }));

    // Schedule
    if (b === '/schedule/today') return Promise.resolve(mkR({ appointments: [] }));

    // PCP panel
    if (b === '/pcp/panel') {
      var rows = npiFilter(D.patients, q.npi);
      var pg = paginate(rows, q);
      return Promise.resolve(mkR({ patients: pg.rows, total: pg.total, page: pg.page, limit: pg.limit }));
    }
    if (b === '/pcp/panel/stats') {
      var n = q.npi ? npiFilter(D.patients, q.npi).length : D.patients.length;
      return Promise.resolve(mkR({
        totalPanelPatients: n, activeEligibility: Math.floor(n*.82),
        pendingClaims: Math.floor(n*.12), pendingAuths: Math.floor(n*.04),
        criticalLabs: Math.floor(n*.008), refillsDue: Math.floor(n*.06),
        eligSummary:  [{status:'Active',count:Math.floor(n*.82)},{status:'Inactive',count:Math.floor(n*.18)}],
        claimsSummary:[{status:'Paid',count:Math.floor(n*1.2)},{status:'Pending',count:Math.floor(n*.12)},{status:'Denied',count:Math.floor(n*.08)}],
      }));
    }

    // Patient portal lookup (v2 app)
    if (b.indexOf('/patient-portal/lookup/') !== -1) {
      var searchId = decodeURIComponent(b.split('/').pop());
      var pt = D.patients.find(function(p){ return p.patient_id === searchId; });
      if (!pt) {
        var e = D.eligibility.find(function(x){ return x.member_id === searchId; });
        if (e) pt = D.patients.find(function(p){ return p.patient_id === e.patient_id; });
      }
      if (!pt) return Promise.resolve(mkR({ error: 'Patient not found' }, 404));
      var pid = pt.patient_id;
      var pcpRec = D.pcp.find(function(p){ return p.patient_id === pid; }) || null;
      return Promise.resolve(mkR({
        patient:        pt,
        eligibility:    D.eligibility.filter(function(e){ return e.patient_id === pid; }),
        pcp:            pcpRec,
        medications:    D.medications.filter(function(m){ return m.patient_id === pid; }),
        authorizations: D.auths.filter(function(a){ return a.patient_id === pid; }),
        labs:           D.labs.filter(function(l){ return l.patient_id === pid; }),
        pharmacy:       D.pharmacy.filter(function(p){ return p.patient_id === pid; }),
        visitNotes:     D.visitNotes.filter(function(v){ return v.patient_id === pid; }),
      }));
    }

    // Fallback
    return Promise.resolve(mkR({ success: true, data:[], patients:[], labs:[], claims:[], authorizations:[], eligibility:[], total:0 }));
  }
})();
</script>
`;
}

// ── Portal switcher bar (injected into every portal) ──────────────────────
function buildSwitcher(activeMode) {
  var styles = {
    admin:   'background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.5);color:#3B82F6;',
    doctor:  'background:rgba(20,184,166,.15);border-color:rgba(20,184,166,.5);color:#14B8A6;',
    members: 'background:rgba(139,92,246,.15);border-color:rgba(139,92,246,.5);color:#8B5CF6;',
  };
  function btn(mode, label) {
    var base = 'font-size:12px;font-weight:700;padding:6px 16px;border-radius:7px;cursor:pointer;font-family:Inter,-apple-system,sans-serif;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#7A9AB8;transition:all .15s;';
    var extra = mode === activeMode ? styles[mode] : '';
    return '<button style="' + base + extra + '" onclick="window.__demoSwitch(\'' + mode + '\')">' + label + '</button>';
  }
  return `
<!-- SMG Bridge Demo Switcher -->
<style>
  #smg-demo-sw{position:fixed;bottom:0;left:0;right:0;height:44px;background:#030910;border-top:2px solid #6366F1;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:8px;font-family:Inter,-apple-system,sans-serif;}
  body{padding-bottom:44px!important;}
</style>
<div id="smg-demo-sw">
  <span style="font-size:9px;font-weight:800;color:#3D5A75;letter-spacing:1.2px;text-transform:uppercase;margin-right:12px;">SMG BRIDGE</span>
  ${btn('admin',   '⬛ Admin Portal')}
  ${btn('doctor',  '🩺 Clinical Portal')}
  ${btn('members', '📱 Patient App')}
  <span style="margin-left:12px;font-size:10px;color:#3D5A75;">Demo Mode · Real Data · No Server Required</span>
</div>
<script>
(function(){
  window.__demoSwitch = function(mode) {
    var store = localStorage.getItem('__smg_demo_portals__');
    if (!store) { alert('Demo portals not loaded. Please re-open bridge-demo.html.'); return; }
    var portals = JSON.parse(store);
    if (!portals[mode]) { alert('Portal "' + mode + '" not found.'); return; }
    document.open(); document.write(portals[mode]); document.close();
  };
})();
</script>
`;
}

// ── Admin portal auto-login script ────────────────────────────────────────
const ADMIN_AUTOLOGIN = `
<script id="smg-demo-autologin">
/* Auto-bypass admin login for demo mode */
(function () {
  'use strict';
  // Set a fake session token before the portal's DOMContentLoaded fires
  if (!localStorage.getItem('bridge_token')) {
    localStorage.setItem('bridge_token', 'demo_admin_bridge_2026');
  }
  if (!localStorage.getItem('bridge_user')) {
    localStorage.setItem('bridge_user', JSON.stringify({ id:1, username:'admin', role:'admin', orgId:null, npi:null }));
  }
})();
</script>
`;

// ── localStorage bootstrap (written on first portal open) ─────────────────
function buildBootstrap(adminHtml, doctorHtml, membersHtml) {
  var portalsJson = JSON.stringify({ admin: adminHtml, doctor: doctorHtml, members: membersHtml });
  return `
<script id="smg-demo-bootstrap">
/* Store all portal HTMLs so the switcher can load them instantly */
(function() {
  try {
    if (!localStorage.getItem('__smg_demo_portals__')) {
      localStorage.setItem('__smg_demo_portals__', ${JSON.stringify(portalsJson)});
    }
  } catch(e) {
    console.warn('[SMG Demo] localStorage unavailable — portal switching disabled.', e);
  }
})();
</script>
`;
}

// ── Modify portal HTML ─────────────────────────────────────────────────────
function modifyPortal(srcPath, opts) {
  var html = fs.readFileSync(srcPath, 'utf8');

  // Embed logo
  html = html.replace(/src="smg\.logo\.transparent\.v1\.png"/g, 'src="' + logoURI + '"');
  html = html.replace(/url\('smg\.logo\.transparent\.v1\.png'\)/g, "url('" + logoURI + "')");

  // Inject mock fetch right after <head>
  html = html.replace('<head>', '<head>\n' + opts.mockFetch);

  // Inject auto-login (admin only)
  if (opts.autoLogin) {
    html = html.replace('<head>', '<head>\n' + ADMIN_AUTOLOGIN);
  }

  // Inject switcher bar before </body>
  html = html.replace('</body>', opts.switcher + '\n</body>');

  return html;
}

// ── Build all 3 portal HTMLs ───────────────────────────────────────────────
ok('Building portal HTMLs...');

const mockFetchScript = buildMockFetchScript(DEMO_DATA);

// Build without bootstrap first (to get HTML strings for bootstrap)
const adminBase   = modifyPortal(ADMIN_SRC,   { mockFetch: mockFetchScript, switcher: buildSwitcher('admin'),   autoLogin: true  });
const doctorBase  = modifyPortal(DOCTOR_SRC,  { mockFetch: mockFetchScript, switcher: buildSwitcher('doctor'),  autoLogin: false });
const membersBase = modifyPortal(MEMBERS_SRC, { mockFetch: mockFetchScript, switcher: buildSwitcher('members'), autoLogin: false });

// Build bootstrap with the 3 base HTMLs
const bootstrap = buildBootstrap(adminBase, doctorBase, membersBase);

// Final admin HTML = adminBase + bootstrap (the output file starts as admin portal)
const finalHtml = adminBase.replace('</body>', bootstrap + '\n</body>');

// ── Write output ───────────────────────────────────────────────────────────
fs.writeFileSync(OUT_PATH, finalHtml, 'utf8');

const sizeKB = Math.round(fs.statSync(OUT_PATH).size / 1024);
ok('');
ok('Output : ' + OUT_PATH);
ok('Size   : ' + sizeKB + ' KB');
ok('');
ok('What the demo includes:');
ok('  Admin Portal    — ' + totalPatients.toLocaleString() + ' patients, full dashboard, calendar, consents, all data tables');
ok('  Clinical Portal — NPI-scoped view (demo NPIs: 4455667788 / 5544332211 / 0987654321)');
ok('  Patient App     — bilingual (EN/한국어), lookup any patient from the demo set');
ok('');
ok('Open client/bridge-demo.html in Chrome or Safari — no server required.');
ok('Share that single file. The portal switcher bar appears at the bottom of the screen.');
ok('');
console.log('Sample patient IDs for the Patient App:');
var sample = patients.filter(function(p){ return p.language === 'Korean'; }).slice(0, 5);
sample.forEach(function(p) {
  console.log('  ' + p.patient_id + '  —  ' + (p.korean_name || '') + ' (' + p.first_name + ' ' + p.last_name + ')');
});
