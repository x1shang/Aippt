/**
 * test/package-tests.js
 * 打包与启动健壮性检查（纯 Node，直接 `node test/package-tests.js`）
 *
 * 背景：便携版 exe 会把程序解压到 %TEMP% 再运行。曾经因为 electron-builder 的
 * smartUnpack 把 jszip 单独解包到 app.asar.unpacked，一旦解压不完整就会
 * "Cannot find module 'jszip'" 直接崩。这里把几条经验固化成断言，防止回归。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const pkg = require('../package.json');
const ROOT = path.join(__dirname, '..');

console.log('\n[1] 运行依赖自检');
check('运行时依赖都能 require 到', () => {
  const deps = ['pptxgenjs', 'jszip', 'katex', 'highlight.js'];
  const missing = deps.filter((m) => {
    try { require.resolve(m); return false; } catch (e) { return true; }
  });
  assert.deepStrictEqual(missing, [], '缺少依赖：' + missing.join(','));
});
check('jszip 被显式声明为直接依赖（main/pptx-post.js 直接用）', () => {
  assert.ok(pkg.dependencies.jszip, 'package.json dependencies 里应有 jszip');
});

console.log('\n[2] 打包配置');
check('关掉 smartUnpack：所有依赖留在 app.asar 内，不生成 app.asar.unpacked', () => {
  assert.ok(pkg.build && pkg.build.asar, 'build.asar 配置缺失');
  assert.strictEqual(pkg.build.asar.smartUnpack, false,
    'smartUnpack 必须为 false，否则 jszip 之类的纯 JS 依赖可能被单独解包，解压不完整就崩');
});
check('随包资源都在 files 白名单里（main/renderer/shared/assets/examples/styles）', () => {
  const files = pkg.build.files || [];
  for (const f of ['main/**/*', 'renderer/**/*', 'shared/**/*', 'assets/**/*', 'examples/**/*', 'styles/**/*']) {
    assert.ok(files.includes(f), `files 白名单缺少 ${f}`);
  }
});
check('示例与样式文件确实存在于仓库里', () => {
  for (const p of ['examples/beamer-demo.md', 'examples/showcase.md', 'examples/references.bib',
    'styles/beamer-academic.aippt-style.json', 'styles/midnight-neon.aippt-style.json',
    'styles/paper-ink.aippt-style.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `缺少文件 ${p}`);
  }
});
check('便携版解压目录名带版本号（新版本不复用旧残留）', () => {
  const name = (pkg.build.portable && pkg.build.portable.unpackDirName) || '';
  assert.ok(name.includes('${version}'), `unpackDirName 应含 \${version}，实际 "${name}"`);
});

console.log('\n[3] 启动失败时的可读提示');
check('main.js 里存在启动自检与友好报错（不再是裸 Uncaught Exception）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  assert.ok(src.includes('findMissingDeps'), '缺少依赖自检函数');
  assert.ok(src.includes('startupErrorText'), '缺少错误说明函数');
  assert.ok(src.includes('AIPPT 无法启动'), '缺少面向用户的错误标题');
  assert.ok(/showErrorBox/.test(src), '应弹出错误框而不是直接崩');
  assert.ok(src.includes("process.execPath"), '提示里应给出临时解压目录');
});
check('启动自检在创建窗口之前执行', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  const i = src.indexOf('if (startupError)');
  const j = src.indexOf('createWindow();', src.indexOf('app.whenReady'));
  assert.ok(i > 0 && j > 0 && i < j, '应先检查 startupError 再 createWindow');
});

console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
process.exit(failed ? 1 : 0);
