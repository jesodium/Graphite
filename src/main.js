const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { runAction } = require('./engine');

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
    for (const f of await fs.promises.readdir(sub)) {
      if (!f.endsWith('.json')) continue;
      const g = JSON.parse(await fs.promises.readFile(path.join(sub, f), 'utf8'));
      out.push({ file: `${e.name}/${f}`, console: g.console, title: g.title, recommended: !!g.recommended });
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
