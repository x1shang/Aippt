/**
 * shared/mml2omml.js
 * MathML → OMML（DrawingML / pptx 版）——纯 JavaScript，零依赖、不需要 TeX。
 *
 * 为什么是 OMML：这是 PowerPoint 的**原生公式对象**。写进 pptx 后双击就能进公式编辑器，
 * 与「公式渲染成图片」完全不是一个东西（导出的 pptx 里公式可改、可缩放、可换字体颜色）。
 *
 * 与 Word 版 OMML 的关键差别（踩过坑，务必保持）：
 *   1. run 属性用 <a:rPr>（DrawingML 命名空间），不是 Word 的 <w:rPr>；
 *      直接搬 Word/pandoc 生成的 OMML 会把非法的 w: 元素带进 slide，PowerPoint 会报修复。
 *   2. 公式不放在 <w:p> 里，而是放进 pptx 段落的 <a14:m> 中：
 *        块级：<a14:m><m:oMathPara><m:oMathParaPr><m:jc m:val="centerGroup"/>…
 *        行内：<a14:m><m:oMath>…（插在同一 <a:p> 的多个 <a:r> 之间，整段仍可编辑）
 *   参考 [MS-ODRAWXML] 3.5 Math 给出的 PowerPoint 官方示例结构。
 *
 * 自带一个极小的 XML 解析器：MathML 是很小的 XML 子集，这样本模块在 Node 与浏览器里
 * 都能跑，不必依赖 @xmldom/xmldom 之类的 DOM 实现。
 */
'use strict';

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

// ============================================================
// 一、极简 XML 解析（只服务 MathML，够用即可）
// ============================================================

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}

/**
 * 解析为轻量树：{ tag, attrs, children }
 * 文本节点：{ tag: '#text', text }
 * tag 只保留局部名（去命名空间前缀），attrs 的键同样去前缀。
 */
function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const s = String(src || '');

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      pushText(stack[stack.length - 1], s.slice(i));
      break;
    }
    if (lt > i) pushText(stack[stack.length - 1], s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt);
      const end = e < 0 ? s.length : e;
      pushText(stack[stack.length - 1], s.slice(lt + 9, end));
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith('<?', lt) || s.startsWith('<!', lt)) { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; continue; }

    const gt = s.indexOf('>', lt);
    if (gt < 0) break;
    const head = s.slice(lt + 1, gt);
    if (head[0] === '/') {
      const name = localName(head.slice(1).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) { stack.length = k; break; }
      }
      i = gt + 1;
      continue;
    }
    const selfClose = head.endsWith('/');
    const body = selfClose ? head.slice(0, -1) : head;
    const sp = body.search(/[\s/]/);
    const name = localName(sp < 0 ? body : body.slice(0, sp));
    const node = { tag: name, attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [] };
    if (!selfClose) stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  return root;
}

function localName(n) {
  const s = String(n).trim();
  const c = s.indexOf(':');
  return (c < 0 ? s : s.slice(c + 1)).toLowerCase();
}

function parseAttrs(s) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    attrs[localName(m[1])] = decodeEntities(m[3] != null ? m[3] : m[4]);
  }
  return attrs;
}

function pushText(parent, raw) {
  const text = decodeEntities(raw);
  if (!text) return;
  parent.children.push({ tag: '#text', text });
}

function elements(node) {
  return (node && node.children ? node.children : []).filter((c) => c.tag !== '#text');
}

function textOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  return (node.children || []).map(textOf).join('');
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ============================================================
// 二、MathML → OMML
// ============================================================

/** n 元运算符（∑ ∫ ∏ ⋃ ⋂ …）：必须走 m:nary，上下限位置才正确 */
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '∯', '∰', '⋂', '⋃', '⨁', '⨂', '⨀', '⨄', '⨆']);
/** 关系符：nary 操作数收集到此为止 */
const RELATION = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∼', '→', '⇒', '∈', '⊂', '⊆', ',', ';', '⟹', '⟶']);
const FENCE_OPEN = { '(': ')', '[': ']', '{': '}', '⟨': '⟩', '|': '|', '‖': '‖', '⌈': '⌉', '⌊': '⌋' };
/** 间距重音 → 组合重音字符（\bar → U+0304 等），与 Word 的写法一致 */
const ACCENT_MAP = {
  '^': '\u0302', '\u02c6': '\u0302', '¯': '\u0304', '\u00af': '\u0304', '-': '\u0304',
  '~': '\u0303', '\u02dc': '\u0303', '˜': '\u0303', "'": '\u0301', '´': '\u0301',
  '.': '\u0307', '˙': '\u0307', '¨': '\u0308', 'ˇ': '\u030c', '`': '\u0300',
  '→': '\u20d7', '⃗': '\u20d7', '\u2192': '\u20d7', '↔': '\u20e1'
};
const isAccentChar = (c) => /[\u0300-\u036f\u20d0-\u20ef]/.test(c) || Object.prototype.hasOwnProperty.call(ACCENT_MAP, c);

class Mml2Omml {
  /**
   * @param {object} opts
   *   szPt     字号（磅），写进每个 <a:rPr sz="...">
   *   typeface 数学字体，默认 Cambria Math（Office 自带）
   *   color    16 进制颜色（不带 #），可选
   *   compact  是否合并属性相同的相邻 run（默认 true，省约 20% 体积）
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.sz = Math.round((opts.szPt || 18) * 100);
    this.typeface = opts.typeface || 'Cambria Math';
    this.color = opts.color || null;
  }

  rPr() {
    const color = this.color ? `<a:solidFill><a:srgbClr val="${this.color}"/></a:solidFill>` : '';
    return `<a:rPr lang="en-US" sz="${this.sz}" dirty="0">${color}<a:latin typeface="${esc(this.typeface)}"/></a:rPr>`;
  }

  /** 单个 run；nor=true → 强制正体（mtext、多字符标识符） */
  run(text, nor) {
    if (text == null || text === '') return '';
    return `<m:r>${nor ? '<m:rPr><m:nor/></m:rPr>' : ''}${this.rPr()}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
  }

  ctrl() { return `<m:ctrlPr>${this.rPr()}</m:ctrlPr>`; }

  emit(node) {
    if (!node) return '';
    if (node.tag === '#text') return this.run(node.text);
    const tag = node.tag;
    switch (tag) {
      case 'math':
      case 'mrow':
      case 'semantics':
      case 'mstyle':
      case 'mpadded':
      case 'mphantom':
      case 'merror':
      case 'menclose':
        return this.emitSequence(node.children);
      case 'annotation':
      case 'annotation-xml':
      case 'mspace':
        return '';
      case 'mi': {
        const t = textOf(node);
        const variant = (node.attrs.mathvariant || '').toLowerCase();
        return this.run(t, variant === 'normal' || variant === 'upright' || t.length > 1);
      }
      case 'mn':
      case 'mo':
        return this.run(textOf(node), false);
      case 'mtext':
        return this.run(textOf(node), true);
      case 'mfrac': {
        const [num, den] = elements(node);
        const lt = node.attrs.linethickness;
        const type = lt === '0' || lt === '0px' ? 'noBar' : 'bar';
        return `<m:f><m:fPr><m:type m:val="${type}"/>${this.ctrl()}</m:fPr><m:num>${this.emit(num)}</m:num><m:den>${this.emit(den)}</m:den></m:f>`;
      }
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="on"/>${this.ctrl()}</m:radPr><m:deg/><m:e>${this.emitSequence(node.children)}</m:e></m:rad>`;
      case 'mroot': {
        const [base, deg] = elements(node);
        return `<m:rad><m:radPr>${this.ctrl()}</m:radPr><m:deg>${this.emit(deg)}</m:deg><m:e>${this.emit(base)}</m:e></m:rad>`;
      }
      case 'msup': {
        const n = this.naryInfo(node);
        if (n) return this.nary(n.chr, n.sub, n.sup, '', n.limLoc);
        const [b, s] = elements(node);
        return `<m:sSup><m:sSupPr>${this.ctrl()}</m:sSupPr><m:e>${this.emit(b)}</m:e><m:sup>${this.emit(s)}</m:sup></m:sSup>`;
      }
      case 'msub': {
        const n = this.naryInfo(node);
        if (n) return this.nary(n.chr, n.sub, n.sup, '', n.limLoc);
        const [b, s] = elements(node);
        return `<m:sSub><m:sSubPr>${this.ctrl()}</m:sSubPr><m:e>${this.emit(b)}</m:e><m:sub>${this.emit(s)}</m:sub></m:sSub>`;
      }
      case 'msubsup': {
        const n = this.naryInfo(node);
        if (n) return this.nary(n.chr, n.sub, n.sup, '', n.limLoc);
        const [b, s, p] = elements(node);
        return `<m:sSubSup><m:sSubSupPr>${this.ctrl()}</m:sSubSupPr><m:e>${this.emit(b)}</m:e><m:sub>${this.emit(s)}</m:sub><m:sup>${this.emit(p)}</m:sup></m:sSubSup>`;
      }
      case 'mover': {
        const [b, o] = elements(node);
        const chr = o ? textOf(o).trim() : '';
        const accent = (node.attrs.accent || '').toLowerCase() === 'true'
          || (chr.length > 0 && chr.length <= 2 && isAccentChar(chr));
        if (accent) {
          const mapped = ACCENT_MAP[chr] || chr || '\u0302';
          return `<m:acc><m:accPr><m:chr m:val="${esc(mapped)}"/>${this.ctrl()}</m:accPr><m:e>${this.emit(b)}</m:e></m:acc>`;
        }
        return `<m:limUpp><m:limUppPr>${this.ctrl()}</m:limUppPr><m:e>${this.emit(b)}</m:e><m:lim>${this.emit(o)}</m:lim></m:limUpp>`;
      }
      case 'munder': {
        const [b, u] = elements(node);
        const chr = u ? textOf(u).trim() : '';
        const under = (node.attrs.accentunder || '').toLowerCase() === 'true' || chr === '_' || chr === '\u0332';
        if (under) {
          const mapped = chr === '_' ? '\u0332' : (chr || '\u0332');
          return `<m:acc><m:accPr><m:chr m:val="${esc(mapped)}"/>${this.ctrl()}</m:accPr><m:e>${this.emit(b)}</m:e></m:acc>`;
        }
        return `<m:limLow><m:limLowPr>${this.ctrl()}</m:limLowPr><m:e>${this.emit(b)}</m:e><m:lim>${this.emit(u)}</m:lim></m:limLow>`;
      }
      case 'munderover':
        return this.emitUnderOver(node);
      case 'mfenced': {
        const open = node.attrs.open;
        const close = node.attrs.close;
        return this.delimiter(open == null ? '(' : open, close == null ? ')' : close, this.emitSequence(node.children));
      }
      case 'mtable':
        return this.emitTable(node);
      case 'mtr':
      case 'mtd':
        return this.emitSequence(node.children);
      default:
        // 未知元素：有子元素就递归，没有就降级为文字，绝不静默丢内容
        return elements(node).length ? this.emitSequence(node.children) : this.run(textOf(node), true);
    }
  }

  /** 判断是不是 fence（含 Temml/KaTeX 用空 postfix 表示 cases 右括号缺失的写法） */
  fenceChar(node) {
    if (!node || node.tag !== 'mo') return null;
    const t = textOf(node).trim();
    const form = node.attrs.form || '';
    if ((node.attrs.fence || '') !== 'true') {
      return null;
    }
    if (form === 'postfix') return { char: t, role: 'close' };
    if (Object.prototype.hasOwnProperty.call(FENCE_OPEN, t)) return { char: t, role: 'open' };
    return null;
  }

  /** ∑/∫ 型：<munderover> 用 undOvr，行内模式的 <msubsup> 用 subSup */
  naryInfo(node) {
    const kids = elements(node);
    if (!kids.length) return null;
    const chr = textOf(kids[0]).trim();
    if (!NARY.has(chr)) return null;
    const tag = node.tag;
    if (tag === 'munderover') return { chr, sub: this.emit(kids[1]), sup: this.emit(kids[2]), limLoc: 'undOvr' };
    if (tag === 'msubsup') return { chr, sub: this.emit(kids[1]), sup: this.emit(kids[2]), limLoc: 'subSup' };
    if (tag === 'msub') return { chr, sub: this.emit(kids[1]), sup: '', limLoc: 'subSup' };
    if (tag === 'msup') return { chr, sub: '', sup: this.emit(kids[1]), limLoc: 'subSup' };
    return null;
  }

  emitUnderOver(node) {
    const n = this.naryInfo(node);
    if (n) return this.nary(n.chr, n.sub, n.sup, '', n.limLoc);
    const [base, sub, sup] = elements(node);
    const subXml = sub ? this.emit(sub) : '';
    const supXml = sup ? this.emit(sup) : '';
    if (sub && sup) {
      return `<m:sSubSup><m:sSubSupPr>${this.ctrl()}</m:sSubSupPr><m:e>${this.emit(base)}</m:e><m:sub>${subXml}</m:sub><m:sup>${supXml}</m:sup></m:sSubSup>`;
    }
    if (sub) return `<m:limLow><m:limLowPr>${this.ctrl()}</m:limLowPr><m:e>${this.emit(base)}</m:e><m:lim>${subXml}</m:lim></m:limLow>`;
    if (sup) return `<m:limUpp><m:limUppPr>${this.ctrl()}</m:limUppPr><m:e>${this.emit(base)}</m:e><m:lim>${supXml}</m:lim></m:limUpp>`;
    return this.emit(base);
  }

  nary(chr, sub, sup, operand, limLoc) {
    const chrXml = chr ? `<m:chr m:val="${esc(chr)}"/>` : '';
    const loc = limLoc || 'undOvr';
    return `<m:nary><m:naryPr>${chrXml}<m:limLoc m:val="${loc}"/>`
      + `<m:subHide m:val="${sub ? 'off' : 'on'}"/><m:supHide m:val="${sup ? 'off' : 'on'}"/>${this.ctrl()}</m:naryPr>`
      + `<m:sub>${sub || ''}</m:sub><m:sup>${sup || ''}</m:sup><m:e>${operand || ''}</m:e></m:nary>`;
  }

  delimiter(open, close, inner) {
    const beg = open ? `<m:begChr m:val="${esc(open)}"/>` : '';
    const end = close == null ? '' : `<m:endChr m:val="${esc(close)}"/>`;
    return `<m:d><m:dPr>${beg}${end}<m:grow m:val="1"/>${this.ctrl()}</m:dPr><m:e>${inner}</m:e></m:d>`;
  }

  emitTable(node) {
    const rows = elements(node).filter((n) => n.tag === 'mtr');
    if (!rows.length) return '';
    const cols = Math.max(1, elements(rows[0]).length);
    let body = '';
    for (const r of rows) {
      let cells = '';
      for (const c of elements(r)) cells += `<m:e>${this.emitSequence(c.children)}</m:e>`;
      body += `<m:mr>${cells}</m:mr>`;
    }
    return `<m:m><m:mPr><m:baseJc m:val="center"/><m:plcHide m:val="on"/>`
      + `<m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>`
      + `${this.ctrl()}</m:mPr>${body}</m:m>`;
  }

  /**
   * 容器 → OMML 序列，同时处理：
   *   1) 成对定界符 → m:d（括号随内容拉伸，这是 ( ) 内套分式好看的关键）
   *   2) n 元运算符 → m:nary，并把其后操作数收进 <m:e>（与在 Word 里敲公式的结构一致）
   */
  emitSequence(children) {
    const nodes = (children || []).filter((n) => n.tag !== '#text' || String(n.text).trim());
    let out = '';
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.tag === '#text') { out += this.run(node.text); continue; }

      // 1) 定界符配对
      const f = this.fenceChar(node);
      if (f && f.role === 'open') {
        let depth = 1;
        let j = i + 1;
        let inner = '';
        let found = null;
        for (; j < nodes.length; j++) {
          const c = nodes[j].tag === '#text' ? null : this.fenceChar(nodes[j]);
          if (c && c.role === 'open') depth++;
          else if (c && c.role === 'close') {
            depth--;
            if (depth === 0) { found = c; break; }
          }
          inner += this.emit(nodes[j]);
        }
        if (found) {
          out += this.delimiter(f.char, found.char === '' ? null : found.char, inner);
          i = j;
          continue;
        }
        // 没有配对收尾（KaTeX 的 cases 就是如此）：仍给左括号，保证拉伸
        out += this.delimiter(f.char, null, inner);
        i = j - 1;
        continue;
      }

      // 2) n 元运算符
      const nary = (node.tag === 'munderover' || node.tag === 'msubsup' || node.tag === 'msub' || node.tag === 'msup')
        ? this.naryInfo(node) : null;
      if (nary) {
        let operand = '';
        let j = i + 1;
        while (j < nodes.length) {
          const nxt = nodes[j];
          if (nxt.tag === 'mo' && RELATION.has(textOf(nxt).trim())) break;
          operand += this.emit(nxt);
          j++;
        }
        i = j - 1;
        out += this.nary(nary.chr, nary.sub, nary.sup, operand, nary.limLoc);
        continue;
      }

      out += this.emit(node);
    }
    return out;
  }

  /** MathML 源串 → OMML 主体（不含 a14:m / oMathPara 包装） */
  convert(mathml) {
    const root = parseXml(mathml);
    const math = findFirst(root, 'math') || root;
    const body = this.emitSequence(math.children);
    return this.opts.compact === false ? body : compactRuns(body);
  }
}

function findFirst(node, tag) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.tag === tag) return c;
    const hit = findFirst(c, tag);
    if (hit) return hit;
  }
  return null;
}

/** 合并属性完全相同的相邻 run：OMML 体积大头是每个 run 重复的 <a:rPr>。纯等价变换。 */
function compactRuns(xml) {
  const re = /<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?(<a:rPr[^>]*>[\s\S]*?<\/a:rPr>)<m:t xml:space="preserve">([\s\S]*?)<\/m:t><\/m:r>/g;
  const parts = [];
  let pos = 0;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m.index > pos) parts.push({ raw: xml.slice(pos, m.index) });
    parts.push({ run: { props: (m[1] || '') + m[2], text: m[3] } });
    pos = m.index + m[0].length;
  }
  if (pos < xml.length) parts.push({ raw: xml.slice(pos) });
  const merged = [];
  for (const p of parts) {
    if (p.run) {
      const last = merged[merged.length - 1];
      if (last && last.run && last.run.props === p.run.props) last.run.text += p.run.text;
      else merged.push({ run: { props: p.run.props, text: p.run.text } });
    } else merged.push(p);
  }
  return merged.map((p) => (p.run ? `<m:r>${p.run.props}<m:t xml:space="preserve">${p.run.text}</m:t></m:r>` : p.raw)).join('');
}

/**
 * MathML 字符串 → 可直接放进 pptx 段落的片段。
 * @param {string} mathml
 * @param {object} opts { display, szPt, typeface, color, compact }
 * @returns {{xml:string, body:string}}
 */
function mmlToOmml(mathml, opts = {}) {
  const conv = new Mml2Omml(opts);
  const body = conv.convert(mathml);
  const oMath = `<m:oMath xmlns:m="${M_NS}">${body}</m:oMath>`;
  const inner = opts.display
    ? `<m:oMathPara xmlns:m="${M_NS}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>${oMath}</m:oMathPara>`
    : oMath;
  return {
    body,
    xml: `<a14:m xmlns:a14="${A14_NS}" xmlns:a="${A_NS}">${inner}</a14:m>`
  };
}

module.exports = { mmlToOmml, Mml2Omml, compactRuns, parseXml, M_NS, A14_NS, A_NS };
