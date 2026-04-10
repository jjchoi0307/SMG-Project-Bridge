const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, seedUsers, seedDemoPortalData } = require('./database');
const { startWatcher } = require('./utils/watcher');
const { auditMiddleware } = require('./utils/audit');
const { requireAuth } = require('./middleware/requireAuth');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// ── Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(auditMiddleware);

// ── Serve static files
app.use(express.static(path.join(__dirname, '..', 'client')));  // portal HTML files
app.use(express.static(path.join(__dirname, '..')));             // root assets (logo, etc.)

// ── Public API routes (no auth required)
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/patient-portal', require('./routes/patientPortal'));

// ── Apply auth to all remaining /api routes
// Set BRIDGE_AUTH_ENABLED=false to bypass during local dev / stress testing
app.use('/api', requireAuth);

// ── Protected API Routes
app.use('/api/upload',   require('./routes/upload'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/mso',      require('./routes/mso'));
app.use('/api/pharmacy', require('./routes/pharmacy'));
app.use('/api/pcp',      require('./routes/pcp'));
app.use('/api/export',   require('./routes/export'));
app.use('/api',          require('./routes/portalAdmin'));

// ── Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── Catch-all: serve admin portal for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'bridge-admin.html'));
});

// ── Boot
initDb();
seedUsers();
seedDemoPortalData();
startWatcher(UPLOADS_DIR);

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  SMG Bridge Server running on port ${PORT}       ║`);
  console.log(`║                                              ║`);
  console.log(`║  Admin Portal:  http://localhost:${PORT}         ║`);
  console.log(`║  API Base:      http://localhost:${PORT}/api     ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});

module.exports = app;
