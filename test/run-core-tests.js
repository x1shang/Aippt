/**
 * test/run-core-tests.js  (v2)
 * 核心逻辑测试（纯 Node，无需 Electron）：
 *   [1] 解析器 v1 语义（标题/列表/备注/代码块/分页）
 *   [2] 解析器 v2：数学公式 / 表格 / Obsidian 提示框 / 图片 / 高亮
 *   [3] LaTeX 兼容层（KaTeX 不支持的宏 → 等价写法）
 *   [4] HTML 片段生成（rich-html）
 *   [5] AI 客户端 + ⟦B数字⟧ 占位保护（mock OpenAI 兼容服务）
 *   [6] 生成器（图片嵌入 / 富内容分页 / 备注页）
 *   [7] 生成主流程
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const parser = require('../shared/parser.js');
const { STYLES } = require('../shared/styles.js');
const { compatTex } = require('../shared/latex-compat.js');
const richHtml = require('../shared/rich-html.js');
const ov = require('../shared/overlay.js');
const ai = require('../main/ai.js');
const { generatePptx } = require('../main/generator.js');
const { runGenerate } = require('../main/generate-flow.js');

const OUT_DIR = path.join(__dirname, 'out');
const FIX_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_MD = fs.readFileSync(path.join(__dirname, 'sample.md'), 'utf8');
const FEATURES_MD = fs.readFileSync(path.join(__dirname, 'features.md'), 'utf8');

// 96x54 的测试图（蓝底白圆+白方）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAYAAAA4T5zSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFaSURBVHhe7ZFBisMwEATzkn3a/v8XCTr4UtCOZWnURumCuhisaajX3//7HX2++CGuNQHMJoDZBDCbAGYTwGwCmE0As+UBeuC/v2BZgBH41s5ODzATvr2jUwNUwBu7OSXACnhzF7cP4II7lMMBVsLbV3TBHcqhAA644ZsuuEOZAEVwh/J2ACfccqYL7lAmQBHcobwV4Alwk9IFdygToAjuUCZAEdyhTIAiuEOZAEVwh7I7wFPgLqUL7lB2B2g+AW5SuuAOZQIUwR3KBCiCO5QJUAR3KBOgCO5Q3grQdMItZ7rgDmUCFMEdytsBmg644ZsuuEOZAEVwh3IoQHMlvH1FF9yhHA7QXAFvXtUFdygToAjuUE4JcFgBb/TqgjuUUwM0Z8K37+iCO5TTAxyOwLd2tizAYQ/89xcsDxDPTQCzCWA2AcwmgNkEMJsAZhPAbAKYTQCzCWA2Acx+AAfSABGZjyySAAAAAElFTkSuQmCC';
const PNG_BUF = Buffer.from(PNG_B64, 'base64');

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

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const portOf = (s) => s.address().port;

/** 假渲染器：按 HTML 结构估算高度，用于在纯 Node 下测试富内容排版逻辑 */
function makeStubRenderer() {
  const countRows = (html) => (html.match(/<tr>/g) || []).length;
  const countBlocks = (html) => (html.match(/<ul|<table|<pre|class="callout"|class="math-display"/g) || []).length || 1;
  const heightFor = (html) => {
    const rows = countRows(html);
    return rows > 0 ? rows * 0.34 + 0.3 : countBlocks(html) * 0.6;
  };
  return {
    async start() {},
    async measure(html, opts) {
      return { widthIn: opts.widthIn, heightIn: heightFor(html), failures: [] };
    },
    async renderFragment(html, opts) {
      return { png: PNG_BUF, widthPx: 96, heightPx: 54, widthIn: opts.widthIn, heightIn: heightFor(html), failures: [], stats: {} };
    },
    dispose() {}
  };
}

// ================= 1. 解析器 v1 语义 =================
async function testParserV1() {
  console.log('\n[1] 解析器 v1 语义');
  const parsed = parser.parseMarkdown(SAMPLE_MD, { fileName: 'sample.md' });
  const s = parsed.slides;

  check('共 7 页幻灯片', () => assert.strictEqual(s.length, 7));
  check('第 1 页为封面（含副标题）', () => {
    assert.strictEqual(s[0].layout, 'cover');
    assert.strictEqual(s[0].title, '让 AI 成为你的创作伙伴');
    assert.ok(s[0].subtitle.includes('产品发布演示'));
  });
  check('7 条备注全部解析', () => assert.strictEqual(parsed.stats.notes, 7));
  check('备注归属封面', () => assert.ok(s[0].notes.some((n) => n.includes('开场注意'))));
  check('备注不出现在内容块中', () => {
    const texts = s.flatMap((x) => x.bullets.map((b) => b.text)).join('\n');
    assert.ok(!texts.includes('开场注意'));
  });
  check('嵌套列表层级', () => {
    const nested = s[2].bullets.find((b) => b.text.includes('语气'));
    assert.strictEqual(nested.level, 1);
  });
  check('代码块', () => {
    const code = s[3].blocks.find((b) => b.type === 'code');
    assert.ok(code && code.code.includes('模型层'));
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
    const r = parser.parseMarkdown('# 主标题\n\n## 第一章\n\n## 第二章\n- 要点');
    assert.strictEqual(r.slides[1].layout, 'section');
    assert.strictEqual(r.slides[2].layout, 'content');
  });
  check('结尾页启发式仅限末页', () => {
    const r = parser.parseMarkdown('# 主\n\n## 感谢数据支持\n- 数据\n\n## 收尾\n- 内容');
    assert.strictEqual(r.slides[1].layout, 'content');
  });
  check('inlineToRuns：加粗/代码/斜体', () => {
    const runs = parser.inlineToRuns('**智能起草**：命中率 `90%`，*很快*');
    assert.ok(runs.some((r) => r.options.bold && r.text === '智能起草'));
    assert.ok(runs.some((r) => r.options.fontFace === 'Consolas' && r.text === '90%'));
    assert.ok(runs.some((r) => r.options.italic && r.text === '很快'));
  });
  check('空内容返回空', () => assert.strictEqual(parser.parseMarkdown('').slides.length, 0));
}

// ================= 2. 解析器 v2 富内容 =================
async function testParserV2() {
  console.log('\n[2] 解析器 v2：公式 / 表格 / 提示框 / 图片');

  const md = [
    '## 行间公式',
    '',
    '$$',
    'f_{n}=',
    '\\begin{cases}',
    'a&\\text{if $n=0$} \\\\',
    'r\\cdot f_{n-1}&\\text{else}',
    '\\end{cases}',
    '$$',
    '',
    '## 行内公式',
    '',
    '当 $n \\to \\infty$ 时，$a_n \\to 0$。',
    '',
    '行文中出现 $$E=mc^2$$ 也算公式。',
    '',
    '$$E=mc^2$$',
    '',
    '## 表格',
    '',
    '| A | B | C |',
    '| :--- | :---: | ---: |',
    '| $x^2$ | 值 \\| 带竖线 | 3 |',
    '| d | e |',
    '',
    '## 提示框',
    '',
    '> [!tip] 相关笔记',
    '> - 第一条',
    '> - 第二条',
    '',
    '> 这一行是演讲备注',
    '',
    '## 图片',
    '',
    '![示例图](figure.png)',
    '',
    '![[figure.png]]',
    '',
    '\\includegraphics[width=0.5\\textwidth]{figure.png}',
    '',
    '## 高亮与链接',
    '',
    '这里有 ==高亮文字== 与 [[某笔记|显示名]] 以及 <mark>HTML 高亮</mark>。'
  ].join('\n');

  const parsed = parser.parseMarkdown(md, { fileName: 't.md' });
  const byTitle = {};
  for (const s of parsed.slides) byTitle[s.title] = s;

  check('行间公式（cases，多行）解析为一个 math 块', () => {
    const blk = byTitle['行间公式'].blocks.find((b) => b.type === 'math');
    assert.ok(blk, '未找到 math 块');
    assert.ok(blk.tex.includes('\\begin{cases}'));
    assert.ok(blk.tex.includes('r\\cdot f_{n-1}'));
    assert.ok(!blk.tex.startsWith('$$') && !blk.tex.endsWith('$$'));
  });
  check('行内公式识别（含 $n \\to \\infty$）', () => {
    const s = byTitle['行内公式'];
    assert.ok(s.hasMath, '未标记 hasMath');
    const textBlk = s.blocks.find((b) => b.type === 'text' && b.rich);
    assert.ok(textBlk, '未找到含公式的文本块');
    assert.strictEqual(parser.countInlineMath(textBlk.text), 2);
  });
  check('独立成行的 $$...$$ 识别为 math 块', () => {
    const mathBlocks = byTitle['行内公式'].blocks.filter((b) => b.type === 'math');
    assert.strictEqual(mathBlocks.length, 1);
    assert.strictEqual(mathBlocks[0].tex, 'E=mc^2');
  });
  check('行文中的 $$...$$ 标记为富内容', () => {
    const blks = byTitle['行内公式'].blocks.filter((b) => b.type === 'text');
    const rich = blks.find((b) => b.text.includes('E=mc^2'));
    assert.ok(rich && rich.rich, '行文中 $$ 应标记为需要渲染');
    const html = richHtml.inlineToHtml(rich.text);
    assert.ok(html.includes('displaystyle'), '应以 displaystyle 渲染');
  });
  check('表格解析（对齐 / 转义竖线 / 行补齐）', () => {
    const t = byTitle['表格'].blocks.find((b) => b.type === 'table');
    assert.deepStrictEqual(t.headers, ['A', 'B', 'C']);
    assert.deepStrictEqual(t.aligns, ['left', 'center', 'right']);
    assert.strictEqual(t.rows.length, 2);
    assert.strictEqual(t.rows[0][1], '值 | 带竖线');
    assert.deepStrictEqual(t.rows[1], ['d', 'e', '']);
  });
  check('表格内公式被识别', () => {
    const t = byTitle['表格'].blocks.find((b) => b.type === 'table');
    assert.ok(parser.blockHasMath(t));
  });
  check('Obsidian 提示框解析（kind/标题/条目）', () => {
    const c = byTitle['提示框'].blocks.find((b) => b.type === 'callout');
    assert.ok(c, '未找到 callout');
    assert.strictEqual(c.kind, 'tip');
    assert.strictEqual(c.title, '相关笔记');
    assert.strictEqual(c.items.length, 2);
    assert.strictEqual(c.items[0].text, '第一条');
  });
  check('普通 ">" 行仍作为演讲备注', () => {
    assert.deepStrictEqual(byTitle['提示框'].notes, ['这一行是演讲备注']);
  });
  check('图片三种写法全部识别', () => {
    const imgs = byTitle['图片'].blocks.filter((b) => b.type === 'image');
    assert.strictEqual(imgs.length, 3);
    assert.strictEqual(imgs[0].src, 'figure.png');
    assert.strictEqual(imgs[0].alt, '示例图');
    assert.strictEqual(imgs[1].src, 'figure.png');
    assert.strictEqual(imgs[2].src, 'figure.png');
  });
  check('高亮与 wikilink 标记为富内容', () => {
    const s = byTitle['高亮与链接'];
    assert.ok(s.rich);
    const textBlk = s.blocks.find((b) => b.type === 'text');
    assert.ok(textBlk.text.includes('==高亮文字=='));
    assert.ok(textBlk.text.includes('[[某笔记|显示名]]'));
  });
  check('无 H1 时合成封面（用文件名）', () => {
    assert.strictEqual(parsed.slides[0].layout, 'cover');
    assert.strictEqual(parsed.slides[0].title, 't');
  });
  check('代码块中的 $$ 不被当作公式', () => {
    const r = parser.parseMarkdown('## A\n\n```\n$$\nx^2\n$$\n```\n');
    assert.strictEqual(r.stats.math, 0);
    const slideA = r.slides.find((s) => s.title === 'A');
    assert.ok(slideA.blocks[0].code.includes('x^2'));
  });
  check('统计信息正确（公式区分行间/行内）', () => {
    assert.strictEqual(parsed.stats.tables, 1);
    assert.strictEqual(parsed.stats.callouts, 1);
    assert.strictEqual(parsed.stats.images, 3);
    // 行间公式：cases 块 + 独立成行的 $$E=mc^2$$
    assert.strictEqual(parsed.stats.mathDisplay, 2);
    // 行内公式：$n \to \infty$、$a_n \to 0$、行文中的 $$E=mc^2$$、表格单元格 $x^2$
    assert.strictEqual(parsed.stats.mathInline, 4);
    assert.strictEqual(parsed.stats.math, 6);
  });
}

// ================= 3. LaTeX 兼容层 =================
async function testLatexCompat() {
  console.log('\n[3] LaTeX 兼容层');

  check('\\pu → \\text', () => assert.ok(compatTex('\\pu{ 6.022e23 mol-1 }').includes('\\text{ 6.022e23 mol-1 }')));
  check('\\qty → 数值 + 单位（上下标拆到 \\text 之外）', () => {
    const out = compatTex('\\qty{ 9.8 }{ m/s^2 }');
    assert.ok(out.includes('\\text{ 9.8 }'));
    assert.ok(out.includes('\\text{ m/s}'), `单位应为正体：${out}`);
    assert.ok(out.includes('^{'), `指数必须在 \\text 之外，否则 KaTeX 会报错：${out}`);
    assert.ok(!/\\text\{[^}]*\^/.test(out), `\\text 里不能有 ^：${out}`);
  });
  check('multline* → gathered', () => {
    const out = compatTex('\\begin{multline*}\na\\\\\nb\n\\end{multline*}');
    assert.ok(out.includes('\\begin{gathered}'));
    assert.ok(out.includes('\\end{gathered}'));
  });
  check('align/equation → aligned', () => {
    assert.ok(compatTex('\\begin{align}\na &= b\n\\end{align}').includes('\\begin{aligned}'));
    assert.ok(compatTex('\\begin{equation}\nx\n\\end{equation}').includes('\\begin{aligned}'));
  });
  check('alignat 补参数', () => assert.ok(compatTex('\\begin{alignat}\na&=b\n\\end{alignat}').includes('\\begin{alignedat}{2}')));
  check('去掉 \\label / \\ref / \\nonumber / \\tag', () => {
    const out = compatTex('a \\label{eq:1} \\nonumber \\tag{2} \\ref{eq:1} b');
    assert.ok(!out.includes('label'));
    assert.ok(!out.includes('nonumber'));
    assert.ok(!out.includes('\\tag'));
    assert.ok(!out.includes('ref'));
  });
  check('cancelto 可视化替换', () => {
    const out = compatTex('\\cancelto{ x=2026 }{ x=2025 }');
    assert.ok(out.includes('\\cancel{ x=2025 }'));
    assert.ok(out.includes('\\overset'));
  });
  check('physics 宏 bra/ket/braket', () => {
    assert.ok(compatTex('\\ket{\\psi}').includes('\\rangle'));
    assert.ok(compatTex('\\bra{\\psi}').includes('\\langle'));
    assert.ok(compatTex('\\braket{ a | b }').includes('\\langle'));
  });
  check('\\degree / \\dd / \\bm 替换', () => {
    assert.ok(compatTex('30\\degree').includes('^{\\circ}'));
    assert.ok(compatTex('\\int f \\dd x').includes('\\mathrm{d}'));
    assert.ok(compatTex('\\bm{\\alpha}').includes('\\boldsymbol{'));
  });
  check('\\text{中文} 原样保留', () => assert.ok(compatTex('x_{\\text{中文}}').includes('\\text{中文}')));
}

// ================= 4. HTML 片段生成 =================
async function testRichHtml() {
  console.log('\n[4] HTML 片段生成');

  check('行内公式 → data-tex 占位', () => {
    const html = richHtml.inlineToHtml('速度 $v = \\frac{s}{t}$ 恒定');
    assert.ok(html.includes('data-tex='));
    assert.ok(html.includes('速度'));
    assert.ok(html.includes('data-display="0"'));
  });
  check('HTML 转义（防注入/破版）', () => {
    const html = richHtml.inlineToHtml('比较 a < b 与 c > d');
    assert.ok(html.includes('&lt;'));
    assert.ok(html.includes('&gt;'));
  });
  check('允许的原始 HTML 标签保留（mark/br）', () => {
    const html = richHtml.inlineToHtml('A<mark>B</mark>C<br>D');
    assert.ok(html.includes('<mark>B</mark>'));
    assert.ok(html.includes('<br>'));
  });
  check('==高亮== → <mark>', () => assert.ok(richHtml.inlineToHtml('==重点==').includes('<mark>重点</mark>')));
  check('行内代码保护（不改写其中的 $ 与 *）', () => {
    const html = richHtml.inlineToHtml('用 `$x$` 表示，`a*b*c`');
    assert.ok(html.includes('<code class="md-inline">$x$</code>'));
    assert.ok(html.includes('a*b*c'));
    assert.ok(!html.includes('data-tex'));
  });
  check('wikilink → 纯文本', () => {
    const html = richHtml.inlineToHtml('见 [[目标笔记|别名]] 一节');
    assert.ok(html.includes('别名'));
    assert.ok(!html.includes('[['));
  });
  check('表格 HTML 结构与对齐', () => {
    const html = richHtml.tableHtml({ headers: ['A', 'B'], rows: [['1', '2']], aligns: ['center', 'right'] });
    assert.ok(html.includes('<table class="md-table">'));
    assert.ok(html.includes('text-align:center'));
    assert.ok(html.includes('text-align:right'));
  });
  check('提示框 HTML（kind → class）', () => {
    const html = richHtml.calloutHtml({ type: 'callout', kind: 'warning', title: '注意', items: [{ text: 'x', level: 0 }], lines: [] });
    assert.ok(html.includes('callout-warning'));
    assert.ok(html.includes('callout-title'));
  });
  check('行间公式 HTML 居中容器', () => {
    const html = richHtml.displayMathHtml('\\frac{a}{b}');
    assert.ok(html.includes('math-display'));
    assert.ok(html.includes('data-display="1"'));
  });
  check('代码块 HTML 转义', () => {
    const html = richHtml.codeHtml('\\begin{document} <b>');
    assert.ok(html.includes('&lt;b&gt;'));
    assert.ok(html.includes('\\begin{document}'));
  });
  check('所有块类型都能生成非空 HTML（防类型名不一致）', () => {
    const md = [
      '# 标题', '',
      '## 页', '',
      '- 要点一', '',
      '一段正文文字', '',
      '$$', 'E=mc^2', '$$', '',
      '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
      '> [!tip] 提示', '> - 条目', '',
      '```', 'code line', '```', '',
      '![图](x.png)'
    ].join('\n');
    const parsed = parser.parseMarkdown(md, { fileName: 't.md' });
    const seen = new Set();
    for (const s of parsed.slides) {
      for (const blk of s.blocks) {
        seen.add(blk.type);
        if (blk.type === 'image') continue; // 图片由 PPT 原生嵌入，不走 HTML
        const html = richHtml.blockToHtml(blk);
        assert.ok(html && html.length > 10, `块类型「${blk.type}」生成的 HTML 为空`);
      }
    }
    for (const t of ['bullets', 'text', 'math', 'table', 'callout', 'code', 'image']) {
      assert.ok(seen.has(t), `测试样本未覆盖块类型 ${t}`);
    }
  });
  check('文本块（text）必须能渲染（回归：类型名不一致导致丢内容）', () => {
    const parsed = parser.parseMarkdown('## A\n\n这是一段含公式 $x^2$ 的正文。\n', { fileName: 't.md' });
    const blk = parsed.slides.find((s) => s.title === 'A').blocks[0];
    assert.strictEqual(blk.type, 'text');
    const html = richHtml.blockToHtml(blk);
    assert.ok(html.includes('md-p'), 'text 块应生成段落 HTML');
    assert.ok(html.includes('data-tex='));
  });
}

// ================= 5. AI 客户端 + 占位保护 =================
async function testAi() {
  console.log('\n[5] AI 客户端 + 占位保护');

  const outline = parser.parseMarkdown(
    '## 第一章\n\n- 纯文本要点一\n\n$$\nE = mc^2\n$$\n\n- 纯文本要点二\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    { fileName: 'x.md' }
  );

  check('tokenizeOutline：富内容块变为 ⟦B数字⟧', () => {
    const { text, map } = ai.tokenizeOutline(outline);
    assert.strictEqual(map.size, 2, '应保护公式与表格');
    assert.ok(text.includes('⟦B1⟧'));
    assert.ok(text.includes('⟦B2⟧'));
    assert.ok(text.includes('纯文本要点一'));
  });

  check('applyTokens：标记还原为原始块', () => {
    const { map } = ai.tokenizeOutline(outline);
    const aiSlides = [
      { title: '第一章', bullets: [{ text: 'AI 改写后的要点', level: 0 }], notes: [], layout: 'content' },
      { title: '第二页', bullets: [{ text: '⟦B1⟧', level: 0 }, { text: '⟦B2⟧', level: 0 }], notes: [], layout: 'content' }
    ];
    const applied = ai.applyTokens(aiSlides, map, outline.slides);
    const blocks = applied.slides[1].blocks;
    assert.strictEqual(blocks[0].type, 'math');
    assert.strictEqual(blocks[0].tex, 'E = mc^2');
    assert.strictEqual(blocks[1].type, 'table');
    assert.strictEqual(applied.warnings.length, 0);
  });

  check('applyTokens：AI 丢失标记 → 自动补回并告警', () => {
    const { map } = ai.tokenizeOutline(outline);
    const aiSlides = [{ title: '只剩文字', bullets: [{ text: '没有标记', level: 0 }], notes: [], layout: 'content' }];
    const applied = ai.applyTokens(aiSlides, map, outline.slides);
    assert.strictEqual(applied.warnings.length, 2);
    const restored = applied.slides[0].blocks.map((b) => b.type);
    assert.ok(restored.includes('math'));
    assert.ok(restored.includes('table'));
  });

  await checkAsync('enhanceOutline：mock 服务返回带标记的 JSON', async () => {
    const server = await startMockServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        const userText = (payload.messages || []).map((m) => m.content).join('\n');
        const tokens = [...userText.matchAll(/⟦B(\d+)⟧/g)].map((m) => m[0]);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            slides: [
              { title: '封面', bullets: [], layout: 'cover' },
              { title: '内容', bullets: ['AI 重写的文字', ...tokens], layout: 'content' }
            ]
          }) } }]
        }));
      });
    });
    try {
      const res = await ai.enhanceOutline(
        { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' },
        { mdText: 'x', outline, styleName: '科技蓝' }
      );
      assert.strictEqual(res.tokens.total, 2);
      assert.strictEqual(res.tokens.kept, 2);
      assert.strictEqual(res.warnings.length, 0);
      const types = res.slides.flatMap((s) => s.blocks.map((b) => b.type));
      assert.ok(types.includes('math'));
      assert.ok(types.includes('table'));
      assert.ok(types.includes('bullets'));
    } finally {
      server.close();
    }
  });

  await checkAsync('enhanceOutline：400 自动降级重试', async () => {
    const calls = [];
    const server = await startMockServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        calls.push(!!payload.response_format);
        if (calls.length === 1) {
          res.statusCode = 400;
          res.end('{"error":{"message":"response_format not supported"}}');
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ choices: [{ message: { content: '{"slides":[{"title":"T","bullets":["b"],"layout":"content"}]}' } }] }));
        }
      });
    });
    try {
      const res = await ai.enhanceOutline(
        { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' },
        { mdText: 'x', outline: { slides: [{ title: 'T', blocks: [], notes: [], bullets: [] }] }, styleName: '' }
      );
      assert.deepStrictEqual(calls, [true, false]);
      assert.strictEqual(res.slides.length, 1);
    } finally {
      server.close();
    }
  });

  check('extractJson 容错', () => {
    assert.deepStrictEqual(ai.extractJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(ai.extractJson('前缀\n```json\n{"b":2}\n```\n后缀'), { b: 2 });
    assert.throws(() => ai.extractJson('完全不是 JSON'));
  });
}

// ================= 6. 生成器 =================
async function testGenerator() {
  console.log('\n[6] 生成器');
  const JSZip = require('jszip');
  const parsed = parser.parseMarkdown(SAMPLE_MD, { fileName: 'sample.md' });

  for (const style of STYLES) {
    await checkAsync(`样式「${style.name}」生成成功`, async () => {
      const outPath = path.join(OUT_DIR, `sample-${style.id}.pptx`);
      const res = await generatePptx(parsed.slides, style.id, outPath);
      assert.strictEqual(res.slideCount, parsed.slides.length);
      assert.ok(fs.statSync(outPath).size > 10000);
    });
  }

  await checkAsync('备注页与背景色写入', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(OUT_DIR, 'sample-tech-blue.pptx')));
    const names = Object.keys(zip.files);
    const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    assert.strictEqual(notes.length, 7);
    const notes1 = await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
    assert.ok(notes1.includes('开场注意'));
    const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(slide1.includes('0A1733'));
  });

  await checkAsync('图片嵌入（本地文件 → media）', async () => {
    fs.mkdirSync(FIX_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIX_DIR, 'figure.png'), PNG_BUF);
    const md = [
      '# 图表测试',
      '',
      '## 本地图片',
      '',
      '![示例图](figure.png)',
      '',
      '## 缺失图片',
      '',
      '![找不到](nope.png)',
      '',
      '## 行内公式',
      '',
      '当 $n \\to \\infty$ 时。'
    ].join('\n');
    const slides = parser.parseMarkdown(md, { fileName: 'figures.md' }).slides;
    const outPath = path.join(OUT_DIR, 'figures.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { baseDir: FIX_DIR, renderer: null });
    assert.ok(res.slideCount >= 3, `页数 ${res.slideCount}`);
    assert.ok(res.warnings.some((w) => w.includes('nope.png')), '缺失图片应有告警');
    const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n));
    assert.ok(media.length >= 1, '应嵌入至少一张图片');
  });

  await checkAsync('富内容分页：宽表格拆成多页（stub 渲染器）', async () => {
    const rows = [];
    for (let i = 1; i <= 24; i++) rows.push(`| 行${i} | $x_{${i}}$ | 说明 ${i} |`);
    const md = [
      '## 宽表格',
      '',
      '| 名称 | 公式 | 说明 |',
      '| --- | --- | --- |',
      ...rows
    ].join('\n');
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'big-table.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer() });
    assert.ok(res.slideCount > slides.length,
      `应拆分出续页：源 ${slides.length} 页 → 生成 ${res.slideCount} 页`);
  });

  await checkAsync('富幻灯片：无渲染器时安全退化为原生文本', async () => {
    const slides = parser.parseMarkdown('## 公式页\n\n- 行内公式 $E=mc^2$ 混排\n\n$$\n\\int_0^1 x dx\n$$\n', { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'no-renderer.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: null });
    assert.ok(res.slideCount >= 1);
    assert.ok(fs.existsSync(outPath));
  });
}

// ================= 7. 生成主流程 =================
async function testFlow() {
  console.log('\n[7] 生成主流程');

  await checkAsync('直接排版模式返回统计信息', async () => {
    const outPath = path.join(OUT_DIR, 'flow-direct.pptx');
    const logs = [];
    const res = await runGenerate(
      { mdContent: SAMPLE_MD, mdPath: path.join(__dirname, 'sample.md'), styleId: 'business-gold', mode: 'direct', outPath },
      (m) => logs.push(m),
      { renderer: makeStubRenderer() }
    );
    assert.strictEqual(res.ok, true);
    // v2.2：autoToc 默认开启，≥2 节时自动多一页目录
    assert.strictEqual(res.slideCount, 8);
    assert.strictEqual(res.stats.slides, 8);
    assert.ok(logs.some((l) => l.includes('解析完成')));
    assert.ok(logs.some((l) => l.includes('目录：')), '日志里应报告目录条目数');
    assert.ok(fs.existsSync(outPath));
  });

  await checkAsync('AI 模式（mock + 占位保护）', async () => {
    const md = '## 章节\n\n- 纯文本\n\n$$\nE=mc^2\n$$\n';
    const server = await startMockServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const payload = JSON.parse(body);
        const userText = (payload.messages || []).map((m) => m.content).join('\n');
        const tokens = [...userText.matchAll(/⟦B(\d+)⟧/g)].map((m) => m[0]);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            slides: [
              { title: '封面', bullets: [], layout: 'cover' },
              { title: 'AI 页', bullets: ['改写要点', ...tokens], layout: 'content' }
            ]
          }) } }]
        }));
      });
    });
    try {
      const outPath = path.join(OUT_DIR, 'flow-ai.pptx');
      const res = await runGenerate(
        {
          mdContent: md, mdPath: null, styleId: 'fresh-green', mode: 'ai', outPath,
          apiConfig: { baseUrl: `http://127.0.0.1:${portOf(server)}/v1`, apiKey: 'k', model: 'm' }
        },
        () => {},
        { renderer: makeStubRenderer() }
      );
      assert.strictEqual(res.slideCount, 2);
      assert.strictEqual(res.stats.math, 1);
      const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
      const media = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n));
      assert.ok(media.length >= 1, 'AI 模式下公式仍应被渲染为图片');
    } finally {
      server.close();
    }
  });

  await checkAsync('错误处理：空内容', async () => {
    await assert.rejects(
      () => runGenerate({ mdContent: '', styleId: 'tech-blue', mode: 'direct', outPath: path.join(OUT_DIR, 'x.pptx') }, () => {}, {}),
      /Markdown 内容为空/
    );
  });
}

// ================= 8. v2.1 新功能 =================
async function testV21() {
  console.log('\n[8] v2.1：渐进显示 / 定理环境 / 编号引用 / 代码高亮');
  const parsed = parser.parseMarkdown(FEATURES_MD, { fileName: 'features.md' });
  const findSlide = (kw) => parsed.slides.find((s) => (s.title || '').includes(kw));

  // ---------- 渐进显示 ----------
  check('overlay：列表项 <n-> 与 \\pause 计算步数', () => {
    const s = findSlide('渐进显示基础');
    assert.strictEqual(s.steps, 3);
    const b0 = s.blocks[0].items.map((it) => `${it.from}-${it.to == null ? '∞' : it.to}`);
    assert.deepStrictEqual(b0, ['1-∞', '2-∞', '3-∞']);
    assert.strictEqual(s.blocks[1].items[0].from, 2, '\\pause 之后的块应从第 2 步开始');
  });
  check('overlay：步号不跨页泄漏', () => {
    for (const s of parsed.slides) {
      if (s.title.includes('渐进显示基础')) continue;
      if (s.title.includes('行内 overlay')) continue;
      assert.strictEqual(s.steps, 1, `「${s.title}」不应带 overlay 步`);
    }
  });
  check('overlay：<n> 仅在该步显示', () => {
    const r = parser.parseMarkdown('## A\n\n- 只第 2 步 <2>\n- 一直显示\n', { fileName: 't.md' });
    const items = r.slides.find((s) => s.title === 'A').blocks[0].items;
    assert.strictEqual(items[0].to, 2);
    assert.strictEqual(ov.visibleAtStep(items[0], 1), false);
    assert.strictEqual(ov.visibleAtStep(items[0], 2), true);
    assert.strictEqual(ov.visibleAtStep(items[1], 3), true);
  });
  check('overlay：分步 HTML 逐步显现（hide 模式保留占位）', () => {
    const s = findSlide('渐进显示基础');
    const step1 = richHtml.blocksToHtmlStep(s.blocks, 1, 'hide');
    const step3 = richHtml.blocksToHtmlStep(s.blocks, 3, 'hide');
    const hidden1 = (step1.match(/ov-hidden/g) || []).length;
    const hidden3 = (step3.match(/ov-hidden/g) || []).length;
    assert.strictEqual(hidden1, 3, '第 1 步应有 3 项占位（2/3/pause 之后）');
    assert.strictEqual(hidden3, 0, '第 3 步全部可见');
  });
  check('overlay：dim 模式渲染未来内容', () => {
    const s = findSlide('渐进显示基础');
    const html = richHtml.blocksToHtmlStep(s.blocks, 1, 'dim');
    assert.ok(html.includes('ov-future'));
    assert.ok(!html.includes('ov-hidden'));
  });
  check('overlay：行内 \\only<2->{} 第 1 步隐藏、第 2 步出现', () => {
    const opts1 = { step: 1, mode: 'hide' };
    const html1 = richHtml.inlineToHtml('前 \\only<2->{第二步} 后', opts1);
    const html2 = richHtml.inlineToHtml('前 \\only<2->{第二步} 后', { step: 2, mode: 'hide' });
    assert.ok(!html1.includes('第二步'), '第 1 步不应出现');
    assert.ok(html2.includes('第二步'), '第 2 步应出现');
  });
  check('overlay：行内 \\alert<3->{} 高亮且保留占位', () => {
    const html = richHtml.inlineToHtml('\\alert<3->{重点}', { step: 3, mode: 'hide' });
    assert.ok(html.includes('ov-alert'));
    assert.ok(html.includes('重点'));
    const early = richHtml.inlineToHtml('\\alert<3->{重点}', { step: 1, mode: 'hide' });
    assert.ok(early.includes('ov-hidden'));
  });
  check('overlay：\\uncover<2->{} 保留布局占位', () => {
    const html = richHtml.inlineToHtml('a\\uncover<2->{b}c', { step: 1, mode: 'hide' });
    assert.ok(html.includes('ov-hidden'));
    assert.ok(html.includes('b'));
  });
  check('回归：行内代码中的 \\pause / <2-> 不被误判为 overlay', () => {
    const r = parser.parseMarkdown(
      '## A\n\n常用组件：`<2->`、`\\pause`、`\\only<2->{x}` 的说明文字。\n\n- 含 `<2->` 的要点\n',
      { fileName: 't.md' }
    );
    const s = r.slides.find((x) => x.title === 'A');
    assert.strictEqual(s.steps, 1, '行内代码里的标记不应产生分步');
    assert.ok(s.blocks[0].text.includes('`\\pause`'), '正文应原样保留');
    const bulletBlock = s.blocks.find((x) => x.type === 'bullets');
    assert.strictEqual(bulletBlock.items.length, 1, '要点不应被拆开');
    assert.ok(bulletBlock.items[0].text.includes('`<2->`'), '要点里的代码应原样保留');
    const html = richHtml.inlineToHtml(s.blocks[0].text, { step: 1, mode: 'hide' });
    assert.ok(html.includes('md-inline'), '代码 span 应保留');
    assert.ok(!html.includes('ov-'), '代码内的命令不应产生 overlay 标记');
  });

  // ---------- 定理环境 ----------
  check('定理环境：编号 + 标题 + 标签', () => {
    const env = findSlide('定理环境').blocks.find((b) => b.type === 'env' && b.env === 'theorem');
    assert.ok(env, '未解析出 theorem 环境');
    assert.strictEqual(env.number, 1);
    assert.strictEqual(env.title, '勾股定理');
    assert.strictEqual(env.label, 'thm:pyth');
    assert.strictEqual(env.rich, true);
  });
  check('定理环境：正文块（含行间公式）递归解析', () => {
    const env = findSlide('定理环境').blocks.find((b) => b.type === 'env' && b.env === 'theorem');
    const types = env.blocks.map((b) => b.type);
    assert.ok(types.includes('text'));
    assert.ok(types.includes('math'), '环境内的 $$…$$ 应成为 math 块');
  });
  check('定理环境：proof 无编号并带 QED；definition 独立计数', () => {
    const blocks = findSlide('定理环境').blocks.filter((b) => b.type === 'env');
    const proof = blocks.find((b) => b.env === 'proof');
    const def = blocks.find((b) => b.env === 'definition');
    const remark = blocks.find((b) => b.env === 'remark');
    assert.strictEqual(proof.number, null);
    assert.strictEqual(proof.qed, true);
    assert.strictEqual(def.number, 1);
    assert.strictEqual(remark.number, null);
  });
  check('定理环境：HTML 渲染（标题/∎/配色类）', () => {
    const env = findSlide('定理环境').blocks.find((b) => b.type === 'env' && b.env === 'theorem');
    const html = richHtml.envHtml(env, { step: 1, mode: 'hide' });
    assert.ok(html.includes('env-theorem'));
    assert.ok(html.includes('定理 1'));
    assert.ok(html.includes('勾股定理'));
    const proofHtml = richHtml.envHtml(findSlide('定理环境').blocks.find((b) => b.env === 'proof'), { step: 1 });
    assert.ok(proofHtml.includes('env-qed'));
  });

  // ---------- 编号与交叉引用 ----------
  check('编号：公式 (1)(2)、图 1、表 1、定理 1', () => {
    const eqs = parsed.slides.flatMap((s) => s.blocks).filter((b) => b.type === 'math' && b.number != null);
    assert.strictEqual(eqs.length, 2);
    assert.deepStrictEqual(eqs.map((b) => b.number), ['1', '2']);
    const img = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'image');
    assert.strictEqual(img.number, 1);
    assert.strictEqual(img.label, 'fig:demo');
    assert.strictEqual(img.alt, '演示图');
    const tbl = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'table');
    assert.strictEqual(tbl.number, 1);
    assert.strictEqual(tbl.caption, '示例数据');
    assert.strictEqual(tbl.label, 'tab:data');
  });
  check('交叉引用：\\ref / \\eqref 全部替换', () => {
    const text = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'text' && b.text.includes('可知')).text;
    assert.ok(text.includes('由 1 与'), text);
    assert.ok(text.includes('（2）'), text);
    assert.ok(text.includes('图 1'), text);
    assert.ok(text.includes('表 1'), text);
    assert.ok(text.includes('定理 1'), text);
    assert.strictEqual(parsed.stats.unresolvedRefs.length, 0);
    assert.strictEqual(parsed.stats.refs, 5);
  });
  check('交叉引用：未定义 → ?? 并记录', () => {
    const r = parser.parseMarkdown('## A\n\n见 \\ref{eq:none} 与 \\eqref{fig:none}。\n', { fileName: 't.md' });
    const text = r.slides.find((s) => s.title === 'A').blocks[0].text;
    assert.ok(text.includes('??'));
    assert.strictEqual(r.stats.unresolvedRefs.length, 2);
  });
  check('交叉引用：\\autoref 带类型前缀 / 节号', () => {
    const r = parser.parseMarkdown(
      '## 方法 \\label{sec:m}\n\n- 要点\n\n$$x=1 \\label{eq:a}$$\n\n## 结论\n\n见 \\autoref{eq:a} 与 \\autoref{sec:m}。\n',
      { fileName: 't.md' }
    );
    const text = r.slides.find((s) => s.title === '结论').blocks[0].text;
    assert.ok(text.includes('公式（1）'), text);
    assert.ok(text.includes('第 1 节'), text);
    assert.ok(r.stats.useSectionNumbers);
  });
  check('编号渲染：公式号进图、表题注进图', () => {
    const eq = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'math' && b.number === '1');
    assert.ok(richHtml.blockToHtml(eq).includes('eq-no'));
    const tbl = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'table');
    const html = richHtml.blockToHtml(tbl);
    assert.ok(html.includes('tbl-caption'));
    assert.ok(html.includes('表 1'));
  });

  // ---------- 代码高亮 ----------
  check('代码高亮：Python 与 LaTeX', () => {
    const codes = parsed.slides.flatMap((s) => s.blocks).filter((b) => b.type === 'code');
    const py = codes.find((c) => c.lang === 'python');
    const tex = codes.find((c) => c.lang === 'latex');
    const pyHtml = richHtml.blockToHtml(py);
    const texHtml = richHtml.blockToHtml(tex);
    assert.ok(pyHtml.includes('hljs-'), 'python 应有高亮类名');
    assert.ok(pyHtml.includes('hljs-keyword'));
    assert.ok(texHtml.includes('hljs-'), 'latex 应有高亮类名');
    assert.ok(!texHtml.includes('&lt;span'), '高亮结果不应被二次转义');
  });

  // ---------- AI 保护 ----------
  check('AI：定理块与 overlay 标记受保护', () => {
    const { text, map, overlayMarks } = ai.tokenizeOutline(parsed);
    assert.ok([...map.values()].some((v) => v.block.type === 'env'), '定理块应生成占位标记');
    assert.ok(text.includes('⟦O2-⟧'), 'overlay 标记应出现在大纲中');
    assert.ok(overlayMarks >= 3, `应记录 overlay 标记数，实际 ${overlayMarks}`);
  });
  check('AI：overlay 标记还原为步号', () => {
    const { map } = ai.tokenizeOutline(parsed);
    const aiSlides = [{
      title: '页',
      bullets: [{ text: '⟦O2-⟧改写后的要点', level: 0 }, { text: '普通要点', level: 0 }],
      notes: [], layout: 'content'
    }];
    const applied = ai.applyTokens(aiSlides, map, parsed.slides);
    const items = applied.slides[0].blocks[0].items;
    assert.strictEqual(items[0].from, 2);
    assert.strictEqual(items[0].text, '改写后的要点');
    assert.strictEqual(items[1].from, 1);
    assert.strictEqual(applied.overlayApplied, 1);
  });
}

// ================= 9. 生成器：overlay 展开 =================
async function testOverlayGeneration() {
  console.log('\n[9] 生成器：overlay 分步展开');

  await checkAsync('原生路径：3 步 → 3 页', async () => {
    const md = '## 分步\n\n- 甲\n- 乙 <2->\n- 丙 <3->\n\n> 备注\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    assert.strictEqual(slides.find((s) => s.title === '分步').steps, 3);
    const outPath = path.join(OUT_DIR, 'overlay-native.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer(), animation: false });
    assert.strictEqual(res.slideCount, 4, `封面 + 3 步，实际 ${res.slideCount}`);
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    assert.strictEqual(notes.length, 4, '每一步都应带备注页');
  });

  await checkAsync('图片路径：2 步 → 2 页图片', async () => {
    const md = '## 公式分步\n\n- 首项 $x^2$\n- 次项 $y^2$ <2->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    assert.strictEqual(slides.find((s) => s.title === '公式分步').steps, 2);
    const outPath = path.join(OUT_DIR, 'overlay-rich.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer(), formulaMode: 'image' });
    assert.strictEqual(res.slideCount, 3, `封面 + 2 步，实际 ${res.slideCount}`);
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\/[^/]+\.png$/.test(n));
    assert.strictEqual(media.length, 2, '每一步各一张图片');
  });

  await checkAsync('overlayMode=dim 与 hide 都能生成', async () => {
    const md = '## 分步\n\n- 甲 $a$\n- 乙 $b$ <2->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    for (const mode of ['hide', 'dim']) {
      const outPath = path.join(OUT_DIR, `overlay-${mode}.pptx`);
      const res = await generatePptx(slides, 'fresh-green', outPath, { renderer: makeStubRenderer(), overlayMode: mode, formulaMode: 'image' });
      assert.strictEqual(res.slideCount, 3, `${mode} 模式页数`);
    }
  });

  // ---- 回归：原生路径必须逐项判断可见性（此前只判断了块级，导致分步页完全相同）----
  const STEP_MD = '## 纯文本分步\n\n- 第一处要点：甲\n- 第二处要点：乙 <2->\n- 第三处要点：丙 <3->\n';

  /** 统计某页中「要点」run 的可见/隐藏数量与颜色 */
  async function bulletRunStats(zip, pageNo) {
    const xml = await zip.file(`ppt/slides/slide${pageNo}.xml`).async('string');
    const runs = [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((m) => m[1]).filter((r) => /要点/.test(r));
    const colorOf = (r) => (r.match(/<a:srgbClr val="([0-9A-F]{6})"/) || [, '?'])[1];
    return {
      visible: runs.filter((r) => colorOf(r) !== 'FFFFFF').length,
      hidden: runs.filter((r) => colorOf(r) === 'FFFFFF').length,
      colors: runs.map(colorOf),
      texts: runs.map((r) => ([...r.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('')))
    };
  }

  await checkAsync('回归：原生分步页逐页多显示一条要点', async () => {
    const slides = parser.parseMarkdown(STEP_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'overlay-native-step.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { overlayMode: 'hide', animation: false });
    assert.strictEqual(res.slideCount, 4, `封面 + 3 步，实际 ${res.slideCount}`);
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    const s2 = await bulletRunStats(zip, 2);
    const s3 = await bulletRunStats(zip, 3);
    const s4 = await bulletRunStats(zip, 4);
    assert.strictEqual(s2.visible, 1, `第 1 步应只显示 1 条，实际 ${s2.visible}：${JSON.stringify(s2.texts)}`);
    assert.strictEqual(s2.hidden, 2, '第 1 步其余 2 条应以背景色占位');
    assert.strictEqual(s3.visible, 2, `第 2 步应显示 2 条，实际 ${s3.visible}`);
    assert.strictEqual(s3.hidden, 1);
    assert.strictEqual(s4.visible, 3, `第 3 步应显示 3 条，实际 ${s4.visible}`);
    assert.strictEqual(s4.hidden, 0);
  });

  await checkAsync('回归：collapse 模式不输出未到步的内容', async () => {
    const slides = parser.parseMarkdown(STEP_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'overlay-collapse-step.pptx');
    await generatePptx(slides, 'tech-blue', outPath, { overlayMode: 'collapse' });
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    const xml2 = await zip.file('ppt/slides/slide2.xml').async('string');
    assert.ok(xml2.includes('第一处要点'), '第 1 步应包含第一条');
    assert.ok(!xml2.includes('第二处要点'), 'collapse 模式不应输出第二条');
    const s2 = await bulletRunStats(zip, 2);
    assert.strictEqual(s2.visible, 1);
    assert.strictEqual(s2.hidden, 0, '不应有占位 run');
  });

  await checkAsync('regression：dim 模式用浅色占位（非白/非正文色）', async () => {
    const slides = parser.parseMarkdown(STEP_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'overlay-dim-step.pptx');
    await generatePptx(slides, 'tech-blue', outPath, { overlayMode: 'dim' });
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    const stats = await bulletRunStats(zip, 2);
    assert.strictEqual(stats.visible, 3, 'dim 模式三条都在（未来两条为浅色）');
    assert.strictEqual(stats.hidden, 0);
    const future = stats.colors.filter((c) => c !== '101828' && c !== 'FFFFFF');
    assert.strictEqual(future.length, 2, `未来两条应为浅色，实际颜色 ${JSON.stringify(stats.colors)}`);
  });

  await checkAsync('页码分母为 overlay 展开后的真实总页数', async () => {
    const slides = parser.parseMarkdown(STEP_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'overlay-pageno.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { overlayMode: 'hide', animation: false });
    const zip = await require('jszip').loadAsync(fs.readFileSync(outPath));
    for (let p = 1; p <= res.slideCount; p++) {
      const xml = await zip.file(`ppt/slides/slide${p}.xml`).async('string');
      assert.ok(!xml.includes('⟪T⟫'), `第 ${p} 页仍有未替换的页码哨兵`);
      const pageTexts = [...xml.matchAll(/<a:t>(\d+ \/ [^<]*)<\/a:t>/g)].map((m) => m[1]);
      if (pageTexts.length) {
        assert.strictEqual(pageTexts[0], `${p} / ${res.slideCount}`,
          `第 ${p} 页页码应为 "${p} / ${res.slideCount}"，实际 "${pageTexts[0]}"`);
      }
    }
  });

  await checkAsync('图片路径：不同步的渲染结果互不相同', async () => {
    const md = '## 公式分步\n\n- 首项 $a_1$\n- 次项 $a_2$ <2->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const stub = makeStubRenderer();
    const seen = [];
    const origRender = stub.renderFragment.bind(stub);
    stub.renderFragment = async (html, opts) => {
      seen.push(html);
      return origRender(html, opts);
    };
    const outPath = path.join(OUT_DIR, 'overlay-rich-diff.pptx');
    await generatePptx(slides, 'gradient-purple', outPath, { renderer: stub, overlayMode: 'collapse', formulaMode: 'image' });
    assert.strictEqual(seen.length, 2, `应各渲染一次，实际 ${seen.length}`);
    assert.notStrictEqual(seen[0], seen[1], '两步的 HTML 必须不同');
    assert.ok(seen[0].includes('首项') && !seen[0].includes('次项'), '第 1 步不应含第 2 项');
    assert.ok(seen[1].includes('首项') && seen[1].includes('次项'), '第 2 步应含两项');
  });
}

// ================= v2.2：原生公式 / 动画 / 目录 / 文献 / 算法 =================

const { mmlToOmml } = require('../shared/mml2omml.js');
const { latexToOmml } = require('../shared/latex2omml.js');
const bib = require('../shared/bib.js');
const post = require('../main/pptx-post.js');

const V22_MD = [
  '# v2.2 测试',
  '',
  '## 引言',
  '',
  '经典结果见 \\cite{zhang2020} 与 [@li2021]。',
  '',
  '$$\nf_n = \\begin{cases} a & n=0 \\\\ r f_{n-1} & \\text{else} \\end{cases}\n$$',
  '',
  '## 方法',
  '',
  '行内 $E=mc^2$ 与文字混排，另有 $a_n \\to 0$。',
  '',
  '## 算法',
  '',
  '\\begin{algorithm}[快速排序]\\label{alg:q}',
  '\\Require 数组 $A$',
  '\\If{$p < r$}',
  '  \\State $q \\gets \\Call{Partition}{A,p,r}$',
  '\\EndIf',
  '\\end{algorithm}',
  '',
  '见算法 \\ref{alg:q}。'
].join('\n');

const BIB_TEXT = [
  '@article{zhang2020,',
  '  author = {张三 and 李四},',
  '  title = {一个 {GPU} 加速的例子},',
  '  journal = {计算机学报},',
  '  year = {2020}',
  '}',
  '@inproceedings{li2021,',
  '  author = {Li, Wei and Wang, Fang},',
  '  title = {Fast Sorting Revisited},',
  '  booktitle = {Proc. of ACM},',
  '  year = {2021}',
  '}'
].join('\n');

async function zipOf(p) {
  return require('jszip').loadAsync(fs.readFileSync(p));
}
async function slideXml(zip, i) {
  return zip.file(`ppt/slides/slide${i}.xml`).async('string');
}

async function testV22() {
  console.log('\n[10] v2.2：OMML 原生公式');

  check('MathML→OMML：分式/根式/求和/上标结构正确', () => {
    const mml = '<math><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac>'
      + '<msqrt><mi>x</mi></msqrt>'
      + '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>'
      + '<msup><mi>a</mi><mn>2</mn></msup></mrow></math>';
    const r = mmlToOmml(mml, { display: true, szPt: 20 });
    assert.ok(r.body.includes('<m:f>'), '分式 → m:f');
    assert.ok(r.body.includes('<m:rad>'), '根式 → m:rad');
    assert.ok(r.body.includes('<m:nary>') && r.body.includes('m:limLoc'), '求和 → m:nary');
    assert.ok(r.body.includes('<m:sSup>'), '上标 → m:sSup');
    assert.ok(r.xml.includes('<a14:m '), '整体包在 a14:m 里');
    assert.ok(r.xml.includes('<m:oMathPara'), '块级用 m:oMathPara');
  });

  check('OMML 只用 DrawingML 命名空间（绝不能出现 Word 的 w:）', () => {
    for (const tex of ['\\frac{a}{b}', '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}', '\\begin{cases}a&b\\\\c&d\\end{cases}']) {
      const r = latexToOmml(tex, { display: true, szPt: 20 });
      assert.ok(r.ok, `${tex} 应转换成功：${r.error}`);
      assert.ok(!/<w:/.test(r.xml), `${tex} 的 OMML 出现 w: 元素（pptx 非法）`);
      assert.ok(r.xml.includes('<a:rPr'), '文本 run 属性用 a:rPr');
      assert.ok(r.xml.includes('Cambria Math'), '数学字体为 Cambria Math');
    }
  });

  check('LaTeX compat 层照常生效（\\pu/\\cancelto/\\degree 等）', () => {
    const r = latexToOmml('\\pu{9.8 m/s^2} + \\degree', { szPt: 18 });
    assert.ok(r.ok, r.error);
    assert.ok(r.body.includes('m/s'), '应包含兼容替换后的文本');
  });

  check('KaTeX 不支持的公式优雅失败（不抛异常）', () => {
    const r = latexToOmml('\\frac{a}{', { display: true });
    assert.strictEqual(r.ok, false);
    assert.ok(r.error && r.error.length > 0, '应带错误信息');
    assert.strictEqual(r.xml, '');
  });

  await checkAsync('生成：公式页变原生 OMML（含行内与块级），且无残留占位符', async () => {
    const slides = parser.parseMarkdown(V22_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-omml.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer() });
    assert.ok(res.omml.display >= 1, `应有块级公式，实际 ${res.omml.display}`);
    assert.ok(res.omml.inline >= 1, `应有行内公式，实际 ${res.omml.inline}`);
    assert.strictEqual(res.omml.failed, 0, '本次样本不应有转换失败');
    const zip = await zipOf(outPath);
    let a14 = 0;
    let para = 0;
    let leftover = 0;
    for (let i = 1; i <= res.slideCount; i++) {
      const x = await slideXml(zip, i);
      a14 += (x.match(/<a14:m[\s>]/g) || []).length;
      para += (x.match(/<m:oMathPara[\s>]/g) || []).length;
      if (/⟦MATH:/.test(x)) leftover++;
      assert.ok(!/<w:/.test(x), `slide${i} 出现 w: 命名空间`);
    }
    assert.strictEqual(a14, res.omml.display + res.omml.inline, 'a14:m 数量应等于公式数');
    assert.strictEqual(para, res.omml.display, '块级公式数量对得上');
    assert.strictEqual(leftover, 0, '不应残留 ⟦MATH:n⟧ 占位符');
  });

  await checkAsync('omml-fallback：块级公式带 mc:AlternateContent + 图片兜底', async () => {
    const slides = parser.parseMarkdown(V22_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-omml-fb.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer(), formulaMode: 'omml-fallback' });
    assert.ok(res.omml.fallbackImages >= 1, `应有兜底图，实际 ${res.omml.fallbackImages}`);
    const zip = await zipOf(outPath);
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\/a14math/.test(n));
    assert.strictEqual(media.length, res.omml.fallbackImages, '兜底图文件数应对得上');
    let alt = 0;
    let blip = 0;
    for (let i = 1; i <= res.slideCount; i++) {
      const x = await slideXml(zip, i);
      alt += (x.match(/<mc:AlternateContent/g) || []).length;
      blip += (x.match(/<a:blip r:embed="rIdA14_/g) || []).length;
    }
    assert.strictEqual(alt, res.omml.fallbackImages, 'AlternateContent 数量');
    assert.strictEqual(blip, res.omml.fallbackImages, '兜底图引用数量');
    const rels = await zip.file('ppt/slides/_rels/slide2.xml.rels').async('string');
    assert.ok(/rIdA14_/.test(rels), 'rels 里应有兜底图关系');
  });

  await checkAsync('formulaMode=image：老路径完全不变（整页出图）', async () => {
    const slides = parser.parseMarkdown(V22_MD, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-image.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { renderer: makeStubRenderer(), formulaMode: 'image' });
    assert.strictEqual(res.omml.display + res.omml.inline, 0, 'image 模式不应产生 OMML');
    const zip = await zipOf(outPath);
    const media = Object.keys(zip.files).filter((n) => /^ppt\/media\/[^/]+\.png$/.test(n));
    assert.ok(media.length >= 2, `图片模式应有多张整页图，实际 ${media.length}`);
    for (let i = 1; i <= res.slideCount; i++) {
      assert.ok(!/<a14:m[\s>]/.test(await slideXml(zip, i)), '不应携带 OMML');
    }
  });

  console.log('\n[11] v2.2：点击出现动画');

  await checkAsync('默认：纯文本分步页合成一页 + p:timing 点击序列', async () => {
    const md = '## 分步\n\n- 甲\n- 乙 <2->\n- 丙 <3->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-anim.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, {});
    assert.strictEqual(res.slideCount, 2, `封面 + 1 页动画（不是 3 页），实际 ${res.slideCount}`);
    assert.strictEqual(res.animation.slides, 1, '应有 1 页带动画');
    assert.strictEqual(res.animation.shapes, 2, '第 2、3 步各一个形状要"点出来"');
    const zip = await zipOf(outPath);
    const s2 = await slideXml(zip, 2);
    assert.ok(s2.includes('<p:timing>'), '应写入 p:timing');
    assert.ok(s2.includes('nodeType="clickEffect"'), '应有点击触发效果');
    assert.ok(s2.includes('presetClass="entr"'), '应为进入动画（Appear）');
    assert.ok(s2.includes('style.visibility'), '应为可见性切换');
    assert.ok(!/⟦ANIM:/.test(s2), '动画标记必须被摘掉');
    const spids = [...s2.matchAll(/<p:spTgt spid="(\d+)"/g)].map((m) => m[1]);
    const ids = [...s2.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    for (const sp of spids) assert.ok(ids.includes(sp), `动画目标 spid=${sp} 必须真实存在`);
  });

  await checkAsync('animation=false：回到 v2.1 的逐页展开', async () => {
    const md = '## 分步\n\n- 甲\n- 乙 <2->\n- 丙 <3->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-anim-off.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, { animation: false });
    assert.strictEqual(res.slideCount, 4, '封面 + 3 步');
    const zip = await zipOf(outPath);
    for (let i = 1; i <= 4; i++) assert.ok(!(await slideXml(zip, i)).includes('<p:timing>'), '不应有动画');
  });

  await checkAsync('带公式的分步页不启用动画（公式页保持多页展开）', async () => {
    const md = '## 分步\n\n- 首项 $a$ <1->\n- 次项 $b$ <2->\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-anim-math.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, {});
    assert.strictEqual(res.slideCount, 3, '封面 + 2 步（含公式不走单页动画）');
    assert.strictEqual(res.animation.slides, 0);
  });

  console.log('\n[12] v2.2：目录页与页脚导航');

  check('解析：\\tableofcontents 生成目录页，条目来自二级标题', () => {
    const md = '# 标题\n\n\\tableofcontents\n\n## 甲\n\n内容\n\n## 乙\n\n内容\n';
    const parsed = parser.parseMarkdown(md, { fileName: 't.md' });
    const toc = parsed.slides.find((s) => s.layout === 'toc');
    assert.ok(toc, '应生成目录页');
    assert.strictEqual(toc.tocEntries.length, 2, `应有 2 条目录，实际 ${toc.tocEntries && toc.tocEntries.length}`);
    assert.deepStrictEqual(toc.tocEntries.map((e) => e.title), ['甲', '乙']);
  });

  check('解析：autoToc 在无 \\tableofcontents 时自动插到封面之后', () => {
    const md = '# 标题\n\n## 甲\n\n内容\n\n## 乙\n\n内容\n';
    const parsed = parser.parseMarkdown(md, { fileName: 't.md', autoToc: true });
    assert.strictEqual(parsed.slides[0].layout, 'cover');
    assert.strictEqual(parsed.slides[1].layout, 'toc', '目录应紧接封面');
    const off = parser.parseMarkdown(md, { fileName: 't.md', autoToc: false });
    assert.ok(!off.slides.some((s) => s.layout === 'toc'), '关闭时不生成');
  });

  await checkAsync('生成：目录页码回填 + 页脚章节导航 + 无残留标记', async () => {
    const md = '# 标题\n\n\\tableofcontents\n\n## 甲\n\n内容一\n\n## 乙\n\n内容二\n';
    const slides = parser.parseMarkdown(md, { fileName: 't.md' }).slides;
    const outPath = path.join(OUT_DIR, 'v22-toc.pptx');
    const res = await generatePptx(slides, 'tech-blue', outPath, {});
    assert.strictEqual(res.toc.entries, 2);
    const zip = await zipOf(outPath);
    const s2 = await slideXml(zip, 2);
    assert.ok(s2.includes('目录'), '第 2 页应是目录');
    assert.ok(!/⟪P:\d+⟧/.test(s2), '目录页码标记必须被回填');
    // 页脚应同时含章节名与页码
    const s3 = await slideXml(zip, 3);
    assert.ok(/甲/.test(s3), '页脚应显示当前章节名');
    assert.ok(s3.includes(`3 / ${res.slideCount}`), '页脚应有真实页码分母');
  });

  console.log('\n[13] v2.2：文献引用');

  check('bib：解析 .bib（嵌套花括号 / and 切分 / 中文作者）', () => {
    const r = bib.parseBib(BIB_TEXT);
    assert.strictEqual(r.warnings.length, 0, `不应有告警：${r.warnings.join(';')}`);
    assert.ok(r.entries.zhang2020 && r.entries.li2021, '两个条目都要解析出来');
    assert.ok(r.entries.zhang2020.fields.title, '应有标题');
  });

  check('bib：编号按首次引用顺序，重复引用同号，未知 key 记 missing', () => {
    const reg = bib.makeRegistry(bib.parseBib(BIB_TEXT).entries);
    const a = bib.citeNumbers(['li2021'], reg);
    const b = bib.citeNumbers(['zhang2020'], reg);
    const c = bib.citeNumbers(['li2021'], reg);
    const d = bib.citeNumbers(['nope'], reg);
    assert.deepStrictEqual(a.numbers, [1]);
    assert.deepStrictEqual(b.numbers, [2]);
    assert.deepStrictEqual(c.numbers, [1], '重复引用应复用编号');
    assert.deepStrictEqual(d.numbers, []);
    assert.deepStrictEqual(d.missing, ['nope']);
  });

  check('解析：\\cite / [@key] / \\citet 被替换成编号', () => {
    const md = '# 标题\n\n## 甲\n\n由 \\cite{li2021} 与 [@zhang2020] 可知，另见 \\citet{li2021}。\n';
    const reg = bib.makeRegistry(bib.parseBib(BIB_TEXT).entries);
    const parsed = parser.parseMarkdown(md, { fileName: 't.md', bibRegistry: reg });
    const text = parsed.slides.flatMap((s) => s.blocks).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    assert.ok(text.includes('[1]'), `\\cite 应变成 [1]：${text}`);
    assert.ok(text.includes('[2]'), `[@key] 应变成 [2]：${text}`);
    assert.ok(!/\\cite/.test(text), '不应残留 \\cite');
    assert.strictEqual(parsed.stats.unresolvedCites.length, 0);
  });

  check('解析：未定义的引用键 → [?] 并告警', () => {
    const reg = bib.makeRegistry(bib.parseBib(BIB_TEXT).entries);
    const parsed = parser.parseMarkdown('# 标题\n\n## 甲\n\n见 \\cite{nobody2099}。\n', { fileName: 't.md', bibRegistry: reg });
    const text = parsed.slides.flatMap((s) => s.blocks).map((b) => b.text || '').join(' ');
    assert.ok(text.includes('[?]'), `未定义应显示 [?]：${text}`);
    assert.deepStrictEqual(parsed.stats.unresolvedCites, ['nobody2099']);
  });

  await checkAsync('生成：自动追加参考文献页，条目按编号排列', async () => {
    const reg = bib.makeRegistry(bib.parseBib(BIB_TEXT).entries);
    const md = '# 标题\n\n## 甲\n\n见 \\cite{li2021} 与 \\cite{zhang2020}。\n';
    const parsed = parser.parseMarkdown(md, { fileName: 't.md', bibRegistry: reg });
    assert.ok(parsed.slides.some((s) => s.layout === 'refs'), '应自动追加参考文献页');
    const outPath = path.join(OUT_DIR, 'v22-refs.pptx');
    const res = await generatePptx(parsed.slides, 'tech-blue', outPath, {});
    const zip = await zipOf(outPath);
    let found = '';
    for (let i = 1; i <= res.slideCount; i++) {
      const x = await slideXml(zip, i);
      if (/参考文献/.test(x)) found = x;
    }
    assert.ok(found, '应有参考文献页');
    assert.ok(/\[1\]/.test(found) && /\[2\]/.test(found), '条目应带编号');
    assert.ok(!/⟦/.test(found), '不应有残留标记');
  });

  console.log('\n[14] v2.2：算法伪代码');

  check('解析：\\begin{algorithm} → 带缩进与语义的行', () => {
    const md = '# t\n\n## 甲\n\n\\begin{algorithm}[快速排序]\\label{alg:q}\n\\Require 数组 $A$\n\\If{$p<r$}\n  \\State $q \\gets 1$\n\\EndIf\n\\end{algorithm}\n\n见算法 \\ref{alg:q}。\n';
    const parsed = parser.parseMarkdown(md, { fileName: 't.md' });
    const algo = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'algo');
    assert.ok(algo, '应产出 algo 块');
    assert.strictEqual(algo.number, 1, '算法应编号');
    assert.strictEqual(algo.title, '快速排序');
    const kinds = algo.lines.map((l) => l.kind);
    assert.ok(kinds.includes('io'), '有输入/输出行');
    assert.ok(kinds.includes('if') && kinds.includes('endif'), '有 if/end if');
    assert.strictEqual(algo.lines.find((l) => l.kind === 'state').indent, 1, 'if 内的语句应缩进一级');
    assert.ok(algo.lines[0].text.includes('输入：'), '\\Require 应变成"输入："');
    const text = parsed.slides.flatMap((s) => s.blocks).map((b) => b.text || '').join(' ');
    assert.ok(text.includes('算法 1'), `\\ref{alg:q} 应变成"算法 1"：${text}`);
  });

  check('渲染：算法块输出行号/关键字/注释样式', () => {
    const md = '# t\n\n## 甲\n\n\\begin{algorithm}[X]\n\\State 初始化\n\\For{$i=1$ to $n$}\n\\State \\Comment{循环体}\n\\EndFor\n\\end{algorithm}\n';
    const parsed = parser.parseMarkdown(md, { fileName: 't.md' });
    const algo = parsed.slides.flatMap((s) => s.blocks).find((b) => b.type === 'algo');
    const html = richHtml.blockToHtml(algo);
    assert.ok(html.includes('class="algo"'), '应有 algo 容器');
    assert.ok(html.includes('algo-no'), '应有行号');
    assert.ok(html.includes('algo-kw'), '关键字应着色');
    assert.ok(html.includes('data-tex'), '行内公式应进入公式管线');
    assert.ok(html.includes('算法 1'), '标题应含编号');
  });

  console.log('\n[15] v2.2：产物完整性');

  await checkAsync('综合走查：任何生成物都不得残留占位符/标记/哨兵', async () => {
    const reg = bib.makeRegistry(bib.parseBib(BIB_TEXT).entries);
    const parsed = parser.parseMarkdown(V22_MD, { fileName: 't.md', autoToc: true, bibRegistry: reg });
    const outPath = path.join(OUT_DIR, 'v22-all.pptx');
    const res = await generatePptx(parsed.slides, 'gradient-purple', outPath, { renderer: makeStubRenderer() });
    const zip = await zipOf(outPath);
    for (let i = 1; i <= res.slideCount; i++) {
      const x = await slideXml(zip, i);
      assert.ok(!/⟦MATH:\d+⟧/.test(x), `slide${i} 残留公式占位符`);
      assert.ok(!/⟦ANIM:\d+⟧/.test(x), `slide${i} 残留动画标记`);
      assert.ok(!/⟪[TP]:?/.test(x), `slide${i} 残留哨兵/页码标记`);
      assert.ok(!/<w:/.test(x), `slide${i} 含 Word 命名空间`);
    }
    assert.ok(res.toc.entries >= 2, '应有目录条目');
  });

  check('postProcess：token 替换与页数分母自洽', async () => {
    const p = path.join(OUT_DIR, 'v22-token.pptx');
    const slides = parser.parseMarkdown('# t\n\n## 甲\n\n正文 A\n\n## 乙\n\n正文 B\n', { fileName: 't.md' }).slides;
    await generatePptx(slides, 'minimal-gray', p, {});
    const zip = await zipOf(p);
    const xml = await slideXml(zip, 1);
    assert.ok(!/⟪T⟫/.test(xml), '总页数哨兵应被替换');
    assert.ok(/1 \/ \d+/.test(xml), '封面应有页码');
  });
}

// ================= 主入口 =================
(async () => {
  await testParserV1();
  await testParserV2();
  await testLatexCompat();
  await testRichHtml();
  await testAi();
  await testGenerator();
  await testFlow();
  await testV21();
  await testOverlayGeneration();
  await testV22();
  console.log(`\n================\n通过 ${passed}，失败 ${failed}\n================`);
  process.exit(failed ? 1 : 0);
})();



