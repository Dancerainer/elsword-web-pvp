$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if([IntPtr]::Size -ne 4){& (Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath;if($LASTEXITCODE -ne 0){throw '32-bit probe failed'};exit}
$dll='asset_sources/client/data/d3dx9_43.dll'
$hash=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if($hash -ne '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f'){throw 'Frozen target2016 DLL required'}
$source=Join-Path $root 'tools/native/d3dx-reaction-clock-v17-probe.cs'
Add-Type -Path $source
$rows=[D3dxReactionClockV17Probe]::Run($dll)
$destination=Join-Path $root 'reports/rf-guardian-direct-clock-dll-v17.json'
[IO.File]::WriteAllText($destination,([ordered]@{schema='elsword.guardian-direct-clock-dll.v17';fullClientExecuted=$false;evidence='target2016 shipped D3DX DLL, synthetic track events; no X loader or rendering';dllSha256=$hash;probeSourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();rows=$rows}|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
Write-Output ('Synthetic direct-clock rows: '+$rows.Count)
