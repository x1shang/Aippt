# AIPPT 2.1.1 vs Beamer：差距清单 + 「可编辑公式行」实施方案

> 本文基于对 `E:\dsh\exe\aippt` 源码的通读与可运行原型验证（原型在 `E:\dsh\exe\mathpoc`）。
> 所有"实测"数字都来自本次在工作机上真实跑出来的结果，无法在验证的部分已明确标注。

---

## ✅ 实施结果（v2.2.0：本文方案已全部落地）

| 本文方案 | 落地文件 | 状态 |
| --- | --- | --- |
| LaTeX→OMML 转换器（自研，MIT，零依赖） | `shared/mml2omml.js`、`shared/latex2omml.js` | ✅ 复用内置 KaTeX 的 MathML 输出，**未引入 Temml**（少一个依赖） |
| pptx 注入 + `mc:AlternateContent` 图片兜底 | `main/pptx-post.js` | ✅ 一次 zip 后处理同时完成 OMML 注入、兜底图、点击动画、页码回填 |
| 公式三种导出方式 | `main/generator.js`（`formulaMode: image / omml / omml-fallback`）+ UI 分段控件 | ✅ 默认 `omml-fallback` |
| §5.1 真「点击出现」动画 | `main/pptx-post.js`（`buildTiming`）+ `generator.js`（`⟦ANIM:n⟧` 标记） | ✅ 默认开启，可切回多页展开 |
| §5.2 目录页与页脚导航 | `parser.js`（`\tableofcontents` / `autoToc`）+ `generator.js`（`drawToc` / `drawFooter`） | ✅ 目录页码生成后回填 |
| 文献引用 | `shared/bib.js`（新写）+ `parser.js` 引用替换 + 自动参考文献页 | ✅ 61 项单测 |
| 算法伪代码 | `parser.js`（`ALGO_ENVS` / `parseAlgoBody`）+ `rich-html.js`（`algoHtml`）+ `rich.css` | ✅ 行号/缩进/关键字着色 |
| 顺带修掉的真 bug | `latex-compat.js`（siunitx 上下标）、`parser.js`（定理环境体内外标签互不可见） | ✅ |

验证规模：核心 119 项 + 文献 61 项 + v2.2 端到端 24 项 + LaTeX 端到端 38 项 + 功能端到端 21 项 + 应用冒烟测试，全绿。

**仍未验证**：本机没有 PowerPoint，OMML 与 `p:timing` 的**渲染效果**需要在真 PowerPoint 里打开
`test/out/beamer-demo.pptx` 目视确认（结构、语义、动画目标形状存在性均已由自动测试校验）。

---

## 0. 结论速览

1. **两者不是同类工具**：Beamer 是"用 TeX 排版成 PDF（矢量、不可编辑）"，AIPPT 是"把 Markdown 排成可编辑 .pptx"。
   AIPPT 在**交付形态**上赢（对方收到的东西能直接改），Beamer 在**排版能力与生态**上赢（tikz、算法、文献、主题系统）。
2. **真正卡住学术用户的差距只有 4 个**：① 公式是图片（不可编辑）② 没有 tikz/pgfplots ③ 没有算法伪代码 ④ 没有文献引用。
   其余（overlay、定理、编号/交叉引用、代码高亮）v2.1 已经对齐。
3. **可编辑公式不必用矢量图，用 PowerPoint 原生公式对象（OMML）**：链路
   `LaTeX →(KaTeX 或 Temml)→ MathML →(自研 ~14KB 转换器)→ OMML →(jszip 后处理)→ 注入 <a14:m>`。
   **不需要任何 TeX**，新增体积 0～168KB（视是否用 Temml），已跑通并产出可直接打开的双保真 pptx。
4. **矢量图（SVG/EMF）不是可编辑公式**：它在 PowerPoint 里仍是一个"图片/图形"，双击不会进公式编辑器；
   要出 SVG 还得额外带 MathJax（约 1.5MB）或 TeX。仅在"只要能缩放/换色"时才有意义。
5. **建议做法（双保真）**：块级公式外层包 `mc:AlternateContent`——
   `mc:Choice` 放原生 OMML（PowerPoint 2010+ 显示可编辑公式），`mc:Fallback` 放 AIPPT **已有**的 KaTeX 高清图。
   这正是 PowerPoint 自己导出公式时的结构（[MS-ODRAWXML] 3.5 Math）。WPS / LibreOffice / Keynote 看到图，不会出现空白。

---

## 1. 与 Beamer 的逐项差距

| 能力域 | Beamer | AIPPT 2.1.1 现状 | 差距 | 补齐路径（不塞 TeX） |
| --- | --- | --- | --- | --- |
| 数学公式**渲染质量** | TeX 引擎，Computer Modern，绝对正确 | KaTeX 渲染成图，192 DPI | 小 | 保持；改用 OMML 后由 Cambria Math 排版 |
| 公式**可编辑** | ✗（PDF 里也是图/矢量文字） | ✗（整页图片） | **大（本次重点）** | 见第 3 节 OMML 方案 |
| 公式**宏覆盖** | 任意宏包（amsmath/physics/siunitx…） | KaTeX 子集 + `latex-compat.js` 等价替换 | 中 | 扩充兼容表；`mhchem` 需额外引入（34KB） |
| **TikZ / PGFPlots** | 一等公民（交换图、函数图、费曼图） | 无 | **大** | 只能走图片路径：md 里放 `![](fig.svg)`，或用 dvisvgm（**需本机 TeX**，不进安装包） |
| **算法伪代码** | `algorithm2e` / `algorithmicx` | 无 | **大** | 用 `minted` 风格代码块 + 行号高亮近似；或新增 `\begin{algorithm}` 专用块 |
| **文献引用** | `biblatex` + `.bib`，`\cite`/`\footfullcite` | 无 | **大** | 新增 `.bib` 解析 + 编号脚注（纯 JS，~200 行） |
| **主题/模板系统** | 主题 + 配色 + 字体 + 内外模板可任意组合 | 6 套写死的 style（tech-blue 等） | 中 | 把 `shared/styles.js` 提升为"配色 × 版式"两组可组合配置 |
| **版式自由度** | `columns`/`block`/`minipage`/任意绝对定位 | cover/section/content/two-column/quote/end 六种 | 中 | 增加 `block` 环境与真 `columns`（带宽度比） |
| **渐进显示 overlay** | `\pause`/`\only`/`\uncover`/`<+->` | v2.1 已支持（展开成多页 + 三种模式） | 已对齐 | 唯一差别：Beamer 是同一页动画，AIPPT 是多页 |
| **动画/切换** | 极少（靠 pdfpc 等外部工具） | 无 | 小 | 可写 `p:timing` 做出真正的"点击出现"（见 §5.3） |
| **定理/证明/编号/交叉引用** | amsthm + `\ref`/`\eqref` | v2.1 已支持 13 种环境 + 全量引用替换 | 已对齐 | — |
| **目录与导航** | `\tableofcontents` + headline 进度高亮 | 无 | 中 | Markdown 章节列表页 + 页脚小节名 |
| **代码高亮** | `listings`/`minted`（需 pygments） | highlight.js（Node 侧生成类名） | 已对齐 | 可补行号与 `highlightlines` |
| **备注** | `\note{}` + pdfpc 演讲者视图 | `>` 行成备注，能在 PPT 演讲者视图看 | 略优 | — |
| **输出格式** | PDF（矢量、字体内嵌、不可编辑） | .pptx（可编辑、可再加工） | 各有胜负 | 可加"导出 PDF"（LibreOffice/Office COM） |
| **工程化** | 纯文本 → git/CI/make，`\input` 复用 | GUI 一次一份；无 CLI、无 `\input`、无宏定义 | **大** | 加 CLI + `\input` + `\newcommand` 展开（解析期纯文本处理） |
| **数学字体** | Latin Modern 等真数学字体 | 系统字体 + KaTeX 字体（图上） | 小 | OMML 用 Cambria Math（Office 自带） |
| **跨客户端一致性** | PDF 处处一致 | 图片路径一致；OMML 路径依赖客户端（见 §3.5） | 需权衡 | 双保真兜底 |

**一句话**：要"能改"选 AIPPT，要"排版能力上限"选 Beamer。
若目标是从零补齐到 Beamer 级别，成本最低的顺序是：**可编辑公式（本次）→ 文献 → 算法块 → columns/block → CLI/\input → tikz（只能靠图片）**。

---

## 2. 现状：AIPPT 为什么"公式不可编辑"

`main/generator.js` 的判定非常简单（`hasRichContent()`）：

```
只要这一页出现 math/table/callout/env/rich-markup → 整页交给浏览器排版 → 一张 192DPI PNG → slide.addImage()
```

所以**只要有一个 `$x$`，整页文字都变成图片**（连标题里的公式也会走 `renderTitleImage()`）。
优点是版式绝对可控；代价是：公式不能改、正文也不能改、文件大。

---

## 3. 可编辑公式行：方案对比与实测

### 3.1 四种可选方案

| 方案 | PowerPoint 里是什么 | 能编辑公式吗 | 需要 TeX 吗 | 额外体积 | 缩放/换色 |
| --- | --- | --- | --- | --- | --- |
| **A. 现状：PNG 图** | 图片 | ✗ | 不需要 | 0 | 放大糊 |
| **B. SVG 矢量图** | 图片（可"转换为形状"） | ✗（不是公式对象） | 要 MathJax 或 TeX 才能出 SVG | MathJax tex-svg ≈1.5MB | 矢量清晰、可换色 |
| **C. OMML 原生公式** ✅ | **公式对象**（`a14:m`） | **✓ 双击进公式编辑器** | **不需要** | **0～168KB** | 矢量、随字号缩放、可改字体颜色 |
| **D. Unicode 文本数学** | 普通文字 | ✓（当文本改） | 不需要 | 0 | 只适合 `E=mc²` 这类，分式/求和无法表达 |

> 用户设想的"向量图"其实是 B；它能解决"糊"，解决不了"可编辑"。
> 真正对应"可编辑公式行"的是 C：PowerPoint 的原生 OMML 数学对象。

### 3.2 OMML 方案的结构（已对照微软规范）

来自 [MS-ODRAWXML] 3.5 Math 的官方示例（PowerPoint 自己导出的形状就是这两个分支）：

```xml
<mc:AlternateContent xmlns:mc="...markup-compatibility/2006">
  <mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">
    <p:sp>                                  <!-- 真·公式形状 -->
      <p:txBody>
        <a:p>
          <a14:m>
            <m:oMathPara xmlns:m=".../officeDocument/2006/math">
              <m:oMath>
                <m:r>
                  <a:rPr><a:latin typeface="Cambria Math"/></a:rPr>   <!-- 注意：是 a:rPr，不是 Word 的 w:rPr -->
                  <m:t>𝜋</m:t>
                </m:r>
              </m:oMath>
            </m:oMathPara>
          </a14:m>
        </a:p>
      </p:txBody>
    </p:sp>
  </mc:Choice>
  <mc:Fallback>
    <p:sp><p:spPr><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:spPr>...</p:sp>  <!-- 图片兜底 -->
  </mc:Fallback>
</mc:AlternateContent>
```

要点：
- **块级公式**：`<a14:m><m:oMathPara><m:oMath>…`（用 `m:oMathParaPr/m:jc val="centerGroup"` 居中）
- **行内公式**：同一个 `<a:p>` 里，在 `<a:r>` 之间插入 `<a14:m><m:oMath>…`（周围文字仍是普通 run → 整段可编辑）
- **PPT 里 run 属性用 `<a:rPr>`**；Word 用的是 `<w:rPr>`，直接搬 Word 的 OMML 会带进 pptx 非法的 `w:` 元素
- **末尾没有 `mc:AlternateContent` 也能显示**（很多工具就这么干），但包上兜底图才照顾 WPS/LibreOffice

### 3.3 不塞 TeX 的转换链路（本次实测）

```
LaTeX ──KaTeX(已内置, 只取 MathML 输出)──┐
      └─Temml(MIT, 168KB min)──────────┴─→ MathML ──自研 mml2omml-dl(14.6KB)──→ OMML
                                                              └─jszip(pptxgenjs 已依赖)─→ 注入 pptx
```

体积账（对比"塞 TeX"）：

| 方案 | 安装包增量 | 说明 |
| --- | --- | --- |
| 自研 OMML 转换器 | **14.6 KB**（源码，未压缩） | 本次原型，MIT |
| + ziplib | **0**（`jszip` 已是 pptxgenjs 依赖） | AIPPT 已用它改页码 |
| + LaTeX→MathML | **0**（复用已内置 KaTeX）或 **168 KB**（Temml，MathML 更干净） | |
| + mhchem（化学式） | 34 KB（Temml 版） | 可选 |
| 对比：pandoc | ~150 MB | 常见做法，但要外挂 |
| 对比：TeX Live | 几 GB（本机 `D:\downloads\texlive\2026` 就是） | 明确不做 |
| 对比：MathJax（只为出 SVG） | ~20 MB 装 / ~1.5 MB 打包 | 方案 B 的成本 |
| 对比：mathml2omml | 68 KB 但 **LGPL-3.0** | 本原型仅用作对照，不随包发布 |

### 3.4 本次实测结果

**转换覆盖率**（源文档 `md2ppt/LaTeX.md`，经 AIPPT 自己的解析器 + `latex-compat.js` 后共 134 条公式）：

| 引擎 | 成功 | 失败 | 平均 OMML |
| --- | --- | --- | --- |
| Temml 路线 | 131/134 | 3（`\ce{}` 未装 mhchem、公式内中文裸字） | 757 B |
| KaTeX 路线 | 133/134 | 1（`\ce{}` 需 mhchem 扩展） | 747 B |

**结构正确性**（用 python-pptx 反向还原注入结果）：

```
[块级(oMathPara)] f_n={MATRIX{a | if n=0 ; r⋅f_{n−1} | else}     ← cases 变成 m:d(左大括号)+矩阵，正确
[块级(oMathPara)] MATRIX{sin(x)=x−(x^3)/(3!) ; +(x^5)/(5!)−…}    ← multline 多行
[块级(oMathPara)] f(x)=((a)/(b))                                  ← \left(\frac..\right) → m:d 拉伸括号
[块级(oMathPara)] (MATRIX{a|b;c|d})[MATRIX{…}]|MATRIX{…}|         ← pmatrix/bmatrix/vmatrix 都对
[行内(oMath)]     F=ma                                            ← 行内公式与文字同段
```

**端到端产物**（`mathpoc/out/editable-formula-dual.pptx`，112 KB，5 页）：

```
兜底图 1: 25.8KB 2195x272px  katex节点=1 失败=0
注入：替换 5 处，图片兜底 4 个形状
幻灯片 5 页：a14:m=5 oMathPara=4 oMath=5 AlternateContent=4 blip=4 新增 media=4
python-pptx：打开正常（5 页），OMML 语义完全正确
```

**体积对比**：同一条公式，OMML ≈ **2.1 KB**（合并相邻 run 后），PNG 兜底图 ≈ **24 KB** → OMML 只有图的 1/11。
（`mml2omml-dl` 已内置相邻 run 合并，省 19%。）

### 3.5 必须说清楚的代价与限制

1. **本机没有 PowerPoint / WPS / LibreOffice**（只有 TeX Live），所以**"PowerPoint 里长什么样"这一条本次无法亲验**。
   已验证的是：结构符合微软规范示例、XML 良构、python-pptx 可打开、OMML 语义正确、图片兜底分支正常。
   → 落地第一步应该是：拿 `out/editable-formula-dual.pptx` 在真 PowerPoint 里开一次，双击公式确认可编辑。
2. **OMML 不可逆**：从 OMML 反推不回原始 LaTeX。建议把 LaTeX 源码写进形状的 `p:cNvPr descr`（alt 文本），
   这样以后能"重新生成公式"、能审计，也不影响显示。
3. **`\cancel`（斜线划掉）在 OMML 里没有对应元素**，`\cancelto` 只能近似（现状 compat 层已降级为 `\overset`）。
   这类必须留在图片路径上。
4. **客户端覆盖**：PowerPoint 2010+ 显示 OMML；WPS/LibreOffice/Keynote 不在保障范围（这也是 `mc:Fallback` 存在的理由）。
   AIPPT 的图片路径依然是"最稳"的选项，所以三个档位都要给用户：
   `图片（最稳） / 原生公式（可编辑） / 原生公式+图片兜底（推荐默认）`。
5. **度量差异**：KaTeX 量出来的高度 ≠ Cambria Math 实际高度。分页仍用现有离屏渲染器测量，但要留 10~15% 余量，
   并让公式所在的文本框带 `normAutofit`/`fit:shrink` 兜底。
6. **行内公式要小心**：`drawBulletsNative()` 里行高是写死的 `lineH = 0.5in`，含高公式（分式/求和）的那一行会被压。
   建议：**行内公式只在"行高可自动撑开"的段落里用**，其余仍走图片路径。
7. **多行结构（aligned/matrix/cases）不要做行内**——结构上放 `m:oMathPara`（块级）才稳。

---

## 4. 落地到 AIPPT 的具体改法（建议 v2.2）

| 文件 | 改动 |
| --- | --- |
| `shared/mml2omml.js`（新） | 自研 MathML→OMML（DrawingML 版），≈360 行；导出 `mmlToOmml()`、`compactRuns()` |
| `shared/latex2omml.js`（新） | `latexToOmml(tex,{display,szPt,engine})`：优先复用 `renderer/rich/katex.min.js` 的 MathML 输出，失败回退 Temml |
| `main/omml-injector.js`（新） | 基于 `jszip`：按占位符改段落（run 合并定位）、套 `mc:AlternateContent`、追加 media + rels |
| `main/generator.js` | ① `hasRichContent()` 里区分"只有公式"与"表格/提示框/代码"；② 公式块改走占位符 + 注入；③ 每个块级公式**单独一个文本框**（兜底图才能对齐）；④ 设置 `overlayMode` 同款的新选项 `formulaMode: image|omml|omml-fallback` |
| `renderer/index.html` + `app.js` | 新增"公式导出方式"三选一（默认 `omml-fallback`），并在生成日志里报告"已转为可编辑公式 N 条 / 降级为图片 M 条" |
| `test/run-core-tests.js` | 加 OMML 结构断言（f/nary/rad/d/m/sSub…）、`a14:m` 合法性、`w:` 命名空间零出现的断言 |
| `test/e2e-latex.js` | 加"注入后 media 数、无残留占位符、逐公式语义还原对照" |

**占位符约定**：生成期文本里写 `⟦MATH:12⟧`，生成后统一替换。
注意 **PptxGenJS 会把一段文字拆成多个 `<a:r>`**，定位前必须先把整段 run 文本拼起来（原型里已按此实现，见 `lib/inject-omml.mjs`）。

---

## 5. 顺带能补的两处（成本低、收益直观）

### 5.1 真的"点击出现"动画
v2.1 用"展开成多页"模拟 overlay。PPTX 支持 `<p:timing>` 段落级动画，可以把同一页的 `<2->` 条目做成
"单击时出现"的 1 页，而不是 N 页。代价：整页图片化的页面做不了段落动画（图片是整体），
所以这条和"公式/表格走图片"是有冲突的——建议只对原生文本页开启。

### 5.2 目录页与页码栏
`\tableofcontents` 等价物 = 一个自动生成的章节列表页 + 页脚小节名，纯文本处理即可，无技术风险。

### 5.3 数学字体
OMML 默认用 **Cambria Math**（Office 自带）。不想让公式看起来和正文"两种字体"的话，
可以把正文也切成 Cambria/等线混排，或在 `a:rPr/a:latin` 指定成与正文一致的数学字体（需目标机装有该字体）。

---

## 6. 产物与复现

原型目录 `E:\dsh\exe\mathpoc`：

| 文件 | 作用 |
| --- | --- |
| `lib/mml2omml-dl.mjs` | MathML→OMML（DrawingML 版），MIT，14.6KB |
| `lib/latex2omml.mjs` | LaTeX→OMML（Temml / KaTeX 双引擎） |
| `lib/inject-omml.mjs` | pptx 注入 + `mc:AlternateContent` 图片兜底 |
| `p3-poc.mjs` | 纯 Node：真实公式 → 生成 → 注入 → 结构校验 |
| `p5-e2e.cjs` | Electron 端到端：复用 AIPPT 离屏渲染器出兜底图（`electron p5-e2e.cjs`） |
| `p6-engine.mjs` | KaTeX 路线 vs Temml 路线结构对照 |
| `verify_omml.py` / `list_media.py` | python-pptx 独立校验、media 抽取 |
| `out/editable-formula-dual.pptx` | **建议在真 PowerPoint 里打开验收的产物** |
| `refs/` | 微软规范正文、两个第三方注入实现（对照用） |

复现：

```powershell
cd E:\dsh\exe\mathpoc
node p3-poc.mjs                                   # 无需 Electron
node p6-engine.mjs                                # 引擎对照
E:\dsh\exe\aippt\node_modules\electron\dist\electron.exe p5-e2e.cjs   # 带兜底图
python verify_omml.py out\editable-formula-dual.pptx
```

## 7. 参考
- [MS-ODRAWXML] 3.5 Math（PowerPoint 里公式 + 图片兜底的官方结构）
- [Microsoft 365 中的 LaTeX 支持](https://learn.microsoft.com/zh-cn/office/math/latex)（新版 Office 公式编辑器可直接输入 LaTeX）
- ppt-master 的 SVG↔PPTX 映射表（第三方对"可编辑行内公式 = `a14:m > m:oMath`"的独立记录，并明确声明 WPS/LibreOffice 不在其公式契约内）
- 第三方注入实现 `inject_omml.py`（PptxGenJS 占位符 → 后处理替换，与本文思路一致）
