/**
 * test/make-demo.js （用 Electron 运行）
 * 把 examples/beamer-demo.md 生成成 test/out/beamer-demo.pptx，用来目视验收 v2.2 的全部能力。
 * 运行：node_modules\electron\dist\electron.exe test\make-demo.js
 */
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');

const MD = path.join(__dirname, '..', 'examples', 'beamer-demo.md');
const SHOWCASE = path.join(__dirname, '..', 'examples', 'showcase.md');
const OUT_DIR = path.join(__dirname, 'out');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const renderer = new RichRenderer({ scale: 2 });
  const modes = [
    { formulaMode: 'omml-fallback', animation: true, name: 'beamer-demo.pptx', desc: '默认：原生公式 + 图片兜底 + 点击动画' },
    { formulaMode: 'omml', animation: false, name: 'beamer-demo-omml.pptx', desc: '仅原生公式 + 分步展开成多页' },
    { formulaMode: 'image', animation: false, name: 'beamer-demo-image.pptx', desc: '传统：整页渲染成图片（任何客户端一致）' }
  ];
  for (const m of modes) {
    const out = path.join(OUT_DIR, m.name);
    const logs = [];
    const res = await runGenerate(
      {
        mdContent: fs.readFileSync(MD, 'utf8'),
        mdPath: MD,
        styleId: 'tech-blue',
        mode: 'direct',
        outPath: out,
        formulaMode: m.formulaMode,
        animation: m.animation,
        autoToc: true,
        footer: true
      },
      (s) => logs.push(s),
      { renderer }
    );
    console.log(`\n=== ${m.desc} → ${m.name}（${res.slideCount} 页）===`);
    for (const l of logs) console.log('  · ' + l);
  }
  // 内置示例（界面「载入示例 Markdown」用的就是它）
  const scOut = path.join(OUT_DIR, 'showcase.pptx');
  const scLogs = [];
  const scRes = await runGenerate(
    {
      mdContent: fs.readFileSync(SHOWCASE, 'utf8'),
      mdPath: SHOWCASE,
      styleId: 'tech-blue',
      mode: 'direct',
      outPath: scOut,
      formulaMode: 'omml-fallback',
      animation: true,
      autoToc: true,
      footer: true
    },
    (s) => scLogs.push(s),
    { renderer }
  );
  console.log(`\n=== 内置示例 showcase.md → showcase.pptx（${scRes.slideCount} 页）===`);
  for (const l of scLogs) console.log('  · ' + l);

  renderer.dispose();
  app.exit(0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  main().catch((e) => { console.error('生成演示稿失败：', e); app.exit(1); });
});



