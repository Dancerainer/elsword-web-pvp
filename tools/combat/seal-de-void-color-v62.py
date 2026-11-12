"""Seal the selected original2016 current-particle alpha setter, without running it.

The enclosing Void integration/END records remain in the previously sealed V53
contract. These small bounded byte spans settle the narrower current-particle
write versus future-particle retention distinction used by the V62 Web fix.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[2]
PE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'


def seal():
    data = PE.read_bytes()
    if hashlib.sha256(data).hexdigest() != EXPECTED:
        raise ValueError('Selected historical derived PE identity changed')
    pe = struct.unpack_from('<I', data, 60)[0]
    opt = pe + 24
    base = struct.unpack_from('<I', data, opt + 28)[0]
    count = struct.unpack_from('<H', data, pe + 6)[0]
    size = struct.unpack_from('<H', data, pe + 20)[0]
    sections = [struct.unpack_from('<IIII', data, opt + size + i * 40 + 8)
                for i in range(count)]

    def span(address, length):
        for virtual, rva, raw, start in sections:
            if base + rva <= address and address + length <= base + rva + min(virtual, raw):
                offset = start + address - base - rva
                value = data[offset:offset + length]
                return {'address': hex(address), 'fileOffset': offset,
                        'bytes': length, 'sha256': hashlib.sha256(value).hexdigest(),
                        'hex': value.hex()}
        raise ValueError('Selected original byte span is not mapped')

    return {
        'schemaVersion': 1, 'id': 'de-void-current-particle-color-original2016-v62',
        'source': {'path': str(PE), 'sha256': EXPECTED,
                   'originalClientSha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
                   'classification': 'selected historical non-atomic derived PE; static bytes'},
        'targetExecuted': False, 'targetGpuMeasured': False,
        'enclosingContract': 'contracts/add-analysis-v53/DE_VOID_FIELD_TERMINAL_2016.md',
        'wrapper': span(0x31cdd770, 13),
        'currentParticleSetter': {
            **span(0x31ce9ad0, 158),
            'classification': 'bounded direct CFG through ret4 at 0x31ce9b6b; not linker-established function size',
            'writes': {'address': '0x31ce9b5b', 'meaning': 'current particle color alpha at +0x28'},
            'preserves': 'RGB fields +0x1c/+0x20/+0x24 are copied back unchanged',
        },
        'conclusion': 'This setter iterates current particles and writes alpha; these bytes do not establish a persistent value for future emissions.',
        'webPolicy': 'V62 retains the last monotonic Void collapse multiplier on actual finite emitter tails, including local owned-handle replacement. This is the requested no-reappearance Web lifecycle rule, not an original-client pixel or future-color claim.',
        'unchanged': ['original raw 7.75 lifetime', 'original .98 main-scale callback',
                      'original -.03 display callback', 'particle declarations/counts/materials/quality'],
    }


if __name__ == '__main__':
    result = seal()
    output = ROOT / 'contracts/de-void-color-v62.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'path': str(output), 'setterSha256': result['currentParticleSetter']['sha256']}))
