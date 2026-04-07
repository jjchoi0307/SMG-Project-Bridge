const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../database');
const { processExcelFile } = require('../utils/excel');
const { addSseClient, broadcast } = require('../utils/watcher');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer: accept xlsx / xls / csv, up to 50 MB each
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    // Preserve original name, avoid collisions with timestamp prefix
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
  },
});

// ── POST /api/upload  (single or multi-file)
router.post('/', upload.array('files', 200), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const results = [];

  for (const file of req.files) {
    // Register file in DB
    const info = db.prepare(`
      INSERT INTO excel_files (filename, filepath, status)
      VALUES (?, ?, 'pending')
      ON CONFLICT(filepath) DO UPDATE SET status = 'pending', filename = excluded.filename
    `).run(file.originalname, file.path);

    const fileId = info.lastInsertRowid ||
      db.prepare('SELECT id FROM excel_files WHERE filepath = ?').get(file.path)?.id;

    // Process synchronously (small files) or queue for large files
    const result = processExcelFile(file.path, fileId);
    results.push({
      originalName: file.originalname,
      savedAs: file.filename,
      size: file.size,
      ...result,
    });
  }

  broadcast('upload-complete', { count: req.files.length, timestamp: new Date().toISOString() });

  res.json({
    uploaded: req.files.length,
    results,
    patientCount: db.prepare('SELECT COUNT(*) as c FROM patients').get().c,
  });
});

// ── GET /api/upload/files  — list all uploaded files
router.get('/files', (req, res) => {
  const files = db.prepare(`
    SELECT id, filename, row_count, status, error_msg, uploaded_at, last_synced
    FROM excel_files
    ORDER BY uploaded_at DESC
  `).all();
  res.json(files);
});

// ── DELETE /api/upload/:id  — remove a file record and all data it imported
router.delete('/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM excel_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });

  // Purge all imported data from this source file
  const cleanupTables = ['pharmacy_records','lab_results','medication_requests',
                         'claims','authorizations','eligibility','pcp_providers'];
  for (const tbl of cleanupTables) {
    db.prepare(`DELETE FROM ${tbl} WHERE source_file = ?`).run(file.filename);
  }

  // Delete physical file
  if (fs.existsSync(file.filepath)) {
    try { fs.unlinkSync(file.filepath); } catch (_) {}
  }
  db.prepare('DELETE FROM excel_files WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── GET /api/upload/events  — SSE stream for real-time updates
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send initial heartbeat
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  addSseClient(res);

  // Heartbeat every 25s to keep connection alive
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(hb); }
  }, 25000);

  req.on('close', () => clearInterval(hb));
});

module.exports = router;
