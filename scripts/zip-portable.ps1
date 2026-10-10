param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$info = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($info.source, $info.output, [System.IO.Compression.CompressionLevel]::Optimal, $false)
