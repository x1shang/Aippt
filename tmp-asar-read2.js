// 正确路径格式读 asar 内文件（asar 内部路径不带前导斜杠）
const asar = require('@electron/asar');
const target = process.argv[2];
const files = [
  'node_modules/jszip/package.json',
  'node_modules/jszip/lib/index.js',
  'node_modules/pptxgenjs/dist/pptxgen.cjs.js',
  'main/main.js',
  'package.json'
];
for (const f of files) {
  try {
    const buf = asar.extractFile(target, f);
    console.log(`  ${f.padEnd(46)} ${buf.length} 字节  ${buf.length > 0 ? 'OK' : '!! 空'}`);
  } catch (e) {
    console.log(`  ${f.padEnd(46)} !! ${e.message}`);
  }
}
