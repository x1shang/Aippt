# ⚡ AIPPT — AI 演示文稿生成器

现代化的桌面 PPT 生成工具：**导入 Markdown → 调用任意 OpenAI 兼容 API 自动生成幻灯片 → 选择视觉样式 → 一键导出 .pptx**。以 `>` 开头的行自动成为对应页的演讲备注。

![tech](https://img.shields.io/badge/Electron-35-blue) ![pptx](https://img.shields.io/badge/PptxGenJS-3.12-green) ![exe](https://img.shields.io/badge/windows-x64-orange)

## ✨ 功能特性

| 功能 | 说明 |
| --- | --- |
| 🤖 任意 OpenAI 兼容 API | 自填 Base URL / API Key / 模型名，支持 OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama 等 |
| 📄 Markdown 导入 | 点选或拖拽 .md/.txt，实时大纲预览；内置示例一键体验 |
| 💬 `>` 行 = 演讲备注 | 以 `>` 开头的行自动写入该页备注（Notes），不出现在页面上 |
| 🎨 6 套现代样式 | 科技蓝 / 商务黑金 / 清新绿 / 渐变紫 / 简约灰 / 活力橙 |
| 🧩 智能排版 | 封面、章节页、内容页、双栏、金句、结尾页自动布局；16:9 |
| ⚡ 双模式 | **AI 增强**（大模型润色重构内容）或 **仅排版**（不调 AI，离线可用） |
| 📦 单文件 .exe | electron-builder 打包为便携版，免安装双击即用 |

## 🚀 快速开始

### 方式一：直接使用打包好的 exe（推荐）

1. 下载 `dist/AIPPT-1.0.0-portable.exe`（或从 Release 获取）
2. 双击运行（无需安装，首次启动解压稍慢属正常）
3. 填入 API 配置 → 点「测试连接」验证
4. 导入 Markdown（或点击「载入示例 Markdown」）
5. 选择样式 → 选择保存位置 → 点「生成 PPT」

### 方式二：源码运行 / 开发

```bash
npm install          # 安装依赖
npm start            # 启动应用
npm test             # 运行核心逻辑测试（32 项）
npm run dist         # 打包 Windows 便携版 exe → dist/
```

## 📝 Markdown 语法约定

```markdown
# 主标题                  ← 第 1 页 = 封面
副标题文字                ← 封面副标题

## 章节标题               ← 新幻灯片

- 要点一                  ← 项目符号
  - 子要点                ← 缩进 2 空格 = 二级要点
1. 步骤一                 ← 序号列表同样支持

> 这是演讲备注            ← ">" 开头的行进入该页备注，不显示在页面上

```代码块```               ← 等宽字体代码块

---                       ← 手动分页
```

内联样式：`**加粗**`、`*斜体*`、`` `等宽` `` 均会保留到 PPT 中。

- 无正文的纯标题页自动识别为「章节页」
- 末页标题以「谢谢 / 感谢 / Thank」开头时自动识别为「结尾页」

## 🔧 常见模型配置示例

| 服务 | Base URL | 模型示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 本地 Ollama | `http://localhost:11434/v1` | `llama3`（可留空 Key） |

> API Key 仅保存在本机浏览器存储（localStorage），不经过任何第三方服务器。

## 🏗️ 项目结构

```
aippt/
├── main/                 # Electron 主进程
│   ├── main.js           #   窗口 / IPC / 冒烟测试入口
│   ├── preload.js        #   安全桥接（contextBridge）
│   ├── ai.js             #   OpenAI 兼容客户端（JSON 结构化输出 + 降级重试）
│   ├── generator.js      #   PptxGenJS 排版引擎（6 布局 × 6 样式）
│   └── generate-flow.js  #   生成主流程
├── renderer/             # 渲染进程（原生 HTML/CSS/JS，无框架依赖）
├── shared/               # 主进程/渲染进程共用
│   ├── parser.js         #   Markdown → 幻灯片结构（">" → 备注）
│   └── styles.js         #   6 套视觉样式定义
├── test/                 # 测试与校验
│   ├── run-core-tests.js #   32 项核心逻辑测试（含 mock AI 服务）
│   ├── verify-pptx.py    #   python-pptx 第三方兼容性校验
│   └── sample.md         #   示例文档
└── assets/               # 图标生成脚本与产物
```

## 🔍 技术要点

- **AI 结构化输出**：请求 `response_format: {type: "json_object"}` 获取幻灯片 JSON；服务端不支持时自动降级重试；返回内容容错解析（纯 JSON / ```json 围栏 / 截取大括号）
- **备注兜底**：无论 AI 是否改写，md 中的 `>` 备注始终保留（AI 备注追加其后），保证演讲者视角信息不丢失
- **安全**：`contextIsolation + sandbox`，渲染进程无 Node 权限，仅通过受限 IPC 访问文件对话框与生成
- **兼容性**：生成的 .pptx 经 python-pptx 独立解析校验（结构、备注页、形状边界）

## 📄 License

MIT
