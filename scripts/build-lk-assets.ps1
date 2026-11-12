param(
  [string]$Source = 'asset_work',
  [string]$NativeEvidenceSource = '.cache/inputs/native-d3dx',
  [string]$LandingConversionSource = '.cache/inputs/landing-fx',
  [string]$NativeSource = '.cache/native-reference',
  [string]$OutputRoot = 'artifacts',
  [switch]$PrerequisitesOnly,
  [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $taskRoot
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path
$taskPrefix = $taskRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
$outputPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $OutputRoot))
if (-not $outputPath.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputRoot must be a directory inside this task worktree.'
}
if ($outputPath.StartsWith($sourceRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputRoot cannot overlap the read-only extracted source.'
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'catalog.sqlite'))) { throw 'Missing read-only target2016 catalog.' }
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$cachePath = Join-Path $taskRoot '.cache/lk'
$characterPath = Join-Path $outputPath 'lk'
$skillPath = Join-Path $outputPath 'ui/skills/lk'
$profilePath = Join-Path $taskRoot 'packages/combat-core/lk-profile.json'
$landingPath = Join-Path $taskRoot 'artifacts/lk-presentation-prerequisites/landing-fx'

# These measured bytes are not recoverable from Git alone. Copies must match
# the tracked request/key manifests exactly before any converter consumes them.
$evidenceRows = @(
  @{ Hash = '7019b7bc9d63722352c60c1e135726c6af73170ee6a9802fce0805c64ca33917'; Bytes = 12573809; File = 'full-skill-keyframes.json' },
  @{ Hash = 'd78ad211d8135fed4da7c2872807147818e4944217ec34f497aefbd78918f7c4'; Bytes = 441491; File = 'shadow-weapon-keyframes.json' },
  @{ Hash = '854302401e238b7173a7fc2ea0b18e69b1209da871b0cd5acc4df17a54df0c58'; Bytes = 79481; File = 'skill-v11-keyframes.json' },
  @{ Hash = 'fc0ab6d8e2b6541fd819f429eebf4e671fd882f5894c0656f0f5d95f5e0dbc9e'; Bytes = 4876587; File = 'lk-fx-keyframes-v2.json' }
)
$stages = @(
  @{ Label = 'Prepare source-hashed target declarations'; Args = @('tools/combat/prepare_lk_declarations.py','--source-root',$sourceRoot,'--output',$cachePath) },
  @{ Label = 'Bootstrap original body and four motion files'; Args = @('tools/assets/character/build_lk.py','--source-root',$sourceRoot,'--output',$characterPath) },
  @{ Label = 'Bind target profile to original motion periods'; Args = @('tools/combat/build_lk_profile.py','--cache',$cachePath,'--assets',$characterPath,'--output',$profilePath) },
  @{ Label = 'Build profile-dependent character pose resources'; Args = @('tools/assets/character/build_lk.py','--source-root',$sourceRoot,'--output',$characterPath,'--runtime-profile',$profilePath) },
  @{ Label = 'Convert target effect closure'; Args = @('tools/assets/character/build_lk_fx.py','--source-root',$sourceRoot,'--output',(Join-Path $characterPath 'fx'),'--profile',$profilePath,'--landing-conversion-source',$landingPath) },
  @{ Label = 'Freeze original effect fields in headless profile'; Args = @('tools/combat/build_lk_profile.py','--cache',$cachePath,'--assets',$characterPath,'--output',$profilePath) },
  @{ Label = 'Export original icons and English skill names'; Args = @('tools/assets/lk_skill_ui.py','--source',$sourceRoot,'--profile',$profilePath,'--output',$skillPath,'--portraits',(Join-Path $characterPath 'ui')) },
  @{ Label = 'Verify pinned UI flicker consumer'; Args = @('tools/combat/fetch_lk_sword_ui_sources.py') },
  @{ Label = 'Extract original Way of Sword HUD'; Args = @('tools/assets/build_lk_sword_ui.py','--source',$sourceRoot,'--native-source',$NativeSource,'--output',(Join-Path $outputPath 'ui/way-of-sword')) },
  @{ Label = 'Copy source audio with page CRC and SHA checks'; Args = @('tools/assets/build_lk_audio.py','--source-root',$sourceRoot,'--profile',$profilePath,'--output',(Join-Path $characterPath 'audio')) },
  @{ Label = 'Seal complete runtime manifest and effect-owner pose coverage'; Args = @('tools/assets/finalize_lk_assets.py','--output',$characterPath,'--profile',$profilePath) }
)
if ($PlanOnly) {
  Write-Output "Task output: $outputPath"
  Write-Output "Read-only source: $sourceRoot"
  Write-Output "Read-only native evidence: $NativeEvidenceSource"
  Write-Output "Read-only hash-frozen common DropDown conversion: $LandingConversionSource"
  foreach ($stage in $stages) { Write-Output ($stage.Label + ': ' + ($stage.Args -join ' ')) }
  return
}
& $pythonPath -c 'import numpy, PIL'
if ($LASTEXITCODE -ne 0) { throw 'Python requires existing numpy and Pillow; this script does not install dependencies.' }
$nativeOutput = Join-Path $taskRoot 'artifacts/native-d3dx'
New-Item -ItemType Directory -Path $nativeOutput -Force | Out-Null
foreach ($row in $evidenceRows) {
  $sourceFile = Join-Path $NativeEvidenceSource $row.File
  if (-not (Test-Path -LiteralPath $sourceFile)) { throw "Missing measured native key prerequisite: $sourceFile" }
  $sourceItem = Get-Item -LiteralPath $sourceFile
  $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $row.Hash -or $sourceItem.Length -ne $row.Bytes) { throw "Measured key provenance differs: $sourceFile" }
  Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $nativeOutput $row.File) -Force
}
$requestName = 'skill-v11-sources-request.json'
$requestSource = Join-Path $NativeEvidenceSource $requestName
if ((Get-FileHash -LiteralPath $requestSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne '6cfca2ca5eef6e909622a03504eacf0c4158e04aa5f2578d778ac69b435b3503') { throw 'Measured skill-v11 request provenance differs.' }
Copy-Item -LiteralPath $requestSource -Destination (Join-Path $nativeOutput $requestName) -Force
# The original landing key artifact may be unavailable locally. This single
# original conversion has independent tracked GLB, pose and index SHA evidence;
# it contains no RF combat profile. The converter also rechecks original source
# declaration, mesh/texture hashes and measured native animation period/ticks.
$landingRows = @(
  @{ File = 'index.json'; Hash = '0a9153e7c969b2e492c1ef4a3ef15ada9af6796dc572381eb705a05b59e9f603' },
  @{ File = 'meshes/Effect_ElSword_dropdown.glb'; Hash = '2591713f578729867915021be4f0cffc4309b8d62a477402c027c97fe488645b' },
  @{ File = 'meshes/Effect_ElSword_dropdown.pose.json'; Hash = '1a1a0f379966158993bcc45dfba9647f2c376472b7d3147507034c04ab30fbcd' }
)
foreach ($row in $landingRows) {
  $inputPath = Join-Path $LandingConversionSource $row.File
  if (-not (Test-Path -LiteralPath $inputPath) -or (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.Hash) { throw "Common DropDown conversion prerequisite SHA differs or is absent: $inputPath" }
}
foreach ($row in $landingRows) {
  $targetPath = Join-Path $landingPath $row.File
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $LandingConversionSource $row.File) -Destination $targetPath -Force
}
if ($PrerequisitesOnly) {
  Write-Output 'Original native-key and common DropDown conversion prerequisites verified and copied into task artifacts.'
  return
}
foreach ($stage in $stages) {
  Write-Output $stage.Label
  $stageArguments = $stage.Args
  & $pythonPath @stageArguments
  if ($LASTEXITCODE -ne 0) { throw ('LK build failed: ' + $stage.Label) }
}
Write-Output 'LK target declarations, body, runtime, effects, UI, audio and manifest rebuilt inside this task. Original inputs stayed read-only.'
