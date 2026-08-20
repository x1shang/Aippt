/**
 * main/generator.js
 * 基于 PptxGenJS 的 PPTX 生成器：将结构化幻灯片 + 样式 → .pptx 文件
 * 版式：16:9；布局：cover / section / content / two-column / quote / end
 */
'use strict';

const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');
const { STYLES } = require('../shared/styles.js');

const W = 13.333;
const H = 7.5;

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

/** 把 bullets 渲染到页面（支持层级 + 代码块） */
function drawBullets(slide, style, bullets, area) {
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
    const runs = [
      {
        text: lvl === 0 ? '▪  ' : '–  ',
        options: { color: lvl === 0 ? style.accent : style.textSub, bold: lvl === 0, fontFace: font, fontSize: lvl === 0 ? 17 : 15 }
      },
      ...require('../shared/parser.js').inlineToRuns(b.text).map((r) => ({
        text: r.text,
        options: { ...r.options, color: lvl === 0 ? style.text : style.textSub, fontFace: r.options.fontFace || font, fontSize: lvl === 0 ? 17 : 15 }
      }))
    ];
    slide.addText(runs, {
      x: area.x + lvl * 0.3,
      y,
      w: area.w - lvl * 0.3,
      h: lineH * (lvl === 0 ? 1 : 1),
      valign: 'top',
      lineSpacingMultiple: 1.15,
      paraSpaceAfter: 8,
      margin: 0
    });
    y += lineH * (lvl === 0 ? 1 : 0.92);
    if (y > area.y + area.h - lineH) break; // 防溢出
  }

  for (const cb of codeBlocks) {
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

function drawTitleBar(slide, style, title, subtitle) {
  if (title) {
    slide.addShape('rect', { x: 0.92, y: 0.74, w: 0.14, h: 0.5, fill: { color: style.primary }, line: { type: 'none' } });
    slide.addText(title, {
      x: 1.2, y: 0.62, w: 11.1, h: 0.75,
      fontFace: style.font, fontSize: 26, bold: true, color: style.text,
      align: 'left', valign: 'middle', fit: 'shrink', margin: 0
    });
    slide.addShape('rect', { x: 0.95, y: 1.48, w: 11.4, h: 0.014, fill: { color: tint(style.primary, 0.86) }, line: { type: 'none' } });
  }
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.2, y: 1.52, w: 11.1, h: 0.4,
      fontFace: style.font, fontSize: 14, color: style.textSub, align: 'left', valign: 'middle', margin: 0
    });
  }
}

function drawPageNo(slide, style, index, total) {
  slide.addText(`${index} / ${total}`, {
    x: 11.8, y: 7.08, w: 1.2, h: 0.32,
    fontFace: style.font, fontSize: 9, color: style.textSub, align: 'right', margin: 0
  });
}

/** 封面 / 结尾页：深色背景 + 装饰圆 + 大标题 */
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
  drawPageNo(slide, style, index, total);
}

function drawContent(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  drawTitleBar(slide, style, s.title, s.subtitle);
  const top = (s.title ? 1.8 : 0.7) + (s.subtitle ? 0.5 : 0);
  drawBullets(slide, style, s.bullets, { x: 1.0, y: top, w: 11.3, h: 6.9 - top });
  drawPageNo(slide, style, index, total);
}

function drawTwoColumn(slide, style, s, index, total) {
  slide.background = { color: style.bg };
  drawTitleBar(slide, style, s.title, s.subtitle);
  const cols = (s.columns && s.columns.length) ? s.columns : splitBullets(s.bullets);
  const top = (s.title ? 2.05 : 0.9) + (s.subtitle ? 0.5 : 0);
  const colW = 5.35;
  const x0 = 0.95;
  const x1 = 6.95;
  slide.addShape('rect', { x: 6.62, y: top, w: 0.02, h: 6.6 - top, fill: { color: tint(style.primary, 0.86) }, line: { type: 'none' } });
  [x0, x1].forEach((x, ci) => {
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
  drawPageNo(slide, style, index, total);
}

function splitBullets(bullets) {
  const texts = [];
  for (const raw of bullets) {
    const b = typeof raw === 'string' ? { text: raw, level: 0, code: false } : raw;
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
  const quote = s.bullets.length ? s.bullets[0].text : s.title;
  const y = s.title ? 2.15 : 2.5;
  slide.addShape('rect', { x: 1.7, y, w: 9.9, h: 2.9, fill: { color: style.bgAlt }, line: { type: 'none' } });
  slide.addShape('rect', { x: 1.7, y, w: 0.13, h: 2.9, fill: { color: style.primary }, line: { type: 'none' } });
  slide.addText('“', {
    x: 2.1, y: y + 0.12, w: 1.2, h: 1.0,
    fontFace: style.font, fontSize: 54, bold: true, color: style.accent, margin: 0
  });
  slide.addText(quote, {
    x: 2.35, y: y + 0.85, w: 8.6, h: 1.7,
    fontFace: style.font, fontSize: 21, bold: true, color: style.text,
    valign: 'middle', fit: 'shrink', margin: 0
  });
  drawPageNo(slide, style, index, total);
}

function drawEnd(slide, style, s, index, total) {
  drawHero(slide, style, s.title || '谢谢观看', s.subtitle || '', null);
}

/**
 * 生成 PPTX
 * @param {Array} slides 结构化幻灯片
 * @param {string} styleId 样式 ID
 * @param {string} outPath 输出 .pptx 路径
 * @returns {Promise<number>} 幻灯片页数
 */
async function generatePptx(slides, styleId, outPath) {
  if (!Array.isArray(slides) || !slides.length) {
    throw new Error('没有可生成的幻灯片内容');
  }
  const style = STYLES.find((s) => s.id === styleId) || STYLES[0];
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

  const meta = `${todayZh()} · AIPPT`;

  slides.forEach((s, i) => {
    const index = i + 1;
    const slide = pptx.addSlide();
    const layout = s.layout === 'end' && i === 0 ? 'cover' : s.layout;
    switch (layout) {
      case 'cover':
        drawHero(slide, style, s.title, s.subtitle, meta);
        break;
      case 'section':
        drawSection(slide, style, s, index, total);
        break;
      case 'two-column':
        drawTwoColumn(slide, style, s, index, total);
        break;
      case 'quote':
        drawQuote(slide, style, s, index, total);
        break;
      case 'end':
        drawEnd(slide, style, s, index, total);
        break;
      default:
        drawContent(slide, style, s, index, total);
    }
    if (Array.isArray(s.notes) && s.notes.length) {
      slide.addNotes(s.notes.join('\n'));
    }
  });

  await pptx.writeFile({ fileName: path.resolve(outPath) });
  return total;
}

module.exports = { generatePptx, tint, W, H };
