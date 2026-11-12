"""Bounded read-only byte audit of the already captured distance helper.

No static analysis session is opened and no input/cache is modified. Selected byte ranges,
CRT export metadata and all fidelity limits remain distinct.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, 'asset_sources/analysis/offline-libs')
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
with SOURCE.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == EXPECTED
with SOURCE.open('rb') as stream:
    header = stream.read(4096)
    pe = struct.unpack_from('<I', header, 60)[0]
    optional = pe + 24
    base = struct.unpack_from('<I', header, optional + 28)[0]
    count = struct.unpack_from('<H', header, pe + 6)[0]
    size = struct.unpack_from('<H', header, pe + 20)[0]
    sections = [struct.unpack_from('<IIII', header, optional + size + i * 40 + 8) for i in range(count)]
    def read_at(address, length):
        for virtual_size, rva, raw_size, offset in sections:
            if base+rva <= address and address+length <= base+rva+min(virtual_size, raw_size):
                source_offset = offset + address-base-rva
                stream.seek(source_offset)
                return source_offset, stream.read(length)
        raise ValueError('Unbacked native range')
    address, end = 0x31c6e880, 0x31c6e8cd
    offset, data = read_at(address, end-address)
    code = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(data, address))
    assert code[-1].mnemonic == 'ret' and code[-1].address+code[-1].size == end
    assert sum(i.size for i in code) == len(data)
    assert not any(i.mnemonic.startswith('j') or i.mnemonic == 'call' for i in code)
    threshold_offset, threshold = read_at(0x32fe8cc0, 8)
    assert struct.unpack('<d', threshold)[0] == 1000000

crt_path = Path('asset_sources/upstream/reports/analysis/pvp-count-aggregation/crt-rand-audit.json')
crt_raw = crt_path.read_bytes()
crt = json.loads(crt_raw)
with Path(crt['originalDll']['path']).open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == crt['originalDll']['sha256']
rand = next(row for row in crt['functions'] if row['export']['name'] == 'rand')
assert rand['observedModuleVA'] == '0x5f4decba'
result = {
    'schemaVersion': 1,
    'evidenceClass': 'offline non-atomic historical capture exact source bytes and independently bound companion DLL export; no target execution',
    'targetClientMeasured': False,
    'analysisCapture': {'path': str(SOURCE), 'sha256': EXPECTED},
    'distanceHelper': {'start': hex(address), 'endExclusive': hex(end), 'sourceFileOffset': offset,
                       'bytes': data.hex(), 'sha256': hashlib.sha256(data).hexdigest(),
                       'instructions': [{'address': hex(i.address), 'bytes': bytes(i.bytes).hex(),
                                         'mnemonic': i.mnemonic, 'operands': i.op_str} for i in code],
                       'observation': 'Subtracts two vec3 X/Y/Z float components, stores single-precision deltas, sums three squared deltas, stores/reloads float return. No sqrt or further call.'},
    'distanceThreshold': {'address': '0x32fe8cc0', 'sourceFileOffset': threshold_offset,
                          'bytes': threshold.hex(), 'sha256': hashlib.sha256(threshold).hexdigest(),
                          'value': 1000000, 'type': 'float64'},
    'interpretation': 'The proved squared-distance helper and threshold imply 1000 native position units inclusive. This is not a measured PvP area or body size.',
    'randomExportBinding': {'report': str(crt_path), 'reportSha256': hashlib.sha256(crt_raw).hexdigest(),
                            'originalDll': crt['originalDll'], 'moduleObservations': crt['moduleObservations'],
                            'rand': rand, 'algorithm': crt['algorithm'], 'limits': crt['limits']},
    'stillUnknown': ['Starfall player state0/100 and virtual164 filter business semantics',
                     'Shared rand TLS initialization/seed/call chronology in an actual match',
                     'Starfall Attack effect-set carrier/target dynamic bone and ground projection binding'],
}
output = ROOT / 'contracts/add-starfall-selection-source-v37.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'output': str(output), 'distanceHelperBytes': len(data), 'distanceHelperSha256': result['distanceHelper']['sha256'], 'originalClientExecuted': False}))
