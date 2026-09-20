/**
 * renderer/app.js
 * 渲染进程逻辑：状态管理、事件绑定、大纲预览、生成流程
 * 依赖 window.AIPPT.parser / window.AIPPT.styles / window.aippt (preload)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const parser = window.AIPPT.parser;
  // 样式表：启动时用 IPC 拉取"内置 + 样式插件"；这里先用内置作为初值
  let STYLES = window.AIPPT.styles.STYLES;

  const LAYOUT_LABEL = {
    cover: '封面', section: '章节', content: '内容',
    'two-column': '双栏', quote: '金句', end: '结尾'
  };

  // 兜底示例（正式示例是 examples/showcase.md，通过 IPC 读取，可在文件里直接改）
  const SAMPLE_MD = [
    '# AIPPT 功能总览',
    '',
    '一份 Markdown，导出可编辑、可点击、带目录与文献的 PPT',
    '',
    '\\tableofcontents',
    '',
    '## 公式',
    '',
    '行内公式 $E = mc^2$ 与文字同段混排，双击即可编辑。',
    '',
    '$$',
    '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
    '$$',
    '',
    '## 谢谢观看',
    '',
    '欢迎交流！'
  ].join('\n');
  // ---------- 状态 ----------
  const state = {
    cfg: loadCfg(),
    md: null,          // { name, content, parsed, path }
    styleId: 'tech-blue',
    mode: 'ai',
    overlayMode: 'hide',
    formulaMode: 'omml-fallback',   // image | omml | omml-fallback
    animation: true,                // 真「点击出现」动画
    autoToc: true,
    footer: true,
    bibPath: '',
    bibText: '',
    outPath: '',
    generating: false
  };

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem('aippt.cfg') || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveCfg() {
    localStorage.setItem('aippt.cfg', JSON.stringify({
      baseUrl: $('inBaseUrl').value.trim(),
      apiKey: $('inApiKey').value.trim(),
      model: $('inModel').value.trim()
    }));
  }

  // ---------- 工具 ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function appendLog(msg, cls) {
    const box = $('logBox');
    box.hidden = false;
    const lines = $('logLines');
    const div = document.createElement('div');
    div.className = 'log-line' + (cls ? ' ' + cls : '');
    div.textContent = msg;
    lines.appendChild(div);
    lines.scrollTop = lines.scrollHeight;
  }

  function clearLog() {
    $('logLines').textContent = '';
    $('logBox').hidden = true;
  }

  function setGenerating(on) {
    state.generating = on;
    const btn = $('btnGenerate');
    btn.disabled = on;
    $('btnGenerateText').textContent = on ? '生成中…' : '生成 PPT';
    btn.classList.toggle('loading', on);
  }

  // ---------- 样式卡片 ----------
  /** 拉取（内置 + 插件）样式表；失败时保留内置 */
  async function loadStylesFromMain() {
    try {
      const r = await window.aippt.listStyles();
      if (r && r.styles && r.styles.length) {
        STYLES = r.styles;
        if (!STYLES.some((s) => s.id === state.styleId)) state.styleId = STYLES[0].id;
        buildStyleGrid();
        const custom = STYLES.filter((s) => s.custom).length;
        if (custom) $('styleHint').textContent = `已载入 ${custom} 个样式插件（可在下方导入 / 导出）`;
      }
      if (r && r.warnings && r.warnings.length) appendLog('⚠ 样式插件：' + r.warnings.join('；'), 'err');
    } catch (e) { /* 保留内置样式 */ }
  }

  function buildStyleGrid() {
    const grid = $('styleGrid');
    grid.textContent = '';
    STYLES.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'style-card' + (s.id === state.styleId ? ' selected' : '');
      card.dataset.id = s.id;

      const prev = document.createElement('div');
      prev.className = 'style-preview';
      const left = document.createElement('div');
      left.className = 'sp-half';
      left.style.background = s.coverBg;
      ['w70', 'w40', 'w50'].forEach((w, i) => {
        const l = document.createElement('div');
        l.className = 'sp-line ' + w;
        l.style.background = i === 0 ? s.coverText : (i === 1 ? s.deco1 : s.deco2);
        l.style.opacity = i === 0 ? '0.95' : '0.55';
        left.appendChild(l);
      });
      const right = document.createElement('div');
      right.className = 'sp-half';
      right.style.background = s.bg;
      const r1 = document.createElement('div');
      r1.className = 'sp-line w70';
      r1.style.background = s.primary;
      const r2 = document.createElement('div');
      r2.className = 'sp-line w40';
      r2.style.background = s.accent;
      const r3 = document.createElement('div');
      r3.className = 'sp-line w50';
      r3.style.background = s.bgAlt;
      r3.style.outline = '1px solid ' + s.primary + '22';
      right.appendChild(r1); right.appendChild(r2); right.appendChild(r3);

      prev.appendChild(left); prev.appendChild(right);

      const name = document.createElement('div');
      name.className = 'style-name';
      name.textContent = s.name;
      if (s.custom) {
        const badge = document.createElement('span');
        badge.className = 'style-badge';
        badge.textContent = '插件';
        name.appendChild(badge);
      }
      const desc = document.createElement('div');
      desc.className = 'style-desc';
      desc.textContent = s.desc;

      card.appendChild(prev); card.appendChild(name); card.appendChild(desc);
      card.addEventListener('click', () => {
        state.styleId = s.id;
        grid.querySelectorAll('.style-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === s.id));
        if ($('styleHint')) $('styleHint').textContent = `当前样式：${s.name}（${s.desc}）`;
      });
      card.addEventListener('contextmenu', async (e) => {
        // 右键：导出这个样式为 JSON，改完再导入就是自己的插件
        e.preventDefault();
        const r = await window.aippt.exportStyle(s.id);
        if (r && r.ok) toast('已导出样式：' + r.path);
        else if (r && r.errors) toast(r.errors[0], true);
      });
      grid.appendChild(card);
    });
  }

  // ---------- Markdown 载入 ----------
  function applyMd(name, content, mdPath) {
    let parsed;
    try {
      parsed = parser.parseMarkdown(content, { fileName: name || '演示文稿' });
    } catch (e) {
      toast('解析 Markdown 失败：' + e.message, true);
      return;
    }
    state.md = { name, content, parsed, path: mdPath || '' };
    $('dropzone').hidden = true;
    $('mdMeta').hidden = false;
    $('mdName').textContent = name;
    $('mdState').textContent = '✓ 已导入';

    const chips = $('mdChips');
    chips.textContent = '';
    const stats = parsed.stats;
    const items = [
      ['幻灯片', stats.slides + ' 页'],
      ['要点', stats.bullets + ' 条'],
      ['备注', stats.notes + ' 条']
    ];
    if (stats.math) items.push(['公式', stats.math + ' 个']);
    if (stats.tables) items.push(['表格', stats.tables + ' 个']);
    if (stats.images) items.push(['图片', stats.images + ' 张']);
    if (stats.envs) items.push(['定理块', stats.envs + ' 个']);
    if (stats.callouts) items.push(['提示框', stats.callouts + ' 个']);
    if (stats.code) items.push(['代码块', stats.code + ' 个']);
    if (stats.overlaySlides) items.push(['渐进显示', stats.overlaySlides + ' 页(+' + stats.steps + ')']);
    if (stats.refs) items.push(['交叉引用', stats.refs + ' 处']);
    if (stats.numbered) items.push(['编号对象', stats.numbered + ' 个']);
    items.forEach(([k, v]) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.appendChild(document.createTextNode(k + ' '));
      const b = document.createElement('b');
      b.textContent = v;
      c.appendChild(b);
      chips.appendChild(c);
    });

    renderPreview(parsed);
  }

  function clearMd() {
    state.md = null;
    state.outPath = '';
    $('dropzone').hidden = false;
    $('mdMeta').hidden = true;
    $('mdState').textContent = '';
    $('outPath').value = '';
    $('previewStats').textContent = '';
    $('resultCard').hidden = true;
    const body = $('previewBody');
    body.textContent = '';
    const tip = document.createElement('div');
    tip.className = 'empty-tip';
    const ic = document.createElement('div');
    ic.className = 'empty-icon';
    ic.textContent = '🎨';
    const p1 = document.createElement('p');
    p1.textContent = '导入 Markdown 后，这里将实时显示解析出的幻灯片大纲。';
    const p2 = document.createElement('p');
    p2.className = 'hint';
    p2.innerHTML = '以 <code>&gt;</code> 开头的行会自动成为该页幻灯片的<b>演讲备注</b>，不会出现在页面上。';
    tip.appendChild(ic); tip.appendChild(p1); tip.appendChild(p2);
    body.appendChild(tip);
  }

  /** 幻灯片富内容特征徽标（公式/表格/图片/提示框/定理/分步） */
  function blockFeatureBadges(s) {
    const counts = { math: 0, table: 0, image: 0, callout: 0, code: 0, env: 0 };
    for (const b of s.blocks || []) {
      if (counts[b.type] === undefined) continue;
      counts[b.type]++;
    }
    const defs = [
      ['math', '🧮 公式'],
      ['table', '📊 表格'],
      ['image', '🖼 图片'],
      ['env', '📐 定理'],
      ['callout', '💡 提示框'],
      ['code', '⌨ 代码']
    ];
    const wrap = document.createElement('div');
    wrap.className = 'feat-row';
    let any = false;
    for (const [key, label] of defs) {
      if (!counts[key]) continue;
      any = true;
      const tag = document.createElement('span');
      tag.className = 'feat-tag feat-' + key;
      tag.textContent = label + (counts[key] > 1 ? ' ×' + counts[key] : '');
      wrap.appendChild(tag);
    }
    if (s.steps && s.steps > 1) {
      any = true;
      const tag = document.createElement('span');
      tag.className = 'feat-tag feat-overlay';
      tag.textContent = '🎬 ' + s.steps + ' 步';
      wrap.appendChild(tag);
    }
    return any ? wrap : null;
  }

  // ---------- 大纲预览 ----------
  function renderPreview(parsed) {
    const body = $('previewBody');
    body.textContent = '';
    $('previewStats').textContent = parsed.slides.length + ' 页 · ' + parsed.stats.notes + ' 条备注';

    parsed.slides.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'slide-item';

      const idx = document.createElement('div');
      idx.className = 'slide-index';
      idx.textContent = String(i + 1).padStart(2, '0');

      const main = document.createElement('div');
      main.className = 'slide-main';

      const titleRow = document.createElement('div');
      titleRow.className = 'slide-title-row';
      const title = document.createElement('span');
      title.className = 'slide-title';
      title.textContent = s.title || '(无标题)';
      const badge = document.createElement('span');
      badge.className = 'layout-badge' + (s.layout ? ' ' + s.layout : '');
      badge.textContent = LAYOUT_LABEL[s.layout] || s.layout;
      titleRow.appendChild(title); titleRow.appendChild(badge);

      main.appendChild(titleRow);

      const feat = blockFeatureBadges(s);
      if (feat) main.appendChild(feat);

      if (s.subtitle) {
        const sub = document.createElement('div');
        sub.className = 'slide-bullets';
        sub.textContent = s.subtitle;
        main.appendChild(sub);
      }

      if (s.bullets.length) {
        const bl = document.createElement('div');
        bl.className = 'slide-bullets';
        s.bullets.slice(0, 5).forEach((b) => {
          const line = document.createElement('div');
          line.className = 'bl';
          line.style.paddingLeft = (b.level || 0) * 14 + 'px';
          line.textContent = (b.code ? '⌨ ' : '• ') + (b.text.length > 60 ? b.text.slice(0, 60) + '…' : b.text);
          bl.appendChild(line);
        });
        if (s.bullets.length > 5) {
          const more = document.createElement('div');
          more.className = 'bl';
          more.style.color = 'var(--faint)';
          more.textContent = '+ ' + (s.bullets.length - 5) + ' 条…';
          bl.appendChild(more);
        }
        main.appendChild(bl);
      }

      if (s.notes.length) {
        const nt = document.createElement('div');
        nt.className = 'slide-notes';
        nt.textContent = '💬 ' + s.notes.join(' ｜ ');
        main.appendChild(nt);
      }

      item.appendChild(idx); item.appendChild(main);
      body.appendChild(item);
    });
  }

  // ---------- 生成 ----------
  function apiConfig() {
    return {
      baseUrl: $('inBaseUrl').value.trim(),
      apiKey: $('inApiKey').value.trim(),
      model: $('inModel').value.trim()
    };
  }

  async function onGenerate() {
    if (state.generating) return;
    if (!state.md) { toast('请先导入 Markdown 文件', true); return; }
    saveCfg();

    if (!state.outPath) {
      const firstTitle = state.md.parsed.slides.length ? state.md.parsed.slides[0].title : '演示文稿';
      const p = await window.aippt.chooseOutPath(firstTitle || '演示文稿');
      if (!p) return;
      state.outPath = p;
      $('outPath').value = p;
    }

    if (state.mode === 'ai' && !apiConfig().baseUrl) {
      toast('AI 模式需要填写 API Base URL（或切换为"仅排版"）', true);
      return;
    }

    setGenerating(true);
    clearLog();
    $('resultCard').hidden = true;
    appendLog('开始生成…', 'info');

    try {
      const res = await window.aippt.generate({
        apiConfig: apiConfig(),
        mdContent: state.md.content,
        mdPath: state.md.path || '',
        styleId: state.styleId,
        mode: state.mode,
        overlayMode: state.overlayMode,
        formulaMode: state.formulaMode,
        animation: state.animation,
        autoToc: state.autoToc,
        footer: state.footer,
        bibText: state.bibText || '',
        outPath: state.outPath
      });
      showResult(res);
    } catch (e) {
      appendLog('✖ ' + e.message, 'err');
      toast(e.message, true);
    } finally {
      setGenerating(false);
    }
  }

  function showResult(res) {
    const st = res.stats || {};
    const bits = [];
    bits.push(res.mode === 'ai' ? 'AI 增强' : '直接排版');
    bits.push('共 ' + res.slideCount + ' 页');
    if (st.math) bits.push('公式 ' + st.math);
    if (st.tables) bits.push('表格 ' + st.tables);
    if (st.images) bits.push('图片 ' + st.images);
    if (st.algorithms) bits.push('算法 ' + st.algorithms);
    if (st.citations) bits.push('引用 ' + st.citations);
    // v2.2：把"可编辑公式 / 动画 / 目录"的可感知结果直接写进结果卡片
    const om = res.omml || {};
    if (om.display || om.inline) {
      bits.push(`可编辑公式 ${(om.display || 0) + (om.inline || 0)} 条` + (om.fallbackImages ? `（含 ${om.fallbackImages} 张兼容图）` : ''));
    }
    if (om.failed) bits.push(`⚠ ${om.failed} 条公式退回原文`);
    if (res.animation && res.animation.slides) bits.push(`点击动画 ${res.animation.shapes} 处`);
    if (res.toc && res.toc.entries) bits.push(`目录 ${res.toc.entries} 节`);
    if (res.warnings && res.warnings.length) bits.push('⚠ ' + res.warnings.length + ' 条提示');
    $('resultDesc').textContent = bits.join(' · ') +
      ' · 样式：' + ((STYLES.find((s) => s.id === state.styleId) || {}).name || '');
    $('resultPath').textContent = res.path;
    $('resultCard').hidden = false;
    appendLog('✔ ' + res.path, 'ok');
  }

  // ---------- 事件绑定 ----------
  function bind() {
    const dz = $('dropzone');
    dz.addEventListener('click', async () => {
      try {
        const r = await window.aippt.openMdDialog();
        if (r) applyMd(r.name, r.content, r.path);
      } catch (e) { toast(e.message, true); }
    });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.remove('drag-over');
    }));
    dz.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.(md|markdown|mdown|txt)$/i.test(file.name)) {
        toast('仅支持 .md / .markdown / .txt 文件', true);
        return;
      }
      const reader = new FileReader();
      const droppedPath = window.aippt.getPathForFile(file) || '';
      reader.onload = () => applyMd(file.name, String(reader.result || ''), droppedPath);
      reader.onerror = () => toast('读取文件失败', true);
      reader.readAsText(file, 'utf-8');
    });

    $('btnClearMd').addEventListener('click', clearMd);
    $('btnSample').addEventListener('click', async () => {
      // 默认示例是 examples/beamer-demo.md（可编辑的真实文件）；连路径一起带进来，
      // 示例里的 references.bib 与相对图片路径才能正确解析
      try {
        const s = await window.aippt.getSampleMd('beamer');
        if (s && s.content) { applyMd(s.name || 'beamer-demo.md', s.content, s.path || ''); return; }
      } catch (e) { /* 落入兜底 */ }
      applyMd('示例.md', SAMPLE_MD);
    });

    if ($('btnSampleAll')) {
      $('btnSampleAll').addEventListener('click', async () => {
        try {
          const s = await window.aippt.getSampleMd('showcase');
          if (s && s.content) { applyMd(s.name || 'showcase.md', s.content, s.path || ''); return; }
        } catch (e) { /* 忽略 */ }
        toast('未找到全功能示例文件', true);
      });
    }

    $('btnToggleKey').addEventListener('click', () => {
      const inp = $('inApiKey');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('btnToggleKey').textContent = show ? '隐藏' : '显示';
    });

    $('btnTest').addEventListener('click', async () => {
      const cfg = apiConfig();
      if (!cfg.baseUrl) { toast('请先填写 API Base URL', true); return; }
      const el = $('testResult');
      el.textContent = '测试中…';
      el.className = 'test-result';
      try {
        const r = await window.aippt.testConnection(cfg);
        el.textContent = '✓ 连接成功（' + r.latencyMs + ' ms）';
        el.className = 'test-result ok';
      } catch (e) {
        el.textContent = '✗ ' + e.message.split('\n')[0].slice(0, 60);
        el.className = 'test-result err';
      }
    });

    $('modeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-item');
      if (!btn) return;
      state.mode = btn.dataset.mode;
      $('modeSeg').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b === btn));
    });

    $('overlaySeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-item');
      if (!btn) return;
      state.overlayMode = btn.dataset.ov;
      $('overlaySeg').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b === btn));
    });

    $('formulaSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-item');
      if (!btn) return;
      state.formulaMode = btn.dataset.formula;
      $('formulaSeg').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b === btn));
    });

    $('animSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-item');
      if (!btn) return;
      state.animation = btn.dataset.anim === 'on';
      $('animSeg').querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b === btn));
    });

    $('chkToc').addEventListener('change', (e) => { state.autoToc = e.target.checked; });
    $('chkFooter').addEventListener('change', (e) => { state.footer = e.target.checked; });

    $('btnImportStyle').addEventListener('click', async () => {
      const r = await window.aippt.importStyle();
      if (!r || r.canceled) return;
      if (!r.ok) { toast((r.errors && r.errors[0]) || '导入失败', true); return; }
      toast(`已导入样式「${r.style.name}」`);
      await loadStylesFromMain();
    });

    $('btnRemoveStyle').addEventListener('click', async () => {
      const cur = STYLES.find((s) => s.id === state.styleId);
      if (!cur || !cur.custom) { toast('请先选中一个「插件」样式', true); return; }
      const r = await window.aippt.removeStyle(cur.id);
      if (!r || !r.ok) { toast((r && r.errors && r.errors[0]) || '删除失败', true); return; }
      toast(`已删除样式「${cur.name}」`);
      state.styleId = STYLES[0].id;
      await loadStylesFromMain();
    });

    $('btnPickBib').addEventListener('click', async () => {
      const r = await window.aippt.chooseBibPath();
      if (!r || r.canceled) return;
      state.bibPath = r.path || '';
      state.bibText = r.text || '';
      $('bibPath').value = state.bibPath;
      $('bibState').textContent = r.count ? `已载入 ${r.count} 条文献` : '未解析到条目';
      $('bibState').className = 'test-result' + (r.count ? ' ok' : ' err');
    });

    $('btnPickOut').addEventListener('click', async () => {
      const p = await window.aippt.chooseOutPath('演示文稿');
      if (p) { state.outPath = p; $('outPath').value = p; }
    });

    $('btnGenerate').addEventListener('click', onGenerate);

    $('btnOpenFolder').addEventListener('click', () => {
      if (state.outPath) window.aippt.openFolder(state.outPath);
    });
    $('btnResetOut').addEventListener('click', () => {
      state.outPath = '';
      $('outPath').value = '';
      $('resultCard').hidden = true;
    });

    window.aippt.onProgress((msg) => {
      const cls = /✖/.test(msg) ? 'err' : (/完成/.test(msg) ? 'ok' : '');
      appendLog(msg, cls);
    });

    window.aippt.getAppInfo().then((info) => {
      $('appVersion').textContent = 'v' + info.version;
    }).catch(() => {});

    // 恢复配置
    $('inBaseUrl').value = state.cfg.baseUrl || 'https://api.openai.com/v1';
    $('inApiKey').value = state.cfg.apiKey || '';
    $('inModel').value = state.cfg.model || '';
    if (state.cfg.baseUrl) $('modelState').textContent = '✓ 已配置';
  }

  // ---------- 启动 ----------
  bind();
  buildStyleGrid();
  loadStylesFromMain();   // 拉取「内置 + 样式插件」样式表并重建样式卡片
})();



