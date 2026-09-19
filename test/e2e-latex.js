/**
 * test/e2e-latex.js  （用 Electron 运行）
 * 端到端验证：用工作区的 LaTeX.md 走完整流程 → 生成 pptx → 结构校验
 * 校验点：
 *   1. 公式/表格被渲染成图片（而非残留 LaTeX 文本）
 *   2. 嵌入的图片不是白图（有墨迹）
 *   3. 宽表格自动分页为多页
 *   4. AI 模式下 ⟦B数字⟧ 占位保护生效（公式/表格原样保留）
 * 运行：node_modules\electron\dist\electron.exe test\e2e-latex.js [md路径]
 */
'use strict';

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const JSZip = require('jszip');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');
const { parseMarkdown } = require('../shared/parser.js');

const MD_PATH = process.argv[2] || 'E:\\dsh\\exe\\md2ppt\\LaTeX.md';
const OUT_DIR = path.join(__dirname, 'out');
const OUT_DIRECT = path.join(OUT_DIR, 'latex-direct.pptx');
const OUT_AI = path.join(OUT_DIR, 'latex-ai.pptx');
const OUT_IMAGES = path.join(OUT_DIR, 'latex-images.pptx');
const FIX_DIR = path.join(__dirname, 'fixtures');

// 96x54 测试图（蓝底白圆+白方）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAYAAAA4T5zSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFaSURBVHhe7ZFBisMwEATzkn3a/v8XCTr4UtCOZWnURumCuhisaajX3//7HX2++CGuNQHMJoDZBDCbAGYTwGwCmE0As+UBeuC/v2BZgBH41s5ODzATvr2jUwNUwBu7OSXACnhzF7cP4II7lMMBVsLbV3TBHcqhAA644ZsuuEOZAEVwh/J2ACfccqYL7lAmQBHcobwV4Alwk9IFdygToAjuUCZAEdyhTIAiuEOZAEVwh7I7wFPgLqUL7lB2B2g+AW5SuuAOZQIUwR3KBCiCO5QJUAR3KBOgCO5Q3grQdMItZ7rgDmUCFMEdytsBmg644ZsuuEOZAEVwh3IoQHMlvH1FF9yhHA7QXAFvXtUFdygToAjuUE4JcFgBb/TqgjuUUwM0Z8K37+iCO5TTAxyOwLd2tizAYQ/89xcsDxDPTQCzCWA2AcwmgNkEMJsAZhPAbAKYTQCzCWA2Acx+AAfSABGZjyySAAAAAElFTkSuQmCC';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}

function inkRatioOfBuffer(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return -1;
  const bmp = img.getBitmap();
  let ink = 0;
  let total = 0;
  for (let i = 0; i < bmp.length; i += 4) {
    const lum = 0.299 * bmp[i + 2] + 0.587 * bmp[i + 1] + 0.114 * bmp[i];
    if (lum < 200) ink++;
    total++;
  }
  return total ? ink / total : 0;
}

async function inspectPptx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files);
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  const media = names.filter((n) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif)$/i.test(n));

  let allText = '';
  const runs = [];
  for (const s of slides) {
    const xml = await zip.file(s).async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    runs.push(...texts);
    allText += texts.join('\n') + '\n';
  }

  const blankMedia = [];
  for (const m of media) {
    const buf = await zip.file(m).async('nodebuffer');
    const ink = inkRatioOfBuffer(buf);
    if (ink >= 0 && ink < 0.002) blankMedia.push(m);
  }

  return { slideCount: slides.length, notesCount: notes.length, mediaCount: media.length, media, allText, runs, blankMedia };
}

function startMockAi() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch (e) { /* ignore */ }
        const userMsg = (payload.messages || []).map((m) => m.content || '').join('\n');
        // 模拟一个「守规矩」的模型：按大纲顺序保留所有 ⟦B数字⟧ 标记
        const tokens = [...userMsg.matchAll(/⟦B(\d+)⟧/g)].map((m) => m[0]);
        const slides = [];
        slides.push({ title: 'LaTeX 速成（AI 版）', subtitle: '公式与图表原样保留', bullets: [], layout: 'cover' });
        for (let i = 0; i < tokens.length; i += 3) {
          slides.push({
            title: `AI 重写页 ${i / 3 + 1}`,
            bullets: ['这是 AI 重写的纯文本要点', ...tokens.slice(i, i + 3)],
            layout: 'content'
          });
        }
        slides.push({ title: '谢谢观看', bullets: [], layout: 'end' });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slides }) } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const renderer = new RichRenderer();
  let mockServer = null;

  try {
    await renderer.start();
    const md = fs.readFileSync(MD_PATH, 'utf8');
    const parsed = parseMarkdown(md, { fileName: path.basename(MD_PATH) });
    console.log(`\n源文档：${MD_PATH}`);
    console.log(`解析：${JSON.stringify(parsed.stats)}\n`);

    // ---------------- 直接排版模式 ----------------
    console.log('[1] 直接排版模式端到端');
    const t0 = Date.now();
    const logs = [];
    const res = await runGenerate(
      // 本文档是「公式 → 图片」路径的回归测试：显式固定 v1 行为（v2.2 默认走原生公式）
      { mdContent: md, mdPath: MD_PATH, styleId: 'tech-blue', mode: 'direct', outPath: OUT_DIRECT, formulaMode: 'image', animation: false, autoToc: false, footer: false },
      (m) => logs.push(m),
      { renderer }
    );
    const info = await inspectPptx(OUT_DIRECT);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    ok(`生成成功（${info.slideCount} 页，耗时 ${secs}s）`, res.ok && info.slideCount > 0);
    ok('幻灯片数 ≥ 源页数（宽表格自动分页）', info.slideCount >= parsed.slides.length,
      `生成 ${info.slideCount} < 源 ${parsed.slides.length}`);
    ok('公式/表格渲染为图片（≥15 张）', info.mediaCount >= 15, `实际 ${info.mediaCount}`);
    ok('嵌入图片无白图', info.blankMedia.length === 0, `白图: ${info.blankMedia.join(',')}`);
    ok('备注页齐全', info.notesCount === info.slideCount, `${info.notesCount}/${info.slideCount}`);

    const leakPatterns = [
      ['$$ 行间公式（含命令）', /\$\$[^$]*[\\^_]/],
      ['cases 环境', /\\begin\{cases\}/],
      ['pmatrix 环境', /\\begin\{pmatrix\}/],
      ['aligned 环境', /\\begin\{aligned\}/],
      ['multline 环境', /\\begin\{multline/],
      ['行内公式 $\\exists$', /\$\\exists\$/],
      ['行内公式 $\\forall$', /\$\\forall\$/],
      ['泰勒展开公式', /\\frac\{x\^\{3\}\}/],
      ['表格单元格公式', /\\underbrace/],
      ['化学式 \\ce', /\\ce\{/],
      ['cancelto 宏', /\\cancelto/]
    ];
    for (const [label, re] of leakPatterns) {
      const leaked = info.runs.filter((r) => re.test(r));
      ok(`未残留未渲染的 LaTeX：${label}`, leaked.length === 0,
        leaked.length ? JSON.stringify(leaked[0].slice(0, 80)) : '');
    }

    const mathSlides = parsed.slides.filter((s) => s.hasMath).length;
    const tableSlides = parsed.slides.filter((s) => s.blocks.some((b) => b.type === 'table')).length;
    console.log(`  · 含公式幻灯片 ${mathSlides} 页，含表格 ${tableSlides} 页，生成图片 ${info.mediaCount} 张`);
    for (const w of res.warnings) console.log('  ⚠ ' + w);

    // ---------------- AI 模式（占位保护） ----------------
    console.log('\n[2] AI 模式占位保护');
    mockServer = await startMockAi();
    const aiRes = await runGenerate(
      {
        mdContent: md,
        mdPath: MD_PATH,
        styleId: 'gradient-purple',
        mode: 'ai',
        outPath: OUT_AI,
        formulaMode: 'image',
        animation: false,
        autoToc: false,
        footer: false,
        apiConfig: { baseUrl: `http://127.0.0.1:${mockServer.address().port}/v1`, apiKey: 'mock', model: 'mock-model' }
      },
      () => {},
      { renderer }
    );
    const aiInfo = await inspectPptx(OUT_AI);
    ok('AI 模式生成成功', aiRes.ok && aiInfo.slideCount > 0);
    ok('AI 模式未丢失任何公式/表格（无补回警告）',
      !(aiRes.warnings || []).some((w) => w.includes('占位标记')),
      JSON.stringify(aiRes.warnings));
    ok('AI 模式渲染出图片（公式/表格仍在）', aiInfo.mediaCount > 0, `图片 ${aiInfo.mediaCount}`);
    ok('AI 模式无白图', aiInfo.blankMedia.length === 0, aiInfo.blankMedia.join(','));
    for (const [label, re] of leakPatterns) {
      const leaked = aiInfo.runs.filter((r) => re.test(r));
      ok(`AI 模式未残留未渲染的 LaTeX：${label}`, leaked.length === 0,
        leaked.length ? JSON.stringify(leaked[0].slice(0, 80)) : '');
    }
    ok('AI 模式备注页齐全', aiInfo.notesCount === aiInfo.slideCount,
      `${aiInfo.notesCount}/${aiInfo.slideCount}`);

    // ---------------- 图片与 SVG ----------------
    console.log('\n[3] 图片 / SVG / 缺失图片');
    fs.mkdirSync(FIX_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIX_DIR, 'figure.png'), PNG_BUF);
    fs.writeFileSync(path.join(FIX_DIR, 'vec.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">' +
      '<rect width="240" height="120" fill="#1E5EFF"/>' +
      '<circle cx="60" cy="60" r="40" fill="#FFFFFF"/>' +
      '<rect x="130" y="30" width="80" height="60" fill="#38BDF8"/></svg>');
    const imgMd = [
      '# 图片测试',
      '',
      '## 本地 PNG（相对路径）',
      '',
      '![示例图](figure.png)',
      '',
      '## SVG 矢量图（栅格化）',
      '',
      '![矢量图](vec.svg)',
      '',
      '## 缺失图片',
      '',
      '![找不到](nope.png)',
      '',
      '## 行内公式页',
      '',
      '设 $f(x) = \\frac{1}{1+e^{-x}}$。'
    ].join('\n');
    fs.writeFileSync(path.join(FIX_DIR, 'figures.md'), imgMd);

    const imgRes = await runGenerate(
      { mdContent: imgMd, mdPath: path.join(FIX_DIR, 'figures.md'), styleId: 'vivid-orange', mode: 'direct', outPath: OUT_IMAGES, formulaMode: 'image', autoToc: false, footer: false },
      () => {},
      { renderer }
    );
    const imgInfo = await inspectPptx(OUT_IMAGES);
    ok('图片文档生成成功', imgRes.ok && imgInfo.slideCount >= 3, `页数 ${imgInfo.slideCount}`);
    ok('PNG 与 SVG 均嵌入为图片', imgInfo.mediaCount >= 2, `图片 ${imgInfo.mediaCount}`);
    ok('嵌入图片无白图', imgInfo.blankMedia.length === 0, imgInfo.blankMedia.join(','));
    ok('缺失图片给出告警', (imgRes.warnings || []).some((w) => w.includes('nope.png')),
      JSON.stringify(imgRes.warnings));
    ok('公式被渲染为图片', imgInfo.mediaCount >= 3, `图片 ${imgInfo.mediaCount}`);
    ok('图片页无 LaTeX 残留', imgInfo.runs.every((r) => !/\$\\frac/.test(r)));
  } catch (e) {
    failed++;
    console.error('E2E ERROR: ' + (e && e.stack));
  }

  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  if (mockServer) mockServer.close();
  renderer.dispose();
  app.exit(failed ? 1 : 0);
});


