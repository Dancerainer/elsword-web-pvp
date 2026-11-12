param([int]$Port = 4196)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is missing. Install Node.js 24.' }
$required = @('artifacts/rf/manifest.json','artifacts/rf/buff-fx/index.json','artifacts/rf/shadow-weapon-fx/index.json','artifacts/scene/sander-garpai-rock-pvp/manifest.json','artifacts/ui/manifest.json','artifacts/ui/skills/catalog.json','artifacts/audio/manifest.json','artifacts/native/manifest.json','artifacts/native/geometry.wasm','artifacts/native/camera.wasm','artifacts/native/commands.wasm','artifacts/native/skills.wasm','artifacts/native/skill-values.wasm','artifacts/native/effect-random.wasm')
foreach ($assetFile in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskRoot $assetFile))) { throw "Missing $assetFile. Run scripts/build-assets.ps1 for game assets and tools/native/build_runtime.py for native modules; see docs/NATIVE_SOURCE_ROUTE.md." }
}
foreach ($assetFile in @('artifacts/ui/skill-picker/manifest.json','artifacts/ui/damage-numbers/manifest.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskRoot $assetFile))) { throw "Missing $assetFile. Run scripts/build-assets.ps1." }
}
if (-not (Test-Path -LiteralPath 'node_modules/esbuild')) {
  $pnpmPath = (Get-Command pnpm -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath $pnpmPath)) { throw 'pnpm is missing. Install pnpm 10 before running this script.' }
  & $pnpmPath install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $nodePath tools/build-web.mjs
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
$env:RF_PORT = [string]$Port
& $nodePath apps/server/dev-server.mjs
exit $LASTEXITCODE
