param(
  [int]$Port = 4198,
  [string]$AssetRoot,
  [string]$AccountFile,
  [string]$CloudflaredPath
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $taskRoot 'runtime'
New-Item -ItemType Directory -Force $runtimeRoot | Out-Null
$statePath = Join-Path $runtimeRoot 'public-demo.json'
if (Test-Path -LiteralPath $statePath) {
  $old = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  foreach ($entry in @($old.server, $old.tunnel)) {
    $existing = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.StartTime.ToUniversalTime().Ticks -eq $entry.startTicks) {
      throw "A managed demo process is already running. Use scripts/stop-public-rf.ps1 first. URL: $($old.url)"
    }
  }
}
$settingsPath = Join-Path $runtimeRoot 'share-settings.json'
if (-not $AssetRoot -and (Test-Path -LiteralPath $settingsPath)) {
  $AssetRoot = (Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json).assetRoot
}
if (-not $AssetRoot) { $AssetRoot = Join-Path $taskRoot 'artifacts' }
$AssetRoot = (Resolve-Path -LiteralPath $AssetRoot).Path
$required = @('rf/manifest.json','rf/buff-fx/index.json','rf/shadow-weapon-fx/index.json',
  'scene/sander-garpai-rock-pvp/manifest.json','ui/manifest.json','ui/skills/catalog.json','audio/manifest.json',
  'native/manifest.json','native/geometry.wasm','native/camera.wasm','native/commands.wasm',
  'native/skills.wasm','native/skill-values.wasm','native/effect-random.wasm')
foreach ($file in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $AssetRoot $file))) { throw "Missing generated asset: $file" }
}
if ($AccountFile -and -not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'dev-account.json'))) {
  Copy-Item -LiteralPath $AccountFile -Destination (Join-Path $runtimeRoot 'dev-account.json')
}
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is missing.' }
if (-not $CloudflaredPath) { $CloudflaredPath = Join-Path $taskRoot '.cache/tools/cloudflared.exe' }
$CloudflaredPath = (Resolve-Path -LiteralPath $CloudflaredPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/esbuild'))) { throw 'Run pnpm install --frozen-lockfile in this worktree first.' }
# Check the port before creating a public URL, and keep the origin loopback-only.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $probe.Start() } finally { $probe.Stop() }
Push-Location -LiteralPath $taskRoot
try {
  & $nodePath tools/build-web.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  & $nodePath tools/prepare-public-deployment.mjs $AssetRoot
  if ($LASTEXITCODE -ne 0) { throw 'Public asset snapshot or native initialization failed.' }
} finally { Pop-Location }
$assetSourceRoot = $AssetRoot
$deployment = Get-Content -Raw (Join-Path $taskRoot 'dist/deployment.json') | ConvertFrom-Json
$AssetRoot = $deployment.assetRoot
@{assetRoot=$assetSourceRoot} | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $settingsPath
$tunnelProcess = $null
$serverProcess = $null
$previousPort = $env:RF_PORT
$previousAssets = $env:RF_ASSET_ROOT
$previousOrigin = $env:RF_PUBLIC_ORIGIN
try {
  $tunnelLog = Join-Path $runtimeRoot 'tunnel.stderr.log'
  $emptyConfig = Join-Path $runtimeRoot 'cloudflared-empty.yml'
  '{} ' | Set-Content -Encoding ascii -LiteralPath $emptyConfig
  $tunnelProcess = Start-Process -FilePath $CloudflaredPath -WindowStyle Hidden -PassThru -WorkingDirectory $taskRoot `
    -ArgumentList @('tunnel','--config',('"' + $emptyConfig + '"'),'--no-autoupdate','--protocol','http2','--url',"http://127.0.0.1:$Port") `
    -RedirectStandardOutput (Join-Path $runtimeRoot 'tunnel.stdout.log') -RedirectStandardError $tunnelLog
  $deadline = (Get-Date).AddSeconds(60)
  $publicUrl = $null
  while ((Get-Date) -lt $deadline) {
    $tunnelProcess.Refresh()
    if ($tunnelProcess.HasExited) { throw "cloudflared exited. See $tunnelLog" }
    if (Test-Path -LiteralPath $tunnelLog) {
      $logText = Get-Content -Raw -LiteralPath $tunnelLog
      if ($logText) {
        $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) { $publicUrl = $match.Value; break }
      }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $publicUrl) { throw "Tunnel URL timed out. See $tunnelLog" }
  $env:RF_PORT = [string]$Port
  $env:RF_ASSET_ROOT = $AssetRoot
  $env:RF_PUBLIC_ORIGIN = $publicUrl
  $serverProcess = Start-Process -FilePath $nodePath -WindowStyle Hidden -PassThru -WorkingDirectory $taskRoot `
    -ArgumentList @(('"' + (Join-Path $taskRoot 'apps/server/dev-server.mjs') + '"')) `
    -RedirectStandardOutput (Join-Path $runtimeRoot 'server.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'server.stderr.log')
  $deadline = (Get-Date).AddSeconds(15)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    $serverProcess.Refresh()
    if ($serverProcess.HasExited) { throw 'Demo server exited. See runtime/server.stderr.log' }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ready) { throw 'Demo server did not become ready.' }
  @{
    url=$publicUrl; port=$Port; assetRoot=$AssetRoot; assetSourceRoot=$assetSourceRoot
    server=@{pid=$serverProcess.Id;startTicks=$serverProcess.StartTime.ToUniversalTime().Ticks}
    tunnel=@{pid=$tunnelProcess.Id;startTicks=$tunnelProcess.StartTime.ToUniversalTime().Ticks}
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath $statePath
  Write-Output "Public demo: $publicUrl"
  Write-Output 'Account: runtime/dev-account.json. Stop: scripts/stop-public-rf.ps1'
} catch {
  foreach ($process in @($serverProcess, $tunnelProcess)) {
    if ($process) { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id } }
  }
  throw
} finally {
  $env:RF_PORT = $previousPort
  $env:RF_ASSET_ROOT = $previousAssets
  $env:RF_PUBLIC_ORIGIN = $previousOrigin
}
