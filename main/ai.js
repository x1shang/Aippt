/**
 * main/ai.js
 * OpenAI 兼容 Chat Completions 客户端
 *  - baseUrl / apiKey / model 均由用户配置
 *  - 请求 JSON 结构化输出（response_format），不支持时自动降级重试
 *  - 解析容错：纯 JSON / ```json 围栏 / 截取首尾大括号
 */
'use strict';

const parser = require('../shared/parser.js');

const DEFAULT_TIMEOUT_MS = 120000;

function normalizeBaseUrl(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('请填写 API Base URL，例如 https://api.openai.com/v1');
  return u;
}

function chatUrl(base) {
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

async function chatCompletion(cfg, messages, { responseFormat = true } = {}) {
  const url = chatUrl(normalizeBaseUrl(cfg.baseUrl));
  const body = {
    model: (cfg.model || '').trim() || 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    stream: false
  };
  if (responseFormat) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch (e) { /* ignore */ }
      const err = new Error(`API 请求失败（HTTP ${res.status}）${detail ? '：' + detail : ''}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('API 返回内容为空（请检查 model 名称是否正确）');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- JSON 解析容错 ----------
function extractJson(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch (e) { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (e) { /* fall through */ }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fall through */ }
  }
  throw new Error('AI 返回内容无法解析为 JSON，请重试或更换模型');
}

// ---------- 结构归一化 ----------
function normalizeSlide(raw, index) {
  const s = raw || {};
  const bullets = Array.isArray(s.bullets) ? s.bullets.map((b) => {
    if (typeof b === 'string') return { text: b, level: 0, code: false };
    return { text: String(b.text || ''), level: Math.min(Number(b.level) || 0, 3), code: !!b.code };
  }) : [];
  const columns = Array.isArray(s.columns) ? s.columns.map((c) => ({
    heading: String((c && c.heading) || ''),
    items: Array.isArray(c && c.items) ? c.items.map((i) => String(i)) : []
  })) : [];
  let layout = String(s.layout || (index === 0 ? 'cover' : 'content')).toLowerCase();
  if (!['cover', 'section', 'content', 'two-column', 'quote', 'end'].includes(layout)) {
    layout = index === 0 ? 'cover' : 'content';
  }
  const title = String(s.title || '').trim();
  const slide = {
    title,
    subtitle: String(s.subtitle || '').trim(),
    bullets,
    notes: Array.isArray(s.notes) ? s.notes.map((n) => String(n)) : [],
    layout,
    columns
  };
  if (!title && !bullets.length && !columns.length && layout !== 'quote') return null;
  return slide;
}

function normalizeSlides(aiSlides, outlineSlides) {
  const out = [];
  const list = Array.isArray(aiSlides) ? aiSlides : [];
  list.forEach((raw, i) => {
    const s = normalizeSlide(raw, i);
    if (!s) return;
    // 保证 md 中的 ">" 备注始终保留（AI 备注追加在其后）
    const orig = outlineSlides[i];
    if (orig && Array.isArray(orig.notes) && orig.notes.length) {
      const merged = orig.notes.slice();
      for (const n of s.notes) if (!merged.includes(n)) merged.push(n);
      s.notes = merged;
    }
    out.push(s);
  });
  if (!out.length) throw new Error('AI 未返回有效的幻灯片内容');
  if (out[0].layout !== 'cover' && out[0].layout !== 'end') out[0].layout = 'cover';
  return out;
}

// ---------- 富内容块占位标记（保护公式/表格/图片/定理块不被 AI 改写） ----------
const TOKEN_SCAN = /⟦B(\d+)⟧/g;
const OV_MARK = /^\s*⟦O(\d+)(?:-(\d*))?⟧\s*/;

function isProtectedBlock(blk) {
  if (!blk) return false;
  if (blk.type === 'math' || blk.type === 'table' || blk.type === 'callout' ||
      blk.type === 'image' || blk.type === 'env') return true;
  if (blk.type === 'code') return blk.code.split('\n').length > 14;
  if (blk.type === 'bullets') return !!blk.rich || blk.items.some((it) => parser.hasRichMarkup(it.text));
  if (blk.type === 'text') return !!blk.rich || parser.hasRichMarkup(blk.text);
  return false;
}

function describeBlock(blk) {
  switch (blk.type) {
    case 'math': return `行间公式（LaTeX: ${String(blk.tex).replace(/\s+/g, ' ').slice(0, 70)}）`;
    case 'table': return `表格（${blk.rows.length} 行 × ${blk.headers.length} 列）`;
    case 'callout': return `提示框（${blk.kind}）`;
    case 'env': return `${blockEnvLabel(blk)}环境块${blk.number != null ? ' ' + blk.number : ''}`;
    case 'image': return `图片（${blk.src}）`;
    case 'code': return `代码块（${blk.code.split('\n').length} 行）`;
    case 'bullets': return '含公式的要点';
    case 'text': return '含公式的段落';
    default: return blk.type;
  }
}

function blockEnvLabel(blk) {
  const map = {
    theorem: '定理', lemma: '引理', corollary: '推论', proposition: '命题',
    definition: '定义', example: '例', proof: '证明', remark: '评注',
    claim: '断言', axiom: '公理', conjecture: '猜想', exercise: '练习', solution: '解答'
  };
  return map[blk.env] || blk.env || '定理';
}

/** overlay 标记：⟦O2-⟧ / ⟦O2⟧ / ⟦O2-4⟧ */
function overlayMark(from, to) {
  if (!from || from <= 1 && (to == null)) return '';
  return to == null ? `⟦O${from}-⟧` : `⟦O${from}-${to}⟧`;
}

function parseOverlayMark(text) {
  const m = String(text == null ? '' : text).match(OV_MARK);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : (String(m[0]).includes('-') ? null : from);
  return { from, to, rest: String(text).replace(OV_MARK, '') };
}

/** 把大纲里的富内容块换成占位标记，返回 {text, map, overlayMarks} */
function tokenizeOutline(outline) {
  const map = new Map();
  const lines = [];
  let n = 0;
  let overlayMarks = 0;
  (outline.slides || []).forEach((s, si) => {
    lines.push(`【第${si + 1}页 | ${s.layout}】标题: ${s.title || '(无标题)'}${s.subtitle ? ' ｜ 副标题: ' + s.subtitle : ''}`);
    if (s.notes && s.notes.length) lines.push(`   备注（必须原样保留，不得删改）: ${s.notes.join(' ／ ')}`);
    for (const blk of s.blocks || []) {
      if (isProtectedBlock(blk)) {
        n++;
        const token = `⟦B${n}⟧`;
        map.set(token, { block: blk, slideIndex: si });
        lines.push(`   - ${token}  ← ${describeBlock(blk)}，必须原样保留在**本页**`);
      } else if (blk.type === 'bullets') {
        for (const it of blk.items) {
          const mark = overlayMark(it.from, it.to == null ? null : it.to);
          if (mark) overlayMarks++;
          lines.push(`   - ${'   '.repeat(it.level || 0)}${mark}${it.text}`);
        }
      } else if (blk.type === 'text') {
        const mark = overlayMark(blk.from, blk.to == null ? null : blk.to);
        if (mark) overlayMarks++;
        lines.push(`   - ${mark}${blk.text}`);
      }
    }
  });
  return { text: lines.join('\n'), map, overlayMarks };
}

/** 把 AI 输出里的占位标记还原成原始富内容块 */
function applyTokens(aiSlides, tokenMap, outlineSlides) {
  const used = new Set();
  const warnings = [];
  let overlayApplied = 0;

  const out = aiSlides.map((s, idx) => {
    const blocks = [];
    let pending = [];
    const flush = () => {
      if (!pending.length) return;
      blocks.push({
        type: 'bullets',
        items: pending,
        rich: pending.some((it) => parser.hasRichMarkup(it.text))
      });
      pending = [];
    };

    for (const raw of s.bullets || []) {
      let text = String(raw.text == null ? '' : raw.text);
      let from = raw.from;
      let to = raw.to;
      // 渐进显示标记 ⟦O2-⟧ / ⟦O2⟧ / ⟦O2-4⟧
      const ovm = parseOverlayMark(text);
      if (ovm) {
        text = ovm.rest;
        from = ovm.from;
        to = ovm.to;
        overlayApplied++;
      }
      TOKEN_SCAN.lastIndex = 0;
      const m = TOKEN_SCAN.exec(text);
      if (m) {
        const token = `⟦B${m[1]}⟧`;
        const entry = tokenMap.get(token);
        if (entry) {
          const rest = text.replace(/⟦B\d+⟧/g, '').trim();
          if (rest) pending.push({ text: rest, level: raw.level || 0, code: !!raw.code, from: from || 1, to: to === undefined ? null : to });
          flush();
          blocks.push(entry.block);
          used.add(token);
          continue;
        }
      }
      pending.push({
        text,
        level: raw.level || 0,
        code: !!raw.code,
        from: from || 1,
        to: to === undefined ? null : to
      });
    }
    flush();

    return { ...s, index: idx, blocks };
  });

  // 未被使用的富内容块 → 补回其原本所在的页码（越界则追加到末页）
  for (const [token, entry] of tokenMap) {
    if (used.has(token)) continue;
    const target = out[Math.min(entry.slideIndex, out.length - 1)];
    if (target) {
      target.blocks.push(entry.block);
      warnings.push(`AI 丢失了占位标记 ${token}（${describeBlock(entry.block)}），已自动补回第 ${entry.slideIndex + 1} 页`);
    }
  }

  return { slides: out, warnings, overlayApplied, total: tokenMap.size, kept: used.size };
}

// ---------- 主流程：根据大纲增强为幻灯片 ----------
const SYSTEM_PROMPT = `你是一位资深的 PPT 内容策划与排版专家。用户会提供一份 Markdown 文档以及由它解析出的初步大纲。你的任务是把大纲改写成高质量演示文稿的完整内容。

要求：
1. 严格输出一个 JSON 对象，格式为 {"slides": [...]}，不要输出任何其他文字、解释或 Markdown 围栏之外的代码。
2. slides 是数组，每个元素表示一页幻灯片，字段：
   - "title": 字符串，页面标题（简洁有力）
   - "subtitle": 字符串，可选，仅封面/结尾页使用
   - "layout": 枚举之一 "cover" | "section" | "content" | "two-column" | "quote" | "end"
     * 第一页必须是 "cover"（封面）
     * 仅含标题无正文的章节页用 "section"
     * 对比/并列内容可用 "two-column" 并提供 "columns": [{"heading": "...", "items": ["..."]}]
     * 结尾致谢页用 "end"
   - "bullets": 字符串数组，按大纲顺序排列的正文内容；每项不超过 28 个汉字，可以给字符串加前缀 "- " 表示子要点（层级）
   - "notes": 演讲备注字符串数组（可空）
3. **占位标记（极其重要）**：大纲中以 ⟦B数字⟧ 形式出现的标记，代表原始文档中的**数学公式 / 表格 / 图片 / 代码块 / 定理环境 / 含公式的整行文字**。
   - 必须把这些标记**原样**（一字不改）放进对应页面的 bullets 数组中，并保持它们在大纲中的先后顺序；
   - 严禁改写、翻译、删减、合并标记，严禁新增任何 ⟦…⟧ 标记；
   - 严禁把标记里的公式或表格内容展开成文字（例如不要把公式写成"该公式表示了…"）。
4. **渐进显示标记**：形如 ⟦O2-⟧ / ⟦O2⟧ / ⟦O2-4⟧ 的前缀表示"该要点在第 N 步才出现"（分步演示）。
   - 必须原样保留在对应要点的**开头**，不得移动、删除或改写；也不要把标记改写成文字说明。
5. 数学公式一律保持 LaTeX 原文（$...$ 或 $$...$$），不要改写公式内容。
6. 内容必须严格忠于用户文档，不得虚构事实、数据或引用；保持文档的章节结构完整。
7. 语言与用户文档一致。
8. 输出 JSON 必须合法，字符串中的引号与反斜杠要正确转义（LaTeX 的反斜杠在 JSON 中需写成 \\\\）。`;

function buildUserPrompt(mdText, tokenizedText, styleName) {
  return `【当前样式风格】${styleName || '通用'}\n\n【Markdown 原文】\n${String(mdText).slice(0, 30000)}\n\n【解析出的初步大纲（含必须原样保留的 ⟦B数字⟧ 占位标记）】\n${tokenizedText}\n\n请基于以上内容输出完整演示文稿的 JSON。`;
}

async function enhanceOutline(cfg, { mdText, outline, styleName }) {
  if (!cfg || !cfg.baseUrl) throw new Error('请先配置 API Base URL');
  const tokenized = tokenizeOutline(outline);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(mdText, tokenized.text, styleName) }
  ];
  let content;
  try {
    content = await chatCompletion(cfg, messages, { responseFormat: true });
  } catch (err) {
    if (err && err.status === 400) {
      // 服务端不支持 response_format → 降级重试
      content = await chatCompletion(cfg, messages, { responseFormat: false });
    } else {
      throw err;
    }
  }
  const data = extractJson(content);
  if (!data || !Array.isArray(data.slides)) {
    throw new Error('AI 返回的 JSON 缺少 slides 数组');
  }
  const normalized = normalizeSlides(data.slides, outline.slides);
  const applied = applyTokens(normalized, tokenized.map, outline.slides);
  const slides = parser.finalizeSlides(applied.slides);
  parser.assignSteps(slides, { overlaySlides: 0, steps: 0 });
  if (tokenized.overlayMarks > applied.overlayApplied) {
    applied.warnings.push(
      `AI 丢失了 ${tokenized.overlayMarks - applied.overlayApplied} 处渐进显示标记（⟦O数字-⟧），相关页面将按普通顺序显示`
    );
  }
  return {
    slides,
    warnings: applied.warnings,
    tokens: { total: applied.total, kept: applied.kept, overlay: applied.overlayApplied }
  };
}

async function testConnection(cfg) {
  const t0 = Date.now();
  const messages = [{ role: 'user', content: '你好，请回复"OK"。' }];
  const content = await chatCompletion(cfg, messages, { responseFormat: false });
  return { ok: true, latencyMs: Date.now() - t0, reply: String(content).slice(0, 60) };
}

module.exports = {
  enhanceOutline, testConnection, extractJson, normalizeSlides, chatCompletion,
  tokenizeOutline, applyTokens, isProtectedBlock, overlayMark, parseOverlayMark
};
