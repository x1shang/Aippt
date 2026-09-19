/**
 * test/preview-pptx.js  （用 Electron 运行，开发/验收工具）
 * 把 .pptx 的每一页渲染成 PNG —— 本机没有 PowerPoint/LibreOffice 时用于目视验收。
 * 支持：文本框（含 run 级颜色/字号/粗体/对齐/锚点）、矩形、椭圆、圆角矩形、
 *       嵌入图片（含透明填充）。
 * 用法：electron test\preview-pptx.js <pptx路径> [输出目录] [起始页] [结束页]
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
const SCALE = 2;

function emu2px(v) {
  return (Number(v || 0) / EMU_PER_INCH) * PX_PER_INCH;
}

function attr(tag, name) {
  if (!tag) return null;
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function colorFrom(scope) {
  const m = scope && scope.match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"\s*(\/>|>([\s\S]*?)<\/a:srgbClr>)/);
  if (!m) return null;
  let alpha = 1;
  const body = m[3] || '';
  const a = body.match(/<a:alpha val="(\d+)"/);
  if (a) alpha = Number(a[1]) / 100000;
  return { hex: m[1], alpha };
}

function buildSlideHtml(slideXml, relsXml, zipMedia, size) {
  const parts = [];
  const W = emu2px(size.cx);
  const H = emu2px(size.cy);
  parts.push(`<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #fff; }
    .pg { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; }
    .sh { position: absolute; }
    .tb { display: flex; flex-direction: column; }
    .p { display: block; white-space: pre-wrap; word-break: break-word; }
    .katex-fallback { font-family: Consolas, monospace; }
  </style>`);
  parts.push(`<div class="pg">`);

  // 背景：slide 根节点的 <p:bg><p:bgPr><a:solidFill>
  const bg = slideXml.match(/<p:bg>[\s\S]*?<\/p:bg>/);
  if (bg) {
    const c = colorFrom(bg[0]);
    if (c) parts.push(`<div class="sh" style="left:0;top:0;width:${W}px;height:${H}px;background:${c.hex}"></div>`);
  }

  // ---- 普通形状（含文本框）----
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let m;
  while ((m = spRe.exec(slideXml)) !== null) {
    const sp = m[1];
    const off = sp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!off || !ext) continue;
    const x = emu2px(off[1]);
    const y = emu2px(off[2]);
    const w = emu2px(ext[1]);
    const h = emu2px(ext[2]);
    if (w <= 0 || h <= 0) continue;
    // 完全在页面外 → 跳过
    if (x + w < 0 || y + h < 0 || x > W || y > H) continue;

    const prst = attr(sp.match(/<a:prstGeom[^>]*>/)?.[0], 'prst');
    const spPr = sp.match(/<p:spPr>[\s\S]*?<\/p:spPr>/)?.[0] || '';
    const fill = colorFrom(spPr);
    const shapeCss = [];
    if (fill) shapeCss.push(`background: rgba(${parseInt(fill.hex.slice(0, 2), 16)},${parseInt(fill.hex.slice(2, 4), 16)},${parseInt(fill.hex.slice(4, 6), 16)},${fill.alpha})`);
    if (prst === 'ellipse') shapeCss.push('border-radius: 50%');
    else if (prst === 'roundRect') shapeCss.push('border-radius: 12px');

    const hasText = sp.includes('<a:t>');
    const bodyPr = attr(sp.match(/<a:bodyPr[^>]*>/)?.[0] || '', 'anchor') || 't';
    const insets = sp.match(/<a:bodyPr[^>]*>/)?.[0] || '';
    const lIns = insets.includes('lIns') ? emu2px(attr(insets, 'lIns')) : 0;
    const tIns = insets.includes('tIns') ? emu2px(attr(insets, 'tIns')) : 0;

    if (!hasText && !fill) continue;
    const justify = bodyPr === 'ctr' ? 'center' : bodyPr === 'b' ? 'flex-end' : 'flex-start';
    parts.push(`<div class="sh${hasText ? ' tb' : ''}" style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;width:${w.toFixed(2)}px;height:${h.toFixed(2)}px;${shapeCss.join(';')};${hasText ? `padding:${tIns.toFixed(2)}px 0 0 ${lIns.toFixed(2)}px;justify-content:${justify};` : ''}">`);

    if (hasText) {
      const paraRe = /<a:p>([\s\S]*?)<\/a:p>/g;
      let pm;
      while ((pm = paraRe.exec(sp)) !== null) {
        const para = pm[1];
        const pPr = para.match(/<a:pPr[^>]*>/)?.[0] || '';
        const algn = attr(pPr, 'algn') || 'l';
        const lineSpacing = para.match(/<a:lnSpc><a:spcPct val="(\d+)"/);
        const ls = lineSpacing ? Number(lineSpacing[1]) / 100000 : 1.15;
        const spans = [];
        const runRe = /<a:r>([\s\S]*?)<\/a:r>/g;
        let rm;
        while ((rm = runRe.exec(para)) !== null) {
          const run = rm[1];
          // 注意：rPr 可能是 <a:rPr .../> 或 <a:rPr ...>…</a:rPr>，必须取完整块才能读到颜色
          const rPr = run.match(/<a:rPr[^>]*\/>/)?.[0] ||
            run.match(/<a:rPr[\s\S]*?<\/a:rPr>/)?.[0] || '';
          const sz = rPr.includes('sz=') ? Number(attr(rPr, 'sz')) / 100 : 18;
          const bold = / b="1"/.test(rPr) || rPr.includes('b="1"');
          const italic = rPr.includes('i="1"');
          const font = attr(rPr, 'typeface') || 'Microsoft YaHei';
          const c = colorFrom(rPr);
          const text = [...run.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1]).join('');
          if (!text) continue;
          const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          spans.push(`<span style="font-size:${(sz / 72 * PX_PER_INCH).toFixed(1)}px;font-weight:${bold ? 700 : 400};font-style:${italic ? 'italic' : 'normal'};font-family:'${font}',sans-serif;color:#${c ? c.hex : '101828'}">${esc}</span>`);
        }
        if (spans.length) {
          parts.push(`<div class="p" style="text-align:${algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left'};line-height:${ls}">${spans.join('')}</div>`);
        }
      }
    }
    parts.push('</div>');
  }

  // ---- 图片 ----
  const picRe = /<p:pic>([\s\S]*?)<\/p:pic>/g;
  while ((m = picRe.exec(slideXml)) !== null) {
    const pic = m[1];
    const off = pic.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const embed = pic.match(/r:embed="([^"]+)"/);
    if (!off || !ext || !embed) continue;
    const rel = relsXml && relsXml.match(new RegExp(`Id="${embed[1]}"[^>]*Target="([^"]+)"`));
    if (!rel) continue;
    const mediaPath = 'ppt/' + rel[1].replace(/^\.\.\//, '');
    const data = zipMedia[mediaPath];
    if (!data) continue;
    const extName = mediaPath.split('.').pop().toLowerCase();
    const mime = extName === 'jpg' || extName === 'jpeg' ? 'image/jpeg' : `image/${extName}`;
    const x = emu2px(off[1]);
    const y = emu2px(off[2]);
    const w = emu2px(ext[1]);
    const h = emu2px(ext[2]);
    parts.push(`<img class="sh" src="data:${mime};base64,${data}" style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;width:${w.toFixed(2)}px;height:${h.toFixed(2)}px;object-fit:contain">`);
  }

  parts.push('</div>');
  return parts.join('\n');
}

app.whenReady().then(async () => {
  const pptxPath = process.argv[2];
  const outDir = process.argv[3] || path.join(path.dirname(pptxPath), 'preview');
  const fromPage = Number(process.argv[4] || 1);
  const toPage = Number(process.argv[5] || 9999);
  if (!pptxPath || !fs.existsSync(pptxPath)) {
    console.error('用法: electron test/preview-pptx.js <pptx路径> [输出目录] [起始页] [结束页]');
    app.exit(1);
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  const szTag = presentation.match(/<p:sldSz[^>]*>/)?.[0] || '';
  const size = { cx: attr(szTag, 'cx') || 12192000, cy: attr(szTag, 'cy') || 6858000 };

  const mediaPaths = Object.keys(zip.files).filter((n) => /^ppt\/media\/[^/]+$/.test(n));
  const zipMedia = {};
  for (const p of mediaPaths) {
    zipMedia[p] = Buffer.from(await zip.file(p).async('nodebuffer')).toString('base64');
  }

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 800,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  });
  win.webContents.setFrameRate(30);

  const W = Math.round(emu2px(size.cx) * SCALE);
  const H = Math.round(emu2px(size.cy) * SCALE);
  win.setContentSize(W, H);

  let count = 0;
  for (let i = 0; i < slideNames.length; i++) {
    const pageNo = i + 1;
    if (pageNo < fromPage || pageNo > toPage) continue;
    const slideXml = await zip.file(slideNames[i]).async('string');
    const relsPath = `ppt/slides/_rels/${slideNames[i].split('/').pop()}.rels`;
    const relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '';
    const html = buildSlideHtml(slideXml, relsXml, zipMedia, size);
    if (process.env.AIPPT_PREVIEW_DUMP === '1') {
      fs.writeFileSync(path.join(outDir, `page-${String(pageNo).padStart(2, '0')}.html`), html);
    }
    const wrapped = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body style="transform:scale(${SCALE});transform-origin:top left;width:${emu2px(size.cx)}px;height:${emu2px(size.cy)}px">${html}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(wrapped).toString('base64'));
    await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    const file = path.join(outDir, `page-${String(pageNo).padStart(2, '0')}.png`);
    fs.writeFileSync(file, img.toPNG());
    count++;
  }

  console.log(`已渲染 ${count} 页 → ${outDir}  (${W}x${H})`);
  win.destroy();
  app.exit(0);
});
