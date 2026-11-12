const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', Object.freeze({
  action: command => ipcRenderer.invoke('launcher:action', command),
  ready: () => ipcRenderer.invoke('launcher:state'),
  onState: callback => ipcRenderer.on('launcher:state', (_event, value) => callback(value)),
}));
