param(
  [ValidateSet('Start','Stop','Status')][string]$Action = 'Start',
  [string]$SettingsPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-ManagedProcess($entry) {
  if (-not $entry -or -not $entry.pid -or -not $entry.startTicks -or -not $entry.executable) { return $null }
  $owned = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if (-not $owned) { return $null }
  try {
    if ($owned.StartTime.ToUniversalTime().Ticks -ne [long]$entry.startTicks) { return $null }
    if (-not [string]::Equals($owned.Path, [string]$entry.executable, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  } catch { return $null }
  return $owned
}
function Stop-ManagedProcess($entry) {
  $owned = Get-ManagedProcess $entry
  if ($owned) {
    try { Stop-Process -Id $owned.Id -ErrorAction Stop; $owned.WaitForExit(5000) | Out-Null }
    catch { if (-not $owned.HasExited) { throw } }
  }
}
function Get-ProcessIdentity($process) {
  $deadline = [DateTime]::UtcNow.AddSeconds(2)
  do {
    $process.Refresh()
    if ($process.HasExited) { throw 'The managed process exited before it became ready.' }
    # Start-Process can return before Windows has populated MainModule/Path.
    # A null path would make this identity impossible to stop later.
    $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if (-not $current) { throw 'The managed process exited before it became ready.' }
    try { $executable = $current.Path } catch { $executable = $null }
    if (-not [string]::IsNullOrWhiteSpace($executable)) {
      return @{pid=$current.Id;startTicks=$current.StartTime.ToUniversalTime().Ticks.ToString();executable=$executable}
    }
    Start-Sleep -Milliseconds 10
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Windows did not provide the managed executable identity.'
}
function Get-Sha256File([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $digest = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $digest.Dispose() }
}
function Assert-OnlineAssets([string]$assets) {
  foreach ($file in @('native/manifest.json','rf/manifest.json','scene/sander-garpai-rock-pvp/manifest.json','ui/online/manifest.json','ui/pvp-hud/manifest.json','audio/pvp/manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $assets $file) -PathType Leaf)) { throw "Missing online resource: $file" }
  }
}
function Get-SourceFingerprint([string]$root) {
  $lines = @()
  foreach ($folder in @('apps','packages','config')) {
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse | Where-Object { $_.Extension -in @('.mjs','.json','.css','.html') } | Sort-Object FullName)) {
      $relative = $file.FullName.Substring($root.Length).Replace('\','/')
      $lines += $relative + ':' + (Get-Sha256File $file.FullName)
    }
  }
  foreach ($file in @('package.json','pnpm-lock.yaml','tools/build-web.mjs','tools/prepare-public-deployment.mjs','tools/verify-public-runtime.mjs','tools/verify-public-accounts.mjs','tools/verify-public-online-transport.mjs','scripts/public-server.ps1','scripts/verify-public-https.ps1')) {
    $lines += $file + ':' + (Get-Sha256File (Join-Path $root $file))
  }
  $digest = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))))).Replace('-','').ToLowerInvariant() }
  finally { $digest.Dispose() }
}
# Dot sourcing exposes only helpers for lifecycle and resource preflight tests.
if ($MyInvocation.InvocationName -eq '.') { return }

$launcherRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $SettingsPath) { $SettingsPath = Join-Path $launcherRoot 'runtime/public-server-settings.json' }
if (-not (Test-Path -LiteralPath $SettingsPath)) { throw "Missing prepared public settings: $SettingsPath. See docs/PUBLIC_ONLINE.md." }
$settings = Get-Content -Raw -LiteralPath $SettingsPath -Encoding UTF8 | ConvertFrom-Json
$deployRoot = (Resolve-Path -LiteralPath $settings.deploymentRoot).Path
$sourceRoot = if ($settings.sourceRoot) { (Resolve-Path -LiteralPath $settings.sourceRoot).Path } else { $deployRoot }
$runtimeRoot = Join-Path $deployRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$statePath = Join-Path $runtimeRoot 'public-online.json'
$addressPath = Join-Path $runtimeRoot 'public-address.txt'
$mutexDigest = [Security.Cryptography.SHA256]::Create()
try { $mutexSuffix = ([BitConverter]::ToString($mutexDigest.ComputeHash([Text.Encoding]::UTF8.GetBytes($deployRoot.ToLowerInvariant())))).Replace('-','').Substring(0,24) }
finally { $mutexDigest.Dispose() }
$mutex = [Threading.Mutex]::new($false, ('Local\RFPublicOnline-' + $mutexSuffix))
$ownsMutex = $false
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { throw 'Another public start/stop action is already running.' }
  $state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath -Encoding UTF8 | ConvertFrom-Json } else { $null }
  if ($state -and -not [string]::Equals([string]$state.deploymentRoot,$deployRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'State belongs to another deployment; refusing to stop or replace it.' }
  if ($Action -eq 'Stop') {
    if ($state) {
      Stop-ManagedProcess $state.tunnel
      Stop-ManagedProcess $state.server
      Remove-Item -LiteralPath $statePath
    }
    if (Test-Path -LiteralPath $addressPath) { Remove-Item -LiteralPath $addressPath }
    Write-Output 'Public server stopped. Account data and preferences are retained.'
    return
  }
  $runningServer = if ($state) { Get-ManagedProcess $state.server } else { $null }
  $runningTunnel = if ($state) { Get-ManagedProcess $state.tunnel } else { $null }
  if ($Action -eq 'Status') {
    if ($runningServer -and $runningTunnel) { Write-Output "Public server: $($state.url)" }
    else { Write-Output 'Public server is not running.' }
    return
  }
  $port = [int]$settings.port
  if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid public origin port.' }
  $assets = (Resolve-Path -LiteralPath $settings.assetSourceRoot).Path
  $accounts = (Resolve-Path -LiteralPath $settings.accountRoot).Path
  $cloudflared = (Resolve-Path -LiteralPath $settings.cloudflaredPath).Path
  $fingerprint = Get-SourceFingerprint $sourceRoot
  if ($runningServer -and $runningTunnel) {
    if ($state.sourceFingerprint -ne $fingerprint -or $state.port -ne $port -or $state.assetSourceRoot -ne $assets -or $state.accountRoot -ne $accounts -or $state.tunnel.executable -ne $cloudflared) {
      throw 'The running release or settings differ. Run stop-public-server.bat, then start again.'
    }
    Write-Output "Already running: $($state.url)"
    Write-Output "Account data: $accounts"
    return
  }
  # A partially running release must be stopped explicitly; never add a second tunnel.
  if ($runningServer -or $runningTunnel) { throw 'A partial managed release is running. Run stop-public-server.bat first.' }
  if ($fingerprint -ne (Get-SourceFingerprint $deployRoot)) { throw 'The prepared release differs from the source. Refresh the prepared release before starting; see docs/PUBLIC_ONLINE.md.' }
  if (-not (Test-Path -LiteralPath (Join-Path $accounts 'dev-account.json'))) { throw 'Prepared account data is missing; existing credentials will not be regenerated.' }
  Assert-OnlineAssets $assets
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $deployRoot 'node_modules/esbuild'))) { throw 'The locked workspace dependencies are missing.' }
  # A temporary TcpListener would reject Windows TIME_WAIT sockets after a
  # clean stop. Check actual listeners; the real Node bind still detects races.
  $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if (@($listeners | Where-Object { $_.Port -eq $port }).Count -gt 0) { throw "The public origin port $port is already listening." }
  Push-Location -LiteralPath $deployRoot
  try {
    & $nodePath tools/build-web.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    & $nodePath tools/prepare-public-deployment.mjs $assets
    if ($LASTEXITCODE -ne 0) { throw 'Resource snapshot/native initialization failed.' }
    $revision = & git -C $sourceRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify the release commit.' }
  } finally { Pop-Location }
  $deployment = Get-Content -LiteralPath (Join-Path $deployRoot 'dist/deployment.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $previousEnv = @{}
  foreach ($name in @('RF_PORT','RF_ASSET_ROOT','RF_ACCOUNT_ROOT','RF_PUBLIC_ORIGIN','RF_ONLINE_EVENT_TRANSPORT','RF_ACCESS_LOG')) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
  $serverProcess = $null; $tunnelProcess = $null; $serverIdentity = $null; $tunnelIdentity = $null
  try {
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    if (Test-Path -LiteralPath $addressPath) { Remove-Item -LiteralPath $addressPath }
    $emptyConfig = Join-Path $runtimeRoot 'cloudflared-online-empty.yml'
    '{}' | Set-Content -LiteralPath $emptyConfig -Encoding ascii
    $tunnelLog = Join-Path $runtimeRoot 'public-tunnel.stderr.log'
    $tunnelProcess = Start-Process -FilePath $cloudflared -WindowStyle Hidden -PassThru -WorkingDirectory $deployRoot -ArgumentList @('tunnel','--config',('"'+$emptyConfig+'"'),'--no-autoupdate','--protocol','http2','--url',"http://127.0.0.1:$port") -RedirectStandardOutput (Join-Path $runtimeRoot 'public-tunnel.stdout.log') -RedirectStandardError $tunnelLog
    $tunnelIdentity = Get-ProcessIdentity $tunnelProcess
    $deadline = (Get-Date).AddSeconds(55)
    $publicUrl = $null
    while ((Get-Date) -lt $deadline) {
      $tunnelProcess.Refresh()
      if ($tunnelProcess.HasExited) { throw "Tunnel exited. See $tunnelLog" }
      if (Test-Path -LiteralPath $tunnelLog) {
        $text = Get-Content -Raw -LiteralPath $tunnelLog
        if ($text) { $match = [regex]::Match($text,'https://[a-z0-9-]+\.trycloudflare\.com'); if ($match.Success) { $publicUrl=$match.Value; break } }
      }
      Start-Sleep -Milliseconds 250
    }
    if (-not $publicUrl) { throw "No public URL was received. See $tunnelLog" }
    $env:RF_PORT = [string]$port
    $env:RF_ASSET_ROOT = $deployment.assetRoot
    $env:RF_ACCOUNT_ROOT = $accounts
    $env:RF_PUBLIC_ORIGIN = $publicUrl
    $env:RF_ONLINE_EVENT_TRANSPORT = 'poll'
    $env:RF_ACCESS_LOG = '0'
    $serverProcess = Start-Process -FilePath $nodePath -WindowStyle Hidden -PassThru -WorkingDirectory $deployRoot -ArgumentList @(('"'+(Join-Path $deployRoot 'apps/server/dev-server.mjs')+'"')) -RedirectStandardOutput (Join-Path $runtimeRoot 'public-server.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'public-server.stderr.log')
    $serverIdentity = Get-ProcessIdentity $serverProcess
    $deadline = (Get-Date).AddSeconds(20)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      $serverProcess.Refresh()
      if ($serverProcess.HasExited) { throw 'Server exited. See runtime/public-server.stderr.log.' }
      try { if ((Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 2).StatusCode -eq 200) { $ready=$true; break } }
      catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Local origin did not become ready.' }
    & $nodePath (Join-Path $deployRoot 'tools/verify-public-accounts.mjs') "http://127.0.0.1:$port" $publicUrl $accounts $deployment.bundleSha256
    if ($LASTEXITCODE -ne 0) { throw 'Account/version verification failed.' }
    & $nodePath (Join-Path $deployRoot 'tools/verify-public-online-transport.mjs') "http://127.0.0.1:$port" $publicUrl $accounts
    if ($LASTEXITCODE -ne 0) { throw 'Online transport verification failed.' }
    $deadline = (Get-Date).AddSeconds(45)
    $publicReady = $false
    while ((Get-Date) -lt $deadline) {
      try { if ((Invoke-WebRequest -UseBasicParsing -Uri ($publicUrl + '/') -TimeoutSec 10).StatusCode -eq 200) { $publicReady=$true; break } }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $publicReady) { throw 'The HTTPS tunnel is not reachable. No address will be published.' }
    $probeReady = $false
    for ($attempt=1; $attempt -le 3; $attempt++) {
      try {
        # Use the system HTTPS stack and its normal certificate validation.
        # Some networks reset Node's TLS handshake while Windows HTTPS works.
        & (Join-Path $deployRoot 'scripts/verify-public-https.ps1') -Url $publicUrl -AccountRoot $accounts -ExpectedBuildVersion $deployment.bundleSha256
        $probeReady = $true
        break
      } catch {
        Write-Output "Public HTTPS probe failed: $($_.Exception.Message)"
        if ($attempt -lt 3) {
          Write-Output "Waiting before public HTTPS retry $($attempt+1)/3."
          # A login whose response was lost expires after 20 seconds. Never
          # override a unique session or retry that uncertain POST immediately.
          Start-Sleep -Seconds 22
        }
      }
    }
    if (-not $probeReady) { throw 'Public HTTPS verification failed; the candidate will be stopped.' }
    $state = @{schemaVersion=1;url=$publicUrl;port=$port;deploymentRoot=$deployRoot;sourceRoot=$sourceRoot;accountRoot=$accounts;assetSourceRoot=$assets;assetRoot=$deployment.assetRoot;sourceCommit=$revision;sourceFingerprint=$fingerprint;bundleSha256=$deployment.bundleSha256;onlineEventTransport='poll';startedAt=[DateTime]::UtcNow.ToString('o');server=(Get-ProcessIdentity $serverProcess);tunnel=(Get-ProcessIdentity $tunnelProcess)}
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
    $publicUrl | Set-Content -LiteralPath $addressPath -Encoding ascii
    Write-Output "Public server: $publicUrl"
    Write-Output "Account data: $accounts"
    Write-Output 'Close this window freely. Stop with stop-public-server.bat.'
  } catch {
    foreach ($entry in @($serverIdentity,$tunnelIdentity)) {
      try { Stop-ManagedProcess $entry }
      catch { Write-Warning 'A managed process could not be stopped; check its runtime log and identity.' }
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    if (Test-Path -LiteralPath $addressPath) { Remove-Item -LiteralPath $addressPath }
    throw
  } finally { foreach ($name in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($name,$previousEnv[$name],'Process') } }
} finally { if ($ownsMutex) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
