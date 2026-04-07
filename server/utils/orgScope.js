/**
 * orgScope — tenant-aware data scoping utilities
 *
 * All patient data queries must pass through one of these helpers to enforce
 * data separation between broker organizations and physician panels.
 *
 * Role access matrix:
 *   admin, coordinator, operations, leadership, physrel, product
 *     → sees ALL data (no WHERE filter added)
 *   broker
 *     → sees only patients WHERE org_id = user.orgId
 *   physician
 *     → sees only patients WHERE patient_id IN
 *         (SELECT patient_id FROM pcp_providers WHERE provider_npi = user.npi)
 *
 * Usage — when patients table is in the query (aliased as 'p' by convention):
 *   const { conditions, params } = patientScope(req.user);
 *   const allConds = [...myConditions, ...conditions];
 *   const where    = allConds.length ? `WHERE ${allConds.join(' AND ')}` : '';
 *   db.prepare(`SELECT * FROM patients p ${where} LIMIT ? OFFSET ?`)
 *     .all(...myParams, ...params, limit, offset);
 *
 * Usage — when filtering by patient_id (no patients table join):
 *   const { conditions, params } = patientIdScope(req.user);
 *   // e.g. conditions = ['patient_id IN (SELECT patient_id FROM patients WHERE org_id = ?)']
 */

// Roles that belong to SMG and can see everything
const SMG_ROLES = new Set([
  'admin', 'coordinator', 'operations', 'leadership', 'physrel', 'product',
]);

/**
 * patientScope — returns WHERE conditions/params to filter the patients table.
 * Assumes patients table is aliased as `p` in the query.
 *
 * @param {object} user  — req.user from requireAuth
 * @returns {{ conditions: string[], params: any[] }}
 */
function patientScope(user) {
  if (!user) return { conditions: ['1 = 0'], params: [] };

  if (SMG_ROLES.has(user.role)) {
    return { conditions: [], params: [] };
  }

  if (user.role === 'broker') {
    if (!user.orgId) return { conditions: ['1 = 0'], params: [] };
    return {
      conditions: ['p.org_id = ?'],
      params:     [user.orgId],
    };
  }

  if (user.role === 'physician') {
    if (!user.npi) return { conditions: ['1 = 0'], params: [] };
    return {
      conditions: [
        `p.patient_id IN (
          SELECT patient_id FROM pcp_providers
          WHERE provider_npi = ? AND status = 'Active'
        )`,
      ],
      params: [user.npi],
    };
  }

  // Unknown role → deny
  return { conditions: ['1 = 0'], params: [] };
}

/**
 * patientIdScope — returns WHERE conditions/params to filter by patient_id
 * in tables that don't directly join the patients table (e.g. claims, auths).
 *
 * @param {object} user  — req.user from requireAuth
 * @returns {{ conditions: string[], params: any[] }}
 */
function patientIdScope(user) {
  if (!user) return { conditions: ['1 = 0'], params: [] };

  if (SMG_ROLES.has(user.role)) {
    return { conditions: [], params: [] };
  }

  if (user.role === 'broker') {
    if (!user.orgId) return { conditions: ['1 = 0'], params: [] };
    return {
      conditions: ['patient_id IN (SELECT patient_id FROM patients WHERE org_id = ?)'],
      params:     [user.orgId],
    };
  }

  if (user.role === 'physician') {
    if (!user.npi) return { conditions: ['1 = 0'], params: [] };
    return {
      conditions: [
        `patient_id IN (
          SELECT patient_id FROM pcp_providers
          WHERE provider_npi = ? AND status = 'Active'
        )`,
      ],
      params: [user.npi],
    };
  }

  return { conditions: ['1 = 0'], params: [] };
}

/**
 * mergeConditions — helper to combine base conditions with scope conditions.
 *
 * @param {string[]} base   — existing WHERE conditions
 * @param {string[]} scope  — conditions from patientScope / patientIdScope
 * @returns {string}        — full WHERE clause (or empty string)
 */
function mergeWhere(base, scope) {
  const all = [...base, ...scope];
  return all.length ? `WHERE ${all.join(' AND ')}` : '';
}

module.exports = { patientScope, patientIdScope, mergeWhere, SMG_ROLES };
