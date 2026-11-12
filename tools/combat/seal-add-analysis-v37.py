"""Read only existing upstream static analysis bundles; retain selected static observations.

No target process, mutable upstream cache, disassembler or network operation.
"""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('asset_sources/upstream/reports/analysis/full-skills')
SELECTED = {'0x32761d10','0x32761900','0x32761ac0','0x3275ed70','0x3275d290',
            '0x32766960','0x32763250','0x32762cb0','0x327671a0',
            '0x3274e3f0','0x3275a970','0x3275e250'}
manifest = json.loads((SOURCE / 'portable-evidence-manifest.json').read_text(encoding='utf-8'))
rows, sources = [], []
for item in manifest['bundles']:
    filename = Path(item['path']).name
    packed = (SOURCE / 'bundles' / filename).read_bytes()
    assert hashlib.sha256(packed).hexdigest() == item['sha256'], filename
    data = gzip.decompress(packed)
    assert hashlib.sha256(data).hexdigest() == item['uncompressedSha256'], filename
    used = []
    for record in json.loads(data)['records']:
        normalized = record.get('normalized_result', {})
        procedure = normalized.get('procedure', {})
        if procedure.get('address') not in SELECTED or record.get('operation') != 'analyze_function':
            continue
        used.append(record['evidence_id'])
        rows.append({'address': procedure['address'], 'body': procedure.get('body'),
                     'evidenceId': record['evidence_id'], 'bundle': filename,
                     'pseudocode': normalized.get('pseudocode'),
                     'limitations': record.get('limitations', [])})
    if used:
        sources.append({'path': item['path'], 'sha256': item['sha256'],
                        'uncompressedSha256': item['uncompressedSha256'], 'evidenceIds': used})
result = {'schemaVersion': 1, 'evidenceClass': 'target2016 offline non-atomic historical native capture; decompiler projections, not original C++ or client measurements',
          'targetClientMeasured': False, 'originalSha256': manifest['originalSha256'],
          'analysisCaptureSha256': manifest['sourceSha256'], 'upstreamManifestSha256': hashlib.sha256((SOURCE/'portable-evidence-manifest.json').read_bytes()).hexdigest(),
          'sources': sources, 'functions': rows,
          'selectionSupplement': 'contracts/add-starfall-selection-source-v37.json',
          'unknowns': ['Original action +58 activation phase', 'Starfall state0/100 and virtual164 business semantics; dynamic target bone/ground attachment; original rand TLS seed/call chronology',
                       'Chaser count>=5 fallback selection and mesh lifetime overrides', 'Stardust original-world attachment/rotation producer']}
out = ROOT / 'contracts/add-analysis-consumers-v37.json'
out.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'output': str(out), 'functions': len(rows), 'bundles': len(sources)}))
