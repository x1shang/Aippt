/**
 * test/probe-animation.js
 * 生成一份"最小动画探针"pptx：一页标题 + 3 个要点（第 2、3 条要点击才出现），
 * 用来在真实放映器（WPS / PowerPoint）里验证「点击出现」动画是否真的生效。
 * 纯 Node，无需 Electron。
 *
 * 运行：node test/probe-animation.js
 * 产物：test/out/anim-probe.pptx
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { generatePptx } = require('../main/generator.js');

const OUT_DIR = path.join(__dirname, 'out');

const MD = [
  '# 动画探针',
  '',
  '> 本页用于验证：第 2、3 条要点应当在点击后逐条出现。',
  '',
  '## 点击出现测试',
  '',
  '- 【A】一开始就可见的条目',
  '- 【B】第一次点击后出现 <2->',
  '- 【C】第二次点击后出现 <3->'
].join('\n');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const parser = require('../shared/parser.js');
  const slides = parser.parseMarkdown(MD, { fileName: 'anim-probe.md' }).slides;

  // 变体 1：点击出现动画（被测对象）
  const p1 = path.join(OUT_DIR, 'anim-probe.pptx');
  const r1 = await generatePptx(slides, 'tech-blue', p1, { animation: true, footer: false, autoToc: false });
  console.log(`anim-probe.pptx      : ${r1.slideCount} 页（封面 + 1 页动画），动画页 ${r1.animation.slides}，目标 ${r1.animation.shapes} 个`);

  // 变体 2：展开成多页（对照组，任何放映器都该正确）
  const p2 = path.join(OUT_DIR, 'anim-probe-pages.pptx');
  const r2 = await generatePptx(slides, 'tech-blue', p2, { animation: false, footer: false, autoToc: false });
  console.log(`anim-probe-pages.pptx: ${r2.slideCount} 页（封面 + 3 步）`);
})();
