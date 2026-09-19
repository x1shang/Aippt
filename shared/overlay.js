/**
 * shared/overlay.js
 * Beamer 风格渐进显示（overlay）支持
 *   - `\pause` 分步
 *   - `\onslide<n->` 设置后续内容的起始步
 *   - 列表项后缀 `<2->` / `<2>` / `<2-4>`
 *   - 行内 `\only<n->{…}` / `\uncover<n->{…}` / `\visible<n->{…}` / `\alert<n->{…}`
 * 供解析器（统计步数、过滤块）与 HTML 生成（按步渲染）共用
 */
(function (root) {
  'use strict';

  const OVERLAY_CMDS = ['only', 'uncover', 'visible', 'alert', 'onslide'];
  const CMD_HEAD = new RegExp('\\\\(?:' + OVERLAY_CMDS.join('|') + ')\\s*(?:<([^>]*)>)?\\s*\\{', 'g');

  /** 解析 `<2->`、`<2>`、`<2-4>`、`<->` 为 {from, to}（to 为 null 表示到结尾） */
  function parseOverlaySpec(spec) {
    const s = String(spec == null ? '' : spec).trim();
    if (!s) return { from: 1, to: null };
    const m = s.match(/^(\d*)\s*(?:-\s*(\d*))?$/);
    if (!m) return { from: 1, to: null };
    const hasDash = s.includes('-');
    if (!hasDash) {
      const n = Number(m[1] || 1);
      return { from: n, to: n };
    }
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? Number(m[2]) : null;
    return { from, to };
  }

  /** 该实体在第 step 步是否可见 */
  function visibleAtStep(entity, step) {
    if (!entity) return true;
    const from = entity.from || 1;
    const to = (entity.to == null) ? Infinity : entity.to;
    return step >= from && step <= to;
  }

  /** 实体是否设定了 overlay（非默认范围） */
  function hasOverlay(entity) {
    if (!entity) return false;
    return (entity.from || 1) > 1 || (entity.to != null && isFinite(entity.to));
  }

  /**
   * 把文本中的行内 overlay 命令替换掉（使用平衡花括号匹配）
   * @param {string} text
   * @param {(cmd:string, spec:string, inner:string)=>string} cb
   */
  function replaceOverlayCommands(text, cb) {
    let s = String(text == null ? '' : text);
    let out = '';
    let last = 0;
    CMD_HEAD.lastIndex = 0;
    let m;
    while ((m = CMD_HEAD.exec(s)) !== null) {
      const start = m.index + m[0].length - 1; // '{' 位置
      const braced = takeBraced(s, start);
      if (!braced) continue;
      const cmd = m[0].match(/\\([a-zA-Z]+)/)[1];
      out += s.slice(last, m.index) + cb(cmd, m[1] || '', braced.inner);
      last = braced.end;
      CMD_HEAD.lastIndex = braced.end;
    }
    return out + s.slice(last);
  }

  /** 取平衡花括号内内容 */
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

  /** 文本中出现的最大 overlay 步号（无则返回 1） */
  function maxOverlayStep(text) {
    const s = String(text == null ? '' : text);
    if (!s || s.indexOf('\\') < 0) return 1;
    let max = 1;
    replaceOverlayCommands(s, (_cmd, spec, inner) => {
      const r = parseOverlaySpec(spec);
      if (r.from > max) max = r.from;
      if (r.to && isFinite(r.to) && r.to > max) max = r.to;
      const innerMax = maxOverlayStep(inner);
      if (innerMax > max) max = innerMax;
      return '';
    });
    return max;
  }

  /** 去掉文本中的行内 overlay 命令（保留内容），用于纯文本场景 */
  function stripOverlayCommands(text, keepInner) {
    return replaceOverlayCommands(text, (_cmd, _spec, inner) =>
      keepInner === false ? '' : stripOverlayCommands(inner, keepInner));
  }

  const api = {
    OVERLAY_CMDS,
    parseOverlaySpec,
    visibleAtStep,
    hasOverlay,
    replaceOverlayCommands,
    maxOverlayStep,
    stripOverlayCommands,
    takeBraced
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AIPPT = root.AIPPT || {};
  root.AIPPT.overlay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
