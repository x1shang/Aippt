/**
 * main/rich-renderer.js
 * 富内容渲染器：用 Electron 离屏窗口把 HTML 片段渲染成高清 PNG
 *  - KaTeX 负责数学公式（与 LaTeX 视觉一致）
 *  - 表格 / 提示框 / 代码块 / 行内公式混排 统统由浏览器排版
 *  - 超采样（默认 2x）保证 PPT 中缩放后依旧锐利
 */
'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');

const PX_PER_INCH = 96;
const DEFAULT_SUPERSAMPLE = 2;
const MAX_PIXELS = 6000; // 单边像素上限

class RichRenderer {
  constructor(opts = {}) {
    this.scale = opts.scale || Number(process.env.AIPPT_SUPERSAMPLE || DEFAULT_SUPERSAMPLE);
    this.win = null;
    this._starting = null;
    this.failures = [];
    this.renderCount = 0;
  }

  async start() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    if (this._starting) return this._starting;
    this._starting = (async () => {
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        backgroundColor: '#ffffff',
        webPreferences: {
          offscreen: true,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      win.webContents.setFrameRate(30);
      await win.loadFile(path.join(__dirname, '..', 'renderer', 'rich', 'rich.html'));
      // 等 KaTeX 就绪
      const ok = await win.webContents.executeJavaScript(
        'new Promise((r) => { const t0 = Date.now(); const t = setInterval(() => { if (window.RICH && window.katex && window.katex.render) { clearInterval(t); r(true); } else if (Date.now() - t0 > 8000) { clearInterval(t); r(false); } }, 20); })'
      );
      if (!ok) throw new Error('富内容渲染器初始化失败（KaTeX 未加载）');
      this.win = win;
      return win;
    })();
    return this._starting;
  }

  /** 等待两帧，确保布局与绘制完成 */
  async _settle() {
    await this.win.webContents.executeJavaScript(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'
    );
  }

  _stageOpts(opts) {
    const fontPx = Math.max(8, Math.round((opts.fontPt || 16) * (PX_PER_INCH / 72) * this.scale));
    const widthPx = Math.round((opts.widthIn || 11) * PX_PER_INCH * this.scale);
    const padPx = Math.round((opts.paddingIn || 0) * PX_PER_INCH * this.scale);
    return {
      width: widthPx,
      fontSize: fontPx,
      lineHeight: opts.lineHeight || 1.45,
      padding: padPx,
      color: opts.color || '#101828',
      background: opts.background || '#FFFFFF',
      fontFamily: opts.fontFamily,
      cssVars: opts.cssVars
    };
  }

  /**
   * 渲染片段
   * @returns {Promise<{png:Buffer, widthIn:number, heightIn:number, widthPx:number, heightPx:number, failures:Array, stats:Object}>}
   */
  async renderFragment(html, opts = {}) {
    await this.start();
    const win = this.win;
    const stageOpts = this._stageOpts(opts);

    const measuredFirst = await win.webContents.executeJavaScript(
      `window.RICH.setStage(${JSON.stringify(html)}, ${JSON.stringify(stageOpts)})`
    );
    // 等字体/图片加载完再重新度量（关键：<img> 加载前尺寸为 0）
    await win.webContents.executeJavaScript('window.RICH.ready()').catch(() => {});
    await this._settle();
    const measured = await win.webContents.executeJavaScript('window.RICH.bounds()').catch(() => measuredFirst);

    const w = Math.min(Math.max(Math.ceil(measured.width), 4), MAX_PIXELS);
    const h = Math.min(Math.max(Math.ceil(measured.height), 4), MAX_PIXELS);

    const [cw, ch] = win.getContentSize();
    if (cw < w || ch < h) {
      win.setContentSize(Math.max(cw, w), Math.max(ch, h));
      await this._settle();
    }

    const image = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
    const png = image.toPNG();
    const stats = await win.webContents.executeJavaScript('window.RICH.textStats()').catch(() => ({}));
    this.renderCount += 1;
    if (measured.failures && measured.failures.length) {
      this.failures.push(...measured.failures);
    }

    return {
      png,
      widthPx: w,
      heightPx: h,
      widthIn: w / (PX_PER_INCH * this.scale),
      heightIn: h / (PX_PER_INCH * this.scale),
      failures: measured.failures || [],
      stats: stats || {}
    };
  }

  /** 只测量不截图（用于排版试算） */
  async measure(html, opts = {}) {
    await this.start();
    const stageOpts = this._stageOpts(opts);
    const first = await this.win.webContents.executeJavaScript(
      `window.RICH.setStage(${JSON.stringify(html)}, ${JSON.stringify(stageOpts)})`
    );
    await this.win.webContents.executeJavaScript('window.RICH.ready()').catch(() => {});
    await this._settle();
    const measured = await this.win.webContents.executeJavaScript('window.RICH.bounds()').catch(() => first);
    const scale = PX_PER_INCH * this.scale;
    return {
      widthIn: Math.max(measured.width, 4) / scale,
      heightIn: Math.max(measured.height, 4) / scale,
      failures: measured.failures || []
    };
  }

  dispose() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this._starting = null;
  }
}

module.exports = { RichRenderer, DEFAULT_SUPERSAMPLE };
