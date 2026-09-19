/**
 * shared/bib.js
 * 参考文献（BibTeX / Markdown 列表）自包含模块：
 *   - parseBib           解析 .bib 文本（嵌套花括号 / 引号值 / 纯数字值 / @comment / % 注释）
 *   - makeRegistry       引用登记表：首次引用分配编号（1 起），重复引用同号
 *   - extractCitationKeys 抽取正文引用位置（\cite 系列 与 [@key] 风格），跳过行内代码
 *   - citeNumbers        按传入顺序登记 key，返回编号与缺失 key
 *   - formatEntry        格式化单条条目（不含 [n] 前缀，编号由调用方拼接）
 *   - toBibEntryFromMd   把 Markdown 参考文献列表尽力转成 entries
 *   - formatCitation     生成 \citet 用的「作者 [编号]」片段
 *
 * 设计约定：
 *   - 纯 CommonJS、无第三方依赖；除 makeRegistry.cite 会给条目打上 number 外均为纯函数
 *   - 条目结构统一为 { type, key, fields: {小写字段名: 字符串}, raw }
 *   - 所有入口对 null/undefined/空输入都返回空结果，不抛异常
 * 供 main/* 与 renderer/* 共用；单元测试见 test/bib-tests.js
 */
'use strict';

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

/** 含 CJK 汉字即视为中文（用于「等」/“et al.” 判断） */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function isCjk(s) {
  return CJK_RE.test(String(s == null ? '' : s));
}

/** 求与 s[start] 匹配的收尾字符位置（嵌套安全，忽略 \{ \} 转义）；返回 -1 表示未闭合 */
function findMatching(s, start, open, close) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 生成带行号的 warning 文本 */
function warnAt(src, index, msg) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return `第 ${line} 行：${msg}`;
}

/**
 * 去掉 LaTeX 包裹与大小写保护花括号，得到可读纯文本
 *   {A {GPU}-based Method} -> A GPU-based Method
 *   \textit{Deep Learning} -> Deep Learning
 */
function plain(s) {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(str.slice(i));
      if (m) { i += m[0].length - 1; continue; } // 丢弃控制序列本身（保留其 {..} 内容）
      continue; // 丢弃转义用的反斜杠（\% -> %）
    }
    if (c === '{' || c === '}') continue;
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 去掉结尾的句号（中英文），用于拼接前清理 */
function stripTailDot(s) {
  return String(s == null ? '' : s).replace(/[.。．]+$/, '').trim();
}

/** 按标点感知的方式拼接各段，最后补一个句号（已有则不重复） */
function joinGroups(groups) {
  let out = '';
  for (const g of groups) {
    const t = String(g == null ? '' : g).trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    out += /[.。！？!?;,，、]$/.test(out) ? ' ' + t : '. ' + t;
  }
  if (!out) return '';
  return /[.。]$/.test(out) ? out : out + '.';
}

/* ------------------------------------------------------------------ */
/* 1. parseBib                                                         */
/* ------------------------------------------------------------------ */

/**
 * 读取一个字段值：{...}（嵌套安全）/ "..." / 纯数字 / 裸词，并支持 # 连接
 * @returns {{value:string,end:number}|{error:string}}
 */
function readValue(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  let out = '';
  for (;;) {
    const c = s[i];
    if (c === undefined) return { error: '字段值缺失' };
    if (c === '{') {
      const end = findMatching(s, i, '{', '}');
      if (end < 0) return { error: '字段值花括号未闭合' };
      out += s.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let depth = 0;
      let buf = '';
      let closed = false;
      for (; j < s.length; j++) {
        const d = s[j];
        if (d === '\\') { buf += d + (s[j + 1] || ''); j++; continue; }
        if (d === '{') depth++;
        else if (d === '}') { if (depth > 0) depth--; }
        else if (d === '"' && depth === 0) { closed = true; break; }
        buf += d;
      }
      if (!closed) return { error: '字段值引号未闭合' };
      out += buf;
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      out += s.slice(i, j);
      i = j;
    } else if (/[A-Za-z]/.test(c)) {
      // 裸词（@string 宏名或裸值）
      let j = i;
      while (j < s.length && /[A-Za-z0-9_\-.:+]/.test(s[j])) j++;
      out += s.slice(i, j);
      i = j;
    } else {
      return { error: `无法识别的字段值（${c}）` };
    }
    let k = i;
    while (k < s.length && /\s/.test(s[k])) k++;
    if (s[k] === '#') {
      i = k + 1;
      while (i < s.length && /\s/.test(s[i])) i++;
      continue;
    }
    i = k;
    break;
  }
  return { value: out.trim(), end: i };
}

/**
 * 解析单条条目的 body（花括号/圆括号内部内容）
 * @returns {{key:string,fields:Object}|{error:string}}
 */
function parseEntryBody(body) {
  const fields = {};
  let i = 0;

  function skipWs() {
    for (;;) {
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] === '%') {
        while (i < body.length && body[i] !== '\n') i++;
        continue;
      }
      break;
    }
  }

  skipWs();
  let key = '';
  while (i < body.length && body[i] !== ',' && body[i] !== '%' && !/\s/.test(body[i])) {
    key += body[i];
    i++;
  }
  key = key.trim();
  if (!key) return { error: '缺少引用键' };

  skipWs();
  if (body[i] === ',') i++;

  for (;;) {
    skipWs();
    while (body[i] === ',') { i++; skipWs(); }
    if (i >= body.length) break;

    let name = '';
    while (i < body.length && !/[\s=,{}()%]/.test(body[i])) { name += body[i]; i++; }
    if (!name) return { error: '缺少字段名' };
    skipWs();
    if (body[i] !== '=') return { error: `字段 ${name} 缺少 =` };

    const val = readValue(body, i + 1);
    if (val.error) return { error: `字段 ${name}：${val.error}` };
    i = val.end;
    fields[name.toLowerCase()] = val.value;
  }

  return { key, fields };
}

/**
 * 解析 BibTeX 文本
 * @param {string} text
 * @returns {{entries:Object<string,Object>, warnings:string[]}}
 */
function parseBib(text) {
  const src = String(text == null ? '' : text);
  const entries = {};
  const warnings = [];
  let i = 0;

  while (i < src.length) {
    if (src[i] === '%') { // 行注释
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] !== '@') { i++; continue; }

    const at = i;
    i++;
    const tm = /^[A-Za-z]+/.exec(src.slice(i));
    if (!tm) { i = at + 1; continue; } // 孤立的 @，跳过
    const type = tm[0];
    i += type.length;
    while (i < src.length && /\s/.test(src[i])) i++;

    const open = src[i];
    if (open !== '{' && open !== '(') {
      warnings.push(warnAt(src, at, `@${type} 后缺少 { 或 (`));
      continue;
    }
    const close = open === '{' ? '}' : ')';
    const bodyEnd = findMatching(src, i, open, close);
    if (bodyEnd < 0) {
      warnings.push(warnAt(src, at, `@${type} 条目未闭合`));
      break; // 之后的内容不可信，停止
    }
    const rawEnd = bodyEnd + 1;
    const body = src.slice(i + 1, bodyEnd);
    const raw = src.slice(at, rawEnd);
    i = rawEnd;

    const lower = type.toLowerCase();
    if (lower === 'comment') continue; // @comment{...} 静默忽略
    if (lower === 'string' || lower === 'preamble') {
      warnings.push(warnAt(src, at, `忽略 @${type}（不支持该指令）`));
      continue;
    }

    let parsed;
    try {
      parsed = parseEntryBody(body);
    } catch (e) {
      parsed = { error: (e && e.message) || String(e) };
    }
    if (!parsed || parsed.error) {
      warnings.push(warnAt(src, at, `@${type} 解析失败：${(parsed && parsed.error) || '未知错误'}`));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(entries, parsed.key)) {
      warnings.push(warnAt(src, at, `重复的引用键 ${parsed.key}（后者覆盖前者）`));
    }
    entries[parsed.key] = {
      type, // 类型不敏感，原样保留
      key: parsed.key,
      fields: parsed.fields,
      raw
    };
  }

  return { entries, warnings };
}

/* ------------------------------------------------------------------ */
/* 2. makeRegistry                                                     */
/* ------------------------------------------------------------------ */

/**
 * 引用登记表
 * @param {Object<string,Object>} entries parseBib 的 entries（或等价结构）
 */
function makeRegistry(entries) {
  const list = (entries && typeof entries === 'object') ? entries : {};
  const cited = [];                 // 按首次引用顺序的 key
  const numbers = new Map();        // key -> number
  const miss = [];                  // 被引用但库里没有的 key

  function lookup(key) {
    const k = String(key == null ? '' : key);
    return Object.prototype.hasOwnProperty.call(list, k) ? list[k] : null;
  }

  /** 首次引用分配编号（1 起）；重复引用同号；未知 key 返回 null */
  function cite(key) {
    const k = String(key == null ? '' : key).trim();
    if (!k) return null;
    if (numbers.has(k)) return numbers.get(k);
    if (!Object.prototype.hasOwnProperty.call(list, k)) {
      if (miss.indexOf(k) < 0) miss.push(k);
      return null;
    }
    const n = cited.length + 1;
    numbers.set(k, n);
    cited.push(k);
    const e = list[k];
    if (e && typeof e === 'object' && e.number === undefined) e.number = n; // 便于 formatCitation
    return n;
  }

  function order() {
    return cited.slice();
  }

  function lines() {
    return cited.map((k, idx) => {
      const e = list[k];
      const body = e ? formatEntry(e, idx + 1) : '';
      return `[${idx + 1}] ${body || k}`;
    });
  }

  function missing() {
    return miss.slice();
  }

  return { entries: list, cited, cite, lookup, order, lines, missing };
}

/* ------------------------------------------------------------------ */
/* 3. extractCitationKeys                                              */
/* ------------------------------------------------------------------ */

/** 找出被反引号包裹的代码区间 [start, end)，用于跳过其中的“引用” */
function codeRanges(s) {
  const ranges = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '`') { i++; continue; }
    let n = 0;
    while (s[i + n] === '`') n++;
    let j = i + n;
    let closeEnd = -1;
    while (j < s.length) {
      if (s[j] === '`') {
        let m = 0;
        while (s[j + m] === '`') m++;
        if (m === n) { closeEnd = j + m; break; }
        j += m;
        continue;
      }
      j++;
    }
    if (closeEnd < 0) { i += n; continue; } // 未闭合，视为普通字符
    ranges.push([i, closeEnd]);
    i = closeEnd;
  }
  return ranges;
}

function inRanges(pos, ranges) {
  for (const [a, b] of ranges) {
    if (pos >= a && pos < b) return true;
  }
  return false;
}

const LATEX_CITE_RE = /\\(footcite|citep|citet|cite)\b(\s*\*)?((?:\s*\[[^\]]*\])*)\s*\{([^{}]*)\}/g;
const BRACKET_CITE_RE = /\[([^\[\]]*@[^\[\]]*)\]/g;

/** `a, b , c` -> ['a','b','c']（去空、去重） */
function splitKeys(text) {
  const out = [];
  String(text == null ? '' : text).split(',').forEach((piece) => {
    const k = piece.trim().replace(/\s+/g, '');
    if (k && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}

/**
 * 抽取正文中的所有引用出现位置（按 start 升序，区间不重叠）
 * @param {string} text
 * @returns {Array<{keys:string[],cmd:string,raw:string,start:number,end:number}>}
 */
function extractCitationKeys(text) {
  const s = String(text == null ? '' : text);
  if (!s) return [];
  const ranges = codeRanges(s);
  const found = [];

  LATEX_CITE_RE.lastIndex = 0;
  let m;
  while ((m = LATEX_CITE_RE.exec(s)) !== null) {
    if (inRanges(m.index, ranges)) continue;
    const keys = splitKeys(m[4]);
    if (!keys.length) continue;
    found.push({
      keys,
      cmd: m[1].toLowerCase(),
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length
    });
  }

  BRACKET_CITE_RE.lastIndex = 0;
  while ((m = BRACKET_CITE_RE.exec(s)) !== null) {
    if (inRanges(m.index, ranges)) continue;
    const after = s[m.index + m[0].length];
    if (after === '(' || after === '[') continue; // Markdown 链接 [..](..)，不算引用
    const keys = [];
    // 以 ; 分段，段内识别 @key（段内其余内容视为页码/定位信息）
    m[1].split(';').forEach((seg) => {
      const km = /@([A-Za-z0-9_][A-Za-z0-9_:.\-+]*)/g;
      let kk;
      while ((kk = km.exec(seg)) !== null) {
        if (keys.indexOf(kk[1]) < 0) keys.push(kk[1]);
      }
    });
    if (!keys.length) continue;
    found.push({
      keys,
      cmd: 'bracket',
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length
    });
  }

  found.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  const out = [];
  let lastEnd = -1;
  for (const it of found) {
    if (it.start < lastEnd) continue; // 重叠丢弃
    out.push(it);
    lastEnd = it.end;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. citeNumbers                                                      */
/* ------------------------------------------------------------------ */

/**
 * 按传入顺序登记 key
 * @returns {{numbers:number[], missing:string[]}} 未知 key 只进 missing，不分配编号
 */
function citeNumbers(keys, registry) {
  const arr = Array.isArray(keys) ? keys : (keys == null ? [] : [keys]);
  const numbers = [];
  const missing = [];
  const reg = (registry && typeof registry.cite === 'function') ? registry : null;
  arr.forEach((k) => {
    const key = String(k == null ? '' : k).trim();
    if (!key) return;
    const n = reg ? reg.cite(key) : null;
    if (typeof n === 'number') numbers.push(n);
    else if (missing.indexOf(key) < 0) missing.push(key); // 未知 key（或没有 registry）
  });
  return { numbers, missing };
}

/* ------------------------------------------------------------------ */
/* 5. formatEntry                                                      */
/* ------------------------------------------------------------------ */

/** 取字段值：优先 entry.fields.<name>，其次 entry.<name> */
function fieldOf(entry, name) {
  if (!entry || typeof entry !== 'object') return '';
  const fields = (entry.fields && typeof entry.fields === 'object') ? entry.fields : {};
  const v = fields[name] !== undefined ? fields[name] : entry[name];
  return v == null ? '' : String(v);
}

/** 取第一个非空字段 */
function firstOf(entry, names) {
  for (const n of names) {
    const v = plain(fieldOf(entry, n));
    if (v) return v;
  }
  return '';
}

/** 作者串：`A and B` -> `A, B`；>3 人截断（中文「等」/ 英文「et al.」） */
function authorsText(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const parts = s
    .split(/(?:^|[\s,{}])\s*and(?=[\s,{}]|$)\s*/i) // 两侧需空白/逗号/花括号边界，避免切到 Anderson
    .map((p) => plain(p).replace(/^[\s,]+|[\s,]+$/g, ''))
    .filter(Boolean);
  if (!parts.length) return '';
  if (parts.length > 3) {
    const head = parts.slice(0, 3).join(', ');
    return head + (parts.some(isCjk) ? ' 等' : ' et al.');
  }
  return parts.join(', ');
}

/** 年份：优先 year，其次从 date 里取 4 位年份 */
function yearOf(entry) {
  const y = plain(fieldOf(entry, 'year'));
  if (y) return y;
  const d = plain(fieldOf(entry, 'date'));
  const m = /\d{4}/.exec(d);
  return m ? m[0] : '';
}

/**
 * 格式化单条条目（不含 [n] 前缀）
 * number 参数仅为签名兼容保留：编号由调用方拼接
 * @returns {string} 如 '张三, 李四. 标题. 期刊, 2020.'
 */
function formatEntry(entry, number) { // eslint-disable-line no-unused-vars
  if (!entry || typeof entry !== 'object') return '';

  const groups = [];

  const authors = authorsText(fieldOf(entry, 'author') || fieldOf(entry, 'editor'));
  if (authors) groups.push(authors);

  const title = plain(fieldOf(entry, 'title'));
  if (title) groups.push(title);

  // 出处：journal/booktitle/publisher/school/institution/note 取第一个存在的
  const source = firstOf(entry, ['journal', 'booktitle', 'publisher', 'school', 'institution', 'note']);
  const year = yearOf(entry);
  const sourceYear = [stripTailDot(source), stripTailDot(year)].filter(Boolean).join(', ');
  if (sourceYear) groups.push(sourceYear);

  // DOI / URL
  const doi = plain(fieldOf(entry, 'doi'));
  const url = plain(fieldOf(entry, 'url'));
  const link = [];
  if (doi) link.push(`doi:${doi}`);
  if (url) link.push(`<${url}>`);
  if (link.length) groups.push(link.join(', '));

  return joinGroups(groups);
}

/* ------------------------------------------------------------------ */
/* 6. toBibEntryFromMd                                                 */
/* ------------------------------------------------------------------ */

/**
 * Markdown 参考文献列表 -> entries（尽力而为，不抛异常）
 * 支持 `- [1] 张三. 标题. 2020.` / `1. 张三...` / `[zhang2020] 张三...`
 * key：显式 `[key]` 就用它，否则 md1、md2…
 * @returns {Object<string,Object>} 无有效行时返回 {}
 */
function toBibEntryFromMd(lines) {
  const arr = Array.isArray(lines)
    ? lines
    : (lines == null ? [] : String(lines).split(/\r?\n/));
  const out = {};
  let auto = 0;

  function nextAutoKey() {
    for (;;) {
      auto++;
      const k = `md${auto}`;
      if (!Object.prototype.hasOwnProperty.call(out, k)) return k;
    }
  }

  arr.forEach((raw) => {
    const original = String(raw == null ? '' : raw).trim();
    if (!original) return;
    if (/^#{1,6}\s/.test(original)) return; // Markdown 标题（如「## 参考文献」）不是条目

    let line = original;

    // 列表符号
    line = line.replace(/^[-*+•]\s+/, '').trim();

    // [key] 或 [n]
    let key = '';
    const bm = /^\[([^\[\]]+)\]\s*/.exec(line);
    if (bm) {
      const inner = bm[1].trim();
      if (/^\d+$/.test(inner)) {
        line = line.slice(bm[0].length); // 纯数字视为序号，丢弃；key 用 mdN
      } else {
        key = inner.replace(/\s+/g, '');
        line = line.slice(bm[0].length);
      }
    }
    if (!key) {
      // `1. xxx` / `1) xxx`（仅 1-3 位数字，避免吃掉 `2020. xxx` 这类年份开头）
      const nm = /^(\d{1,3})[.)]\s+/.exec(line);
      if (nm) line = line.slice(nm[0].length);
    }

    line = line.trim();
    if (!line) line = original; // 只剩标记行时退回整行，避免空标题

    if (!key || Object.prototype.hasOwnProperty.call(out, key)) key = nextAutoKey();

    out[key] = {
      type: 'misc',
      key,
      fields: { title: line },
      raw: original
    };
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* 7. formatCitation                                                   */
/* ------------------------------------------------------------------ */

/**
 * 生成行内引用片段
 * @param {Object} entry 条目（编号来自 registry.cite 打上的 entry.number）
 * @param {string} style 'citet' -> `张三 [1]`；其它 -> `[1]`
 */
function formatCitation(entry, style) {
  const n = entry && typeof entry === 'object'
    ? (entry.number !== undefined ? entry.number : (entry.bibNumber !== undefined ? entry.bibNumber : null))
    : null;
  const tag = `[${n == null ? '?' : n}]`;
  const st = String(style == null ? '' : style).toLowerCase();
  if (st === 'citet') {
    const a = authorsText(fieldOf(entry, 'author') || fieldOf(entry, 'editor'));
    return a ? `${a} ${tag}` : tag;
  }
  return tag;
}

module.exports = {
  parseBib,
  makeRegistry,
  extractCitationKeys,
  citeNumbers,
  formatEntry,
  toBibEntryFromMd,
  formatCitation
};
