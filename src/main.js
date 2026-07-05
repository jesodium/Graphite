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
    title: 'Graphite',
    icon: path.join(__dirname, 'images', 'logo.png'),
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
      if (!f.endsWith('.json') || f === 'console.json' || f === 'troubleshoot.json') continue;
      const g = JSON.parse(await fs.promises.readFile(path.join(sub, f), 'utf8'));
      const meta = normalizeGuideMetadata(`${e.name}/${f}`, g);
      if (meta.wip) continue;
      meta.edge = cfg.edge || null;
      if (cfg.tileImage) meta.consoleTileImage = cfg.tileImage;
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

const execFileP = require('util').promisify(require('child_process').execFile);

// Real FAT32 only. exFAT/NTFS report strings that contain "FAT" but are not valid for Wii U.
function isFat32Fs(fsName) {
  const s = (fsName || '').toLowerCase();
  if (s.includes('exfat')) return false;
  return /fat32|vfat|ms-dos/.test(s);
}

ipcMain.handle('sd:check', async (_e, target) => {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileP('diskutil', ['info', target]);
      const m = stdout.match(/File System Personality:\s+(.+)/);
      const fsName = m ? m[1].trim() : '';
      return { ok: true, isFAT32: isFat32Fs(fsName), fsName };
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('powershell', ['-NoProfile', '-Command',
        `(Get-Volume -FilePath '${target}').FileSystem`]);
      const fsName = stdout.trim();
      return { ok: true, isFAT32: isFat32Fs(fsName), fsName };
    }
    // linux
    const { stdout } = await execFileP('findmnt', ['-n', '-o', 'FSTYPE', '--target', target]);
    const fsName = stdout.trim();
    return { ok: true, isFAT32: isFat32Fs(fsName), fsName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sd:format', async (_e, target) => {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileP('diskutil', ['info', target]);
      // "Device Identifier" is the partition (disk6s1); eraseDisk needs the whole disk (disk6).
      const wholeMatch = stdout.match(/Part of Whole:\s+(.+)/);
      const idMatch = stdout.match(/Device Identifier:\s+(.+)/);
      const disk = (wholeMatch || idMatch)?.[1].trim();
      if (!disk) return { ok: false, error: 'no device identifier' };
      // FAT32 labels must be uppercase, alnum, <=11 chars — reuse the card's name but sanitize.
      const volMatch = stdout.match(/Volume Name:\s+(.+)/);
      const raw = volMatch ? volMatch[1].trim() : '';
      const volName = (raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)) || 'SDCARD';
      await execFileP('diskutil', ['eraseDisk', 'FAT32', volName, disk]);
      return { ok: true, mount: `/Volumes/${volName}` }; // eraseDisk remounts here
    }
    if (process.platform === 'win32') {
      // IMPORTANT NOTE: format.com caps FAT32 at 32GB and needs an elevated shell.
      // Larger cards or a UAC denial surface as an error → tell the user to use guiformat/Rufus.
      const drive = String(target).slice(0, 2); // "E:"
      await execFileP('cmd', ['/c', 'format', drive, '/FS:FAT32', '/Q', '/Y']);
      return { ok: true }; // drive letter is unchanged by format
    }
    // linux — IMPORTANT NOTE: mkfs.vfat needs root and the device unmounted; a failure
    // surfaces the stderr so the user can run it manually with sudo.
    const { stdout } = await execFileP('findmnt', ['-n', '-o', 'SOURCE', '--target', target]);
    const device = stdout.trim();
    if (!device) return { ok: false, error: 'could not resolve device for path' };
    await execFileP('umount', [device]).catch(() => {}); // may already be unmounted
    await execFileP('mkfs.vfat', ['-F', '32', device]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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

// Return a console's local troubleshooting content (error → fix), shown in-app.
// `folder` is the guide's console folder, e.g. "wiiu". Empty {} if none exists.
ipcMain.handle('troubleshoot:get', async (_e, folder) => {
  if (folder !== path.basename(folder || '')) throw new Error('bad folder'); // no traversal
  const p = path.join(__dirname, '..', 'guides', folder, 'troubleshoot.json');
  try { return JSON.parse(await fs.promises.readFile(p, 'utf8')); }
  catch { return {}; }
});

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
