param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.env')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ConfigPath)) {
  Copy-Item -Path (Join-Path $PSScriptRoot 'config.example.env') -Destination $ConfigPath
  Write-Host "[client] 已生成配置文件：$ConfigPath"
}
else {
  Write-Host "[client] 配置文件已存在：$ConfigPath"
}

Write-Host "[client] 接下来请编辑 $ConfigPath"
Write-Host '[client] 然后执行：powershell -ExecutionPolicy Bypass -File .\client\run-update.ps1'
