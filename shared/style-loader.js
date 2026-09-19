/**
 * shared/style-loader.js
 * **样式插件**的加载、校验与派生。
 *
 * 设计目标：让「样式」从写死在 shared/styles.js 里的一份数组，变成**可以导入的 JSON 文件**。
 *
 * 一个样式插件 = 一个 JSON 文件（建议扩展名 .aippt-style.json），最小只需给颜色：
 *   {
 *     "$schema": "aippt-style/1",
 *     "id": "beamer-academic",
 *     "name": "Beamer 学术",
 *     "desc": "衬线 · 深蓝 · 米白",
 *     "font": "Latin Modern Roman, Cambria, 宋体",
 *     "mono": "Consolas",
 *     "colors": {
 *       "primary": "#1B3A6B", "accent": "#B8860B",
 *       "text": "#101828", "textSub": "#667085",
 *       "bg": "#FFFFFF", "bgAlt": "#F2F5FA",
 *       "coverBg": "#0E2440", "coverText": "#FFFFFF", "coverSub": "#A8C0DC"
 *     },
 *     "layout": { "titleSize": 26, "bodySize": 15, "marginX": 0.95, "radius": 6, "navMax": 8 }
 *   }
 *
 * 安全性：样式只影响**视觉**（颜色/字体/少量尺寸），不能执行代码、不能带文件路径、
 * 不能改变版式结构；所有取值都会被规范化（颜色必须是 #RRGGBB、字号有上下限）。
 * 这样即使用户从网上随便下载一个样式文件，也不会把软件搞坏。
 */
'use strict';

const SCHEMA = 'aippt-style/1';

const COLOR_KEYS = ['primary', 'accent', 'text', 'textSub', 'bg', 'bgAlt', 'coverBg', 'coverText', 'coverSub', 'deco1', 'deco2'];
const REQUIRED = ['id', 'name'];
const LIMITS = {
  titleSize: [16, 54],
  bodySize: [10, 28],
  marginX: [0.4, 2.2],
  radius: [0, 24],
  navMax: [2, 20],
  lineGap: [0.5, 2.0]
};

/** 十六进制颜色校验并归一化为 #RRGGBB */
function normColor(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

/** 颜色按比例向白色混合（派生浅色边框/底纹用） */
function tint(hex, ratio) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * ratio).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}

/** 相对亮度，用于自动决定"深底还是浅底" */
function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function clampNum(v, [lo, hi], dflt) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/i;

/**
 * 校验一个样式对象（不抛异常，返回问题清单）
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validateStyle(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['样式必须是一个 JSON 对象'], warnings };
  }
  for (const k of REQUIRED) {
    if (!raw[k] || typeof raw[k] !== 'string') errors.push(`缺少必填字段 ${k}`);
  }
  if (raw.id && !ID_RE.test(String(raw.id))) {
    errors.push(`id "${raw.id}" 不合法（只能用小写字母/数字/._-，2~48 字符）`);
  }
  const colors = raw.colors && typeof raw.colors === 'object' ? raw.colors : raw;
  const known = [...COLOR_KEYS, 'colors', 'font', 'mono', 'id', 'name', 'desc', '$schema', 'layout', 'author', 'version', 'basedOn'];
  for (const k of Object.keys(raw)) {
    if (!known.includes(k)) warnings.push(`忽略了未知字段 ${k}`);
  }
  for (const k of COLOR_KEYS) {
    if (colors[k] == null) continue;
    if (normColor(colors[k]) == null) errors.push(`颜色字段 ${k} 不是合法的 #RRGGBB：${colors[k]}`);
  }
  if (raw.layout && typeof raw.layout !== 'object') errors.push('layout 必须是对象');
  if (raw.layout) {
    for (const k of Object.keys(raw.layout)) {
      if (!Object.prototype.hasOwnProperty.call(LIMITS, k)) warnings.push(`忽略了未知 layout 字段 ${k}`);
    }
  }
  if (typeof colors.text === 'string' && typeof colors.bg === 'string') {
    const t = normColor(colors.text);
    const b = normColor(colors.bg);
    if (t && b && contrastRatio(t, b) < 3) {
      warnings.push(`正文色与背景色对比度过低（${contrastRatio(t, b).toFixed(1)}:1，建议 ≥ 4.5），导出后可能看不清`);
    }
  }
  if (typeof colors.coverText === 'string' && typeof colors.coverBg === 'string') {
    const t = normColor(colors.coverText);
    const b = normColor(colors.coverBg);
    if (t && b && contrastRatio(t, b) < 3) {
      warnings.push('封面标题色与封面背景对比度过低，封面标题可能看不清');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** WCAG 对比度（1~21） */
function contrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 规范化：补齐缺省字段、派生 deco1/deco2、限制数值范围。
 * @param {object} raw   原始 JSON
 * @param {object} [base] 缺省值来源（通常是内置样式），便于"只改几个颜色"的极简样式
 */
function normalizeStyle(raw, base) {
  const b = base || DEFAULT_STYLE;
  const src = raw && typeof raw === 'object' ? raw : {};
  const inColors = src.colors && typeof src.colors === 'object' ? src.colors : src;
  const out = {
    id: String(src.id || '').trim(),
    name: String(src.name || '').trim(),
    desc: String(src.desc || '自定义样式').trim(),
    font: String(src.font || b.font),
    mono: String(src.mono || b.mono || 'Consolas'),
    author: src.author ? String(src.author) : '',
    version: src.version ? String(src.version) : '1',
    custom: true
  };
  for (const k of COLOR_KEYS) {
    const v = inColors[k] != null ? normColor(inColors[k]) : null;
    out[k] = v || b[k];
  }
  // 未给装饰色时按主色/点缀色派生，避免出现空白装饰
  if (inColors.deco1 == null) out.deco1 = out.primary;
  if (inColors.deco2 == null) out.deco2 = out.accent;
  out.tintLine = tint(out.primary, 0.86);
  out.tintSoft = tint(out.primary, 0.93);
  out.onDark = luminance(out.coverBg) < 0.4;
  const L = src.layout && typeof src.layout === 'object' ? src.layout : {};
  out.layout = {};
  for (const k of Object.keys(LIMITS)) {
    out.layout[k] = clampNum(L[k], LIMITS[k], b.layout ? b.layout[k] : undefined);
    if (out.layout[k] === undefined) delete out.layout[k];
  }
  if (src.basedOn) out.basedOn = String(src.basedOn);
  return out;
}

/** 从 JSON 文本解析样式；返回 {ok, style?, errors, warnings} */
function parseStyle(text, base) {
  let raw;
  try {
    raw = JSON.parse(String(text == null ? '' : text));
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${e.message}`], warnings: [] };
  }
  const v = validateStyle(raw);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };
  return { ok: true, style: normalizeStyle(raw, base), errors: [], warnings: v.warnings };
}

/**
 * 合并内置样式与自定义样式。
 * 同 id 时：默认**不要**静默覆盖内置样式（避免用户导入一个叫 tech-blue 的文件把内置样式弄丢），
 * 而是让自定义样式让位并在 warnings 里说明；可用 { override: true } 强制覆盖。
 */
function mergeStyles(builtin, custom, opts = {}) {
  const out = (builtin || []).slice();
  const warnings = [];
  const byId = new Map(out.map((s) => [s.id, s]));
  for (const raw of custom || []) {
    const v = validateStyle(raw);
    if (!v.ok) {
      warnings.push(`样式「${raw && raw.id ? raw.id : '?'}」被跳过：${v.errors[0]}`);
      continue;
    }
    const st = normalizeStyle(raw, byId.get(raw.basedOn) || undefined);
    if (byId.has(st.id)) {
      if (!opts.override) {
        warnings.push(`样式 id「${st.id}」与已有样式重名，已跳过（改名后可用）`);
        continue;
      }
      const idx = out.findIndex((s) => s.id === st.id);
      out[idx] = st;
      byId.set(st.id, st);
      warnings.push(`样式「${st.name}」覆盖了内置样式 ${st.id}`);
      continue;
    }
    out.push(st);
    byId.set(st.id, st);
  }
  return { styles: out, warnings };
}

/** 内置样式的字段基线（自定义样式没写的字段用它兜底） */
const DEFAULT_STYLE = {
  id: 'custom',
  name: '自定义',
  desc: '自定义样式',
  font: 'Microsoft YaHei',
  mono: 'Consolas',
  primary: '#1E5EFF',
  accent: '#38BDF8',
  text: '#101828',
  textSub: '#667085',
  bg: '#FFFFFF',
  bgAlt: '#EFF4FF',
  coverBg: '#0A1733',
  coverText: '#FFFFFF',
  coverSub: '#9DB8E8',
  deco1: '#1E5EFF',
  deco2: '#38BDF8',
  layout: { titleSize: 26, bodySize: 15, marginX: 0.95, radius: 6, navMax: 8, lineGap: 1.0 }
};

const api = {
  SCHEMA,
  COLOR_KEYS,
  LIMITS,
  DEFAULT_STYLE,
  validateStyle,
  normalizeStyle,
  parseStyle,
  mergeStyles,
  normColor,
  tint,
  luminance
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') {
  globalThis.AIPPT = globalThis.AIPPT || {};
  globalThis.AIPPT.styleLoader = api;
}
