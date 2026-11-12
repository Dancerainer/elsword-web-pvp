"""Search original KOM scripts for the exact RS air-rune successor template."""
import json
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import audit_vc_missing_fx as shared

NAMES = ['Elsword_RS_DashJumpComboXa_Mesh01Die', 'Elsword_RS_DashZZXDie']
ROOT = Path(__file__).resolve().parents[2]


def inspect(path):
    shared.NAMES = NAMES
    shared.QUERY = re.compile(b'|'.join(re.escape(name.encode('ascii')) for name in NAMES), re.I)
    shared.RELATED = re.compile(rb'(?:eventsequence|templet)\s+"([^"\r\n]*RS_Dash[^"\r\n]*)"', re.I)
    return shared.inspect_archive(path)


def main():
    archives = sorted(shared.CLIENT.rglob('*.kom'))
    if not archives: raise ValueError('Original client archives unavailable')
    with ProcessPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(inspect, archives))
    files = sorted([r for result in results for r in result['scanned']], key=lambda r: (r['archive'], r['ordinal']))
    raw = (json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode('utf8')
    manifest = ROOT/'runtime/rs-missing-fx-scanned-files-v1.json'
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_bytes(raw)
    occurrences = [r for result in results for r in result['occurrences']]
    output = {'schemaVersion': 1, 'evidenceClass': 'read-only original target2016 KOM script bytes',
        'clientMeasured': False, 'clientRoot': str(shared.CLIENT),
        'reader': {'path': str(shared.READER), 'sha256': shared.sha(shared.READER.read_bytes())},
        'names': NAMES, 'search': {'caseInsensitive': True, 'extensions': sorted(shared.EXTENSIONS),
            'definitionKeywords': ['eventsequence', 'TEMPLET'], 'allArchiveFilenamesChecked': True},
        'counts': {'archives': len(results), 'allIndexEntries': sum(r['entries'] for r in results),
            'searchedFiles': len(files), 'searchedDecodedBytes': sum(r['bytes'] for r in files),
            'definitionMatches': sum(r['definition'] for r in occurrences)},
        'allScannedFiles': {'path': str(manifest.relative_to(ROOT)), 'sha256': shared.sha(raw), 'bytes': len(raw)},
        'archiveIndexes': [{k: v for k, v in row.items() if k not in ('scanned', 'occurrences', 'relatedDefinitions')} for row in results],
        'occurrences': occurrences, 'relatedDefinitions': [r for row in results for r in row['relatedDefinitions']],
        'status': 'definition-found' if any(r['definition'] for r in occurrences) else 'no-definition-in-original-script-payloads',
        'limits': ['A similarly named effect is not proof of an alias; no invented replacement.',
            'Static archived data does not establish behavior from another patch or full client execution.']}
    (ROOT/'contracts/rs-missing-fx-search-v1.json').write_bytes((json.dumps(output, ensure_ascii=False, indent=2)+'\n').encode('utf8'))
    print(json.dumps({'status': output['status'], **output['counts']}))


if __name__ == '__main__': main()
