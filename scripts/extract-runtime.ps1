param([Parameter(Mandatory=$true)][string]$Cache)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Expand-Archive -LiteralPath (Join-Path $Cache 'node.zip') -DestinationPath (Join-Path $Cache 'node') -Force
Expand-Archive -LiteralPath (Join-Path $Cache 'ffmpeg.zip') -DestinationPath (Join-Path $Cache 'ffmpeg') -Force
