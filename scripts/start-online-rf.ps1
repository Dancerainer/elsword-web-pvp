param([int]$Port = 4208)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is required.' }
if (-not (Test-Path -LiteralPath 'node_modules/esbuild')) { throw 'The locked workspace dependencies must already exist; see README.md.' }
foreach ($assetFile in @('artifacts/native/manifest.json','artifacts/rf/manifest.json','artifacts/scene/sander-garpai-rock-pvp/manifest.json','artifacts/ui/online/manifest.json','artifacts/ui/pvp-hud/manifest.json','artifacts/audio/pvp/manifest.json')) {
  if (-not (Test-Path -LiteralPath $assetFile -PathType Leaf)) { throw "Missing $assetFile. Prepare the task's verified inputs and run build_controls_ui.py / build_pvp_hud_ui.py / build_pvp_audio.mjs first." }
}
& $nodePath tools/build-web.mjs
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
$env:RF_PORT = [string]$Port
& $nodePath apps/server/dev-server.mjs
exit $LASTEXITCODE
