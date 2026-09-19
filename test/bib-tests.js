/**
 * test/bib-tests.js
 * shared/bib.js 的纯 Node 单元测试（无需 Electron）：
 *   node test/bib-tests.js
 * 覆盖：BibTeX 嵌套花括号 / 引号值 / 纯数字值 / and 切分 / 引用抽取（含行内代码屏蔽）
 *       编号登记（重复同号、未知进 missing）/ formatEntry 标点 / Markdown 列表转换 / 空输入健壮性
 */
'use strict';

const bib = require('../shared/bib.js');

let passed = 0;
let failed = 0;

function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(e && e.message) || e}`);
  }
}

/* ------------------------------ 极简断言 ------------------------------ */
function fail(msg) { throw new Error(msg); }

function eq(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label || '值'} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function deepEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${label || '值'} 期望 ${b}，实际 ${a}`);
}

function truthy(v, label) {
  if (!v) fail(`${label || '值'} 应为真，实际 ${JSON.stringify(v)}`);
}

function falsy(v, label) {
  if (v) fail(`${label || '值'} 应为假，实际 ${JSON.stringify(v)}`);
}

/* ------------------------------ 测试数据 ------------------------------ */

const BIB_TEXT = [
  '% 这是注释行，应被忽略',
  '@string{jt = {计算机学报}}',
  '@comment{ 整段忽略：@article{ghost, title = {不该出现}} }',
  '',
  '@article{zhang2020,',
  '  author  = {张三 and 李四},',
  '  title   = {A {GPU}-based Method},',
  '  journal = "计算机学报",',
  '  year    = 2020,',
  '  doi     = {10.1000/xyz},',
  '  url     = {https://example.com/a},',
  '  note    = "含逗号, 与 {括号} 的值"',
  '}',
  '',
  '@book{wang2021,',
  '  AUTHOR    = {Wang Wu},',
  '  TiTle     = "Deep Learning",',
  '  publisher = {Springer},',
  '  year      = 2021',
  '}',
  '',
  '@inproceedings{li2019,',
  '  author    = {Li Si and Zhao Liu and Sun Qi and Zhou Ba},',
  '  title     = {A Study of {A, B} and {C}},',
  '  booktitle = {Proc. of {IEEE} Conf.},',
  '  year      = {2019}',
  '}',
  '',
  '@misc(paren, title = {圆括号形式的条目}, year = 2022)'
].join('\n');

const parsed = bib.parseBib(BIB_TEXT);
const E = parsed.entries;

/* ==================================================================== */
console.log('\n[1] parseBib');

ok('基础条目：类型 / 键 / 字段', () => {
  truthy(E.zhang2020, 'zhang2020 应存在');
  eq(E.zhang2020.key, 'zhang2020', 'key');
  eq(E.zhang2020.type, 'article', 'type');
});

ok('嵌套花括号：title = {A {GPU}-based Method}', () => {
  eq(E.zhang2020.fields.title, 'A {GPU}-based Method', 'title');
});

ok('双引号值与花括号内的逗号 / 括号', () => {
  eq(E.zhang2020.fields.journal, '计算机学报', 'journal');
  eq(E.zhang2020.fields.note, '含逗号, 与 {括号} 的值', 'note');
});

ok('纯数字值解析为字符串 2020', () => {
  eq(E.zhang2020.fields.year, '2020', 'year');
  eq(typeof E.zhang2020.fields.year, 'string', 'year 类型');
});

ok('字段名大小写不敏感（AUTHOR / TiTle）', () => {
  eq(E.wang2021.fields.author, 'Wang Wu', 'author');
  eq(E.wang2021.fields.title, 'Deep Learning', 'title');
  eq(E.wang2021.fields.AUTHOR, undefined, '不应保留大写字段名');
});

ok('多层嵌套花括号且花括号内含逗号', () => {
  eq(E.li2019.fields.title, 'A Study of {A, B} and {C}', 'title');
  eq(E.li2019.fields.booktitle, 'Proc. of {IEEE} Conf.', 'booktitle');
});

ok('@string 被忽略且进入 warnings', () => {
  eq(E.jt, undefined, '不应产生 jt 条目');
  truthy(parsed.warnings.some((w) => w.indexOf('@string') >= 0), 'warnings 应提到 @string');
});

ok('@comment{...} 整段忽略（内含的 @article 不产生条目）', () => {
  eq(E.ghost, undefined, 'ghost 不应存在');
});

ok('% 注释行不影响解析', () => {
  truthy(E.zhang2020 && E.wang2021 && E.li2019, '三条例目都应在');
});

ok('类型不敏感，原样保留（book / inproceedings）', () => {
  eq(E.wang2021.type, 'book', 'book 类型');
  eq(E.li2019.type, 'inproceedings', 'inproceedings 类型');
});

ok('圆括号形式的条目 @misc(...)', () => {
  eq(E.paren.type, 'misc', 'type');
  eq(E.paren.fields.title, '圆括号形式的条目', 'title');
  eq(E.paren.fields.year, '2022', 'year');
});

ok('保留原始片段 entry.raw', () => {
  truthy(E.zhang2020.raw.indexOf('@article{zhang2020') === 0, 'raw 应以 @article{zhang2020 开头');
  truthy(E.zhang2020.raw.charAt(E.zhang2020.raw.length - 1) === '}', 'raw 应以 } 结尾');
  truthy(E.paren.raw.indexOf('@misc(paren') === 0, 'raw 应保留圆括号原文');
});

ok('损坏条目只进 warnings，不抛异常且不阻断后续条目', () => {
  const bad = bib.parseBib([
    '@article{broken, title {缺少等号}}',
    '@article{good, title = {好条目}, year = 2020}',
    '@article{, title = {缺键}}',
    '@article{unclosed, title = {未闭合}'
  ].join('\n'));
  eq(bad.entries.broken, undefined, 'broken 不应产生条目');
  eq(bad.entries.good.fields.title, '好条目', 'good 应正常解析');
  truthy(bad.warnings.length >= 3, `warnings 至少 3 条，实际 ${bad.warnings.length}`);
});

ok('空输入安全', () => {
  eq(Object.keys(bib.parseBib('').entries).length, 0, '空字符串');
  eq(bib.parseBib(null).warnings.length, 0, 'null');
  eq(Object.keys(bib.parseBib(undefined).entries).length, 0, 'undefined');
  eq(Object.keys(bib.parseBib('随便一段没有 @ 的文本').entries).length, 0, '无 @ 的文本');
});

/* ==================================================================== */
console.log('\n[2] makeRegistry');

ok('首次引用按顺序分配编号 1、2', () => {
  const reg = bib.makeRegistry(E);
  eq(reg.cite('zhang2020'), 1, '第一次');
  eq(reg.cite('wang2021'), 2, '第二次');
  deepEq(reg.order(), ['zhang2020', 'wang2021'], 'order()');
});

ok('重复引用同一 key 返回同号', () => {
  const reg = bib.makeRegistry(E);
  eq(reg.cite('li2019'), 1, '首次');
  eq(reg.cite('li2019'), 1, '重复');
  eq(reg.cite('li2019'), 1, '再重复');
  deepEq(reg.order(), ['li2019'], 'order() 只含一个 key');
});

ok('未知 key 返回 null 并进 missing()', () => {
  const reg = bib.makeRegistry(E);
  eq(reg.cite('zhang2020'), 1, '正常 key');
  eq(reg.cite('nope'), null, '未知 key');
  eq(reg.cite('nope'), null, '重复未知 key 仍为 null');
  deepEq(reg.missing(), ['nope'], 'missing 去重');
  deepEq(reg.order(), ['zhang2020'], '未知 key 不占用编号');
});

ok('lookup() 命中与未命中', () => {
  const reg = bib.makeRegistry(E);
  eq(reg.lookup('zhang2020'), E.zhang2020, '命中应返回同一条目');
  eq(reg.lookup('nope'), null, '未命中返回 null');
  eq(reg.lookup(''), null, '空 key 返回 null');
});

ok('cited 为按首次引用顺序的实时数组', () => {
  const reg = bib.makeRegistry(E);
  eq(reg.cited.length, 0, '初始为空');
  reg.cite('wang2021');
  reg.cite('zhang2020');
  deepEq(reg.cited, ['wang2021', 'zhang2020'], 'cited');
  deepEq(reg.order(), ['wang2021', 'zhang2020'], 'order() 同步');
});

ok('lines() 按编号顺序输出带 [n] 的条目文本', () => {
  const reg = bib.makeRegistry(E);
  reg.cite('zhang2020');
  reg.cite('wang2021');
  const ls = reg.lines();
  eq(ls.length, 2, '行数');
  truthy(ls[0].indexOf('[1] 张三, 李四.') === 0, `第 1 行：${ls[0]}`);
  truthy(ls[0].indexOf('计算机学报, 2020') >= 0, '含期刊与年份');
  truthy(ls[1].indexOf('[2] Wang Wu. Deep Learning. Springer, 2021.') === 0, `第 2 行：${ls[1]}`);
});

ok('注册表容错（null / 非对象）', () => {
  const reg = bib.makeRegistry(null);
  eq(reg.cite('a'), null, 'cite');
  eq(reg.lookup('a'), null, 'lookup');
  deepEq(reg.order(), [], 'order');
  deepEq(reg.lines(), [], 'lines');
  deepEq(reg.missing(), ['a'], '查不到的 key 记入 missing');
});

/* ==================================================================== */
console.log('\n[3] extractCitationKeys');

ok('\\cite{a,b} 抽取多个 key', () => {
  const r = bib.extractCitationKeys('见 \\cite{a,b}。');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['a', 'b'], 'keys');
  eq(r[0].cmd, 'cite', 'cmd');
  eq(r[0].raw, '\\cite{a,b}', 'raw');
  eq(r[0].start, 2, 'start');
  eq(r[0].end, 2 + '\\cite{a,b}'.length, 'end');
});

ok('\\cite[p.3]{a} 可选参数被吃掉且不计入 key', () => {
  const r = bib.extractCitationKeys('见 \\cite[p.3]{a} 处');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['a'], 'keys');
  eq(r[0].raw, '\\cite[p.3]{a}', 'raw');
});

ok('多个可选参数 \\citep[see][p. 3]{a,b}', () => {
  const r = bib.extractCitationKeys('\\citep[see][p. 3]{a, b}');
  deepEq(r[0].keys, ['a', 'b'], 'keys');
  eq(r[0].cmd, 'citep', 'cmd');
});

ok('\\cite*{a} 与 \\citet / \\footcite 的 cmd', () => {
  deepEq(bib.extractCitationKeys('\\cite*{a}')[0].keys, ['a'], 'cite* keys');
  eq(bib.extractCitationKeys('\\cite*{a}')[0].cmd, 'cite', 'cite* cmd');
  eq(bib.extractCitationKeys('\\citet{a}')[0].cmd, 'citet', 'citet');
  eq(bib.extractCitationKeys('\\footcite{a}')[0].cmd, 'footcite', 'footcite');
});

ok('\\citetext{a} 不被误判为 \\cite', () => {
  deepEq(bib.extractCitationKeys('\\citetext{a}'), [], '不应匹配');
});

ok('Markdown 风格 [@a]', () => {
  const r = bib.extractCitationKeys('见 [@a]。');
  eq(r.length, 1, '匹配数');
  eq(r[0].cmd, 'bracket', 'cmd');
  deepEq(r[0].keys, ['a'], 'keys');
  eq(r[0].raw, '[@a]', 'raw');
  eq(r[0].start, 2, 'start');
  eq(r[0].end, 6, 'end');
});

ok('Markdown 风格 [@a; @b] 抽出两个 key', () => {
  const r = bib.extractCitationKeys('见 [@a; @b]。');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['a', 'b'], 'keys');
});

ok('Markdown 风格 [@a, p. 3] 页码不计入 key', () => {
  deepEq(bib.extractCitationKeys('[@a, p. 3]')[0].keys, ['a'], 'keys');
  deepEq(bib.extractCitationKeys('[-@a]')[0].keys, ['a'], '抑制作者前缀');
});

ok('行内代码里的 \\cite 被忽略', () => {
  const r = bib.extractCitationKeys('示例 `\\cite{a}` 与 \\cite{b}');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['b'], 'keys');
});

ok('三反引号代码块里的引用也被忽略', () => {
  const r = bib.extractCitationKeys('```\n\\cite{a}\n[@c]\n```\n\\cite{b}');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['b'], 'keys');
});

ok('行内代码里的 [@a] 同样被忽略', () => {
  const r = bib.extractCitationKeys('文本 `[@a]` 结尾 [@b]');
  eq(r.length, 1, '匹配数');
  deepEq(r[0].keys, ['b'], 'keys');
});

ok('Markdown 链接 [a@b](url) 不算引用', () => {
  deepEq(bib.extractCitationKeys('[a@b](http://x.com)'), [], '不应匹配');
});

ok('结果按 start 升序且区间不重叠', () => {
  const r = bib.extractCitationKeys('\\cite{a} 与 [@b] 与 \\citet{c}');
  eq(r.length, 3, '匹配数');
  truthy(r[0].start < r[1].start && r[1].start < r[2].start, 'start 升序');
  for (let i = 1; i < r.length; i++) {
    truthy(r[i].start >= r[i - 1].end, '区间不重叠');
  }
});

ok('空输入返回空数组', () => {
  deepEq(bib.extractCitationKeys(''), [], '空字符串');
  deepEq(bib.extractCitationKeys(null), [], 'null');
  deepEq(bib.extractCitationKeys('没有引用的正文'), [], '无引用');
});

/* ==================================================================== */
console.log('\n[4] citeNumbers');

ok("citeNumbers(['a','b','zz']) 未知 key 进 missing", () => {
  const reg = bib.makeRegistry({ a: { key: 'a', type: 'misc', fields: {} }, b: { key: 'b', type: 'misc', fields: {} } });
  const r = bib.citeNumbers(['a', 'b', 'zz'], reg);
  deepEq(r.numbers, [1, 2], 'numbers');
  deepEq(r.missing, ['zz'], 'missing');
  deepEq(reg.missing(), ['zz'], 'registry.missing()');
});

ok('citeNumbers 重复 key 返回同一编号', () => {
  const reg = bib.makeRegistry({ a: { key: 'a', type: 'misc', fields: {} } });
  deepEq(bib.citeNumbers(['a', 'a'], reg).numbers, [1, 1], 'numbers');
  deepEq(bib.citeNumbers(['a'], reg).missing, [], 'missing 为空');
});

ok('citeNumbers 缺省入参安全', () => {
  deepEq(bib.citeNumbers([], bib.makeRegistry(E)), { numbers: [], missing: [] }, '空数组');
  deepEq(bib.citeNumbers(null, bib.makeRegistry(E)), { numbers: [], missing: [] }, 'null');
  deepEq(bib.citeNumbers(['a', ''], null), { numbers: [], missing: ['a'] }, '无 registry');
});

/* ==================================================================== */
console.log('\n[5] formatEntry');

ok('完整条目格式（无 [n] 前缀）', () => {
  const s = bib.formatEntry(E.zhang2020, 1);
  truthy(s.indexOf('张三, 李四. A GPU-based Method. 计算机学报, 2020.') === 0, `实际：${s}`);
  truthy(s.indexOf('[1]') < 0, '不应带编号前缀');
});

ok('嵌套花括号被清理为纯文本', () => {
  const s = bib.formatEntry({ type: 'article', fields: { title: 'A {GPU}-based Method', journal: 'J', year: '2020' } });
  eq(s, 'A GPU-based Method. J, 2020.', '格式化结果');
});

ok('缺字段跳过，无多余空标点 / undefined', () => {
  const s = bib.formatEntry({ type: 'misc', fields: { author: 'A', title: 'B' } });
  eq(s, 'A. B.', '格式化结果');
  truthy(s.indexOf('undefined') < 0, '不应出现 undefined');
  truthy(!/\.\./.test(s), '不应出现连续句号');
  truthy(!/,\s*\./.test(s), '不应出现空标点');
});

ok('无任何字段时返回空字符串', () => {
  eq(bib.formatEntry({ type: 'misc', fields: {} }), '', '空字段');
  eq(bib.formatEntry(null, 1), '', 'null 条目');
  eq(bib.formatEntry({ title: '   ' }, 1), '', '纯空白标题');
});

ok('最后一段已以句号结尾时不重复', () => {
  const s = bib.formatEntry({ fields: { title: 'A Method.', journal: 'J', year: '2020' } });
  eq(s, 'A Method. J, 2020.', '格式化结果');
  truthy(!/\.\./.test(s), '不应出现连续句号');
});

ok('作者超过 3 人：英文用 et al.', () => {
  const s = bib.formatEntry(E.li2019, 2);
  truthy(s.indexOf('Li Si, Zhao Liu, Sun Qi et al. A Study of A, B and C.') === 0, `实际：${s}`);
});

ok('作者超过 3 人：中文用「等」', () => {
  const s = bib.formatEntry({ fields: { author: '张三 and 李四 and 王五 and 赵六', title: '标题' } });
  eq(s, '张三, 李四, 王五 等. 标题.', '格式化结果');
});

ok('恰好 3 人不截断', () => {
  const s = bib.formatEntry({ fields: { author: 'A and B and C', title: 'T' } });
  eq(s, 'A, B, C. T.', '格式化结果');
});

ok('and 切分不误伤 Anderson 这类词', () => {
  eq(bib.formatEntry({ fields: { author: 'Anderson', title: 'T' } }), 'Anderson. T.', '单个作者');
  eq(bib.formatEntry({ fields: { author: 'Anderson and Li', title: 'T' } }), 'Anderson, Li. T.', '两个作者');
});

ok('URL 用 <...> 包裹，DOI 前缀 doi:', () => {
  const s = bib.formatEntry(E.zhang2020, 1);
  truthy(s.indexOf('<https://example.com/a>') >= 0, `应含尖括号 URL：${s}`);
  truthy(s.indexOf('doi:10.1000/xyz') >= 0, '应含 DOI');
  const onlyUrl = bib.formatEntry({ fields: { title: 'T', url: 'https://a.com' } });
  eq(onlyUrl, 'T. <https://a.com>.', '仅 URL');
});

ok('出处优先级：booktitle 优先于 publisher', () => {
  eq(
    bib.formatEntry({ fields: { title: 'T', booktitle: 'BT', publisher: 'P', year: '2020' } }),
    'T. BT, 2020.',
    '格式化结果'
  );
});

/* ==================================================================== */
console.log('\n[6] toBibEntryFromMd');

ok('`- [1] 张三. 标题. 2020.` 形式', () => {
  const es = bib.toBibEntryFromMd(['- [1] 张三. 标题. 2020.']);
  deepEq(Object.keys(es), ['md1'], '自动 key');
  eq(es.md1.fields.title, '张三. 标题. 2020.', '序号被剥离');
  eq(es.md1.type, 'misc', 'type');
  eq(es.md1.raw, '- [1] 张三. 标题. 2020.', 'raw 保留整行');
});

ok('`1. 张三...` 形式', () => {
  const es = bib.toBibEntryFromMd(['1. 李四. 论文题目. 2019.', '2) 王五. 另一篇. 2018.']);
  deepEq(Object.keys(es), ['md1', 'md2'], '自动 key');
  eq(es.md1.fields.title, '李四. 论文题目. 2019.', '第一条');
  eq(es.md2.fields.title, '王五. 另一篇. 2018.', '第二条');
});

ok('`[key] 张三...` 形式用 [key] 作引用键', () => {
  const es = bib.toBibEntryFromMd(['[zhang2020] 张三. 标题. 2020.']);
  deepEq(Object.keys(es), ['zhang2020'], 'key');
  eq(es.zhang2020.fields.title, '张三. 标题. 2020.', 'title');
});

ok('混合三种形式 + 空行忽略', () => {
  const es = bib.toBibEntryFromMd([
    '## 参考文献',
    '',
    '- [1] 张三. 标题. 2020.',
    '   ',
    '2. 李四. 论文. 2019.',
    '[wang2020] 王五. 研究. 2018.'
  ]);
  deepEq(Object.keys(es), ['md1', 'md2', 'wang2020'], 'key 序列');
  eq(es.md1.fields.title, '张三. 标题. 2020.', '第一条 title');
});

ok('年份开头的行不被当作序号剥掉', () => {
  const es = bib.toBibEntryFromMd(['2020. 张三. 标题.']);
  eq(es.md1.fields.title, '2020. 张三. 标题.', 'title');
});

ok('只有标记行时也不会产生空 title', () => {
  const es = bib.toBibEntryFromMd(['- ', '2.']);
  eq(es.md1.fields.title, '-', '第一行退回原文');
  eq(es.md2.fields.title, '2.', '第二行退回原文');
});

ok('空输入不崩且不为空数组以外的结构', () => {
  deepEq(bib.toBibEntryFromMd([]), {}, '空数组');
  deepEq(bib.toBibEntryFromMd(null), {}, 'null');
  deepEq(bib.toBibEntryFromMd(['', '   ', '\t']), {}, '全空白行');
});

/* ==================================================================== */
console.log('\n[7] formatCitation');

ok("style='citet' 返回「作者 [编号]」", () => {
  const reg = bib.makeRegistry({ solo: { key: 'solo', type: 'misc', fields: { author: '张三' } } });
  eq(reg.cite('solo'), 1, '编号');
  eq(bib.formatCitation(reg.lookup('solo'), 'citet'), '张三 [1]', 'citet');
});

ok('其它 style 只返回 [编号]', () => {
  const reg = bib.makeRegistry({ solo: { key: 'solo', type: 'misc', fields: { author: '张三' } } });
  reg.cite('solo');
  eq(bib.formatCitation(reg.lookup('solo'), 'cite'), '[1]', 'cite');
  eq(bib.formatCitation(reg.lookup('solo'), 'bracket'), '[1]', 'bracket');
  eq(bib.formatCitation(reg.lookup('solo'), undefined), '[1]', '缺省');
});

ok('无编号时用 [?] 占位且不抛异常', () => {
  eq(bib.formatCitation({ fields: { author: '张三' } }, 'citet'), '张三 [?]', 'citet');
  eq(bib.formatCitation(null, 'cite'), '[?]', 'null 条目');
  eq(bib.formatCitation({}, 'citet'), '[?]', '无作者');
});

/* ==================================================================== */
console.log('\n[8] 端到端：正文引用 -> 编号 -> 参考文献行');

ok('抽取 + 登记 + 生成参考文献行', () => {
  const reg = bib.makeRegistry(E);
  const text = '见 \\citet{zhang2020} 与 [@wang2021; @li2019]，另见 \\cite[p.2]{zhang2020} 以及 \\cite{unknown}。';
  const hits = bib.extractCitationKeys(text);
  deepEq(hits.map((h) => h.cmd), ['citet', 'bracket', 'cite', 'cite'], 'cmd 序列');
  const all = [];
  hits.forEach((h) => h.keys.forEach((k) => all.push(k)));
  const r = bib.citeNumbers(all, reg);
  deepEq(r.numbers, [1, 2, 3, 1], '按出现顺序编号，重复引用同号');
  deepEq(r.missing, ['unknown'], '未知 key');
  eq(reg.cited.length, 3, '共 3 条被引用');
  const ls = reg.lines();
  eq(ls.length, 3, '参考文献行数');
  truthy(ls[0].indexOf('[1] 张三, 李四.') === 0, `第 1 行：${ls[0]}`);
  truthy(ls[1].indexOf('[2] Wang Wu.') === 0, `第 2 行：${ls[1]}`);
  truthy(ls[2].indexOf('[3] Li Si') === 0, `第 3 行：${ls[2]}`);
});

ok('Markdown 参考文献列表可直接进注册表', () => {
  const md = bib.toBibEntryFromMd(['- [1] 张三. 标题. 2020.', '[wang2020] 王五. 研究. 2018.']);
  const reg = bib.makeRegistry(md);
  eq(reg.cite('wang2020'), 1, '编号');
  truthy(reg.lines()[0].indexOf('[1] 王五. 研究. 2018.') === 0, `实际：${reg.lines()[0]}`);
});

/* ==================================================================== */
console.log(`\n通过 ${passed} 项 / 失败 ${failed} 项\n`);
if (failed > 0) process.exitCode = 1;
