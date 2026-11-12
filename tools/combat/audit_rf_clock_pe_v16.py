"""Bounded read-only raw PE clock evidence; no execution, unpacking, or disassembly."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
TARGET = Path('asset_sources/client/data/x2.exe')
EXPECTED_SHA = 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729'
REFERENCE = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def occurrences(data, pattern):
    found, position = [], 0
    while (position := data.find(pattern, position)) >= 0:
        found.append(position)
        position += 1
    return found


def pe_layout(raw):
    if len(raw) < 64 or raw[:2] != b'MZ':
        raise ValueError('Invalid DOS header')
    pe = struct.unpack_from('<I', raw, 60)[0]
    if pe + 24 > len(raw) or raw[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Invalid PE header')
    machine, count = struct.unpack_from('<HH', raw, pe + 4)
    optional_size = struct.unpack_from('<H', raw, pe + 20)[0]
    optional = pe + 24
    if machine != 0x14c or optional_size < 96 or optional + optional_size > len(raw):
        raise ValueError('Expected bounded x86 PE32 optional header')
    if struct.unpack_from('<H', raw, optional)[0] != 0x10b:
        raise ValueError('Expected PE32 magic')
    image_base = struct.unpack_from('<I', raw, optional + 28)[0]
    entry = struct.unpack_from('<I', raw, optional + 16)[0]
    image_size = struct.unpack_from('<I', raw, optional + 56)[0]
    table = optional + optional_size
    if not 0 < count <= 96 or table + 40 * count > len(raw):
        raise ValueError('Truncated/unbounded section table')
    sections = []
    for i in range(count):
        start = table + 40 * i
        virtual_size, rva, size, offset = struct.unpack_from('<IIII', raw, start + 8)
        flags = struct.unpack_from('<I', raw, start + 36)[0]
        if size and (offset < table + 40 * count or offset + size > len(raw)):
            raise ValueError('PE raw section escapes legal input')
        if rva + max(size, virtual_size) > image_size:
            raise ValueError('PE section escapes declared image')
        if any(size and s['rawSize'] and offset < s['rawOffset'] + s['rawSize'] and
               s['rawOffset'] < offset + size for s in sections):
            raise ValueError('Overlapping PE raw sections')
        data = raw[offset:offset + size]
        counts = Counter(data)
        entropy = -sum(n / len(data) * math.log2(n / len(data)) for n in counts.values()) if data else 0
        sections.append({'index': i, 'nameHex': raw[start:start + 8].hex(),
                         'rva': rva, 'virtualSize': virtual_size, 'rawOffset': offset,
                         'rawSize': size, 'characteristics': flags,
                         'executable': bool(flags & 0x20000000),
                         'rawEntropyBitsPerByte': round(entropy, 5), 'rawSha256': sha(data)})
    entry_section = next((s['index'] for s in sections
                          if s['rva'] <= entry < s['rva'] + max(s['virtualSize'], s['rawSize'])), None)
    if entry_section is None:
        raise ValueError('Entry RVA is outside declared sections')
    return {'machine': machine, 'imageBase': image_base, 'imageSize': image_size,
            'entryRva': entry, 'entrySectionIndex': entry_section, 'sections': sections}


def pattern_evidence(raw, layout, label, encoding, value):
    pattern = struct.pack(encoding, value)
    offsets = occurrences(raw, pattern)
    # Retain all counts, but bound small evidence if another supplied image contains many matches.
    rows = []
    for offset in offsets[:128]:
        section = next((s for s in layout['sections']
                        if s['rawOffset'] <= offset and offset + len(pattern) <= s['rawOffset'] + s['rawSize']), None)
        row = {'fileOffset': offset, 'contextFirstOffset': max(0, offset - 12),
               'contextHex': raw[max(0, offset - 12):offset + len(pattern) + 12].hex(),
               'alignedToEncodingSize': offset % len(pattern) == 0,
               'sectionIndex': section['index'] if section else None}
        if section:
            rva = section['rva'] + offset - section['rawOffset']
            va = layout['imageBase'] + rva
            if va > 0xffffffff:
                raise ValueError('PE32 address overflow')
            pointers = occurrences(raw, struct.pack('<I', va))
            row.update({'rva': rva, 'preferredImageVa': va,
                        'absoluteAddressByteOccurrencesCount': len(pointers),
                        'absoluteAddressByteOccurrences': pointers[:128],
                        'absoluteAddressRowsTruncated': len(pointers) > 128})
        rows.append(row)
    return {'label': label, 'encoding': encoding, 'patternHex': pattern.hex(),
            'wholeFileByteOccurrencesCount': len(offsets),
            'rowsTruncated': len(offsets) > 128, 'rows': rows}


def build():
    raw = TARGET.read_bytes()
    if sha(raw) != EXPECTED_SHA:
        raise ValueError('Original EXE differs from v14 pinned input')
    layout = pe_layout(raw)
    patterns = [pattern_evidence(raw, layout, label, encoding, value)
                for encoding in ('<f', '<d')
                for label, value in [('75', 75.), ('85', 85.), ('1/75', 1 / 75), ('1/85', 1 / 85)]]
    patterns.extend(pattern_evidence(raw, layout, label, '<I', value)
                    for label, value in [('75', 75), ('85', 85)])
    clock_contract = ROOT / 'contracts/rf-down-hit-rate-source-v16.json'
    evidence = {'schema': 'rf-target2016-clock-pe-v16',
        'evidenceClass': 'target2016-raw-PE-static; pinned-V5-consumer-correspondence-unresolved',
        'target': {'path': str(TARGET), 'bytes': len(raw), 'sha256': sha(raw),
                   'matchesV14OriginalExe': True, **layout},
        'referenceCommit': REFERENCE,
        'referenceClockContract': {'path': 'contracts/rf-down-hit-rate-source-v16.json',
            'canonicalJsonSha256': sha(json.dumps(json.loads(clock_contract.read_bytes()),
                sort_keys=True, separators=(',', ':')).encode('utf-8'))},
        'patterns': patterns,
        'method': {'readOnly': True, 'originalClientExecuted': False, 'unpackingPerformed': False,
                   'disassemblyPerformed': False, 'dependencyInstallationPerformed': False,
                   'patternEncodings': ['IEEE754 float32 little-endian', 'IEEE754 float64 little-endian',
                                        'unsigned int32 little-endian'],
                   'addressSearch': 'exact preferred-VA uint32 byte occurrences; not decoded instruction cross-references'},
        'localPythonDecoderInventory': {name: bool(importlib.util.find_spec(name)) for name in
            ['capstone', 'pefile', 'lief', 'iced_x86', 'distorm3', 'unicorn', 'keystone', 'angr']},
        'sourceCorrespondenceConfirmed': {'appConstantDeltaFieldWrite': False,
            'stateChangeClockCaller': False, 'pvpBranchReachability': False, 'targetLogicalCadence': False},
        'limits': ['An exact numeric byte pattern is not a decoded instruction or runtime value.',
            'No preferred-VA byte occurrence is not proof that no relative/encoded/relocated reference exists.',
            'High-entropy sections, noncanonical names and virtual/raw size gaps are consistent with an encoded/protected layout, not a verified protector identification.',
            'No existing decoder executable or Python decoder library was found in the bounded local inventory; no installation or broad decompilation was attempted.',
            'Static raw input did not establish an App delta-field write, StateChange caller or reachable PvP consumer.',
            'Target2016 logical frequency and independent hit expectations remain unknown; current tickrate is unchanged.']}
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = build()
    output = ROOT / 'contracts/rf-clock-pe-source-v16.json'
    if args.check:
        if json.loads(output.read_bytes()) != data:
            raise ValueError('Actual PE evidence drift')
    else:
        output.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'check': args.check, 'targetSha256': data['target']['sha256'],
        'patternCounts': {p['encoding'] + ':' + p['label']: p['wholeFileByteOccurrencesCount'] for p in data['patterns']},
        'sourceCorrespondenceConfirmed': data['sourceCorrespondenceConfirmed']}))


if __name__ == '__main__':
    main()
