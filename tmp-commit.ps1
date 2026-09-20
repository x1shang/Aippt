$ErrorActionPreference = 'Continue'
Set-Location E:\dsh\exe\aippt
git add -A
$msg = @'
fix(ui): 修复大纲预览框被撑破 + 默认示例改为 beamer-demo（v2.2.1）

用户反馈：改成独立滚动后，大纲直接顶出了预览框。

根因
- 两侧面板是 flex 纵列，子卡片默认 flex-shrink:1 —— 内容超高时浏览器会去"压扁卡片"而不是滚动，
  卡片被压扁后内容就溢出到边框外；上一版还把 .preview-body 的 overflow-y:auto 改成了 visible，
  两件事叠加就是"大纲顶出预览框"。

修复
- .panel-left > * / .panel-right > * { flex: 0 0 auto }：卡片永不压缩，面板老老实实滚动
- 恢复 .preview-body 框内滚动（overflow-y:auto + overscroll-behavior:contain），
  并给 .preview-card 加高度上限 calc(100vh - 120px)：外层面板滚动与框内滚动并存
- body 不滚动、左右两栏各自滚动（保留 v2.2.1 的隔离目标）

默认示例
- 默认示例改为 examples/beamer-demo.md，并带上文件路径（references.bib 与相对图片可解析）
- 新增「全功能示例」按钮切到 examples/showcase.md
- beamer-demo.md 补上 \tableofcontents、引用说明、排版细节、图片写法说明
- 顺带修掉：行内代码里的图片语法 `![](x.png)` 被当成真图片而报"图片未找到"

自检
- 冒烟测试新增 UI 断言：body 不滚动、两栏与预览框均为独立滚动容器、滚左栏不影响右侧、
  滚预览框不影响左栏、大纲在卡片内、卡片在视口内、框内可滚动
- 新增 test/ui-shot.js：界面截图 + 结构探针 → test/out/ui-preview.png
- 打包产物自检通过：independent / outlineInsideCard / bodyScrollable 全 true，styles 9，previewCount 12
- 构建改为离线 electronDist（本机代理关闭时也能打包）
'@
git -c user.name="AIPPT" -c user.email="aippt@local" commit -q -m $msg
git tag -d v2.2.0 | Out-Null
git tag -d v2.2.1 2>$null | Out-Null
git -c user.name="AIPPT" -c user.email="aippt@local" tag -a v2.2.1 -m "AIPPT v2.2.1：左右栏独立滚动 + 大纲预览框不溢出 + 默认示例改用 beamer-demo"
git log --oneline -3
git tag -l -n1
Write-Host ("工作树未提交文件数: " + (git status --porcelain | Measure-Object).Count)
