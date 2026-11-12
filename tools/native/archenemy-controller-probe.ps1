param(
    [string]$DllPath='asset_sources/client/data/d3dx9_43.dll',
    [string]$SourcePath='asset_work/raw/data/data002.kom/Raven_OT_SP2_FlyingImpact_Effect.X',
    [string]$OutputPath='reports/rf-archenemy-initial-controller-v12.json'
)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repoRoot
if([IntPtr]::Size -ne 4){
    & (Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -DllPath $DllPath -SourcePath $SourcePath -OutputPath $OutputPath
    if($LASTEXITCODE -ne 0){throw 'Original32-bit Archenemy controller probe failed'}
    exit
}
$dll=(Resolve-Path -LiteralPath $DllPath).Path
$source=(Resolve-Path -LiteralPath $SourcePath).Path
$dllHash=(Get-FileHash -LiteralPath $dll).Hash.ToLowerInvariant()
$sourceHash=(Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
if($dllHash -ne '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f'){throw 'Original2016 DLL hash drift'}
if($sourceHash -ne '4590f245991762362d07c9c291728fae313f48f94f5ad5207d28906f4df844a1'){throw 'Original2016 Archenemy X hash drift'}
$probe=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'd3dx-animation-probe.cs')).Replace("`r`n","`n")
function TextHash([string]$text){$sha=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
$baseProbeHash=TextHash $probe
if($baseProbeHash -ne '2246efe28cff7d632aa2f644f8677b8313dd7b323b2c214c1fa9afaebab39f50'){throw 'Pinned original-library diagnostic source drift'}
$needle='                    row.Add("animations",animations);'
$replacement=@'
                    row.Add("animations",animations);
                    var tracks = new List<Dictionary<string,object>>();
                    for(uint track=0;track<2;track++) {
                        TrackDesc desc; int th=V<GetTrack>(controller,24)(controller,track,out desc);
                        IntPtr trackSet; int sh=V<GetSet>(controller,23)(controller,track,out trackSet);
                        string trackName=null;
                        if(sh>=0&&trackSet!=IntPtr.Zero){trackName=Marshal.PtrToStringAnsi(V<NameResult>(trackSet,3)(trackSet));V<Release>(trackSet,2)(trackSet);}
                        tracks.Add(new Dictionary<string,object>{{"track",track},{"descHresult",th},{"animationHresult",sh},{"name",trackName},{"enable",desc.Enable},{"weight",desc.Weight},{"speed",desc.Speed},{"position",desc.Position}});
                    }
                    row.Add("initialTracks",tracks);
'@
if($probe.Split([string[]]@($needle),[StringSplitOptions]::None).Count -ne 2){throw 'Unique initial-track diagnostic insertion required'}
$probe=$probe.Replace($needle,$replacement.Replace("`r`n","`n"))
$taskTemp=Join-Path $repoRoot '.cache/archenemy-controller-probe'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
$env:TEMP=$taskTemp;$env:TMP=$taskTemp
$probePath=Join-Path $taskTemp 'probe.cs'
[IO.File]::WriteAllText($probePath,$probe,(New-Object Text.UTF8Encoding($false)))
Add-Type -Path $probePath
$rows=[D3dxAnimationProbe]::Run($dll,[string[]]@($source))
$row=@($rows | Where-Object {$_.ContainsKey('source')})
if($row.Count -ne 1){throw 'Exactly one original Archenemy input required'}
if((Get-FileHash -LiteralPath $dll).Hash.ToLowerInvariant() -ne $dllHash -or (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() -ne $sourceHash){throw 'Read-only source changed during probe'}
$result=[ordered]@{
    schemaVersion=1
    evidenceClass='target2016-shipped-DLL-executed; original-X initial controller tracks'
    fullClientExecuted=$false
    targetCombatMeasured=$false
    label=$row[0]['label']
    source=$source
    sha256=$sourceHash
    dllSha256=$dllHash
    baseProbeNormalizedLfSha256=$baseProbeHash
    probeNormalizedLfSha256=(TextHash $probe)
    device='D3DDEVTYPE_NULLREF; hidden1x1HWND; no render/Present'
    animations=@($row[0]['animations'] | ForEach-Object {$_.name})
    initialTracks=$row[0]['initialTracks']
}
$output=[IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
[IO.File]::WriteAllText($output,($result | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Original Archenemy controller summary: '+$output)
