const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graphite', {
  listGuides: () => ipcRenderer.invoke('guides:list'),
  loadGuide: file => ipcRenderer.invoke('guides:load', file),
  pickSD: () => ipcRenderer.invoke('sd:pick'),
  runAction: (action, root) => ipcRenderer.invoke('action:run', action, root),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: state => ipcRenderer.invoke('state:set', state),
});
