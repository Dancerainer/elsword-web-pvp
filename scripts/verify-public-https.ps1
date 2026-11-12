param(
  [string]$Url,
  [string]$AccountRoot,
  [string]$ExpectedBuildVersion
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Read-PublicHttpsAccountFile([string]$file) {
  try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) }
  catch { throw 'Invalid public account configuration.' }
}
function Read-PublicHttpsAccounts([string]$root) {
  $primary = Read-PublicHttpsAccountFile (Join-Path $root 'dev-account.json')
  $extra = @(); $player = @()
  $extraFile = Join-Path $root 'dev-accounts.json'
  if (Test-Path -LiteralPath $extraFile) {
    $config = Read-PublicHttpsAccountFile $extraFile
    if ($config.schemaVersion -is [string] -or $config.schemaVersion -is [bool] -or $config.schemaVersion -ne 1 -or $config.accounts -isnot [array]) { throw 'Invalid public account configuration.' }
    $extra = @($config.accounts)
  }
  $playerFile = Join-Path $root 'dev-player-account.json'
  if (Test-Path -LiteralPath $playerFile) { $player = @(Read-PublicHttpsAccountFile $playerFile) }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($account in (@($primary) + $extra + $player)) {
    if ($account.username -isnot [string] -or -not $account.username.Length -or $account.password -isnot [string] -or -not $account.password.Length) { throw 'Invalid public account configuration.' }
    if ($seen.Add($account.username)) { $account }
  }
}
function Test-PublicPollInteger($value) {
  if ($value -isnot [int] -and $value -isnot [long] -and $value -isnot [double] -and $value -isnot [decimal]) { return $false }
  return -not [double]::IsNaN([double]$value) -and -not [double]::IsInfinity([double]$value) -and $value -ge 0 -and $value -le [long]9007199254740991 -and $value -eq [Math]::Floor([double]$value)
}
function Invoke-PublicHttpsRequest([string]$base,[string]$resource,[string]$method,$webSession,$body=$null) {
  $options = @{Uri=($base+$resource);Method=$method;WebSession=$webSession;UseBasicParsing=$true;TimeoutSec=20;MaximumRedirection=0;Headers=@{Origin=$base}}
  if ($null -ne $body) {
    $options.ContentType = 'application/json; charset=utf-8'
    $options.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 8))
  }
  try {
    $response = Invoke-WebRequest @options
    if ($response.StatusCode -ne 200) { throw 'Unexpected status.' }
    return $response
  } catch { throw "Public HTTPS request failed: $method $resource" }
}
function Read-PublicHttpsResponse($response,[string]$resource) {
  try { return ($response.Content | ConvertFrom-Json) }
  catch { throw "Invalid public HTTPS JSON response: $resource" }
}
function Invoke-PublicHttpsVerification([string]$Url,[object[]]$Accounts,[string]$ExpectedBuildVersion) {
  if (-not [regex]::IsMatch($Url,'^https://[a-z0-9-]+\.trycloudflare\.com/?$')) { throw 'Invalid public HTTPS tunnel URL.' }
  if (-not [regex]::IsMatch($ExpectedBuildVersion,'^[a-f0-9]{64}$')) { throw 'Invalid expected browser build version.' }
  if (-not $Accounts.Count) { throw 'No prepared public accounts.' }
  $base = $Url.TrimEnd('/'); $verified = 0; $pollVerified = $false
  $previousTls = [Net.ServicePointManager]::SecurityProtocol
  try {
    # Keep Windows certificate verification enabled; only enable modern TLS.
    [Net.ServicePointManager]::SecurityProtocol = $previousTls -bor [Net.SecurityProtocolType]::Tls12
    foreach ($account in $Accounts) {
      $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $connectionId = $null; $failure = $null
      try {
        $login = Read-PublicHttpsResponse (Invoke-PublicHttpsRequest $base '/api/login' 'POST' $webSession @{username=$account.username;password=$account.password}) '/api/login'
        if (-not [string]::Equals($login.username,$account.username,[StringComparison]::Ordinal)) { throw 'Public account login identity mismatch.' }
        $cookies = $webSession.Cookies.GetCookies([Uri]$base)
        $sessionCookie = $cookies['rf_session']
        if (-not $sessionCookie -or -not $sessionCookie.Secure -or -not $sessionCookie.Value) { throw 'Public Secure session cookie missing.' }
        $session = Read-PublicHttpsResponse (Invoke-PublicHttpsRequest $base '/api/session' 'GET' $webSession) '/api/session'
        $role = if ($null -eq $account.role) { 'player' } else { [string]$account.role }
        if (-not [string]::Equals($session.username,$account.username,[StringComparison]::Ordinal)) { throw 'Public account session identity mismatch.' }
        if (-not [string]::Equals($session.role,$role,[StringComparison]::Ordinal)) { throw 'Public account permission mismatch.' }
        if (-not [string]::Equals($session.buildVersion,$ExpectedBuildVersion,[StringComparison]::Ordinal)) { throw 'Public browser build version mismatch.' }
        $null = Invoke-PublicHttpsRequest $base '/game/game.js' 'HEAD' $webSession
        if ($verified -eq 0) {
          if ($session.onlineEventTransport -ne 'poll' -or $session.online.available -ne $true) { throw 'Public authoritative polling service unavailable.' }
          $lease = Read-PublicHttpsResponse (Invoke-PublicHttpsRequest $base '/api/online/poll/open' 'POST' $webSession @{}) '/api/online/poll/open'
          if ($lease.connectionId -is [string]) { $connectionId = $lease.connectionId }
          if (-not $connectionId -or -not [regex]::IsMatch($connectionId,'^[A-Za-z0-9_-]+$') -or -not (Test-PublicPollInteger $lease.cursor)) { throw 'Invalid public poll lease.' }
          $resource = '/api/online/poll?connectionId=' + [Uri]::EscapeDataString($connectionId) + '&after=' + ([long]$lease.cursor).ToString([Globalization.CultureInfo]::InvariantCulture)
          $batch = Read-PublicHttpsResponse (Invoke-PublicHttpsRequest $base $resource 'GET' $webSession) '/api/online/poll'
          if (-not (Test-PublicPollInteger $batch.cursor) -or $batch.events -isnot [array] -or $batch.events.Count -gt 129) { throw 'Invalid public poll batch.' }
          $previous = [long]$lease.cursor; $namedStatus = $false
          foreach ($event in $batch.events) {
            if (-not (Test-PublicPollInteger $event.id) -or $event.id -le $previous -or $event.id -gt $batch.cursor -or $event.type -isnot [string]) { throw 'Invalid public poll event sequence.' }
            $previous = [long]$event.id
            if ($event.type -eq 'status') { $namedStatus = $true }
          }
          if (-not $namedStatus -or $previous -ne $batch.cursor) { throw 'Public named status event missing.' }
          $pollVerified = $true
        }
        $verified++
      } catch { $failure = $_ }
      finally {
        if ($connectionId) {
          try { $null = Invoke-PublicHttpsRequest $base '/api/online/poll/close' 'POST' $webSession @{connectionId=$connectionId} }
          catch { if (-not $failure) { $failure = $_ } }
        }
        # Attempt logout even after a failed or uncertain login response.
        try { $null = Invoke-PublicHttpsRequest $base '/api/logout' 'POST' $webSession @{} }
        catch { if (-not $failure) { $failure = $_ } }
      }
      if ($failure) { throw $failure }
    }
    return @{accountCount=$verified;buildVersion=$ExpectedBuildVersion;onlineTransportVerified=$pollVerified;eventTransport='poll';namedStatusReceived=$pollVerified}
  } finally { [Net.ServicePointManager]::SecurityProtocol = $previousTls }
}

# Dot sourcing exposes the pure account reader and HTTP verification contract.
if ($MyInvocation.InvocationName -eq '.') { return }
if (-not $Url -or -not $AccountRoot -or -not $ExpectedBuildVersion) { throw 'Usage: verify-public-https.ps1 -Url HTTPS_URL -AccountRoot DIRECTORY -ExpectedBuildVersion SHA256' }
$accounts = @(Read-PublicHttpsAccounts $AccountRoot)
Invoke-PublicHttpsVerification $Url $accounts $ExpectedBuildVersion | ConvertTo-Json -Compress
