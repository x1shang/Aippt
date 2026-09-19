/**
 * test/style-tests.js
 * 样式插件（*.aippt-style.json）的单元测试：纯 Node，直接 `node test/style-tests.js`
 *   - 校验：必填字段、id 合法性、颜色格式、数值范围、对比度告警、未知字段告警
 *   - 规范化：缺省补齐、deco 派生、basedOn 继承
 *   - 合并：自定义不覆盖内置（除非 override），重名给告警
 *   - 目录扫描：读不到/坏文件不影响其它样式
 *   - 端到端：用插件样式真的生成一份 pptx，且颜色/字号确实变了
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const loader = require('../shared/style-loader.js');
const store = require('../main/style-store.js');
const { STYLES } = require('../shared/styles.js');
const { generatePptx } = require('../main/generator.js');
const parser = require('../shared/parser.js');

const OUT_DIR = path.join(__dirname, 'out');
const STYLE_DIR = path.join(__dirname, '..', 'styles');
const TMP_DIR = path.join(OUT_DIR, 'style-tmp');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const GOOD = {
  $schema: 'aippt-style/1',
  id: 'test-style',
  name: '测试样式',
  desc: '单元测试用',
  font: 'Microsoft YaHei',
  colors: { primary: '#123456', accent: '#abcdef', text: '#000000', bg: '#ffffff' },
  layout: { titleSize: 30, bodySize: 16, marginX: 1.2, navMax: 6 }
};

(async () => {
  console.log('\n[1] 校验');
  check('合法样式通过校验', () => assert.strictEqual(loader.validateStyle(GOOD).ok, true));
  check('缺少 id 报错', () => {
    const r = loader.validateStyle({ name: 'x' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('id')));
  });
  check('id 非法报错', () => assert.strictEqual(loader.validateStyle({ ...GOOD, id: '有中文' }).ok, false));
  check('颜色格式错误报错', () => assert.strictEqual(loader.validateStyle({ ...GOOD, colors: { primary: 'red' } }).ok, false));
  check('未知字段只告警不报错', () => {
    const r = loader.validateStyle({ ...GOOD, somethingElse: 1 });
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes('somethingElse')));
  });
  check('正文与背景对比度过低给告警', () => {
    const r = loader.validateStyle({ ...GOOD, colors: { text: '#F0F0F0', bg: '#FFFFFF' } });
    assert.ok(r.warnings.some((w) => w.includes('对比度')));
  });
  check('非对象直接判失败', () => assert.strictEqual(loader.validateStyle(null).ok, false));
  check('colors 字段本身不算未知字段', () => {
    const r = loader.validateStyle(GOOD);
    assert.ok(!r.warnings.some((w) => w.includes('colors')));
  });

  console.log('\n[2] 规范化与派生');
  check('缺省字段用基线补齐', () => {
    const s = loader.normalizeStyle({ id: 'x', name: 'X' });
    assert.ok(s.font && s.coverBg && s.deco1, '应有兜底值');
  });
  check('3 位色值归一化为 6 位大写', () => {
    const s = loader.normalizeStyle({ ...GOOD, colors: { primary: '#abc' } });
    assert.strictEqual(s.primary, '#AABBCC');
  });
  check('未给装饰色时从主色/点缀色派生', () => {
    const s = loader.normalizeStyle({ ...GOOD, colors: { primary: '#112233', accent: '#445566' } });
    assert.strictEqual(s.deco1, '#112233');
    assert.strictEqual(s.deco2, '#445566');
  });
  check('数值超出范围被夹紧', () => {
    const s = loader.normalizeStyle({ ...GOOD, layout: { titleSize: 999, marginX: 0.001 } });
    assert.strictEqual(s.layout.titleSize, loader.LIMITS.titleSize[1]);
    assert.strictEqual(s.layout.marginX, loader.LIMITS.marginX[0]);
  });
  check('派生浅色（tintLine/tintSoft）与深色底判定', () => {
    const s = loader.normalizeStyle({ ...GOOD, colors: { primary: '#1E5EFF', coverBg: '#0A1733' } });
    assert.ok(/^#[0-9A-F]{6}$/i.test(s.tintLine));
    assert.strictEqual(s.onDark, true);
  });
  check('basedOn 继承被指定样式的字段', () => {
    const base = STYLES.find((s) => s.id === 'minimal-gray');
    const s = loader.normalizeStyle({ id: 'x', name: 'X', colors: { primary: '#FF0000' } }, base);
    assert.strictEqual(s.primary, '#FF0000');
    assert.strictEqual(s.bg, base.bg, '未指定的字段应继承 basedOn');
  });

  console.log('\n[3] JSON 解析与合并');
  check('parseStyle：坏 JSON 给出可读错误', () => {
    const r = loader.parseStyle('{ not json');
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors[0].includes('JSON'));
  });
  check('parseStyle：合法 JSON 得到规范化样式', () => {
    const r = loader.parseStyle(JSON.stringify(GOOD));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.style.id, 'test-style');
    assert.strictEqual(r.style.layout.titleSize, 30);
  });
  check('合并：内置 + 自定义，顺序与数量正确', () => {
    const r = loader.mergeStyles(STYLES, [GOOD]);
    assert.strictEqual(r.styles.length, STYLES.length + 1);
    assert.strictEqual(r.styles[r.styles.length - 1].id, 'test-style');
  });
  check('合并：与内置重名默认跳过并告警（不静默覆盖）', () => {
    const r = loader.mergeStyles(STYLES, [{ ...GOOD, id: 'tech-blue' }]);
    assert.strictEqual(r.styles.length, STYLES.length);
    assert.ok(r.warnings.some((w) => w.includes('重名')));
    assert.strictEqual(r.styles.find((s) => s.id === 'tech-blue').custom, undefined);
  });
  check('合并：override=true 时允许覆盖', () => {
    const r = loader.mergeStyles(STYLES, [{ ...GOOD, id: 'tech-blue' }], { override: true });
    assert.strictEqual(r.styles.length, STYLES.length);
    assert.strictEqual(r.styles.find((s) => s.id === 'tech-blue').primary, '#123456');
  });
  check('合并：非法样式被跳过且不影响其它样式', () => {
    const r = loader.mergeStyles(STYLES, [GOOD, { id: 'bad id!', name: 'x' }]);
    assert.strictEqual(r.styles.length, STYLES.length + 1);
    assert.ok(r.warnings.some((w) => w.includes('bad id!')));
  });

  console.log('\n[4] 目录扫描 / 导入 / 导出');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, 'a.aippt-style.json'), JSON.stringify({ ...GOOD, id: 'dir-a', name: '目录 A' }));
  fs.writeFileSync(path.join(TMP_DIR, 'broken.aippt-style.json'), '{ 坏文件');
  fs.writeFileSync(path.join(TMP_DIR, 'b.aippt-style.json'), JSON.stringify({ ...GOOD, id: '非法 id 含空格', name: 'x' }));
  fs.writeFileSync(path.join(TMP_DIR, 'note.txt'), '忽略我');

  check('扫描：好的读进来，坏的给告警，别的扩展名忽略', () => {
    const r = store.loadStyles({ dirs: [TMP_DIR], builtin: STYLES });
    assert.ok(r.styles.some((s) => s.id === 'dir-a'));
    assert.ok(!r.styles.some((s) => String(s.id).includes('非法')), '非法 id 不应进入样式表');
    assert.ok(r.warnings.some((w) => w.includes('broken')), '坏文件应有告警');
    assert.ok(r.warnings.some((w) => w.includes('非法')), '非法 id 应给告警');
  });

  check('扫描：目录不存在时安静返回内置样式', () => {
    const r = store.loadStyles({ dirs: [path.join(TMP_DIR, 'nope')], builtin: STYLES });
    assert.strictEqual(r.styles.length, STYLES.length);
    assert.strictEqual(r.warnings.length, 0);
  });

  check('导入：坏样式拒绝安装', () => {
    const r = store.importStyle(path.join(TMP_DIR, 'broken.aippt-style.json'), path.join(TMP_DIR, 'user'));
    assert.strictEqual(r.ok, false);
  });
  check('导入 + 删除：用户目录里的样式可装可删', () => {
    const userDir = path.join(TMP_DIR, 'user');
    const r = store.importStyle(path.join(TMP_DIR, 'a.aippt-style.json'), userDir);
    assert.strictEqual(r.ok, true);
    assert.ok(fs.existsSync(r.path));
    const del = store.removeStyle('dir-a', userDir);
    assert.strictEqual(del.ok, true);
    assert.ok(!fs.existsSync(r.path));
  });
  check('删除：不能在用户目录里找到的（随包样式）拒绝删除', () => {
    const r = store.removeStyle('beamer-academic', path.join(TMP_DIR, 'user'));
    assert.strictEqual(r.ok, false);
  });
  check('导出：内置样式能导出成可再导入的 JSON', () => {
    const text = store.exportStyle(STYLES[0]);
    const back = loader.parseStyle(text);
    assert.strictEqual(back.ok, true);
    assert.strictEqual(back.style.id, STYLES[0].id);
    assert.strictEqual(back.style.primary, STYLES[0].primary.toUpperCase());
  });

  console.log('\n[5] 随包示例样式插件');
  check('styles/ 下三个示例都能通过校验', () => {
    const r = store.loadStyles({ dirs: [STYLE_DIR], builtin: STYLES });
    const ids = r.custom.map((s) => s.id).sort();
    assert.deepStrictEqual(ids, ['beamer-academic', 'midnight-neon', 'paper-ink']);
    assert.strictEqual(r.warnings.length, 0, `不应有告警：${r.warnings.join(';')}`);
  });

  console.log('\n[6] 端到端：插件样式真的改变了产物');
  const MD = '# 样式插件验收\n\n## 第一页\n\n- 要点与公式 $E=mc^2$\n\n## 第二页\n\n- 另一条要点\n';
  await checkAsync('用 beamer-academic 生成：字体/字号/边距来自插件', async () => {
    const slides = parser.parseMarkdown(MD, { fileName: 't.md' }).slides;
    const out = path.join(OUT_DIR, 'style-beamer-academic.pptx');
    const res = await generatePptx(slides, 'beamer-academic', out, {
      styles: store.loadStyles({ dirs: [STYLE_DIR], builtin: STYLES }).styles,
      animation: false, footer: false, autoToc: false
    });
    assert.ok(res.slideCount >= 3);
    const xml = require('jszip').file ? null : null;
    const zip = await require('jszip').loadAsync(fs.readFileSync(out));
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(/Latin Modern Roman|Cambria/.test(s1), '封面标题应使用插件指定的衬线字体');
    assert.ok(/0E2440/i.test(s1), '封面背景应为插件指定的深蓝');
  });

  await checkAsync('生成后 LAYOUT 被恢复（不会污染下一次生成）', async () => {
    const slides = parser.parseMarkdown(MD, { fileName: 't.md' }).slides;
    // 先用一个 marginX=1.2 的样式生成
    await generatePptx(slides, 'test-style', path.join(OUT_DIR, 'style-margin.pptx'), {
      styles: [...STYLES, loader.normalizeStyle(GOOD)], animation: false, footer: false, autoToc: false
    });
    // 再用内置样式生成，边距应回到 0.95
    const out2 = path.join(OUT_DIR, 'style-default-margin.pptx');
    await generatePptx(slides, 'tech-blue', out2, { animation: false, footer: false, autoToc: false });
    const { LAYOUT } = require('../main/generator.js');
    assert.ok(Math.abs(LAYOUT.marginX - 0.95) < 1e-6, `内置样式左边距应回到 0.95in，实际 ${LAYOUT.marginX}`);
    assert.ok(Math.abs(LAYOUT.contentW - 11.43) < 1e-6, '内容宽度也应恢复');
  });

  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  process.exit(failed ? 1 : 0);
})();

