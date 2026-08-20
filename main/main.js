/**
 * main/main.js
 * Electron 主进程：窗口管理 + IPC
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { runGenerate } = require('./generate-flow.js');
const { testConnection } = require('./ai.js');

const MAX_MD_BYTES = 2 * 1024 * 1024; // 2MB

let mainWindow = null;
let busy = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    title: 'AIPPT · AI 演示文稿生成器',
    backgroundColor: '#F4F6FB',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 冒烟测试：AIPPT_SMOKE=1 时自动验证 UI 就绪 + AI 模式端到端生成后退出
  if (process.env.AIPPT_SMOKE === '1') {
    const http = require('http');
    const os = require('os');
    const mockServer = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          slides: [
            { title: '冒烟测试封面', subtitle: 'AI 生成', bullets: ['要点 A', '要点 B'], layout: 'cover' },
            { title: '方案对比', layout: 'two-column', columns: [{ heading: '方案一', items: ['快'] }, { heading: '方案二', items: ['稳'] }] },
            { title: '谢谢观看', layout: 'end' }
          ]
        }) } }] }));
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      const mockUrl = `http://127.0.0.1:${mockServer.address().port}/v1`;
      const smokeOut = path.join(os.tmpdir(), `aippt-smoke-${Date.now()}.pptx`);
      let smokeMd = '';
      try {
        smokeMd = fs.readFileSync(path.join(__dirname, '..', 'test', 'sample.md'), 'utf8');
      } catch (e) {
        smokeMd = '# 冒烟测试\n\n## 第一页\n- 要点一\n- 要点二\n\n> 备注内容\n\n## 谢谢观看\n';
      }
      mainWindow.webContents.once('did-finish-load', async () => {
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const errs = [];
            window.addEventListener('error', (e) => errs.push(e.message));
            const steps = document.querySelectorAll('.step-card').length;
            const styles = document.querySelectorAll('.style-card').length;
            const api = typeof window.aippt;
            document.getElementById('btnSample').click();
            await new Promise((r) => setTimeout(r, 400));
            const previewCount = document.querySelectorAll('.slide-item').length;
            const notesShown = document.querySelectorAll('.slide-notes').length;
            const res = await window.aippt.generate({
              apiConfig: { baseUrl: ${JSON.stringify(mockUrl)}, apiKey: 'smoke', model: 'mock-model' },
              mdContent: ${JSON.stringify(smokeMd)},
              styleId: 'tech-blue',
              mode: 'ai',
              outPath: ${JSON.stringify(smokeOut)}
            });
            const fileOk = res.ok && res.slideCount === 3;
            return { steps, styles, api, previewCount, notesShown, fileOk, slideCount: res.slideCount, errs };
          })()`);
          const outExists = fs.existsSync(smokeOut);
          const ok = result.steps === 4 && result.styles === 6 && result.api === 'object' &&
            result.previewCount === 7 && result.notesShown === 7 && result.fileOk === true &&
            result.slideCount === 3 && outExists && result.errs.length === 0;
          const smokeReport = path.join(os.tmpdir(), 'aippt-smoke-result.json');
          try { fs.writeFileSync(smokeReport, JSON.stringify({ ...result, outExists, ok })); } catch (e) { /* ignore */ }
          console.log('AIPPT_SMOKE_RESULT ' + JSON.stringify({ ...result, outExists, ok }));
          mockServer.close();
          fs.unlinkSync(smokeOut);
          app.exit(ok ? 0 : 1);
        } catch (e) {
          console.error('AIPPT_SMOKE_ERROR ' + e.message);
          mockServer.close();
          app.exit(1);
        }
      });
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // F12 开发者工具
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

function sendProgress(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gen:progress', msg);
  }
}

// ---------- IPC ----------

ipcMain.handle('app:info', () => ({
  name: 'AIPPT',
  version: app.getVersion(),
  platform: process.platform
}));

ipcMain.handle('dialog:open-md', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Markdown 文件',
    filters: [
      { name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt', 'mdown'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return null;
  const filePath = r.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_MD_BYTES) {
    throw new Error('文件超过 2MB 上限，请精简后重试');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return { path: filePath, name: path.basename(filePath), content };
});

ipcMain.handle('dialog:save-pptx', async (_e, defaultName) => {
  const safe = String(defaultName || '演示文稿')
    .replace(/[\\/:*?"<>|\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '演示文稿';
  const r = await dialog.showSaveDialog(mainWindow, {
    title: '保存 PPTX',
    defaultPath: `${safe}.pptx`,
    filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }]
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath.endsWith('.pptx') ? r.filePath : `${r.filePath}.pptx`;
});

ipcMain.handle('generate', async (_e, payload) => {
  if (busy) throw new Error('已有生成任务正在进行，请稍候');
  busy = true;
  try {
    return await runGenerate(payload, sendProgress);
  } finally {
    busy = false;
  }
});

ipcMain.handle('ai:test', async (_e, cfg) => {
  return testConnection(cfg);
});

ipcMain.handle('shell:open-folder', async (_e, dir) => {
  if (!dir) return false;
  const target = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : path.dirname(dir);
  const err = await shell.openPath(target);
  return !err;
});

// ---------- 启动 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
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
}
