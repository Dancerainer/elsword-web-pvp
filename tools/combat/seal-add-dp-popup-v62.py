"""Seal original2016 DP popup text, PicChar consumer and its actual D glyph.

Only reads the already selected derived PE and original extracted DDS. This is
static provenance, not a client run or a complete Overlimit-caller audit.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
PE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
DDS = Path('asset_work/raw/data/data049.kom/PC_D.dds')
DATA_REFERENCE = Path('./.cache/native-source-runtime/X2Lib/X2Data.cpp')
sha = lambda value: hashlib.sha256(value).hexdigest()


def seal():
    data = PE.read_bytes()
    expected = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
    if sha(data) != expected:
        raise ValueError('Selected original-derived PE identity changed')
    pe = struct.unpack_from('<I', data, 60)[0]
    opt = pe + 24
    base = struct.unpack_from('<I', data, opt + 28)[0]
    count = struct.unpack_from('<H', data, pe + 6)[0]
    size = struct.unpack_from('<H', data, pe + 20)[0]
    sections = [struct.unpack_from('<IIII', data, opt + size + i * 40 + 8) for i in range(count)]

    def span(address, length):
        for virtual_size, rva, raw_size, start in sections:
            if base + rva <= address and address + length <= base + rva + min(virtual_size, raw_size):
                offset = start + address - base - rva
                value = data[offset:offset + length]
                return {'address': hex(address), 'fileOffset': offset, 'bytes': length,
                        'sha256': sha(value), 'hex': value.hex()}
        raise ValueError('Unmapped original span')

    def text(address, value):
        raw = (value + '\0').encode('utf-16le')
        result = span(address, len(raw))
        if result['hex'] != raw.hex():
            raise ValueError('Original popup format differs')
        return {**result, 'encoding': 'UTF-16LE', 'value': value}

    raw = DDS.read_bytes()
    if sha(raw) != 'c65a94379abeee950aae9a273d5cd06df0108a61f8485032b8027c851faa1ad4':
        raise ValueError('Original PC_D DDS differs')
    height, width = struct.unpack_from('<II', raw, 12)
    reference = DATA_REFERENCE.read_bytes()
    reference_hash = 'cc8543f0d18ef5962a83e5459d19d25643e8ebd93a8f31f3d4b7f5cdec541f05'
    if sha(reference) != reference_hash:
        raise ValueError('Pinned X2Data version-reference identity changed')
    registration = b'\n'.join(reference.splitlines()[1821:1845])
    return {'schemaVersion': 1, 'id': 'add-dp-popup-original2016-v62',
        'targetClientMeasured': False, 'targetExecuted': False,
        'source': {'path': str(PE), 'sha256': expected,
            'originalClientSha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
            'classification': 'selected historical non-atomic derived PE; static evidence'},
        'dpFormat': text(0x3305f80c, 'DP+ %d'), 'mpFormat': text(0x33016660, 'MP+ %d'),
        'dpPopup': span(0x3273cf00, 207),
        'picCharConsumer': {**span(0x32e38280, 1366),
            'existingEvidenceId': 'ev_4b86842b1d0c0a0b73f190e70e530067e1e2adb4f676ca592915128b82497be0',
            'kind': 'bounded direct CFG envelope; not linker-established function size',
            'asciiTextureIdStore': span(0x32e38455, 6)},
        'glyph': {'name': 'PC_D.dds', 'archive': 'data/data049.kom', 'ordinal': 81,
            'rawPath': 'raw/data/data049.kom/PC_D.dds', 'sha256': sha(raw), 'bytes': len(raw),
            'width': width, 'height': height, 'textureId': ord('D'),
            'classification': 'original target2016 extracted asset; not generated text'},
        'fontRegistrationReference': {'path': 'JP_TW_EU_CN_US/Trunk/X2Lib/X2Data.cpp',
            'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633', 'sha256': reference_hash,
            'lines': [1822, 1845], 'selectedLfBytesSha256': sha(registration),
            'classification': 'fixed-V5 version reference, not target2016 execution',
            'meaning': 'PicCharDamage uses PC_ prefix; Red/Blue/Green clone the same font map with distinct original particle sequences'},
        'webRule': {'prefix': 'DP+ ', 'style': 'red', 'mpStyle': 'blue',
            'classification': 'retain user V61 red-DP/blue-MP presentation; add original missing D glyph',
            'resourceAmounts': 'existing actual clamped events; rawDP/20 remains unchanged'},
        'limits': ['The original DP popup and same PicChar character consumer are positively bound.',
            'This slice does not establish the complete Overlimit-to-popup caller path or original GPU pixels.',
            'V61 Web imported glyph subset omitted D; this is not evidence that the original font lacked D.',
            'Red DP is the project presentation rule; source popup style and other resource producers remain separate.']}


if __name__ == '__main__':
    result = seal()
    output = ROOT / 'contracts/add-dp-popup-v62.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'path': str(output), 'glyph': result['glyph'], 'dpFormat': result['dpFormat']['value']}))
