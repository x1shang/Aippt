/**
 * main/pptx-post.js
 * pptx 生成后的「一次 zip 后处理」，一次读写完成四件事：
 *
 *   1. 原生公式：把文本占位符 ⟦MATH:n⟧ 换成 PowerPoint 原生公式对象（<a14:m>）
 *        整段只有占位符 → 块级公式（m:oMathPara，居中）
 *        占位符混在文字里 → 行内公式（m:oMath，插在同一 <a:p> 的 run 之间，整段仍可编辑）
 *   2. 双重保真：块级公式所在的 <p:sp> 外层包 mc:AlternateContent
 *        mc:Choice   = 原生公式（PowerPoint 2010+ 可双击编辑）
 *        mc:Fallback = 同一位置的高清图片（WPS/LibreOffice/Keynote 至少看得见）
 *        这正是 PowerPoint 自己导出公式时的结构（[MS-ODRAWXML] 3.5 Math）
 *   3. 真「点击出现」动画：把标记 ⟦ANIM:n⟧ 从文本里摘掉，按标记找到形状，
 *      生成 <p:timing> 点击序列（presetID=1 = Appear 出现）
 *   4. 页码分母哨兵 ⟪T⟫ → 真实总页数（含目录页/展开页）
 *
 * 为什么用字符串外科手术而不是 DOM 重写整个 slide：只改必须改的字节，其余原样保留，
 * 最大限度避免 PowerPoint 打开时提示"需要修复"。踩过的坑见各函数注释。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TOTAL_SENTINEL = '⟪T⟫';
const ANIM_RE = /⟦ANIM:(\d+)⟧/g;
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

// ============================================================
// 一、极小 XML 文本工具（pptx 里 a:p / a:r 不会互相嵌套，可以安全用扫描）
// ============================================================

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescText = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');

/** 扫描一个元素的直接子元素；返回 [{type:'elem'|'text', name, raw}] */
function scanChildren(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { if (i < s.length) out.push({ type: 'text', raw: s.slice(i) }); break; }
    if (lt > i) out.push({ type: 'text', raw: s.slice(i, lt) });
    const gt = s.indexOf('>', lt);
    if (gt < 0) { out.push({ type: 'text', raw: s.slice(lt) }); break; }
    const head = s.slice(lt, gt + 1);
    if (/^<\?|^<!/.test(head)) { out.push({ type: 'text', raw: head }); i = gt + 1; continue; }
    const m = /^<([a-zA-Z0-9_:.-]+)/.exec(head);
    const name = m ? m[1] : '';
    if (head.endsWith('/>')) { out.push({ type: 'elem', name, raw: head, selfClose: true }); i = gt + 1; continue; }
    const close = `</${name}>`;
    const end = s.indexOf(close, gt);
    if (end < 0) { out.push({ type: 'text', raw: s.slice(lt) }); break; }
    out.push({ type: 'elem', name, raw: s.slice(lt, end + close.length) });
    i = end + close.length;
  }
  return out;
}

const RUN_RE = /^<a:r[\s>]/;
const T_RE = /(<a:t(?:\s[^>]*)?>)([\s\S]*?)<\/a:t>/;

function runText(raw) {
  const m = T_RE.exec(raw);
  return m ? unescText(m[2]) : null;
}

function setRunText(raw, text) {
  const openTag = /^<a:r(\s[^>]*)?>/.exec(raw)[0];
  const inner = raw.slice(openTag.length, raw.length - '</a:r>'.length);
  const m = T_RE.exec(inner);
  if (!m) return raw;
  const keep = /^\s|\s$/.test(text) || /xml:space/.test(m[1]);
  const open = keep && !/xml:space/.test(m[1]) ? m[1].replace(/>$/, ' xml:space="preserve">') : m[1];
  return `${openTag}${open}${escText(text)}</a:t></a:r>`;
}

/** 找出所有 <a:p>…</a:p>（a:p 不会嵌套，非贪婪安全） */
const P_RE = /<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g;

// ============================================================
// 二、原生公式注入
// ============================================================

/**
 * 处理单个段落。
 * ⚠️ 坑：PptxGenJS 会把一段文字拆成多个 <a:r>，占位符可能被切断，
 * 所以必须先把整段 run 文本拼起来再定位。
 * @param {Map|object} map 占位符 → { xml, block? }
 */
function patchParagraph(pXml, map) {
  const openTag = /^<a:p(\s[^>]*)?>/.exec(pXml)[0];
  const body = pXml.slice(openTag.length, pXml.length - '</a:p>'.length);
  const children = scanChildren(body);
  const runs = children.filter((c) => c.type === 'elem' && RUN_RE.test(c.raw));
  if (!runs.length) return { xml: pXml, hits: 0, blockKeys: [] };

  const texts = runs.map((r) => runText(r.raw));
  const full = texts.join('');
  const keys = Object.keys(map);
  const hitKey = keys.find((k) => full.includes(k));
  if (!hitKey) return { xml: pXml, hits: 0, blockKeys: [] };

  const pPr = children.find((c) => c.type === 'elem' && /^<a:pPr/.test(c.raw));
  const endPr = children.filter((c) => c.type === 'elem' && /^<a:endParaRPr/.test(c.raw)).map((c) => c.raw).join('');

  // 整段就是一个占位符 → 块级公式
  const onlyKey = keys.find((k) => full === k);
  if (onlyKey) {
    return {
      xml: `${openTag}${pPr ? pPr.raw : ''}${map[onlyKey].xml}${endPr}</a:p>`,
      hits: 1,
      blockKeys: [onlyKey]
    };
  }

  // 行内公式：按 run 切分，公式插在 run 之间
  const segs = [];
  let hits = 0;
  for (let i = 0; i < runs.length; i++) {
    const local = texts[i];
    let pos = 0;
    while (pos <= local.length) {
      let found = null;
      for (const k of keys) {
        const idx = local.indexOf(k, pos);
        if (idx >= 0 && (!found || idx < found.idx)) found = { idx, k };
      }
      if (!found) break;
      if (found.idx > pos) segs.push({ kind: 'run', raw: runs[i].raw, text: local.slice(pos, found.idx) });
      segs.push({ kind: 'omml', raw: map[found.k].xml });
      hits++;
      pos = found.idx + found.k.length;
    }
    if (pos < local.length) segs.push({ kind: 'run', raw: runs[i].raw, text: local.slice(pos) });
  }
  if (!hits) return { xml: pXml, hits: 0, blockKeys: [] };

  let rebuilt = '';
  for (const s of segs) rebuilt += s.kind === 'omml' ? s.raw : setRunText(s.raw, s.text);
  return { xml: `${openTag}${pPr ? pPr.raw : ''}${rebuilt}${endPr}</a:p>`, hits, blockKeys: [] };
}

function patchOmmlInSlide(xml, map) {
  let hits = 0;
  const out = xml.replace(P_RE, (p) => {
    const r = patchParagraph(p, map);
    hits += r.hits;
    return r.xml;
  });
  return { xml: out, hits };
}

// ============================================================
// 三、图片兜底（mc:AlternateContent）
// ============================================================

const SP_RE = /<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g;

function spXfrm(spXml) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(spXml);
  if (m) return { off: { x: +m[1], y: +m[2] }, ext: { cx: +m[3], cy: +m[4] } };
  return { off: { x: 0, y: 0 }, ext: { cx: 914400 * 4, cy: 914400 } };
}

function fallbackPicSp(spXml, rid, name, id) {
  const t = spXfrm(spXml);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escText(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${t.off.x}" y="${t.off.y}"/><a:ext cx="${t.ext.cx}" cy="${t.ext.cy}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
    + `<a:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

/**
 * 给含块级公式的形状套 mc:AlternateContent。
 * @param {string} xml 已注入 OMML 的 slide XML
 * @param {Array}  blocks [{ key, png, name, xml }]
 * @param {number} idBase 兜底形状的 id 起点（避开已有 id）
 */
function wrapBlocksWithFallback(xml, blocks, idBase) {
  let wrapped = 0;
  const relsNeeded = [];
  let nextId = idBase;
  for (const b of blocks) {
    if (!b.png) continue;
    const needle = String(b.xml).slice(0, 60);
    const at = xml.indexOf(needle);
    if (at < 0) continue;
    // 找到包住这段公式的 <p:sp>
    SP_RE.lastIndex = 0;
    let spXml = null;
    let m;
    while ((m = SP_RE.exec(xml)) !== null) {
      if (m.index <= at && at < m.index + m[0].length) { spXml = m[0]; break; }
    }
    if (!spXml) continue;
    const rid = `rIdA14_${wrapped + 1}`;
    const replacement = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
      + `<mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${spXml}</mc:Choice>`
      + `<mc:Fallback>${fallbackPicSp(spXml, rid, b.name || '公式', ++nextId)}</mc:Fallback></mc:AlternateContent>`;
    xml = xml.slice(0, m.index) + replacement + xml.slice(m.index + spXml.length);
    relsNeeded.push({ rid, png: b.png });
    wrapped++;
  }
  return { xml, wrapped, relsNeeded, nextId };
}

// ============================================================
// 四、真「点击出现」动画（<p:timing>）
// ============================================================

/**
 * 摘掉 ⟦ANIM:n⟧ 标记并记录每个形状属于第几步。
 * @returns {{xml:string, byStep:Object<number, number[]>}} byStep 的 key 是步号，值是该步要"点出来"的 spid
 */
function extractAnimTargets(xml) {
  const byStep = {};
  let stripped = 0;
  const out = xml.replace(SP_RE, (spXml) => {
    const ids = [...spXml.matchAll(ANIM_RE)].map((m) => +m[1]);
    if (!ids.length) return spXml;
    const idMatch = /<p:cNvPr id="(\d+)"/.exec(spXml);
    const spid = idMatch ? +idMatch[1] : null;
    const step = Math.max.apply(null, ids);
    let next = spXml;
    // 删掉标记 run：标记一定是独立 run（生成期单独加进去的）
    next = next.replace(/<a:r>\s*<a:rPr[\s\S]*?<\/a:rPr>\s*<a:t[^>]*>⟦ANIM:\d+⟧<\/a:t>\s*<\/a:r>/g, '')
      .replace(/<a:r><a:t[^>]*>⟦ANIM:\d+⟧<\/a:t><\/a:r>/g, '');
    if (next.includes('⟦ANIM:')) {
      // 兜底：直接清掉残留标记文本
      next = next.replace(/⟦ANIM:\d+⟧/g, '');
    }
    stripped += ids.length;
    if (spid != null) {
      byStep[step] = byStep[step] || [];
      byStep[step].push(spid);
    }
    return next;
  });
  return { xml: out, byStep, stripped };
}

/** 生成一段"出现"效果（Appear：presetID=1, presetClass=entr, presetSubtype=0） */
function effectPar(id, spid, nodeType) {
  return `<p:par><p:cTn id="${id}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${nodeType}">`
    + '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
    + `<p:set><p:cBhvr><p:cTn id="${id + 1}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>`
    + `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`
    + '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
    + '<p:to><p:strVal val="visible"/></p:to></p:set>'
    + '</p:childTnLst></p:cTn></p:par>';
}

/**
 * 按步生成 <p:timing>：第 1 步的内容一开始就可见，从第 2 步起每次点击出现一组。
 * @param {Object<number, number[]>} byStep
 */
function buildTiming(byStep) {
  const steps = Object.keys(byStep).map(Number).filter((s) => s >= 2).sort((a, b) => a - b);
  if (!steps.length) return '';
  let id = 2;
  const take = (n) => { const v = id; id += n; return v; };

  const clickGroups = steps.map((s) => {
    const spids = byStep[s];
    const outer = take(1);
    const mid = take(1);
    const inner = spids.map((spid, i) => {
      const eid = take(2);
      return effectPar(eid, spid, i === 0 ? 'clickEffect' : 'withEffect');
    }).join('');
    return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>`
      + `<p:par><p:cTn id="${mid}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`
      + '</p:childTnLst></p:cTn></p:par>';
  }).join('');

  const seqId = take(1);
  const rootId = take(1);
  return `<p:timing><p:tnLst><p:par><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>`
    + `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>`
    + clickGroups
    + '</p:childTnLst></p:cTn>'
    + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
    + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
    + '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
}

/** 把 <p:timing> 插到 </p:sld> 前（CT_Slide 里 timing 必须排在 cSld/clrMapOvr/transition 之后） */
function insertTiming(xml, timingXml) {
  if (!timingXml) return xml;
  if (xml.includes('<p:timing>')) return xml;
  const i = xml.lastIndexOf('</p:sld>');
  if (i < 0) return xml;
  return xml.slice(0, i) + timingXml + xml.slice(i);
}

// ============================================================
// 五、主流程
// ============================================================

function relsAddImage(relsXml, mediaName, rid) {
  const ins = `<Relationship Id="${rid}" Type="${IMAGE_REL}" Target="../media/${mediaName}"/>`;
  if (relsXml.includes('</Relationships>')) return relsXml.replace('</Relationships>', `${ins}</Relationships>`);
  return relsXml;
}

/**
 * @param {string} pptxPath 就地改写
 * @param {object} opts
 *   omml        { '⟦MATH:1⟧': { xml, png?:Buffer, name?:string } }
 *   animations  是否处理 ⟦ANIM:n⟧（默认 true）
 *   pageTotal   页码分母；null/undefined 表示不改
 * @returns {Promise<object>} stats
 */
async function postProcess(pptxPath, opts = {}) {
  const omml = opts.omml || {};
  const wantAnim = opts.animations !== false;
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));

  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const stats = {
    ommlReplaced: 0,
    fallbacks: 0,
    animatedSlides: 0,
    animatedShapes: 0,
    pageTotalsPatched: 0,
    tokensReplaced: 0,
    unused: [],
    perSlide: []
  };
  const usedKeys = new Set();

  for (const name of slideNames) {
    let xml = await zip.file(name).async('string');
    const slideNo = (name.match(/slide(\d+)\.xml$/) || [])[1] || '0';
    const rec = { name, omml: 0, fallback: 0, anim: 0 };

    // 1) 原生公式
    const present = Object.keys(omml).filter((k) => xml.includes(k));
    if (present.length) {
      const r = patchOmmlInSlide(xml, omml);
      xml = r.xml;
      rec.omml = r.hits;
      stats.ommlReplaced += r.hits;
      for (const k of present) usedKeys.add(k);
    }

    // 2) 图片兜底
    const blocks = present
      .filter((k) => omml[k] && omml[k].png && xml.includes(String(omml[k].xml).slice(0, 60)))
      .map((k) => ({ key: k, png: omml[k].png, name: omml[k].name, xml: omml[k].xml }));
    if (blocks.length) {
      const relPath = `ppt/slides/_rels/slide${slideNo}.xml.rels`;
      let relsXml = zip.file(relPath) ? await zip.file(relPath).async('string') : null;
      if (relsXml) {
        const idBase = 500 + Number(slideNo) * 10;
        const w = wrapBlocksWithFallback(xml, blocks, idBase);
        xml = w.xml;
        rec.fallback = w.wrapped;
        stats.fallbacks += w.wrapped;
        for (const rel of w.relsNeeded) {
          const mediaName = `a14math${slideNo}_${rel.rid}.png`;
          zip.file(`ppt/media/${mediaName}`, rel.png);
          relsXml = relsAddImage(relsXml, mediaName, rel.rid);
        }
        zip.file(relPath, relsXml);
      }
    }

    // 3) 点击出现动画
    if (wantAnim && xml.includes('⟦ANIM:')) {
      const a = extractAnimTargets(xml);
      xml = a.xml;
      const timing = buildTiming(a.byStep);
      if (timing) {
        xml = insertTiming(xml, timing);
        rec.anim = Object.keys(a.byStep).filter((s) => +s >= 2).length;
        stats.animatedSlides++;
        stats.animatedShapes += Object.values(a.byStep).reduce((n, arr) => n + arr.length, 0);
      }
    }

    // 4) 页码分母 + 自定义标记（目录页码等）
    if (opts.pageTotal && xml.includes(TOTAL_SENTINEL)) {
      const n = xml.split(TOTAL_SENTINEL).length - 1;
      xml = xml.split(TOTAL_SENTINEL).join(String(opts.pageTotal));
      stats.pageTotalsPatched += n;
    }
    if (opts.tokens) {
      for (const [k, v] of Object.entries(opts.tokens)) {
        if (!k || !xml.includes(k)) continue;
        xml = xml.split(k).join(String(v));
        stats.tokensReplaced++;
      }
    }

    zip.file(name, xml);
    stats.perSlide.push(rec);
  }

  stats.unused = Object.keys(omml).filter((k) => !usedKeys.has(k));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const tmp = `${pptxPath}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, pptxPath);
  return stats;
}

/** 兼容旧接口：只改页码（run-core-tests / 老调用方在用） */
async function patchPageTotals(outPath, total) {
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let patched = 0;
  for (const name of slideFiles) {
    const xml = await zip.file(name).async('string');
    if (!xml.includes(TOTAL_SENTINEL)) continue;
    const next = xml.split(TOTAL_SENTINEL).join(String(total));
    zip.file(name, next);
    patched += (xml.split(TOTAL_SENTINEL).length - 1);
  }
  if (patched) {
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    fs.writeFileSync(outPath, buf);
  }
  return patched;
}

module.exports = {
  postProcess,
  patchPageTotals,
  patchSlideXml: patchOmmlInSlide,
  patchParagraph,
  extractAnimTargets,
  buildTiming,
  insertTiming,
  wrapBlocksWithFallback,
  TOTAL_SENTINEL,
  ANIM_RE
};
