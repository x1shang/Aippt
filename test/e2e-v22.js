/**
 * test/e2e-v22.js  （用 Electron 运行，真实离屏渲染器）
 * v2.2 端到端验证：
 *   1. 公式写进 pptx 的是 PowerPoint 原生公式对象（a14:m + m:oMath/oMathPara）
 *   2. 块级公式带 mc:AlternateContent 图片兜底（WPS/LibreOffice 也能看见），兜底图有墨迹
 *   3. 点击出现动画：单页 + p:timing + 目标形状真实存在
 *   4. 目录页页码回填、页脚章节导航、参考文献页、算法块
 *   5. 任何产物都不残留 ⟦MATH:⟧ / ⟦ANIM:⟧ / ⟪T⟫ / ⟪P:⟧ / w: 命名空间
 *
 * 运行：node_modules\electron\dist\electron.exe test\e2e-v22.js
 */
'use strict';

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');

const OUT_DIR = path.join(__dirname, 'out');
const OUT = path.join(OUT_DIR, 'v22-e2e.pptx');
const OUT_IMG = path.join(OUT_DIR, 'v22-e2e-image.pptx');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}

function inkRatio(buf) {
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

const MD = `# AIPPT v2.2 端到端验收

本文档用于验证：可编辑公式、点击动画、目录导航、文献引用、算法伪代码。

## 引言

由 \\cite{zhang2020} 与 \\cite[p.12]{li2021} 可知，见 \\eqref{eq:euler}。

$$
e^{i\\pi} + 1 = 0 \\label{eq:euler}
$$

## 公式矩阵

$$
A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix},\\quad
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

分段函数 $f_n$ 与行内 $E = mc^2$ 也在同一页里：

$$
f_n = \\begin{cases}
  0 & n = 0 \\\\
  r\\, f_{n-1} + a & \\text{其他}
\\end{cases}
$$

## 分步讲解

- 第一步：先看整体结构
- 第二步：再看局部细节 <2->
- 第三步：最后给结论 <3->

## 算法

\\begin{algorithm}[快速排序]\\label{alg:qsort}
\\Require 数组 $A$，下标 $p, r$
\\Ensure $A$ 已升序排列
\\If{$p < r$}
  \\State $q \\gets \\Call{Partition}{A, p, r}$
  \\State \\Call{QuickSort}{A, p, q-1}
  \\State \\Call{QuickSort}{A, q+1, r}
\\EndIf
\\end{algorithm}

算法 \\ref{alg:qsort} 的平均复杂度为 $O(n\\log n)$。

## 结论

可编辑公式与点击动画都已就绪。
`;

const BIB = `@article{zhang2020,
  author = {张三 and 李四},
  title = {一个 {GPU} 加速的数值实验},
  journal = {计算机学报},
  year = {2020}
}
@inproceedings{li2021,
  author = {Li, Wei and Wang, Fang and Zhao, Min},
  title = {Fast Sorting Revisited},
  booktitle = {Proc. of ACM SIGMOD},
  year = {2021}
}
`;

async function readSlide(zip, i) {
  return zip.file(`ppt/slides/slide${i}.xml`).async('string');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const renderer = new RichRenderer({ scale: 2 });

  // ---------- 1. 生成（默认：原生公式 + 图片兜底 + 点击动画 + 目录 + 页脚 + 文献） ----------
  const logs = [];
  const res = await runGenerate(
    {
      mdContent: MD,
      mdPath: path.join(OUT_DIR, 'v22-e2e.md'),
      styleId: 'tech-blue',
      mode: 'direct',
      outPath: OUT,
      formulaMode: 'omml-fallback',
      animation: true,
      autoToc: true,
      footer: true,
      bibText: BIB
    },
    (m) => logs.push(m),
    { renderer }
  );
  console.log(`\n=== 生成完成：${res.slideCount} 页 ===`);
  for (const l of logs) console.log('  · ' + l);

  const zip = await JSZip.loadAsync(fs.readFileSync(OUT));
  const media = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n));

  let a14 = 0, para = 0, alt = 0, blip = 0, timing = 0, click = 0, leftover = 0, wordNs = 0;
  const xmls = [];
  for (let i = 1; i <= res.slideCount; i++) {
    const x = await readSlide(zip, i);
    xmls.push(x);
    a14 += (x.match(/<a14:m[\s>]/g) || []).length;
    para += (x.match(/<m:oMathPara[\s>]/g) || []).length;
    alt += (x.match(/<mc:AlternateContent/g) || []).length;
    blip += (x.match(/<a:blip r:embed="rIdA14_/g) || []).length;
    timing += (x.match(/<p:timing>/g) || []).length;
    click += (x.match(/nodeType="clickEffect"/g) || []).length;
    if (/⟦MATH:|⟦ANIM:|⟪[TP]:?/.test(x)) leftover++;
    if (/<w:/.test(x)) wordNs++;
  }

  console.log('\n=== 结构 ===');
  ok('公式已写成原生 OMML（a14:m ≥ 5 处）', a14 >= 5, `实际 ${a14}`);
  ok('块级公式用 m:oMathPara', para >= 3, `实际 ${para}`);
  ok('块级公式带 mc:AlternateContent 兜底', alt >= 3 && alt === blip, `AlternateContent=${alt} blip=${blip}`);
  ok('兜底图已写入 media', media.length >= 3, `media=${media.length}：${media.slice(0, 6).join(',')}`);
  ok('点击出现动画已写入（p:timing + clickEffect）', timing >= 1 && click >= 2, `timing=${timing} click=${click}`);
  ok('无残留占位符/标记/哨兵', leftover === 0, `${leftover} 页有残留`);
  ok('无 Word 命名空间元素', wordNs === 0, `${wordNs} 页含 w:`);

  // 动画目标必须是真实存在的形状
  let spidOk = true;
  let spidDetail = '';
  for (const x of xmls) {
    const targets = [...x.matchAll(/<p:spTgt spid="(\d+)"/g)].map((m) => m[1]);
    if (!targets.length) continue;
    const ids = [...x.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    for (const t of targets) if (!ids.includes(t)) { spidOk = false; spidDetail = `spid=${t} 不存在`; }
  }
  ok('动画目标形状都真实存在（避免 PowerPoint 报修复）', spidOk, spidDetail);

  // 回归：被点出来的形状里必须**仍然有正文**（曾经被跨 run 的正则连正文一起删掉，
  // 症状是"能点击但什么都不出现"）
  let animTextOk = true;
  const animTextDetail = [];
  for (const x of xmls) {
    const targets = [...x.matchAll(/<p:spTgt spid="(\d+)"/g)].map((m) => m[1]);
    if (!targets.length) continue;
    // 逐个切 <p:sp>…</p:sp>（不要用带负向断言的嵌套量词，会灾难性回溯把测试卡死）
    const spBlocks = [...x.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
    for (const t of targets) {
      const sp = spBlocks.find((b) => b.includes(`<p:cNvPr id="${t}"`)) || '';
      const texts = [...sp.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((mm) => mm[1]).join('');
      if (!texts.trim()) { animTextOk = false; animTextDetail.push(`spid=${t} 无文字`); }
      if (/⟦ANIM:/.test(sp)) { animTextOk = false; animTextDetail.push(`spid=${t} 残留标记`); }
    }
  }
  ok('被"点出来"的形状里保留了正文（不是空文本框）', animTextOk, animTextDetail.join(';'));
  ok('bldLst 构建列表存在（缺它放映器点得动但不出现）', /<p:bldLst>/.test(xmls.join('')));

  // 目录页码回填 + 页脚（注意：封面副标题里也可能出现"目录"二字，用"共 N 节"定位目录页）
  const tocPage = xmls.find((x) => /共 \d+ 节/.test(x));
  ok('目录页存在', !!tocPage);
  if (tocPage) {
    ok('目录页码已回填（无 ⟪P:n⟧ 残留）', !/⟪P:\d+⟧/.test(tocPage));
    ok('目录列出了章节标题', /引言/.test(tocPage) && /算法/.test(tocPage));
  }
  const contentPage = xmls[2] || '';
  ok('页脚显示真实页码分母', new RegExp(`/ ${res.slideCount}`).test(contentPage), '未找到页码');
  ok('页脚显示当前章节名', /引言/.test(contentPage));

  // 算法 / 文献 / 交叉引用
  const all = xmls.join('');
  const richPageImages = media.filter((n) => !/a14math/.test(n)).length;
  ok('算法页走整页图片渲染（不残留 LaTeX 源码）',
    richPageImages >= 1 && !/\\State|\\Require|\\end\{algorithm\}|\\If\{/.test(all),
    `整页图=${richPageImages} 残留=${/\\State|\\Require/.test(all)}`);
  ok('文献引用换成编号 [1]', /\[1\]/.test(all));
  ok('自动追加参考文献页', /参考文献/.test(all) && /计算机学报/.test(all));
  ok('交叉引用已解析（e^{i\\pi} 段落无 ?? 残留）', !/\?\?/.test(all.replace(/参考/g, '')), '有未解析引用');

  // ---------- 2. 兜底图有墨迹（不是白图） ----------
  console.log('\n=== 兜底图墨迹 ===');
  let checked = 0;
  for (const name of media.filter((n) => /a14math/.test(n)).slice(0, 4)) {
    const buf = await zip.file(name).async('nodebuffer');
    const ratio = inkRatio(buf);
    ok(`${path.basename(name)} 有墨迹（${(ratio * 100).toFixed(2)}%）`, ratio > 0.002, `ink=${ratio}`);
    checked++;
  }
  ok('至少检查了 1 张兜底图', checked >= 1);

  // ---------- 3. 图片模式回归（老路径仍可用） ----------
  const res2 = await runGenerate(
    {
      mdContent: MD,
      mdPath: path.join(OUT_DIR, 'v22-e2e.md'),
      styleId: 'tech-blue',
      mode: 'direct',
      outPath: OUT_IMG,
      formulaMode: 'image',
      animation: false,
      autoToc: false,
      footer: false,
      bibText: BIB
    },
    () => {},
    { renderer }
  );
  const zip2 = await JSZip.loadAsync(fs.readFileSync(OUT_IMG));
  const pngs = Object.keys(zip2.files).filter((n) => /^ppt\/media\/[^/]+\.png$/.test(n));
  let anyOmml = false;
  for (let i = 1; i <= res2.slideCount; i++) {
    if (/<a14:m[\s>]/.test(await readSlide(zip2, i))) anyOmml = true;
  }
  console.log('\n=== 图片模式回归 ===');
  ok('图片模式：整页出图（media ≥ 3）', pngs.length >= 3, `media=${pngs.length}`);
  ok('图片模式：不含 OMML', !anyOmml);
  ok('图片模式：页数正常', res2.slideCount >= 6, `${res2.slideCount} 页`);

  renderer.dispose();
  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  console.log(`产物：${OUT}`);
  app.exit(failed ? 1 : 0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  main().catch((e) => { console.error('端到端失败：', e); app.exit(1); });
});
