#!/usr/bin/env node
/**
 * Bridge – Shareable Executive Demo Generator
 * ─────────────────────────────────────────────
 * Usage (from project root):
 *   node generate-shareable.js [patient_id]
 *   node generate-shareable.js SMG-10008
 *
 * Output: bridge-shareable-<patient_id>.html
 *   • SMG logo embedded as base64 (no external files needed)
 *   • Patient + caregiver data pre-loaded from the database
 *   • Skips signup / login flow entirely
 *   • Works in Chrome/Safari by double-clicking — no server required
 */

const fs   = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ── Config ────────────────────────────────────────────────────────────────
const PATIENT_ID = process.argv[2] || 'SMG-10008';
const ROOT       = __dirname;
const LOGO_PATH  = path.join(ROOT, 'smg.logo.transparent.v1.png');
const HTML_SRC   = path.join(ROOT, 'client', 'bridge-members-v2.html');
const DB_PATH    = path.join(ROOT, 'data', 'bridge.db');
const OUT_PATH   = path.join(ROOT, `bridge-shareable-${PATIENT_ID}.html`);

// ── Guards ────────────────────────────────────────────────────────────────
function die(msg) { console.error('✗', msg); process.exit(1); }
function ok(msg)  { console.log('✓', msg); }

if (!fs.existsSync(DB_PATH))   die('Database not found: '     + DB_PATH);
if (!fs.existsSync(LOGO_PATH)) die('Logo not found: '         + LOGO_PATH);
if (!fs.existsSync(HTML_SRC))  die('HTML source not found: '  + HTML_SRC);

// ── Query patient data from database ─────────────────────────────────────
const db = new DatabaseSync(DB_PATH);

const patient = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(PATIENT_ID);
if (!patient) {
  // Show sample valid IDs to help the user
  const samples = db.prepare(
    "SELECT patient_id, first_name, last_name FROM patients ORDER BY patient_id LIMIT 15"
  ).all();
  console.error('✗ Patient not found:', PATIENT_ID);
  console.error('');
  console.error('Available patient IDs (first 15):');
  samples.forEach(function(r) {
    console.error('  ' + r.patient_id + '  —  ' + r.first_name + ' ' + r.last_name);
  });
  console.error('');
  console.error('Usage: node generate-shareable.js <patient_id>');
  process.exit(1);
}

const pid = patient.patient_id;

const eligibility    = db.prepare(`
  SELECT * FROM eligibility WHERE patient_id = ? ORDER BY updated_at DESC LIMIT 1
`).get(pid);

const pcp = db.prepare(`
  SELECT * FROM pcp_providers WHERE patient_id = ? LIMIT 1
`).get(pid);

const medications = db.prepare(`
  SELECT * FROM medication_requests
  WHERE patient_id = ? AND status = 'Active'
  ORDER BY prescribed_date DESC LIMIT 10
`).all(pid);

const authorizations = db.prepare(`
  SELECT * FROM authorizations
  WHERE patient_id = ? ORDER BY requested_date DESC LIMIT 5
`).all(pid);

const labs = db.prepare(`
  SELECT * FROM lab_results
  WHERE patient_id = ? ORDER BY result_date DESC LIMIT 8
`).all(pid);

const pharmacy = db.prepare(`
  SELECT * FROM pharmacy_records
  WHERE patient_id = ? ORDER BY refill_due_date ASC LIMIT 8
`).all(pid);

const visitNotes = db.prepare(`
  SELECT * FROM visit_notes
  WHERE patient_id = ? ORDER BY visit_date DESC LIMIT 6
`).all(pid);

const profile = {
  patient,
  eligibility: eligibility ? [eligibility] : [],
  pcp:          pcp || null,
  medications,
  authorizations,
  labs,
  pharmacy,
  visitNotes,
};

ok(`Patient : ${patient.first_name} ${patient.last_name} (${pid})`);
ok(`PCP     : ${pcp ? pcp.provider_name + ' @ ' + pcp.practice_name : 'none'}`);
ok(`Meds    : ${medications.length} active  |  Pharmacy: ${pharmacy.length}`);
ok(`Notes   : ${visitNotes.length}  |  Labs: ${labs.length}  |  Auths: ${authorizations.length}`);

// ── Logo → base64 data URI ────────────────────────────────────────────────
const logoB64 = fs.readFileSync(LOGO_PATH).toString('base64');
const logoURI = `data:image/png;base64,${logoB64}`;

// ── Read source HTML ──────────────────────────────────────────────────────
let html = fs.readFileSync(HTML_SRC, 'utf8');

// ── Embed logo (replace all occurrences) ─────────────────────────────────
html = html.replace(/src="smg\.logo\.transparent\.v1\.png"/g, `src="${logoURI}"`);

// ── Update page title ─────────────────────────────────────────────────────
const ptName = `${patient.first_name} ${patient.last_name}`;
html = html.replace(
  '<title>SMG Bridge – Members V2</title>',
  `<title>SMG Bridge – ${ptName} | Executive Demo</title>`
);

// ── Derive key values (mirrors server-side logic) ─────────────────────────
const firstName = patient.first_name || 'Member';
const lastName  = patient.last_name  || '';
const pcpName   = pcp ? pcp.provider_name : 'Your Doctor';
const pcpPrac   = pcp ? pcp.practice_name : 'SMG';
const payer     = eligibility ? (eligibility.plan_name || eligibility.payer_name || 'Your Plan') : 'Your Plan';
const memberId  = eligibility ? (eligibility.member_id || '—') : '—';
const profileJSON = JSON.stringify(profile);

// ── Auto-init script (injected right before </body>) ──────────────────────
const autoInit = `
<!-- ═══════════════════════════════════════════════════════
     BRIDGE SHAREABLE — auto-generated by generate-shareable.js
     Patient  : ${ptName} (${pid})
     Generated: ${new Date().toLocaleString()}
     ═══════════════════════════════════════════════════════ -->
<script>
(function () {
  'use strict';

  /* Embedded patient profile — no API call needed */
  var PROFILE = ${profileJSON};

  window.addEventListener('load', function () {
    try {
      init();
    } catch (err) {
      console.error('[Bridge Shareable] Init error:', err);
    }
  });

  function set(id, text, enText, koText) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (enText !== undefined) el.setAttribute('data-en', enText || text);
    if (koText !== undefined) el.setAttribute('data-ko', koText || text);
  }

  function init() {
    var d    = PROFILE;
    var p    = d.patient;
    var elig = (d.eligibility || [])[0] || null;
    var pcp  = d.pcp || null;
    var meds = (d.medications || []).filter(function (m) { return m.status === 'Active'; });

    var first    = p.first_name || 'Member';
    var last     = p.last_name  || '';
    var pcpName  = (pcp && pcp.provider_name) || 'Your Doctor';
    var pcpPrac  = (pcp && pcp.practice_name) || 'SMG';
    var payer    = elig ? (elig.plan_name || elig.payer_name || 'Your Plan') : 'Your Plan';
    var memberId = elig ? (elig.member_id || '—') : '—';

    // ── 1. Populate all dynamic content ─────────────────────────────────
    if (typeof populatePatientPhones === 'function') {
      populatePatientPhones(
        p, elig, pcp, meds,
        d.authorizations || [],
        d.labs || [],
        d.pharmacy || [],
        d.visitNotes || []
      );
    }

    // ── 2. Live date on patient home ─────────────────────────────────────
    var dateEl = document.querySelector('.pt-date');
    if (dateEl) {
      var now  = new Date();
      var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var mons = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
      var ds = days[now.getDay()] + ', ' + mons[now.getMonth()] + ' ' + now.getDate();
      dateEl.textContent = ds;
      dateEl.setAttribute('data-en', ds);
    }

    // ── 3. Caregiver home tab texts ──────────────────────────────────────
    set('cg-hello-name',
      'Hi, Family.',
      'Hi, Family.',
      '안녕하세요.');

    var cgSub = "Here's how " + first + " is doing today.";
    var cgSubKo = first + ' 씨가 오늘 어떻게 지내고 있는지 확인해보세요.';
    set('cg-hello-sub', cgSub, cgSub, cgSubKo);

    // ── 4. Caregiver quiet message ────────────────────────────────────────
    var cgQuiet = document.getElementById('cg-quiet');
    if (cgQuiet) cgQuiet.innerHTML = '💚 ' + first + ' is doing well today.';

    // ── 5. Caregiver account — insurance section ──────────────────────────
    var insHead = first + "'s Insurance";
    set('cg-acct-section-head', insHead, insHead, first + ' 씨의 보험');
    set('cg-acct-ins-name', payer);
    var memVal = 'Member ID: ' + memberId;
    set('cg-acct-member-id', memVal, memVal, '회원 번호: ' + memberId);

    // ── 6. Caregiver auth list ────────────────────────────────────────────
    var cgAuths = document.getElementById('cg-auths-list');
    if (cgAuths && typeof buildCgAuthCards === 'function') {
      cgAuths.innerHTML = buildCgAuthCards(d.authorizations || []);
    }

    // ── 7. Caregiver action card — med reminder text ──────────────────────
    var acTitle = first + " hasn't taken her meds yet today.";
    var acTitleKo = first + ' 씨가 오늘 아직 약을 드시지 않았습니다.';
    set('ac-meds-title', acTitle, acTitle, acTitleKo);

    var acBodyEl = document.getElementById('ac-meds-body');
    if (acBodyEl && meds.length > 0) {
      var names = meds.slice(0, 2).map(function (m) { return m.medication_name; }).join(' and ');
      var bv   = 'Her ' + names + ' are marked as pending. She usually takes them with breakfast.';
      var bvKo = names + ' 복용이 아직 확인되지 않았습니다. 보통 아침 식사와 함께 드십니다.';
      set('ac-meds-body', bv, bv, bvKo);
    }

    // ── 8. Messages tab header ────────────────────────────────────────────
    var msgHdr = 'Messages with ' + first;
    set('cg-msg-header', msgHdr, msgHdr, first + ' 씨와의 메시지');

    // ── 9. Patient name refs ──────────────────────────────────────────────
    ['cg-pt-name', 'cg-pt-name2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = first + ' ' + last;
    });

    // ── 10. EN strings with patient name ─────────────────────────────────
    if (typeof EN !== 'undefined') {
      EN.downCardTitle = first + " is having a hard day today. 💛";
      EN.downCardBody  = first + " checked in as 😔 this morning. She might just need to hear your voice.";
    }

    // ── 11. Re-apply language ─────────────────────────────────────────────
    if (typeof setLang === 'function' && window.currentLang) {
      setLang(window.currentLang);
    }

    // ── 12. Refresh caregiver score card ──────────────────────────────────
    if (typeof refreshCgScore === 'function') refreshCgScore();

    // ── 13. Navigate to app views (skip signup/greeting) ─────────────────
    if (typeof goTo === 'function') {
      goTo('pt-app');                       // patient phone → app
      goTo('cg-app', 'phone-caregiver');   // caregiver phone → app
    }

    console.log('[Bridge Shareable] ✓ Ready —', first, last, '(' + p.patient_id + ')');
  }
})();
</script>
`;

html = html.replace('</body>', autoInit + '\n</body>');

// ── Write output ──────────────────────────────────────────────────────────
fs.writeFileSync(OUT_PATH, html, 'utf8');
const sizeKB = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);

ok('');
ok('Output  : ' + OUT_PATH);
ok('Size    : ' + sizeKB + ' KB');
ok('Open in Chrome or Safari — no server required.');
ok('');
console.log('To generate for a different patient:');
console.log('  node generate-shareable.js SMG-10001');
