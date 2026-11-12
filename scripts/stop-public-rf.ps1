$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$statePath = Join-Path $taskRoot 'runtime/public-demo.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No managed public demo found.'; return }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
foreach ($entry in @($state.tunnel, $state.server)) {
  $managedProcess = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  # A reused PID must never cause an unrelated process to be stopped.
  if ($managedProcess -and $managedProcess.StartTime.ToUniversalTime().Ticks -eq $entry.startTicks) {
    Stop-Process -Id $managedProcess.Id
  }
}
Remove-Item -LiteralPath $statePath
Write-Output 'Public demo stopped.'
