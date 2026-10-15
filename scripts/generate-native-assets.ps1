Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'public/icons/icon-512.png'
$sourceIcon = [System.Drawing.Image]::FromFile($sourcePath)
$png = [System.Drawing.Imaging.ImageFormat]::Png

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $stream = [System.IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, $png)
    [System.IO.File]::WriteAllBytes($path, $stream.ToArray())
  } finally {
    $stream.Dispose()
  }
}

function New-Canvas([int]$width, [int]$height) {
  return [System.Drawing.Bitmap]::new($width, $height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return $graphics
}

function Save-Icon([string]$path, [int]$size, [bool]$round) {
  $bitmap = New-Canvas $size $size
  $graphics = New-Graphics $bitmap
  if ($round) {
    $graphics.Clear([System.Drawing.Color]::Transparent)
  } else {
    # Apple rejects app icons with an alpha channel in their visible pixels.
    # Filling first also keeps the Android legacy icon opaque after resizing.
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#d85c93'))
  }
  if ($round) {
    $clip = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $clip.AddEllipse(0, 0, $size, $size)
    $graphics.SetClip($clip)
    $clip.Dispose()
  }
  $graphics.DrawImage($sourceIcon, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
  Save-Png $bitmap $path
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Point([double]$x, [double]$y, [double]$size) {
  $scale = $size / 108
  return [System.Drawing.PointF]::new([float]((19 + 70 * $x / 512) * $scale),
    [float]((19 + 70 * $y / 512) * $scale))
}

function Save-Foreground([string]$path, [int]$size) {
  $bitmap = New-Canvas $size $size
  $graphics = New-Graphics $bitmap
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $softWhite = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
  $main = [System.Drawing.PointF[]]@(
    (Point 256 112 $size), (Point 290 194 $size),
    (Point 373 229 $size), (Point 290 264 $size),
    (Point 256 346 $size), (Point 222 264 $size),
    (Point 139 229 $size), (Point 222 194 $size)
  )
  $small = [System.Drawing.PointF[]]@(
    (Point 373 328 $size), (Point 384 360 $size),
    (Point 416 371 $size), (Point 384 382 $size),
    (Point 373 414 $size), (Point 362 382 $size),
    (Point 330 371 $size), (Point 362 360 $size)
  )
  $graphics.FillPolygon($white, $main)
  $graphics.FillPolygon($softWhite, $small)
  $dot = Point 120 352 $size
  $diameter = [float](26 * 70 / 512 * $size / 108)
  $graphics.FillEllipse($softWhite, $dot.X, $dot.Y, $diameter, $diameter)
  Save-Png $bitmap $path
  $softWhite.Dispose()
  $white.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-Splash([string]$path, [int]$width, [int]$height) {
  $bitmap = New-Canvas $width $height
  $graphics = New-Graphics $bitmap
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#fff8fb'))
  $size = [int][Math]::Round([Math]::Min($width, $height) * 0.23)
  $x = [int](($width - $size) / 2)
  $y = [int](($height - $size) / 2)
  $graphics.DrawImage($sourceIcon, [System.Drawing.Rectangle]::new($x, $y, $size, $size))
  Save-Png $bitmap $path
  $graphics.Dispose()
  $bitmap.Dispose()
}

try {
  $iosIcon = Join-Path $projectRoot 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'
  Save-Icon $iosIcon 1024 $false
  $androidRes = Join-Path $projectRoot 'android/app/src/main/res'
  foreach ($density in @(
    @{ name = 'mdpi'; icon = 48; foreground = 108 },
    @{ name = 'hdpi'; icon = 72; foreground = 162 },
    @{ name = 'xhdpi'; icon = 96; foreground = 216 },
    @{ name = 'xxhdpi'; icon = 144; foreground = 324 },
    @{ name = 'xxxhdpi'; icon = 192; foreground = 432 }
  )) {
    $folder = Join-Path $androidRes "mipmap-$($density.name)"
    Save-Icon (Join-Path $folder 'ic_launcher.png') $density.icon $false
    Save-Icon (Join-Path $folder 'ic_launcher_round.png') $density.icon $true
    Save-Foreground (Join-Path $folder 'ic_launcher_foreground.png') $density.foreground
  }

  $iosSplash = Join-Path $projectRoot 'ios/App/App/Assets.xcassets/Splash.imageset'
  foreach ($name in @('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png')) {
    Save-Splash (Join-Path $iosSplash $name) 2732 2732
  }
  foreach ($file in Get-ChildItem -LiteralPath $androidRes -Recurse -Filter 'splash.png') {
    $current = [System.Drawing.Image]::FromFile($file.FullName)
    $width, $height = $current.Width, $current.Height
    $current.Dispose()
    Save-Splash $file.FullName $width $height
  }
} finally {
  $sourceIcon.Dispose()
}
