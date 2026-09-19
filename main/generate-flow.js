/**
 * main/generate-flow.js  (v2)
 * 生成主流程：解析 → AI 增强（可选，公式/表格/图片占位保护） → 排版输出
 * 纯 Node 可测试：富内容渲染器通过 deps.renderer 注入
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { parseMarkdown } = require('../shared/parser.js');
const { STYLES } = require('../shared/styles.js');
const bib = require('../shared/bib.js');
const { enhanceOutline } = require('./ai.js');
const { generatePptx } = require('./generator.js');

/** 文献库来源：UI 导入的 .bib 文本，或 md 同目录下的 references.bib */
function buildRegistry(opts, log) {
  let text = String(opts.bibText || '');
  if (!text.trim() && opts.mdPath) {
    const guess = path.join(path.dirname(opts.mdPath), 'references.bib');
    try {
      if (fs.existsSync(guess)) text = fs.readFileSync(guess, 'utf8');
    } catch (e) { /* 可选 */ }
  }
  if (!text.trim()) return null;
  const parsed = bib.parseBib(text);
  const keys = Object.keys(parsed.entries || {});
  if (!keys.length) {
    if (parsed.warnings && parsed.warnings.length) log(`⚠ 文献库解析告警：${parsed.warnings.slice(0, 3).join('；')}`);
    return null;
  }
  log(`已载入文献库：${keys.length} 条${parsed.warnings.length ? `（${parsed.warnings.length} 条告警）` : ''}`);
  return bib.makeRegistry(parsed.entries);
}

function styleNameOf(styleId) {
  const s = STYLES.find((x) => x.id === styleId);
  return s ? `${s.name}（${s.desc}）` : '通用';
}

function statsLine(stats) {
  const parts = [`${stats.slides} 页`];
  if (stats.math) parts.push(`公式 ${stats.math}`);
  if (stats.tables) parts.push(`表格 ${stats.tables}`);
  if (stats.images) parts.push(`图片 ${stats.images}`);
  if (stats.envs) parts.push(`定理块 ${stats.envs}`);
  if (stats.algorithms) parts.push(`算法 ${stats.algorithms}`);
  if (stats.citations) parts.push(`引用 ${stats.citations}`);
  if (stats.callouts) parts.push(`提示框 ${stats.callouts}`);
  if (stats.code) parts.push(`代码块 ${stats.code}`);
  if (stats.notes) parts.push(`备注 ${stats.notes}`);
  if (stats.overlaySlides) parts.push(`渐进显示 ${stats.overlaySlides} 页(+${stats.steps})`);
  if (stats.refs) parts.push(`交叉引用 ${stats.refs}`);
  return parts.join(' · ');
}

/**
 * @param {object} opts { apiConfig, mdContent, styleId, mode, outPath, mdPath }
 * @param {(msg:string)=>void} onProgress
 * @param {object} deps { renderer?, searchDirs?, baseDir? }
 */
async function runGenerate(opts, onProgress, deps = {}) {
  const { mdContent, styleId, mode, outPath, apiConfig, mdPath } = opts;
  const log = onProgress || (() => {});
  if (!mdContent || !mdContent.trim()) throw new Error('Markdown 内容为空');
  if (!outPath) throw new Error('未指定输出路径');

  log('正在解析 Markdown…');
  const fileName = mdPath ? path.basename(mdPath) : '演示文稿';
  const bibRegistry = buildRegistry(opts, log);
  const parsed = parseMarkdown(mdContent, {
    fileName,
    bibRegistry,
    autoToc: opts.autoToc !== false
  });
  if (!parsed.slides.length) throw new Error('Markdown 中没有可用的内容（至少需要一个标题或列表）');
  log(`解析完成：${statsLine(parsed.stats)}`);
  if (parsed.stats.unresolvedRefs && parsed.stats.unresolvedRefs.length) {
    log(`⚠ 以下交叉引用未找到目标，已显示为 ??：${parsed.stats.unresolvedRefs.slice(0, 6).join('、')}`);
  }
  if (parsed.stats.unresolvedCites && parsed.stats.unresolvedCites.length) {
    log(`⚠ 以下文献键不在文献库里，已显示为 [?]：${parsed.stats.unresolvedCites.slice(0, 6).join('、')}`);
  }

  let slides = parsed.slides;
  const warnings = [];

  if (mode === 'ai') {
    if (!apiConfig || !apiConfig.baseUrl) throw new Error('AI 模式需要先配置 API Base URL');
    log(`正在调用 AI 改写文本内容（${(apiConfig.model || '').trim() || '默认模型'}）…公式/表格/图片将原样保留`);
    const res = await enhanceOutline(apiConfig, {
      mdText: mdContent,
      outline: parsed,
      styleName: styleNameOf(styleId)
    });
    slides = res.slides;
    if (res.warnings && res.warnings.length) warnings.push(...res.warnings);
    if (res.tokens && res.tokens.total) {
      log(`AI 占位保护：${res.tokens.kept}/${res.tokens.total} 个公式/表格/图片块原样保留`);
    }
    log('AI 内容生成完成，正在排版…');
  } else {
    log('直接排版模式，正在生成…');
  }

  const baseDir = mdPath ? path.dirname(mdPath) : (deps.baseDir || process.cwd());
  const out = await generatePptx(slides, styleId, outPath, {
    renderer: deps.renderer || null,
    baseDir,
    searchDirs: deps.searchDirs || [],
    overlayMode: opts.overlayMode,
    sectionNumbers: parsed.stats.useSectionNumbers,
    formulaMode: opts.formulaMode,
    animation: opts.animation,
    footer: opts.footer,
    onProgress: log
  });

  if (out.warnings && out.warnings.length) warnings.push(...out.warnings);
  for (const w of warnings) log(`⚠ ${w}`);
  const om = out.omml || {};
  if (om.display || om.inline) {
    log(`公式已写入为 PowerPoint 原生公式：块级 ${om.display} 条 / 行内 ${om.inline} 条`
      + (om.fallbackImages ? `，并附 ${om.fallbackImages} 张兜底图（WPS 等客户端可见）` : ''));
  }
  if (om.failed) log(`⚠ 有 ${om.failed} 条公式无法转成原生对象，已按原文显示`);
  if (out.animation && out.animation.slides) {
    log(`点击出现动画：${out.animation.slides} 页 / ${out.animation.shapes} 个对象（放映时按一下出现一条）`);
  }
  if (out.toc && out.toc.entries) log(`目录：${out.toc.entries} 节`);
  log(`完成：共 ${out.slideCount} 页幻灯片`);

  return {
    ok: true,
    path: outPath,
    slideCount: out.slideCount,
    mode,
    stats: parsed.stats,
    warnings
  };
}

module.exports = { runGenerate };
