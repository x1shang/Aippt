$ErrorActionPreference = 'Continue'
Set-Location E:\dsh\exe\aippt
git add -A
$msg = @'
fix(packaging): 便携版"打不开/缺 jszip"——依赖全部收回 asar 内 + 启动自检（v2.2.1）

用户现象：双击便携版弹出
  A JavaScript error occurred in the main process
  Error: Cannot find module 'jszip'
  Require stack: pptxgen.cjs.js → generator.js → generate-flow.js → main.js

根因（已用证据定位）
1. electron-builder 的 smartUnpack 把 node_modules/jszip 单独解包到
   resources/app.asar.unpacked/（asar 头部里只有 jszip 被标记 unpacked）。
   于是应用依赖 asar 之外的文件：便携版把程序解压到 %TEMP% 后一旦这一步不完整
   （上次运行退出时删了一半 / 被杀软拦下 / 被强杀），jszip 就找不到了。
   现场证据：出问题的解包目录只剩 12 个文件（完整应为 126 个），
   缺 chrome_100_percent.pak、resources.pak、locales/、app.asar.unpacked/；
   debug.log 里明确有 "Failed to load chrome_100_percent.pak / resources.pak"。
2. jszip 只作为 pptxgenjs 的传递依赖存在，而 main/pptx-post.js 是直接 require 它的。

修复
- build.asar.smartUnpack = false：所有依赖留在单个 app.asar 内，
  产物里不再有 app.asar.unpacked（14.22MB 单文件，原子性更好）
- package.json 显式声明 jszip 依赖
- 启动自检：缺依赖时弹中文提示（缺什么、临时解压目录在哪、三条解决办法），
  而不是甩一句没有上下文的 Uncaught Exception；先自检再建窗口
- portable.unpackDirName = "AIPPT-${version}"：解压目录带版本号，新版本不复用旧残留
- README 增加「便携版打不开？先看这里」排查章节

验证
- 打包产物自检新增 asarHasDeps / hasUnpacked 断言：asarHasDeps=true、hasUnpacked=false
- 新增 test/package-tests.js（8 项：依赖自检 / smartUnpack / files 白名单 / 解压目录名 /
  启动提示代码路径），并纳入 README 测试清单
- 模拟缺模块实测：日志输出 AIPPT_STARTUP_ERROR 并弹出中文提示，等待用户确认后退出(1)
- 全量回归：核心 119 + 文献 61 + 样式 29 + v2.2 E2E 26 + 功能 E2E 21 + LaTeX E2E 38 + 打包自检，全绿
'@
git -c user.name="AIPPT" -c user.email="aippt@local" commit -q -m $msg
git tag -d v2.2.1 | Out-Null
git -c user.name="AIPPT" -c user.email="aippt@local" tag -a v2.2.1 -m "AIPPT v2.2.1：左右栏独立滚动、预览框不溢出、默认示例 beamer-demo、便携版打包加固"
git log --oneline -3
git tag -l -n1
Write-Host ('未提交文件数: ' + (git status --porcelain | Measure-Object).Count)
