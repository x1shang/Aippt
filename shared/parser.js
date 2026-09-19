/**
 * shared/parser.js  (v2.1)
 * Markdown → 幻灯片结构化数据
 *
 * v2 能力：数学公式（$…$、$$…$$、\[…\]）、GFM 表格、图片（![]()、![[]]、\includegraphics）、
 *          Obsidian 提示框（> [!tip]）、`>` 演讲备注、==高亮==、Obsidian wikilink
 * v2.1 新增：
 *   - 渐进显示 overlay：`\pause`、`\onslide<n->`、列表项后缀 `<2->`/`<2>`/`<2-4>`、
 *     行内 `\only<n->{}`/`\uncover<n->{}`/`\visible<n->{}`/`\alert<n->{}`
 *   - 定理类环境：`\begin{theorem}[标题]…\end{theorem}`（lemma/corollary/definition/proof/…）
 *   - 自动编号 + 交叉引用：公式 `(1)`、图 `图 1`、表 `表 1`、定理 `定理 1`、节号 `3.2`；
 *     `\ref`/`\eqref`/`\autoref`/`\cref` 全量替换（未定义 → `??`）
 *   - 图表题注：图片用 alt 文本，表格用紧随其后的 `表：…` / `Table: …` 行
 */
(function (root) {
  'use strict';

  const overlay = (typeof module !== 'undefined' && module.exports)
    ? require('./overlay.js')
    : (root.AIPPT && root.AIPPT.overlay);

  // 文献引用：Node 侧直接 require；浏览器预览侧由 index.html 提前加载（拿不到就退化为不处理）
  const bib = (typeof module !== 'undefined' && module.exports)
    ? require('./bib.js')
    : (root.AIPPT && root.AIPPT.bib);

  // ================= 内联格式化（原生文本路径） =================

  function inlineToRuns(text) {
    const runs = [];
    const src = stripMetadata(text);
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) pushPlain(src.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), options: { bold: true } });
      else if (tok.startsWith('`')) runs.push({ text: tok.slice(1, -1), options: { fontFace: 'Consolas' } });
      else runs.push({ text: tok.slice(1, -1), options: { italic: true } });
      last = m.index + tok.length;
    }
    if (last < src.length) pushPlain(src.slice(last));
    if (!runs.length) runs.push({ text: src, options: {} });
    return runs;

    function pushPlain(s) {
      if (s) runs.push({ text: s, options: {} });
    }
  }

  /** 去掉 \label 与行内 overlay 命令（保留内容），得到可读纯文本 */
  function stripMetadata(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\\label\s*\{[^{}]*\}/g, '');
    if (s.indexOf('\\') >= 0) s = overlay.stripOverlayCommands(s, true);
    return s;
  }

  /**
   * 把行内代码（`...`）的内容替换为等长的占位字符：
   * 用于扫描 overlay 命令时避免把「讲语法的正文」误判为真指令
   * （例如正文里写 `` `<2->` ``、`` `\pause` ``）
   */
  function maskInlineCode(text) {
    return String(text == null ? '' : text).replace(/`[^`]+`/g, (m) =>
      '`' + 'x'.repeat(Math.max(0, m.length - 2)) + '`');
  }

  function toPlainText(text) {
    return stripMetadata(text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t, a) => a || t)
      .replace(/==([^=\n]+)==/g, '$1');
  }

  // ================= 富内容识别 =================

  const INLINE_MATH = /(?<!\\)\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$/g;
  const INLINE_MATH_PAREN = /(?<!\\)\\\(([\s\S]+?)\\\)/g;

  function hasRichMarkup(text) {
    const t = maskInlineCode(String(text == null ? '' : text));
    if (/\$\$[^$]+\$\$/.test(t)) return true;
    INLINE_MATH.lastIndex = 0;
    if (INLINE_MATH.test(t)) return true;
    if (/\\\(/.test(t)) return true;
    if (/==[^=\n]+==/.test(t)) return true;
    if (/<mark\b/i.test(t)) return true;
    if (/<br\s*\/?>/i.test(t)) return true;
    if (/\\(?:only|uncover|visible|alert|onslide)\s*</.test(t)) return true;
    if (/\\ref\s*\{|\\eqref\s*\{|\\autoref\s*\{|\\cref\s*\{/.test(t)) return true;
    return false;
  }

  function countInlineMath(text) {
    const t = String(text == null ? '' : text);
    let n = 0;
    const stripped = t.replace(/(?<!\\)\$\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$\$/g, () => {
      n++;
      return ' ';
    });
    INLINE_MATH.lastIndex = 0;
    while (INLINE_MATH.exec(stripped) !== null) n++;
    const paren = stripped.match(INLINE_MATH_PAREN);
    if (paren) n += paren.length;
    return n;
  }

  // ================= 图片引用 =================

  const IMG_MD = /!\[([^\]]*)\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  const IMG_WIKI = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
  const IMG_TEX = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;

  function extractImages(text) {
    const found = [];
    const t = String(text == null ? '' : text);
    let m;
    IMG_MD.lastIndex = 0;
    while ((m = IMG_MD.exec(t)) !== null) found.push({ src: m[2], alt: (m[1] || '').trim() });
    IMG_WIKI.lastIndex = 0;
    while ((m = IMG_WIKI.exec(t)) !== null) {
      const src = m[1].trim();
      if (/\.(png|jpe?g|gif|bmp|webp|svg|tiff?)$/i.test(src)) {
        found.push({ src, alt: '', widthHint: m[2] ? m[2].trim() : '' });
      }
    }
    IMG_TEX.lastIndex = 0;
    while ((m = IMG_TEX.exec(t)) !== null) {
      found.push({ src: m[2].trim(), alt: '', texOpts: m[1] || '' });
    }
    return found;
  }

  function stripImages(text) {
    return String(text == null ? '' : text)
      .replace(IMG_MD, '')
      .replace(IMG_WIKI, '')
      .replace(IMG_TEX, '')
      .trim();
  }

  // ================= 表格 =================

  function isTableRow(line) {
    const t = String(line || '').trim();
    return t.startsWith('|') && t.length > 1;
  }

  function isTableSeparator(line) {
    const t = String(line || '').trim();
    if (!isTableRow(t)) return false;
    const cells = splitTableRow(t);
    return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, '')));
  }

  function splitTableRow(line) {
    let t = String(line || '').trim();
    t = t.replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '\\' && t[i + 1] === '|') {
        cur += '|';
        i++;
        continue;
      }
      if (ch === '|') {
        cells.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  // ================= 定理类环境 =================

  const ENV_DEFS = {
    theorem: { label: '定理', counter: true, kind: 'thm' },
    lemma: { label: '引理', counter: true, kind: 'lem' },
    corollary: { label: '推论', counter: true, kind: 'cor' },
    proposition: { label: '命题', counter: true, kind: 'prop' },
    definition: { label: '定义', counter: true, kind: 'def' },
    example: { label: '例', counter: true, kind: 'ex' },
    claim: { label: '断言', counter: true, kind: 'clm' },
    axiom: { label: '公理', counter: true, kind: 'ax' },
    conjecture: { label: '猜想', counter: true, kind: 'conj' },
    exercise: { label: '练习', counter: true, kind: 'exe' },
    proof: { label: '证明', counter: false, qed: true },
    remark: { label: '评注', counter: false },
    solution: { label: '解答', counter: false }
  };

  const REF_KIND_LABEL = {
    eq: '公式', fig: '图', tab: '表', sec: '节',
    thm: '定理', lem: '引理', cor: '推论', prop: '命题', def: '定义',
    ex: '例', clm: '断言', ax: '公理', conj: '猜想', exe: '练习',
    alg: '算法', lst: '代码'
  };

  // ================= 算法伪代码（algorithm / algorithmic / pseudocode） =================

  const ALGO_ENVS = {
    algorithm: true, algorithmic: true, algorithmicx: true,
    pseudocode: true, algorithm2e: true, algpseudocode: true
  };

  /**
   * 把算法体拆成带缩进与语义的行。
   * 每条规则：[匹配, 语义, 输出文本, 缩进前变化, 缩进后变化]
   * 输出文本里的 `$..$` 会照常被行内公式渲染管线处理。
   */
  const ALGO_RULES = [
    [/^\\Require\b\s*(.*)$/, 'io', (m) => `输入：${m[1]}`],
    [/^\\Ensure\b\s*(.*)$/, 'io', (m) => `输出：${m[1]}`],
    [/^\\If\s*\{([\s\S]*)\}\s*$/, 'if', (m) => `if ${m[1]} then`, 0, 1],
    [/^\\ElsIf\s*\{([\s\S]*)\}\s*$/, 'elseif', (m) => `else if ${m[1]} then`, -1, 1],
    [/^\\Else\s*$/, 'else', () => 'else', -1, 1],
    [/^\\EndIf\s*$/, 'endif', () => 'end if', -1, 0],
    [/^\\For(?:All)?\s*\{([\s\S]*)\}\s*$/, 'for', (m) => `for ${m[1]} do`, 0, 1],
    [/^\\ForEach\s*\{([\s\S]*)\}\s*$/, 'for', (m) => `for each ${m[1]} do`, 0, 1],
    [/^\\EndFor(?:All)?\s*$/, 'endfor', () => 'end for', -1, 0],
    [/^\\While\s*\{([\s\S]*)\}\s*$/, 'while', (m) => `while ${m[1]} do`, 0, 1],
    [/^\\EndWhile\s*$/, 'endwhile', () => 'end while', -1, 0],
    [/^\\Repeat\s*$/, 'repeat', () => 'repeat', 0, 1],
    [/^\\Until\s*\{([\s\S]*)\}\s*$/, 'until', (m) => `until ${m[1]}`, -1, 0],
    [/^\\Loop\s*$/, 'repeat', () => 'loop', 0, 1],
    [/^\\EndLoop\s*$/, 'until', () => 'end loop', -1, 0],
    [/^\\Procedure\s*\{([\s\S]*?)\}\s*(?:\{([\s\S]*)\})?\s*$/, 'proc', (m) => `procedure ${algoCall(m[1], m[2])}`, 0, 1],
    [/^\\EndProcedure\s*$/, 'endproc', () => 'end procedure', -1, 0],
    [/^\\Function\s*\{([\s\S]*?)\}\s*(?:\{([\s\S]*)\})?\s*$/, 'proc', (m) => `function ${algoCall(m[1], m[2])}`, 0, 1],
    [/^\\EndFunction\s*$/, 'endproc', () => 'end function', -1, 0],
    [/^\\Return\b\s*(.*)$/, 'return', (m) => (m[1].trim() ? `return ${m[1]}` : 'return')],
    [/^\\Comment\s*\{([\s\S]*)\}\s*$/, 'comment', (m) => `▷ ${m[1]}`],
    [/^\\State\s*(.*)$/, 'state', (m) => m[1]]
  ];

  function algoCall(name, args) {
    const a = String(args == null ? '' : args).trim();
    return a ? `${String(name).trim()}(${a})` : String(name).trim();
  }

  /** 算法行里的 LaTeX 小命令 → 好看一点的等价文本 */
  function algoInline(text) {
    return String(text == null ? '' : text)
      .replace(/\\Call\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, n, a) => algoCall(n, a))
      .replace(/\\(?:gets|leftarrow)\b/g, '←')
      .replace(/\\to\b/g, '→')
      .replace(/\\(?:textbf|textit|texttt|mathrm|text)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\\True\b/g, 'true')
      .replace(/\\False\b/g, 'false')
      .replace(/\\And\b/g, ' and ')
      .replace(/\\Or\b/g, ' or ')
      .replace(/\\Not\b/g, 'not ')
      .replace(/\\End\b/g, 'end')
      .replace(/\\[a-zA-Z]+\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * 解析算法体 → { lines: [{ indent, kind, text }], caption }
   * 支持外层再套一层 \begin{algorithmic}，也支持 \State 省略写法。
   */
  function parseAlgoBody(inner) {
    const raw = String(inner == null ? '' : inner).split(/\r?\n/);
    const lines = [];
    let indent = 0;
    let caption = '';
    for (const rawLine of raw) {
      let line = rawLine.trim();
      if (!line) continue;
      if (/^\\(begin|end)\s*\{(algorithmic|algorithm|pseudocode|algpseudocode|algorithm2e)\}/.test(line)) continue;
      const cap = line.match(/^\\caption\s*\{([\s\S]*)\}\s*$/);
      if (cap) {
        caption = cap[1].trim();
        continue;
      }
      if (/^\\label\s*\{/.test(line)) continue;
      if (/^\\State\b/.test(line)) line = line.replace(/^\\State\b\s*/, '');
      let matched = false;
      for (const [re, kind, render, before, after] of ALGO_RULES) {
        const m = line.match(re);
        if (!m) continue;
        indent = Math.max(0, indent + (before || 0));
        const text = algoInline(typeof render === 'function' ? render(m) : line);
        if (text) lines.push({ indent, kind, text });
        indent = Math.max(0, indent + (after || 0));
        matched = true;
        break;
      }
      if (!matched) {
        const text = algoInline(line);
        if (text) lines.push({ indent, kind: 'state', text });
      }
    }
    return { lines, caption };
  }

  // ================= 文档解析 =================

  const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
  const BULLET_RE = /^\s*([-*+]|\d+[.、)])\s+(.*)$/;
  const QUOTE_RE = /^\s*>\s?(.*)$/;
  const CALLOUT_RE = /^\s*>\s*\[!([a-zA-Z]+)\][+-]?\s*(.*)$/;
  const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  const FENCE_RE = /^\s*```(.*)$/;
  const ENV_BEGIN_RE = /^\s*\\begin\{([a-zA-Z*]+)\}(?:\[([^\]]*)\])?\s*(\\label\s*\{[^{}]*\})?\s*$/;
  const STEP_LINE_RE = /^\s*\\(pause|onslide)\s*(?:<([^>]*)>)?\s*$/;
  const ITEM_OVERLAY_RE = /\s<(\d+)\s*(?:-\s*(\d*))?>\s*$/;
  const LEAD_OVERLAY_RE = /^\s*<(\d+)\s*(?:-\s*(\d*))?>\s+/;
  const LABEL_RE = /\\label\s*\{([^{}]+)\}/g;
  const TABLE_CAPTION_RE = /^\s*(?:\*\*)?(?:表|Table)\s*[:：]\s*(.*)$/i;
  const CAPTION_CMD_RE = /^\s*\\caption\{(.*)\}\s*$/;

  function parseMarkdown(md, options) {
    options = options || {};
    const lines = String(md || '').split(/\r?\n/);
    const slides = [];
    const stats = {
      slides: 0, notes: 0, bullets: 0, math: 0, tables: 0, images: 0,
      callouts: 0, code: 0, envs: 0, overlaySlides: 0, steps: 0,
      numbered: 0, refs: 0, unresolvedRefs: [],
      algorithms: 0, citations: 0, unresolvedCites: [], tocEntries: 0, referenceSlides: 0
    };
    const labels = Object.create(null);
    const counters = Object.create(null);
    const secCounters = [0, 0, 0, 0, 0, 0];

    let cover = null;
    let current = null;
    let pendingBullets = [];
    let pendingPara = [];
    let sawHeading1 = false;
    let curStep = 1;

    function nextNumber(kind) {
      counters[kind] = (counters[kind] || 0) + 1;
      stats.numbered++;
      return counters[kind];
    }

    function registerLabel(name, info) {
      if (!name) return;
      labels[name] = info;
    }

    function newSlide(title, layout) {
      const s = {
        title: title || '',
        subtitle: '',
        layout: layout || 'content',
        blocks: [],
        notes: [],
        images: [],
        number: '',
        secLabel: '',
        steps: 1,
        headingLevel: 0
      };
      slides.push(s);
      current = s;
      curStep = 1; // 每页步号独立
      return s;
    }

    function flushBullets() {
      if (!pendingBullets.length) return;
      const items = pendingBullets.slice();
      pendingBullets = [];
      ensure().blocks.push({
        type: 'bullets',
        items,
        rich: items.some((it) => hasRichMarkup(it.text))
      });
    }

    function flushPara() {
      if (!pendingPara.length) return;
      const text = pendingPara.join(' ').trim();
      pendingPara = [];
      if (!text) return;
      // 段落开头的 overlay 标记
      let from = curStep;
      let to = null;
      let body = text;
      const lead = body.match(LEAD_OVERLAY_RE);
      if (lead) {
        const spec = overlay.parseOverlaySpec(lead[0].replace(/[<>]/g, '').trim());
        from = spec.from;
        to = spec.to;
        body = body.slice(lead[0].length);
      }
      // 段落内的 \pause 拆成多个依次出现的块（行内代码里的 \pause 不算）
      const maskedBody = maskInlineCode(body);
      const parts = [];
      let cursor = 0;
      const pauseRe = /\\pause\b/g;
      let pm;
      while ((pm = pauseRe.exec(maskedBody)) !== null) {
        parts.push(body.slice(cursor, pm.index));
        cursor = pm.index + pm[0].length;
      }
      parts.push(body.slice(cursor));
      const segments = parts.map((x) => x.trim()).filter(Boolean);
      const startStep = from;
      segments.forEach((seg, k) => {
        const segFrom = segments.length > 1 ? startStep + k : from;
        ensure().blocks.push({ type: 'text', text: seg, rich: hasRichMarkup(seg), from: segFrom, to });
      });
      // 段落里的 \pause 同样推进后续内容的步号
      if (segments.length > 1) curStep = startStep + segments.length - 1;
    }

    function flushAll() {
      flushBullets();
      flushPara();
    }

    function ensure() {
      if (!current) newSlide('', 'content');
      return current;
    }

    function pushImageBlock(img, label) {
      const alt = stripMetadata(img.alt || '').trim();
      const block = {
        type: 'image',
        src: img.src,
        alt,
        widthHint: img.widthHint || '',
        texOpts: img.texOpts || '',
        from: curStep,
        to: null
      };
      if (label || alt) {
        block.number = nextNumber('fig');
        block.label = label || '';
        if (label) registerLabel(label, { kind: 'fig', number: block.number, title: alt });
      }
      ensure().blocks.push(block);
      ensure().images.push(img.src);
      stats.images++;
    }

    function pushTableBlock(block) {
      ensure().blocks.push(block);
      stats.tables++;
    }

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.replace(/\s+$/, '');

      // ---- 代码围栏 ----
      const fence = line.match(FENCE_RE);
      if (fence) {
        flushAll();
        const lang = (fence[1] || '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !FENCE_RE.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        ensure().blocks.push({ type: 'code', code: buf.join('\n'), lang, from: curStep, to: null });
        stats.code++;
        continue;
      }

      // ---- 目录页 ----
      if (/^\s*\\tableofcontents\s*$/.test(line)) {
        flushAll();
        newSlide('目录', 'toc');
        i++;
        continue;
      }

      // ---- 算法伪代码 ----
      const algoBegin = line.match(ENV_BEGIN_RE);
      if (algoBegin && ALGO_ENVS[algoBegin[1]]) {
        flushAll();
        const res = readEnv(lines, i, algoBegin[1]);
        const parsedAlgo = parseAlgoBody(res.inner);
        const label = extractLabel(algoBegin[3] || '') || extractLabel(res.inner);
        const title = stripMetadata(parsedAlgo.caption || res.title || '');
        const number = nextNumber('algorithm');
        if (label) registerLabel(label, { kind: 'alg', number, env: 'algorithm', title });
        ensure().blocks.push({
          type: 'algo',
          title,
          number,
          label: label || '',
          lines: parsedAlgo.lines,
          rich: true,
          from: curStep,
          to: null
        });
        stats.algorithms++;
        i = res.next;
        continue;
      }

      // ---- 定理类环境 ----
      const envBegin = line.match(ENV_BEGIN_RE);
      if (envBegin && ENV_DEFS[envBegin[1]]) {
        flushAll();
        const envName = envBegin[1];
        const res = readEnv(lines, i, envName);
        const def = ENV_DEFS[envName];
        const label = extractLabel(envBegin[3] || '') || extractLabel(res.inner) || extractLabel(res.title);
        const title = stripMetadata(res.title);
        let number = null;
        if (def.counter) number = nextNumber(envName);
        if (label) registerLabel(label, { kind: def.kind, number, env: envName, title });
        const sub = parseMarkdown('\n' + res.inner, { fileName: '@env', __deferRefs: true });
        // 子解析的标签并回主文档：这样 \eqref 才能引用定理环境内部定义的公式标签
        if (sub.labels) Object.assign(labels, sub.labels);
        const blocks = sub.slides.filter((s) => s.layout !== 'cover').flatMap((s) => s.blocks);
        ensure().blocks.push({
          type: 'env',
          env: envName,
          title,
          number,
          label: label || '',
          qed: !!def.qed,
          blocks,
          rich: true,
          from: curStep,
          to: null
        });
        stats.envs++;
        i = res.next;
        continue;
      }

      // ---- \pause / \onslide<n-> ----
      const stepLine = line.match(STEP_LINE_RE);
      if (stepLine) {
        flushAll();
        if (stepLine[1] === 'pause') curStep++;
        else {
          const spec = overlay.parseOverlaySpec(stepLine[2]);
          curStep = Math.max(curStep, spec.from);
        }
        i++;
        continue;
      }

      // ---- 行间公式 $$ ... $$ ----
      if (/^\s*\$\$/.test(line)) {
        flushAll();
        const res = readDisplayMath(lines, i, '$$');
        pushMathBlock(res.tex);
        i = res.next;
        continue;
      }
      if (/^\s*\\\[/.test(line)) {
        flushAll();
        const res = readDisplayMath(lines, i, '\\[');
        pushMathBlock(res.tex);
        i = res.next;
        continue;
      }

      // ---- 标题 ----
      const h = line.match(HEADING_RE);
      if (h) {
        flushAll();
        const label = extractLabel(h[2]);
        const text = toPlainText(h[2].trim());
        const level = h[1].length;
        if (level === 1 && !sawHeading1 && !cover && slides.length === 0) {
          sawHeading1 = true;
          cover = newSlide(text, 'cover');
        } else {
          if (level === 1) sawHeading1 = true;
          const s = newSlide(text, 'content');
          s.headingLevel = level;
          if (level >= 2) {
            secCounters[level - 1]++;
            for (let k = level; k < secCounters.length; k++) secCounters[k] = 0;
            const parts = secCounters.slice(1, level).filter((n) => n > 0);
            s.number = parts.join('.');
            if (label) {
              s.secLabel = label;
              registerLabel(label, { kind: 'sec', number: s.number, title: text });
            }
          } else if (label) {
            registerLabel(label, { kind: 'sec', number: '', title: text });
          }
        }
        i++;
        continue;
      }

      // ---- 封面副标题 ----
      if (current && current.layout === 'cover' && !current.subtitle && current.blocks.length === 0 &&
          current.notes.length === 0 && line.trim() && !BULLET_RE.test(line) && !QUOTE_RE.test(line)) {
        const t = line.trim();
        if (!hasRichMarkup(t) && t.length <= 80) {
          current.subtitle = toPlainText(t);
          i++;
          continue;
        }
      }

      // ---- 分页符 ----
      if (HR_RE.test(line)) {
        flushAll();
        if (current && current.layout !== 'cover' &&
            (current.title || current.blocks.length || current.notes.length)) {
          newSlide('', 'content');
          curStep = 1;
        }
        i++;
        continue;
      }

      // ---- Obsidian 提示框 ----
      if (CALLOUT_RE.test(line)) {
        flushAll();
        const res = readCallout(lines, i);
        res.block.from = curStep;
        res.block.to = null;
        ensure().blocks.push(res.block);
        stats.callouts++;
        i = res.next;
        continue;
      }

      // ---- 演讲备注 ----
      const q = line.match(QUOTE_RE);
      if (q) {
        const t = q[1].trim();
        if (t) {
          ensure().notes.push(t);
          stats.notes++;
        }
        i++;
        continue;
      }

      // ---- 表格 ----
      if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flushAll();
        const res = readTable(lines, i);
        const block = res.block;
        block.from = curStep;
        block.to = null;
        // 表题注：紧随其后的 `表：…` / `\caption{…}` / `\label{tab:…}` 行
        let j = res.next;
        let label = '';
        if (j < lines.length) {
          const capLine = lines[j].trim();
          const capMatch = capLine.match(TABLE_CAPTION_RE) || capLine.match(CAPTION_CMD_RE);
          if (capMatch) {
            block.caption = stripMetadata(capMatch[1] || '').trim();
            label = extractLabel(capLine) || '';
            j++;
          } else if (/^\\label\s*\{[^{}]+\}\s*$/.test(capLine)) {
            label = extractLabel(capLine) || '';
            j++;
          }
        }
        if (label || block.caption) {
          block.number = nextNumber('tab');
          block.label = label;
          if (label) registerLabel(label, { kind: 'tab', number: block.number, title: block.caption || '' });
        }
        pushTableBlock(block);
        i = j;
        continue;
      }

      // ---- 独立图片行 ----
      const imgs = extractImages(line);
      if (imgs.length && !stripImages(line)) {
        flushAll();
        let label = extractLabel(line) || '';
        let j = i + 1;
        if (!label && j < lines.length && /^\s*\\label\s*\{[^{}]+\}\s*$/.test(lines[j])) {
          label = extractLabel(lines[j]);
          j++;
        }
        for (const img of imgs) pushImageBlock(img, label);
        i = j;
        continue;
      }

      // ---- 列表项 ----
      const b = line.match(BULLET_RE);
      if (b) {
        flushPara();
        const indent = Math.floor((line.match(/^\s*/) || [''])[0].length / 2);
        let itemText = b[2];
        let range = null;
        const maskedItem = maskInlineCode(itemText);
        const lead = maskedItem.match(LEAD_OVERLAY_RE);
        if (lead) {
          range = overlay.parseOverlaySpec(lead[0].replace(/[<>]/g, '').trim());
          itemText = itemText.slice(lead[0].length);
        } else {
          const tail = maskedItem.match(ITEM_OVERLAY_RE);
          if (tail) {
            range = overlay.parseOverlaySpec(tail[0].replace(/[<>]/g, '').trim());
            itemText = itemText.slice(0, tail.index).trim();
          }
        }
        const itemImgs = extractImages(itemText);
        const rest = itemImgs.length ? stripImages(itemText) : itemText;
        if (rest) {
          const item = { text: rest, level: Math.min(indent, 3), code: false, from: curStep, to: null };
          if (range) {
            item.from = range.from;
            item.to = range.to;
          }
          pendingBullets.push(item);
        }
        if (itemImgs.length) {
          flushBullets();
          const label = extractLabel(itemText) || '';
          for (const img of itemImgs) pushImageBlock(img, label);
        }
        i++;
        continue;
      }

      // ---- 空行 ----
      const trimmed = line.trim();
      if (!trimmed) {
        flushPara();
        i++;
        continue;
      }

      // ---- 普通段落 ----
      {
        const paraImgs = extractImages(trimmed);
        const rest = paraImgs.length ? stripImages(trimmed) : trimmed;
        if (rest) {
          flushBullets();
          pendingPara.push(rest);
        }
        if (paraImgs.length) {
          flushAll();
          const label = extractLabel(trimmed) || '';
          for (const img of paraImgs) pushImageBlock(img, label);
        }
        i++;
        continue;
      }
    }

    flushAll();

    function pushMathBlock(tex) {
      const label = extractLabel(tex);
      const tagMatch = tex.match(/\\tag\*?\s*\{([^{}]*)\}/);
      const cleanTex = overlay.stripOverlayCommands(
        tex.replace(/\\label\s*\{[^{}]*\}/g, '').replace(/\\tag\*?\s*\{[^{}]*\}/g, '')
      );
      const block = { type: 'math', tex: cleanTex.trim(), from: curStep, to: null };
      if (label || tagMatch) {
        block.number = tagMatch ? tagMatch[1] : String(nextNumber('eq'));
        block.label = label || '';
        block.labeled = true;
        if (label) registerLabel(label, { kind: 'eq', number: block.number });
      }
      ensure().blocks.push(block);
      stats.math++;
    }

    // ---- 组装 + 无 H1 时合成封面 ----
    const result = [];
    if (cover) result.push(cover);
    for (const s of slides) {
      if (s === cover) continue;
      if (s.title || s.blocks.length || s.notes.length) result.push(s);
    }
    if (!sawHeading1 && result.length) {
      const stem = String(options.fileName || '').replace(/\.[^.]+$/, '').trim() || '演示文稿';
      const firstPara = result.length ? result[0].blocks.find((blk) => blk.type === 'text' && !blk.rich) : null;
      result.unshift({
        title: stem,
        subtitle: firstPara ? toPlainText(firstPara.text).slice(0, 80) : '',
        layout: 'cover',
        blocks: [],
        notes: [],
        images: [],
        number: '',
        secLabel: '',
        steps: 1
      });
    }

    // ---- 交叉引用替换 + 文献引用 + 收尾 ----
    // 定理环境体是用子解析器解析的：那里先不做引用替换，统一交给主文档收尾处理，
    // 否则环境体内部引用主文档标签、或主文档引用环境体内部标签都会变成 ??
    const deferRefs = !!options.__deferRefs;
    const bibRegistry = deferRefs ? null : (options.bibRegistry || null);
    if (!deferRefs) {
      resolveRefs(result, labels, stats);
      if (bibRegistry) resolveCitations(result, bibRegistry, stats);
    }
    finalizeSlides(result);
    assignSteps(result, stats);

    // ---- 目录条目（供目录页/页脚导航用） ----
    const toc = [];
    for (const s of result) {
      if (s.layout === 'cover' || s.layout === 'toc' || s.layout === 'end') continue;
      if (s.headingLevel && s.headingLevel <= 2 && s.title) {
        toc.push({ title: s.title, number: s.number || '', level: s.headingLevel });
      }
    }
    stats.tocEntries = toc.length;

    // ---- 显式 \tableofcontents：把 toc 挂到该页 ----
    let tocAsked = false;
    for (const s of result) {
      if (s.layout === 'toc') { s.tocEntries = toc; tocAsked = true; }
    }
    if (!tocAsked && options.autoToc && toc.length >= 2) {
      const at = result[0] && result[0].layout === 'cover' ? 1 : 0;
      const tocSlide = {
        title: '目录', subtitle: '', layout: 'toc', blocks: [], notes: [], images: [],
        number: '', secLabel: '', steps: 1, headingLevel: 0, tocEntries: toc,
        bullets: [], rich: false, hasMath: false, hasImage: false, hasEnv: false
      };
      result.splice(at, 0, tocSlide);
      stats.tocEntries = toc.length;
    }

    // ---- 参考文献页（有引用且用户没自己写参考文献页时自动追加） ----
    if (bibRegistry && stats.citations > 0) {
      const hasManualRefs = result.some((s) => /^(参考文献|引用文献|references|bibliography)$/i.test(String(s.title || '').trim()));
      if (!hasManualRefs) {
        const lines = bibRegistry.lines();
        const perPage = 7;
        for (let k = 0; k < lines.length; k += perPage) {
          const chunk = lines.slice(k, k + perPage);
          result.push({
            title: k === 0 ? '参考文献' : '参考文献（续）',
            subtitle: '', layout: 'refs', blocks: [], notes: [], images: [],
            number: '', secLabel: '', steps: 1, headingLevel: 0,
            refLines: chunk, refStart: k + 1,
            bullets: [], rich: false, hasMath: false, hasImage: false, hasEnv: false
          });
          stats.referenceSlides++;
        }
      }
    }

    // 统计
    let mathInline = 0;
    let mathDisplay = 0;
    const countMathIn = (blocks) => {
      for (const blk of blocks || []) {
        if (!blk) continue;
        if (blk.type === 'math') mathDisplay++;
        else if (blk.type === 'env') countMathIn(blk.blocks);
        else mathInline += countInlineMathBlock(blk);
      }
    };
    for (const s of result) countMathIn(s.blocks);
    stats.mathDisplay = mathDisplay;
    stats.mathInline = mathInline;
    stats.math = mathDisplay + mathInline;
    stats.slides = result.length;
    stats.bullets = result.reduce((a, s) => a + s.bullets.length, 0);
    stats.useSectionNumbers = result.some((s) => s.secLabel) || stats.refs > 0 && Object.keys(labels).some((k) => labels[k].kind === 'sec');

    return { slides: result, stats, labels };
  }

  // ================= 子解析器 =================

  function readEnv(lines, start, envName) {
    const begin = lines[start].match(ENV_BEGIN_RE);
    const title = (begin && begin[2]) || '';
    const body = [];
    const endRe = new RegExp('^\\s*\\\\end\\{' + envName + '\\}\\s*$');
    const beginRe = new RegExp('^\\s*\\\\begin\\{' + envName + '\\}');
    let depth = 0;
    let i = start + 1;
    while (i < lines.length) {
      const l = lines[i];
      if (endRe.test(l)) {
        if (depth === 0) {
          i++;
          break;
        }
        depth--;
      } else if (beginRe.test(l)) {
        depth++;
      }
      body.push(l);
      i++;
    }
    return { title, inner: body.join('\n'), next: i };
  }

  function extractLabel(text) {
    const t = String(text == null ? '' : text);
    LABEL_RE.lastIndex = 0;
    const m = LABEL_RE.exec(t);
    return m ? m[1].trim() : '';
  }

  function readDisplayMath(lines, start, open) {
    const close = open === '$$' ? '$$' : '\\]';
    const trimmed = lines[start].trim();
    const afterOpen = trimmed.slice(open.length);

    if (afterOpen && afterOpen.includes(close)) {
      const tex = afterOpen.slice(0, afterOpen.indexOf(close));
      if (tex.trim()) return { tex: tex.trim(), next: start + 1 };
    }
    const buf = [];
    if (afterOpen.trim()) buf.push(afterOpen);
    let i = start + 1;
    while (i < lines.length) {
      const t = lines[i];
      const idx = t.indexOf(close);
      if (idx >= 0) {
        const head = t.slice(0, idx);
        if (head.trim()) buf.push(head);
        return { tex: buf.join('\n').trim(), next: i + 1 };
      }
      buf.push(t);
      i++;
    }
    return { tex: buf.join('\n').trim(), next: i };
  }

  function readCallout(lines, start) {
    const m = lines[start].match(CALLOUT_RE);
    const kind = (m[1] || 'note').toLowerCase();
    const title = stripMetadata((m[2] || '').trim());
    const items = [];
    const paras = [];
    let i = start + 1;
    while (i < lines.length && /^\s*>/.test(lines[i])) {
      const inner = lines[i].replace(/^\s*>\s?/, '');
      const bm = inner.match(/^\s*([-*+]|\d+[.、)])\s+(.*)$/);
      if (bm) {
        const indent = Math.floor((inner.match(/^\s*/) || [''])[0].length / 2);
        items.push({ text: bm[2], level: Math.min(indent, 2), code: false, from: 1, to: null });
      } else if (inner.trim()) {
        paras.push(inner.trim());
      }
      i++;
    }
    return { block: { type: 'callout', kind, title, items, lines: paras, from: 1, to: null }, next: i };
  }

  function readTable(lines, start) {
    const headers = splitTableRow(lines[start]);
    const aligns = splitTableRow(lines[start + 1]).map((c) => {
      const s = c.replace(/\s+/g, '');
      if (s.startsWith(':') && s.endsWith(':')) return 'center';
      if (s.endsWith(':')) return 'right';
      return 'left';
    });
    const rows = [];
    let i = start + 2;
    while (i < lines.length && isTableRow(lines[i])) {
      const cells = splitTableRow(lines[i]);
      if (cells.length === 1 && !cells[0]) {
        i++;
        continue;
      }
      while (cells.length < headers.length) cells.push('');
      while (cells.length > headers.length) {
        headers.push('');
        aligns.push('left');
      }
      rows.push(cells);
      i++;
    }
    return { block: { type: 'table', headers, rows, aligns }, next: i };
  }

  // ================= 交叉引用 =================

  const REF_RE = /\\(eqref|ref|autoref|cref|Cref|pageref)\s*\{([^{}]+)\}/g;

  function resolveRefs(slides, labels, stats) {
    const replace = (text, inMath) => {
      const t = String(text == null ? '' : text);
      if (t.indexOf('\\') < 0) return t;
      REF_RE.lastIndex = 0;
      return t.replace(REF_RE, (m, cmd, nameRaw) => {
        const name = nameRaw.trim();
        const entry = labels[name];
        stats.refs++;
        if (!entry) {
          if (!stats.unresolvedRefs.includes(name)) stats.unresolvedRefs.push(name);
          return '??';
        }
        const num = entry.number == null ? '' : String(entry.number);
        if (cmd === 'eqref') return inMath ? `(${num})` : `（${num}）`;
        if (cmd === 'ref' || cmd === 'pageref') return num;
        const prefix = REF_KIND_LABEL[entry.kind] || '';
        if (entry.kind === 'sec') {
          if (inMath) return `\\text{第 ${num} 节}`;
          return num ? `第 ${num} 节` : (entry.title ? `「${entry.title}」` : '??');
        }
        if (entry.kind === 'eq') {
          if (inMath) return `(${num})`;
          return `${prefix}（${num}）`;
        }
        if (inMath) return `\\text{${prefix} ${num}}`;
        return `${prefix} ${num}`;
      });
    };

    walkSlideText(slides, replace);
  }

  // ================= 文献引用 =================

  /**
   * 把所有引用命令替换成编号：[n]。
   * 编号按**首次出现顺序**分配（unsrt 风格），与 LaTeX 的 \cite 习惯一致。
   * 未知 key → [?] 并记入 stats.unresolvedCites。
   */
  function resolveCitations(slides, registry, stats) {
    if (!bib || !bib.extractCitationKeys) return;
    const replace = (text) => {
      const t = String(text == null ? '' : text);
      if (!t || (t.indexOf('\\cite') < 0 && t.indexOf('[@') < 0 && t.indexOf('\\footcite') < 0
        && t.indexOf('\\citep') < 0 && t.indexOf('\\citet') < 0)) return t;
      const cites = bib.extractCitationKeys(t);
      if (!cites.length) return t;
      let out = '';
      let last = 0;
      for (const c of cites) {
        out += t.slice(last, c.start);
        const { numbers, missing } = bib.citeNumbers(c.keys, registry);
        for (const k of missing) {
          if (!stats.unresolvedCites.includes(k)) stats.unresolvedCites.push(k);
        }
        stats.citations += c.keys.length;
        if (!numbers.length) {
          out += '[?]';
        } else if (c.cmd === 'citet' && numbers.length === 1) {
          const entry = registry.lookup ? registry.lookup(c.keys[0]) : null;
          out += entry && bib.formatCitation ? bib.formatCitation(entry, 'citet', numbers[0]) : `[${numbers[0]}]`;
        } else {
          const shown = numbers.join(',');
          out += missing.length ? `[${shown}, ?]` : `[${shown}]`;
        }
        last = c.end;
      }
      return out + t.slice(last);
    };
    walkSlideText(slides, replace);
  }

  /** 遍历所有可含引用的文本字段 */
  function walkSlideText(slides, fn) {
    const visitBlocks = (blocks) => {
      for (const b of blocks || []) {
        if (!b) continue;
        switch (b.type) {
          case 'bullets':
            for (const it of b.items) it.text = fn(it.text, false);
            break;
          case 'text':
            b.text = fn(b.text, false);
            break;
          case 'callout':
            b.title = fn(b.title, false);
            for (const it of b.items) it.text = fn(it.text, false);
            b.lines = (b.lines || []).map((l) => fn(l, false));
            break;
          case 'env':
            b.title = fn(b.title, false);
            visitBlocks(b.blocks);
            break;
          case 'algo':
            b.title = fn(b.title, false);
            for (const l of b.lines || []) l.text = fn(l.text, false);
            break;
          case 'table':
            b.headers = (b.headers || []).map((h) => fn(h, false));
            b.rows = (b.rows || []).map((r) => r.map((c) => fn(c, false)));
            b.caption = fn(b.caption || '', false);
            break;
          case 'image':
            b.alt = fn(b.alt || '', false);
            break;
          case 'math':
            b.tex = fn(b.tex, true);
            break;
          default:
            break;
        }
      }
    };
    for (const s of slides) {
      s.title = fn(s.title || '', false);
      s.subtitle = fn(s.subtitle || '', false);
      s.notes = (s.notes || []).map((n) => fn(n, false));
      visitBlocks(s.blocks);
    }
  }

  // ================= 收尾：兼容视图与步数 =================

  function finalizeSlides(result) {
    for (let k = 0; k < result.length; k++) {
      const s = result[k];
      if (!s.blocks) s.blocks = [];
      if (!s.notes) s.notes = [];
      if (s.number == null) s.number = '';
      if (s.secLabel == null) s.secLabel = '';
      const t = String(s.title || '').trim();
      const isLast = k === result.length - 1;
      if (s.layout !== 'cover' && s.layout !== 'end' && s.layout !== 'quote' && s.layout !== 'toc' && s.layout !== 'refs') {
        if ((isLast && /^(谢谢|感谢|谢幕)/.test(t)) || /^thank\s/i.test(t) || /^(end|q&a|问答)$/i.test(t)) {
          s.layout = 'end';
        } else if (s.title && !s.blocks.length && !s.notes.length) {
          s.layout = 'section';
        }
      }
      s.bullets = [];
      for (const blk of s.blocks) {
        if (blk.type === 'bullets') for (const it of blk.items) s.bullets.push({ text: it.text, level: it.level, code: !!it.code, from: it.from || 1, to: it.to == null ? null : it.to });
        else if (blk.type === 'text') s.bullets.push({ text: blk.text, level: 0, code: false, from: blk.from || 1, to: blk.to == null ? null : blk.to });
      }
      s.rich = s.blocks.some((blk) => isRichBlock(blk));
      s.hasMath = s.blocks.some((blk) => blockHasMath(blk));
      s.hasImage = s.blocks.some((blk) => blk.type === 'image');
      s.hasEnv = s.blocks.some((blk) => blk.type === 'env');
    }
    return result;
  }

  /** 计算每页的 overlay 步数与统计 */
  function assignSteps(slides, stats) {
    let overlaySlides = 0;
    let extra = 0;
    for (const s of slides) {
      let max = 1;
      const bump = (v) => {
        if (Number.isFinite(v) && v > max) max = v;
      };
      for (const b of s.blocks) {
        bump(b.from || 1);
        if (b.to != null) bump(b.to);
        if (b.type === 'bullets') {
          for (const it of b.items) {
            bump(it.from || 1);
            if (it.to != null) bump(it.to);
          }
        }
        for (const text of blockTexts(b)) bump(overlay.maxOverlayStep(maskInlineCode(text)));
      }
      s.steps = Math.max(1, max);
      if (s.steps > 1) {
        overlaySlides++;
        extra += s.steps - 1;
      }
    }
    stats.overlaySlides = overlaySlides;
    stats.steps = extra;
  }

  function blockTexts(blk) {
    if (!blk) return [];
    switch (blk.type) {
      case 'bullets': return blk.items.map((it) => it.text);
      case 'text': return [blk.text];
      case 'callout': return [blk.title, ...blk.items.map((it) => it.text), ...(blk.lines || [])];
      case 'env': return [blk.title, ...blk.blocks.flatMap(blockTexts)];
      case 'algo': return [blk.title, ...(blk.lines || []).map((l) => l.text)];
      case 'table': return (blk.headers || []).concat(...(blk.rows || []));
      case 'image': return [blk.alt || ''];
      default: return [];
    }
  }

  function countInlineMathBlock(blk) {
    if (!blk) return 0;
    return blockTexts(blk).reduce((a, t) => a + countInlineMath(t), 0);
  }

  function blockHasMath(blk) {
    if (!blk) return false;
    if (blk.type === 'math') return true;
    if (blk.type === 'env') return blk.blocks.some(blockHasMath);
    if (blk.type === 'algo') return (blk.lines || []).some((l) => countInlineMath(l.text) > 0);
    return blockTexts(blk).some((t) => countInlineMath(t) > 0);
  }

  function isRichBlock(blk) {
    if (!blk) return false;
    if (blk.type === 'math' || blk.type === 'table' || blk.type === 'callout' || blk.type === 'env') return true;
    if (blk.type === 'algo') return true;
    if (blk.type === 'code') return blk.code.split('\n').length > 14;
    return blockTexts(blk).some((t) => hasRichMarkup(t));
  }

  // ================= 导出 =================
  const api = {
    parseMarkdown,
    finalizeSlides,
    assignSteps,
    inlineToRuns,
    toPlainText,
    stripMetadata,
    maskInlineCode,
    hasRichMarkup,
    countInlineMath,
    extractImages,
    splitTableRow,
    isTableSeparator,
    blockHasMath,
    isRichBlock,
    walkSlideText,
    ENV_DEFS,
    REF_KIND_LABEL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AIPPT = root.AIPPT || {};
  root.AIPPT.parser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
