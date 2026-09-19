/**
 * main/style-store.js
 * 样式插件的"安装目录"管理：扫描 → 校验 → 合并 → 导入/删除。
 *
 * 扫描位置（后者优先）：
 *   1. 随包发布的 <app>/styles/*.aippt-style.json      （官方示例样式插件）
 *   2. 用户目录 <userData>/styles/*.aippt-style.json   （用户导入的样式）
 *
 * 只影响视觉（颜色/字体/尺寸），文件内容会被 shared/style-loader.js 严格校验；
 * 任何解析失败的样式都会被跳过并给出告警，不会影响软件启动。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const loader = require('../shared/style-loader.js');

const SUB_DIR = 'styles';
const EXT = '.aippt-style.json';

/** 列出某个目录下的样式文件 */
function listFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(EXT) || f.toLowerCase().endsWith('.json'))
      .map((f) => path.join(dir, f));
  } catch (e) {
    return [];
  }
}

/** 读取一个样式文件 → { ok, style?, errors, warnings, file } */
function readStyleFile(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`读取失败：${e.message}`], warnings: [], file };
  }
  const r = loader.parseStyle(text);
  return { ...r, file };
}

/**
 * 扫描并合并所有样式
 * @param {object} opts
 *   dirs     要扫描的目录（按优先级从低到高）
 *   builtin  内置样式数组
 *   override 是否允许自定义样式覆盖同名内置样式
 * @returns {{styles:Array, custom:Array, warnings:Array, sources:Array}}
 */
function loadStyles(opts = {}) {
  const builtin = opts.builtin || [];
  const custom = [];
  const warnings = [];
  const sources = [];
  for (const dir of opts.dirs || []) {
    for (const file of listFiles(dir)) {
      const r = readStyleFile(file);
      if (!r.ok) {
        warnings.push(`${path.basename(file)}：${(r.errors || []).join('；')}`);
        continue;
      }
      custom.push(r.style);
      sources.push({ file, id: r.style.id });
      for (const w of r.warnings || []) warnings.push(`${path.basename(file)}：${w}`);
    }
  }
  const merged = loader.mergeStyles(builtin, custom, { override: !!opts.override });
  return {
    styles: merged.styles,
    custom: custom.filter((c) => merged.styles.some((s) => s.id === c.id && s.custom)),
    warnings: warnings.concat(merged.warnings),
    sources
  };
}

/** 导入一个样式文件到用户目录（先校验，再落盘，避免装进去一个坏文件） */
function importStyle(file, userDir) {
  const r = readStyleFile(file);
  if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
  try {
    fs.mkdirSync(userDir, { recursive: true });
    const dest = path.join(userDir, `${r.style.id}${EXT}`);
    fs.copyFileSync(file, dest);
    return { ok: true, style: r.style, path: dest, warnings: r.warnings };
  } catch (e) {
    return { ok: false, errors: [`写入失败：${e.message}`], warnings: r.warnings };
  }
}

/** 删除用户目录里的某个样式（只允许删用户目录，删不到随包样式） */
function removeStyle(id, userDir) {
  if (!/^[a-z0-9][a-z0-9._-]{1,47}$/i.test(String(id || ''))) {
    return { ok: false, errors: ['id 不合法'] };
  }
  const file = path.join(userDir, `${id}${EXT}`);
  try {
    if (!fs.existsSync(file)) return { ok: false, errors: ['该样式不在用户目录里（随包样式不可删除）'] };
    fs.unlinkSync(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
}

/** 导出内置样式为 JSON 文本（给"导出一份改着用"用） */
function exportStyle(style) {
  const out = {
    $schema: loader.SCHEMA,
    id: style.id,
    name: style.name,
    desc: style.desc,
    font: style.font,
    mono: style.mono,
    colors: {}
  };
  for (const k of loader.COLOR_KEYS) out.colors[k] = style[k];
  if (style.layout) out.layout = style.layout;
  return JSON.stringify(out, null, 2);
}

module.exports = { SUB_DIR, EXT, loadStyles, readStyleFile, importStyle, removeStyle, exportStyle, listFiles };
