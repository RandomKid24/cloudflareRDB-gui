# generate-icons.ps1
# Generates all required icon sizes from a 1024x1024 source PNG
# Requires .NET System.Drawing (built-in on Windows)

param(
    [string]$SourcePng = "$PSScriptRoot\..\resources\icons\icon.png"
)

Add-Type -AssemblyName System.Drawing

$iconsDir = "$PSScriptRoot\..\resources\icons"
$sourcePath = (Resolve-Path $SourcePng).Path

Write-Host "Source icon: $sourcePath"
Write-Host "Icons directory: $iconsDir"

# Load source image
$srcImage = [System.Drawing.Image]::FromFile($sourcePath)
Write-Host "Source size: $($srcImage.Width)x$($srcImage.Height)"

# Sizes needed for Linux (electron-builder picks these up from the icons/ directory)
$linuxSizes = @(16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)

foreach ($size in $linuxSizes) {
    $outPath = "$iconsDir\${size}x${size}.png"
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($srcImage, 0, 0, $size, $size)
    $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "  Created: ${size}x${size}.png"
}

# Generate Windows ICO (multi-size: 16, 24, 32, 48, 64, 128, 256)
# ICO format: header + directory + bitmap data
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$icoPath = "$iconsDir\icon.ico"

$pngDataList = @()
foreach ($size in $icoSizes) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($srcImage, 0, 0, $size, $size)
    
    $ms = New-Object System.IO.MemoryStream
    $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngDataList += , $ms.ToArray()
    $ms.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

# Build ICO binary
$ms = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($ms)

# ICO Header
$writer.Write([uint16]0)        # reserved
$writer.Write([uint16]1)        # type: 1 = ICO
$writer.Write([uint16]$icoSizes.Count)  # count

# Calculate offset: header(6) + directory entries (16 * count)
$dataOffset = 6 + (16 * $icoSizes.Count)

# Directory entries
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
    $size = $icoSizes[$i]
    $data = $pngDataList[$i]
    $w = if ($size -ge 256) { 0 } else { [byte]$size }
    $h = if ($size -ge 256) { 0 } else { [byte]$size }
    $writer.Write([byte]$w)         # width (0 = 256)
    $writer.Write([byte]$h)         # height (0 = 256)
    $writer.Write([byte]0)          # color count (0 = no palette)
    $writer.Write([byte]0)          # reserved
    $writer.Write([uint16]1)        # color planes
    $writer.Write([uint16]32)       # bits per pixel
    $writer.Write([uint32]$data.Length)  # size of image data
    $writer.Write([uint32]$dataOffset)   # offset of image data
    $dataOffset += $data.Length
}

# Image data
foreach ($data in $pngDataList) {
    $writer.Write($data)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$writer.Dispose()
$ms.Dispose()

Write-Host ""
Write-Host "  Created: icon.ico (multi-size: $($icoSizes -join ', '))"
Write-Host ""
Write-Host "Done! All icons generated in: $iconsDir"

$srcImage.Dispose()
