param([string]$DeployRoot, [string]$ControlRoot, [string]$AssetSourceRoot)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $ControlRoot) { $ControlRoot = Join-Path $PSScriptRoot '..' }
$controlRoot = (Resolve-Path -LiteralPath $ControlRoot).Path
if (-not $DeployRoot) { $DeployRoot = Join-Path $PSScriptRoot '..' }
$DeployRoot = (Resolve-Path -LiteralPath $DeployRoot).Path
$runtimeRoot = Join-Path $controlRoot 'runtime'
$statePath = Join-Path $runtimeRoot 'public-demo.json'
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
foreach ($file in @('dist/game.js','apps/server/dev-server.mjs','apps/web/index.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $DeployRoot $file))) { throw "Candidate is not built: $file" }
}
$tunnel = Get-Process -Id $state.tunnel.pid -ErrorAction SilentlyContinue
if (-not $tunnel -or $tunnel.StartTime.ToUniversalTime().Ticks -ne $state.tunnel.startTicks) {
  throw 'The existing tunnel is not running. Restart it explicitly; do not silently change the URL.'
}
$previousRoot = if ($state.deploymentRoot) { $state.deploymentRoot } else { $controlRoot }
$previousAccounts = if ($state.accountRoot) { $state.accountRoot } else { Join-Path $previousRoot 'runtime' }
$candidateAccounts = $previousAccounts
$previousAssets = $state.assetRoot
$current = Get-Process -Id $state.server.pid -ErrorAction SilentlyContinue
if ($current -and $current.StartTime.ToUniversalTime().Ticks -ne $state.server.startTicks) { throw 'Server PID was reused; refusing to stop it.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not $AssetSourceRoot) { $AssetSourceRoot = if ($state.assetSourceRoot) { $state.assetSourceRoot } else { $state.assetRoot } }
# Prepare and actually initialize the candidate native runtime before stopping the live server.
& $nodePath (Join-Path $DeployRoot 'tools/prepare-public-deployment.mjs') $AssetSourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Candidate asset snapshot or native initialization failed; current server retained.' }
$deployment = Get-Content -Raw (Join-Path $DeployRoot 'dist/deployment.json') | ConvertFrom-Json
$previousEnv = @{}
foreach ($name in @('RF_PORT','RF_ASSET_ROOT','RF_PUBLIC_ORIGIN','RF_ACCOUNT_ROOT','RF_ACCESS_LOG')) {
  $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
function Start-Origin([string]$root, [string]$accounts, [string]$assets) {
  $env:RF_PORT = [string]$state.port
  $env:RF_ASSET_ROOT = $assets
  $env:RF_PUBLIC_ORIGIN = $state.url
  $env:RF_ACCOUNT_ROOT = $accounts
  $env:RF_ACCESS_LOG = '0'
  New-Item -ItemType Directory -Force (Join-Path $root 'runtime') | Out-Null
  $process = Start-Process -FilePath $nodePath -WindowStyle Hidden -PassThru -WorkingDirectory $root `
    -ArgumentList @(('"' + (Join-Path $root 'apps/server/dev-server.mjs') + '"')) `
    -RedirectStandardOutput (Join-Path $root 'runtime/server.stdout.log') -RedirectStandardError (Join-Path $root 'runtime/server.stderr.log')
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw "Candidate server exited. See $root/runtime/server.stderr.log" }
    try {
      if ((Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($state.port)/" -TimeoutSec 2).StatusCode -eq 200) { return $process }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
  throw 'Candidate server readiness timed out.'
}
function Save-State($process, [string]$root, [string]$accounts, [string]$assets) {
  $revision = & git -C $root rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify deployment revision.' }
  $state.server = @{pid=$process.Id;startTicks=$process.StartTime.ToUniversalTime().Ticks}
  $state | Add-Member -NotePropertyName deploymentRoot -NotePropertyValue $root -Force
  $state | Add-Member -NotePropertyName accountRoot -NotePropertyValue $accounts -Force
  $state.assetRoot = $assets
  $state | Add-Member -NotePropertyName assetSourceRoot -NotePropertyValue $AssetSourceRoot -Force
  $state | Add-Member -NotePropertyName sourceCommit -NotePropertyValue $revision -Force
  $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $statePath
}
$candidate = $null
try {
  if ($current) { Stop-Process -Id $current.Id }
  $candidate = Start-Origin $DeployRoot $candidateAccounts $deployment.assetRoot
  # Windows PowerShell 5.1 drops a manually supplied Cookie header on these
  # loopback HTTP requests. Node fetch explicitly forwards the returned token.
  $accountProofJson = & $nodePath (Join-Path $DeployRoot 'tools/verify-public-accounts.mjs') `
    "http://127.0.0.1:$($state.port)" $state.url $candidateAccounts $deployment.bundleSha256
  if ($LASTEXITCODE -ne 0) { throw 'Candidate account/session verification failed.' }
  $accountProof = $accountProofJson | ConvertFrom-Json
  & $nodePath (Join-Path $DeployRoot 'tools/verify-public-runtime.mjs') $deployment.assetRoot $state.url $candidateAccounts
  if ($LASTEXITCODE -ne 0) { throw 'Public native runtime initialization failed.' }
  Save-State $candidate $DeployRoot $candidateAccounts $deployment.assetRoot
  Write-Output "Updated origin; URL unchanged: $($state.url)"
  Write-Output "Verified accounts: $($accountProof.accountCount)"
} catch {
  $failure = $_
  if ($candidate) { $candidate.Refresh(); if (-not $candidate.HasExited) { Stop-Process -Id $candidate.Id } }
  $rollback = Start-Origin $previousRoot $previousAccounts $previousAssets
  Save-State $rollback $previousRoot $previousAccounts $previousAssets
  throw $failure
} finally {
  foreach ($name in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnv[$name], 'Process') }
}
