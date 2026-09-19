/**
 * test/proto-render.js  （用 Electron 运行）
 * 验证：离屏窗口 + KaTeX 渲染 → PNG 截图 这条链路是否可用
 * 用 LaTeX.md 里真实出现的公式做样本
 * 运行：node_modules\electron\dist\electron.exe test\proto-render.js
 */
'use strict';

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const { RichRenderer } = require('../main/rich-renderer.js');
const richHtml = require('../shared/rich-html.js');

const OUT = path.join(__dirname, 'out', 'proto');
fs.mkdirSync(OUT, { recursive: true });

/** 统计 PNG 的“墨迹”比例，判断是否白图 */
function inkStats(pngBuffer) {
  const img = nativeImage.createFromBuffer(pngBuffer);
  const size = img.getSize();
  const bmp = img.getBitmap(); // BGRA
  let ink = 0;
  let total = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 200) ink++;
    total++;
  }
  return { width: size.width, height: size.height, inkRatio: total ? ink / total : 0 };
}

const CASES = [
  {
    name: 'inline-mixed',
    desc: '行内公式与中文混排',
    block: { type: 'bullets', items: [
      { text: '行内公式：用一对 `$` 包裹，例如 $E=mc^2$，以及 $\\alpha\\implies A$。', level: 0 },
      { text: '希腊字母行：$\\omega\\Omega \\underline{x ^{-1}}e^{ x }$ 与 $\\Pi\\vec{x}\\rho$', level: 0 },
      { text: '取整与绝对值：$\\lceil x \\rceil$、$\\lvert x \\rvert$、$\\langle x \\rangle$', level: 0 }
    ] }
  },
  {
    name: 'display-cases',
    desc: 'cases 环境（多行分段函数）',
    block: { type: 'math', tex: 'f_{n}=\n\\begin{cases}\na&\\text{if $n=0$} \\\\\nr\\cdot f_{n-1}&\\text{else}\n\\end{cases}' }
  },
  {
    name: 'display-multline',
    desc: 'multline* → gathered 兼容转换',
    block: { type: 'math', tex: '\\begin{multline*}\n\\sin(x)=x-\\frac{x^{3}}{3!}\\\\\n+\\frac{x^{5}}{5!}-\\dots\n\\end{multline*}' }
  },
  {
    name: 'display-aligned',
    desc: 'aligned 对齐',
    block: { type: 'math', tex: '\\begin{aligned}\ny &= 2x + 1 \\\\\n  &= 3 + 2x\n\\end{aligned}' }
  },
  {
    name: 'display-matrices',
    desc: '四种矩阵环境',
    block: { type: 'math', tex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}\n\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}\n\\begin{Vmatrix} a & b \\\\ c & d \\end{Vmatrix}' }
  },
  {
    name: 'display-brackets',
    desc: '\\left( \\right) 自适应括号',
    block: { type: 'math', tex: 'f(x) = \\left( \\frac{a}{b} \\right)' }
  },
  {
    name: 'display-cjk-in-math',
    desc: '公式里带中文（100个）',
    block: { type: 'math', tex: 'y_{\\dot{x}}\\cancel{ \\tilde{x}\\times \\vec{x} }\\bar{x}\\hat{x}\\mathbf{x}\\underbrace{ \\boldsymbol{\\pi}\\varepsilon }_{ 100个 }\\epsilon' }
  },
  {
    name: 'display-mhchem',
    desc: 'mhchem 化学式 \\ce',
    block: { type: 'math', tex: '\\ce{ 2H2 + O2 =2H2O }' }
  },
  {
    name: 'display-pu',
    desc: 'siunitx \\pu（KaTeX 不支持 → 兼容替换）',
    block: { type: 'math', tex: '\\pu{ 6.022e23 mol-1 }' }
  },
  {
    name: 'display-physics',
    desc: 'physics 宏包 bra/ket',
    block: { type: 'math', tex: '\\ket{\\psi} \\bra{\\psi} \\braket{ a | b }' }
  },
  {
    name: 'table-with-math',
    desc: '表格内嵌公式 + 高亮 + <br>',
    block: {
      type: 'table',
      headers: ['Trigger', 'Effect', 'Trigger', 'Effect'],
      aligns: ['left', 'left', 'left', 'left'],
      rows: [
        ['mk', '$ $', 'A@a', '$A\\alpha$'],
        ['dm', '\\$$    <br>\\$$', 'B@b', '$B\\beta$'],
        ['==RmAa==', '$\\mathrm{Aa}$', 'U选中', '$\\underbrace{ abc\\dots }_{ 100个 }$'],
        ['<mark>~=</mark>', '$\\approx$', 'sum1', '$\\sum_{1}$'],
        ['oint', '$\\oint \\iint \\iiint$', 'CCRRZZ', '$\\mathbb{C}\\mathbb{R}\\mathbb{Z}$']
      ]
    }
  },
  {
    name: 'callout',
    desc: 'Obsidian 提示框',
    block: { type: 'callout', kind: 'warning', title: '注意', items: [
      { text: '下面第 141 行的 `pu` 快捷键已改成 `\\qty{ }{ }`：`\\pu` 在 siunitx v3 已被**删除**', level: 0 },
      { text: '详细说明见 [[LaTeX数学语法补全]] 第八节。', level: 0 }
    ] }
  },
  {
    name: 'code-block',
    desc: 'LaTeX 代码块',
    block: { type: 'code', code: '\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.65\\textwidth]{figure.jpg}\n  \\caption{图题} \\label{fig:sample}\n\\end{figure}' }
  },
  {
    name: 'plain-cjk',
    desc: '纯中文段落（对照组）',
    block: { type: 'paragraph', text: '在 Obsidian 里，你可以直接使用 $\\LaTeX$ 的数学语法，因为 Obsidian 内置了 **MathJax** 渲染引擎。' }
  }
];

app.whenReady().then(async () => {
  const renderer = new RichRenderer();
  const results = [];
  let failed = 0;

  try {
    await renderer.start();
    console.log('renderer started');

    for (const c of CASES) {
      const html = richHtml.blocksToHtml([c.block]);
      const t0 = Date.now();
      const r = await renderer.renderFragment(html, {
        fontPt: 16,
        widthIn: 11,
        paddingIn: 0.08,
        background: '#FFFFFF',
        color: '#101828',
        cssVars: { '--primary': '#1E5EFF', '--accent': '#38BDF8', '--text': '#101828', '--sub': '#667085', '--bg': '#FFFFFF', '--bg-alt': '#EFF4FF' }
      });
      const stats = inkStats(r.png);
      fs.writeFileSync(path.join(OUT, `${c.name}.png`), r.png);
      const katexNodes = (r.stats && r.stats.katexNodes) || 0;
      const katexFailed = (r.stats && r.stats.katexFailed) || 0;
      const needMath = ['inline-mixed', 'display-cases', 'display-multline', 'display-aligned',
        'display-matrices', 'display-brackets', 'display-cjk-in-math', 'display-mhchem',
        'display-pu', 'display-physics', 'table-with-math', 'plain-cjk', 'callout'].includes(c.name);
      const ok = r.widthPx > 20 && r.heightPx > 20 && stats.inkRatio > 0.002 &&
        (r.failures || []).length === 0 && katexFailed === 0 && (!needMath || katexNodes > 0);
      if (!ok) failed++;
      results.push({
        name: c.name, ok,
        px: `${r.widthPx}x${r.heightPx}`,
        inches: `${r.widthIn.toFixed(2)}x${r.heightIn.toFixed(2)}`,
        ink: (stats.inkRatio * 100).toFixed(2) + '%',
        katex: `${katexNodes}/${katexFailed}`,
        ms: Date.now() - t0,
        failures: r.failures
      });
    }
  } catch (e) {
    console.error('PROTO ERROR:', e && e.stack);
    failed++;
  }

  console.log('\n=== 原型验证结果 ===');
  for (const r of results) {
    console.log(
      `${r.ok ? '✓' : '✗'} ${r.name.padEnd(22)} ${r.px.padEnd(12)} ${r.inches.padEnd(14)} ink=${r.ink.padEnd(7)} katex=${r.katex.padEnd(6)} ${r.ms}ms` +
      (r.ok ? '' : `  failures=${JSON.stringify(r.failures)}`)
    );
  }
  console.log(`\n通过 ${results.filter((r) => r.ok).length}/${CASES.length}，输出目录: ${OUT}`);

  renderer.dispose();
  app.exit(failed ? 1 : 0);
});
