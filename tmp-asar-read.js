// 从指定 asar 里真正读出文件，确认"列得出来但读不出"这种截断/损坏情况
const asar = require('@electron/asar');
const target = process.argv[2];
const files = [
  '/node_modules/jszip/package.json',
  '/node_modules/jszip/lib/index.js',
  '/node_modules/pptxgenjs/dist/pptxgen.cjs.js',
  '/main/main.js'
];
for (const f of files) {
  try {
    const buf = asar.extractFile(target, f);
    console.log(`  ${f.padEnd(48)} ${buf.length} 字节  ${buf.length > 0 ? 'OK' : '!! 空文件'}`);
  } catch (e) {
    console.log(`  ${f.padEnd(48)} !! 读取失败：${e.message}`);
  }
}
