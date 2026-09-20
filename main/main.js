/**
 * main/main.js
 * Electron 主进程：窗口管理 + IPC
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// 启动自检：便携版 exe 会把自己解压到 %TEMP% 再运行。若解压不完整（被杀软拦下、
// 上一次运行时被删了一半、磁盘写满…），require 会抛出一句没有上下文的
// "Cannot find module 'jszip'"，用户完全不知道怎么办。这里把它变成可操作的提示。
// ---------------------------------------------------------------------------
const RUNTIME_DEPS = ['pptxgenjs', 'jszip', 'katex', 'highlight.js'];
function findMissingDeps() {
  const missing = [];
  for (const m of RUNTIME_DEPS) {
    try { require.resolve(m); } catch (e) { missing.push(m); }
  }
  return missing;
}

let runGenerate = null;
let testConnection = null;
let RichRenderer = null;
let styleStore = null;
let STYLES = [];
let startupError = null;
try {
  ({ runGenerate } = require('./generate-flow.js'));
  ({ testConnection } = require('./ai.js'));
  ({ RichRenderer } = require('./rich-renderer.js'));
  styleStore = require('./style-store.js');
  ({ STYLES } = require('../shared/styles.js'));
} catch (e) {
  startupError = e;
}

/** 组装一条能照着做的错误说明 */
function startupErrorText(err) {
  const missing = findMissingDeps();
  const exeDir = path.dirname(process.execPath);
  const lines = ['AIPPT 启动失败：程序文件不完整。', ''];
  if (missing.length) {
    lines.push(`缺少运行依赖：${missing.join('、')}`);
    lines.push('（便携版 exe 需要先把程序解压到临时目录，这次解压不完整）');
  } else {
    lines.push(`错误：${String((err && err.message) || err)}`);
  }
  lines.push('');
  lines.push('解决办法（任选其一，推荐第 1 条）：');
  lines.push('1) 关闭本程序，删除下面这个临时解压目录，再重新双击 exe：');
  lines.push(`   ${exeDir}`);
  lines.push('2) 或先把 exe 换一个目录（例如 D:\\AIPPT\\）再运行；');
  lines.push('3) 若反复出现，多半是杀毒软件拦截了解压，请把该 exe 加入白名单后重试。');
  return lines.join('\n');
}

const MAX_MD_BYTES = 2 * 1024 * 1024; // 2MB

let mainWindow = null;
let busy = false;
let richRenderer = null;

/** 富内容渲染器（离屏窗口）按需创建 */
async function getRenderer() {
  if (!richRenderer) richRenderer = new RichRenderer();
  await richRenderer.start();
  return richRenderer;
}

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
            // 左右两栏必须各自独立滚动，且**大纲预览框不能被撑破**：
            // 预览卡片有高度上限，正文区在框内滚动（框内滚动 + 外层面板滚动并存，互不干扰）
            const left = document.querySelector('.panel-left');
            const right = document.querySelector('.panel-right');
            const card = document.querySelector('.preview-card');
            const body = document.querySelector('.preview-body');
            const lcs = getComputedStyle(left);
            const rcs = getComputedStyle(right);
            const bcs = getComputedStyle(body);
            const cardRect = card.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            const rightBefore = right.scrollTop;
            const bodyBefore = body.scrollTop;
            left.scrollTop = 9999;                       // 滚左栏
            const leftScrolled = left.scrollTop;
            const rightStill = right.scrollTop === rightBefore;
            const bodyStill = body.scrollTop === bodyBefore;
            left.scrollTop = 0;
            body.scrollTop = 9999;                       // 滚预览框内部
            const bodyScrolled = body.scrollTop;
            const leftStill = left.scrollTop === 0;
            body.scrollTop = 0;
            const layout = {
              pageNotScrollable: document.documentElement.scrollHeight <= window.innerHeight + 1,
              leftOverflow: lcs.overflowY,
              rightOverflow: rcs.overflowY,
              bodyOverflow: bcs.overflowY,
              leftContain: lcs.overscrollBehaviorY,
              rightContain: rcs.overscrollBehaviorY,
              leftScrolled,
              bodyScrolled,
              independent: leftScrolled > 0 && rightStill && bodyStill && bodyScrolled > 0 && leftStill,
              outlineInsideCard: bodyRect.bottom <= cardRect.bottom + 1,
              cardInsideViewport: cardRect.bottom <= window.innerHeight + 1,
              cardBounded: cardRect.height <= right.clientHeight + 1,
              bodyScrollable: body.scrollHeight > body.clientHeight
            };
            const res = await window.aippt.generate({
              apiConfig: { baseUrl: ${JSON.stringify(mockUrl)}, apiKey: 'smoke', model: 'mock-model' },
              mdContent: ${JSON.stringify(smokeMd)},
              styleId: 'tech-blue',
              mode: 'ai',
              outPath: ${JSON.stringify(smokeOut)}
            });
            const fileOk = res.ok && res.slideCount === 3;
            return { steps, styles, api, previewCount, notesShown, fileOk, slideCount: res.slideCount, errs, layout };
          })()`);
          const outExists = fs.existsSync(smokeOut);
          // 打包完整性：asar 里必须真的能解析到运行依赖（曾经 jszip 被单独解包到
          // app.asar.unpacked，解压不完整就 "Cannot find module 'jszip'"）
          const asarHasDeps = ['pptxgenjs', 'jszip', 'katex', 'highlight.js'].every((m) => {
            try { require.resolve(m); return true; } catch (e) { return false; }
          });
          const unpackedDir = path.join(process.resourcesPath || '', 'app.asar.unpacked');
          const hasUnpacked = fs.existsSync(unpackedDir);

          // ---- v2/v2.1 渲染链路（公式 / 表格 / 定理 / 渐进显示 / 代码高亮）----
          const mathMd = [
            '# 冒烟测试',
            '',
            '## 公式渲染',
            '',
            '行内公式 $E=mc^2$ 与 $\\alpha\\implies A$。',
            '',
            '$$',
            '\\int_{0}^{1} x^{2}\\,dx = \\frac{1}{3} \\label{eq:smoke}',
            '$$',
            '',
            '见 \\eqref{eq:smoke}。',
            '',
            '## 表格',
            '',
            '| 名称 | 公式 |',
            '| --- | --- |',
            '| 勾股 | $a^2+b^2=c^2$ |',
            '',
            '## 定理块',
            '',
            '\\begin{theorem}[冒烟] \\label{thm:smoke}',
            '设 $a>0$，则 $\\sqrt{a}>0$。',
            '\\end{theorem}',
            '',
            '## 渐进显示',
            '',
            '- 第一步',
            '- 第二步 <2->',
            ''
          ].join('\n');
          const mathOut = path.join(os.tmpdir(), `aippt-smoke-math-${Date.now()}.pptx`);
          const ommlOut = path.join(os.tmpdir(), `aippt-smoke-omml-${Date.now()}.pptx`);
          let mathMedia = 0;
          let mathSlides = 0;
          let ommlMath = 0;
          let ommlFallbacks = 0;
          let animSlides = 0;
          let ommlOk = false;
          let hljsOk = false;
          try {
            const hljs = require('highlight.js/lib/common');
            hljs.registerLanguage('latex', require('highlight.js/lib/languages/latex'));
            hljsOk = hljs.highlight('def f(x): return x', { language: 'python', ignoreIllegals: true })
              .value.includes('hljs-');
          } catch (e) {
            hljsOk = false;
          }
          try {
            const out = await runGenerate(
              { mdContent: mathMd, styleId: 'tech-blue', mode: 'direct', outPath: mathOut },
              () => {},
              { renderer: await getRenderer() }
            );
            mathSlides = out.slideCount;
            const JSZip = require('jszip');
            const zip = await JSZip.loadAsync(fs.readFileSync(mathOut));
            mathMedia = Object.keys(zip.files).filter((n) => /^ppt\/media\/[^/]+\.(png|jpe?g)$/i.test(n)).length;
            fs.unlinkSync(mathOut);
          } catch (e) {
            console.error('AIPPT_SMOKE_MATH_ERROR ' + e.message);
          }
          // v2.2 自检：打包产物里 OMML 转换 / 图片兜底 / 点击动画 / jszip 是否都真的能用
          try {
            const ommlMd = '# 打包自检\n\n## 公式页\n\n行内 $E=mc^2$ 与块级公式：\n\n$$\n\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}\n$$\n\n## 分步页\n\n- 甲\n- 乙 <2->\n- 丙 <3->\n';
            const out2 = await runGenerate(
              { mdContent: ommlMd, styleId: 'tech-blue', mode: 'direct', outPath: ommlOut, autoToc: false },
              () => {},
              { renderer: await getRenderer() }
            );
            const om = out2.omml || {};
            animSlides = (out2.animation && out2.animation.slides) || 0;
            ommlMath = (om.display || 0) + (om.inline || 0);
            ommlFallbacks = om.fallbackImages || 0;
            const JSZip2 = require('jszip');
            const zip2 = await JSZip2.loadAsync(fs.readFileSync(ommlOut));
            let a14 = 0; let alt = 0; let timing = 0; let leftover = 0; let wordNs = 0;
            for (const n of Object.keys(zip2.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) {
              const x = await zip2.file(n).async('string');
              a14 += (x.match(/<a14:m[\s>]/g) || []).length;
              alt += (x.match(/<mc:AlternateContent/g) || []).length;
              timing += (x.match(/<p:timing>/g) || []).length;
              if (/⟦MATH:|⟦ANIM:|⟪[TP]:?/.test(x)) leftover++;
              if (/<w:/.test(x)) wordNs++;
            }
            ommlOk = a14 >= 2 && alt >= 1 && timing >= 1 && leftover === 0 && wordNs === 0;
            if (!ommlOk) {
              console.error(`AIPPT_SMOKE_OMML_DETAIL a14=${a14} alt=${alt} timing=${timing} leftover=${leftover} w=${wordNs}`);
            }
            fs.unlinkSync(ommlOut);
          } catch (e) {
            console.error('AIPPT_SMOKE_OMML_ERROR ' + e.message);
          }

          const ok = result.steps === 4 && result.styles >= 6 && result.api === 'object' &&   // 内置 6 套 + 任意样式插件
            result.previewCount === 12 && result.notesShown >= 1 && result.fileOk === true &&
            result.slideCount === 3 && outExists && result.errs.length === 0 &&
            // 左右两栏独立滚动（页面本身不滚）
            result.layout && result.layout.independent === true &&
            result.layout.outlineInsideCard === true && result.layout.cardInsideViewport === true &&
            result.layout.bodyScrollable === true && result.layout.bodyOverflow === 'auto' &&
            // 冒烟文档：封面 + 公式 + 表格 + 定理 = 4 页，渐进显示 2 步 = 共 6 页；渲染图 ≥ 3 张
            mathMedia >= 3 && mathSlides >= 6 && hljsOk === true &&
            asarHasDeps === true && hasUnpacked === false &&
            // v2.2：原生公式 + 图片兜底 + 点击动画（在打包产物里也要成立）
            ommlOk && ommlMath >= 2;
          const payload = { ...result, outExists, mathMedia, mathSlides, hljsOk, ommlOk, ommlMath, ommlFallbacks, animSlides, asarHasDeps, hasUnpacked, ok };
          const smokeReport = path.join(os.tmpdir(), 'aippt-smoke-result.json');
          try { fs.writeFileSync(smokeReport, JSON.stringify(payload)); } catch (e) { /* ignore */ }
          console.log('AIPPT_SMOKE_RESULT ' + JSON.stringify(payload));
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

/**
 * 内置示例：默认 examples/beamer-demo.md（学术风、覆盖全部能力）。
 * 一并返回文件路径，这样示例里的相对资源（references.bib / 图片）能按它所在目录解析。
 * 传 'showcase' 可切到「全功能总览」示例 examples/showcase.md。
 */
ipcMain.handle('sample:md', (_e, kind) => {
  const want = kind === 'showcase' ? 'showcase.md' : 'beamer-demo.md';
  const bases = [
    path.join(__dirname, '..', 'examples'),
    path.join(process.resourcesPath || '', 'app', 'examples')
  ];
  for (const base of bases) {
    const p = path.join(base, want);
    try {
      if (fs.existsSync(p)) return { name: want, content: fs.readFileSync(p, 'utf8'), path: p };
    } catch (e) { /* 继续尝试 */ }
  }
  return { name: '示例.md', content: FALLBACK_SAMPLE_MD, path: '' };
});

const FALLBACK_SAMPLE_MD = [
  '# AIPPT 功能总览',
  '',
  '一份 Markdown，导出可编辑、可点击、带目录与文献的 PPT',
  '',
  '\\tableofcontents',
  '',
  '## 公式',
  '',
  '行内公式 $E = mc^2$ 与文字同段混排。',
  '',
  '$$',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
  '$$',
  '',
  '## 谢谢观看',
  '',
  '欢迎交流！'
].join('\n');

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

/** 样式插件：随包 styles/ + 用户目录 styles/ */
function styleDirs() {
  const dirs = [path.join(__dirname, '..', 'styles')];
  try {
    dirs.push(path.join(app.getPath('userData'), styleStore.SUB_DIR));
  } catch (e) { /* userData 不可用时只读随包样式 */ }
  return dirs;
}

function loadAllStyles() {
  return styleStore.loadStyles({ dirs: styleDirs(), builtin: STYLES });
}

ipcMain.handle('styles:list', () => {
  const r = loadAllStyles();
  return {
    styles: r.styles.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.desc,
      font: s.font,
      primary: s.primary,
      accent: s.accent,
      bg: s.bg,
      coverBg: s.coverBg,
      custom: !!s.custom,
      layout: s.layout || null
    })),
    warnings: r.warnings
  };
});

ipcMain.handle('styles:import', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '导入样式插件（*.aippt-style.json）',
    filters: [{ name: 'AIPPT 样式', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const src = r.filePaths[0];
  const picked = styleStore.readStyleFile(src);
  if (!picked.ok) return { ok: false, errors: picked.errors, warnings: picked.warnings };
  if (STYLES.some((s) => s.id === picked.style.id)) {
    return { ok: false, errors: [`样式 id「${picked.style.id}」与内置样式重名，请换一个 id 再导入`] };
  }
  const res = styleStore.importStyle(src, path.join(app.getPath('userData'), styleStore.SUB_DIR));
  return res.ok ? { ok: true, style: res.style } : { ok: false, errors: res.errors };
});

ipcMain.handle('styles:remove', (_e, id) => {
  return styleStore.removeStyle(id, path.join(app.getPath('userData'), styleStore.SUB_DIR));
});

ipcMain.handle('styles:export', async (_e, id) => {
  const r = loadAllStyles();
  const st = r.styles.find((s) => s.id === id);
  if (!st) return { ok: false, errors: ['找不到该样式'] };
  const dlg = await dialog.showSaveDialog(mainWindow, {
    title: '导出样式插件（可改完再导入）',
    defaultPath: `${st.id}.aippt-style.json`,
    filters: [{ name: 'AIPPT 样式', extensions: ['json'] }]
  });
  if (dlg.canceled || !dlg.filePath) return { canceled: true };
  try {
    fs.writeFileSync(dlg.filePath, styleStore.exportStyle(st), 'utf8');
    return { ok: true, path: dlg.filePath };
  } catch (e) {
    return { ok: false, errors: [String(e.message || e)] };
  }
});

ipcMain.handle('dialog:open-bib', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择 BibTeX 文献库',
    filters: [
      { name: 'BibTeX', extensions: ['bib'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const filePath = r.filePaths[0];
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const bib = require('../shared/bib.js');
    const parsed = bib.parseBib(text);
    return { canceled: false, path: filePath, text, count: Object.keys(parsed.entries || {}).length };
  } catch (e) {
    return { canceled: false, path: filePath, text: '', count: 0, error: String(e.message || e) };
  }
});

ipcMain.handle('generate', async (_e, payload) => {
  if (busy) throw new Error('已有生成任务正在进行，请稍候');
  busy = true;
  try {
    sendProgress('正在准备公式渲染引擎…');
    const renderer = await getRenderer();
    const searchDirs = [process.cwd(), path.dirname(process.execPath)];
    const styleInfo = loadAllStyles();
    return await runGenerate(payload, sendProgress, { renderer, searchDirs, styles: styleInfo.styles });
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
    if (startupError) {
      // 文件不完整：给出可照做的说明后退出，不再弹裸的 Uncaught Exception
      const text = startupErrorText(startupError);
      console.error('AIPPT_STARTUP_ERROR ' + text.replace(/\n/g, ' | '));
      try { dialog.showErrorBox('AIPPT 无法启动（程序文件不完整）', text); } catch (e) { /* 无 GUI 时忽略 */ }
      app.exit(1);
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (richRenderer) {
      richRenderer.dispose();
      richRenderer = null;
    }
  });
}






