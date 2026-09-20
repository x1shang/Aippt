// 判断 asar 是否被截断：逐段读取（头部/中部/尾部）看哪些能读
const asar = require('@electron/asar');
const target = process.argv[2];
const list = asar.listPackage(target).map((p) => p.replace(/\\/g, '/').replace(/^\//, ''));
console.log(`条目 ${list.length}，asar 大小 ${require('fs').statSync(target).size} 字节`);
const probes = [
  list[0], list[1], list[5],
  list[Math.floor(list.length * 0.25)],
  list[Math.floor(list.length * 0.5)],
  list[Math.floor(list.length * 0.75)],
  list[list.length - 1]
];
for (const p of probes) {
  try {
    const buf = asar.extractFile(target, p);
    console.log(`  OK   ${String(buf.length).padStart(9)}  ${p}`);
  } catch (e) {
    console.log(`  FAIL ${' '.repeat(9)}  ${p}  → ${e.message}`);
  }
}
const js = list.filter((p) => p.startsWith('node_modules/jszip/')).slice(0, 3);
console.log('jszip 头部条目示例：' + JSON.stringify(js));
for (const p of js) {
  try {
    const buf = asar.extractFile(target, p);
    console.log(`  OK   ${String(buf.length).padStart(9)}  ${p}`);
  } catch (e) {
    console.log(`  FAIL jszip ${p} → ${e.message}`);
  }
}
