# 生成 PWA 应用图标（PNG）：蓝色圆角背景 + 白色"志"字 + 白色爱心
# 运行：pwsh make-icons.ps1  （输出到 icons/ 目录）
Add-Type -AssemblyName System.Drawing

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $scale = $size / 512.0

  # 背景：蓝色圆角矩形（#2563eb）
  $bgColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
  $radius = [int](48 * $scale)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $p.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $p.AddArc($rect.X + $rect.Width - $d, $rect.Y, $d, $d, 270, 90)
  $p.AddArc($rect.X + $rect.Width - $d, $rect.Y + $rect.Height - $d, $d, $d, 0, 90)
  $p.AddArc($rect.X, $rect.Y + $rect.Height - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
  $g.FillPath($bgBrush, $p)

  # 白色"志"字
  $fontSize = [float](205 * $scale)
  $font = New-Object System.Drawing.Font('Microsoft YaHei', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF(0, [float](52 * $scale), $size, [float](288 * $scale))
  $g.DrawString('志', $font, $white, $textRect, $sf)

  # 白色爱心（右下）
  $cx = [float](330 * $scale); $cy = [float](392 * $scale); $r = [float](54 * $scale)
  $g.FillEllipse($white, $cx - 2 * $r, $cy - $r, 2 * $r, 2 * $r)
  $g.FillEllipse($white, $cx, $cy - $r, 2 * $r, 2 * $r)
  $pts = [System.Drawing.PointF[]]::new(3)
  $pts[0] = [System.Drawing.PointF]::new(($cx - 2.0 * $r), $cy)
  $pts[1] = [System.Drawing.PointF]::new(($cx + 2.0 * $r), $cy)
  $pts[2] = [System.Drawing.PointF]::new($cx, ($cy + 1.9 * $r))
  $g.FillPolygon($white, $pts)

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("生成图标: " + $path)
}

$dir = Join-Path $PSScriptRoot 'icons'
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}
New-Icon 192 (Join-Path $dir 'icon-192.png')
New-Icon 512 (Join-Path $dir 'icon-512.png')
