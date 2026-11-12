"""Independently reparse original KL82 inputs and compare every cancel field.

Only reads the upstream catalog/assets; all outputs stay in this worktree.
This proves declaration identity, not original-client runtime behavior.
"""
import argparse
import hashlib
import json
from pathlib import Path

from prepare_lk_declarations import prepare

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {
    'enum': 'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6',
    'raven': 'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3',
    'elsword': '743fc48b74fd35ed69a2e8573acd2d7759d3005340ff4e1655c0678dbf741031',
}


def verify(source, output):
    output = output.resolve()
    if not output.is_relative_to(ROOT):
        raise ValueError('Audit cache must stay in the task worktree')
    prepare(source, output, names={'enum': 'Enum.lua', 'raven': 'RAVEN_FIGHTER.lua',
                                  'elsword': 'Elsword_SwordMan.lua'},
            unit_keys=('raven', 'elsword'))
    declarations = {}
    for key, expected in EXPECTED.items():
        value = json.loads((output / (key + '-declarations.json')).read_text('utf-8'))
        if value['source']['sha256'] != expected:
            raise ValueError('Target input identity changed: ' + key)
        declarations[key] = value
    rows, profiles = [], {}
    for profession in ('RF', 'LK', 'VC', 'RS', 'BM', 'IS'):
        path = ROOT / 'packages/combat-core' / (profession.lower() + '-profile.json')
        profiles[profession] = hashlib.sha256(path.read_bytes()).hexdigest()
        profile = json.loads(path.read_text('utf-8'))
        original = declarations['raven' if profession in ('RF', 'VC', 'BM') else 'elsword']['globals']
        for state, definition in profile['states'].items():
            fields = {k: v for k, v in definition['raw'].items() if 'CANCEL' in k}
            if not fields:
                continue
            name = definition.get('sourceState', state)
            target = original.get(name)
            target_fields = None if target is None else {k: v for k, v in target.items() if 'CANCEL' in k}
            rows.append({'profession': profession, 'state': state, 'sourceState': name,
                         'fields': fields, 'matchesOriginal': fields == target_fields})
    report = {
        'schema': 'all-profession-cancel-declarations-v1',
        'evidenceClass': 'independent-static-original-KL82-declarations',
        'targetClientMeasured': False, 'sourceSha256': EXPECTED, 'profileSha256': profiles,
        'summary': {'rows': len(rows), 'matched': sum(r['matchesOriginal'] for r in rows),
                    'mismatches': sum(not r['matchesOriginal'] for r in rows)},
        'rows': rows,
    }
    (ROOT / 'reports/all-profession-cancel-declarations-v1.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps(report['summary']))
    if report['summary']['mismatches']:
        raise ValueError('Profile cancel fields differ from original declarations')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/cancel-audit-target')
    args = parser.parse_args()
    verify(args.source_root, args.output)
