/**
 * renderer/rich/rich.js
 * 离屏渲染页的页面侧 API：接收 HTML 片段 → 渲染 KaTeX 公式 → 度量尺寸
 * 由主进程通过 executeJavaScript 调用
 */
(function () {
  'use strict';

  const stage = document.getElementById('stage');
  let failures = [];

  function renderMath(root) {
    const els = root.querySelectorAll('[data-tex]');
    for (const el of els) {
      const tex = el.getAttribute('data-tex') || '';
      const display = el.getAttribute('data-display') === '1';
      try {
        window.katex.render(tex, el, {
          displayMode: display,
          throwOnError: true,
          strict: 'ignore',
          trust: false,
          output: 'html',
          maxSize: 40,
          macros: {}
        });
      } catch (e) {
        failures.push({ tex: tex.slice(0, 160), message: String((e && e.message) || e).slice(0, 200) });
        el.className = 'math-failed';
        el.removeAttribute('data-tex');
        el.textContent = '$ ' + tex + ' $';
      }
    }
  }

  window.RICH = {
    version: 1,

    /**
     * 设置页面内容与样式，返回内容尺寸
     * opts: { width, fontSize, lineHeight, color, background, padding, fontFamily, cssVars }
     */
    setStage(html, opts) {
      opts = opts || {};
      failures = [];
      const s = stage.style;
      s.width = opts.width ? opts.width + 'px' : 'auto';
      s.maxWidth = opts.maxWidth ? opts.maxWidth + 'px' : 'none';
      s.fontSize = (opts.fontSize || 24) + 'px';
      s.lineHeight = String(opts.lineHeight || 1.45);
      s.padding = (opts.padding != null ? opts.padding : 0) + 'px';
      s.color = opts.color || '#101828';
      s.background = opts.background || '#ffffff';
      s.fontFamily = opts.fontFamily || '"Microsoft YaHei","Segoe UI",sans-serif';
      if (opts.cssVars) {
        for (const k of Object.keys(opts.cssVars)) {
          s.setProperty(k, opts.cssVars[k]);
        }
      }
      stage.innerHTML = html;
      renderMath(stage);
      return this.bounds();
    },

    bounds() {
      const r = stage.getBoundingClientRect();
      return {
        width: Math.ceil(r.width),
        height: Math.ceil(r.height),
        failures: failures.slice()
      };
    },

    /** 统计渲染后的文本长度（用于自检） */
    textStats() {
      const txt = stage.innerText || '';
      return {
        textLength: txt.length,
        katexNodes: stage.querySelectorAll('.katex').length,
        katexFailed: stage.querySelectorAll('.math-failed').length,
        tables: stage.querySelectorAll('table').length,
        images: stage.querySelectorAll('img').length
      };
    },

    /** 等待字体与图片加载完成 */
    ready() {
      return Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map((img) => new Promise((r) => { img.onload = img.onerror = () => r(true); }))
        )
      ]).then(() => true);
    }
  };
})();
