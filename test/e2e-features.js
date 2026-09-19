/**
 * test/e2e-features.js  （用 Electron 运行）
 * v2.1 四项新功能的真实渲染端到端验证：
 *   [1] features.md 全量生成 + 结构校验（overlay 展开页数、引用替换、图片、无白图）
 *   [2] 代码语法高亮：渲染图颜色数显著多于纯文本代码
 *   [3] 渐进显示：同页不同步的渲染图内容递增（墨迹比例递增）
 *   [4] 定理环境：渲染图含彩色块（饱和像素比例 > 0）
 * 运行：node_modules\electron\dist\electron.exe test\e2e-features.js
 */
'use strict';

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');
const { generatePptx, LAYOUT } = require('../main/generator.js');
const parser = require('../shared/parser.js');
const richHtml = require('../shared/rich-html.js');

const OUT_DIR = path.join(__dirname, 'out');
const FIX_DIR = path.join(__dirname, 'fixtures');
const OUT_PPTX = path.join(OUT_DIR, 'features-e2e.pptx');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAYAAAA4T5zSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFaSURBVHhe7ZFBisMwEATzkn3a/v8XCTr4UtCOZWnURumCuhisaajX3//7HX2++CGuNQHMJoDZBDCbAGYTwGwCmE0As+UBeuC/v2BZgBH41s5ODzATvr2jUwNUwBu7OSXACnhzF7cP4II7lMMBVsLbV3TBHcqhAA644ZsuuEOZAEVwh/J2ACfccqYL7lAmQBHcobwV4Alwk9IFdygToAjuUCZAEdyhTIAiuEOZAEVwh7I7wFPgLqUL7lB2B2g+AW5SuuAOZQIUwR3KBCiCO5QJUAR3KBOgCO5Q3grQdMItZ7rgDmUCFMEdytsBmg644ZsuuEOZAEVwh3IoQHMlvH1FF9yhHA7QXAFvXtUFdygToAjuUE4JcFgBb/TqgjuUUwM0Z8K37+iCO5TTAxyOwLd2tizAYQ/89xcsDxDPTQCzCWA2AcwmgNkEMJsAZhPAbAKYTQCzCWA2Acx+AAfSABGZjyySAAAAAElFTkSuQmCC';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}

/** PNG 像素统计：墨迹 / 强彩色像素 / 颜色数 / 左侧色带占比 */
function pixelStats(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return { ink: -1, strongPct: -1, colors: 0, leftBand: 0 };
  const bmp = img.getBitmap();
  const size = img.getSize();
  const seen = new Set();
  let ink = 0;
  let strong = 0;
  let total = 0;
  let leftHits = 0;
  let leftTotal = 0;
  let leftBarRun = 0; // 左侧 x<14 列中最长的彩色连续竖条（占图高比例）
  for (let x = 0; x < Math.min(14, size.width); x++) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < size.height; y++) {
      const i = (y * size.width + x) * 4;
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if ((mx - mn) > 90 && lum > 30) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    if (best > leftBarRun) leftBarRun = best;
  }
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const i = (y * size.width + x) * 4;
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const isStrong = (mx - mn) > 90 && lum > 30;
      if (lum < 200) ink++;
      if (isStrong) strong++;
      total++;
      seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
      if (x < 14 && y > 6 && y < size.height - 6) {
        leftTotal++;
        if (isStrong) leftHits++;
      }
    }
  }
  return {
    ink: total ? ink / total : 0,
    strongPct: total ? strong / total : 0,
    colors: seen.size,
    leftBand: leftTotal ? leftHits / leftTotal : 0,
    leftBarRun: size.height ? leftBarRun / size.height : 0
  };
}

/** 从 pptx 中取出每页的文本，统计含指定标题的页数 */
async function countPagesWithTitle(zip, title) {
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  let count = 0;
  for (const s of slideFiles) {
    const xml = await zip.file(s).async('string');
    const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
    if (text.includes(title)) count++;
  }
  return count;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(FIX_DIR, { recursive: true });
  const renderer = new RichRenderer();

  try {
    await renderer.start();

    // 准备夹具（features.md 引用 figure.png，需与 md 同目录）
    fs.writeFileSync(path.join(FIX_DIR, 'figure.png'), PNG_BUF);
    const md = fs.readFileSync(path.join(__dirname, 'features.md'), 'utf8');
    const mdPath = path.join(FIX_DIR, 'features-e2e.md');
    fs.writeFileSync(mdPath, md);

    const parsed = parser.parseMarkdown(md, { fileName: 'features.md' });
    console.log(`\n源文档：test/features.md`);
    console.log(`解析：${JSON.stringify(parsed.stats)}\n`);

    // ---------------- [1] 全量生成 ----------------
    console.log('[1] features.md 全量生成');
    const logs = [];
    const res = await runGenerate(
      // v2.1 功能回归：显式关掉 v2.2 的动画/目录/页脚，才能按"每步一页"计数
      { mdContent: md, mdPath, styleId: 'tech-blue', mode: 'direct', outPath: OUT_PPTX, overlayMode: 'hide', animation: false, autoToc: false, footer: false },
      (m) => logs.push(m),
      { renderer }
    );
    const zip = await JSZip.loadAsync(fs.readFileSync(OUT_PPTX));
    const names = Object.keys(zip.files);
    const slideFiles = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const media = names.filter((n) => /^ppt\/media\/[^/]+\.(png|jpe?g)$/i.test(n));
    let allText = '';
    const runs = [];
    for (const s of slideFiles) {
      const xml = await zip.file(s).async('string');
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      runs.push(...texts);
      allText += texts.join('\n') + '\n';
    }
    // overlay 展开：源 5 页 → 至少 9 页（两个 overlay 页各 +2）
    ok('overlay 展开页数 ≥ 9（源 5 页 + 4 个分步页）', res.slideCount >= 9, `实际 ${res.slideCount}`);
    const pagesProgressive = await countPagesWithTitle(zip, '渐进显示基础');
    const pagesInline = await countPagesWithTitle(zip, '行内 overlay');
    ok('「渐进显示基础」展开为 3 页', pagesProgressive === 3, `实际 ${pagesProgressive}`);
    ok('「行内 overlay」展开为 3 页', pagesInline === 3, `实际 ${pagesInline}`);
    ok('渲染出图片（公式/定理/代码/表格）', media.length >= 6, `图片 ${media.length}`);
    ok('交叉引用已替换（pptx 文本无 \\ref 残留）', !/\\\\(ref|eqref|autoref|cref)\{/.test(allText));
    {
      // 含引用的文字位于富内容页（渲染为图片），因此校验“解析 → HTML”链路
      const refBlock = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'text' && b.text.includes('可知'));
      const html = richHtml.blockToHtml(refBlock, { step: 1, mode: 'hide' });
      ok('引用解析出「图 1 / 表 1 / 定理 1」',
        html.includes('图 1') && html.includes('表 1') && html.includes('定理 1'),
        html.slice(0, 120));
      ok('公式编号渲染进图（eq-no 出现在 HTML 而非正文）', html.includes('eq-no') === false);
    }
    const step1 = parsed.slides.find((s) => s.title.includes('渐进显示基础'));
    ok('源页步数统计正确', step1.steps === 3, `steps=${step1.steps}`);

    // 无白图
    const blank = [];
    for (const m of media) {
      const st = pixelStats(await zip.file(m).async('nodebuffer'));
      if (st.ink >= 0 && st.ink < 0.002) blank.push(m);
    }
    ok('嵌入图片无白图', blank.length === 0, blank.join(','));

    // ---------------- [2] 代码高亮 ----------------
    console.log('\n[2] 代码语法高亮');
    const codeBlocks = parsed.slides.flatMap((s) => s.blocks).filter((b) => b.type === 'code');
    const pyBlock = codeBlocks.find((b) => b.lang === 'python');
    const plainBlock = { type: 'code', code: pyBlock.code, lang: '' };
    const stageOpts = {
      fontPt: 15, widthIn: LAYOUT.contentW, paddingIn: 0.04, background: '#FFFFFF', color: '#101828'
    };
    const pyRender = await renderer.renderFragment(richHtml.blockToHtml(pyBlock), stageOpts);
    const plainRender = await renderer.renderFragment(richHtml.blockToHtml(plainBlock), stageOpts);
    const pyStats = pixelStats(pyRender.png);
    const plainStats = pixelStats(plainRender.png);
    fs.writeFileSync(path.join(OUT_DIR, 'hint-code-python.png'), pyRender.png);
    fs.writeFileSync(path.join(OUT_DIR, 'hint-code-plain.png'), plainRender.png);
    ok('高亮代码图强彩色像素明显更多',
      pyStats.strongPct > plainStats.strongPct + 0.002,
      `strong: 高亮 ${(pyStats.strongPct * 100).toFixed(3)}% vs 纯文本 ${(plainStats.strongPct * 100).toFixed(3)}%`);
    ok('高亮代码图颜色数更多', pyStats.colors >= plainStats.colors + 3,
      `colors: ${pyStats.colors} vs ${plainStats.colors}`);
    const texBlock = codeBlocks.find((b) => b.lang === 'latex');
    const texRender = await renderer.renderFragment(richHtml.blockToHtml(texBlock), stageOpts);
    ok('LaTeX 代码块也被高亮', pixelStats(texRender.png).strongPct > 0.002,
      `strong ${(pixelStats(texRender.png).strongPct * 100).toFixed(3)}%`);

    // ---------------- [3] 渐进显示 ----------------
    console.log('\n[3] 渐进显示（overlay）');
    const s1 = richHtml.blocksToHtmlStep(step1.blocks, 1, 'hide');
    const s2 = richHtml.blocksToHtmlStep(step1.blocks, 2, 'hide');
    const s3 = richHtml.blocksToHtmlStep(step1.blocks, 3, 'hide');
    const r1 = await renderer.renderFragment(s1, stageOpts);
    const r2 = await renderer.renderFragment(s2, stageOpts);
    const r3 = await renderer.renderFragment(s3, stageOpts);
    const i1 = pixelStats(r1.png);
    const i2 = pixelStats(r2.png);
    const i3 = pixelStats(r3.png);
    ok('第 2 步墨迹多于第 1 步', i2.ink > i1.ink + 0.001,
      `${(i1.ink * 100).toFixed(2)}% → ${(i2.ink * 100).toFixed(2)}%`);
    ok('第 3 步墨迹多于第 2 步', i3.ink > i2.ink + 0.001,
      `${(i2.ink * 100).toFixed(2)}% → ${(i3.ink * 100).toFixed(2)}%`);
    const dim1 = pixelStats((await renderer.renderFragment(richHtml.blocksToHtmlStep(step1.blocks, 1, 'dim'), stageOpts)).png);
    ok('dim 模式第 1 步墨迹多于 hide 模式（未来内容灰显可见）', dim1.ink > i1.ink,
      `dim ${(dim1.ink * 100).toFixed(2)}% vs hide ${(i1.ink * 100).toFixed(2)}%`);
    ok('三步渲染图互不相同',
      !r1.png.equals(r2.png) && !r2.png.equals(r3.png));
    ok('所有步高宽一致（布局不跳动）',
      r1.heightPx === r2.heightPx && r2.heightPx === r3.heightPx,
      `${r1.heightPx}/${r2.heightPx}/${r3.heightPx}`);

    // ---------------- [4] 定理环境 ----------------
    console.log('\n[4] 定理环境渲染');
    const thm = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'env' && b.env === 'theorem');
    const proof = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'env' && b.env === 'proof');
    const thmRender = await renderer.renderFragment(richHtml.blockToHtml(thm), stageOpts);
    const thmStats = pixelStats(thmRender.png);
    fs.writeFileSync(path.join(OUT_DIR, 'hint-env-theorem.png'), thmRender.png);
    ok('定理块左侧色带（环绕彩色边框）存在', thmStats.leftBarRun > 0.2,
      `左侧最长彩色竖条占图高 ${(thmStats.leftBarRun * 100).toFixed(1)}%`);
    ok('定理块标题为强调色（存在强彩色像素）', thmStats.strongPct > 0.0005,
      `强彩色 ${(thmStats.strongPct * 100).toFixed(3)}%`);
    ok('定理块墨迹充足（标题+正文+公式）', thmStats.ink > 0.01,
      `墨迹 ${(thmStats.ink * 100).toFixed(2)}%`);
    const proofRender = await renderer.renderFragment(richHtml.blockToHtml(proof), stageOpts);
    ok('证明块渲染成功', pixelStats(proofRender.png).ink > 0.005);
  } catch (e) {
    failed++;
    console.error('E2E ERROR: ' + (e && e.stack));
  }

  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  renderer.dispose();
  app.exit(failed ? 1 : 0);
});
