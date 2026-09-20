/**
 * test/ui-shot.js （用 Electron 运行）
 * 启动界面 → 载入默认示例 → 截图，用来目视检查左右分栏与"大纲预览框"是否正常。
 * 产物：test/out/ui-preview.png
 * 运行：node_modules\electron\dist\electron.exe test\ui-shot.js
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const styleStore = require('../main/style-store.js');
const { STYLES } = require('../shared/styles.js');

const OUT = path.join(__dirname, 'out', 'ui-preview.png');

app.on('window-all-closed', () => {});

// 只注册界面启动时需要的几个 IPC（不启动完整的 main.js，避免影响用户已打开的窗口）
ipcMain.handle('app:info', () => ({ name: 'AIPPT', version: app.getVersion(), platform: process.platform }));
ipcMain.handle('styles:list', () => {
  const r = styleStore.loadStyles({ dirs: [path.join(__dirname, '..', 'styles')], builtin: STYLES });
  return { styles: r.styles.map((s) => ({ ...s })), warnings: r.warnings };
});
ipcMain.handle('sample:md', () => {
  const p = path.join(__dirname, '..', 'examples', 'beamer-demo.md');
  return fs.existsSync(p) ? { name: 'beamer-demo.md', content: fs.readFileSync(p, 'utf8'), path: p } : null;
});

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#F4F6FB',
    webPreferences: {
      preload: path.join(__dirname, '..', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 1200));
  // 载入默认示例（beamer-demo.md）
  await win.webContents.executeJavaScript("document.getElementById('btnSample').click(); true").catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const probe = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.preview-card');
    const body = document.querySelector('.preview-body');
    const left = document.querySelector('.panel-left');
    const right = document.querySelector('.panel-right');
    const cr = card.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return {
      viewport: [window.innerWidth, window.innerHeight],
      card: [Math.round(cr.top), Math.round(cr.bottom), Math.round(cr.height)],
      body: [Math.round(br.top), Math.round(br.bottom), Math.round(br.height)],
      bodyScroll: [body.scrollHeight, body.clientHeight],
      leftScroll: [left.scrollHeight, left.clientHeight],
      rightScroll: [right.scrollHeight, right.clientHeight],
      slideItems: document.querySelectorAll('.slide-item').length,
      outlineInsideCard: br.bottom <= cr.bottom + 1
    };
  })()`);
  console.log('UI 探针：' + JSON.stringify(probe));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('已保存截图：' + OUT + '（' + Math.round(fs.statSync(OUT).size / 1024) + ' KB）');
  win.destroy();
  app.exit(0);
});
