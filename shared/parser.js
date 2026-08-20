/**
 * shared/parser.js
 * Markdown → 幻灯片结构化数据
 * 规则：
 *   - `# ` 一级标题    → 封面（Cover），紧随其后的普通文字行作为副标题
 *   - `## / ###` 标题  → 内容幻灯片
 *   - `-`/`*`/`+`/`1.` 列表项 → 项目符号（缩进 → 层级）
 *   - `> ` 引用行      → 该幻灯片的演讲备注（不出现在页面上）
 *   - ` ``` ` 代码块   → 等宽字体代码块
 *   - `---`           → 手动分页
 * 同时提供内联 Markdown（**加粗**、*斜体*、`代码`）→ 富文本 run 转换
 */
(function (root) {
  'use strict';

  // ---------- 内联格式化 ----------

  /**
   * 将含内联 Markdown 的文本解析为 PptxGenJS 兼容的 run 数组
   * [{ text, options: { bold, italic, fontFace } }, ...]
   */
  function inlineToRuns(text) {
    const runs = [];
    // token 顺序: **bold** | *italic* | `code`
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) pushPlain(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) {
        runs.push({ text: tok.slice(2, -2), options: { bold: true } });
      } else if (tok.startsWith('`')) {
        runs.push({ text: tok.slice(1, -1), options: { fontFace: 'Consolas' } });
      } else {
        runs.push({ text: tok.slice(1, -1), options: { italic: true } });
      }
      last = m.index + tok.length;
    }
    if (last < text.length) pushPlain(text.slice(last));
    if (!runs.length) runs.push({ text, options: {} });
    return runs;

    function pushPlain(s) {
      if (!s) return;
      runs.push({ text: s, options: {} });
    }
  }

  function toPlainText(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
  }

  // ---------- 文档解析 ----------

  const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
  const BULLET_RE = /^\s*([-*+]|\d+[.、)])\s+(.*)$/;
  const QUOTE_RE = /^\s*>\s?(.*)$/;
  const HR_RE = /^\s*---+\s*$/;
  const FENCE_RE = /^\s*```/;

  function parseMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    const slides = [];
    let current = null;
    let cover = null;
    let inCode = false;
    let codeBuf = [];

    function ensureSlide() {
      if (!current) {
        current = { title: '', subtitle: '', bullets: [], notes: [], layout: 'content' };
        slides.push(current);
      }
      return current;
    }

    function newSlide(title, layout) {
      current = { title: title || '', subtitle: '', bullets: [], notes: [], layout: layout || 'content' };
      slides.push(current);
      return current;
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');

      if (inCode) {
        if (FENCE_RE.test(line)) {
          inCode = false;
          if (codeBuf.length && current) {
            current.bullets.push({ text: codeBuf.join('\n'), level: 0, code: true });
          }
          codeBuf = [];
        } else {
          codeBuf.push(line);
        }
        continue;
      }
      if (FENCE_RE.test(line)) {
        inCode = true;
        codeBuf = [];
        continue;
      }

      // 标题
      const h = line.match(HEADING_RE);
      if (h) {
        const text = toPlainText(h[2].trim());
        const level = h[1].length;
        if (level === 1 && !cover && slides.length === 0) {
          cover = { title: text, subtitle: '', bullets: [], notes: [], layout: 'cover' };
          current = cover;
        } else {
          const layout = level >= 2 && !text ? 'content' : 'content';
          newSlide(text, layout);
        }
        continue;
      }

      // 封面副标题（封面标题后的第一段普通文字）
      if (current && current.layout === 'cover' && current.subtitle === '' &&
          current.bullets.length === 0 && current.notes.length === 0 && line.trim()) {
        current.subtitle = toPlainText(line.trim());
        continue;
      }

      // 分页符
      if (HR_RE.test(line)) {
        if (current && current.layout !== 'cover' && (current.title || current.bullets.length || current.notes.length)) {
          newSlide('', 'content');
        }
        continue;
      }

      // 备注（blockquote）
      const q = line.match(QUOTE_RE);
      if (q) {
        const t = q[1].trim();
        if (t) ensureSlide().notes.push(t);
        continue;
      }

      // 列表项
      const b = line.match(BULLET_RE);
      if (b) {
        const indent = Math.floor(line.match(/^\s*/)[0].length / 2);
        ensureSlide().bullets.push({ text: b[2], level: Math.min(indent, 3), code: false });
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      // 普通段落 → 视为项目符号
      ensureSlide().bullets.push({ text: trimmed, level: 0, code: false });
    }

    if (inCode && codeBuf.length && current) {
      current.bullets.push({ text: codeBuf.join('\n'), level: 0, code: true });
    }

    // 组装结果
    const result = [];
    if (cover) result.push(cover);
    for (const s of slides) {
      if (s === cover) continue;
      if (s.title || s.bullets.length || s.notes.length) result.push(s);
    }

    // 启发式布局标记
    for (let i = 0; i < result.length; i++) {
      const s = result[i];
      if (s.layout === 'cover' || s.layout === 'end') continue;
      const t = s.title.trim();
      const isLast = i === result.length - 1;
      if ((isLast && /^(谢谢|感谢|谢幕)/.test(t)) || /^thank\s/i.test(t) || /^(end|q&a|问答)$/i.test(t)) {
        s.layout = 'end';
      } else if (s.title && s.bullets.length === 0 && s.notes.length === 0) {
        s.layout = 'section';
      }
    }

    return {
      slides: result,
      stats: {
        slides: result.length,
        notes: result.reduce((a, s) => a + s.notes.length, 0),
        bullets: result.reduce((a, s) => a + s.bullets.length, 0)
      }
    };
  }

  // ---------- 导出 ----------
  const api = { parseMarkdown, inlineToRuns, toPlainText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AIPPT = root.AIPPT || {};
  root.AIPPT.parser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
