const chokidar = require('chokidar');
const path = require('path');
const { reprocessFile } = require('./excel');

// SSE clients registry (for push notifications to browser)
const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { sseClients.delete(client); }
  }
}

// Watch the uploads directory for file changes
let watcher = null;

function startWatcher(uploadsDir) {
  if (watcher) return;

  watcher = chokidar.watch(uploadsDir, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,      // don't trigger on already-processed files at startup
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on('change', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;

    console.log(`[WATCHER] File changed: ${path.basename(filepath)}`);
    reprocessFile(filepath);
    broadcast('file-updated', { filename: path.basename(filepath), timestamp: new Date().toISOString() });
  });

  watcher.on('add', (filepath) => {
    const ext = path.extname(filepath).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
    console.log(`[WATCHER] New file detected: ${path.basename(filepath)}`);
    broadcast('file-added', { filename: path.basename(filepath), timestamp: new Date().toISOString() });
  });

  console.log(`[WATCHER] Watching: ${uploadsDir}`);
}

function stopWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
}

module.exports = { startWatcher, stopWatcher, addSseClient, broadcast };
