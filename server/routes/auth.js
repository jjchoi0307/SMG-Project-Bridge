const express = require('express');
const { db } = require('../database');
const { verifyPassword, createSession, verifySession, deleteSession } = require('../utils/auth');

const router = express.Router();

// ── POST /api/auth/login
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
    },
  });
});

// ── GET /api/auth/users  — list all user accounts (admin only, no password hashes)
router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, full_name, role, portal, created_at FROM users ORDER BY portal, role'
  ).all();
  res.json(users);
});

module.exports = router;
