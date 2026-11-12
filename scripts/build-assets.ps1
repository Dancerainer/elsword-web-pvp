param([string]$Source = $env:WEB_PVP_ASSET_SOURCE)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$pythonPath = (Get-Command python -ErrorAction Stop).Source
if (-not $Source) { throw 'Pass -Source or set WEB_PVP_ASSET_SOURCE to the extracted asset directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $Source 'catalog.sqlite'))) { throw "Missing extracted 2016 catalog: $Source/catalog.sqlite" }
& $pythonPath tools/assets/character/build_rf.py --source-root $Source --runtime-profile packages/combat-core/rf-profile.json
if ($LASTEXITCODE -ne 0) { throw 'RF conversion failed.' }
& $pythonPath tools/assets/character/build_rf_fx.py --source-root $Source --profile packages/combat-core/rf-profile.json --index-output .cache/rf-generated-fx-index.json
if ($LASTEXITCODE -ne 0) { throw 'RF effect extraction failed.' }
& $pythonPath tools/assets/character/build_awakening_fx.py --source-root $Source
if ($LASTEXITCODE -ne 0) { throw 'Original RF awakening aura extraction failed.' }
& $pythonPath tools/assets/character/build_landing_fx.py --source-root $Source
if ($LASTEXITCODE -ne 0) { throw 'Original air-down landing effects extraction failed.' }
& $pythonPath tools/assets/character/build_rf_fx.py --source-root $Source --profile contracts/rf-buff-display-roots.json --output artifacts/rf-buff-display/fx --index-output .cache/rf-generated-buff-fx-index.json --additional-particle-script GameMinorParticle.txt
if ($LASTEXITCODE -ne 0) { throw 'Original buff display extraction failed.' }
New-Item -ItemType Directory -Path artifacts/rf/buff-fx -Force | Out-Null
Copy-Item -LiteralPath artifacts/rf-buff-display/fx/index.json -Destination artifacts/rf/buff-fx/index.json -Force
Get-ChildItem -LiteralPath artifacts/rf-buff-display/fx/textures -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path 'artifacts/rf/fx/textures' $_.Name) -Force
}
& $pythonPath tools/assets/character/build_shadow_weapon_resources.py --source-root $Source
if ($LASTEXITCODE -ne 0) { throw 'Original Shadow Buster / Weapon Break extraction failed.' }
New-Item -ItemType Directory -Path artifacts/rf/shadow-weapon-fx -Force | Out-Null
Copy-Item -LiteralPath artifacts/rf-shadow-weapon/fx/index.json -Destination artifacts/rf/shadow-weapon-fx/index.json -Force
foreach ($folder in @('meshes','textures')) {
  Get-ChildItem -LiteralPath (Join-Path 'artifacts/rf-shadow-weapon/fx' $folder) -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path 'artifacts/rf/fx' $folder) $_.Name) -Force
  }
}
& $pythonPath tools/assets/pvp_scene_pool.py --source-root (Split-Path -Parent $Source)
if ($LASTEXITCODE -ne 0) { throw 'Scene conversion failed.' }
& $pythonPath tools/assets/ui.py --source $Source
if ($LASTEXITCODE -ne 0) { throw 'UI extraction failed.' }
& $pythonPath tools/assets/build_awakening_bead_v15.py --source $Source --reference .cache/native-reference
if ($LASTEXITCODE -ne 0) { throw 'Original Raven third awakening bead extraction failed.' }
& $pythonPath tools/assets/rf_skill_ui.py --source $Source
if ($LASTEXITCODE -ne 0) { throw 'Skill UI extraction failed.' }
& $pythonPath tools/assets/skill_picker_ui.py --source $Source
if ($LASTEXITCODE -ne 0) { throw 'Skill tree UI extraction failed.' }
& $pythonPath tools/assets/damage_numbers.py --source-root $Source
if ($LASTEXITCODE -ne 0) { throw 'Damage number extraction failed.' }
& $pythonPath tools/assets/audio.py --source-root $Source --profile packages/combat-core/rf-profile.json --reference-sounds contracts/rf-reference-sounds.json
if ($LASTEXITCODE -ne 0) { throw 'Audio extraction failed.' }
Write-Output 'RF, original effects, scene, UI, skills and source audio rebuilt. Raw client inputs were read only.'
