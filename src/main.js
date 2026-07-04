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
  win.loadFile('index.html');
}

// List bundled guides (metadata only) for the picker.
ipcMain.handle('guides:list', async () => {
  const dir = path.join(__dirname, 'guides');
  const files = await fs.promises.readdir(dir);
  return Promise.all(
    files.filter(f => f.endsWith('.json')).map(async f => {
      const g = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8'));
      return { file: f, console: g.console, method: g.method };
    })
  );
});

ipcMain.handle('guides:load', async (_e, file) => {
  const p = path.join(__dirname, 'guides', path.basename(file)); // basename = no traversal
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
