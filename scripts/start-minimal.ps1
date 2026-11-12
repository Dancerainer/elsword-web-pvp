param([int]$Port=4207)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
if (!(Test-Path -LiteralPath 'dist/game.js') -or !(Test-Path -LiteralPath 'artifacts/minimal/manifest.json')) { throw 'Prepare this experiment using docs/MINIMAL_RUNTIME_EXPERIMENT.md first.' }
$env:RF_PORT=[string]$Port
node apps/server/dev-server.mjs
