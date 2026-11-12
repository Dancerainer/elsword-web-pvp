"""Read every original KOM index and search all decoded script/text payloads.

Original archives and the separately versioned upstream reader are read-only.
Output is hashes/counts/locations, never extracted client assets or replacement FX.
"""
import hashlib
import json
import re
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CLIENT = Path('asset_sources/client')
READER = Path('asset_sources/upstream/tools/kom.py')
sys.path.insert(0, str(READER.parent))
import kom

NAMES = ['RWT_SA_REVOLVER_CANNON_OverHit_'+suffix for suffix in
         ('Fire_Smog', 'Fire_Spark', 'Fire_Smoke', 'Light', 'FIRE_LIGHT', 'Fire_Wave')]
NAMES += ['RWT_SA_HARPOON_SPEAR_Lightning01']
EXTENSIONS = {'.txt', '.lua', '.xml', '.ini', '.cfg', '.fx', '.h', '.c', '.cpp', '.json', '.csv', '.dsl', ''}
QUERY = re.compile(b'|'.join(re.escape(n.encode('ascii')) for n in NAMES), re.I)
RELATED = re.compile(rb'(?:eventsequence|templet)\s+"([^"\r\n]*(?:REVOLVER_CANNON|HARPOON_SPEAR)[^"\r\n]*)"', re.I)
DEFINITION = re.compile(rb'(?:eventsequence|templet)\s+"([^"\r\n]+)"', re.I)
sha = lambda data: hashlib.sha256(data).hexdigest()


def inspect_archive(path):
    path = Path(path)
    archive = path.relative_to(CLIENT).as_posix()
    scanned, occurrences, candidates, filename_matches = [], [], [], []
    extension_counts = Counter()
    with path.open('rb') as stream:
        entries, index = kom.index(stream)
        for ordinal, entry in enumerate(entries):
            extension = Path(entry['Name']).suffix.lower()
            extension_counts[extension] += 1
            if QUERY.search(entry['Name'].encode('utf8')):
                filename_matches.append({'name': entry['Name'], 'ordinal': ordinal})
            if extension not in EXTENSIONS:
                continue
            stream.seek(entry['offset'])
            raw = kom.unpack(entry, stream.read(int(entry['CompressedSize'])))
            decoded, codec = kom.decode_asset(raw)
            row = {'archive': archive, 'ordinal': ordinal, 'name': entry['Name'],
                   'bytes': len(decoded), 'sha256': sha(decoded), 'packedChecksum': entry['Checksum'],
                   'algorithm': int(entry.get('Algorithm', 0)), 'assetCodec': codec}
            scanned.append(row)
            definitions = {m.group(1).lower(): m.start(1) for m in DEFINITION.finditer(decoded)}
            for match in QUERY.finditer(decoded):
                actual = match.group().decode('ascii')
                canonical = next(n for n in NAMES if n.lower() == actual.lower())
                occurrences.append({'archive': archive, 'ordinal': ordinal, 'name': entry['Name'],
                                    'query': canonical, 'actualSpelling': actual, 'offset': match.start(),
                                    'definition': definitions.get(actual.lower()) == match.start(),
                                    'fileSha256': row['sha256']})
            for match in RELATED.finditer(decoded):
                candidates.append({'archive': archive, 'ordinal': ordinal, 'name': entry['Name'],
                                   'template': match.group(1).decode('ascii'), 'offset': match.start(1),
                                   'fileSha256': row['sha256']})
    return {'archive': archive, 'archiveBytes': path.stat().st_size, 'indexBytes': len(index),
            'indexSha256': sha(index), 'entries': len(entries), 'extensionCounts': dict(extension_counts),
            'scanned': scanned, 'occurrences': occurrences, 'relatedDefinitions': candidates,
            'filenameMatches': filename_matches}


def main():
    archives = sorted(CLIENT.rglob('*.kom'))
    if not archives:
        raise ValueError('Original client archives unavailable')
    with ProcessPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(inspect_archive, archives))
    files = sorted([row for result in results for row in result['scanned']], key=lambda r: (r['archive'], r['ordinal']))
    manifest = (json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n').encode('utf8')
    manifest_path = ROOT/'runtime/vc-missing-fx-scanned-files-v3.json'
    manifest_path.write_bytes(manifest)
    occurrences = [row for result in results for row in result['occurrences']]
    related = [row for result in results for row in result['relatedDefinitions']]
    counts = Counter(Path(r['name']).suffix.lower() for r in files)
    output = {'schema': 1, 'evidenceClass': 'read-only original target2016 archived bytes; no runtime/client execution',
              'clientRoot': str(CLIENT), 'reader': {'path': str(READER), 'sha256': sha(READER.read_bytes()),
                 'verification': 'KOM index Adler32, count, extent; payload Adler32, decoded size and zlib EOF'},
              'search': {'names': NAMES, 'caseInsensitive': True, 'mode': 'ASCII exact identifier bytes; all script/text extensions plus every KOM filename',
                         'scriptExtensions': sorted(EXTENSIONS),
                         'definitionKeywords': ['eventsequence', 'TEMPLET'],
                         'aliasPolicy': 'Record all exact-name occurrences in scripts; similar definitions are not automatically aliases'},
              'counts': {'archives': len(results), 'allIndexEntries': sum(r['entries'] for r in results),
                         'searchedFiles': len(files), 'searchedDecodedBytes': sum(r['bytes'] for r in files),
                         'searchedByExtension': dict(counts),
                         'exactOrCasefoldDefinitionMatches': sum(r['definition'] for r in occurrences)},
              'allScannedFiles': {'sha256': sha(manifest), 'bytes': len(manifest),
                                 'localPath': 'runtime/vc-missing-fx-scanned-files-v3.json',
                                 'format': 'UTF8 compact JSON, sorted keys, archive/ordinal sorted, final LF'},
              'archiveIndexes': [{k:v for k,v in result.items() if k not in ('scanned', 'occurrences', 'relatedDefinitions')} for result in results],
              'allParticleAndMeshScriptFiles': [r for r in files if Path(r['name']).suffix.lower() == '.txt'],
              'queries': [{'name': name,
                           'occurrences': [r for r in occurrences if r['query'] == name],
                           'status': 'exact-definition-found' if any(r['definition'] for r in occurrences if r['query'] == name) else 'no-definition-in-original-script-payloads'} for name in NAMES],
              'relatedDefinitions': related,
              'limits': ['Binary textures/models/audio were indexed by filename, not decoded as effect scripts',
                         'No claim about an external patch, server-delivered template or another client version',
                         'A similar normal-effect name does not establish a target alias; no substitution made']}
    path = ROOT/'contracts/vc-missing-fx-search-v3.json'
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps(output['counts'], ensure_ascii=False))
    for query in output['queries']:
        print(query['name'], query['status'], 'references='+str(len(query['occurrences'])))


if __name__ == '__main__':
    main()
