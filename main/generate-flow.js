/**
 * main/generate-flow.js
 * 生成主流程（纯 Node，可单元测试）：解析 → AI 增强（可选） → 排版输出
 */
'use strict';

const { parseMarkdown } = require('../shared/parser.js');
const { STYLES } = require('../shared/styles.js');
const { enhanceOutline } = require('./ai.js');
const { generatePptx } = require('./generator.js');

function styleNameOf(styleId) {
  const s = STYLES.find((x) => x.id === styleId);
  return s ? `${s.name}（${s.desc}）` : '通用';
}

/**
 * @param {object} opts
 *   apiConfig { baseUrl, apiKey, model }
 *   mdContent string
 *   styleId   string
 *   mode      'ai' | 'direct'
 *   outPath   string
 * @param {(msg:string)=>void} onProgress
 */
async function runGenerate(opts, onProgress) {
  const { mdContent, styleId, mode, outPath, apiConfig } = opts;
  if (!mdContent || !mdContent.trim()) throw new Error('Markdown 内容为空');
  if (!outPath) throw new Error('未指定输出路径');

  onProgress && onProgress('正在解析 Markdown…');
  const parsed = parseMarkdown(mdContent);
  if (!parsed.slides.length) throw new Error('Markdown 中没有可用的内容（至少需要一个标题或列表）');

  let slides = parsed.slides;
  if (mode === 'ai') {
    if (!apiConfig || !apiConfig.baseUrl) throw new Error('AI 模式需要先配置 API Base URL');
    onProgress && onProgress(`正在调用 AI 生成幻灯片内容（${(apiConfig.model || '').trim() || '默认模型'}）…`);
    slides = await enhanceOutline(apiConfig, {
      mdText: mdContent,
      outline: parsed,
      styleName: styleNameOf(styleId)
    });
    onProgress && onProgress('AI 内容生成完成，正在排版…');
  } else {
    onProgress && onProgress('直接排版模式，正在生成…');
  }

  const count = await generatePptx(slides, styleId, outPath);
  onProgress && onProgress(`完成：共 ${count} 页幻灯片`);
  return { ok: true, path: outPath, slideCount: count, mode };
}

module.exports = { runGenerate };
