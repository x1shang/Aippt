/**
 * test/make-overlay-demo.js （用 Electron 运行，开发/验收工具）
 * 生成三种渐进显示模式的验收稿：
 *   纯文本页（原生路径） + 公式页（图片路径），各 3 步
 * 用法：electron test\make-overlay-demo.js
 */
'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');

const MD = [
  '# 渐进显示验证',
  '',
  '## 纯文本分步',
  '',
  '- 第一处要点：甲',
  '- 第二处要点：乙 <2->',
  '- 第三处要点：丙 <3->',
  '',
  '> 每一步应比上一步多显示一条要点。',
  '',
  '## 公式分步',
  '',
  '- 首项 $a_1$',
  '- 次项 $a_2$ <2->',
  '- 末项 $a_3$ <3->',
  ''
].join('\n');

app.whenReady().then(async () => {
  const renderer = new RichRenderer();
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  try {
    await renderer.start();
    for (const mode of ['hide', 'dim', 'collapse']) {
      const outPath = path.join(outDir, `ovdemo-${mode}.pptx`);
      const res = await runGenerate(
        { mdContent: MD, styleId: 'tech-blue', mode: 'direct', outPath, overlayMode: mode },
        (m) => console.log(`  [${mode}] ${m}`),
        { renderer }
      );
      console.log(`${mode}: ${res.slideCount} 页 → ${outPath}  (期望 7 页：封面 + 3 步 + 3 步)`);
    }
  } catch (e) {
    console.error('ERR', e && e.stack);
  }
  renderer.dispose();
  app.exit(0);
});
