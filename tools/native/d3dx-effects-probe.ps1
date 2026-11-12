param(
    [Parameter(Mandatory)][string]$BaselineRef,
    [string]$BaselineReportPath='',
    [string]$DllPath='asset_sources/client/data/d3dx9_43.dll',
    [string]$AssetRoot='asset_work',
    [string]$OutputPath='runtime/rf-native-d3dx-effects.json',
    [string]$ProbeSourcePath=''
)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repoRoot
$taskTempDir=Join-Path $repoRoot '.cache/native-d3dx-effects/tmp'
New-Item -ItemType Directory -Force -Path $taskTempDir | Out-Null
$env:TEMP=$taskTempDir
$env:TMP=$taskTempDir
$fixedProbeCommit=(& git rev-parse --verify --end-of-options ($BaselineRef+'^{commit}'))
if($LASTEXITCODE -ne 0 -or $fixedProbeCommit -notmatch '^[a-f0-9]{40,64}$'){throw 'BaselineRef must identify a local Git commit.'}
function Get-FrozenProjectFile([string]$gitPath,[string]$expectedSha256){
    # The live probe and baseline can evolve independently. Reproduce this
    # evidence using fixed project Git bytes without changing tracked files.
    $gitStart=New-Object Diagnostics.ProcessStartInfo
    $gitStart.FileName='git'
    $gitStart.Arguments='show '+$fixedProbeCommit+':'+$gitPath
    $gitStart.WorkingDirectory=$repoRoot
    $gitStart.UseShellExecute=$false
    $gitStart.CreateNoWindow=$true
    $gitStart.RedirectStandardOutput=$true
    $gitStart.RedirectStandardError=$true
    $gitStart.EnvironmentVariables['GIT_NO_LAZY_FETCH']='1'
    $gitStart.EnvironmentVariables['GIT_OPTIONAL_LOCKS']='0'
    $gitProcess=New-Object Diagnostics.Process
    $gitProcess.StartInfo=$gitStart
    $probeBytes=New-Object IO.MemoryStream
    try{
        if(-not $gitProcess.Start()){throw 'Could not read the frozen probe from local Git'}
        $gitError=$gitProcess.StandardError.ReadToEndAsync()
        $gitProcess.StandardOutput.BaseStream.CopyTo($probeBytes)
        $gitProcess.WaitForExit()
        if($gitProcess.ExitCode -ne 0){throw ('Frozen probe Git source unavailable: '+$gitError.Result)}
        $frozenBytes=$probeBytes.ToArray()
    }finally{$probeBytes.Dispose();$gitProcess.Dispose()}
    $frozenSha=[Security.Cryptography.SHA256]::Create()
    try{$frozenHash=[BitConverter]::ToString($frozenSha.ComputeHash($frozenBytes)).Replace('-','').ToLowerInvariant()}finally{$frozenSha.Dispose()}
    if($frozenHash -ne $expectedSha256){throw ('Frozen Git bytes do not match the original hash: '+$gitPath)}
    $frozenDir=Join-Path $repoRoot ('.cache/native-d3dx-effects/frozen-reference/'+$fixedProbeCommit)
    New-Item -ItemType Directory -Force -Path $frozenDir | Out-Null
    $frozenPath=Join-Path $frozenDir ([IO.Path]::GetFileName($gitPath))
    [IO.File]::WriteAllBytes($frozenPath,$frozenBytes)
    return $frozenPath
}
if(-not $ProbeSourcePath){
    $ProbeSourcePath=Get-FrozenProjectFile 'tools/native/d3dx-animation-probe.cs' '51f0e83e50429b096ec025b9a35ea717b223480b58d753a1967727f2849e1f54'
}
if([IntPtr]::Size -ne 4){
    $host32=Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    & $host32 -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -DllPath $DllPath -AssetRoot $AssetRoot -OutputPath $OutputPath -ProbeSourcePath $ProbeSourcePath
    if($LASTEXITCODE -ne 0){throw '32-bit D3DX effects probe failed'}
    exit
}
$dll=(Resolve-Path -LiteralPath $DllPath).Path
$dllHash=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if($dllHash -ne '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f'){throw 'Original 2016 D3DX DLL hash mismatch'}
$dllBytes=[IO.File]::ReadAllBytes($dll)
$peOffset=[BitConverter]::ToInt32($dllBytes,0x3c)
if([BitConverter]::ToUInt16($dllBytes,$peOffset+4) -ne 0x14c){throw 'Expected original x86 DLL'}
$probe=(Resolve-Path -LiteralPath $ProbeSourcePath).Path
$probeHash=(Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash.ToLowerInvariant()
$normalized=[Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($probe).Replace("`r`n","`n"))
$sha=[Security.Cryptography.SHA256]::Create()
try{$normalizedHash=[BitConverter]::ToString($sha.ComputeHash($normalized)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
if($normalizedHash -ne '51f0e83e50429b096ec025b9a35ea717b223480b58d753a1967727f2849e1f54'){throw 'Probe C# differs from the required source bytes; LF/CRLF is the only permitted normalization'}

# Exact catalog rows read through SQLite mode=ro. Each original entry's bytes
# are verified again before and after loading; no converted/repaired X is used.
$inputs=@(
    @{archive='data/data120.kom';ordinal=162;name='Raven_SI_A_RF_Thrust_Mesh01.X';sha256='a1c2383fcd2bbbbad8f61d2b01bb118ea9fe1fe4708944b1272f7af79c693563'},
    @{archive='data/data120.kom';ordinal=153;name='Raven_RRF_SI_SA_X_Crash_Mesh01.X';sha256='a5ef8e0f1c30c0e8991598eb2aadddd4797cc3da7a94ca7d7684fc12e14fe410'},
    @{archive='data/data120.kom';ordinal=154;name='Raven_RRF_SI_SA_X_Crash_Mesh02.X';sha256='eb696eec55059703eaa31ceafc3d8fce2a71761de092d2825e9a57778c604637'},
    @{archive='data/data120.kom';ordinal=155;name='Raven_RRF_SI_SA_X_Crash_Mesh03.X';sha256='d560606513dc37ff02595ca40fd10e82b7be77ecbb120198593c4a6e2935eeb1'},
    @{archive='data/data120.kom';ordinal=161;name='Raven_SI_A_RF_Shadow_Step_Mesh01.X';sha256='ef0820049869277f5275585cbd6b16006a73ca8d0452e8be8ad48ff16d547cee'},
    @{archive='data/data002.kom';ordinal=1095;name='Lire_SpecialAttackPierceArrow1a.X';sha256='33c903105f18f49e158a4b9c643bcb3504c899892fda3c4df0d7ec5b341b042a'},
    @{archive='data/data121.kom';ordinal=68;name='Lire_SI_A_Low_Kick_Mesh02.X';sha256='7cdcdf82c33e3e8e51377678d01491eb875295f2bb1ba0db4aa337eb30806a6b'},
    @{archive='data/data002.kom';ordinal=1132;name='MagnumBlaster_Mesh01.X';sha256='0e726e9e02ed735fd5ffbcfb137db9887b27f996e44dff4f61375932fdc84f02'}
)
$sources=@()
foreach($sourceCase in $inputs){
    $raw='raw/'+$sourceCase.archive+'/'+$sourceCase.name
    $path=(Resolve-Path -LiteralPath (Join-Path $AssetRoot $raw)).Path
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if($hash -ne $sourceCase.sha256){throw ('Original source hash mismatch: '+$sourceCase.name)}
    $sources += [ordered]@{archive=$sourceCase.archive;ordinal=$sourceCase.ordinal;name=$sourceCase.name;rawPath=$raw;path=$path;sha256=$hash;bytes=(Get-Item -LiteralPath $path).Length;role='requested-effect'}
}
$baselinePath=(Resolve-Path -LiteralPath (Join-Path $AssetRoot 'raw/data/data002.kom/Raven_Iron_Attack01.X')).Path
if((Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '19c642c08554e16546fdee6a639152e8fd3df15d83f7b18ea8af2d2b446dfa4f'){throw 'Baseline original IronAttack01 hash mismatch'}
Add-Type -Path $probe
$actualXs=@($sources | ForEach-Object {$_.path}) + @($baselinePath)
$traces=[D3dxAnimationProbe]::Run($dll,[string[]]$actualXs)
foreach($row in $traces){
    if($row.ContainsKey('source')){
        $hash=(Get-FileHash -LiteralPath $row['source'] -Algorithm SHA256).Hash.ToLowerInvariant()
        $row.Add('sourceSha256',$hash)
        $row.Add('sourceBytes',(Get-Item -LiteralPath $row['source']).Length)
        $row.Add('role',$(if($row['source'] -eq $baselinePath){'rerun-baseline'}else{'requested-effect'}))
    }
}
foreach($source in $sources){if((Get-FileHash -LiteralPath $source.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.sha256){throw ('Input changed during execution: '+$source.name)}}
if((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() -ne $dllHash){throw 'DLL changed during execution'}
$result=[ordered]@{
    schema='elsword.native-d3dx-effects.v1'
    evidenceKind='original-client-shipped-DLL execution; unchanged original 2016 effect X samples'
    fullClientExecuted=$false
    hostBits=32
    probeReferenceCommit=$fixedProbeCommit
    probeSourceSha256=$probeHash
    probeNormalizedLfSha256=$normalizedHash
    dll=[ordered]@{path=$dll;sha256=$dllHash;length=$dllBytes.Length;peMachine='0x014c';fileVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($dll).FileVersion}
    device='D3DDEVTYPE_NULLREF; hidden 1x1 HWND; no render; no Present'
    inputSelection='8 exact read-only catalog.sqlite rows; archive/ordinal and raw byte hashes frozen here; plus original IronAttack01 baseline'
    sourceFiles=$sources
    syntheticTraceCount=@($traces | Where-Object {-not $_.ContainsKey('source')}).Count
    originalTraceCount=@($traces | Where-Object {$_.ContainsKey('source')}).Count
    abiReference=[ordered]@{package='Microsoft.DXSDK.D3DX';version='9.29.952.8';packageSha256='ead0906ae8a26c18a7525da7490127a2110f7c58f18293738283e30e97c6ea4b';header='build/native/include/d3dx9anim.h';trackDescSize=32;trackPositionOffset=16}
    traces=$traces
}
function Test-SameJson($left,$right){
    if($null -eq $left -or $null -eq $right){return $null -eq $left -and $null -eq $right}
    if($left -is [ValueType] -and $right -is [ValueType]){return $left -ceq $right}
    if($left -is [string] -or $right -is [string]){return $left -ceq $right}
    if($left -is [System.Collections.IList] -and $right -is [System.Collections.IList]){
        if($left.Count -ne $right.Count){return $false}
        for($j=0;$j -lt $left.Count;$j++){if(-not (Test-SameJson $left[$j] $right[$j])){return $false}}
        return $true
    }
    $leftNames=@($left.PSObject.Properties | ForEach-Object {$_.Name})
    $rightNames=@($right.PSObject.Properties | ForEach-Object {$_.Name})
    if($leftNames.Count -ne $rightNames.Count){return $false}
    foreach($name in $leftNames){if($rightNames -cnotcontains $name -or -not (Test-SameJson $left.$name $right.$name)){return $false}}
    return $true
}
$baselineSha256='9935c49ebd4b5bde7401c14051a53e881e294237bf5c965d2b218e5503187719'
if($BaselineReportPath){
    $frozenBaseline=(Resolve-Path -LiteralPath $BaselineReportPath).Path
    if((Get-FileHash -LiteralPath $frozenBaseline -Algorithm SHA256).Hash.ToLowerInvariant() -ne $baselineSha256){throw 'Baseline report hash mismatch'}
}else{
    $frozenBaseline=Get-FrozenProjectFile 'reports/rf-native-d3dx-execution.json' $baselineSha256
}
$baseline=Get-Content -LiteralPath $frozenBaseline -Raw | ConvertFrom-Json
$current=$result | ConvertTo-Json -Depth 16 | ConvertFrom-Json
$baseByLabel=@{}
foreach($row in $baseline.traces){$baseByLabel[$row.label]=$row}
$compared=0
foreach($row in $current.traces){
    if(-not $baseByLabel.ContainsKey($row.label)){continue}
    $expected=$baseByLabel[$row.label]
    $row.PSObject.Properties.Remove('role')
    if($row.PSObject.Properties['source']){
        $row.source=$row.source.Replace('\','/').ToLowerInvariant()
        $expected.source=$expected.source.Replace('\','/').ToLowerInvariant()
    }
    if(-not (Test-SameJson $row $expected)){throw ('Original baseline output changed: '+$row.label)}
    $compared++
}
if($compared -ne 26){throw ('Expected 26 frozen baseline cases; found '+$compared)}
$result.Add('baselineComparison',[ordered]@{referenceReport='reports/rf-native-d3dx-execution.json';referenceCommit=$fixedProbeCommit;referenceReportSha256=$baselineSha256;rowsCompared=$compared;completeReturnedStateEqual=$true;pathNormalization='source path separators/case only; numeric values are exact JSON equality'})
$destination=[IO.Path]::GetFullPath($(if([IO.Path]::IsPathRooted($OutputPath)){$OutputPath}else{Join-Path $repoRoot $OutputPath}))
if(-not $destination.StartsWith($repoRoot.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must remain in this task worktree'}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
[IO.File]::WriteAllText($destination,($result | ConvertTo-Json -Depth 16),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Original DLL SHA256: '+$dllHash)
Write-Output ('Synthetic baseline traces: '+$result.syntheticTraceCount+'; original X traces: '+$result.originalTraceCount)
Write-Output ('Saved: '+$destination)
