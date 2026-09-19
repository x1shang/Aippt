# 点击出现动画：两个真实 bug 与验证方法

> 结论先说：v2.2 交付时的"点击出现动画"**在真实放映器里完全不工作**（能点击、但什么都不出现）。
> 现已修复，并在**本机真实 WPS 放映**里验证通过。本文记录根因、验证方法与被证伪的假设，避免以后再踩。

---

## 1. 症状

用户反馈：动画那一页"可以点击多次，但是没有新增条目出现"。

用自动化探针复现后确认：

```
点击 0 次后：正文墨迹 583675      ← 一开始就把这一页显示出来了
点击 1 次后：正文墨迹 6242        ← 幻灯片正常显示（只有第 1 条）
点击 2 次后：正文墨迹 6242        ← 点了，没变化
点击 3 次后：正文墨迹 6242        ← 点了，没变化
```

对照物（让 WPS 自己生成一份带动画的 pptx）却是正常的：`2309 → 5272 → 8226`，且
`SlideShowView.GetClickCount()` 返回 2（我们自己的稿子是 **0**）。

---

## 2. 根因一：动画条目缺 `<p:bldLst>`

`<p:timing>` 里除了时间树，**还必须有一个构建列表**，告诉放映器"这些形状有动画条目"：

```xml
<p:timing>
  <p:tnLst>…（时间树，和放映器自己写的一模一样）…</p:tnLst>
  <p:bldLst>                       <!-- ← 之前漏掉的就是这段 -->
    <p:bldP spid="6" grpId="0"/>
    <p:bldP spid="7" grpId="0"/>
  </p:bldLst>
</p:timing>
```

没有它：`GetClickCount()` = 0，点击只会推进幻灯片，不会触发任何"出现"效果。

**验证方法（很关键）**：不要凭记忆写动画 XML。让**真实放映器自己生成一份**当参照物，再逐字节对比：

```powershell
pwsh -File test\wps-make-oracle.ps1                  # 用 WPS COM 生成带"出现"动画的 pptx
python E:\dsh\exe\mathpoc\diff-timing.py test\out\oracle-wps.pptx test\out\anim-probe.pptx
# → 归一化 id/spid 后差异 0 行 = 结构一致（修复后就是这个结果）
```

---

## 3. 根因二：剥离动画标记的正则跨了 run，把正文一起吃掉了

生成期为了标注"这条要点属于第几步"，会往文本框里塞一个不可见的标记 run `⟦ANIM:2⟧`，
生成后再摘掉。原来的剥离写法是一个跨 run 的正则：

```js
// ❌ 错误写法
xml.replace(/<a:r>\s*<a:rPr[\s\S]*?<\/a:rPr>\s*<a:t[^>]*>⟦ANIM:\d+⟧<\/a:t>\s*<\/a:r>/g, '')
```

PptxGenJS 的段落长这样（**每个 run 前都插了一段 `<a:pPr>`**）：

```xml
<a:p>
  <a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:rPr/><a:t>▪  </a:t></a:r>
  <a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:rPr/><a:t>【B】第一次点击后出现</a:t></a:r>
  <a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:rPr/><a:t>⟦ANIM:2⟧</a:t></a:r>
  <a:endParaRPr/>
</a:p>
```

`<a:r>…[\s\S]*?…⟦ANIM:2⟧…</a:r>` 会从**第一个** `<a:r>` 一路吃到标记所在的 run —— 于是
"要点文字"被整段删掉，形状变成**空文本框**：能点，但点出来什么都没有。

修复：按 run 边界逐个扫描（`main/pptx-post.js` 的 `stripAnimMarkers`），只删含标记的那个 run；
若同一 run 里还有别的文字，只删标记文本。

**回归测试**（`test/e2e-v22.js`）现在会断言：
- 每个被"点出来"的形状里**必须还有非空文字**；
- 同一形状里**不能再残留** `⟦ANIM:`；
- `<p:bldLst>` 必须存在；
- 每个 `spid` 目标必须真实存在。

---

## 4. 被证伪的假设（省得后面重走弯路）

| 猜测 | 实测结论 |
| --- | --- |
| "PowerPoint 需要显式把形状先隐藏" | ✗ 不需要，`presetClass="entr"` 的进入效果本身就意味着"出现前不可见" |
| "cTn 的 id 必须连续" | 不是根因（但已改成连续，与放映器一致） |
| "WPS 不支持 p:timing" | ✗ WPS 支持得很好——它自己生成的动画稿跑得完全正常，问题在我们写的 XML |
| "缺少 `mc:Fallback` 之类" | ✗ 与动画无关 |

---

## 5. 在本机真实放映器里验证（可复现）

```powershell
cd E:\dsh\exe\aippt
node test/probe-animation.js                     # 生成最小动画探针（2 页）
pwsh -File test\wps-anim-diag.ps1  -Pptx test\out\anim-probe.pptx -Slide 2 -Steps 3
pwsh -File test\wps-anim-probe.ps1 -Pptx test\out\anim-probe.pptx -Slide 2 -Clicks 3
```

修复后的实测输出：

```
== anim-probe（第 2 页）==
  step0  幻灯片=2  动画点击数=2  当前点击序号=0  正文墨迹=5287     ← 只有第 1 条
  step1  幻灯片=2  动画点击数=2  当前点击序号=1  正文墨迹=6741     ← 第 2 条出现
  step2  幻灯片=2  动画点击数=2  当前点击序号=2  正文墨迹=8315     ← 第 3 条出现
```

`GetClickCount` 是最硬的证据：它由放映器自己解析动画模型得出，**0 = 动画没被识别**。

### 脚本坑（都是这次踩出来的）

1. **不要把 COM 对象赋给带类型约束的参数同名变量**：
   `param([string]$App = 'KWPP.Application')` 之后写 `$app = New-Object -ComObject $App`，
   因为 PowerShell 变量名大小写不敏感，`$app` 会被 `[string]` 约束**强制转回字符串**，
   然后所有 COM 调用都报"不能对值为 Null 的表达式调用方法"。改用 `$wps` 之类独立变量名。
2. **不要 `Add-Type -AssemblyName System.Windows.Forms`**：加载 WinForms 会改变线程公寓状态，
   让 Office/WPS 的 COM 拿到空代理；发送按键改用 `keybd_event`（`test\wps-anim-probe.ps1` 里有现成实现）。
3. **WPS 会忽略 `SlideShowSettings.StartingSlide`**：放映开始后用 `View.GotoSlide(n)` 跳页。
4. **截屏量"墨迹"比让视觉模型看图更可靠**：统计幻灯片区域内亮度 < 180 的像素数，
   条目出现时必然会增加；视觉模型（本机 qwen2.5vl）对界面细节的判断并不可靠。
