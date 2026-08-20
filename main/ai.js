/**
 * main/ai.js
 * OpenAI 兼容 Chat Completions 客户端
 *  - baseUrl / apiKey / model 均由用户配置
 *  - 请求 JSON 结构化输出（response_format），不支持时自动降级重试
 *  - 解析容错：纯 JSON / ```json 围栏 / 截取首尾大括号
 */
'use strict';

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
     * 强调某句话用 "quote"
     * 对比/并列内容用 "two-column" 并提供 "columns": [{"heading": "...", "items": ["..."]}]
     * 结尾致谢页用 "end"
   - "bullets": 字符串数组，每项不超过 28 个汉字，避免堆砌长句；可以给字符串加前缀 "- " 表示子要点（层级）
   - "notes": 演讲备注字符串数组（可空）
3. 内容必须严格忠于用户文档，不得虚构事实、数据或引用。
4. 保持用户文档的章节结构完整，不遗漏主题；每页聚焦一个主题。
5. 语言与用户文档一致。
6. 输出 JSON 必须合法，字符串中的引号要正确转义。`;

function buildUserPrompt(mdText, outline, styleName) {
  const outlineText = outline.slides.map((s, i) =>
    `[第${i + 1}页 | ${s.layout}] ${s.title || '(无标题)'}${s.notes.length ? `\n   备注: ${s.notes.join(' / ')}` : ''}${s.bullets.length ? '\n   要点: ' + s.bullets.slice(0, 12).map((b) => (b.level ? '  '.repeat(b.level) : '') + b.text).join(' | ') : ''}`
  ).join('\n');
  return `【当前样式风格】${styleName || '通用'}\n\n【Markdown 原文】\n${String(mdText).slice(0, 30000)}\n\n【解析出的初步大纲】\n${outlineText}\n\n请基于以上内容输出完整演示文稿的 JSON。`;
}

async function enhanceOutline(cfg, { mdText, outline, styleName }) {
  if (!cfg || !cfg.baseUrl) throw new Error('请先配置 API Base URL');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(mdText, outline, styleName) }
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
  return normalizeSlides(data.slides, outline.slides);
}

async function testConnection(cfg) {
  const t0 = Date.now();
  const messages = [{ role: 'user', content: '你好，请回复"OK"。' }];
  const content = await chatCompletion(cfg, messages, { responseFormat: false });
  return { ok: true, latencyMs: Date.now() - t0, reply: String(content).slice(0, 60) };
}

module.exports = { enhanceOutline, testConnection, extractJson, normalizeSlides, chatCompletion };
