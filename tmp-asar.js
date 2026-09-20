// 用 @electron/asar 正确列出 app.asar 里的顶层内容，确认依赖是否真的打进去了
const path = require('path');
let asar;
try {
  asar = require('@electron/asar');
} catch (e) {
  try { asar = require('asar'); } catch (e2) { console.log('找不到 asar 模块：' + e.message); process.exit(1); }
}
const target = process.argv[2] || path.join(__dirname, 'dist', 'win-unpacked', 'resources', 'app.asar');
const list = asar.listPackage(target);
console.log('asar: ' + target);
console.log('条目总数: ' + list.length);
const nm = list.filter((p) => p.replace(/\\/g, '/').startsWith('/node_modules/'));
const tops = new Set(nm.map((p) => p.replace(/\\/g, '/').split('/')[2]));
console.log('node_modules 顶层包（' + tops.size + '）: ' + [...tops].sort().join(', '));
for (const want of ['jszip', 'pptxgenjs', 'katex', 'highlight.js', 'image-size']) {
  const files = nm.filter((p) => p.replace(/\\/g, '/').startsWith('/node_modules/' + want + '/'));
  console.log(`  ${want.padEnd(14)} ${files.length ? files.length + ' 个文件' : '!! 缺失'}`);
}
const app = list.filter((p) => !p.replace(/\\/g, '/').startsWith('/node_modules/'));
console.log('应用文件: ' + app.slice(0, 12).join(' '));
