/**
 * test/make-style-samples.js （用 Electron 运行）
 * 用**同一份内容**、每套样式各生成一份 pptx，用来横向对比样式插件效果。
 *   产物：test/out/style-<id>.pptx（内置 6 套 + styles/ 下的样式插件）
 * 运行：node_modules\electron\dist\electron.exe test\make-style-samples.js
 */
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const { RichRenderer } = require('../main/rich-renderer.js');
const { runGenerate } = require('../main/generate-flow.js');
const store = require('../main/style-store.js');
const { STYLES } = require('../shared/styles.js');

const OUT_DIR = path.join(__dirname, 'out');

// 一页内容覆盖：标题栏、列表、公式（原生 OMML）、表格、提示框、分步
const MD = [
  '# 样式插件对比',
  '同一份内容，不同样式',
  '',
  '## 版式与配色',
  '',
  '- 一级要点：标题色、正文色、强调色',
  '  - 二级要点：缩进与字号',
  '- 行内公式 $E = mc^2$ 与 $a_n \\to 0$',
  '',
  '$$',
  '\\int_0^1 x^2 \\,\\mathrm{d}x = \\frac{1}{3}',
  '$$',
  '',
  '## 表格与提示框',
  '',
  '| 项目 | 数值 |',
  '| :--- | ---: |',
  '| A | 1 |',
  '| B | 2 |',
  '表：样式对比用表',
  '',
  '> [!tip] 提示框',
  '> - 提示框配色同样来自样式',
  '',
  '## 分步',
  '',
  '- 第一步',
  '- 第二步 <2->',
  '',
  '## 谢谢观看'
].join('\n');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const loaded = store.loadStyles({
    dirs: [path.join(__dirname, '..', 'styles')],
    builtin: STYLES
  });
  if (loaded.warnings.length) {
    console.log('样式告警：');
    for (const w of loaded.warnings) console.log('  ⚠ ' + w);
  }
  console.log(`共 ${loaded.styles.length} 套样式（内置 ${STYLES.length} + 插件 ${loaded.styles.length - STYLES.length}）`);

  const renderer = new RichRenderer({ scale: 2 });
  const mdPath = path.join(OUT_DIR, 'style-sample.md');
  fs.writeFileSync(mdPath, MD, 'utf8');

  for (const st of loaded.styles) {
    const out = path.join(OUT_DIR, `style-${st.id}.pptx`);
    const res = await runGenerate(
      {
        mdContent: MD,
        mdPath,
        styleId: st.id,
        mode: 'direct',
        outPath: out,
        formulaMode: 'omml-fallback',
        animation: true,
        autoToc: false,
        footer: true
      },
      () => {},
      { renderer, styles: loaded.styles }
    );
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`  ✓ style-${st.id}.pptx  ${res.slideCount} 页  ${kb} KB  ${st.custom ? '（样式插件）' : ''} ${st.name}`);
  }
  renderer.dispose();
  app.exit(0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  main().catch((e) => { console.error('生成样式样张失败：', e); app.exit(1); });
});
