# ⚡ AIPPT v2.2 — 把 Markdown 变成**公式可编辑、可以点着讲**的 PPT

> 用写 Markdown 的方式做学术/技术演示：公式是 **PowerPoint 原生公式对象**（双击就能改），
> 渐进显示是**真的点击出现动画**，还有目录、文献、算法伪代码、定理与交叉引用。
> 全程离线渲染，**不需要安装 TeX**。

![version](https://img.shields.io/badge/version-2.2.0-2f6feb) ![electron](https://img.shields.io/badge/Electron-35-blue) ![katex](https://img.shields.io/badge/KaTeX-0.18-9f7aea) ![omml](https://img.shields.io/badge/OMML-PowerPoint%20%E5%8E%9F%E7%94%9F%E5%85%AC%E5%BC%8F-0a7b34) ![tex](https://img.shields.io/badge/TeX-%E4%B8%8D%E9%9C%80%E8%A6%81-orange) ![exe](https://img.shields.io/badge/windows-x64-6b7280)

---

## 一句话定位

**Beamer 的学术体验，PPT 的交付形态。**

你要么用 Beamer 得到一份排版完美但**谁也改不了**的 PDF，要么用 PPT 得到一份**能改但公式只能贴图**的演示稿。
AIPPT 想要的是第三种东西：写作体验接近 LaTeX（Markdown + `$公式$` + overlay + 定理 + 引用 + 算法），
交付物却是**能继续编辑的 .pptx**——公式是公式、文字是文字、动画是动画。

## 和同生态位工具比，AIPPT 在哪一格

| 工具 | 输入 | 输出 | 公式 | 公式可编辑 | 渐进显示 | 交付形态 |
| --- | --- | --- | --- | --- | --- | --- |
| **LaTeX Beamer** | LaTeX | PDF | 完美（TeX 引擎） | ✗ 不可编辑 | ✓（同页 overlay） | 矢量 PDF，改不了 |
| **Marp / Slidev** | Markdown | HTML/PDF | 靠 KaTeX 贴图 | ✗ | Slidev 有（网页） | 网页/PDF，不是 PPT |
| **Quarto / Pandoc** | Markdown | beamer/pptx | 走 LaTeX | ✗ | 部分 | 依赖 TeX 安装 |
| **md2pptx** | Markdown | PPTX | MathML→OMML | ✓（较有限） | ✗ | PPTX，需 Java + 转换脚本 |
| **Gamma / islide 等 AI PPT** | 提示词 | PPTX | 几乎没有公式能力 | — | ✗ | PPTX，偏商务排版 |
| **Typst / Touying** | Typst | PDF | 优秀（自研引擎） | ✗ | ✓ | PDF，改不了 |
| **AIPPT v2.2** | Markdown | **PPTX** | KaTeX → **OMML 原生公式** | **✓ 双击即改** | ✓ **点击出现动画**（或多页展开） | **PPTX/PPT 生态，可继续编辑** |

> 取舍很明确：**要"能改"选 AIPPT，要"排版上限"（tikz、任意宏包）仍得用 TeX。**
> AIPPT 不做 tikz、不做 `\newenvironment` 那套宏编程——它换来的是一份对方拿到手就能改的 PPT。

---

## 🆕 v2.2 重大更新（相对 v1）

v1 已经能"Markdown → 好看的 PPT"。v2.2 把这些**学术刚需**补齐了：

| # | 能力 | 一句话 | 关键实现 |
| --- | --- | --- | --- |
| 1 | 🧮 **公式可编辑（原生公式对象）** | `$\frac{a}{b}$` 导出后是 PowerPoint 公式，**双击就能改**，不是图片 | KaTeX→MathML→**OMML**→`<a14:m>` 注入 pptx；附图片兜底给 WPS/LibreOffice |
| 2 | 🎬 **真·点击出现动画** | 分步页合成一页，放映时按一下出现一条（Beamer 手感） | 生成 `<p:timing>` 点击序列（Appear 效果），可一键换回多页展开 |
| 3 | 📑 **目录页与页脚导航** | `\tableofcontents` 出目录页（**真实页码**），页脚有章节导航 + 进度条 | 生成后回填页码标记；页脚高亮当前节 |
| 4 | 📚 **文献引用** | `\cite{key}` / `[@key]` → `[1]`，文末自动追加参考文献页 | 内置 BibTeX 解析 + 按引用顺序编号 + 未定义 → `[?]` 并告警 |
| 5 | ⌨️ **算法伪代码** | `\begin{algorithm}` 直接写伪代码，带行号/缩进/关键字着色 | `\State`/`\If`/`\For`/`\While`/`\Require`/`\Call` 全套语义解析 |
| 6 | 🛡 **公式兜底与降级** | 窄平台（WPS/LibreOffice/Keynote）自动回落到同位置高清图 | `mc:AlternateContent`：`Choice`=原生公式，`Fallback`=图片（**PowerPoint 自己导出公式的做法**） |

v1 打下的地基在同一条流水线上继续可用：公式/表格/图片渲染、Obsidian 提示框、代码高亮、演讲备注、
**定理环境**（theorem/lemma/proof/…）、**自动编号与交叉引用**（`\ref`/`\eqref`/`\autoref`）、
**渐进显示**（`\pause` / `<2->` / `\only<n->{}`，三种隐藏语义）、AI 增强（公式表格占位保护）。

### 实测（`examples/beamer-demo.md`，同一份 12 页源文档）

| 公式导出方式 | 页数 | 文件大小 | 原生公式 | 说明 |
| --- | ---: | ---: | ---: | --- |
| `omml-fallback`（默认） | 13 | **533 KB** | 6 处 | 可编辑 + 图片兜底 + 点击动画（动画把 2 页合成 1 页） |
| `omml` | 15 | **453 KB** | 6 处 | 只写原生公式，文件最小 |
| `image`（v1 行为） | 15 | 671 KB | 0 | 整页出图，任何客户端像素级一致 |

> 单条公式：原生 OMML 约 **2 KB**，同内容的高清图约 **24 KB**——原生公式只有图的 1/11。
> 附带收益：**公式在 PPT 里可以改字号、换颜色、重排，导出 PDF/打印也不再糊。**

---

## 🚀 快速开始

### 方式一：用打包好的 exe

1. 取得 `dist/AIPPT-2.2.0-portable.exe`，双击运行（免安装）
2. 选「仅排版（不调 AI）」即可离线使用；要 AI 润色文字再填 API
3. 导入 Markdown（或点「载入示例 Markdown」）
4. 选样式 → 选**公式导出方式** → 选分步方式 → 选保存位置 → 生成

### 方式二：源码运行

```bash
npm install
npm start
npm test                                                   # 119 项核心逻辑测试（纯 Node）
node test/bib-tests.js                                     # 61 项文献模块测试
node_modules\electron\dist\electron.exe test\e2e-v22.js     # 24 项 v2.2 端到端（真渲染器）
node_modules\electron\dist\electron.exe test\e2e-latex.js   # LaTeX.md 端到端
node_modules\electron\dist\electron.exe test\e2e-features.js
node_modules\electron\dist\electron.exe test\make-demo.js   # 生成三份示范稿到 test/out/
python test\verify-latex.py test\out\v22-e2e.pptx           # 第三方（python-pptx）校验
npm run dist                                                # 打包 Windows 便携版
```

### 方式三：直接用示例验收

`examples/beamer-demo.md` 把 v2.2 的能力全用了一遍（可编辑公式、点击动画、目录、文献、算法、定理、表格、代码）。
它的同目录放着 `references.bib`，**导入时会自动载入**，所以引用能直接编号。

---

## 🧮 公式：三种导出方式怎么选

| 方式 | PowerPoint 里是什么 | 双击能改吗 | WPS / LibreOffice | 适用场景 |
| --- | --- | --- | --- | --- |
| **原生公式 + 图片兜底**（默认） | 原生公式对象，另带一张同位置图 | ✓ | ✓（看到图） | 大多数情况，兼顾编辑与兼容 |
| **仅原生公式** | 纯原生公式对象 | ✓ | 可能显示为空 | 确定只在 PowerPoint 里用，想要最小文件 |
| **渲染成图片** | 整页高清图（v1 行为） | ✗ | ✓（像素级一致） | 交付给不确定的客户端、或要绝对稳定的版式 |

**技术链路（不含任何 TeX）**：

```
LaTeX ──KaTeX（已内置，只取 MathML 输出）──▶ MathML ──shared/mml2omml.js（自研，20KB）──▶ OMML
                                                                      │
                            pptx 后处理：整段→m:oMathPara（块级）；段内→m:oMath（行内）
                                         块级再包 mc:AlternateContent + 图片兜底
```

- **块级公式**：`<a14:m><m:oMathPara><m:oMath>`，居中排版
- **行内公式**：`<a14:m><m:oMath>` 插在同一段落的 `<a:r>` 之间，**整段文字仍然可编辑**
- run 属性用 `<a:rPr>`（DrawingML），不是 Word 的 `<w:rPr>`——这是最容易踩的坑，写错 PowerPoint 会报"需要修复"
- 公式字体 **Cambria Math**（Office 自带），字号随文本框设置缩放
- 分式→`m:f`、根式→`m:rad`、求和→`m:nary`（上下限位置正确）、矩阵→`m:m`、`cases`→左大括号+矩阵、`\left(\frac..\right)`→可拉伸括号 `m:d`

**已知边界**（诚实说明）：

- OMML 是**单向**的：从 OMML 不能反推回原始 LaTeX 写法；需要重做时请保留源 Markdown
- `\cancel`（斜线划掉）在 Office Math 里没有对应元素，这类公式建议走图片方式
- 行内公式**不带图片兜底**（段落里塞不进图片形状），所以「仅原生公式」模式下窄平台可能看不到行内公式
- 表格/提示框/算法/长代码所在页面仍然整页出图（它们靠浏览器排版才好看），**只有公式页会走原生路径**

---

## 📝 Markdown 语法速查（v2.2 全量）

````markdown
# 主标题                    ← 第 1 页封面（无 H1 时用文件名合成）
副标题文字

\tableofcontents            ← v2.2：目录页（页码自动回填）

## 章节标题                 ← 新幻灯片（###/#### 亦然；二级标题进目录）

- 要点一
  - 子要点（缩进 2 空格）
1. 有序列表

行内公式 $E=mc^2$ 与 $\nabla \cdot \vec{E} = \rho/\varepsilon_0$。

$$
f_n=\begin{cases}
  a & \text{if } n=0 \\
  r\cdot f_{n-1} & \text{else}
\end{cases}
$$                          ← 行间公式（→ PowerPoint 原生公式对象）

引文：由 \cite{knuth1998} 或 [@li2021] 可知，另见 \citet{zhang2020}。
                             ← v2.2：自动编号 [1]，文末自动追加参考文献页

\begin{algorithm}[快速排序] \label{alg:qsort}     ← v2.2：算法伪代码
\Require 数组 $A$，下标 $p, r$
\Ensure $A$ 已升序
\If{$p < r$}
  \State $q \gets \Call{Partition}{A,p,r}$
  \State \Call{QuickSort}{$A,q+1,r$}
\EndIf
\Return $A$
\end{algorithm}
算法 \ref{alg:qsort} 的复杂度为 $O(n\log n)$。

\begin{theorem}[勾股定理] \label{thm:pyth}
在直角三角形中 $$a^2+b^2=c^2 \label{eq:pyth}$$
\end{theorem}
\begin{proof} 面积法即得。 \end{proof}
由 \eqref{eq:pyth} 与定理 \ref{thm:pyth} 可知。

| 名称 | 公式 |
| --- | :---: |
| 勾股 | $a^2+b^2=c^2$ |
表：示例数据 \label{tab:data}      ← 表格下一行写题注

![演示图 \label{fig:demo}](figure.png)   ← 图注取 alt 文本

> [!tip] 提示框
> - 提示内容

> 这是演讲备注（不出现在页面上）

```python
print("代码块带语法高亮")
```

---                          ← 手动分页
````

### 🎬 渐进显示（Beamer overlay）

```markdown
## 分步讲解

- 第一步（立刻出现）
- 第二步 <2->            ← 第 2 步出现（标记也可放行首）
- 只在第 3 步出现 <3>
- 第 2–4 步出现 <2-4>

\pause                   ← 推进后续内容的起始步

\onslide<3->             ← 设置起始步

行内命令：\only<2->{只在这一步显示}、\alert<3->{出现时高亮}、\uncover<2->{保留占位}。
```

- 未到步内容的三种处理：**留空位**（默认，布局稳定）/ **灰显**（`\setbeamercovered{transparent}`）/ **不留空**
- **分步实现方式**（v2.2 新增）：**点击出现动画**（合成一页，真 PowerPoint 动画）/ **展开成多页**（任何播放器都稳定、打印不丢内容）
- 行内代码里的标记（如 `` `<2->` ``、`` `\pause` ``）**不会被当成指令**，可以放心写语法教程
- 页码分母自动是**展开后的真实总页数**

### 📚 文献引用（v2.2）

- 支持 `\cite{a,b}`、`\citep{}`、`\citet{}`（作者+编号）、`\footcite{}`、`[@a]`、`[@a; @b]`
- 来源：界面里导入 `.bib`，或把 `references.bib` 放在 Markdown 同目录（自动载入）
- 编号按**首次引用顺序**（unsrt 风格），重复引用同号；未定义键显示 `[?]` 并在日志告警
- 没有手写「参考文献」页时，自动在文末追加（每页 7 条，自动续页）
- 行内代码里的 `\cite{}` 不会被误判——文档里讲语法不受影响

---

## 🔧 常见模型配置（AI 增强模式）

| 服务 | Base URL | 模型示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 本地 Ollama | `http://localhost:11434/v1` | `llama3`（可留空 Key） |

> AI 只负责润色**纯文本**：公式/表格/图片/定理/算法块以 `⟦B数字⟧` 保护、分步标记以 `⟦O数字-⟧` 保护，
> 模型弄丢标记会自动补回并告警。API Key 只存在本机 localStorage。
> **公式渲染、动画注入、文献编号、pptx 导出全部离线完成，不依赖网络。**

---

## 🏗️ 项目结构

```
aippt/
├── main/
│   ├── main.js               # 窗口 / IPC / 冒烟测试
│   ├── preload.js            # 安全桥接（含 .bib 选择）
│   ├── ai.js                 # OpenAI 兼容客户端 + 占位保护
│   ├── rich-renderer.js      # 离屏窗口渲染器：HTML/KaTeX → 高清 PNG（2x）
│   ├── generator.js          # 排版引擎：原生文本 / 原生公式(OMML) / 富内容图片 三条路径
│   ├── pptx-post.js          # ★ v2.2 一次 zip 后处理：OMML 注入 + 图片兜底 + 点击动画 + 页码
│   └── generate-flow.js      # 生成主流程（解析 → 文献 → AI → 排版）
├── renderer/
│   ├── index.html/.css/.js   # 界面：配置 / 导入 / 样式 / 公式与动画选项 / 生成
│   └── rich/                 # 离屏渲染页（rich.html/js/css + KaTeX + mhchem）
├── shared/
│   ├── parser.js             # Markdown → 块模型（公式/表格/定理/算法/overlay/编号/引用）
│   ├── mml2omml.js           # ★ v2.2 MathML → OMML（DrawingML 版，自带极简 XML 解析，零依赖）
│   ├── latex2omml.js         # ★ v2.2 LaTeX → OMML（复用内置 KaTeX 的 MathML 输出）
│   ├── bib.js                # ★ v2.2 BibTeX 解析 + 编号 + 条目格式化
│   ├── overlay.js            # `<n->` 解析、可见性判定、行内命令替换
│   ├── rich-html.js          # 块 → HTML 片段（含算法块、代码高亮）
│   ├── latex-compat.js       # LaTeX 宏兼容替换表（siunitx/physics/cancel…）
│   └── styles.js             # 6 套视觉样式
├── examples/                 # ★ v2.2 演示：beamer-demo.md + references.bib
├── test/                     # 119 核心 + 61 文献 + 24 v2.2 E2E + LaTeX E2E + python 校验
└── docs/editable-formulas-and-beamer-gaps.md   # 与 Beamer 的差距分析 + 实现方案
```

## 🔍 技术要点（都是踩过的坑）

- **OMML 注入**：生成期在文本里写占位符 `⟦MATH:n⟧`，生成后用 jszip 做外科手术式替换。
  ⚠️ PptxGenJS 会把一段文字拆成多个 `<a:r>`，占位符可能被切断——必须先把整段 run 文本拼起来再定位。
- **只改必须改的字节**：不做 DOM 重写整份 slide，其余内容原样保留，避免 PowerPoint 提示"需要修复"。
- **公式兜底**：块级公式外层包 `mc:AlternateContent`，这是 [MS-ODRAWXML] 里 PowerPoint 自己导出公式的结构。
- **点击动画**：为每个"要后出现的"文本框写一条 `p:timing`（`presetID=1 presetClass=entr` = 出现），
  目标是**形状级**（每个要点一个文本框，天然可逐条动画）。
- **LaTeX 兼容层**：`\pu{9.8 m/s^2}` 这类 siunitx 写法会把上下标拆到 `\text{}` 之外，否则 KaTeX 在 `^` 上报错。
- **引用与编号**：解析期登记 `\label` → 编号；收尾阶段统一遍历所有文本字段替换 `\ref`/`\eqref`/`\cite`。
  定理环境体是用子解析器解析的，子解析的标签会并回主文档，环境体内外的引用才能互相看见。
- **AI 结构化输出**：`response_format: {type:"json_object"}`，服务端 400 时自动降级重试，返回内容容错解析。
- **安全**：`contextIsolation + sandbox`，渲染进程无 Node 权限；离屏渲染页同样 `sandbox: true`。

## ✅ 可验证性

| 层 | 手段 | 规模 |
| --- | --- | --- |
| 核心逻辑 | 纯 Node + stub 渲染器 | 119 项 |
| 文献模块 | 纯 Node | 61 项 |
| v2.2 端到端 | 真 Electron 渲染器：OMML 结构、兜底图墨迹、动画目标形状存在性、目录页码、无残留标记 | 24 项 |
| LaTeX 端到端 | 真实文档 + 白图检测 + LaTeX 残留检测 | 38 项 |
| 第三方 | python-pptx：页数/图片尺寸/边界/备注 | ✓ |

**关键不变量**：任何产物都不得残留 `⟦MATH:⟧`、`⟦ANIM:⟧`、`⟪T⟫`、`⟪P:⟧`，也不得出现 `<w:>` 命名空间；
动画目标 `spid` 必须真实存在——这三条都在 E2E 里硬断言。

## ⚠️ 已知限制（别踩）

- **点击动画只在 PowerPoint 里生效**；Google Slides/LibreOffice 会忽略动画（内容会一次性全部显示），
  要绝对稳妥就选「展开成多页」
- **原生公式需要 PowerPoint 2010+**；WPS/LibreOffice/Keynote 不在保证范围内（默认模式已带图片兜底）
- 不支持的：TikZ/PGFPlots 图形、任意宏包与宏编程、多栏精细排版、`\include` 文件拆分
- 本机测试环境没有安装 PowerPoint，OMML/动画的**渲染效果**请在真 PowerPoint 里开一次
  `test/out/beamer-demo.pptx` 验收（结构与语义已由 E2E 与 python-pptx 校验）

## 📄 License

MIT
