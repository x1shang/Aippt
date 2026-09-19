# 样式插件化：完整报告

> 目标：把"写死在 `shared/styles.js` 里的 6 套样式"变成**用户可以自己导入的 JSON 文件**。
> 状态：**原型已实现并接入界面**（导入 / 导出 / 删除 / 立即生效），配套 29 项单测 + 9 份样张。
> 相关代码：`shared/style-loader.js`（校验与派生）、`main/style-store.js`（目录扫描与安装）、
> `styles/*.aippt-style.json`（示例插件）、`renderer/app.js`（界面）、`test/style-tests.js`（测试）。

---

## 1. 为什么要插件化

现状（v2.1/v2.2）：样式是一份硬编码数组，`id / 颜色 / 字体` 全部写死在 `shared/styles.js`：

```js
{ id: 'tech-blue', name: '科技蓝', font: 'Microsoft YaHei',
  primary: '#1E5EFF', accent: '#38BDF8', text: '#101828', /* … 共 11 个颜色字段 */ }
```

问题有三：

1. **用户没法加自己的品牌色**——学校/公司有 VI 规范，改不了；
2. **每次调色都要改代码**——非程序员完全无法参与；
3. **样式与版式耦合**——想要"Beamer 学术风"这种整体观感，只能等作者加一套。

插件化之后：样式 = 一个 JSON 文件，用户**导入即可用、右键即可导出改**，作者也可以像发主题包一样分发样式。

---

## 2. 设计边界（先说清楚"能做什么、不能做什么"）

插件化的最大风险是"让用户塞进来一段能执行的东西"。本设计刻意把它限制成**纯数据**：

| 能做 | 不能做 |
| --- | --- |
| 改颜色（11 个语义色位） | ✗ 执行任何代码（没有 JS 字段，纯 JSON） |
| 改字体族与等宽字体 | ✗ 引用外部文件（不能带路径、不能带字体文件） |
| 微调版式数值：标题/正文字号、左右边距、圆角、页脚导航节数 | ✗ 改变版式结构（不能新增/删除版式，不能改坐标） |
| 基于内置样式只改几个字段（`basedOn`） | ✗ 覆盖内置样式（默认拒绝，重名只告警） |
| 自动派生浅色、深底判定、对比度告警 | ✗ 影响解析与生成逻辑 |

**一句话**：样式插件只能"上色"，不能"改结构"，所以即使用户从网上下载一个来路不明的样式文件，最坏结果是"难看"，不会把软件弄坏。

---

## 3. 插件格式规范（`aippt-style/1`）

文件名建议 `*.aippt-style.json`；最小可用样式只需要 `id`、`name` 和颜色。

```jsonc
{
  "$schema": "aippt-style/1",          // 可选，仅作标记
  "id": "beamer-academic",             // 必填：小写字母/数字/._-，2~48 字符，全局唯一
  "name": "Beamer 学术",                // 必填：界面上显示的名字
  "desc": "衬线 · 深蓝 · 米白，最接近 LaTeX 论文的观感",   // 可选
  "author": "AIPPT 官方示例",            // 可选
  "version": "1",                      // 可选
  "basedOn": "minimal-gray",           // 可选：以某内置样式为基线，只写要改的字段
  "font": "Latin Modern Roman, Cambria, 宋体, SimSun",   // 正文字体族（逗号分隔，回退顺序）
  "mono": "Latin Modern Mono, Consolas",                 // 等宽字体（代码块/算法块）

  "colors": {                          // 11 个语义色位（也可直接写在顶层，两种写法都支持）
    "primary":   "#1B3A6B",            // 主色：标题、章节条、强调
    "accent":    "#B8860B",            // 点缀色：项目符号、装饰、页码强调
    "text":      "#111827",            // 正文
    "textSub":   "#5B6B7C",            // 次要文字（副标题、页脚、题注）
    "bg":        "#FDFCF8",            // 内容页背景
    "bgAlt":     "#EEF2F8",            // 浅色区块（提示框、表格表头、代码底）
    "coverBg":   "#0E2440",            // 封面/结尾页背景
    "coverText": "#F7F5EF",            // 封面标题色
    "coverSub":  "#A8C0DC",            // 封面副标题色
    "deco1":     "#1B3A6B",            // 封面装饰圆（缺省 = primary）
    "deco2":     "#B8860B"             // 封面装饰圆（缺省 = accent）
  },

  "layout": {                          // 全部可选，越界会被夹紧到安全范围
    "titleSize": 26,                   // 页面标题字号（pt） 16~54
    "bodySize": 15,                    // 正文字号（pt） 10~28
    "marginX": 1.05,                   // 左右边距（英寸） 0.4~2.2
    "radius": 2,                       // 预留：圆角（pt） 0~24
    "navMax": 10,                      // 页脚导航最多列出几节 2~20
    "lineGap": 1.0                     // 预留：行距系数 0.5~2.0
  }
}
```

### 校验规则（导入时逐条检查）

- **必填**：`id`、`name`；`id` 必须匹配 `^[a-z0-9][a-z0-9._-]{1,47}$`
- **颜色**：必须是 `#RRGGBB` 或 `#RGB`（后者自动展开为 6 位大写）；非法即拒绝整份样式
- **数值**：超出 `LIMITS` 范围自动夹紧（不报错，避免用户因为 26.5 vs 54 被卡住）
- **告警（不阻断）**：未知字段被忽略并提示；正文/背景对比度 < 3:1 时提示"可能看不清"（用 WCAG 对比度，封面标题/封面底同样检查）
- **派生**：`tintLine`（主色 86% 向白）与 `tintSoft`（93%）自动生成，供分隔线/浅底使用；`onDark` 由封面底亮度自动判定
- 解析失败（坏 JSON / 非法颜色 / 保留 id）的样式**整份跳过**，绝不影响其它样式与软件启动

---

## 4. 加载、存放与优先级

扫描顺序（后加载的在前者基础上参与合并，但**默认不与内置样式抢 id**）：

| 位置 | 用途 | 可否删除 |
| --- | --- | --- |
| `<安装目录>/styles/*.aippt-style.json` | 随包发布的示例插件 | ✗（重装会回来） |
| `<用户数据>/styles/*.aippt-style.json` | 用户导入的样式 | ✓（界面"删除插件样式"） |

> Windows 上 `<用户数据>` 通常是 `%APPDATA%\AIPPT\styles\`。
> 随包目录在打包后的 asar 内，因此**用户样式与程序文件天然隔离**——升级软件不会弄丢用户样式。

**合并规则**（`shared/style-loader.js` 的 `mergeStyles`）：

1. 内置 6 套永远在列表最前；
2. 自定义样式按目录顺序追加，`custom: true` 打标记，界面上有"插件"角标；
3. **与内置同 id** → 默认跳过并告警（避免用户导入一个 `tech-blue.json` 把内置样式悄悄替换掉）；
   确有需要可用 `mergeStyles(..., { override: true })`（目前界面不暴露这个开关，属于开发者选项）；
4. 非法样式跳过 + 告警，其余样式照常可用。

---

## 5. 用户怎么用

1. **导入**：界面「选择样式」→「导入样式插件…」→ 选一个 `.aippt-style.json`，立即出现在样式网格里（带"插件"角标）；
2. **从现有样式改**：在任意样式卡片上**右键** →「导出样式插件」→ 用记事本改颜色 → 再导入；
3. **删除**：选中插件样式 →「删除插件样式」（只能删用户目录里的，随包样式删不掉）；
4. 导入时若样式有问题，会直接弹出**具体原因**（例如 `颜色字段 primary 不是合法的 #RRGGBB：royalblue`）。

**样张**：`test/out/style-<id>.pptx`（同一份内容 × 9 套样式），直接开对比即可。
三份随包插件样张：`style-beamer-academic.pptx`、`style-midnight-neon.pptx`、`style-paper-ink.pptx`。

---

## 6. 开发者接口

```js
// 1) 校验 & 规范化（纯函数，可单测）
const loader = require('./shared/style-loader.js');
loader.validateStyle(raw);            // { ok, errors[], warnings[] }
loader.normalizeStyle(raw, baseStyle); // 补齐 + 派生 + 夹紧
loader.parseStyle(jsonText, base);     // { ok, style?, errors, warnings }
loader.mergeStyles(builtin, custom, { override }); // { styles, warnings }

// 2) 目录扫描 / 安装（主进程用）
const store = require('./main/style-store.js');
const r = store.loadStyles({ dirs: [pkgStylesDir, userStylesDir], builtin: STYLES });
store.importStyle(file, userStylesDir);
store.removeStyle(id, userStylesDir);
store.exportStyle(style);              // 导出成可再编辑的 JSON 文本

// 3) 生成时把样式表交给排版引擎
await generatePptx(slides, styleId, outPath, { styles: r.styles, ... });
```

生成期的版式参数处理见 `main/generator.js` 的 `applyStyleLayout()`：
它在生成开始时把 `layout.marginX` 等套进模块级 `LAYOUT`，**结束时（finally）恢复**，
所以"用插件样式生成"不会污染下一次生成——这条有专门的回归测试。

---

## 7. 已验证（本次实测）

| 项 | 结果 |
| --- | --- |
| 样式单测 `node test/style-tests.js` | **29 / 29 通过**（校验 / 派生 / 合并 / 扫描 / 导入导出 / 端到端） |
| 随包 3 个示例插件 | 全部通过校验，0 告警 |
| 端到端：插件样式确实改了产物 | `style1.xml` 里封面底色 = `0E2440`、字体 = `Latin Modern Roman, Cambria, 宋体, SimSun`（来自插件） |
| 生成后 LAYOUT 恢复 | 用 `marginX=1.2` 的样式生成后，下一次内置样式生成仍为 `0.95` |
| 9 套样式样张 | 封面底色/字体各不相同（见 `test/out/style-*.pptx`） |
| 应用冒烟测试 | `styles: 9`（内置 6 + 插件 3），界面正常加载 |

---

## 8. 还没做的（下一步可扩展方向）

按"性价比"排序：

1. **版式（布局）插件**：目前插件只能上色，不能新增版式（如"左右分栏 + 右侧图"）。做法：把 `generator.js`
   里写死的 `drawHero/drawSection/drawQuote/drawToc` 抽象成 `layouts` 注册表，插件用 JSON 描述"区域划分 +
   元素摆放"（标题区/正文区/图片区的相对位置），复杂效果再允许引用少量内置布局名。
2. **富内容 CSS 覆写**：表格/提示框/算法块的内部样式目前写死在 `renderer/rich/rich.css`。
   可让插件带一段**受限 CSS**（白名单属性、只作用于 `.aippt-rich` 作用域内）来改它们。
3. **样式包（多套样式一次导入）**：把 `{ styles: [...] }` 作为一个包文件，便于发布"某某大学模板包"。
4. **可视化调色器**：界面上直接拖色块生成 JSON，不用手写文件。
5. **在线样式市场**：签名 + 校验和，避免分发来源不明的文件（当前安全模型已能兜住，但签名能防篡改）。

---

## 9. 文件索引

| 文件 | 作用 |
| --- | --- |
| `shared/style-loader.js` | 格式规范、校验、规范化、派生、合并（纯函数，浏览器/Node 通用） |
| `main/style-store.js` | 目录扫描、导入、删除、导出 |
| `styles/beamer-academic.aippt-style.json` | 示例：LaTeX 学术风（衬线 + 深蓝 + 米白） |
| `styles/midnight-neon.aippt-style.json` | 示例：深色霓虹风 |
| `styles/paper-ink.aippt-style.json` | 示例：极简水墨风（`basedOn` 用法演示） |
| `renderer/app.js` / `index.html` / `style.css` | 样式网格加载插件、导入/删除按钮、右键导出、插件角标 |
| `test/style-tests.js` | 29 项单测 |
| `test/make-style-samples.js` | 生成 9 套样张 |
