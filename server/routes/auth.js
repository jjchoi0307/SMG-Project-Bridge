/**
 * /api/auth  — Authentication routes
 *
 * These are intentionally public (no requireAuth middleware) so that the
 * login page can reach them before a session exists.
 *
 * When migrating to Clerk or Auth0:
 *   - /login and /logout can be removed — the provider handles them
 *   - Keep /me as a convenience endpoint (backed by provider JWT)
 *   - /validate-token is the stub your PR will implement
 */
const express = require('express');
const { db } = require('../database');
const { verifyPassword, createSession, verifySession, deleteSession } = require('../utils/auth');

const router = express.Router();

// ── POST /api/auth/login  (local session auth)
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = createSession(user.id);

  res.json({
    token,
    user: {
      id:        user.id,
      username:  user.username,
      full_name: user.full_name,
      role:      user.role,
      portal:    user.portal,
      org_id:    user.org_id    || null,
      npi:       user.npi       || null,
    },
  });
});

// ── POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token) deleteSession(token);
  res.json({ success: true });
});

// ── GET /api/auth/me  — verify token and return user info
router.get('/me', (req, res) => {
  const token   = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    user: {
      id:        session.id,
      username:  session.username,
      full_name: session.full_name,
      role:      session.role,
      portal:    session.portal,
      org_id:    session.org_id  || null,
      npi:       session.npi     || null,
    },
  });
});

// ── GET /api/auth/validate-token  — provider JWT validation stub
// Replace the body of this route when you set up Clerk or Auth0.
// The frontend should call this on page load to confirm the provider token is
// still valid and exchange it for a normalized user object.
//
// Clerk implementation:
//   const { getAuth } = require('@clerk/express');
//   const { userId } = getAuth(req);
//   if (!userId) return res.status(401).json({ error: 'Invalid token' });
//   // look up or upsert local user row, return normalized user
//
// Auth0 implementation:
//   The express-oauth2-jwt-bearer middleware already validated req.auth.
//   if (!req.auth) return res.status(401).json({ error: 'Invalid token' });
router.get('/validate-token', (req, res) => {
  // TODO: implement when Clerk/Auth0 is configured
  res.status(501).json({ error: 'Provider auth not yet configured — use /api/auth/me with a session token' });
});

// ── GET /api/auth/users  — list user accounts (admin only, no password hashes)
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, role, portal, org_id, npi, created_at FROM users ORDER BY portal, role'
  ).all();
  res.json(users);
});

module.exports = router;
