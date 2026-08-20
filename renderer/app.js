/**
 * renderer/app.js
 * 渲染进程逻辑：状态管理、事件绑定、大纲预览、生成流程
 * 依赖 window.AIPPT.parser / window.AIPPT.styles / window.aippt (preload)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const parser = window.AIPPT.parser;
  const STYLES = window.AIPPT.styles.STYLES;

  const LAYOUT_LABEL = {
    cover: '封面', section: '章节', content: '内容',
    'two-column': '双栏', quote: '金句', end: '结尾'
  };

  const SAMPLE_MD = `# 让 AI 成为你的创作伙伴

一份关于智能写作工具的产品发布演示

> 开场注意：先讲行业趋势，再引出产品，最后现场演示。

## 为什么现在需要 AI 写作

- 信息爆炸，人工创作效率遇到瓶颈
- 通用大模型能力快速提升，成本持续下降
- 创作者需要的是"助手"而非"替代"

> 引用 Gartner 预测时注意数据口径：2025 年 vs 2028 年。

## 我们的解决方案

- **智能起草**：一句话生成初稿，命中率 90% 以上
- **风格对齐**：学习你的历史文风，输出一致
- **多语言支持**：中英日韩一键互译

> 演示环节：现场用 30 秒生成一篇产品文案。

## 技术架构

\`\`\`
输入层   →  Prompt 编排 + 知识库检索
模型层   →  多模型路由（质量/速度/成本）
输出层   →  结构化 JSON → 富文本渲染
\`\`\`

> 架构图建议用深色背景，突出三层链路。

## 客户反馈

> 一图胜千言：贴一张客户增长曲线。

"上线三个月，团队内容产能提升了 4 倍。" —— 某头部电商 CMO

## 未来路线图

- 2025 Q3：企业私有化部署
- 2025 Q4：多模态（图文混排）创作
- 2026 Q1：Agent 工作流编排

> 路线图时间点以官方公告为准。

## 谢谢观看

欢迎现场交流，也欢迎到展台体验！

> 结尾记得引导用户扫码关注公众号。`;

  // ---------- 状态 ----------
  const state = {
    cfg: loadCfg(),
    md: null,          // { name, content, parsed }
    styleId: 'tech-blue',
    mode: 'ai',
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
      const desc = document.createElement('div');
      desc.className = 'style-desc';
      desc.textContent = s.desc;

      card.appendChild(prev); card.appendChild(name); card.appendChild(desc);
      card.addEventListener('click', () => {
        state.styleId = s.id;
        grid.querySelectorAll('.style-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === s.id));
      });
      grid.appendChild(card);
    });
  }

  // ---------- Markdown 载入 ----------
  function applyMd(name, content) {
    let parsed;
    try {
      parsed = parser.parseMarkdown(content);
    } catch (e) {
      toast('解析 Markdown 失败：' + e.message, true);
      return;
    }
    state.md = { name, content, parsed };
    $('dropzone').hidden = true;
    $('mdMeta').hidden = false;
    $('mdName').textContent = name;
    $('mdState').textContent = '✓ 已导入';

    const chips = $('mdChips');
    chips.textContent = '';
    const stats = parsed.stats;
    [
      ['幻灯片', stats.slides + ' 页'],
      ['要点', stats.bullets + ' 条'],
      ['备注', stats.notes + ' 条']
    ].forEach(([k, v]) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = '';
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
        styleId: state.styleId,
        mode: state.mode,
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
    $('resultDesc').textContent = (res.mode === 'ai' ? 'AI 增强 · ' : '直接排版 · ') +
      '共 ' + res.slideCount + ' 页幻灯片 · 样式：' + (STYLES.find((s) => s.id === state.styleId) || {}).name;
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
        if (r) applyMd(r.name, r.content);
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
      reader.onload = () => applyMd(file.name, String(reader.result || ''));
      reader.onerror = () => toast('读取文件失败', true);
      reader.readAsText(file, 'utf-8');
    });

    $('btnClearMd').addEventListener('click', clearMd);
    $('btnSample').addEventListener('click', () => applyMd('示例.md', SAMPLE_MD));

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
})();
