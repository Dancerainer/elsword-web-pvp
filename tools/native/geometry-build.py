"""Compile unchanged pinned V5 geometry methods, with a small WASM host surface.

Original bytes are generated into ignored artifacts, never added to Git.
Whole-file hashes and exact line ranges make extraction fail closed on drift.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
HASHES = {
    'KTDGLineMap.h': '03e819b20d42a502a2d6cafb72fb1cefa28e10d98bfe91b95655c7b0a9dbdf32',
    'KTDGLineMap.cpp': '3306c7370a282b18137c676db2491b0fed4b2939cc1015876965e506cb8e23b2',
    'KTDXCollision.h': 'e29238e40c77e5ddca97de9cf1713677669cac863565dc7d1ef92bb77288313b',
    'KTDXCommonFunc.h': 'b659140c28707eae0b3c1156e73cb4cd72f4c4eb940263375bfce99da799b084',
    'KTDX.h': '0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf',
    'Always.h': 'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069',
}
# Exact full functions (including conditional signatures); no substitutions inside.
FRAGMENTS = {
    'COMMON': [('KTDXCommonFunc.h',311,315,'GetDistance'),('KTDXCommonFunc.h',341,346,'GetDistance3Sq'),('KTDXCommonFunc.h',348,354,'OUTOF_RANGE')],
    'COLLISION': [('KTDXCollision.h',1491,1510,'SphereToSphere'),('KTDXCollision.h',1534,1612,'LineToSphere'),('KTDXCollision.h',1662,1771,'LineToLine.scalar'),('KTDXCollision.h',1773,1779,'LineToLine.vector'),('KTDXCollision.h',1938,1970,'FindNearestPointOnLineSegment'),('KTDXCollision.h',1972,2044,'FindNearestPointOfParallelLineSegments'),('KTDXCollision.h',2046,2105,'AdjustNearestPoints')],
    'LINE_ENUM': [('KTDGLineMap.h',40,60,'LINE_TYPE')],
    'LINE_GROUP': [('KTDGLineMap.h',240,276,'LineGroupID')],
    'LINE_INLINE': [('KTDGLineMap.h',957,992,'IsOnLine'),('KTDGLineMap.h',1092,1101,'GetLineData'),('KTDGLineMap.h',1442,1481,'GetNearestLine'),('KTDGLineMap.h',1547,1587,'VerifyLine'),('KTDGLineMap.h',1592,1629,'GetLengthToLine'),('KTDGLineMap.h',1710,1865,'GetNearestWithBound')],
    'LINE_OUT': [('KTDGLineMap.cpp',998,1103,'GetLandPosition'),('KTDGLineMap.cpp',1106,1350,'CanDown'),('KTDGLineMap.cpp',1355,1414,'CanPassUp'),('KTDGLineMap.cpp',1466,1479,'GetLineGroupIncludesLineData'),('KTDGLineMap.cpp',1735,1840,'ReBuildLineGroup')],
}
MACROS = [
    {'name':'X2OPTIMIZE_LINEMAP_OPTIMIZE_AND_BUG_FIX','file':'KTDX.h','line':349},
    {'name':'MONSTER_ROAD','file':'Always.h','line':2914},
    {'name':'UNIT_ROAD','file':'Always.h','line':2915},
    {'name':'FIX_LINE_TYPE_WALL','file':'Always.h','line':3313},
    {'name':'X2OPTIMIZE_DAMAGEEFFECT_COLLISION','file':'KTDX.h','line':320},
    {'name':'X2OPTIMIZE_LINEMAP_LINEGROUP','file':'KTDX.h','line':298},
]

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def extract(source_dir: Path, compat: Path) -> tuple[bytes, dict]:
    data = {}
    for name, expected in HASHES.items():
        raw = (source_dir/name).read_bytes()
        if sha(raw) != expected:
            raise ValueError(f'Pinned source hash mismatch: {name}')
        data[name] = raw
    for m in MACROS:
        line = data[m['file']].splitlines()[m['line']-1]
        if b'#define' not in line or m['name'].encode() not in line:
            raise ValueError(f'Macro provenance mismatch: {m}')
    output = compat.read_bytes()
    function_info = []
    for marker, entries in FRAGMENTS.items():
        if output.count(f'// @@{marker}@@'.encode()) != 1:
            raise ValueError(f'Missing or duplicate compatibility marker: {marker}')
        parts = []
        for file, start, end, name in entries:
            lines = data[file].splitlines(keepends=True)
            fragment = b''.join(lines[start-1:end])
            if name.split('.')[0].encode() not in fragment:
                raise ValueError(f'Function identity mismatch: {name}')
            # Body hash independently excludes signatures and conditional declarations.
            body_start, body_end = fragment.find(b'{'), fragment.rfind(b'}')+1
            function_info.append({'name':name,'file':file,'startLine':start,'endLine':end,
                'bytes':len(fragment),'sha256':sha(fragment),
                'bodySha256':sha(fragment[body_start:body_end])})
            parts.append(fragment)
        output = output.replace(f'// @@{marker}@@'.encode(), b'\r\n'.join(parts))
    contract = {'schemaVersion':1,'sourceVersion':'V5 candidate, not target 2016 verified',
        'sourceCommit':COMMIT,'sourcePathPrefix':'JP_TW_EU_CN_US/Trunk/KTDXLIB/',
        'sourceFileSha256':HASHES,'functions':function_info,'selectedMacros':MACROS,
        'compatSha256':sha(compat.read_bytes()),'generatedCppSha256':sha(output),
        'compatibilityBoundary':['D3DXVECTOR3 storage/operators and float vector math',
            'Fixed pointer-list storage, 4096-line limit',
            'Call compiled global constructors once per WASM instance, before loading lines',
            'Reject reciprocal cyclic groups before unchanged n-member stack builder',
            'No-op profiling and release ASSERT',
            'Loader defaults and bbox/direction preparation',
            'Extern C exports, input validation, result copying'],
        'numericMode':'IEEE float32 locals/arguments; no fast-math or FP contraction; fabs double promotion retained',
        'unverified':['2016 compiled macro choices and binary method equivalence',
            'D3DX vector helper rounding vs original Win32 implementation',
            'Moving line animation/loading/PhysicProcess/state machine are outside this module']}
    return output, contract

def main():
    root=Path(__file__).resolve().parents[2]
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-dir',type=Path,default=root/'.cache/native-reference/KTDXLIB')
    p.add_argument('--out-dir',type=Path,default=root/'artifacts/native/geometry')
    p.add_argument('--zig',type=Path)
    p.add_argument('--extract-only',action='store_true')
    p.add_argument('--native',action='store_true',help='Also build original methods into a native fixture executable')
    args=p.parse_args()
    # Compiler writes only task-owned caches, even when its executable is shared read-only.
    import os
    os.environ['ZIG_LOCAL_CACHE_DIR']=str(root/'.cache/native-geometry/zig-local')
    os.environ['ZIG_GLOBAL_CACHE_DIR']=str(root/'.cache/native-geometry/zig-global')
    generated, contract=extract(args.source_dir,Path(__file__).with_name('geometry-compat.hpp'))
    args.out_dir.mkdir(parents=True,exist_ok=True)
    cpp=args.out_dir/'geometry.generated.cpp'; cpp.write_bytes(generated)
    if not args.extract_only:
        if not args.zig or not args.zig.is_file():
            p.error('--zig must name an existing official Zig compiler (no installation performed)')
        wasm=args.out_dir/'geometry.wasm'
        flags=['c++',str(cpp),'-target','wasm32-freestanding','-nostdlib','-fno-exceptions',
            '-fno-rtti','-ffp-contract=off','-fno-fast-math','-O2','-Wno-invalid-utf8',
            '-Wno-extra-tokens','-Wl,--no-entry','-Wl,--export-memory','-Wl,--export=__wasm_call_ctors','-Wl,--initial-memory=2097152']
        for name in ['reset','add_line','build_line_groups','query_nearest','query_line_group','distance_between','query_support','query_down','query_land','can_pass_up','line_collision','sphere_collision','line_sphere_collision','result_ptr']:
            flags.append(f'-Wl,--export={name}')
        flags+=['-o',str(wasm)]
        run=subprocess.run([str(args.zig),*flags],capture_output=True,text=True,encoding='utf-8',errors='replace')
        if run.returncode:
            raise RuntimeError(run.stdout+run.stderr)
        contract['compiler']={'name':'Zig','version':subprocess.check_output([str(args.zig),'version'],text=True).strip(),
            'exeSha256':sha(args.zig.read_bytes()),'flags':flags[2:-2]}
        contract['wasm']={'sha256':sha(wasm.read_bytes()),'bytes':wasm.stat().st_size}
        if args.native:
            native_cpp=args.out_dir/'geometry.native.generated.cpp'
            cli=Path(__file__).with_name('geometry-cli.cpp')
            native_cpp.write_bytes(generated+b'\n'+cli.read_bytes())
            exe=args.out_dir/'geometry-native.exe'
            native_flags=['c++',str(native_cpp),'-target','x86_64-windows-gnu','-fno-exceptions',
                '-fno-rtti','-ffp-contract=off','-fno-fast-math','-O2','-Wno-invalid-utf8','-Wno-extra-tokens','-o',str(exe)]
            native_run=subprocess.run([str(args.zig),*native_flags],capture_output=True,text=True,encoding='utf-8',errors='replace')
            if native_run.returncode:
                raise RuntimeError(native_run.stdout+native_run.stderr)
            contract['native']={'sha256':sha(exe.read_bytes()),'bytes':exe.stat().st_size,'flags':native_flags[2:-2],
                'cliCompatSha256':sha(cli.read_bytes())}
    (args.out_dir/'source-contract.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(args.out_dir),'functions':len(contract['functions']),'wasm':contract.get('wasm')},ensure_ascii=True))

if __name__=='__main__':
    main()
