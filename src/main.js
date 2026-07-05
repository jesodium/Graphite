const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { runAction } = require('./engine');
const { normalizeGuideMetadata } = require('./guide-index');

const stateFile = () => path.join(app.getPath('userData'), 'state.json');
const cacheDir = () => path.join(app.getPath('userData'), 'cache');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// List bundled guides (metadata only) for the picker. Folders = console.
ipcMain.handle('guides:list', async () => {
  const dir = path.join(__dirname, '..', 'guides');
  const out = [];
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    // Per-console config (name + identity color). Optional.
    let cfg = {};
    try { cfg = JSON.parse(await fs.promises.readFile(path.join(sub, 'console.json'), 'utf8')); }
    catch { /* no console.json for this folder */ }
    for (const f of await fs.promises.readdir(sub)) {
      if (!f.endsWith('.json') || f === 'console.json') continue;
      const g = JSON.parse(await fs.promises.readFile(path.join(sub, f), 'utf8'));
      const meta = normalizeGuideMetadata(`${e.name}/${f}`, g);
      if (meta.wip) continue;
      meta.edge = cfg.edge || null;
      out.push(meta);
    }
  }
  return out;
});

ipcMain.handle('guides:load', async (_e, file) => {
  const dir = path.join(__dirname, '..', 'guides');
  const p = path.join(dir, file);
  if (!p.startsWith(dir + path.sep)) throw new Error('bad guide path'); // no traversal
  return JSON.parse(await fs.promises.readFile(p, 'utf8'));
});

ipcMain.handle('sd:pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('sd:check', async (_e, path) => {
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported platform' };
  const { execFile } = require('child_process');
  return new Promise(resolve => {
    execFile('diskutil', ['info', path], (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      const m = stdout.match(/File System Personality:\s+(.+)/);
      const fsName = m ? m[1].trim() : '';
      const isFAT32 = fsName.includes('FAT') || fsName.includes('MS-DOS');
      resolve({ ok: true, isFAT32, fsName });
    });
  });
});

ipcMain.handle('sd:format', async (_e, path) => {
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported platform' };
  const { execFile } = require('child_process');
  return new Promise(resolve => {
    execFile('diskutil', ['info', path], (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message });
      const idMatch = stdout.match(/Device Identifier:\s+(.+)/);
      const volMatch = stdout.match(/Volume Name:\s+(.+)/);
      if (!idMatch) return resolve({ ok: false, error: 'no device identifier' });
      const diskId = idMatch[1].trim();
      const volName = volMatch ? volMatch[1].trim() : 'SD_CARD';
      execFile('diskutil', ['eraseDisk', 'FAT32', volName, diskId], (err2) => {
        if (err2) return resolve({ ok: false, error: err2.message });
        resolve({ ok: true });
      });
    });
  });
});

ipcMain.handle('action:run', async (_e, action, root) => {
  await fs.promises.mkdir(cacheDir(), { recursive: true });
  await runAction(action, { root, cache: cacheDir() });
  return true;
});

ipcMain.handle('state:get', async () => {
  try { return JSON.parse(await fs.promises.readFile(stateFile(), 'utf8')); }
  catch { return null; }
});

ipcMain.handle('state:set', async (_e, state) => {
  await fs.promises.writeFile(stateFile(), JSON.stringify(state, null, 2));
  return true;
});

ipcMain.handle('state:clear', async () => {
  await fs.promises.rm(stateFile(), { force: true });
  return true;
});

ipcMain.handle('app:platform', async () => process.platform);

ipcMain.handle('renderer:view', async (_e, name) => {
  if (name !== path.basename(name) || !name.endsWith('.html')) {
    throw new Error('bad view name');
  }
  const p = path.join(__dirname, 'renderer', 'views', name);
  return fs.promises.readFile(p, 'utf8');
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
