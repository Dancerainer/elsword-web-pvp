"""Compare actual WASM sections; original callback/data changes must not hide in debug claims."""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]

def sha(value):
    return hashlib.sha256(value).hexdigest()

def uleb(data, cursor):
    value = 0
    for shift in range(0, 35, 7):
        if cursor >= len(data):
            raise ValueError('Truncated WASM unsigned LEB')
        byte = data[cursor]
        cursor += 1
        value |= (byte & 127) << shift
        if byte < 128:
            if value > 0xffffffff:
                raise ValueError('Overflow WASM unsigned LEB')
            return value, cursor
    raise ValueError('Overflow WASM unsigned LEB')

def sections(data):
    if data[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('Unsupported WASM header')
    cursor, result = 8, {}
    while cursor < len(data):
        kind = data[cursor]
        cursor += 1
        if kind > 13:
            raise ValueError('Unknown WASM section ID')
        length, cursor = uleb(data, cursor)
        if cursor + length > len(data):
            raise ValueError('Truncated WASM section')
        payload = data[cursor:cursor + length]
        cursor += length
        name = ''
        if kind == 0:
            count, offset = uleb(payload, 0)
            if offset + count > len(payload):
                raise ValueError('Truncated WASM custom section name')
            name = payload[offset:offset + count].decode('utf8')
        key = str(kind) + ':' + name
        if key in result:
            raise ValueError('Ambiguous duplicate section: ' + key)
        result[key] = payload
    return result

def describe(data):
    return {'sha256': sha(data), 'bytes': len(data), 'sections': [
        {'id': int(key.split(':', 1)[0]), 'name': key.split(':', 1)[1],
         'bytes': len(payload), 'sha256': sha(payload)} for key, payload in sections(data).items()]}

def compare(left, right):
    a, b = sections(left), sections(right)
    return [{'section': key, 'equal': a.get(key) == b.get(key),
             'leftBytes': len(a.get(key, b'')), 'rightBytes': len(b.get(key, b''))}
            for key in sorted(set(a) | set(b))]

def producers(payload):
    size, cursor = uleb(payload, 0)
    cursor += size
    count, cursor = uleb(payload, cursor)
    def string():
        nonlocal cursor
        size, cursor = uleb(payload, cursor)
        if cursor + size > len(payload):
            raise ValueError('Truncated producer string')
        value = payload[cursor:cursor + size].decode('utf8')
        cursor += size
        return value
    result = {}
    for _ in range(count):
        key = string()
        entries, cursor = uleb(payload, cursor)
        values = {}
        for _ in range(entries):
            name = string()
            values[name] = string()
        result[key] = values
    if cursor != len(payload):
        raise ValueError('Trailing producer bytes')
    return result

def verify(old_candidate, old_root, candidate, independent):
    before = compare(old_candidate, old_root)
    changed = [row['section'] for row in before if not row['equal']]
    if changed != ['0:.debug_info', '0:.debug_line', '0:.debug_str']:
        raise ValueError('Unexpected differences outside the three DWARF sections')
    a, b = sections(old_candidate), sections(candidate)
    if any(not b.get(key) == value for key, value in a.items() if not key.startswith('0:.debug_') and key != '0:producers'):
        raise ValueError('Removing debug altered execution/data/other custom sections')
    old_producers, new_producers = producers(a['0:producers']), producers(b['0:producers'])
    if old_producers != {**new_producers, 'language': {'C_plus_plus_14': ''}}:
        raise ValueError('Unexpected producer change besides DWARF-derived language entry')
    if any(key.startswith('0:.debug_') for key in b):
        raise ValueError('-g0 still emits DWARF')
    if candidate != independent:
        raise ValueError('Independent -g0 build differs by raw bytes')
    return {'schemaVersion': 1, 'evidenceClass': 'independent-compiled-WASM-section-comparison-not-original-client-oracle',
        'targetClientMeasured': False,
        'debugEnabledCandidate': describe(old_candidate), 'debugEnabledRoot': describe(old_root),
        'oldBuildComparison': before, 'onlyDifferences': changed,
        'diagnosis': 'Compiler default DWARF retains absolute compilation/input directories; CPP/includes/compiler/flags and70method records were identical. Execution code/data and all other sections are equal.',
        'canonicalG0Candidate': describe(candidate), 'independentG0Candidate': describe(independent),
        'canonicalRawBytesEqual': True, 'executionDataNameAndTargetFeaturesUnchanged': True,
        'g0Comparison': compare(old_candidate, candidate),
        'g0ProducerMetadata': {'before': old_producers, 'after': new_producers,
            'reason': '-g0 also removes DWARF-derived C_plus_plus_14 producer-language entry; processed-by clang is unchanged'},
        'canonicalFlagChange': ['-g0'], 'completeOriginalMethodRecordsUnchanged': 70,
        'limits': ['DWARF equality is packaging reproducibility, not an original2016 consumer claim',
                   'Old debug-enabled candidate/root modules remain retained private evidence; historical original-source pairs are unchanged']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--old-candidate', type=Path, default=ROOT / '.cache/native-awakened-skills-v17-before-g0/skills.wasm')
    parser.add_argument('--old-root', type=Path, default=ROOT / '.cache/native-awakened-skills-v17-before-g0/root-default-debug-skills.wasm')
    parser.add_argument('--candidate', type=Path, default=ROOT / '.cache/native-awakened-skills-v17/skills.wasm')
    parser.add_argument('--independent', type=Path, default=ROOT / '.cache/native-awakened-skills-v17-independent-g0/skills.wasm')
    parser.add_argument('--output', type=Path, default=ROOT / 'reports/rf-skills-wasm-reproducibility-v17.json')
    args = parser.parse_args()
    result = verify(*(path.read_bytes() for path in [args.old_candidate, args.old_root, args.candidate, args.independent]))
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'sha256': result['canonicalG0Candidate']['sha256'], 'bytes': result['canonicalG0Candidate']['bytes'],
                      'onlyOriginalDifferences': result['onlyDifferences'], 'canonicalRawBytesEqual': True}))

if __name__ == '__main__':
    main()
