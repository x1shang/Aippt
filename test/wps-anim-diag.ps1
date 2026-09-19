<#
  test/wps-anim-diag.ps1
  用放映器的 API 直接问它"这一页有几个点击动画步骤"：
    SlideShowView.GetClickCount() / GetClickIndex() —— PowerPoint/WPS 都有。
    GetClickCount 为 0 说明动画根本没被识别（点得动但什么都不出现就是这个原因）。
  同时每步截一张图，便于人工/视觉模型复核。

  用法：pwsh -File test\wps-anim-diag.ps1 -Pptx test\out\anim-probe.pptx -Slide 2
#>
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [int]$Slide = 1,
  [int]$Steps = 3,
  [string]$AppProgId = 'KWPP.Application',
  [string]$OutDir = 'test\out\diag'
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DiagInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void PressEsc() { keybd_event(0x1B, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }
}
"@ -ErrorAction SilentlyContinue

$pptxPath = (Resolve-Path -LiteralPath $Pptx).Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outPath = Join-Path $repoRoot $OutDir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null
$tag = [System.IO.Path]::GetFileNameWithoutExtension($pptxPath)

function Get-Screen() {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size); $g.Dispose()
  return $bmp
}
function Ink([System.Drawing.Bitmap]$bmp) {
  $x0 = [int]($bmp.Width * 0.10); $x1 = [int]($bmp.Width * 0.90)
  $y0 = [int]($bmp.Height * 0.10); $y1 = [int]($bmp.Height * 0.90)
  $dark = 0
  for ($y = $y0; $y -lt $y1; $y += 2) { for ($x = $x0; $x -lt $x1; $x += 2) {
      $c = $bmp.GetPixel($x, $y); $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B; if ($lum -lt 180) { $dark++ } } }
  return $dark
}

$wps = New-Object -ComObject $AppProgId
Start-Sleep -Milliseconds 800
$pres = $null
for ($t = 1; $t -le 12; $t++) {
  try { $pres = $wps.Presentations.Open($pptxPath, $true, $false, $true); if ($pres.Name) { break } } catch {}
  Start-Sleep -Milliseconds 600
}
if (-not $pres -or -not $pres.Name) { Write-Host '!! 打开失败'; exit 1 }

$pres.SlideShowSettings.StartingSlide = $Slide
$pres.SlideShowSettings.Run() | Out-Null
Start-Sleep -Milliseconds 2500

$view = $null
for ($t = 1; $t -le 10; $t++) {
  try { $view = $wps.SlideShowWindows.Item(1).View; if ($view) { break } } catch {}
  Start-Sleep -Milliseconds 500
}
# WPS 会忽略 SlideShowSettings.StartingSlide，放映开始后用 GotoSlide 直接跳过去
try { $view.GotoSlide($Slide) } catch { Write-Host "  GotoSlide 失败：$($_.Exception.Message)" }
Start-Sleep -Milliseconds 1500

Write-Host "== $tag（第 $Slide 页）=="
function Show-State([string]$label) {
  $cc = 'n/a'; $ci = 'n/a'; $pos = 'n/a'
  try { $cc = $view.GetClickCount() } catch { $cc = "错误:$($_.Exception.Message)" }
  try { $ci = $view.GetClickIndex() } catch { $ci = "错误:$($_.Exception.Message)" }
  try { $pos = $view.CurrentShowPosition } catch { $pos = "错误:$($_.Exception.Message)" }
  $bmp = Get-Screen; $ink = Ink $bmp
  $bmp.Save((Join-Path $outPath "$tag-$label.png"), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Host ("  {0,-16} 幻灯片={1}  动画点击数={2}  当前点击序号={3}  正文墨迹={4}" -f $label, $pos, $cc, $ci, $ink)
}

Show-State 'step0'
for ($i = 1; $i -le $Steps; $i++) {
  try { $view.Next() } catch { Write-Host "  Next() 失败：$($_.Exception.Message)" }
  Start-Sleep -Milliseconds 1200
  Show-State "step$i"
}

try { $view.Exit() } catch { try { [DiagInput]::PressEsc() } catch {} }
Start-Sleep -Milliseconds 500
try { $pres.Close() } catch {}
Write-Host "  截图目录：$outPath"
