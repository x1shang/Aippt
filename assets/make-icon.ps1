# make-icon.ps1
# 生成 assets/icon.ico（多尺寸 PNG 条目：256/128/64/48/32/16）
# 设计：渐变圆角方块 + 白色闪电
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'icon.ico'

$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = @{}

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int]($s * 0.04)
    $w = ($s - 2 * $pad - 1)
    $rect = New-Object System.Drawing.Rectangle($pad, $pad, $w, $w)
    $r = [int]($s * 0.22)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 79, 70, 229),
        [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
        45.0)
    $g.FillPath($brush, $path)

    # 白色闪电
    $bolt = New-Object System.Drawing.Drawing2D.GraphicsPath
    $u = $s / 24.0  # 单位长度
    $x1 = (13.2 * $u); $y1 = (3.2 * $u)
    $x2 = (6.6 * $u);  $y2 = (13.2 * $u)
    $x3 = (10.6 * $u); $y3 = (13.2 * $u)
    $x4 = (9.2 * $u);  $y4 = (20.8 * $u)
    $x5 = (17.4 * $u); $y5 = (10.0 * $u)
    $x6 = (13.2 * $u); $y6 = (10.0 * $u)
    $pts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF($x1, $y1)),
        (New-Object System.Drawing.PointF($x2, $y2)),
        (New-Object System.Drawing.PointF($x3, $y3)),
        (New-Object System.Drawing.PointF($x4, $y4)),
        (New-Object System.Drawing.PointF($x5, $y5)),
        (New-Object System.Drawing.PointF($x6, $y6))
    )
    $bolt.AddPolygon($pts)
    $bolt.CloseFigure()
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
    $g.FillPath($white, $bolt)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs[$s] = $ms.ToArray()
    $bmp.Dispose()
    Write-Host "rendered ${s}x${s}"
}

# 组装 ICO（Vista+ PNG 条目）
$ordered = @($sizes | Sort-Object -Descending)
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint16]0)          # reserved
$bw.Write([uint16]1)          # type: icon
$bw.Write([uint16]$ordered.Count)
$offset = 6 + 16 * $ordered.Count
foreach ($s in $ordered) {
    $data = $pngs[$s]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0)         # colors
    $bw.Write([byte]0)         # reserved
    $bw.Write([uint16]1)       # planes
    $bw.Write([uint16]32)      # bit count
    $bw.Write([uint32]$data.Length)
    $bw.Write([uint32]$offset)
    $offset += $data.Length
}
foreach ($s in $ordered) { $bw.Write($pngs[$s]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($outFile, $out.ToArray())
Write-Host "written: $outFile ($($out.ToArray().Length) bytes)"
