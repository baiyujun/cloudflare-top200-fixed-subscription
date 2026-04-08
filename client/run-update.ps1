param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.env')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-ClientLog {
  param([string]$Message)
  Write-Host "[client] $Message"
}

function Fail-Client {
  param([string]$Message)
  throw "[client][error] $Message"
}

function Read-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    Fail-Client "配置文件不存在：$Path"
  }

  $map = @{}
  foreach ($rawLine in Get-Content -Path $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      continue
    }
    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    $value = if ($parts.Count -gt 1) { $parts[1].Trim() } else { '' }
    $map[$key] = $value
  }
  return $map
}

function Get-ConfigValue {
  param(
    [hashtable]$Config,
    [string]$Key,
    [string]$Default = ''
  )

  if ($Config.ContainsKey($Key) -and $Config[$Key] -ne '') {
    return $Config[$Key]
  }
  return $Default
}

function Get-BoolValue {
  param([string]$Value)
  return @('1', 'true', 'yes', 'on') -contains ($Value ?? '').ToLowerInvariant()
}

function Get-CfstArch {
  switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'X64' { return 'amd64' }
    'Arm64' { return 'arm64' }
    default { Fail-Client "当前 Windows 架构暂不支持自动安装 CFST：$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
  }
}

function Ensure-Cfst {
  param(
    [string]$CfstBin,
    [string]$ReleaseApi
  )

  if (Test-Path $CfstBin) {
    return
  }

  $binDir = Split-Path -Parent $CfstBin
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null

  $arch = Get-CfstArch
  $assetName = "cfst_windows_${arch}.zip"
  $tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cfst-" + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

  try {
    Write-ClientLog "查询 CloudflareSpeedTest 最新版本..."
    $release = Invoke-RestMethod -Uri $ReleaseApi -Headers @{ Accept = 'application/json' }
    $asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
    if (-not $asset) {
      Fail-Client "未找到适配当前平台的 CFST 发行包：$assetName"
    }

    $archivePath = Join-Path $tmpRoot $assetName
    Write-ClientLog "下载 $assetName ..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath
    Expand-Archive -Path $archivePath -DestinationPath $tmpRoot -Force

    $resolved = Get-ChildItem -Path $tmpRoot -Filter 'cfst.exe' -Recurse | Select-Object -First 1
    if (-not $resolved) {
      Fail-Client 'CFST 压缩包解压后未找到 cfst.exe'
    }

    Copy-Item -Path $resolved.FullName -Destination $CfstBin -Force
  }
  finally {
    if (Test-Path $tmpRoot) {
      Remove-Item -Recurse -Force $tmpRoot
    }
  }
}

function Add-CandidateToken {
  param(
    [string]$Token,
    [System.Collections.Generic.List[string]]$Target
  )

  $trimmed = ($Token ?? '').Trim()
  if (-not $trimmed) {
    return
  }
  if ($trimmed -match '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$' -or $trimmed.Contains(':')) {
    $Target.Add($trimmed)
  }
}

function Add-TextCandidates {
  param(
    [string[]]$Lines,
    [System.Collections.Generic.List[string]]$Target
  )

  foreach ($line in $Lines) {
    foreach ($token in ($line -split '[,; ]+')) {
      Add-CandidateToken -Token $token -Target $Target
    }
  }
}

function Add-CsvCandidates {
  param(
    [string[]]$Lines,
    [System.Collections.Generic.List[string]]$Target,
    [double]$SpeedFloor
  )

  if (-not $Lines -or $Lines.Count -le 1) {
    return
  }

  $csvText = [string]::Join([Environment]::NewLine, $Lines)
  $rows = $csvText | ConvertFrom-Csv
  foreach ($row in $rows) {
    $properties = $row.PSObject.Properties
    if (-not $properties -or $properties.Count -eq 0) {
      continue
    }
    $host = [string]$properties[0].Value
    $speedProperty = $properties | Where-Object { $_.Name -match '速度\(MB/s\)|下载速度\(MB/s\)|Speed\(MB/s\)|Speed' } | Select-Object -First 1
    $speed = if ($speedProperty) { [double]$speedProperty.Value } else { $SpeedFloor + 1 }
    if ($speed -ge $SpeedFloor) {
      Add-CandidateToken -Token $host -Target $Target
    }
  }
}

function Read-SourceText {
  param([string]$Source)

  $trimmed = ($Source ?? '').Trim()
  if (-not $trimmed) {
    return @()
  }

  if ($trimmed -match '^https?://') {
    return (Invoke-WebRequest -Uri $trimmed).Content -split "`r?`n"
  }

  if (Test-Path $trimmed) {
    return Get-Content -Path $trimmed
  }

  return $trimmed -split "`r?`n"
}

function Split-Sources {
  param([string]$Value)
  return (($Value ?? '') -split '[,;`r`n]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Build-CandidateFile {
  param(
    [hashtable]$Config,
    [string]$Destination
  )

  $candidates = New-Object System.Collections.Generic.List[string]
  $mode = Get-ConfigValue -Config $Config -Key 'CANDIDATE_SOURCE_MODE' -Default 'cfst_ipv4_ranges'
  $speedFloor = [double](Get-ConfigValue -Config $Config -Key 'DLS' -Default '0')
  $cfstIpFile = Get-ConfigValue -Config $Config -Key 'CFST_IP_FILE' -Default (Join-Path $PSScriptRoot '..\public\seed\ip.txt')
  $cfstIpv6File = Get-ConfigValue -Config $Config -Key 'CFST_IPV6_FILE' -Default (Join-Path $PSScriptRoot '..\public\seed\ipv6.txt')

  if ($mode -in @('cfst_ipv4_ranges', 'hybrid')) {
    if (-not (Test-Path $cfstIpFile)) {
      Fail-Client "默认 IPv4 候选文件不存在：$cfstIpFile"
    }
    Add-TextCandidates -Lines (Get-Content -Path $cfstIpFile) -Target $candidates
  }

  if (Get-BoolValue (Get-ConfigValue -Config $Config -Key 'ENABLE_IPV6' -Default 'false')) {
    if (Test-Path $cfstIpv6File) {
      Add-TextCandidates -Lines (Get-Content -Path $cfstIpv6File) -Target $candidates
    }
  }

  Add-TextCandidates -Lines (Split-Sources (Get-ConfigValue -Config $Config -Key 'ADD' -Default '')) -Target $candidates

  foreach ($source in Split-Sources (Get-ConfigValue -Config $Config -Key 'ADDAPI' -Default '')) {
    Add-TextCandidates -Lines (Read-SourceText -Source $source) -Target $candidates
  }

  foreach ($source in Split-Sources (Get-ConfigValue -Config $Config -Key 'ADDCSV' -Default '')) {
    Add-CsvCandidates -Lines (Read-SourceText -Source $source) -Target $candidates -SpeedFloor $speedFloor
  }

  $unique = $candidates | Select-Object -Unique
  Set-Content -Path $Destination -Value $unique
  return $unique
}

function Get-EstimatedCandidateCount {
  param([string[]]$Candidates)

  $total = 0
  foreach ($candidate in $Candidates) {
    if ($candidate -match '^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]{1,2})$') {
      $prefix = [int]$Matches[2]
      if ($prefix -lt 24) {
        $total += [math]::Pow(2, 24 - $prefix)
      }
      else {
        $total += 1
      }
      continue
    }
    $total += 1
  }
  return [int]$total
}

function Run-Cfst {
  param(
    [hashtable]$Config,
    [string]$CandidateFile,
    [string]$ResultFile,
    [string]$LogFile,
    [string]$CfstBin
  )

  $args = @(
    '-f', $CandidateFile,
    '-o', $ResultFile,
    '-p', '0',
    '-n', (Get-ConfigValue -Config $Config -Key 'LATENCY_THREADS' -Default '200'),
    '-t', (Get-ConfigValue -Config $Config -Key 'LATENCY_PING_COUNT' -Default '4'),
    '-dn', (Get-ConfigValue -Config $Config -Key 'DOWNLOAD_TEST_COUNT' -Default (Get-ConfigValue -Config $Config -Key 'TOP_N' -Default '200')),
    '-dt', (Get-ConfigValue -Config $Config -Key 'DOWNLOAD_TEST_SECONDS' -Default '10'),
    '-tp', (Get-ConfigValue -Config $Config -Key 'TEST_PORT' -Default '443'),
    '-tll', (Get-ConfigValue -Config $Config -Key 'LATENCY_LOWER_MS' -Default '0'),
    '-tl', (Get-ConfigValue -Config $Config -Key 'LATENCY_UPPER_MS' -Default '9999'),
    '-tlr', (Get-ConfigValue -Config $Config -Key 'LOSS_RATE_UPPER' -Default '1.00')
  )

  $minSpeed = [double](Get-ConfigValue -Config $Config -Key 'MIN_SPEED_MBPS' -Default '0')
  if ($minSpeed -gt 0) {
    $args += @('-sl', $minSpeed.ToString([System.Globalization.CultureInfo]::InvariantCulture))
  }

  $testUrl = Get-ConfigValue -Config $Config -Key 'TEST_URL' -Default ''
  if ($testUrl) {
    $args += @('-url', $testUrl)
  }

  if (Get-BoolValue (Get-ConfigValue -Config $Config -Key 'USE_HTTPING' -Default 'false')) {
    $args += '-httping'
  }

  $httpingCode = Get-ConfigValue -Config $Config -Key 'HTTPING_STATUS_CODE' -Default ''
  if ($httpingCode) {
    $args += @('-httping-code', $httpingCode)
  }

  $cfColo = Get-ConfigValue -Config $Config -Key 'CF_COLO_FILTER' -Default ''
  if ($cfColo) {
    $args += @('-cfcolo', $cfColo)
  }

  $extra = Get-ConfigValue -Config $Config -Key 'CFST_EXTRA_ARGS' -Default ''
  if ($extra) {
    $args += ($extra -split '\s+' | Where-Object { $_ })
  }

  Write-ClientLog "开始在当前设备网络下测速：$CfstBin $($args -join ' ')"
  & $CfstBin @args | Tee-Object -FilePath $LogFile | Out-Host
}

function Get-FixedUrls {
  param([string]$WorkerBaseUrl)

  $base = $WorkerBaseUrl.TrimEnd('/') + '/sub/fixed'
  return @{
    auto = $base
    raw = "$base?target=raw"
    clash = "$base?target=clash"
    surge = "$base?target=surge"
  }
}

function Parse-PreferredIps {
  param(
    [string]$ResultFile,
    [int]$TopN,
    [string]$Port
  )

  if (-not (Test-Path $ResultFile)) {
    Fail-Client "CFST 结果文件不存在：$ResultFile"
  }

  $rows = Import-Csv -Path $ResultFile
  $preferred = New-Object System.Collections.Generic.List[string]
  foreach ($row in ($rows | Select-Object -First $TopN)) {
    $properties = $row.PSObject.Properties
    if (-not $properties -or $properties.Count -eq 0) {
      continue
    }
    $host = [string]$properties[0].Value
    if (-not $host) {
      continue
    }
    $label = if ($properties.Count -ge 7 -and [string]$properties[6].Value) { [string]$properties[6].Value } else { 'CFST' }
    $label = ($label -replace '[^A-Za-z0-9._-]', '-')
    $preferred.Add("$host`:$Port#$label")
  }
  return $preferred
}

$config = Read-EnvFile -Path $ConfigPath
$workerBaseUrl = (Get-ConfigValue -Config $config -Key 'WORKER_BASE_URL').TrimEnd('/')
$adminToken = Get-ConfigValue -Config $config -Key 'ADMIN_TOKEN'
$topN = [int](Get-ConfigValue -Config $config -Key 'TOP_N' -Default '200')
$outputFormat = Get-ConfigValue -Config $config -Key 'OUTPUT_FORMAT' -Default 'clash'
$cfstBin = Get-ConfigValue -Config $config -Key 'CFST_BIN' -Default (Join-Path $PSScriptRoot 'bin\cfst.exe')
$releaseApi = Get-ConfigValue -Config $config -Key 'CFST_RELEASE_API' -Default 'https://api.github.com/repos/XIU2/CloudflareSpeedTest/releases/latest'
$workDir = Get-ConfigValue -Config $config -Key 'CLIENT_WORKDIR' -Default (Join-Path $PSScriptRoot '.work')
$updateSource = Get-ConfigValue -Config $config -Key 'UPDATE_SOURCE' -Default 'local-cli-optimize'

if (-not $workerBaseUrl) { Fail-Client '缺少 WORKER_BASE_URL' }
if (-not $adminToken) { Fail-Client '缺少 ADMIN_TOKEN' }

Ensure-Cfst -CfstBin $cfstBin -ReleaseApi $releaseApi
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$tmpRoot = Join-Path $workDir ("run-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

try {
  $candidateFile = Join-Path $tmpRoot 'candidates.txt'
  $resultFile = Join-Path $tmpRoot 'result.csv'
  $logFile = Join-Path $tmpRoot 'cfst.log'

  $candidateLines = Build-CandidateFile -Config $config -Destination $candidateFile
  $candidateCount = Get-EstimatedCandidateCount -Candidates $candidateLines

  Write-ClientLog "候选输入行数：$($candidateLines.Count)"
  Write-ClientLog "候选池估算总数：$candidateCount"
  Write-ClientLog "目标 TopN：$topN"

  Run-Cfst -Config $config -CandidateFile $candidateFile -ResultFile $resultFile -LogFile $logFile -CfstBin $cfstBin

  $rows = Import-Csv -Path $resultFile
  $testedCount = @($rows).Count
  $preferredIps = Parse-PreferredIps -ResultFile $resultFile -TopN $topN -Port (Get-ConfigValue -Config $config -Key 'TEST_PORT' -Default '443')
  if ($preferredIps.Count -le 0) {
    Fail-Client 'CFST 没有输出任何可用结果，请检查 TEST_URL / TEST_PORT / 网络环境。'
  }

  $payload = @{
    preferredIps = $preferredIps
    source = $updateSource
    candidateMode = 'local-cli'
    lastOptimizedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    candidateCount = $candidateCount
    testedCount = $testedCount
  } | ConvertTo-Json -Depth 6

  $response = Invoke-RestMethod -Method Post -Uri "$workerBaseUrl/api/update-preferred" -Headers @{
    Authorization = "Bearer $adminToken"
    'Content-Type' = 'application/json'
  } -Body $payload

  if (-not $response.ok) {
    Fail-Client ($response | ConvertTo-Json -Depth 6)
  }

  $publicFixedUrls = Get-FixedUrls -WorkerBaseUrl $workerBaseUrl
  $fixedTargetUrl = if ($response.fixedUrls.$outputFormat) { $response.fixedUrls.$outputFormat } else { $response.fixedUrls.auto }

  Write-Host ''
  Write-Host '更新成功'
  Write-Host "候选池总数：$candidateCount"
  Write-Host "测速成功数：$testedCount"
  Write-Host "最终 Top$topN 数量：$($preferredIps.Count)"
  Write-Host '固定订阅地址：'
  Write-Host "  自动：$($publicFixedUrls.auto)"
  Write-Host "  Raw：$($publicFixedUrls.raw)"
  Write-Host "  Clash：$($publicFixedUrls.clash)"
  Write-Host "  Surge：$($publicFixedUrls.surge)"
  Write-Host "默认推荐订阅地址（Clash）：$($publicFixedUrls.clash)"
  if ($fixedTargetUrl -and $fixedTargetUrl -ne $publicFixedUrls.clash) {
    Write-Host "鉴权直链 / 当前输出格式地址：$fixedTargetUrl"
  }
  Write-Host '下一步：回到订阅客户端点击“更新订阅”。'
}
finally {
  if (Test-Path $tmpRoot) {
    Remove-Item -Recurse -Force $tmpRoot
  }
}
