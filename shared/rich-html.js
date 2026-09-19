/**
 * shared/rich-html.js  (v2.1)
 * 把「富内容块」转成 HTML 片段，交给离屏渲染器出图
 *  - 按 overlay 步骤过滤/变暗（Beamer 渐进显示）
 *  - 定理类环境、公式编号、图表题注
 *  - 代码语法高亮（highlight.js，在 Node 侧完成）
 * 纯函数，可在 Node 中单元测试
 */
'use strict';

const { compatTex } = require('./latex-compat.js');
const ov = require('./overlay.js');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

const ALLOWED_TAGS = ['mark', 'br', 'sub', 'sup', 'b', 'strong', 'i', 'em', 'u', 'kbd', 'small'];
function restoreAllowedTags(s) {
  let out = s;
  for (const t of ALLOWED_TAGS) {
    out = out.replace(new RegExp(`&lt;${t}\\s*/?&gt;`, 'gi'), `<${t}>`);
    out = out.replace(new RegExp(`&lt;/${t}&gt;`, 'gi'), `</${t}>`);
  }
  return out;
}

function unescapeLatexChars(s) {
  return s.replace(/\\([%$&_#{}])/g, '$1').replace(/\\textbackslash\b/g, '\\');
}

function mathSpan(rawTex, display) {
  const tex = compatTex(unescapeEntities(rawTex));
  if (!tex) return '';
  return `<span class="math-inline" data-tex="${escapeHtml(tex)}" data-display="${display ? '1' : '0'}"></span>`;
}

const CODE_TOKEN = '\u0000C';
const OV_TOKEN = '\u0000O';

// ---------------- 代码高亮（Node 侧） ----------------

let hljs = null;
const EXTRA_LANGS = {
  latex: () => require('highlight.js/lib/languages/latex'),
  tex: () => require('highlight.js/lib/languages/latex'),
  matlab: () => require('highlight.js/lib/languages/matlab'),
  julia: () => require('highlight.js/lib/languages/julia'),
  fortran: () => require('highlight.js/lib/languages/fortran'),
  cmake: () => require('highlight.js/lib/languages/cmake'),
  powershell: () => require('highlight.js/lib/languages/powershell'),
  haskell: () => require('highlight.js/lib/languages/haskell'),
  mathematica: () => require('highlight.js/lib/languages/mathematica'),
  asm: () => require('highlight.js/lib/languages/x86asm'),
  x86asm: () => require('highlight.js/lib/languages/x86asm')
};

function getHljs() {
  if (hljs !== null) return hljs;
  try {
    hljs = require('highlight.js/lib/common');
  } catch (e) {
    hljs = false;
  }
  return hljs;
}

/**
 * 高亮代码；失败/未知语言返回 null（调用方退化为纯文本）
 */
function highlightCode(code, lang) {
  const h = getHljs();
  if (!h || !lang) return null;
  const key = String(lang).trim().toLowerCase().replace(/^\{\.?|^\.[^.]*$|^language-/, '');
  if (!key) return null;
  try {
    if (!h.getLanguage(key) && EXTRA_LANGS[key]) {
      h.registerLanguage(key, EXTRA_LANGS[key]());
    }
    if (!h.getLanguage(key)) return null;
    return h.highlight(code, { language: key, ignoreIllegals: true }).value;
  } catch (e) {
    return null;
  }
}

// ---------------- 行内 Markdown → HTML（含公式与 overlay） ----------------

/**
 * @param {string} text
 * @param {{step?:number, mode?:'hide'|'dim'}} [opts]
 */
function inlineToHtml(text, opts) {
  const step = (opts && opts.step) || 1;
  const mode = (opts && opts.mode) || 'hide';
  const raw = String(text == null ? '' : text);

  // 1) 先抽出 code span（避免其中的 \pause / \only<…> 被当作真指令）
  const codes = [];
  const withoutCode = raw.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `${CODE_TOKEN}${codes.length - 1}\u0000`;
  });

  // 2) 再在原始文本上抽出 overlay 命令（转义会破坏 <n-> 的尖括号）
  const overlays = [];
  const pre = ov.replaceOverlayCommands(withoutCode, (cmd, spec, inner) => {
    overlays.push({ cmd, spec, inner });
    return `${OV_TOKEN}${overlays.length - 1}\u0000`;
  });

  let s = escapeHtml(pre);

  // 3) 行文中的 $$...$$ → displaystyle 行内渲染
  s = s.replace(/(?<!\\)\$\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$\$/g, (_m, tex) => mathSpan(`\\displaystyle ${tex}`, false));

  // 4) 行内公式 $...$ 与 \(...\)
  s = s.replace(/(?<!\\)\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$/g, (_m, tex) => mathSpan(tex, false));
  s = s.replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, (_m, tex) => mathSpan(tex, false));

  // 5) 其余行内标记
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  s = s.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => escapeHtml(alias || target));

  s = restoreAllowedTags(unescapeLatexChars(s));

  // 6) 还原 code span
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i) => `<code class="md-inline">${escapeHtml(codes[Number(i)])}</code>`);

  // 7) 还原 overlay 命令（按当前步决定显示/隐藏/变暗）
  s = s.replace(/\u0000O(\d+)\u0000/g, (_m, i) => {
    const o = overlays[Number(i)];
    if (!o) return '';
    const range = ov.parseOverlaySpec(o.spec);
    const visible = step >= range.from && step <= (range.to == null ? Infinity : range.to);
    const inner = inlineToHtml(o.inner, opts);
    const wrap = (cls, extra) => `<span class="${cls}">${inner}</span>${extra || ''}`;
    if (o.cmd === 'only') {
      return visible ? inner : (mode === 'dim' ? wrap('ov-future') : '');
    }
    if (o.cmd === 'alert') {
      if (visible) return wrap('ov-alert');
      return mode === 'collapse' ? '' : wrap('ov-hidden');
    }
    // uncover / visible / onslide：hide 保留占位、dim 灰显、collapse 不输出
    if (visible) return inner;
    if (mode === 'collapse') return '';
    return `<span class="ov-hidden">${inner}</span>`;
  });

  return s;
}

// ---------------- 块渲染 ----------------

function blockVisible(block, step) {
  return ov.visibleAtStep(block, step);
}

/** 依当前步决定包装类（'' | 'ov-future' | 'ov-hidden' | 'ov-drop'） */
function stepClass(entity, step, mode) {
  if (ov.visibleAtStep(entity, step)) return '';
  if (mode === 'collapse') return 'ov-drop';
  return mode === 'dim' ? 'ov-future' : 'ov-hidden';
}

function bulletsHtml(items, opts) {
  const step = (opts && opts.step) || 1;
  const mode = (opts && opts.mode) || 'hide';
  const li = items.map((it) => {
    const lvl = Math.min(it.level || 0, 2);
    const sc = stepClass(it, step, mode);
    if (sc === 'ov-drop') return ''; // 不留空位：整项不输出
    const cls = ['lvl' + lvl];
    if (sc) cls.push(sc);
    const text = it.code
      ? `<code class="md-inline">${escapeHtml(it.text)}</code>`
      : inlineToHtml(it.text, opts);
    return `<li class="${cls.join(' ')}">${text}</li>`;
  }).join('');
  return `<ul class="md-bullets">${li}</ul>`;
}

function paragraphHtml(text, opts) {
  return `<p class="md-p">${inlineToHtml(text, opts)}</p>`;
}

function displayMathHtml(tex, number) {
  const t = compatTex(tex);
  if (!t) return '';
  const body = `<span data-tex="${escapeHtml(t)}" data-display="1"></span>`;
  if (number == null || number === '') {
    return `<div class="math-display"><span class="math-body">${body}</span></div>`;
  }
  return `<div class="math-display math-numbered"><span class="math-body">${body}</span>` +
    `<span class="eq-no">(${escapeHtml(String(number))})</span></div>`;
}

function alignAttr(a) {
  if (a === 'center') return ' style="text-align:center"';
  if (a === 'right') return ' style="text-align:right"';
  return '';
}

function tableHtml(table, opts) {
  const aligns = table.aligns || [];
  const th = (table.headers || [])
    .map((h, i) => `<th${alignAttr(aligns[i])}>${inlineToHtml(h, opts)}</th>`)
    .join('');
  const rows = (table.rows || [])
    .map((r) => {
      const cells = r.map((c, i) => `<td${alignAttr(aligns[i])}>${inlineToHtml(c, opts)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const caption = table.caption
    ? `<div class="tbl-caption">${escapeHtml(table.number ? `表 ${table.number}：` : '')}${inlineToHtml(table.caption, opts)}</div>`
    : '';
  return `${caption}<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

function codeHtml(code, lang) {
  const highlighted = highlightCode(code, lang);
  if (highlighted) {
    return `<pre class="md-code"><code class="hljs">${highlighted}</code></pre>`;
  }
  return `<pre class="md-code">${escapeHtml(code)}</pre>`;
}

const CALLOUT_TITLES = {
  tip: '提示', success: '成功', warning: '注意', caution: '警告', danger: '危险',
  error: '错误', info: '信息', note: '笔记', important: '重要', example: '示例', question: '疑问',
  theorem: '定理', lemma: '引理', corollary: '推论', definition: '定义',
  proof: '证明', remark: '评注', abstract: '摘要'
};
const CALLOUT_TYPES = Object.keys(CALLOUT_TITLES);

function calloutHtml(c, opts) {
  const type = CALLOUT_TYPES.includes(c.kind) ? c.kind : 'note';
  const parts = [];
  if (c.items && c.items.length) parts.push(bulletsHtml(c.items, opts));
  if (c.lines && c.lines.length) parts.push(...c.lines.filter((l) => l.trim()).map((l) => paragraphHtml(l, opts)));
  const title = c.title && c.title.trim() ? c.title : (CALLOUT_TITLES[type] || '');
  return `<div class="callout callout-${type}">` +
    (title ? `<div class="callout-title">${inlineToHtml(title, opts)}</div>` : '') +
    `<div class="callout-body">${parts.join('')}</div></div>`;
}

const ENV_LABELS = {
  theorem: '定理', lemma: '引理', corollary: '推论', proposition: '命题',
  definition: '定义', example: '例', claim: '断言', axiom: '公理',
  conjecture: '猜想', exercise: '练习', proof: '证明', remark: '评注', solution: '解答'
};

function envHtml(block, opts) {
  const env = block.env || 'theorem';
  const kindLabel = ENV_LABELS[env] || env;
  const head = block.number != null ? `${kindLabel} ${block.number}` : kindLabel;
  const body = (block.blocks || []).map((b) => blockToHtml(b, opts)).filter(Boolean).join('');
  const titlePart = block.title ? `<span class="env-name">（${inlineToHtml(block.title, opts)}）</span>` : '';
  const qed = block.qed ? '<span class="env-qed">∎</span>' : '';
  return `<div class="env env-${escapeHtml(env)}">` +
    `<div class="env-head"><span class="env-kind">${escapeHtml(head)}</span>${titlePart}</div>` +
    `<div class="env-body">${body}${qed}</div></div>`;
}

function captionHtml(text, opts) {
  return `<div class="md-figure-caption">${inlineToHtml(text, opts)}</div>`;
}

// ---------------- 算法伪代码 ----------------

const ALGO_KW = {
  if: 'if', elseif: 'else if', else: 'else', endif: 'end if',
  for: 'for', endfor: 'end for', while: 'while', endwhile: 'end while',
  repeat: 'repeat', until: 'until', proc: 'proc', endproc: 'end',
  return: 'return'
};

/**
 * 算法块 → HTML：行号 + 缩进 + 关键字高亮 + 注释灰显。
 * 行内 $…$ 交给同一条公式管线（照样渲染成 KaTeX）。
 */
function algoHtml(block, opts) {
  const head = block.number != null ? `算法 ${block.number}` : '算法';
  const titlePart = block.title ? `<span class="algo-name">${inlineToHtml(block.title, opts)}</span>` : '';
  const lines = block.lines || [];
  const body = lines.map((l, i) => {
    const indent = Math.max(0, Math.min(l.indent || 0, 6));
    const kw = ALGO_KW[l.kind];
    let text = l.text || '';
    let prefix = '';
    if (kw) {
      // 关键字从正文里切出来单独着色（if/for/while/return 等）
      if (text.startsWith(kw)) {
        prefix = `<span class="algo-kw">${escapeHtml(kw)}</span>`;
        text = text.slice(kw.length);
      } else {
        prefix = `<span class="algo-kw">${escapeHtml(kw)}</span>`;
      }
    }
    const cls = ['algo-line', `algo-${l.kind || 'state'}`].join(' ');
    const pad = indent ? ` style="padding-left:${(indent * 1.5).toFixed(2)}em"` : '';
    return `<div class="${cls}"${pad}><span class="algo-no">${i + 1}</span>`
      + `<span class="algo-txt">${prefix}${prefix ? ' ' : ''}${inlineToHtml(text, opts)}</span></div>`;
  }).join('');
  return `<div class="algo"><div class="algo-head"><span class="algo-kind">${escapeHtml(head)}</span>${titlePart}</div>`
    + `<div class="algo-body">${body}</div></div>`;
}

/** 富内容块 → HTML（可见性由 opts.step 决定） */
function blockToHtml(block, opts) {
  if (!block) return '';
  const step = (opts && opts.step) || 1;
  const mode = (opts && opts.mode) || 'hide';
  const cls = stepClass(block, step, mode);
  if (cls === 'ov-drop') return ''; // collapse：整块不输出
  if (cls === 'ov-hidden' && mode === 'hide' && block.type === 'image') return '';
  let inner = '';
  switch (block.type) {
    case 'bullets': inner = bulletsHtml(block.items || [], opts); break;
    case 'text':
    case 'paragraph': inner = paragraphHtml(block.text || '', opts); break;
    case 'math': inner = displayMathHtml(block.tex || '', block.number); break;
    case 'table': inner = tableHtml(block, opts); break;
    case 'code': inner = codeHtml(block.code || '', block.lang); break;
    case 'callout': inner = calloutHtml(block, opts); break;
    case 'env': inner = envHtml(block, opts); break;
    case 'algo': inner = algoHtml(block, opts); break;
    case 'caption': inner = captionHtml(block.text || '', opts); break;
    default: return '';
  }
  if (!inner) return '';
  return cls ? `<div class="ov-block ${cls}">${inner}</div>` : inner;
}

/** 按 overlay 步渲染整页内容 */
function blocksToHtmlStep(blocks, step, mode) {
  return (blocks || [])
    .map((b) => blockToHtml(b, { step: step || 1, mode: mode || 'hide' }))
    .filter(Boolean)
    .join('');
}

/** 兼容旧接口：不分步渲染 */
function blocksToHtml(blocks) {
  return blocksToHtmlStep(blocks, 1, 'hide');
}

module.exports = {
  escapeHtml, inlineToHtml, bulletsHtml, paragraphHtml, displayMathHtml,
  tableHtml, codeHtml, calloutHtml, captionHtml, envHtml, algoHtml,
  blockToHtml, blocksToHtml, blocksToHtmlStep, mathSpan,
  highlightCode, stepClass, ENV_LABELS
};
