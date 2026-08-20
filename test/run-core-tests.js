/**
 * test/run-core-tests.js
 * 核心逻辑测试（纯 Node，无需 Electron）：
 *   1. Markdown 解析器（标题/列表/备注/代码块/分页）
 *   2. AI 客户端（mock OpenAI 兼容服务：成功 / 400 降级重试 / 围栏 JSON）
 *   3. PPTX 生成器（6 套样式 + zip 结构校验 + 备注页校验）
 *   4. 生成主流程（直接排版 / AI 模式 / 错误处理）
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { parseMarkdown, inlineToRuns, toPlainText } = require('../shared/parser.js');
const { STYLES } = require('../shared/styles.js');
const { enhanceOutline, extractJson, testConnection, normalizeSlides } = require('../main/ai.js');
const { generatePptx } = require('../main/generator.js');
const { runGenerate } = require('../main/generate-flow.js');

const OUT_DIR = path.join(__dirname, 'out');
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// ---------- mock 服务 ----------
function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function portOf(server) {
  return server.address().port;
}

const SAMPLE_MD = fs.readFileSync(path.join(__dirname, 'sample.md'), 'utf8');
const SAMPLE_OUTLINE = {
  slides: [
    { title: 'AI 写作', subtitle: '让创作更高效', bullets: ['要点一', '要点二'], notes: ['原始备注'], layout: 'cover' },
    { title: '方案', bullets: ['能力 A', '能力 B'], notes: ['原始备注2'], layout: 'content' }
  ]
};

// ================= 1. 解析器 =================
async function testParser() {
  console.log('\n[1] Markdown 解析器');
  const parsed = parseMarkdown(SAMPLE_MD);
  const s = parsed.slides;

  check('共 7 页幻灯片', () => assert.strictEqual(s.length, 7));
  check('第 1 页为封面（含副标题）', () => {
    assert.strictEqual(s[0].layout, 'cover');
    assert.strictEqual(s[0].title, '让 AI 成为你的创作伙伴');
    assert.ok(s[0].subtitle.includes('产品发布演示'));
  });
  check('7 条备注全部解析', () => assert.strictEqual(parsed.stats.notes, 7));
  check('封面备注归属封面', () => assert.ok(s[0].notes.some((n) => n.includes('开场注意'))));
  check('备注不出现在要点中', () => {
    const allBullets = s.flatMap((x) => x.bullets.map((b) => b.text)).join('\n');
    assert.ok(!allBullets.includes('开场注意'));
  });
  check('嵌套列表层级', () => {
    const nested = s[2].bullets.find((b) => b.text.includes('语气'));
    assert.strictEqual(nested.level, 1);
  });
  check('代码块', () => {
    assert.ok(s[3].bullets.some((b) => b.code && b.text.includes('模型层')));
  });
  check('序号列表', () => {
    assert.strictEqual(s[5].bullets.length, 3);
    assert.ok(s[5].bullets[0].text.includes('2025 Q3'));
  });
  check('"---" 不产生空页', () => {
    assert.strictEqual(s.filter((x) => !x.title && !x.bullets.length).length, 0);
  });
  check('结尾页启发式', () => assert.strictEqual(s[6].layout, 'end'));
  check('章节页启发式（无正文的标题页）', () => {
    const r = parseMarkdown('# 主标题\n\n## 第一章\n\n## 第二章\n- 要点');
    assert.strictEqual(r.slides[1].layout, 'section');
    assert.strictEqual(r.slides[2].layout, 'content');
  });
  check('结尾页启发式仅限末页', () => {
    const r = parseMarkdown('# 主\n\n## 感谢数据支持\n- 数据\n\n## 收尾\n- 内容');
    assert.strictEqual(r.slides[1].layout, 'content');
  });
  check('inlineToRuns：加粗/代码/斜体', () => {
    const runs = inlineToRuns('**智能起草**：命中率 `90%`，*很快*');
    const plain = runs.map((r) => r.text).join('');
    assert.ok(runs.some((r) => r.options.bold && r.text === '智能起草'));
    assert.ok(runs.some((r) => r.options.fontFace === 'Consolas' && r.text === '90%'));
    assert.ok(runs.some((r) => r.options.italic && r.text === '很快'));
    assert.strictEqual(plain, '智能起草：命中率 90%，很快');
  });
  check('toPlainText 剥离标记', () => assert.strictEqual(toPlainText('**a** `b` *c*'), 'a b c'));
  check('空内容返回空', () => assert.strictEqual(parseMarkdown('').slides.length, 0));
}

// ================= 2. AI 客户端 =================
async function testAi() {
  console.log('\n[2] AI 客户端（mock 服务）');

  await checkAsync('成功：返回合法 JSON，备注合并', async () => {
    const server = await startMockServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          slides: [
            { title: 'AI 写作', subtitle: '让创作更高效', bullets: ['要点一', '要点二'], layout: 'cover', notes: ['AI 补充备注'] },
            { title: '方案', bullets: ['能力 A', '能力 B'], layout: 'two-column', columns: [{ heading: 'A', items: ['a1'] }] }
          ]
        }) } }] }));
      });
    });
    try {
      const slides = await enhanceOutline(
        { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'test-key', model: 'mock-model' },
        { mdText: '# x', outline: SAMPLE_OUTLINE, styleName: '科技蓝' }
      );
      assert.strictEqual(slides.length, 2);
      assert.strictEqual(slides[0].layout, 'cover');
      assert.strictEqual(slides[1].layout, 'two-column');
      assert.strictEqual(slides[1].columns.length, 1);
      // 原始备注必须保留，AI 备注追加
      assert.deepStrictEqual(slides[0].notes, ['原始备注', 'AI 补充备注']);
    } finally {
      server.close();
    }
  });

  await checkAsync('400 → 自动降级重试（去掉 response_format）', async () => {
    const calls = [];
    const server = await startMockServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        calls.push({ hasRF: !!parsed.response_format });
        if (calls.length === 1) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'response_format not supported' } }));
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ message: { content: '{"slides":[{"title":"T","bullets":["b"],"layout":"content"}]}' } }] }));
        }
      });
    });
    try {
      const slides = await enhanceOutline(
        { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' },
        { mdText: '# x', outline: { slides: SAMPLE_OUTLINE.slides }, styleName: '' }
      );
      assert.strictEqual(slides.length, 1);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].hasRF, true);
      assert.strictEqual(calls[1].hasRF, false);
    } finally {
      server.close();
    }
  });

  await checkAsync('围栏 JSON 解析', async () => {
    const server = await startMockServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: '好的，以下是结果：\n```json\n{"slides":[{"title":"T","bullets":["b"]}]}\n```\n希望对你有帮助' } }] }));
      });
    });
    try {
      const slides = await enhanceOutline(
        { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' },
        { mdText: '# x', outline: { slides: [{ title: 'T', bullets: ['b'], notes: [] }] }, styleName: '' }
      );
      assert.strictEqual(slides[0].title, 'T');
    } finally {
      server.close();
    }
  });

  await checkAsync('测试连接', async () => {
    const server = await startMockServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
      });
    });
    try {
      const r = await testConnection({ baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' });
      assert.strictEqual(r.ok, true);
      assert.ok(r.latencyMs >= 0);
    } finally {
      server.close();
    }
  });

  check('extractJson 容错', () => {
    assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(extractJson('前缀\n```json\n{"b":2}\n```\n后缀'), { b: 2 });
    assert.deepStrictEqual(extractJson('x {"c": [1,2]} y'), { c: [1, 2] });
    assert.throws(() => extractJson('完全不是 JSON'));
  });

  check('normalizeSlides 首页强制封面 + 备注保留', () => {
    const out = normalizeSlides(
      [{ title: 'T', bullets: ['b'], layout: 'content' }],
      [{ title: 'T', bullets: ['b'], notes: ['n1'] }]
    );
    assert.strictEqual(out[0].layout, 'cover');
    assert.deepStrictEqual(out[0].notes, ['n1']);
  });
}

// ================= 3. PPTX 生成器 =================
async function testGenerator() {
  console.log('\n[3] PPTX 生成器');
  const JSZip = require('jszip');
  const parsed = parseMarkdown(SAMPLE_MD);

  for (const style of STYLES) {
    const outPath = path.join(OUT_DIR, `sample-${style.id}.pptx`);
    await checkAsync(`样式「${style.name}」生成成功`, async () => {
      const count = await generatePptx(parsed.slides, style.id, outPath);
      assert.strictEqual(count, parsed.slides.length);
      assert.ok(fs.statSync(outPath).size > 10000, '文件过小');
    });
  }

  await checkAsync('zip 结构：slide 与 notesSlide 齐全', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(OUT_DIR, 'sample-tech-blue.pptx')));
    const names = Object.keys(zip.files);
    assert.ok(names.includes('[Content_Types].xml'));
    assert.ok(names.includes('ppt/presentation.xml'));
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert.strictEqual(slides.length, 7, '应有 7 张幻灯片');
    const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    assert.strictEqual(notes.length, 7, '每页都有备注（样本每页都有 > 行）');
    const notes1 = await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
    assert.ok(notes1.includes('开场注意'), '备注内容写入');
    const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(slide1.includes('0A1733'), '封面背景色写入');
  });

  await checkAsync('无备注时不写入备注文本', async () => {
    const outPath = path.join(OUT_DIR, 'no-notes.pptx');
    const slides = [
      { title: 'A', bullets: ['x'], notes: [], layout: 'cover' },
      { title: 'B', bullets: ['y'], notes: [], layout: 'content' }
    ];
    await generatePptx(slides, 'tech-blue', outPath);
    const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    assert.strictEqual(notes.length, 2, 'pptxgenjs 始终生成备注页骨架');
    for (const n of notes) {
      const xml = await zip.file(n).async('string');
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      // 除页码占位符外不应有任何备注文本
      const real = texts.filter((t) => t.trim() && !/^\d+$/.test(t.trim()));
      assert.strictEqual(real.length, 0, `备注页 ${n} 不应包含备注文本`);
    }
  });
}

// ================= 4. 生成主流程 =================
async function testFlow() {
  console.log('\n[4] 生成主流程');

  await checkAsync('直接排版模式', async () => {
    const outPath = path.join(OUT_DIR, 'flow-direct.pptx');
    const logs = [];
    const res = await runGenerate(
      { mdContent: SAMPLE_MD, styleId: 'business-gold', mode: 'direct', outPath },
      (m) => logs.push(m)
    );
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.slideCount, 7);
    assert.ok(fs.existsSync(outPath));
    assert.ok(logs.length >= 2);
  });

  await checkAsync('AI 模式（mock）', async () => {
    const server = await startMockServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          slides: [
            { title: '封面', subtitle: 'AI 生成', bullets: [], layout: 'cover' },
            { title: '页2', bullets: ['内容'], layout: 'content' }
          ]
        }) } }] }));
      });
    });
    try {
      const outPath = path.join(OUT_DIR, 'flow-ai.pptx');
      const res = await runGenerate(
        { mdContent: SAMPLE_MD, styleId: 'fresh-green', mode: 'ai', outPath, apiConfig: { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' } },
        () => {}
      );
      assert.strictEqual(res.slideCount, 2);
      assert.ok(fs.existsSync(outPath));
    } finally {
      server.close();
    }
  });

  await checkAsync('错误处理：空内容', async () => {
    await assert.rejects(
      () => runGenerate({ mdContent: '', styleId: 'tech-blue', mode: 'direct', outPath: path.join(OUT_DIR, 'x.pptx') }, () => {}),
      /Markdown 内容为空/
    );
  });
}

// ================= 主入口 =================
(async () => {
  await testParser();
  await testAi();
  await testGenerator();
  await testFlow();
  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  process.exit(failed ? 1 : 0);
})();
