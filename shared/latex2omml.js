/**
 * shared/latex2omml.js
 * LaTeX 公式 → OMML（PowerPoint 原生公式对象）——**不需要安装任何 TeX**。
 *
 * 链路：LaTeX ──KaTeX(本项目已内置，只取它的 MathML 输出)──▶ MathML ──mml2omml──▶ OMML
 *
 * 体积账：KaTeX 已经在包里（渲染图片路径本来就要用），新增的只有 shared/mml2omml.js（约 20KB）。
 * 对比常见做法：pandoc 约 150MB、TeX Live 数 GB；本方案 0 字节额外运行时。
 *
 * 用法：
 *   const { latexToOmml } = require('../shared/latex2omml.js');
 *   const r = latexToOmml('\\frac{a}{b}', { display: true, szPt: 20 });
 *   if (r.ok) slideTextPlaceholder = r.xml;   // 交给 main/pptx-post.js 注入
 */
'use strict';

const { mmlToOmml } = require('./mml2omml.js');
const { compatTex } = require('./latex-compat.js');

let katex = null;
let katexError = null;
let mhchemLoaded = false;

function loadKatex() {
  if (katex || katexError) return katex;
  try {
    katex = require('katex');
  } catch (e) {
    katexError = e;
    return null;
  }
  // 化学式 \ce{} 需要 mhchem 扩展；拿不到就跳过（那类公式会退回图片路径）
  if (!mhchemLoaded) {
    for (const p of ['katex/contrib/mhchem', 'katex/dist/contrib/mhchem.js']) {
      try { require(p); mhchemLoaded = true; break; } catch (e) { /* 可选 */ }
    }
  }
  return katex;
}

/** 去掉 KaTeX MathML 输出里对转换无用的外壳（<span>、<annotation>、<semantics>） */
function unwrapMathML(html) {
  return String(html)
    .replace(/^<span[^>]*>/, '')
    .replace(/<\/span>\s*$/, '')
    .replace(/<annotation[\s\S]*?<\/annotation>/g, '')
    .replace(/<semantics>/, '')
    .replace(/<\/semantics>/, '');
}

/**
 * @param {string} tex 公式源码（会被 latex-compat 预处理成 KaTeX 可渲染的等价写法）
 * @param {object} opts
 *   display  是否块级（块级 → m:oMathPara 居中；行内 → m:oMath）
 *   szPt     字号（磅），默认 18
 *   typeface 数学字体，默认 Cambria Math
 *   color    颜色（不带 #）
 *   compat   是否套用 latex-compat（默认 true）
 * @returns {{ok:boolean, xml:string, body:string, error?:string}}
 */
function latexToOmml(tex, opts = {}) {
  const k = loadKatex();
  if (!k) return { ok: false, xml: '', body: '', error: 'katex 不可用：' + (katexError && katexError.message) };
  const src = opts.compat === false ? String(tex || '') : compatTex(tex);
  let mml;
  try {
    mml = unwrapMathML(k.renderToString(src, {
      output: 'mathml',
      displayMode: !!opts.display,
      throwOnError: true,
      strict: 'ignore',
      trust: false
    }));
  } catch (e) {
    return { ok: false, xml: '', body: '', error: 'MathML 生成失败：' + String((e && e.message) || e) };
  }
  try {
    const r = mmlToOmml(mml, {
      display: !!opts.display,
      szPt: opts.szPt || 18,
      typeface: opts.typeface,
      color: opts.color,
      compact: opts.compact !== false
    });
    if (!r.body) return { ok: false, xml: '', body: '', error: 'OMML 为空' };
    return { ok: true, xml: r.xml, body: r.body };
  } catch (e) {
    return { ok: false, xml: '', body: '', error: 'OMML 生成失败：' + String((e && e.message) || e) };
  }
}

/** 批量转换，返回 { map, failed } —— 便于生成期统计"可编辑 N 条 / 退回图片 M 条" */
function latexListToOmml(items) {
  const map = {};
  const failed = [];
  for (const it of items || []) {
    const r = latexToOmml(it.tex, it.opts || {});
    if (r.ok) map[it.id] = r.xml;
    else failed.push({ id: it.id, tex: it.tex, error: r.error });
  }
  return { map, failed };
}

module.exports = { latexToOmml, latexListToOmml, loadKatex, unwrapMathML };
