const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graphite', {
  listGuides: () => ipcRenderer.invoke('guides:list'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  detectConsole: path => ipcRenderer.invoke('sd:detectConsole', path),
  listInstalledApps: path => ipcRenderer.invoke('apps:installed', path),
  uninstallApp: (path, appId) => ipcRenderer.invoke('apps:uninstall', path, appId),
  loadGuide: file => ipcRenderer.invoke('guides:load', file),
  pickSD: () => ipcRenderer.invoke('sd:pick'),
  listSDRoot: path => ipcRenderer.invoke('sd:listRoot', path),
  clearSDRoot: path => ipcRenderer.invoke('sd:clearRoot', path),
  checkSD: path => ipcRenderer.invoke('sd:check', path),
  formatSD: path => ipcRenderer.invoke('sd:format', path),
  runAction: (action, root) => ipcRenderer.invoke('action:run', action, root),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: state => ipcRenderer.invoke('state:set', state),
  clearState: () => ipcRenderer.invoke('state:clear'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  getView: name => ipcRenderer.invoke('renderer:view', name),
  getTroubleshoot: folder => ipcRenderer.invoke('troubleshoot:get', folder),
});
