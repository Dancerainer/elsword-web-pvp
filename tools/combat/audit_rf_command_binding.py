"""Search the readonly 2016 catalog and executable for RF command names.

Constant occurrences are evidence of declarations, not callback bindings.
The executable is read as data and is never launched or patched.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['EffectSet_ROT_DASHJUMP_ZXX', 'DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX',
         'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX', 'UPDOWN_CANCEL_AFTER']


def occurrences(data, needle):
    offsets = []
    position = 0
    while True:
        position = data.find(needle, position)
        if position < 0:
            return offsets
        offsets.append(position)
        position += len(needle)


def audit(upstream, executable):
    upstream = upstream.resolve()
    result = {'schema': 'rf-command-binding-audit-v7', 'targetClientMeasured': False,
              'searchKind': 'readonly constant occurrence search; not execution or native callback inference',
              'names': NAMES, 'filesChecked': 0, 'byteCount': 0, 'matches': []}
    with sqlite3.connect((upstream / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = list(db.execute("SELECT name,raw_path,sha256 FROM assets WHERE status='ok' AND (name LIKE '%.lua' OR name LIKE '%.kl')"))
        for row in rows:
            path = (upstream / row['raw_path']).resolve()
            if not path.is_relative_to(upstream / 'raw'):
                raise ValueError('source path outside readonly raw')
            data = path.read_bytes()
            result['filesChecked'] += 1
            result['byteCount'] += len(data)
            matched = [{'name': name, 'byteOffsets': occurrences(data, name.encode())}
                       for name in NAMES if name.encode() in data]
            if matched:
                digest = hashlib.sha256(data).hexdigest()
                if digest != row['sha256']:
                    raise ValueError('matched source differs from catalog hash')
                result['matches'].append({'path': str(path), 'sha256': digest, 'matches': matched})
    data = executable.read_bytes()
    result['originalExecutable'] = {'path': str(executable), 'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(), 'namedPlaintextSearch': [
            {'name': name, 'asciiOffset': data.find(name.encode()),
             'utf16Offset': data.find(name.encode('utf-16le'))} for name in NAMES]}
    result['conclusion'] = {'stateDeclarationPresent': True, 'resourceDamageChainPresent': True,
        'nativeTriggerTimeEstablished': False,
        'reason': 'Occurrence-only audit does not establish callbacks. Fixed V5 ZXX FrameMove calls only CommonFrameMove. No declaration or executable plaintext supplies an independently verified target2016 trigger time.'}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--target-executable', type=Path, default=Path('asset_sources/client/data/x2.exe'))
    parser.add_argument('--output', type=Path, default=ROOT / 'reports/rf-command-binding-audit-v7.json')
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(args.source_root.resolve()) or args.output.resolve().is_relative_to(args.target_executable.resolve().parent):
        parser.error('output must stay outside readonly inputs')
    result = audit(args.source_root, args.target_executable)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes((json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'files': result['filesChecked'], 'bytes': result['byteCount'],
                      'matchedFiles': len(result['matches']), 'output': str(args.output),
                      'nativeTriggerTimeEstablished': False}))
