Add-Type -AssemblyName System.Drawing

$srcPath = "resources/icons/logo.png"
$destPath = "resources/icons/icon.png"

$bmp = New-Object System.Drawing.Bitmap($srcPath)

# Find bounding box
$minX = $bmp.Width
$maxX = 0
$minY = $bmp.Height
$maxY = 0

for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
        $pixel = $bmp.GetPixel($x, $y)
        if ($pixel.A -gt 10) { # Non-transparent
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

$width = $maxX - $minX + 1
$height = $maxY - $minY + 1

Write-Host "Graphic bounds: X=$minX to $maxX ($width px), Y=$minY to $maxY ($height px)"

# Determine size of square that fits the graphic
$maxDim = [Math]::Max($width, $height)

# Add padding (e.g., 8% of the dimension)
$padding = [int]($maxDim * 0.08)
$targetDim = $maxDim + ($padding * 2)

# Calculate crop source rectangle centered on the graphic
$centerX = $minX + [int]($width / 2)
$centerY = $minY + [int]($height / 2)

$srcX = $centerX - [int]($targetDim / 2)
$srcY = $centerY - [int]($targetDim / 2)

# Adjust if out of original bounds
if ($srcX -lt 0) { $srcX = 0 }
if ($srcY -lt 0) { $srcY = 0 }
if ($srcX + $targetDim -gt $bmp.Width) { $targetDim = $bmp.Width - $srcX }
if ($srcY + $targetDim -gt $bmp.Height) { $targetDim = $bmp.Height - $srcY }

Write-Host "Cropping square at ($srcX, $srcY) with size ${targetDim}x${targetDim}..."

# Create new cropped bitmap (target size 1024x1024)
$destDim = 1024
$croppedBmp = New-Object System.Drawing.Bitmap($destDim, $destDim)
$graphics = [System.Drawing.Graphics]::FromImage($croppedBmp)

$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

$srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $targetDim, $targetDim)
$destRect = New-Object System.Drawing.Rectangle(0, 0, $destDim, $destDim)

$graphics.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$graphics.Dispose()
$bmp.Dispose()

# Save cropped image
$croppedBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
$croppedBmp.Dispose()

Write-Host "Cropped image saved successfully to $destPath"
