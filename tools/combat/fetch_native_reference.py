"""Bounded pinned client-source snapshot, isolated from all upstream caches."""
from pathlib import Path
import hashlib
import json
import subprocess
import os

ROOT = Path(__file__).resolve().parents[2]
COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
REPO = ROOT / '.cache/native-v5'
READONLY_SNAPSHOT = Path('./.cache/v5-source')
REMOTE = os.environ.get('WEB_PVP_REFERENCE_REPOSITORY')
FILES = ['X2Lib/' + n for n in ('X2GURaven.cpp', 'X2GUUser.cpp', 'X2GUUser.h',
    'X2EffectSet.cpp', 'X2DamageEffect.cpp', 'X2DamageManager.cpp', 'X2Game.cpp',
    'X2Game.h', 'X2Def.h', 'X2GageManager.cpp', 'X2GageUI.cpp', 'X2DamageEffect.h')]
FILES += ['KTDXLIB/' + n for n in ('KTDGParticleSystem.cpp', 'KTDGParticleSystem.h',
    'KTDGXMeshPlayer.cpp', 'KTDGXSkinAnim.cpp', 'KTDXDeviceXSkinMesh.cpp',
    'KTDIDevice.cpp', 'KTDIDevice.h', 'KTDIDeviceWinKey.cpp', 'KTDIDeviceWinKey.h',
    'KTDXCollision.cpp', 'KTDXCollision.h')]
FILES += ['ElswordExport/ExportXFile.cpp', 'ElswordExport/XSkinExp.cpp', 'KTDXLIB/KTDXAnimationController.cpp']

def main():
    destination = ROOT / '.cache/native-reference'
    destination.mkdir(parents=True, exist_ok=True)
    if not (REPO / '.git').exists():
        if not REMOTE: raise ValueError('Set WEB_PVP_REFERENCE_REPOSITORY to an authorized reference repository')
        subprocess.run(['git', 'clone', '--no-checkout', '--filter=blob:none', '--depth=1', REMOTE, str(REPO)], check=True)
    if subprocess.run(['git', 'cat-file', '-e', COMMIT + '^{commit}'], cwd=REPO, capture_output=True).returncode:
        subprocess.run(['git', 'fetch', '--depth=1', 'origin', COMMIT], cwd=REPO, check=True)
    tree = subprocess.check_output(['git', 'ls-tree', '-r', COMMIT], cwd=REPO, text=True)
    objects = {line.split('\t')[1]: line.split('\t')[0].split()[-1] for line in tree.splitlines()}
    evidence = {'commit': COMMIT, 'repository': 'reference-v5', 'targetVersion': 'reference-V5, not 2016 source', 'files': []}
    for short in FILES:
        path = 'JP_TW_EU_CN_US/Trunk/' + short
        if path not in objects:
            continue
        output = destination / short
        original = READONLY_SNAPSHOT / path
        if original.is_file():
            data = original.read_bytes()
        elif output.is_file():
            data = output.read_bytes()
        else:
            for attempt in range(3):
                try:
                    data = subprocess.check_output(['git', '-c', 'http.sslBackend=openssl', 'show', COMMIT + ':' + path], cwd=REPO)
                    break
                except subprocess.CalledProcessError:
                    if attempt == 2:
                        raise
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if blob != objects[path]:
            raise ValueError('Pinned Git blob mismatch: ' + path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        evidence['files'].append({'path': path, 'gitBlob': blob, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        print(short, len(data), flush=True)
    (ROOT / 'contracts/rf-native-reference.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
