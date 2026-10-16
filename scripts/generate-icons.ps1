param([switch] $Force)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourcePath = Join-Path $repoRoot 'assets/brand/nayla-icon-source.png'
$source = [System.Drawing.Image]::FromFile($sourcePath)
$stageDirectory = Join-Path $repoRoot '.tmp'
New-Item -ItemType Directory -Force -Path $stageDirectory | Out-Null

function Save-Icon([string] $relativePath, [int] $size) {
  $target = Join-Path $repoRoot $relativePath
  if ((Test-Path -LiteralPath $target) -and -not $Force) { return }
  $stagePath = Join-Path $stageDirectory ("nayla-icon-$([guid]::NewGuid().ToString('N')).png")
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#563943'))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $bitmap.Save($stagePath, [System.Drawing.Imaging.ImageFormat]::Png)
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    Copy-Item -LiteralPath $stagePath -Destination $target -Force
    Remove-Item -LiteralPath $stagePath -Force
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  Save-Icon 'public/icons/nayla-512.png' 512
  Save-Icon 'public/icons/nayla-192.png' 192
  Save-Icon 'public/nayla-touch-icon.png' 180
  Save-Icon 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-Nayla.png' 1024

  foreach ($density in @(
    @{ Name = 'mdpi'; Icon = 48; Foreground = 108 },
    @{ Name = 'hdpi'; Icon = 72; Foreground = 162 },
    @{ Name = 'xhdpi'; Icon = 96; Foreground = 216 },
    @{ Name = 'xxhdpi'; Icon = 144; Foreground = 324 },
    @{ Name = 'xxxhdpi'; Icon = 192; Foreground = 432 }
  )) {
    $folder = "android/app/src/main/res/mipmap-$($density.Name)"
    Save-Icon "$folder/ic_nayla.png" $density.Icon
    Save-Icon "$folder/ic_nayla_round.png" $density.Icon
    Save-Icon "$folder/ic_nayla_foreground.png" $density.Foreground
  }
} finally {
  $source.Dispose()
}
