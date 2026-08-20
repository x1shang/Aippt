/**
 * main/preload.js
 * 安全的 IPC 桥接：渲染进程只能通过 window.aippt 访问受限能力
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aippt', {
  openMdDialog: () => ipcRenderer.invoke('dialog:open-md'),
  chooseOutPath: (defaultName) => ipcRenderer.invoke('dialog:save-pptx', defaultName),
  generate: (payload) => ipcRenderer.invoke('generate', payload),
  testConnection: (cfg) => ipcRenderer.invoke('ai:test', cfg),
  openFolder: (dir) => ipcRenderer.invoke('shell:open-folder', dir),
  onProgress: (cb) => {
    ipcRenderer.on('gen:progress', (_e, msg) => cb(msg));
  },
  getAppInfo: () => ipcRenderer.invoke('app:info')
});
