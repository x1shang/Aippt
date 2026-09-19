/**
 * shared/latex-compat.js
 * 把「真实 LaTeX / Obsidian MathJax」里 KaTeX 不支持的写法，转换为等价可渲染写法
 * 目的：用户 md 里的公式尽量原样渲染，不因个别宏而整段失败
 */
'use strict';

/** 取平衡花括号参数（不含外层括号） */
function takeBraced(s, start) {
  if (s[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return { inner: s.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** 替换 \cmd{..}{..} 形式的宏 */
function replaceMacro2(s, name, fn) {
  const re = new RegExp('\\\\' + name + '\\s*\\{', 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const a = takeBraced(s, m.index + m[0].length - 1);
    if (!a) continue;
    let idx = a.end;
    while (idx < s.length && s[idx] === ' ') idx++;
    const b = takeBraced(s, idx);
    if (!b) continue;
    out += s.slice(last, m.index) + fn(a.inner, b.inner);
    last = b.end;
    re.lastIndex = b.end;
  }
  return out + s.slice(last);
}

/** 替换 \cmd{..} 形式的宏 */
function replaceMacro1(s, name, fn) {
  const re = new RegExp('\\\\' + name + '\\s*\\{', 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const a = takeBraced(s, m.index + m[0].length - 1);
    if (!a) continue;
    out += s.slice(last, m.index) + fn(a.inner);
    last = a.end;
    re.lastIndex = a.end;
  }
  return out + s.slice(last);
}

// 环境名 → KaTeX 支持的等价环境
const ENV_MAP = {
  align: 'aligned',
  'align*': 'aligned',
  aligned: 'aligned',
  alignat: 'alignedat',
  eqnarray: 'aligned',
  'eqnarray*': 'aligned',
  flalign: 'aligned',
  'flalign*': 'aligned',
  split: 'aligned',
  multline: 'gathered',
  'multline*': 'gathered',
  gather: 'gathered',
  'gather*': 'gathered',
  equation: 'aligned',
  'equation*': 'aligned',
  displaymath: 'aligned',
  math: 'aligned',
  dmath: 'aligned'
};

const ENV_ALIGNAT = { alignat: true, 'alignat*': true };

/**
 * siunitx 的 \pu/\si/\qty：内容里混着正体单位与 ^/_ 上下标，
 * 直接塞进 \text{} 会让 KaTeX 在 `^` 上报错（\\pu{9.8 m/s^2} 是极常见写法）。
 * 这里把上下标拆到 \text{} 外面：\pu{9.8 m/s^2} → \text{9.8 m/s}^{\text{2}}
 */
function quantityTex(raw) {
  const parts = String(raw == null ? '' : raw).split(/(\^\{[^{}]*\}|\^\w|_\{[^{}]*\}|_\w)/);
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const m = /^([\^_])(\{?)([^{}]*)(\}?)$/.exec(p);
    if (m) {
      const body = m[3].replace(/[{}]/g, '').trim();
      out += body ? `${m[1]}{\\text{${body}}}` : '';
    } else {
      out += `\\text{${p}}`;
    }
  }
  return out || '\\text{}';
}

/**
 * @param {string} tex 原始公式源码
 * @returns {string} 兼容 KaTeX 的公式源码
 */
function compatTex(tex) {
  let s = String(tex == null ? '' : tex);

  // 1) 去掉对幻灯片无意义的引用/编号标记
  s = s.replace(/\\label\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\(eqref|ref|pageref|autoref|cref|Cref)\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\(nonumber|notag)\b/g, '');
  s = s.replace(/\\tag\*?\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\hspace\*?\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\vspace\*?\s*\{[^{}]*\}/g, '');
  s = s.replace(/\\(bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr)\b/g, (m) => m); // KaTeX 支持，保留
  s = s.replace(/\\hline\b/g, '');
  s = s.replace(/\\cline\s*\{[^{}]*\}/g, '');

  // 2) 环境名归一化（align/equation/multline → KaTeX 支持的子环境）
  s = s.replace(/\\(begin|end)\s*\{([a-zA-Z*]+)\}/g, (m, kind, env) => {
    const mapped = ENV_MAP[env];
    if (!mapped) return m;
    if (ENV_ALIGNAT[env]) return `\\${kind}{alignedat}`;
    return `\\${kind}{${mapped}}`;
  });
  // alignedat 需要 {n} 参数：补一个宽松值
  s = s.replace(/\\begin\{alignedat\}/g, '\\begin{alignedat}{2}');
  s = s.replace(/\\end\{alignedat\}/g, '\\end{alignedat}');

  // 3) siunitx / physics / 其他宏包的可视等价替换
  s = replaceMacro2(s, 'qty', (a, b) => `${quantityTex(a)}\\ ${quantityTex(b)}`);
  s = replaceMacro2(s, 'SI', (a, b) => `${quantityTex(a)}\\ ${quantityTex(b)}`);
  s = replaceMacro1(s, 'pu', quantityTex);
  s = replaceMacro1(s, 'si', quantityTex);
  s = replaceMacro1(s, 'num', quantityTex);
  s = replaceMacro2(s, 'dv', (a, b) => `\\frac{\\mathrm{d}${a}}{\\mathrm{d}${b}}`);
  s = replaceMacro2(s, 'pdv', (a, b) => `\\frac{\\partial ${a}}{\\partial ${b}}`);
  // cancel 宏包：KaTeX 支持 \cancel/\bcancel/\xcancel，但不支持 \cancelto
  s = replaceMacro2(s, 'cancelto', (target, expr) => `\\overset{\\rightarrow ${target}}{\\cancel{${expr}}}`);
  s = replaceMacro1(s, 'braket', (a) => `\\left\\langle ${a} \\right\\rangle`);
  s = replaceMacro1(s, 'bra', (a) => `\\left\\langle ${a} \\right|`);
  s = replaceMacro1(s, 'ket', (a) => `\\left| ${a} \\right\\rangle`);
  s = replaceMacro1(s, 'ev', (a) => `\\left\\langle ${a} \\right\\rangle`);
  s = replaceMacro1(s, 'abs', (a) => `\\left| ${a} \\right|`);
  s = replaceMacro1(s, 'norm', (a) => `\\left\\| ${a} \\right\\|`);
  s = replaceMacro1(s, 'ce', (a) => `\\ce{${a}}`); // mhchem 扩展负责

  s = s.replace(/\\degree\b/g, '^{\\circ}');
  s = s.replace(/\\dd\b/g, '\\mathrm{d}');
  s = s.replace(/\\dif\b/g, '\\mathrm{d}');
  s = s.replace(/\\RR\b/g, '\\mathbb{R}');
  s = s.replace(/\\NN\b/g, '\\mathbb{N}');
  s = s.replace(/\\ZZ\b/g, '\\mathbb{Z}');
  s = s.replace(/\\QQ\b/g, '\\mathbb{Q}');
  s = s.replace(/\\CC\b/g, '\\mathbb{C}');
  s = s.replace(/\\textsuperscript\s*\{([^{}]*)\}/g, '^{\\text{$1}}');
  s = s.replace(/\\textsubscript\s*\{([^{}]*)\}/g, '_{\\text{$1}}');
  s = s.replace(/\\bm\s*\{/g, '\\boldsymbol{');
  s = s.replace(/\\operatorname\*\s*\{/g, '\\operatorname{');

  // 4) aligned 里单独的 \\[2pt] 之类间距：KaTeX 支持 \\[..]，保留
  return s.trim();
}

module.exports = { compatTex, takeBraced };
