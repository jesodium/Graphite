const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graphite', {
  listGuides: () => ipcRenderer.invoke('guides:list'),
  loadGuide: file => ipcRenderer.invoke('guides:load', file),
  pickSD: () => ipcRenderer.invoke('sd:pick'),
  checkSD: path => ipcRenderer.invoke('sd:check', path),
  formatSD: path => ipcRenderer.invoke('sd:format', path),
  runAction: (action, root) => ipcRenderer.invoke('action:run', action, root),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: state => ipcRenderer.invoke('state:set', state),
  clearState: () => ipcRenderer.invoke('state:clear'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  getView: name => ipcRenderer.invoke('renderer:view', name),
});
