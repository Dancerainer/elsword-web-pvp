param([Parameter(Mandatory)][ValidateSet('Start','Stop')][string]$Action)
$ErrorActionPreference = 'Stop'
$target = $env:WEB_PVP_SSH_TARGET
if (-not $target -or $target.StartsWith('-') -or $target -match '[\s\x00-\x1f]') {
  throw 'Set WEB_PVP_SSH_TARGET to your SSH host or user@host.'
}
if ($Action -eq 'Start') {
  & ssh -t -- $target 'sudo systemctl start nginx rf-pvp && sudo systemctl is-active nginx rf-pvp'
} else {
  & ssh -t -- $target 'sudo systemctl stop rf-pvp nginx && sudo systemctl show -p ActiveState --value rf-pvp nginx'
}
exit $LASTEXITCODE
