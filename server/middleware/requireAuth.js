/**
 * requireAuth — provider-agnostic authentication middleware
 *
 * Currently uses the built-in session system (scrypt tokens stored in SQLite).
 * When you set up Clerk or Auth0, replace verifyToken() with the provider SDK
 * and set the BRIDGE_AUTH_MODE environment variable.
 *
 * ── Migration path ───────────────────────────────────────────────────────────
 *
 *   CLERK
 *   1. npm install @clerk/express
 *   2. Set BRIDGE_AUTH_MODE=clerk
 *   3. Set CLERK_SECRET_KEY=sk_... in your .env
 *   4. In index.js add: app.use(clerkMiddleware()) before routes
 *   5. Uncomment the Clerk block below in verifyToken()
 *
 *   AUTH0
 *   1. npm install express-oauth2-jwt-bearer
 *   2. Set BRIDGE_AUTH_MODE=auth0
 *   3. Set AUTH0_DOMAIN and AUTH0_AUDIENCE in your .env
 *   4. In index.js add: app.use(auth()) before routes
 *   5. Uncomment the Auth0 block below in verifyToken()
 *
 * ── req.user shape (must be preserved by any provider) ───────────────────────
 *   {
 *     id:       string   internal or provider user ID
 *     username: string   login handle or email
 *     fullName: string   display name
 *     role:     string   'admin'|'physician'|'coordinator'|'operations'|
 *                        'physrel'|'leadership'|'product'|'broker'
 *     portal:   string   'admin'|'smg'|'doctor'|'broker'
 *     orgId:    string   Clerk/Auth0 org ID — used for tenant data scoping
 *     npi:      string   NPI number (physician portal only)
 *   }
 *
 * ── BRIDGE_AUTH_ENABLED ───────────────────────────────────────────────────────
 *   Set BRIDGE_AUTH_ENABLED=false to bypass auth entirely (dev/testing only).
 *   All requests will be treated as an SMG admin. Never use in production.
 */

const { verifySession } = require('../utils/auth');

const AUTH_MODE    = process.env.BRIDGE_AUTH_MODE    || 'local';
const AUTH_ENABLED = process.env.BRIDGE_AUTH_ENABLED === 'true'; // default OFF for demo

// ── Token verification — replace this block when migrating to Clerk/Auth0 ────
function verifyToken(req) {
  if (AUTH_MODE === 'local') {
    const token   = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const session = verifySession(token);
    if (!session) return null;
    return {
      id:       String(session.id),
      username: session.username,
      fullName: session.full_name,
      role:     session.role,
      portal:   session.portal,
      orgId:    session.org_id  || null,
      npi:      session.npi     || null,
    };
  }

  // ── Clerk ─────────────────────────────────────────────────────────────────
  // Requires: npm install @clerk/express
  // In index.js add app.use(clerkMiddleware()) before routes.
  //
  // if (AUTH_MODE === 'clerk') {
  //   const { getAuth } = require('@clerk/express');
  //   const { userId, orgId, sessionClaims } = getAuth(req);
  //   if (!userId) return null;
  //   const meta = sessionClaims?.publicMetadata || {};
  //   return {
  //     id:       userId,
  //     username: sessionClaims?.username || userId,
  //     fullName: sessionClaims?.name || '',
  //     role:     meta.role    || 'coordinator',
  //     portal:   meta.portal  || 'smg',
  //     orgId:    orgId        || null,
  //     npi:      meta.npi     || null,
  //   };
  // }

  // ── Auth0 ─────────────────────────────────────────────────────────────────
  // Requires: npm install express-oauth2-jwt-bearer
  // In index.js add: app.use(auth({ audience: process.env.AUTH0_AUDIENCE, issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}` }))
  //
  // if (AUTH_MODE === 'auth0') {
  //   const payload = req.auth?.payload;
  //   if (!payload) return null;
  //   const ns = 'https://smgbridge.com/';  // your Auth0 custom claims namespace
  //   return {
  //     id:       payload.sub,
  //     username: payload.nickname || payload.email || payload.sub,
  //     fullName: payload.name || '',
  //     role:     payload[`${ns}role`]   || 'coordinator',
  //     portal:   payload[`${ns}portal`] || 'smg',
  //     orgId:    payload[`${ns}orgId`]  || null,
  //     npi:      payload[`${ns}npi`]    || null,
  //   };
  // }

  return null;
}

// ── Dev bypass user (only when BRIDGE_AUTH_ENABLED=false) ────────────────────
const DEV_USER = {
  id: 'dev', username: 'dev', fullName: 'Dev / Stress Test',
  role: 'admin', portal: 'admin', orgId: null, npi: null,
};

// ── requireAuth ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) {
    req.user = DEV_USER;
    return next();
  }
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

// ── requireRole ───────────────────────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied — requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// ── requirePortal ─────────────────────────────────────────────────────────────
function requirePortal(...portals) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!portals.includes(req.user.portal)) {
      return res.status(403).json({ error: 'Access denied for this portal' });
    }
    next();
  };
}

// ── requireAdmin ─────────────────────────────────────────────────────────────
const requireAdmin = requireRole('admin');

module.exports = { requireAuth, requireRole, requirePortal, requireAdmin };
