<#
  test/wps-anim-probe.ps1
  在**真实放映器**里验证「点击出现」动画：
    COM 打开 pptx → 从指定页全屏放映 → 等幻灯片真正显示出来 → 用真鼠标点屏幕中央 →
    每次点击后截屏，统计幻灯片区域内的墨迹像素。条目真的出现时墨迹应逐次增加。

  用法（在 aippt 目录下执行）：
    pwsh -File test\wps-anim-probe.ps1 -Pptx test\out\anim-probe.pptx -Slide 2 -Clicks 3
    pwsh -File test\wps-anim-probe.ps1 -Pptx ... -AppProgId PowerPoint.Application   # 有真 PowerPoint 时
#>
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [int]$Slide = 2,
  [int]$Clicks = 3,
  [string]$AppProgId = 'KWPP.Application',
  [string]$OutDir = 'test\out\probe',
  [int]$WaitMs = 1400
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
# 不要加载 System.Windows.Forms：它会改变线程公寓状态，导致 Office/WPS 的 COM 拿到 null 代理
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ProbeInput {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);   // LEFTDOWN
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);   // LEFTUP
  }
  public static void PressEsc() {
    keybd_event(0x1B, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    keybd_event(0x1B, 0, 2, UIntPtr.Zero);
  }
}
"@ -ErrorAction SilentlyContinue

$pptxPath = (Resolve-Path -LiteralPath $Pptx).Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outPath = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

function Measure-Ink([System.Drawing.Bitmap]$bmp) {
  # 只看屏幕中央区域（避开黑边/任务栏），统计暗像素（正文/公式）
  $x0 = [int]($bmp.Width * 0.10); $x1 = [int]($bmp.Width * 0.90)
  $y0 = [int]($bmp.Height * 0.10); $y1 = [int]($bmp.Height * 0.90)
  $dark = 0; $white = 0; $total = 0
  for ($y = $y0; $y -lt $y1; $y += 2) {
    for ($x = $x0; $x -lt $x1; $x += 2) {
      $c = $bmp.GetPixel($x, $y)
      $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($lum -lt 180) { $dark++ }
      if ($lum -gt 235) { $white++ }
      $total++
    }
  }
  return @{ dark = $dark; white = $white; total = $total; whitePct = [math]::Round(100.0 * $white / $total, 1) }
}

function Get-Screen() {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
  $g.Dispose()
  return $bmp
}

function Snap([string]$name, [System.Collections.ArrayList]$results, [int]$clickNo) {
  $bmp = Get-Screen
  $ink = Measure-Ink $bmp
  $p = Join-Path $outPath $name
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $results.Add([pscustomobject]@{ click = $clickNo; dark = $ink.dark; whitePct = $ink.whitePct; shot = $p }) | Out-Null
  Write-Host ("  点击 {0} 次后：正文墨迹 {1}（白底占比 {2}%）" -f $clickNo, $ink.dark, $ink.whitePct)
  return $ink.dark
}

Write-Host "== 打开 $pptxPath =="
# ⚠️ 坑：参数名不要用 $App —— [string]$App 的类型约束会在 `$app = New-Object -ComObject ...`
# 赋值时把 COM 对象强制转回字符串（PowerShell 变量名不区分大小写），COM 对象直接丢失。
$wps = New-Object -ComObject $AppProgId
Start-Sleep -Milliseconds 800
$opened = $false
$pres = $null
$lastErr = ''
for ($try = 1; $try -le 12; $try++) {
  try {
    $pres = $wps.Presentations.Open($pptxPath, $true, $false, $true)
    $nm = $pres.Name
    if ($nm) { $opened = $true; break }
  } catch { $lastErr = $_.Exception.Message }
  Start-Sleep -Milliseconds 600
}
if (-not $opened) { Write-Host "!! 打开失败（$AppProgId COM 未就绪）：$lastErr"; exit 1 }
Write-Host "  已打开：$($pres.Name)，共 $($pres.Slides.Count) 页"

Write-Host "== 从第 $Slide 页开始放映 =="
$pres.SlideShowSettings.StartingSlide = $Slide
$pres.SlideShowSettings.Run() | Out-Null

# 等幻灯片真的画出来（白底占比高）再开始点，否则第一下会点空
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$cx = $vs.X + [int]($vs.Width / 2)
$cy = $vs.Y + [int]($vs.Height / 2)
$ready = $false
for ($t = 0; $t -lt 30; $t++) {
  Start-Sleep -Milliseconds 400
  $bmp = Get-Screen
  $ink = Measure-Ink $bmp
  $bmp.Dispose()
  if ($ink.whitePct -gt 40) { $ready = $true; break }
}
Write-Host ("  放映就绪：{0}（等待 {1} 次轮询）" -f $ready, ($t + 1))
Start-Sleep -Milliseconds 400

$results = New-Object System.Collections.ArrayList
$null = Snap 'state-0.png' $results 0

for ($i = 1; $i -le $Clicks; $i++) {
  [ProbeInput]::Click($cx, $cy)
  Start-Sleep -Milliseconds $WaitMs
  $null = Snap "state-$i.png" $results $i
}

Write-Host ""
Write-Host "== 判定（以第 0 次为基线）=="
$base = $results[0].dark
$grew = 0
for ($i = 1; $i -lt $results.Count; $i++) {
  $d = $results[$i].dark - $base
  $pct = if ($base -gt 0) { [math]::Round(100.0 * $d / $base, 2) } else { 0 }
  $isGrow = $d -gt ($base * 0.05)
  $verdict = if ($isGrow) { '内容增加 ✔' } else { '无变化 ✘' }
  Write-Host ("  第 {0} 次点击：正文墨迹 +{1}（{2}%）{3}" -f $results[$i].click, $d, $pct, $verdict)
  if ($isGrow) { $grew++ }
}
Write-Host "  结论：$grew / $Clicks 次点击产生了新内容"
Write-Host "  截图：$outPath"

# 收尾：退出放映 + 只关这份文档（不影响用户已打开的文件）
try { $wps.SlideShowWindows.Item(1).View.Exit() } catch { try { [ProbeInput]::PressEsc() } catch {} }
Start-Sleep -Milliseconds 500
try { $pres.Close() } catch {}
Write-Host "== 已退出放映并关闭探针文档 =="
