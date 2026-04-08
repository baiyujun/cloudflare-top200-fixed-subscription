param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.env')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-ClientLog {
  param([string]$Message)
  Write-Host "[client] $Message"
}

function Get-InstallDir {
  if ($env:SUBUP_INSTALL_DIR) {
    return $env:SUBUP_INSTALL_DIR
  }

  $windowsApps = Join-Path $HOME 'AppData\Local\Microsoft\WindowsApps'
  if (Test-Path $windowsApps) {
    return $windowsApps
  }

  return (Join-Path $HOME '.local\bin')
}

function Ensure-UserPath {
  param([string]$InstallDir)

  $currentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ';' | Where-Object { $_ }
  }

  if ($parts -notcontains $InstallDir) {
    $nextPath = if ($currentUserPath) { "$currentUserPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
  }

  if (($env:Path -split ';') -notcontains $InstallDir) {
    $env:Path = "$InstallDir;$env:Path"
  }
}

function Install-SubupCommand {
  param(
    [string]$InstallDir,
    [string]$ConfigPath
  )

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $cmdPath = Join-Path $InstallDir 'subup.cmd'
  $ps1Path = Join-Path $InstallDir 'subup.ps1'
  $runScript = Join-Path $PSScriptRoot 'run-update.ps1'

  @"
@echo off
powershell -ExecutionPolicy Bypass -File "$runScript" "$ConfigPath" %*
"@ | Set-Content -Path $cmdPath -Encoding ASCII

  @"
& "$runScript" "$ConfigPath" @args
"@ | Set-Content -Path $ps1Path -Encoding UTF8

  Ensure-UserPath -InstallDir $InstallDir
  return $cmdPath
}

if (-not (Test-Path $ConfigPath)) {
  Copy-Item -Path (Join-Path $PSScriptRoot 'config.example.env') -Destination $ConfigPath
  Write-ClientLog "已生成配置文件：$ConfigPath"
}
else {
  Write-ClientLog "配置文件已存在：$ConfigPath"
}

$installDir = Get-InstallDir
$commandPath = Install-SubupCommand -InstallDir $installDir -ConfigPath $ConfigPath

Write-Host ''
Write-Host '初始化完成'
Write-Host "- 配置文件：$ConfigPath"
Write-Host "- 全局命令：$commandPath"
Write-Host ''
Write-Host '下一步：'
Write-Host '1. 编辑 config.env'
Write-Host '2. 填写 WORKER_BASE_URL / ADMIN_TOKEN'
Write-Host '3. 在任意目录执行：subup'
