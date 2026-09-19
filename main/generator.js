/**
 * main/generator.js  (v2.2)
 * PPTX 生成器：
 *   原生文本路径（纯文本幻灯片）→ PptxGenJS 文本框，可编辑
 *   原生公式路径（v2.2）：公式→OMML（PowerPoint 原生公式对象，双击可编辑）+ 可选图片兜底
 *   富内容路径（含表格/提示框/算法/长代码）→ 浏览器排版后以高清图片嵌入（LaTeX 级还原）
 *   图片块 → 原生嵌入图片（等比缩放，带图注）
 * 版式：16:9；布局：cover / toc / section / content / two-column / quote / refs / end
 */
'use strict';

const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');
const { STYLES } = require('../shared/styles.js');
const parser = require('../shared/parser.js');
const richHtml = require('../shared/rich-html.js');
const ov = require('../shared/overlay.js');
const { latexToOmml } = require('../shared/latex2omml.js');
const { postProcess, patchPageTotals, TOTAL_SENTINEL } = require('./pptx-post.js');

const W = 13.333;
const H = 7.5;

const LAYOUT = {
  marginX: 0.95,
  contentW: 11.43,
  titleTop: 0.62,
  contentTop: 1.78,
  contentBottom: 6.92,
  pageNoY: 7.08
};
const LAYOUT_BASE = Object.assign({}, LAYOUT);

/**
 * 样式插件可以覆盖少量版式参数（边距/圆角/导航条节数上限）。
 * 生成期间临时改写模块级 LAYOUT，生成结束（finally）恢复，避免影响到下一次生成。
 */
function applyStyleLayout(style) {
  const conf = (style && style.layout) || {};
  if (Number.isFinite(conf.marginX)) {
    LAYOUT.marginX = conf.marginX;
    LAYOUT.contentW = W - conf.marginX * 2;
  }
  return () => { Object.assign(LAYOUT, LAYOUT_BASE); };
}

const BODY_FONT_PT = 15;      // 富内容正文字号
const TITLE_FONT_PT = 26;
const MIN_SCALE = 0.62;       // 允许的最小压缩比
const FORMULA_FONT_PT = 20;   // 块级公式字号（原生 OMML）
const NAV_MAX_SECTIONS = 8;   // 页脚导航最多显示几节

/** 十六进制颜色 → OMML 用的 'RRGGBB' */
function hexOf(color) {
  return String(color || '').replace('#', '').toUpperCase();
}

/** 颜色与白色按比例混合，ratio=1 → 纯白 */
function tint(hex, ratio) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * ratio).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}

function todayZh() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ============================================================
// 一、原生文本路径（v1 保留，纯文本幻灯片使用）
// ============================================================

function drawBulletsNative(slide, style, bullets, area) {
  const font = style.font;
  const regular = [];
  const codeBlocks = [];
  for (const raw of bullets) {
    const b = typeof raw === 'string' ? { text: raw, level: 0, code: false } : raw;
    if (b.code) codeBlocks.push(b);
    else regular.push(b);
  }

  let y = area.y;
  const lineH = 0.5;
  for (const b of regular) {
    const lvl = Math.min(b.level || 0, 3);
    const hidden = b._invisible === true;
    const dim = b._dim === true;
    const textColor = hidden ? style.bg : (dim ? tint(style.text, 0.72) : (lvl === 0 ? style.text : style.textSub));
    const markColor = hidden ? style.bg : (dim ? tint(style.accent, 0.55) : (lvl === 0 ? style.accent : style.textSub));
    const runs = [
      {
        text: lvl === 0 ? '▪  ' : '–  ',
        options: { color: markColor, bold: lvl === 0, fontFace: font, fontSize: lvl === 0 ? 17 : 15 }
      },
      ...parser.inlineToRuns(b.text).map((r) => ({
        text: r.text,
        options: { ...r.options, color: textColor, fontFace: r.options.fontFace || font, fontSize: lvl === 0 ? 17 : 15 }
      }))
    ];
    slide.addText(runs, {
      x: area.x + lvl * 0.3,
      y,
      w: area.w - lvl * 0.3,
      h: lineH,
      valign: 'top',
      lineSpacingMultiple: 1.15,
      paraSpaceAfter: 8,
      margin: 0
    });
    y += lineH * (lvl === 0 ? 1 : 0.92);
    if (y > area.y + area.h - lineH) break;
  }

  for (const cb of codeBlocks) {
    if (cb._invisible) continue;
    slide.addText(cb.text, {
      x: area.x,
      y,
      w: area.w,
      h: Math.min(Math.max(0.9, cb.text.split('\n').length * 0.24), area.y + area.h - y),
      fontFace: 'Consolas',
      fontSize: 11,
      color: style.text,
      fill: { color: style.bgAlt },
      line: { type: 'none' },
      align: 'left',
      valign: 'top',
      margin: 8,
      fit: 'shrink'
    });
    y += 0.6;
  }
}

function drawTitleBar(slide, style, title, subtitle, titleImage, ctx) {
  if (title || titleImage) {
    slide.addShape('rect', { x: 0.92, y: 0.74, w: 0.14, h: 0.5, fill: { color: style.primary }, line: { type: 'none' } });
    if (titleImage) {
      const h = Math.min(titleImage.heightIn, 0.7);
      const w = titleImage.widthIn * (h / titleImage.heightIn);
      slide.addImage({
        data: titleImage.dataUrl,
        x: 1.2,
        y: 0.74 + (0.5 - h) / 2,
        w: Math.min(w, 11.1),
        h,
        sizing: { type: 'contain', w: Math.min(w, 11.1), h }
      });
    } else if (ctx && ctx.useOmml && title && /\$/.test(String(title))) {
      // 标题里带行内公式：同样用原生 OMML，标题也保持可编辑
      const runs = inlineRunsWithMath(title, ctx, { fontPt: TITLE_FONT_PT, color: style.text, fontFace: style.font });
      for (const r of runs) r.options = { ...r.options, bold: true };
      slide.addText(runs, {
        x: 1.2, y: 0.62, w: 11.1, h: 0.75,
        fontFace: style.font, fontSize: (ctx && ctx.titlePt) || TITLE_FONT_PT, bold: true, color: style.text,
        align: 'left', valign: 'middle', fit: 'shrink', margin: 0
      });
    } else {
      slide.addText(title, {
        x: 1.2, y: 0.62, w: 11.1, h: 0.75,
        fontFace: style.font, fontSize: (ctx && ctx.titlePt) || TITLE_FONT_PT, bold: true, color: style.text,
        align: 'left', valign: 'middle', fit: 'shrink', margin: 0
      });
    }
    slide.addShape('rect', { x: 0.95, y: 1.48, w: 11.4, h: 0.014, fill: { color: tint(style.primary, 0.86) }, line: { type: 'none' } });
  }
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.2, y: 1.52, w: 11.1, h: 0.4,
      fontFace: style.font, fontSize: 14, color: style.textSub, align: 'left', valign: 'middle', margin: 0
    });
  }
}

/** 页码：分母用哨兵占位（overlay 展开后总页数才知道），生成结束时统一替换 */
function drawPageNo(slide, style, index) {
  slide.addText(`${index} / ${TOTAL_SENTINEL}`, {
    x: 11.8, y: LAYOUT.pageNoY, w: 1.2, h: 0.32,
    fontFace: style.font, fontSize: 9, color: style.textSub, align: 'right', margin: 0
  });
}

/**
 * 页脚：章节导航（Beamer headline 的等价物）+ 页码
 * 节数少时列出全部节名并高亮当前节；节数多时改为「§k 名称 + 节进度」。
 */
function drawFooter(slide, style, ctx, index, opts) {
  const nav = ctx && ctx.sectionNav;
  const y = LAYOUT.pageNoY;
  const wantNav = !opts || opts.nav !== false;
  if (wantNav && ctx && ctx.showFooter && nav && nav.titles.length >= 2) {
    const cur = nav.current;
    const runs = [];
    if (nav.titles.length <= ((ctx && ctx.navMax) || NAV_MAX_SECTIONS)) {
      nav.titles.forEach((t, i) => {
        if (i) runs.push({ text: '  ·  ', options: { color: tint(style.textSub, 0.45), fontFace: style.font, fontSize: 8 } });
        runs.push({
          text: `${t.number ? t.number + ' ' : ''}${t.title}`,
          options: {
            color: i === cur ? style.primary : tint(style.textSub, 0.15),
            bold: i === cur,
            fontFace: style.font,
            fontSize: 8.5
          }
        });
      });
    } else {
      const t = nav.titles[cur] || nav.titles[0];
      runs.push({ text: `§${t.number || cur + 1} ${t.title}`, options: { color: style.primary, bold: true, fontFace: style.font, fontSize: 8.5 } });
      runs.push({ text: `   ${cur + 1}/${nav.titles.length}`, options: { color: tint(style.textSub, 0.15), fontFace: style.font, fontSize: 8 } });
    }
    slide.addText(runs, { x: LAYOUT.marginX, y, w: 9.9, h: 0.32, align: 'left', valign: 'middle', margin: 0 });
  }
  drawPageNo(slide, style, index);
  // 章节进度条（细线）
  if (wantNav && ctx && ctx.showFooter && nav && nav.titles.length >= 2) {
    const p = (nav.current + 1) / nav.titles.length;
    slide.addShape('rect', { x: LAYOUT.marginX, y: 7.4, w: 11.43, h: 0.028, fill: { color: tint(style.primary, 0.86) }, line: { type: 'none' } });
    slide.addShape('rect', { x: LAYOUT.marginX, y: 7.4, w: Math.max(0.05, 11.43 * p), h: 0.028, fill: { color: style.primary }, line: { type: 'none' } });
  }
}

function drawHero(slide, style, title, subtitle, meta) {
  slide.background = { color: style.coverBg };
  slide.addShape('ellipse', {
    x: 9.4, y: -2.9, w: 7.2, h: 7.2,
    fill: { color: style.deco1, transparency: 76 }, line: { type: 'none' }
  });
  slide.addShape('ellipse', {
    x: -1.4, y: 5.7, w: 3.6, h: 3.6,
    fill: { color: style.deco2, transparency: 82 }, line: { type: 'none' }
  });
  slide.addShape('ellipse', {
    x: 10.8, y: 4.6, w: 1.5, h: 1.5,
    fill: { color: style.deco2, transparency: 70 }, line: { type: 'none' }
  });
  if (meta) {
    slide.addText(meta, {
      x: 1.1, y: 0.55, w: 11, h: 0.4,
      fontFace: style.font, fontSize: 10, color: style.coverSub, align: 'right', margin: 0
    });
  }
  slide.addShape('rect', { x: 1.1, y: 2.42, w: 0.66, h: 0.1, fill: { color: style.accent }, line: { type: 'none' } });
  slide.addText(title || '演示文稿', {
    x: 1.1, y: 2.68, w: 10.9, h: 1.7,
    fontFace: style.font, fontSize: 42, bold: true, color: style.coverText,
    align: 'left', valign: 'top', fit: 'shrink', margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.12, y: 4.42, w: 10.6, h: 0.9,
      fontFace: style.font, fontSize: 17, color: style.coverSub,
      align: 'left', valign: 'top', fit: 'shrink', margin: 0
    });
  }
  slide.addText('AIPPT · AI 演示文稿', {
    x: 1.1, y: 6.85, w: 6, h: 0.35,
    fontFace: style.font, fontSize: 9, color: style.coverSub, margin: 0
  });
}

function drawSection(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  slide.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: style.primary }, line: { type: 'none' } });
  slide.addText(String(index).padStart(2, '0'), {
    x: 1.1, y: 1.1, w: 4, h: 1.9,
    fontFace: style.font, fontSize: 96, bold: true, color: tint(style.primary, 0.82),
    align: 'left', valign: 'middle', margin: 0
  });
  slide.addText(s.title, {
    x: 1.15, y: 3.15, w: 10.8, h: 1.3,
    fontFace: style.font, fontSize: 34, bold: true, color: style.text,
    align: 'left', valign: 'middle', fit: 'shrink', margin: 0
  });
  if (s.subtitle) {
    slide.addText(s.subtitle, {
      x: 1.18, y: 4.5, w: 10.4, h: 0.6,
      fontFace: style.font, fontSize: 16, color: style.textSub, align: 'left', margin: 0
    });
  }
}

function drawContentNative(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  drawTitleBar(slide, style, s.title, s.subtitle);
  const top = (s.title ? 1.8 : 0.7) + (s.subtitle ? 0.5 : 0);
  const blocks = (s.blocks && s.blocks.length) ? s.blocks : [{ type: 'bullets', items: s.bullets || [] }];
  drawNativeBlocks(slide, style, blocks, top);
  drawPageNo(slide, style, index, total);
}

/** （富）内容块 → 原生文本行（无渲染器时的降级路径） */
function blocksToNativeLines(blocks) {
  const flat = [];
  for (const blk of blocks || []) {
    switch (blk.type) {
      case 'bullets':
        for (const it of blk.items) flat.push(it);
        break;
      case 'text':
        flat.push({ text: blk.text, level: 0, code: false });
        break;
      case 'math':
        flat.push({ text: `$$ ${String(blk.tex).replace(/\s+/g, ' ')} $$`, level: 0, code: true });
        break;
      case 'table':
        flat.push({ text: `［表格 ${blk.rows.length} 行 × ${blk.headers.length} 列］${blk.headers.join(' | ')}`, level: 0, code: false });
        break;
      case 'code':
        flat.push({ text: blk.code, level: 0, code: true });
        break;
      case 'callout':
        if (blk.title) flat.push({ text: `［${blk.kind}］${blk.title}`, level: 0, code: false });
        for (const it of blk.items) flat.push({ text: it.text, level: Math.min((it.level || 0) + 1, 2), code: false });
        for (const l of blk.lines) flat.push({ text: l, level: 1, code: false });
        break;
      case 'env': {
        const label = blk.number != null
          ? `${(richHtml.ENV_LABELS[blk.env] || blk.env)} ${blk.number}`
          : (richHtml.ENV_LABELS[blk.env] || blk.env);
        flat.push({ text: `［${label}］${blk.title || ''}`, level: 0, code: false });
        for (const inner of blocksToNativeLines(blk.blocks)) {
          flat.push({ ...inner, level: Math.min((inner.level || 0) + 1, 2) });
        }
        break;
      }
      default:
        break;
    }
  }
  return flat;
}

function drawNativeBlocks(slide, style, blocks, top) {
  drawBulletsNative(slide, style, blocksToNativeLines(blocks), { x: 1.0, y: top, w: 11.3, h: 6.9 - top });
}

/**
 * 按 overlay 步绘制原生内容：
 *   可见 → 正常
 *   未来内容 → hide(默认) 用背景色占位（布局稳定）/ dim 浅灰 / collapse 直接不输出
 *   已过期内容 → 同上占位
 * 注意：必须同时判断【块级】与【列表项级】的步区间
 */
function drawNativeBlocksStep(slide, style, blocks, top, step, mode) {
  const out = [];
  for (const blk of blocks || []) {
    const blockVisible = ov.visibleAtStep(blk, step);
    const blockPast = blk.to != null && step > blk.to;

    if (blk.type === 'bullets') {
      // 逐项判断：item 自己的 from/to 优先
      const lineOf = (it) => {
        const text = it.code ? it.text : overlayStripped(it.text);
        return { text, level: it.level || 0, code: !!it.code };
      };
      for (const it of blk.items || []) {
        const visible = blockVisible && ov.visibleAtStep(it, step);
        const past = blockPast || (it.to != null && step > it.to);
        const line = lineOf(it);
        if (visible && !past) {
          out.push(line);
        } else if (mode === 'collapse') {
          // 不留空位：直接跳过
        } else if (mode === 'dim' && !past) {
          out.push({ ...line, _dim: true });
        } else {
          out.push({ ...line, _invisible: true });
        }
      }
      continue;
    }

    const lines = blocksToNativeLines([blk]);
    const visible = blockVisible && !blockPast;
    for (const line of lines) {
      if (visible) out.push(line);
      else if (mode === 'collapse') continue;
      else if (mode === 'dim' && !blockPast) out.push({ ...line, _dim: true });
      else out.push({ ...line, _invisible: true });
    }
  }
  drawBulletsNative(slide, style, out, { x: 1.0, y: top, w: 11.3, h: 6.9 - top });
}

/** 原生路径的文本清理：去掉 \label 与行内 overlay 命令 */
function overlayStripped(text) {
  return parser.stripMetadata(text);
}

// ============================================================
// 一·五、原生公式路径（v2.2）：公式 → OMML（PowerPoint 原生公式对象）
// ============================================================

/** 把一行文本切成「文字段 / 公式段」（行内代码里的 $ 不算公式） */
function splitInlineMath(text) {
  const src = String(text == null ? '' : text);
  const masked = parser.maskInlineCode(src);   // 等长替换，索引可直接映射回 src
  const segs = [];
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const open = m[1] != null ? 2 : 1;
    if (m.index > last) segs.push({ kind: 'text', text: src.slice(last, m.index) });
    segs.push({ kind: 'math', tex: src.slice(m.index + open, m.index + m[0].length - open) });
    last = m.index + m[0].length;
  }
  if (last < src.length) segs.push({ kind: 'text', text: src.slice(last) });
  return segs.length ? segs : [{ kind: 'text', text: src }];
}

/** 行内公式 → 占位符（放进 ctx.omml，生成后由 pptx-post 换成 <a14:m><m:oMath>） */
function emitInlineFormula(tex, ctx, szPt, color) {
  if (!tex || !tex.trim()) return '';
  const key = ctx.nextOmmlKey();
  const conv = latexToOmml(tex, { display: false, szPt, color });
  if (!conv.ok) {
    ctx.ommlFailures.push({ tex, error: conv.error });
    return `$${tex}$`;   // 转换失败：原样显示 LaTeX 源码（绝不静默丢内容）
  }
  ctx.omml[key] = { xml: conv.xml, name: '行内公式' };
  ctx.ommlInlineCount++;
  return key;
}

/**
 * 文本 → PptxGenJS runs（行内公式变成占位符）
 * @param {object} opts { fontPt, color, fontFace, level }
 */
function inlineRunsWithMath(text, ctx, opts = {}) {
  const fontPt = opts.fontPt || BODY_FONT_PT;
  const color = opts.color || '#000000';
  const fontFace = opts.fontFace;
  const runs = [];
  for (const seg of splitInlineMath(text)) {
    if (seg.kind === 'math') {
      const key = emitInlineFormula(seg.tex, ctx, fontPt, hexOf(color));
      if (key) runs.push({ text: key, options: { color, fontFace, fontSize: fontPt } });
      continue;
    }
    const plain = parser.inlineToRuns(seg.text);
    for (const r of plain) {
      if (!r.text) continue;
      runs.push({ text: r.text, options: { ...r.options, color, fontFace: r.options.fontFace || fontFace, fontSize: fontPt } });
    }
  }
  return runs;
}

/** 估算一行文字占几行（CJK 按 1 em、ASCII 按 0.55 em 粗估） */
function wrappedLineCount(text, fontPt, usableIn) {
  const t = parser.toPlainText(String(text == null ? '' : text));
  let ems = 0;
  for (const ch of t) {
    if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) ems += 1;
    else if (/\s/.test(ch)) ems += 0.3;
    else ems += 0.55;
  }
  const perLine = Math.max(6, (usableIn * 72) / fontPt);
  return Math.max(1, Math.ceil(ems / perLine));
}

/** 原生行的行高（英寸） */
function nativeLineHeight(text, level, fontPt, usableIn) {
  const pt = level === 0 ? fontPt : fontPt - 2;
  const n = wrappedLineCount(text, pt, usableIn - level * 0.3);
  return (n * pt * 1.32) / 72 + 0.1;
}

/** 估算块高（无渲染器时的兜底，也用于原生行布局） */
function estimateBlockHeight(block, fontPt, usableIn) {
  if (!block) return 0.4;
  if (block.type === 'math') {
    const rows = Math.max(1, String(block.tex || '').split(/\\\\/).length);
    return 0.62 + (rows - 1) * 0.46;
  }
  if (block.type === 'bullets') {
    return (block.items || []).reduce((a, it) => a + nativeLineHeight(it.text, it.level || 0, fontPt, usableIn), 0);
  }
  if (block.type === 'text') return nativeLineHeight(block.text, 0, fontPt, usableIn);
  if (block.type === 'code') return Math.max(0.55, String(block.code || '').split('\n').length * 0.23 + 0.12);
  return 0.5;
}

/** OMML 页的块高：公式用渲染器实测（×1.12 余量，Cambria Math 比 KaTeX 略高），文本用估算 */
async function measureOmmlBlock(block, style, ctx, fontPt, usableIn) {
  if (block.type === 'math' && ctx.renderer) {
    try {
      const h = await measureBlockHeight(block, style, ctx);
      if (h > 0) return Math.max(0.5, h * 1.12);
    } catch (e) { /* 退化为估算 */ }
  }
  return estimateBlockHeight(block, fontPt, usableIn);
}

/** 把块按可用高度装进若干页；超高的列表按条目拆 */
async function packOmmlBlocks(blocks, style, ctx, avail, fontPt, usableIn) {
  const parts = [];
  for (const blk of blocks) {
    let h = await measureOmmlBlock(blk, style, ctx, fontPt, usableIn);
    if (h <= avail) { parts.push({ block: blk, h }); continue; }
    if (blk.type === 'bullets' && blk.items.length > 1) {
      const mid = Math.ceil(blk.items.length / 2);
      const a = { ...blk, items: blk.items.slice(0, mid) };
      const b = { ...blk, items: blk.items.slice(mid) };
      parts.push(...(await packOmmlBlocks([a, b], style, ctx, avail, fontPt, usableIn)));
      continue;
    }
    if (blk.type === 'code') {
      const all = String(blk.code).split('\n');
      if (all.length > 4) {
        const mid = Math.ceil(all.length / 2);
        parts.push(...(await packOmmlBlocks(
          [{ ...blk, code: all.slice(0, mid).join('\n') }, { ...blk, code: all.slice(mid).join('\n') }],
          style, ctx, avail, fontPt, usableIn
        )));
        continue;
      }
    }
    parts.push({ block: blk, h: avail });
    ctx.warnings.push('有内容过高，已压缩到一页内显示');
  }
  const GAP = 0.14;
  const groups = [];
  let cur = [];
  let curH = 0;
  for (const p of parts) {
    const add = cur.length ? p.h + GAP : p.h;
    if (cur.length && curH + add > avail) { groups.push(cur); cur = []; curH = 0; }
    cur.push(p);
    curH += cur.length > 1 ? p.h + GAP : p.h;
  }
  if (cur.length) groups.push(cur);
  return groups.length ? groups : [[]];
}

/** 收集一页里所有"文本行"（含 overlay 步信息），供原生/动画路径共用 */
function collectTextLines(blocks) {
  const out = [];
  for (const blk of blocks || []) {
    if (blk.type === 'bullets') {
      for (const it of blk.items || []) {
        out.push({
          text: it.text,
          level: Math.min(it.level || 0, 3),
          code: !!it.code,
          from: it.from != null ? it.from : (blk.from || 1),
          to: it.to != null ? it.to : blk.to
        });
      }
    } else if (blk.type === 'text') {
      out.push({ text: blk.text, level: 0, code: false, from: blk.from || 1, to: blk.to });
    } else if (blk.type === 'code') {
      out.push({ text: blk.code, level: 0, code: true, from: blk.from || 1, to: blk.to });
    }
  }
  return out;
}

/**
 * 画一组「原生 + 公式」内容块。
 * @param {object} o { step, mode, anim }
 *   anim=true：不按步过滤，全部画出并给第 2 步起的内容打 ⟦ANIM:n⟧ 标记（生成后变成点击出现动画）
 */
function drawOmmlGroup(slide, style, group, ctx, o) {
  const fontPt = (ctx && ctx.bodyPt ? ctx.bodyPt : BODY_FONT_PT) + 2;
  const usableIn = LAYOUT.contentW - 0.2;
  const step = (o && o.step) || 1;
  const mode = (o && o.mode) || 'hide';
  const anim = !!(o && o.anim);
  let y = LAYOUT.contentTop;

  for (const part of group) {
    const blk = part.block;
    const h = Math.max(0.4, part.h);

    if (blk.type === 'math') {
      const key = ctx.nextOmmlKey();
      const conv = latexToOmml(blk.tex, { display: true, szPt: FORMULA_FONT_PT, color: hexOf(style.text) });
      if (conv.ok) {
        ctx.omml[key] = { xml: conv.xml, name: '公式', png: null, block: true };
        ctx.ommlKeysForFallback.push(key);
        ctx.mathBlockByKey[key] = blk;
        slide.addText(key, {
          x: LAYOUT.marginX, y, w: LAYOUT.contentW, h,
          fontFace: style.font, fontSize: FORMULA_FONT_PT, align: 'center', valign: 'middle', margin: 0
        });
        ctx.ommlDisplayCount++;
      } else {
        ctx.ommlFailures.push({ tex: blk.tex, error: conv.error });
        slide.addText(`$$ ${String(blk.tex).replace(/\s+/g, ' ')} $$`, {
          x: LAYOUT.marginX, y, w: LAYOUT.contentW, h,
          fontFace: 'Consolas', fontSize: 11, color: style.textSub, align: 'center', valign: 'middle', margin: 0
        });
      }
      y += h + 0.14;
      continue;
    }

    // 文本/列表：逐行画原生文本框（每行一个形状，动画才能逐条"点出来"）
    const lines = collectTextLines([blk]);
    let ly = y;
    for (const line of lines) {
      const visible = anim ? true : (line.from <= step && (line.to == null || step <= line.to));
      const past = !anim && line.to != null && step > line.to;
      if (!visible && mode === 'collapse') continue;
      const dim = !anim && !visible && !past && mode === 'dim';
      const hidden = !anim && !visible && !dim;
      const textColor = hidden ? style.bg : (dim ? tint(style.text, 0.72) : (line.level === 0 ? style.text : style.textSub));
      const lh = nativeLineHeight(line.text, line.level, fontPt, usableIn);
      const runs = [];
      runs.push({
        text: line.level === 0 ? '▪  ' : '–  ',
        options: {
          color: hidden ? style.bg : (dim ? tint(style.accent, 0.55) : (line.level === 0 ? style.accent : style.textSub)),
          bold: line.level === 0,
          fontFace: style.font,
          fontSize: line.level === 0 ? fontPt : fontPt - 2
        }
      });
      if (line.code) {
        runs.push({ text: line.text, options: { fontFace: 'Consolas', fontSize: fontPt - 3, color: textColor } });
      } else {
        for (const r of inlineRunsWithMath(overlayStripped(line.text), ctx, {
          fontPt: line.level === 0 ? fontPt : fontPt - 2,
          color: textColor,
          fontFace: style.font
        })) runs.push(r);
      }
      if (anim && line.from >= 2) {
        runs.push({ text: `⟦ANIM:${line.from}⟧`, options: { fontSize: 1, color: style.bg } });
      }
      slide.addText(runs, {
        x: LAYOUT.marginX + line.level * 0.3,
        y: ly,
        w: LAYOUT.contentW - line.level * 0.3,
        h: lh,
        valign: 'top',
        lineSpacingMultiple: 1.12,
        margin: 0
      });
      ly += lh + 0.04;
    }
    y = Math.max(y + h, ly) + 0.14;
  }
  return y;
}

// ============================================================
// 一·六、目录页 / 参考文献页
// ============================================================

/** 目录页：两列，条目带真实页码（页码用 ⟪P:i⟫ 标记，生成结束后统一回填） */
function drawToc(slide, style, s, ctx) {
  slide.background = { color: style.bg };
  const entries = (s.tocEntries && s.tocEntries.length) ? s.tocEntries : (ctx.tocEntries || []);
  drawTitleBar(slide, style, s.title || '目录', entries.length ? `共 ${entries.length} 节` : '');
  const top = 2.15;
  const colW = 5.35;
  const rowH = 0.62;
  const perCol = Math.max(1, Math.floor((LAYOUT.contentBottom - top) / rowH));
  entries.forEach((e, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    if (col > 1) return;                       // 超过两列容量时省略（下面会提示）
    const x = LAYOUT.marginX + col * (colW + 0.75);
    const y = top + row * rowH;
    ctx.tocPages[i] = null;
    slide.addShape('rect', {
      x: x + 0.02, y: y + 0.2, w: 0.055, h: 0.2,
      fill: { color: i === ctx.currentSection ? style.accent : tint(style.primary, 0.55) }, line: { type: 'none' }
    });
    slide.addText(
      [
        { text: `${e.number ? e.number + '  ' : ''}${e.title}`, options: { color: i === ctx.currentSection ? style.primary : style.text, bold: i === ctx.currentSection, fontFace: style.font, fontSize: 15 } },
        { text: '   ', options: { fontSize: 11 } },
        { text: `⟪P:${i}⟧`, options: { color: style.textSub, fontFace: style.font, fontSize: 11 } }
      ],
      { x: x + 0.22, y, w: colW - 0.22, h: rowH - 0.06, valign: 'middle', margin: 0 }
    );
  });
  if (entries.length > perCol * 2) {
    slide.addText(`（另有 ${entries.length - perCol * 2} 节未列出）`, {
      x: LAYOUT.marginX, y: LAYOUT.contentBottom - 0.3, w: LAYOUT.contentW, h: 0.3,
      fontFace: style.font, fontSize: 11, color: style.textSub, margin: 0
    });
  }
  drawFooter(slide, style, ctx, ctx.pageIndex + 1);
}

/** 参考文献页：编号 + 条目，字号比正文小一档 */
function drawRefs(slide, style, s, ctx) {
  slide.background = { color: style.bg };
  drawTitleBar(slide, style, s.title || '参考文献', '');
  const lines = s.refLines || [];
  const start = (s.refStart || 1) - 1;
  const runs = lines.map((l, i) => ({
    text: l,
    options: {
      fontFace: style.font,
      fontSize: 11.5,
      color: style.text,
      breakLine: i < lines.length - 1,
      paraSpaceAfter: 6
    }
  }));
  if (!runs.length) runs.push({ text: '（无引用条目）', options: { fontSize: 11, color: style.textSub } });
  slide.addText(runs, {
    x: LAYOUT.marginX, y: 1.9, w: LAYOUT.contentW, h: LAYOUT.contentBottom - 1.9,
    valign: 'top', lineSpacingMultiple: 1.2, margin: 0
  });
  void start;
  drawFooter(slide, style, ctx, ctx.pageIndex + 1);
}

function drawTwoColumn(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  drawTitleBar(slide, style, s.title, s.subtitle);
  const cols = (s.columns && s.columns.length) ? s.columns : splitBullets(s.bullets || []);
  const top = (s.title ? 2.05 : 0.9) + (s.subtitle ? 0.5 : 0);
  const colW = 5.35;
  const xs = [0.95, 6.95];
  slide.addShape('rect', { x: 6.62, y: top, w: 0.02, h: 6.6 - top, fill: { color: tint(style.primary, 0.86) }, line: { type: 'none' } });
  xs.forEach((x, ci) => {
    const col = cols[ci] || { heading: '', items: [] };
    if (col.heading) {
      slide.addText(col.heading, {
        x, y: top, w: colW, h: 0.5,
        fontFace: style.font, fontSize: 17, bold: true, color: style.primary, margin: 0
      });
    }
    const runs = [];
    col.items.forEach((item, ii) => {
      runs.push({ text: '·  ', options: { color: style.accent, fontFace: style.font, fontSize: 14, breakLine: ii > 0 } });
      runs.push({ text: item, options: { color: style.text, fontFace: style.font, fontSize: 14, breakLine: false } });
    });
    if (!runs.length) return;
    slide.addText(runs, {
      x, y: top + 0.62, w: colW, h: 6.6 - top - 0.62,
      valign: 'top', lineSpacingMultiple: 1.25, margin: 0, fit: 'shrink'
    });
  });
}

function splitBullets(bullets) {
  const texts = [];
  for (const raw of bullets) {
    const b = typeof raw === 'string' ? { text: raw, code: false } : raw;
    if (!b.code) texts.push(b.text);
  }
  const mid = Math.ceil(texts.length / 2);
  return [
    { heading: '', items: texts.slice(0, mid) },
    { heading: '', items: texts.slice(mid) }
  ];
}

function drawQuote(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  if (s.title) drawTitleBar(slide, style, s.title, '');
  const quote = (s.bullets && s.bullets.length) ? s.bullets[0].text : s.title;
  const y = s.title ? 2.15 : 2.5;
  slide.addShape('rect', { x: 1.7, y, w: 9.9, h: 2.9, fill: { color: style.bgAlt }, line: { type: 'none' } });
  slide.addShape('rect', { x: 1.7, y, w: 0.13, h: 2.9, fill: { color: style.primary }, line: { type: 'none' } });
  slide.addText('“', {
    x: 2.1, y: y + 0.12, w: 1.2, h: 1.0,
    fontFace: style.font, fontSize: 54, bold: true, color: style.accent, margin: 0
  });
  slide.addText(quote || '', {
    x: 2.35, y: y + 0.85, w: 8.6, h: 1.7,
    fontFace: style.font, fontSize: 21, bold: true, color: style.text,
    valign: 'middle', fit: 'shrink', margin: 0
  });
}

function drawEnd(slide, style, s) {
  drawHero(slide, style, s.title || '谢谢观看', s.subtitle || '', null);
}

// ============================================================
// 二、富内容路径（v2）：浏览器排版 → 高清图片
// ============================================================

function stageOptsFor(style, opts = {}) {
  return {
    fontPt: opts.fontPt || BODY_FONT_PT,
    widthIn: opts.widthIn || LAYOUT.contentW,
    paddingIn: opts.paddingIn == null ? 0.04 : opts.paddingIn,
    background: opts.background || style.bg,
    color: style.text,
    fontFamily: `${style.font}, "Segoe UI", sans-serif`,
    cssVars: {
      '--primary': style.primary,
      '--accent': style.accent,
      '--text': style.text,
      '--sub': style.textSub,
      '--bg': style.bg,
      '--bg-alt': style.bgAlt
    }
  };
}

function hasRichContent(slide, opts) {
  const mathIsRich = !opts || opts.mathIsRich !== false;
  return (slide.blocks || []).some((blk) => {
    if (blk.type === 'image') return false;
    if (blk.type === 'math') return mathIsRich;
    if (blk.type === 'table' || blk.type === 'callout' || blk.type === 'env' || blk.type === 'algo') return true;
    if (blk.type === 'bullets') {
      return mathIsRich
        ? (blk.rich || blk.items.some((it) => parser.hasRichMarkup(it.text)))
        : blk.items.some((it) => nonMathRich(it.text));
    }
    if (blk.type === 'text') {
      return mathIsRich
        ? (blk.rich || parser.hasRichMarkup(blk.text))
        : nonMathRich(blk.text);
    }
    if (blk.type === 'code') return blk.code.split('\n').length > 14;
    return false;
  });
}

/**
 * 「除公式以外的富标记」——决定这一页还能不能走原生文本框。
 * 公式（$…$）在 v2.2 里不再强制整页出图（可以走原生 OMML），
 * 但高亮、<br>、行内 overlay 命令这些只能靠浏览器排版，仍要走图片路径。
 * 行内代码先屏蔽，避免把 `` `==` `` 这种当语法。
 */
function nonMathRich(text) {
  const t = parser.maskInlineCode(String(text == null ? '' : text));
  if (/==[^=\n]+==/.test(t)) return true;
  if (/<mark\b/i.test(t)) return true;
  if (/<br\s*\/?>/i.test(t)) return true;
  if (/\\(?:only|uncover|visible|alert|onslide)\s*</.test(t)) return true;
  return false;
}

function slideHasMath(slide) {
  return (slide.blocks || []).some((b) => parser.blockHasMath(b));
}

function contentBlocks(slide) {
  return (slide.blocks || []).filter((b) => b.type !== 'image');
}

function imageBlocks(slide) {
  return (slide.blocks || []).filter((b) => b.type === 'image');
}

async function measureBlockHeight(block, style, ctx, widthIn) {
  const html = richHtml.blockToHtml(block);
  if (!html) return 0;
  const r = await ctx.renderer.measure(html, stageOptsFor(style, { widthIn: widthIn || LAYOUT.contentW }));
  return r.heightIn;
}

/** 超长块拆分成可容纳的子块（表格按行、代码按行、列表按条目） */
async function splitOversized(block, style, ctx, avail) {
  const out = [];

  async function rec(blk) {
    const h = await measureBlockHeight(blk, style, ctx);
    if (h <= avail) {
      out.push({ block: blk, h });
      return;
    }
    if (blk.type === 'table' && blk.rows.length > 1) {
      const mid = Math.ceil(blk.rows.length / 2);
      await rec({ ...blk, rows: blk.rows.slice(0, mid) });
      await rec({ ...blk, rows: blk.rows.slice(mid) });
      return;
    }
    if (blk.type === 'code') {
      const all = blk.code.split('\n');
      if (all.length > 2) {
        const mid = Math.ceil(all.length / 2);
        await rec({ ...blk, code: all.slice(0, mid).join('\n') });
        await rec({ ...blk, code: all.slice(mid).join('\n') });
        return;
      }
    }
    if (blk.type === 'bullets' && blk.items.length > 1) {
      const mid = Math.ceil(blk.items.length / 2);
      await rec({ ...blk, items: blk.items.slice(0, mid) });
      await rec({ ...blk, items: blk.items.slice(mid) });
      return;
    }
    if (blk.type === 'callout' && (blk.items.length + blk.lines.length) > 1) {
      if (blk.items.length > 1) {
        const mid = Math.ceil(blk.items.length / 2);
        await rec({ ...blk, items: blk.items.slice(0, mid) });
        await rec({ ...blk, items: blk.items.slice(mid) });
        return;
      }
      if (blk.lines.length > 1) {
        const mid = Math.ceil(blk.lines.length / 2);
        await rec({ ...blk, lines: blk.lines.slice(0, mid) });
        await rec({ ...blk, lines: blk.lines.slice(mid) });
        return;
      }
    }
    // 无法再拆：原样放入（渲染时按比例压缩）
    out.push({ block: blk, h });
  }

  await rec(block);
  return out;
}

/** 把内容块按可用高度打包成 1..n 组 */
async function packBlocks(blocks, style, ctx, avail) {
  const parts = [];
  for (const blk of blocks) {
    const h = await measureBlockHeight(blk, style, ctx);
    if (h <= avail) parts.push({ block: blk, h });
    else parts.push(...(await splitOversized(blk, style, ctx, avail)));
  }

  const GAP = 0.12;
  const groups = [];
  let cur = [];
  let curH = 0;
  for (const p of parts) {
    const add = cur.length ? p.h + GAP : p.h;
    if (cur.length && curH + add > avail) {
      groups.push(cur);
      cur = [];
      curH = 0;
    }
    cur.push(p);
    curH += cur.length > 1 ? p.h + GAP : p.h;
  }
  if (cur.length) groups.push(cur);
  return groups.length ? groups : [[]];
}

/** 渲染一组内容块 → 图片信息（按 overlay 步过滤/变暗） */
async function renderGroup(group, style, ctx, step, mode) {
  const html = group
    .map((p) => richHtml.blockToHtml(p.block, { step: step || 1, mode: mode || 'hide' }))
    .join('');
  if (!html.trim()) return null;
  const r = await ctx.renderer.renderFragment(html, stageOptsFor(style));
  const avail = LAYOUT.contentBottom - LAYOUT.contentTop;
  const dataUrl = `data:image/png;base64,${r.png.toString('base64')}`;
  return {
    dataUrl,
    widthIn: r.widthIn,
    heightIn: r.heightIn,
    failures: r.failures || [],
    scale: r.heightIn > avail ? avail / r.heightIn : 1
  };
}

/** 渲染含公式的标题为图片（标题里出现 $...$ 时使用） */
async function renderTitleImage(title, style, ctx) {
  const html = `<div style="font-weight:700;font-size:1em;line-height:1.2">${richHtml.inlineToHtml(title)}</div>`;
  try {
    const r = await ctx.renderer.renderFragment(html, stageOptsFor(style, { fontPt: TITLE_FONT_PT, paddingIn: 0.02 }));
    return {
      dataUrl: `data:image/png;base64,${r.png.toString('base64')}`,
      widthIn: r.widthIn,
      heightIn: r.heightIn
    };
  } catch (e) {
    return null;
  }
}

// ============================================================
// 三、图片解析（本地文件 / 远程 URL / SVG 栅格化）
// ============================================================

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};
const TRY_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

function findImageFile(src, ctx) {
  const candidates = [];
  const dirs = [ctx.baseDir || process.cwd(), ...(ctx.searchDirs || [])];
  if (path.isAbsolute(src)) {
    candidates.push(src);
  } else {
    for (const d of dirs) candidates.push(path.resolve(d, src));
  }
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  // 无扩展名 → 逐个尝试
  if (!path.extname(src)) {
    for (const c of candidates) {
      for (const ext of TRY_EXTS) {
        if (fs.existsSync(c + ext)) return c + ext;
      }
    }
  }
  // LaTeX 里常写相对路径带子目录
  for (const c of candidates) {
    if (/\.(pdf|eps)$/i.test(c)) return null;
  }
  return null;
}

/**
 * 载入图片 → data URL
 * @returns {Promise<{dataUrl:string, src:string, kind:string}|null>}
 */
async function loadImage(src, ctx) {
  const s = String(src || '').trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(s, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 20 * 1024 * 1024) return null;
      if (type.includes('svg')) {
        return await rasterizeSvg(buf.toString('utf8'), ctx);
      }
      const mime = type.split(';')[0] || 'image/png';
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, src: s, kind: 'url' };
    } catch (e) {
      return null;
    }
  }

  if (/^data:image\//i.test(s)) return { dataUrl: s, src: s, kind: 'data' };

  const file = findImageFile(s, ctx);
  if (!file) return null;
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === '.svg') return await rasterizeSvg(buf.toString('utf8'), ctx);
  const mime = MIME_BY_EXT[ext] || 'image/png';
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, src: file, kind: 'file' };
}

/** SVG → PNG（借用富内容渲染器） */
async function rasterizeSvg(svgText, ctx) {
  if (!ctx.renderer) return null;
  try {
    const r = await ctx.renderer.renderFragment(
      `<img src="data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}" style="display:block">`,
      { fontPt: 12, widthIn: LAYOUT.contentW, paddingIn: 0, background: '#FFFFFF' }
    );
    return { dataUrl: `data:image/png;base64,${r.png.toString('base64')}`, src: 'svg', kind: 'svg' };
  } catch (e) {
    return null;
  }
}

// ============================================================
// 四、主入口
// ============================================================

/**
 * 入口：先按样式插件应用版式参数，生成结束后恢复（避免污染下一次生成）
 */
async function generatePptx(slides, styleId, outPath, options = {}) {
  const stylePool = (options.styles && options.styles.length) ? options.styles : STYLES;
  const style = stylePool.find((s) => s.id === styleId) || stylePool[0];
  const restore = applyStyleLayout(style);
  try {
    return await generatePptxInner(slides, styleId, outPath, options);
  } finally {
    restore();
  }
}

async function generatePptxInner(slides, styleId, outPath, options = {}) {
  if (!Array.isArray(slides) || !slides.length) throw new Error('没有可生成的幻灯片内容');
  const stylePool = (options.styles && options.styles.length) ? options.styles : STYLES;
  const style = stylePool.find((s) => s.id === styleId) || stylePool[0];
  const restoreLayout = applyStyleLayout(style);
  const total = slides.length;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W16x9', width: W, height: H });
  pptx.layout = 'W16x9';
  pptx.author = 'AIPPT';
  pptx.company = 'AIPPT';
  pptx.subject = 'AI 生成的演示文稿';
  pptx.title = slides[0].title || '演示文稿';
  pptx.theme = { headFontFace: style.font, bodyFontFace: style.font, lang: 'zh-CN' };

  const ctx = {
    renderer: options.renderer || null,
    baseDir: options.baseDir || process.cwd(),
    searchDirs: options.searchDirs || [],
    onProgress: options.onProgress || (() => {}),
    overlayMode: ['dim', 'collapse'].includes(options.overlayMode) ? options.overlayMode : 'hide',
    sectionNumbers: !!options.sectionNumbers,
    warnings: [],
    renderedPages: 0,
    // ---- v2.2 ----
    formulaMode: ['image', 'omml', 'omml-fallback'].includes(options.formulaMode) ? options.formulaMode : 'omml-fallback',
    animation: options.animation !== false,          // 真「点击出现」动画
    showFooter: options.footer !== false,            // 页脚章节导航 + 页码
    omml: {},                                        // 占位符 → OMML 片段
    ommlKeysForFallback: [],                         // 需要图片兜底的块级公式
    ommlFailures: [],
    ommlInlineCount: 0,
    ommlDisplayCount: 0,
    ommlKeySeq: 0,
    mathBlockByKey: {},                              // 占位符 → 原始公式块（用于渲染兜底图）
    animatedSlides: 0,
    tokens: {},                                      // 生成后统一替换的文本标记（目录页码等）
    tocEntries: slides.tocEntries || (slides[0] && slides[0].tocEntries) || [],
    tocPages: {},
    titlePt: (style.layout && style.layout.titleSize) || TITLE_FONT_PT,
    bodyPt: (style.layout && style.layout.bodySize) || BODY_FONT_PT,
    navMax: (style.layout && style.layout.navMax) || NAV_MAX_SECTIONS,
    sectionNav: { titles: [], current: 0 },
    currentSection: -1,
    pageIndex: 0,
    nextOmmlKey() {
      this.ommlKeySeq++;
      return `⟦MATH:${this.ommlKeySeq}⟧`;
    }
  };
  // 目录条目：优先用解析器挂在数组上的（也兼容手工构造的 slides）
  if (!ctx.tocEntries.length) {
    const seen = [];
    for (const s of slides) {
      if (s.headingLevel && s.headingLevel <= 2 && s.title) seen.push({ title: s.title, number: s.number || '', level: s.headingLevel });
    }
    ctx.tocEntries = seen;
  }
  ctx.sectionNav.titles = ctx.tocEntries;
  const useOmml = ctx.formulaMode !== 'image';
  ctx.useOmml = useOmml;

  const meta = `${todayZh()} · AIPPT`;
  const availH = LAYOUT.contentBottom - LAYOUT.contentTop;
  let pageIndex = 0;

  // 记录每节首页（供目录页码回填）
  const tocIndexOf = (title) => ctx.tocEntries.findIndex((e) => e.title === title);
  /** 记录某节首页（offset：在 pageIndex++ 之前调用时传 1） */
  const markSection = (s, offset) => {
    const idx = tocIndexOf(s.title);
    if (idx < 0) return;
    ctx.currentSection = idx;
    ctx.sectionNav.current = idx;
    if (ctx.tocPages[idx] == null) ctx.tocPages[idx] = pageIndex + (offset || 0);
  };

  for (let si = 0; si < slides.length; si++) {
    const s = slides[si];
    const layout = s.layout === 'end' && si === 0 ? 'cover' : s.layout;
    const titleText = (ctx.sectionNumbers && s.number) ? `${s.number}　${s.title}` : s.title;
    ctx.pageIndex = pageIndex;

    // ---------- 封面 / 章节 / 结尾：保持原生 ----------
    if (layout === 'cover' || layout === 'end' || layout === 'section') {
      pageIndex++;
      const slide = pptx.addSlide();
      if (layout === 'cover') drawHero(slide, style, s.title, s.subtitle, meta);
      else if (layout === 'end') drawEnd(slide, style, s);
      else drawSection(slide, style, { ...s, title: titleText }, pageIndex, total);
      markSection(s);
      drawFooter(slide, style, ctx, pageIndex, { nav: layout !== 'cover' && layout !== 'end' });
      if (s.notes && s.notes.length) slide.addNotes(s.notes.join('\n'));
      continue;
    }

    // ---------- 目录页 ----------
    if (layout === 'toc') {
      pageIndex++;
      const slide = pptx.addSlide();
      if (s.tocEntries && s.tocEntries.length) ctx.tocEntries = s.tocEntries;
      drawToc(slide, style, s, ctx);
      if (s.notes && s.notes.length) slide.addNotes(s.notes.join('\n'));
      continue;
    }

    // ---------- 参考文献页 ----------
    if (layout === 'refs') {
      pageIndex++;
      const slide = pptx.addSlide();
      drawRefs(slide, style, s, ctx);
      if (s.notes && s.notes.length) slide.addNotes(s.notes.join('\n'));
      continue;
    }

    // ---------- 引用页 ----------
    if (layout === 'quote') {
      pageIndex++;
      const slide = pptx.addSlide();
      drawQuote(slide, style, s, pageIndex, total);
      drawFooter(slide, style, ctx, pageIndex);
      if (s.notes && s.notes.length) slide.addNotes(s.notes.join('\n'));
      continue;
    }

    const rich = hasRichContent(s, { mathIsRich: !useOmml });
    const imgs = imageBlocks(s);
    const steps = Math.max(1, s.steps || 1);
    const notesText = (s.notes && s.notes.length) ? s.notes.join('\n') : '';
    const hasMath = slideHasMath(s);

    // ---------- 纯文本 / 原生公式幻灯片 ----------
    if (!rich && !imgs.length) {
      markSection(s, 1);
      const blocks = (s.blocks && s.blocks.length) ? s.blocks : [{ type: 'bullets', items: s.bullets || [] }];

      // ① 点击出现动画：一页装下所有步，靠 p:timing 逐步显示
      const animatable = ctx.animation && steps > 1 && ctx.overlayMode === 'hide'
        && collectTextLines(blocks).every((l) => l.to == null) && !hasMath;
      if (animatable) {
        pageIndex++;
        const slide = pptx.addSlide();
        slide.background = { color: style.bg };
        drawTitleBar(slide, style, titleText, s.subtitle, null, ctx);
        const top = (s.title ? 1.8 : 0.7) + (s.subtitle ? 0.5 : 0);
        drawOmmlGroup(slide, style, [{ block: { type: 'bullets', items: collectTextLines(blocks) }, h: 0 }], ctx, { anim: true });
        void top;
        drawFooter(slide, style, ctx, pageIndex);
        if (notesText) slide.addNotes(notesText);
        ctx.animatedSlides = (ctx.animatedSlides || 0) + 1;
        continue;
      }

      // ② 原生公式页：公式走 OMML（可编辑），正文仍是原生文本框
      if (useOmml && hasMath) {
        const groups = await packOmmlBlocks(blocks, style, ctx, availH, BODY_FONT_PT + 2, LAYOUT.contentW - 0.2);
        for (let k = 1; k <= steps; k++) {
          for (let gi = 0; gi < groups.length; gi++) {
            pageIndex++;
            const slide = pptx.addSlide();
            slide.background = { color: style.bg };
            const suffix = gi === 0 ? '' : `（续${gi > 1 ? ' ' + gi : ''}）`;
            drawTitleBar(slide, style, gi === 0 ? titleText : `${titleText}${suffix}`, (gi === 0 && k === 1) ? s.subtitle : '', null, ctx);
            drawOmmlGroup(slide, style, groups[gi], ctx, { step: k, mode: ctx.overlayMode });
            drawFooter(slide, style, ctx, pageIndex);
            if (notesText) slide.addNotes(notesText);
          }
        }
        continue;
      }

      // ③ 普通原生页（原 v1 行为）
      if (layout === 'two-column' && steps === 1) {
        pageIndex++;
        const slide = pptx.addSlide();
        drawTwoColumn(slide, style, s, pageIndex, total);
        drawFooter(slide, style, ctx, pageIndex);
        if (notesText) slide.addNotes(notesText);
        continue;
      }
      for (let k = 1; k <= steps; k++) {
        pageIndex++;
        const slide = pptx.addSlide();
        slide.background = { color: style.bg };
        drawTitleBar(slide, style, titleText, k === 1 ? s.subtitle : '');
        const top = (s.title ? 1.8 : 0.7) + (k === 1 && s.subtitle ? 0.5 : 0);
        drawNativeBlocksStep(slide, style, blocks, top, k, ctx.overlayMode);
        drawFooter(slide, style, ctx, pageIndex);
        if (notesText) slide.addNotes(notesText);
      }
      continue;
    }

    // ---------- 富内容幻灯片：浏览器排版 → 图片（支持 overlay 分步） ----------
    markSection(s, 1);
    const titleIsRich = parser.hasRichMarkup(s.title || '');
    const titleImg = (ctx.renderer && titleIsRich)
      ? await renderTitleImage(titleText, style, ctx)
      : null;

    const blocks = contentBlocks(s);
    let groups;
    if (!blocks.length) groups = [];
    else if (ctx.renderer) groups = await packBlocks(blocks, style, ctx, availH);
    else groups = [blocks.map((b) => ({ block: b, h: 0 }))]; // 无渲染器：整页原生降级

    // 图片块单独成页（若有内容页，图片页排在后面）
    const pendingImages = imgs.slice();

    for (let k = 1; k <= steps; k++) {
      for (let gi = 0; gi < groups.length; gi++) {
        pageIndex++;
        const slide = pptx.addSlide();
        slide.background = { color: style.bg };
        const suffix = gi === 0 ? '' : `（续${gi > 1 ? ' ' + gi : ''}）`;
        drawTitleBar(
          slide, style,
          gi === 0 ? titleText : `${titleText}${suffix}`,
          (gi === 0 && k === 1) ? s.subtitle : '',
          gi === 0 ? titleImg : null
        );
        if (ctx.renderer) {
          const rendered = await renderGroup(groups[gi], style, ctx, k, ctx.overlayMode);
          if (rendered && rendered.failures.length) {
            for (const f of rendered.failures) {
              ctx.warnings.push(`公式渲染失败，已按原文显示：${f.tex.slice(0, 60)}`);
            }
          }
          if (rendered) {
            const h = Math.min(rendered.heightIn * rendered.scale, availH);
            const w = LAYOUT.contentW;
            slide.addImage({
              data: rendered.dataUrl,
              x: LAYOUT.marginX,
              y: LAYOUT.contentTop,
              w,
              h,
              sizing: { type: 'contain', w, h }
            });
          }
        } else {
          const top = (s.title ? 1.8 : 0.7) + (gi === 0 && k === 1 && s.subtitle ? 0.5 : 0);
          drawNativeBlocksStep(slide, style, groups[gi].map((p) => p.block), top, k, ctx.overlayMode);
        }
        drawFooter(slide, style, ctx, pageIndex);
        if (notesText) slide.addNotes(notesText);
      }
    }

    if (pendingImages.length) {
      const loaded = [];
      for (const blk of pendingImages) {
        const img = await loadImage(blk.src, ctx);
        if (img) {
          loaded.push({ ...img, alt: blk.alt || '' });
        } else {
          ctx.warnings.push(`图片未找到，已跳过：${blk.src}`);
        }
      }
      if (loaded.length) {
        pageIndex++;
        const slide = pptx.addSlide();
        slide.background = { color: style.bg };
        drawTitleBar(slide, style, titleText, '', groups.length ? null : titleImg);
        const n = loaded.length;
        const gap = 0.25;
        const boxH = (availH - gap * (n - 1)) / n;
        let y = LAYOUT.contentTop;
        for (const it of loaded) {
          const captionH = it.alt ? 0.32 : 0;
          slide.addImage({
            data: it.dataUrl,
            x: LAYOUT.marginX,
            y,
            w: LAYOUT.contentW,
            h: Math.max(0.4, boxH - captionH),
            sizing: { type: 'contain', w: LAYOUT.contentW, h: Math.max(0.4, boxH - captionH) }
          });
          if (it.alt) {
            slide.addText(it.alt, {
              x: LAYOUT.marginX, y: y + boxH - captionH, w: LAYOUT.contentW, h: captionH,
              fontFace: style.font, fontSize: 11, color: style.textSub, align: 'center', valign: 'middle', margin: 0
            });
          }
          y += boxH + gap;
        }
        drawFooter(slide, style, ctx, pageIndex);
        if (!groups.length && s.notes && s.notes.length) slide.addNotes(s.notes.join('\n'));
      } else if (!groups.length) {
        // 全无内容：仍出一页，避免丢页
        pageIndex++;
        const slide = pptx.addSlide();
        slide.background = { color: style.bg };
        drawTitleBar(slide, style, titleText, s.subtitle, titleImg);
        drawFooter(slide, style, ctx, pageIndex);
      }
    }

    if (options.onProgress && (si + 1) % 5 === 0) {
      options.onProgress(`已排版 ${si + 1}/${slides.length} 页…`);
    }
  }

  // ---------- 富内容公式的图片兜底 ----------
  // （只有「原生公式+图片兜底」模式才需要：给每条块级公式单独出一张图）
  if (useOmml && ctx.formulaMode === 'omml-fallback' && ctx.renderer && ctx.ommlKeysForFallback.length) {
    for (const key of ctx.ommlKeysForFallback) {
      const rec = ctx.omml[key];
      if (!rec || rec.png) continue;
      try {
        const block = ctx.mathBlockByKey && ctx.mathBlockByKey[key];
        if (!block) continue;
        const r = await ctx.renderer.renderFragment(
          richHtml.blockToHtml(block),
          stageOptsFor(style, { fontPt: FORMULA_FONT_PT, paddingIn: 0.04 })
        );
        rec.png = r.png;
      } catch (e) {
        ctx.warnings.push(`公式兜底图渲染失败（不影响 PowerPoint 显示）：${String(e.message || e).slice(0, 80)}`);
      }
    }
  }

  await pptx.writeFile({ fileName: path.resolve(outPath) });

  // ---------- 目录页码回填 ----------
  for (const idx of Object.keys(ctx.tocPages)) {
    const pg = ctx.tocPages[idx];
    if (pg != null) ctx.tokens[`⟪P:${idx}⟧`] = String(pg);
  }
  for (let i = 0; i < ctx.tocEntries.length; i++) {
    if (ctx.tocPages[i] == null) ctx.tokens[`⟪P:${i}⟧`] = '·';
  }

  // ---------- 后处理：OMML 注入 + 图片兜底 + 点击动画 + 页码 ----------
  const post = await postProcess(outPath, {
    omml: useOmml ? ctx.omml : {},
    animations: true,
    pageTotal: pageIndex,
    tokens: ctx.tokens
  });

  // ---------- 目录里没列出的节（超过两列容量）----------
  if (ctx.tocEntries.length > 16) {
    ctx.warnings.push(`目录页只列出了前 16 节（共 ${ctx.tocEntries.length} 节）`);
  }
  for (const f of ctx.ommlFailures) {
    ctx.warnings.push(`公式转原生对象失败，已按原文显示：${String(f.tex).slice(0, 50)}`);
  }

  return {
    slideCount: pageIndex,
    warnings: ctx.warnings,
    pageNumbersPatched: post.pageTotalsPatched,
    omml: {
      display: ctx.ommlDisplayCount,
      inline: ctx.ommlInlineCount,
      replaced: post.ommlReplaced,
      fallbackImages: post.fallbacks,
      failed: ctx.ommlFailures.length
    },
    animation: { slides: post.animatedSlides, shapes: post.animatedShapes },
    toc: { entries: ctx.tocEntries.length, pages: Object.keys(ctx.tocPages).length }
  };
}

module.exports = { generatePptx, tint, W, H, LAYOUT, loadImage, findImageFile, patchPageTotals, TOTAL_SENTINEL };



