/**
 * main/preload.js
 * 安全的 IPC 桥接：渲染进程只能通过 window.aippt 访问受限能力
 */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('aippt', {
  openMdDialog: () => ipcRenderer.invoke('dialog:open-md'),
  chooseOutPath: (defaultName) => ipcRenderer.invoke('dialog:save-pptx', defaultName),
  chooseBibPath: () => ipcRenderer.invoke('dialog:open-bib'),
  generate: (payload) => ipcRenderer.invoke('generate', payload),
  testConnection: (cfg) => ipcRenderer.invoke('ai:test', cfg),
  openFolder: (dir) => ipcRenderer.invoke('shell:open-folder', dir),
  onProgress: (cb) => {
    ipcRenderer.on('gen:progress', (_e, msg) => cb(msg));
  },
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  /** 拖拽文件的真实磁盘路径（图片相对路径需按 md 所在目录解析） */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return '';
    }
  }
});
