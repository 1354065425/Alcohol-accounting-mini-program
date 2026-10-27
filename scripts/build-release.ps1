$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = Join-Path $projectRoot 'release'
[System.IO.Directory]::CreateDirectory($releaseDir) | Out-Null
$archivePath = Join-Path $releaseDir 'zhenjiuge-v1.0.0.zip'
$included = @('app.js','app.json','app.wxss','project.config.json','sitemap.json','pages','components','utils','assets')
$sourcePaths = $included | ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $sourcePaths -DestinationPath $archivePath -Force
Write-Output $archivePath
