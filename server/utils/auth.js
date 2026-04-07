const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const { db } = require('../database');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const hashBuf  = Buffer.from(hash, 'hex');
    const derived  = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, derived);
  } catch { return false; }
}

function createSession(userId) {
  const token     = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, userId, expiresAt);
  return token;
}

function verifySession(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT s.token, u.id, u.username, u.full_name, u.role, u.portal, u.org_id, u.npi
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token) || null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Seed default portal accounts (called once on server boot)
function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const defaults = [
    // Doctor portal — each NPI maps to a known provider
    { username: 'doctor.park',   password: 'smg2026',   full_name: 'Dr. James Park',    role: 'physician',   portal: 'doctor' },
    { username: 'doctor.lee',    password: 'smg2026',   full_name: 'Dr. Sarah Lee',      role: 'physician',   portal: 'doctor' },
    { username: 'doctor.yoon',   password: 'smg2026',   full_name: 'Dr. Robert Yoon',   role: 'physician',   portal: 'doctor' },
    // SMG internal portal — 5 roles
    { username: 'coord.smg',     password: 'smg2026',   full_name: 'Care Coordinator',   role: 'coordinator', portal: 'smg' },
    { username: 'ops.smg',       password: 'smg2026',   full_name: 'SMG Operations',     role: 'operations',  portal: 'smg' },
    { username: 'physrel.smg',   password: 'smg2026',   full_name: 'Physician Relations',role: 'physrel',     portal: 'smg' },
    { username: 'lead.smg',      password: 'smg2026',   full_name: 'SMG Leadership',     role: 'leadership',  portal: 'smg' },
    { username: 'product.smg',   password: 'smg2026',   full_name: 'Product / App',      role: 'product',     portal: 'smg' },
    // Broker portal
    { username: 'broker.chen',   password: 'smg2026',   full_name: 'Calvin Chen',        role: 'broker',      portal: 'broker' },
    { username: 'broker.kim',    password: 'smg2026',   full_name: 'Kim Brokers',        role: 'broker',      portal: 'broker' },
    // Admin portal
    { username: 'admin',         password: 'smgadmin',  full_name: 'SMG Administrator',  role: 'admin',       portal: 'admin' },
  ];

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO users (username, password_hash, full_name, role, portal) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of defaults) {
    stmt.run(u.username, hashPassword(u.password), u.full_name, u.role, u.portal);
  }
  console.log('[AUTH] Seeded default users');
}

module.exports = { hashPassword, verifyPassword, createSession, verifySession, deleteSession, seedUsers };
