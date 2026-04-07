const { db } = require('../database');

// Map URL patterns → table names for audit logging
const URL_TABLE_MAP = [
  [/\/api\/mso\/eligibility/,          'eligibility'],
  [/\/api\/mso\/claims/,               'claims'],
  [/\/api\/mso\/auths/,                'authorizations'],
  [/\/api\/pharmacy\/request/,         'pharmacy_requests'],
  [/\/api\/pcp\/labs/,                 'lab_results'],
  [/\/api\/pcp\/medications/,          'medication_requests'],
  [/\/api\/patients(?!\/stats)(?!\/intel)/, 'patients'],
  [/\/api\/upload(?!\/events)(?!\/files)/,  'excel_files'],
];

function resolveTable(url) {
  for (const [re, tbl] of URL_TABLE_MAP) {
    if (re.test(url)) return tbl;
  }
  return null;
}

function auditMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  const table = resolveTable(req.originalUrl);
  if (!table) return next();

  const orig = res.json.bind(res);
  res.json = function(body) {
    try {
      if (body && !body.error) {
        const action = req.method === 'POST' ? 'CREATE'
                     : req.method === 'PUT'  ? 'UPDATE'
                     :                         'DELETE';
        const recordId = String(
          req.params.id || req.params.pid || body.id || ''
        );
        db.prepare(
          `INSERT INTO audit_log (action, table_name, record_id, changes_json, ip_address)
           VALUES (?, ?, ?, ?, ?)`
        ).run(action, table, recordId, JSON.stringify(req.body || {}), req.ip || '');
      }
    } catch (_) {} // never throw from audit logging
    return orig(body);
  };
  next();
}

module.exports = { auditMiddleware };
