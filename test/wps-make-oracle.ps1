<#
  test/wps-make-oracle.ps1
  让 WPS（或 PowerPoint）**自己**做一个带「出现」动画的 pptx，作为 XML 参照物（oracle）。
  用它生成的 <p:timing> 对比我们自己写的动画 XML，就能知道差在哪。

  用法：pwsh -File test/wps-make-oracle.ps1
  产物：test/out/oracle-wps.pptx
#>
param(
  [string]$AppProgId = 'KWPP.Application',
  [string]$Out = 'test\out\oracle-wps.pptx'
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outPath = Join-Path $repoRoot $Out
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null
if (Test-Path $outPath) { Remove-Item $outPath -Force }

$wps = New-Object -ComObject $AppProgId
Start-Sleep -Milliseconds 800
$pres = $wps.Presentations.Add($true)
Start-Sleep -Milliseconds 600
# 空白版式（ppLayoutBlank = 12）
$slide = $pres.Slides.Add(1, 12)
Write-Host "新建放映稿，页数=$($pres.Slides.Count)"

function Add-Box($slide, $text, $top, $left = 80) {
  $sh = $slide.Shapes.AddTextbox(1, $left, $top, 600, 60)   # msoTextOrientationHorizontal = 1
  $sh.TextFrame.TextRange.Text = $text
  $sh.TextFrame.TextRange.Font.Size = 24
  return $sh
}

$s1 = Add-Box $slide '【A】一开始就可见' 80
$s2 = Add-Box $slide '【B】第一次点击后出现' 180
$s3 = Add-Box $slide '【C】第二次点击后出现' 280
Write-Host "已放置 3 个文本框"

# 给 B、C 加"出现"进入动画（msoAnimEffectAppear = 1，触发器 msoAnimTriggerOnPageClick = 1）
$added = 0
foreach ($sh in @($s2, $s3)) {
  try {
    $eff = $slide.TimeLine.MainSequence.AddEffect($sh, 1, 0, 1)
    Write-Host "  已加动画：$($eff.EffectType) 触发器=$($eff.Timing.TriggerType)"
    $added++
  } catch {
    Write-Host "  AddEffect 失败：$($_.Exception.Message)"
  }
}
if ($added -eq 0) {
  Write-Host "TimeLine API 不可用，改试 AnimationSettings.EntryEffect（ppEffectAppear = 3844）"
  foreach ($sh in @($s2, $s3)) {
    try {
      $sh.AnimationSettings.EntryEffect = 3844
      $sh.AnimationSettings.AdvanceMode = 1
      Write-Host "  已设置 EntryEffect"
      $added++
    } catch { Write-Host "  AnimationSettings 失败：$($_.Exception.Message)" }
  }
}

# ppSaveAsOpenXMLPresentation = 24
try { $pres.SaveAs($outPath, 24); Write-Host "已保存：$outPath" } catch { Write-Host "SaveAs 失败：$($_.Exception.Message)" }
try { $pres.Close() } catch {}
Write-Host "完成，动画条目数=$added"
