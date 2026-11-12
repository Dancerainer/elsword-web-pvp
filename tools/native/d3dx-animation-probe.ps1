param(
    [string]$DllPath='asset_sources/client/data/d3dx9_43.dll',
    [string]$OutputPath='.cache/native-d3dx/animation-result.json',
    [string]$KeyframesPath='artifacts/native-d3dx/keyframes.json',
    [string]$ManifestPath='reports/rf-native-d3dx-keyframes.json',
    [string]$SourceManifestPath=''
)
$ErrorActionPreference='Stop'
$repoRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repoRoot
if([IntPtr]::Size -ne 4){
    $host32=Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    & $host32 -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -DllPath $DllPath -OutputPath $OutputPath -KeyframesPath $KeyframesPath -ManifestPath $ManifestPath -SourceManifestPath $SourceManifestPath
    if($LASTEXITCODE -ne 0){throw '32-bit D3DX probe failed'}
    exit
}
$dll=(Resolve-Path -LiteralPath $DllPath).Path
$bytes=[IO.File]::ReadAllBytes($dll)
$peOffset=[BitConverter]::ToInt32($bytes,0x3c)
$machine=[BitConverter]::ToUInt16($bytes,$peOffset+4)
if($machine -ne 0x14c){throw ('Expected original x86 DLL; PE Machine='+$machine)}
if((Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f'){throw 'Only the frozen target2016 D3DX DLL may execute this probe'}
Add-Type -Path (Join-Path $PSScriptRoot 'd3dx-animation-probe.cs')
$actualXs=@('asset_work/raw/data/data002.kom/Raven_Iron_Attack01.X')
if($SourceManifestPath){
    $requestPath=[IO.Path]::GetFullPath((Join-Path $repoRoot $SourceManifestPath))
    if(-not $requestPath.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Source request must belong to this task'}
    $request=Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
    if($request.schema -ne 'elsword.native-d3dx-source-request.v1'){throw 'Invalid frozen original-X request'}
    $actualXs=@()
    foreach($source in $request.sources){
        $original=(Resolve-Path -LiteralPath $source.source).Path
        if(-not $original.StartsWith('asset_work/raw/',[StringComparison]::OrdinalIgnoreCase)){throw 'Original-X request escapes read-only raw asset source'}
        if((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.sourceSha256 -or (Get-Item -LiteralPath $original).Length -ne $source.sourceBytes){throw 'Original-X request source hash/size mismatch'}
        $actualXs+=,$original
    }
}
$traces=[D3dxAnimationProbe]::Run($dll,[string[]]$actualXs)
foreach($row in $traces){if($row.ContainsKey('source')){$row.Add('sourceSha256',(Get-FileHash -LiteralPath $row['source'] -Algorithm SHA256).Hash.ToLowerInvariant());$row.Add('sourceBytes',(Get-Item -LiteralPath $row['source']).Length)}}
$result=[ordered]@{
    schema='elsword.native-d3dx-execution.v1'
    evidenceKind='original-client-shipped-DLL execution; synthetic SRT probes'
    fullClientExecuted=$false
    hostBits=32
    probeSourceSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'd3dx-animation-probe.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
    dll=[ordered]@{path=$dll;sha256=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant();length=$bytes.Length;peMachine='0x014c';fileVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($dll).FileVersion}
    abiReference=[ordered]@{package='Microsoft.DXSDK.D3DX';version='9.29.952.8';packageSha256='ead0906ae8a26c18a7525da7490127a2110f7c58f18293738283e30e97c6ea4b';header='build/native/include/d3dx9anim.h';trackDescSize=32;trackPositionOffset=16}
    traces=$traces
}
function Save-TaskJson([string]$path,$value){
    $destination=[IO.Path]::GetFullPath((Join-Path $repoRoot $path))
    if(-not $destination.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Probe output must stay inside this task worktree'}
    $outputParent=Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
    [IO.File]::WriteAllText($destination,($value | ConvertTo-Json -Depth 14),(New-Object Text.UTF8Encoding($false)))
    return $destination
}
# Full author key arrays stay in ignored task artifacts. The tracked evidence
# retains counts and hashes. Extraction is from original Get*Keys, not a local
# matrix decomposition, including source matrices that contain shear.
$sources=@()
$manifestSources=@()
foreach($row in $traces){if($row.ContainsKey('source') -and $row.ContainsKey('animations')){
    $animations=@()
    $manifestAnimations=@()
    foreach($animation in $row['animations']){
        $channels=@()
        $manifestChannels=@()
        foreach($channel in $animation['channels']){
            $keys=[ordered]@{name=$channel['name']}
            $summaries=[ordered]@{name=$channel['name']}
            foreach($property in @('scaleKeys','rotationKeys','translationKeys')){
                $summary=$channel[$property]
                $keys[$property]=[ordered]@{count=$summary['count'];stride=$summary['keyStrideFloats'];keys=$summary['keys'];keyBytesBase64=$summary['keyBytesBase64'];keyBytesSha256=$summary['keyBytesSha256']}
                $summary.Remove('keys') | Out-Null
                $summary.Remove('keyBytesBase64') | Out-Null
                $summaries[$property]=$summary
            }
            $channels+=,$keys
            $manifestChannels+=,$summaries
        }
        $animations+=,[ordered]@{index=$animation['index'];name=$animation['name'];playbackType=$animation['playbackType'];period=$animation['period'];ticksPerSecond=$animation['ticksPerSecond'];channels=$channels}
        $manifestAnimations+=,[ordered]@{index=$animation['index'];name=$animation['name'];playbackType=$animation['playbackType'];period=$animation['period'];ticksPerSecond=$animation['ticksPerSecond'];channels=$manifestChannels}
    }
    $sources+=,[ordered]@{source=$row['source'];sourceSha256=$row['sourceSha256'];sourceBytes=$row['sourceBytes'];animations=$animations}
    $manifestSources+=,[ordered]@{source=$row['source'];sourceSha256=$row['sourceSha256'];sourceBytes=$row['sourceBytes'];animations=$manifestAnimations}
}}
$keyframes=[ordered]@{schema='elsword.native-d3dx-keyframes.v1';evidenceKind='original-client-shipped-DLL GetScaleKeys/GetRotationKeys/GetTranslationKeys';
    fullClientExecuted=$false;dllSha256=$result.dll.sha256;probeSourceSha256=$result.probeSourceSha256;
    keyTimeUnit='source ticks / measured ticksPerSecond';keyByteEncoding='base64 little-endian float32 SDK key structs; canonical bytes preserve signed zero';
    rotationConvention='native D3DX raw row XYZW; conjugate XYZ once for column pose';sources=$sources}
$keyframesDestination=Save-TaskJson $KeyframesPath $keyframes
$manifest=[ordered]@{schema='elsword.native-d3dx-keyframes-manifest.v1';evidenceKind=$keyframes.evidenceKind;fullClientExecuted=$false;
    dll=$result.dll;probeSourceSha256=$result.probeSourceSha256;keyTimeUnit=$keyframes.keyTimeUnit;keyByteEncoding=$keyframes.keyByteEncoding;rotationConvention=$keyframes.rotationConvention;
    artifact=[ordered]@{path=$KeyframesPath;sha256=(Get-FileHash -LiteralPath $keyframesDestination -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $keyframesDestination).Length};sources=$manifestSources}
Save-TaskJson $ManifestPath $manifest | Out-Null
$destination=Save-TaskJson $OutputPath $result
Write-Output ('D3DX DLL executed: '+$dll)
Write-Output ('Trace count: '+$traces.Count)
Write-Output ('Saved: '+$destination)
Write-Output ('Original DLL keyframes: '+$keyframesDestination)
