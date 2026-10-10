param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tempOutput = $Output + '.download'
Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $tempOutput -TimeoutSec 180
Move-Item -LiteralPath $tempOutput -Destination $Output -Force
