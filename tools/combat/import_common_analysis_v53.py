"""Freeze small, source-bound static analysis contracts; never modify the research input."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--research', type=Path, default=Path('asset_sources/analysis-project'))
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
scopes = {
    'stop': ('COMMON_STOP_STACKING_2016.md', 'common-stop-stacking-2016/behavior-contract.json'),
    'traits': ('NEW_SKILL_TRAITS_CONSUMERS_2016.md', 'new-skill-traits-consumers-2016/behavior-contract.json'),
    'useful': ('USEFUL_HIT_TIMING_2016.md', 'useful-hit-timing-2016/behavior-contract.json'),
    'miss': ('MISS_EVASION_2016.md', 'miss-evasion-2016/behavior-contract.json.gz'),
    'curves': ('GENERAL_DAMAGE_CURVES_2016.md', 'general-damage-curves-2016/behavior-contract.json'),
}
destination = ROOT / 'contracts/common-analysis-v53.json'
sha = lambda data: hashlib.sha256(data).hexdigest()
if args.verify_only:
    record = json.loads(destination.read_bytes())
    for scope in record['scopes'].values():
        for source in scope['sources']:
            data = (args.research / source['path']).read_bytes()
            if sha(data) != source['sha256']:
                raise ValueError('Research source changed: ' + source['path'])
    print(json.dumps({'verified': True, 'scopes': len(record['scopes']), 'originalClientMeasured': False}))
else:
    record = {'schemaVersion': 1, 'evidenceClass': 'target2016-static-native-consumers',
              'originalClientMeasured': False, 'researchRoot': str(args.research.resolve()),
              'researchCommit': subprocess.check_output(['git', '-C', str(args.research), 'rev-parse', 'HEAD']).decode().strip(),
              'originalX2Sha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
              'snapshot3Sha256': 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba',
              'scopes': {}, 'boundaries': [
                  'User source+5fde removal needs an explicit host predicate; death is not substituted.',
                  'Network actor ID is a Web representation of the native UID64, not native wire data.',
                  'MI_CRITICAL 25 percent defence policy remains an explicit user override.',
                  'The static Miss contract is preserved; runtime seed production and exact attribute inputs must be supplied, never fabricated.',
                  'Existing fixed-V5 damage and equipment stages remain separately qualified until their actual target2016 inputs are implemented.',
              ]}
    for name, (doc, contract) in scopes.items():
        paths = ['docs/' + doc, 'reports/analysis/' + contract]
        data = [ (path, (args.research / path).read_bytes()) for path in paths ]
        raw = data[1][1]
        if contract.endswith('.gz'):
            raw = gzip.decompress(raw)
        record['scopes'][name] = {'sources': [{'path': p, 'sha256': sha(b)} for p, b in data],
                                 'contract': json.loads(raw)}
    destination.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'output': str(destination), 'scopes': len(scopes)}))
