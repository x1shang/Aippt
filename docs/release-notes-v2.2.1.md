# AIPPT v2.2.1 发布说明

> **用写 Markdown 的方式做学术/技术演示：公式是 PowerPoint 原生公式对象（双击就能改），
> 渐进显示是真的点击出现动画，还有目录、文献、算法伪代码、定理与交叉引用。全程离线渲染，不需要安装 TeX。**
>
> 发布日期：2026-09-26 ｜ Tag：`v2.2.1` ｜ Commit：`f938adc` ｜ 平台：Windows x64（便携版，免安装）
> 仓库：<https://github.com/x1shang/Aippt> ｜ License：MIT

---

## 📦 本次发布产物

| 项目 | 内容 |
| --- | --- |
| 文件名 | `AIPPT-2.2.1-portable.exe` |
| 大小 | 78,210,683 字节（约 74.6 MB） |
| 构建时间 | 2026-09-20 09:00:29 |
| SHA-256 | `FF487EEBA011BC9169904B6CA65CB399A74E4A51BE4C0962F89055F2C8B4A2DA` |
| 源码对应 | `f938adc`（tag `v2.2.1`，已在 `main` 上） |
| 打包命令 | `npm run dist`（`electron-builder --win portable --publish never`） |
| 运行方式 | 双击即用，免安装；程序为**单实例**，重复双击只是把已有窗口切到前台 |

> 校验下载完整性（PowerShell）：
> ```powershell
> Get-FileHash .\AIPPT-2.2.1-portable.exe -Algorithm SHA256
> # 应输出 FF487EEBA011BC9169904B6CA65CB399A74E4A51BE4C0962F89055F2C8B4A2DA
> ```

---

## ✨ 新功能

### 一、v2.2 的八项能力（相对 v1 的学术刚需补齐）

| # | 能力 | 说明 | 关键实现 |
| --- | --- | --- | --- |
| 1 | 🧮 **公式可编辑** | `$\frac{a}{b}$` 导出后是 **PowerPoint 原生公式对象**，双击即可改，不是图片 | KaTeX → MathML → 自研 `mml2omml.js` → OMML → `<a14:m>` 注入 pptx |
| 2 | 🎬 **真·点击出现动画** | 分步内容合成一页，放映时按一下出现一条（Beamer 手感） | 生成 `<p:timing>` 点击序列（Appear，`presetID=1 presetClass=entr`）+ `<p:bldLst>` |
| 3 | 📑 **目录页与页脚导航** | `\tableofcontents` 生成目录页并回填**真实页码**；页脚有章节名 + 进度条 | 生成后重新打开 pptx 回填页码标记，页脚高亮当前节 |
| 4 | 📚 **文献引用** | `\cite{key}` / `[@key]` → `[1]`，文末自动追加参考文献页 | 内置 BibTeX 解析，按首次引用顺序编号（unsrt 风格），未定义键 → `[?]` 并告警 |
| 5 | ⌨️ **算法伪代码** | `\begin{algorithm}` 直接写伪代码，带行号、缩进、关键字着色 | `\State` / `\If` / `\For` / `\While` / `\Require` / `\Ensure` / `\Call` 全套语义解析 |
| 6 | 🛡 **公式兜底与降级** | 窄平台（WPS / LibreOffice / Keynote）自动回落到同位置高清图 | `mc:AlternateContent`：`Choice` = 原生公式，`Fallback` = 图片（与 PowerPoint 自身导出公式的结构一致） |
| 7 | 🎨 **样式插件化** | 样式就是一份 `*.aippt-style.json`，导入即用；右键任意样式可导出 JSON 改完再导入 | 纯数据规范（只有颜色/字体/边距），严格校验、越界夹紧、不覆盖内置 |
| 8 | 📚 **文献库可直接写在 md 里** | 界面导入 `.bib`，或把 BibTeX 写进 Markdown（含 HTML 注释里，页面上不可见） | 三种来源自动合并：界面导入 + 同目录 `references.bib` + md 内嵌 |

### 二、v2.2.1 三项修补

1. **左右两栏各自独立滚动** —— 鼠标在哪一侧，滚轮就只滚那一侧，页面本身不再整体滚动，长文档编辑不再"跑偏"。
2. **默认示例换成 `examples/beamer-demo.md`** —— 学术风、覆盖全部能力（目录/文献/算法/动画/定理/表格/代码），
   并新增「全功能示例」按钮可切到 `examples/showcase.md`；开箱即可对照验收。
3. **修掉行内代码里的图片语法被当成真图片** —— `` `![](x.png)` `` 现在只是文字，不再产生"图片未找到"告警
   （写语法教程不再误触发）。

### 三、v2.2.0 关键补丁：点击动画"点得动但不出现"

真实放映器里"能点击、但内容不出现"的两个根因，已全部修复：

- 缺少 **`<p:bldLst>` 构建列表** —— 没有它放映器不知道要构建哪些形状；
- **标记剥离正则跨 run** —— PptxGenJS 会在每个 run 前插 `<a:pPr>`，跨 run 匹配会把要显示的正文一起吃掉。
  现在严格**按 run 边界**剥离动画标记。

**已用本机真实 WPS 放映验证**：`GetClickCount()` 返回 2 次点击，逐次点击的墨迹量 5287 → 6741 → 8315（内容确实在增加）。
复现脚本与根因详见 [`docs/click-animation-notes.md`](click-animation-notes.md)。

---

## 🎨 样式插件（新）

样式不再是写死的 6 套，而是一份 JSON：

```jsonc
{
  "$schema": "aippt-style/1",
  "id": "beamer-academic",
  "name": "Beamer 学术",
  "desc": "衬线 · 深蓝 · 米白，最接近 LaTeX 论文的观感",
  "font": "Latin Modern Roman, Cambria, 宋体, SimSun",
  "basedOn": "minimal-gray",              // 可选：只写要改的字段
  "colors": {
    "primary": "#1B3A6B", "accent": "#B8860B",
    "text": "#111827", "textSub": "#5B6B7C",
    "bg": "#FDFCF8", "bgAlt": "#EEF2F8",
    "coverBg": "#0E2440", "coverText": "#F7F5EF", "coverSub": "#A8C0DC"
  },
  "layout": { "titleSize": 26, "bodySize": 15, "marginX": 1.05, "navMax": 10 }
}
```

- **导入即用**：界面「选择样式」→「导入样式插件…」，立即出现在样式网格（带"插件"角标）
- **改着玩**：右键任意样式卡片 →「导出样式插件」→ 改颜色 → 再导入
- **安全**：纯数据、无代码、无路径；颜色必须 `#RRGGBB`，数值自动夹紧，对比度过低会提醒；坏文件整份跳过，不影响启动
- **不抢内置**：与内置样式同 id 的导入会被拒绝并说明原因
- 随包附带 3 个示例插件：`styles/beamer-academic.aippt-style.json`（学术衬线）、
  `styles/midnight-neon.aippt-style.json`（深色霓虹）、`styles/paper-ink.aippt-style.json`（极简水墨）
- 样张：`test/out/style-*.pptx`（同一份内容 × 9 套样式，直接开对比）；完整规范见 [`docs/style-plugins.md`](style-plugins.md)

> ⚠️ v2.2.0 曾漏把 `styles/` 加进打包白名单，导致安装包内没有样式插件；v2.2.1 已修正（`fix(build)` 提交）。

---

## 🧮 公式：三种导出方式

| 方式 | PowerPoint 里是什么 | 双击能改吗 | WPS / LibreOffice | 适用场景 |
| --- | --- | --- | --- | --- |
| **原生公式 + 图片兜底**（默认） | 原生公式对象，另带一张同位置图 | ✓ | ✓（看到图） | 大多数情况，兼顾编辑与兼容 |
| **仅原生公式** | 纯原生公式对象 | ✓ | 可能显示为空 | 确定只在 PowerPoint 里用，想要最小文件 |
| **渲染成图片**（v1 行为） | 整页高清图 | ✗ | ✓（像素级一致） | 交付给不确定的客户端、要绝对稳定的版式 |

同一份 12 页源文档（`examples/beamer-demo.md`）实测：

| 导出方式 | 页数 | 文件大小 | 原生公式 |
| --- | ---: | ---: | ---: |
| `omml-fallback`（默认） | 13 | **533 KB** | 6 处 |
| `omml` | 15 | **453 KB** | 6 处 |
| `image`（v1 行为） | 15 | 671 KB | 0 |

> 单条公式：原生 OMML 约 **2 KB**，同内容高清图约 **24 KB**——原生公式只有图的 1/11。
> 附带收益：公式在 PPT 里可以改字号、换颜色、重排，导出 PDF/打印也不再糊。

技术链路（不含任何 TeX）：

```
LaTeX ──KaTeX（已内置，只取 MathML 输出）──▶ MathML ──shared/mml2omml.js（自研，零依赖）──▶ OMML
                                                                   │
                        pptx 后处理：整段→m:oMathPara（块级）；段内→m:oMath（行内）
                                     块级再包 mc:AlternateContent + 图片兜底
```

---

## 🚑 便携版加固（v2.2.1）

便携版 exe 的运行方式是把程序**解压到 `%TEMP%` 再启动**。若这次解压不完整（被上一轮运行删了一半、被杀毒软件拦下、磁盘写满、直接被强杀），
旧版会出现 `Cannot find module 'jszip'` 这类"程序文件不完整"的错误。v2.2.1 起做了三层加固：

1. **所有依赖都收进 `app.asar` 内部**（关掉 electron-builder 的 `smartUnpack`）——
   不再有 `app.asar.unpacked` 这种"少一个目录就跑不起来"的脆弱结构；
2. **启动自检 + 中文提示**：缺文件时弹窗明确告诉你缺什么、临时解压目录在哪、怎么修，
   而不是甩一句没有上下文的 `Uncaught Exception`；
3. **解压目录带版本号**（`%TEMP%\AIPPT-2.2.1`），新版本不会复用旧版本残留目录。

真遇到打不开，任选其一：

```powershell
# 1) 关闭程序，删掉临时解压目录，再重新双击 exe
Remove-Item "$env:TEMP\AIPPT-*" -Recurse -Force

# 2) 或把 exe 换一个目录再运行（例如 D:\AIPPT\）
# 3) 若反复出现，把该 exe 加入杀毒软件白名单后重试
```

---

## 🙏 致歉：关于这几个版本"忘了提交"

先把话说清楚：**v2.0.0、v2.1.0、v2.1.1 这三个版本，代码从来没有进过 Git。**

完整的提交时间线（来自 `git log` 与构建产物时间戳）：

| 时间 | 发生了什么 | Git 里有记录吗 |
| --- | --- | --- |
| 2026-08-20 21:53 | 构建 `AIPPT-1.0.0-portable.exe` | — |
| 2026-08-20 23:08 | `first commit 26-8-20`，并打 tag `v1.0.0` | ✅ `bb7ac67` |
| 2026-08-21 21:28 | 在 GitHub 网页上添加 MIT LICENSE | ✅ `06431eb`（远程，本地当时没拉） |
| 2026-09-19 20:52 | 构建 `AIPPT-2.0.0-portable.exe` | ❌ **无提交** |
| 2026-09-19 21:27 | 构建 `AIPPT-2.1.0-portable.exe` | ❌ **无提交** |
| 2026-09-19 21:38 | 构建 `AIPPT-2.1.1-portable.exe` | ❌ **无提交** |
| 2026-09-19 22:47 | 一个提交 `release: AIPPT v2.2.0`，**39 个文件、+9654 / −451 行** | ⚠️ 三个版本被压成一个提交 |
| 2026-09-19 22:59 / 23:30 / 23:32 | 补测、样式插件化、打包白名单修复 | ✅ |
| 2026-09-20 08:49 / 09:00 | v2.2.1 的两处修复 | ✅ |
| 2026-09-20 09:00 | 构建 `AIPPT-2.2.1-portable.exe` | ✅（代码已提交） |
| 2026-09-20 → 09-26 | **7 个提交一直躺在本地，没 push**（远程停在 8-21 的 LICENSE） | ❌ 未推送 |
| 2026-09-26 00:02 | 推送全部提交；tag `v2.2.1` 重指到正确提交；清掉误提交的临时脚本 | ✅ |

**这带来了什么实际影响，我不遮：**

1. **v2.0.0 / v2.1.0 / v2.1.1 无法被复现**。它们只有 exe，没有对应的源码快照，谁也 checkout 不出当时的代码，
   也没法 diff、没法二分定位回归——想确认"2.1.1 到底改了什么"，只能去读 exe，这是不该发生的事。
2. **一个月的开发历史被压成一个大提交**。9-19 22:47 那个提交包含 39 个文件、近 1 万行新增，
   把 v2.0、v2.1、v2.1.1 的演进全糊在一起，code review 与回溯都失去了意义。
3. **本地与远程脱节了 5 周**。远程 8-21 就多了 LICENSE 提交，本地一直没拉；等到推送时才发现冲突，
   不得不做一次 rebase，进而导致本地 `v2.2.1` 标签指向了一个被重写的旧提交（发版时才发现）。
4. **误把临时脚本提交进了仓库**。打包调试用的 `tmp-commit2.ps1` 被 commit 进了 v2.2.1 的提交里，
   直到本次发布才删除；另外 4 个 `tmp-asar*.js` 调试脚本，以及 7 个探针/截图/原型脚本
   （`test/probe-animation.js`、`proto-render.js`、`ui-shot.js`、`preview-pptx.js`、`wps-anim-diag.ps1`、
   `wps-anim-probe.ps1`、`wps-make-oracle.ps1`）此前也都是仓库里的跟踪文件，本次已一并解除跟踪。

**已经做的补救（本次发布已完成）：**

- ✅ 7 个提交全部推送到远程 `main`，本地与远程一致（`## main...origin/main`）；
- ✅ tag `v2.2.1` 重新指向正确的提交 `f938adc`（内容与出包的 2.2.1 源码一致，已校验 `styles/`、`LICENSE` 都在标签内）；
- ✅ 删除误提交的 `tmp-commit2.ps1`；
- ✅ **解除跟踪全部本地调试脚本**：4 个 `tmp-asar*.js` + 7 个探针/截图/原型脚本（文件保留在工作区，已写入 `.gitignore`），
  `test/` 下的正式测试套件（核心 119 项 / 文献 61 项 / 样式 29 项 / 打包 8 项 / 三套 E2E）继续随仓库发布；
- ✅ 补齐这份发布说明与版本历史，作为缺失提交记录的书面替代。

**今后怎么防止（明确的约定，不是口号）：**

1. **每个版本出包前先 commit，再 build**；构建产物时间戳必须晚于提交时间；
2. **版本号变更（`package.json`）与 tag 必须在同一个提交周期内完成**，tag 只在已推送的提交上打；
3. **推送后立刻核对** `git status -sb` 与 `git ls-remote --tags origin`，确认远程 tag 指向预期提交；
4. **临时脚本统一进 `.gitignore`**（`tmp-*`），不再进版本库；
5. 开发过程中按功能小步提交，**不再出现跨版本的巨型 squash 提交**。

对已经下载过 v2.0 / v2.1 系列的各位说一句抱歉：那段时间的更新你们拿到的只有 exe，
看不到源码、也提不了 issue 对应的代码定位。v2.2.1 起，代码、标签、发布说明会保持同步。

---

## 🗂 版本历史

| 版本 | 构建时间 | 大小 (MB) | 主要变化 | 源码状态 |
| --- | --- | ---: | --- | --- |
| **v1.0.0** | 2026-08-20 21:53 | 72.9 | 首个版本：任意 OpenAI 兼容 API（含 Ollama）、Markdown 导入 + 大纲预览、6 套现代样式、封面/章节/内容/双栏/金句/结尾自动版式、`>` 行 = 演讲备注、AI 增强 / 仅排版双模式、便携版 exe；核心测试 32 项 | ✅ tag `v1.0.0` → `bb7ac67` |
| **v2.0.0** | 2026-09-19 20:52 | 74.0 | 走向"富内容渲染"：引入 KaTeX 做公式渲染（192 DPI 高清图）、highlight.js 代码高亮、表格/图片/Obsidian 提示框版式；样式扩展到 6+ 套 | ⚠️ 无提交（仅 exe） |
| **v2.1.0** | 2026-09-19 21:27 | 74.5 | 学术能力对齐 Beamer：渐进显示 overlay（`\pause` / `<n->` / `\only` / `\uncover`，展开成多页 + 三种隐藏语义）、13 种定理/证明环境、公式与图表自动编号 + 全量交叉引用（`\ref` / `\eqref` / `\autoref`）、代码高亮完善 | ⚠️ 无提交（仅 exe） |
| **v2.1.1** | 2026-09-19 21:38 | 74.5 | v2.1.0 的快速修补版（11 分钟后出包）；此版本状态被完整记录于 [`docs/editable-formulas-and-beamer-gaps.md`](editable-formulas-and-beamer-gaps.md)（该文标题即 "AIPPT 2.1.1 vs Beamer"） | ⚠️ 无提交（仅 exe） |
| **v2.2.0** | 2026-09-19 23:32 | 74.5 | 可编辑公式（OMML）+ 图片兜底、真·点击出现动画、目录页与页脚导航、文献引用（BibTeX）、算法伪代码、样式插件化、md 内嵌文献库；修掉动画"点得动不出现" | ✅ `83c7790` → `f969b77` / `07068ab` |
| **v2.2.1** | 2026-09-20 09:00 | 74.6 | 左右栏独立滚动、默认示例改 `beamer-demo`、修行内代码图片误判；便携版三层加固（依赖收进 asar + 启动自检中文提示 + 带版本号的解压目录）；修正 `styles/` 打包白名单 | ✅ `a12efaf` / `f938adc`，tag `v2.2.1` |

各版本 exe 的 SHA-256（便于核对历史包）：

```
1.0.0  7E6A51716B87EFBEF1E3B56B35B55108EC0BE714D47FBEFC51497ECE91995D7E
2.0.0  02BA7F9A6BB29B618C66FA3009077703B61951C779C0AE14B759411B822E5479
2.1.0  E63A1D8362BB9015DDB3FD38E2D76D3E268DE1E14A1EF8D448625707CB246BB6
2.1.1  227DE2CE3B4195A24A8F8A2AE1DD4ACF4959AD98A450F343EFD008E63D87C262
2.2.0  887A18C42887533328C7C877191969CB81BBE7FF77BAE9BC1D16F3A5B219A02E
2.2.1  FF487EEBA011BC9169904B6CA65CB399A74E4A51BE4C0962F89055F2C8B4A2DA
```

> 说明：v2.0.0 / v2.1.0 / v2.1.1 的变化是根据 `package-lock.json` 的依赖快照、
> 代码内注释与测试分组（`test/run-core-tests.js` 中 "v2.1：渐进显示 / 定理环境 / 编号引用 / 代码高亮"）、
> 以及 `docs/` 内文档追溯整理的——因为当时没有提交，这几行的粒度必然不如其他版本精确，特此声明。

---

## ✅ 测试与验证

| 层级 | 手段 | 规模 |
| --- | --- | --- |
| 核心逻辑 | 纯 Node + stub 渲染器 | 119 项 |
| 文献模块 | 纯 Node | 61 项 |
| 样式插件 | 纯 Node（校验/派生/合并/导入导出/端到端） | 29 项 |
| v2.2 端到端 | 真 Electron 渲染器：OMML 结构、兜底图墨迹、动画形状保留正文、目录页码、无残留标记 | 26 项 |
| LaTeX 端到端 | 真实文档 + 白图检测 + LaTeX 残留检测 | 38 项 |
| 功能端到端 | 高亮颜色数、分步墨迹递增、定理色带、引用替换 | 21 项 |
| 打包产物 | `AIPPT_SMOKE=1` 自检（含 OMML / 兜底图 / 动画 / jszip / 高亮库） | 8 项 |
| 真实放映器 | WPS COM：`GetClickCount()` + 逐次截图量墨迹 | 2 套脚本 |
| 第三方 | python-pptx：页数 / 图片尺寸 / 边界 / 备注 | ✓ |

**关键不变量**：任何产物都不得残留 `⟦MATH:⟧`、`⟦ANIM:⟧`、`⟪T⟫`、`⟪P:⟧`，也不得出现 `<w:>` 命名空间；
动画目标 `spid` 必须真实存在、且其形状里**必须还留着正文**——这几条都在 E2E 里硬断言。

复现验证：

```bash
npm test                                                     # 119 项核心逻辑
node test/bib-tests.js                                       # 61 项文献模块
node test/style-tests.js                                     # 29 项样式插件
node test/package-tests.js                                   # 8 项打包与启动健壮性
node_modules\electron\dist\electron.exe test\e2e-v22.js       # 26 项 v2.2 端到端
node_modules\electron\dist\electron.exe test\e2e-latex.js     # LaTeX 端到端
node_modules\electron\dist\electron.exe test\e2e-features.js  # 功能端到端
# 真实放映器验证（WPS COM 探针 test\wps-*.ps1）为本地维护脚本，不随仓库发布
```

---

## 🚀 快速开始

1. 下载 `AIPPT-2.2.1-portable.exe`，双击运行（免安装）
2. 选「仅排版（不调 AI）」即可**完全离线**使用；要 AI 润色文字再填 Base URL / API Key / 模型名
3. 导入 Markdown（或点「载入示例 Markdown」/「全功能示例」）
4. 选样式 → 选**公式导出方式** → 选分步方式 → 选保存位置 → 生成

> 公式渲染、动画注入、文献编号、pptx 导出**全部离线完成**，不依赖网络；API Key 只存在本机 localStorage。

---

## ⚠️ 已知限制

- **点击动画**：已在真实 WPS 与 PowerPoint 兼容结构下验证；Google Slides / LibreOffice 若忽略动画，内容会一次性全部显示，
  要绝对稳妥请选「展开成多页」。动画页的内容仍是普通文本框，即使播放器不支持动画也不会丢内容。
- **原生公式需要 PowerPoint 2010+**；WPS / LibreOffice / Keynote 不在保证范围内（默认模式已带图片兜底）。
- OMML 是**单向**的：无法从 OMML 反推回原始 LaTeX，需要重做时请保留源 Markdown。
- `\cancel`（斜线划掉）在 Office Math 里没有对应元素，这类公式建议走图片方式。
- 行内公式**不带图片兜底**（段落里塞不进图片形状），「仅原生公式」模式下窄平台可能看不到行内公式。
- 表格 / 提示框 / 算法 / 长代码所在页面仍然整页出图（依赖浏览器排版），**只有公式页走原生路径**。
- 不支持：TikZ / PGFPlots、任意宏包与宏编程、多栏精细排版、`\include` 文件拆分。
- 本机测试环境未安装 PowerPoint，OMML 与动画的**渲染效果**请在真 PowerPoint 里打开
  `test/out/beamer-demo.pptx` 目视验收（结构与语义已由 E2E 与 python-pptx 校验）。

---

## 🔗 相关文档

- [`README.md`](../README.md) —— 完整功能说明、语法速查、与同类工具对比
- [`docs/editable-formulas-and-beamer-gaps.md`](editable-formulas-and-beamer-gaps.md) —— 与 Beamer 的差距清单 + OMML 实施方案（v2.1.1 状态存档）
- [`docs/click-animation-notes.md`](click-animation-notes.md) —— 点击动画两个真实 bug 的根因与验证方法
- [`docs/style-plugins.md`](style-plugins.md) —— 样式插件完整规范与设计说明
- `examples/beamer-demo.md` —— 学术风全能力示例（配套 `references.bib`）
- `examples/showcase.md` —— 全功能内置示例

## 📄 License

MIT © 2026 x1shang
