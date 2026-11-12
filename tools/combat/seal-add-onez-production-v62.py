"""Static source verification only: pinned static analysis input producer + derived bytes.

No binary, DLL, Lua, Ghidra process, live heap or user device is executed.
The mutable upstream checkout is never read: every static analysis source comes from an
explicit immutable Git object. Outputs belong to this independent task tree.
"""
from pathlib import Path
import gzip, hashlib, json, struct, subprocess, sys

sys.dont_write_bytecode = True
sys.path.insert(0, 'asset_sources/analysis/offline-libs')
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
ROOT = Path(__file__).resolve().parents[2]
REPO = 'asset_sources/analysis-project'
REF = '0f96f609c26cdf03afb80da7203f796a6747bc3d'
SOURCE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
SOURCE_SHA = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
sha = lambda b: hashlib.sha256(b).hexdigest()

def git_bytes(name):
    # Resolve the logical report path against the immutable source tree without
    # assuming the historical name of its intermediate directory.
    suffix = name.removeprefix('reports/analysis/')
    paths = subprocess.check_output(['git', '-C', REPO, 'ls-tree', '-r', '--name-only', REF], text=True).splitlines()
    matches = [entry for entry in paths if entry.startswith('reports/') and entry.endswith('/' + suffix)]
    if len(matches) != 1:
        raise RuntimeError('Expected one pinned report for ' + name)
    return subprocess.check_output(['git', '-C', REPO, 'show', REF + ':' + matches[0]])

path = 'reports/analysis/hit-input-cancel-2016/native-cfg-and-dependencies.json.gz'
packed = git_bytes(path)
records = json.loads(gzip.decompress(packed))
record = next(r for r in records if r['sourcePath'].startswith('reports/')
              and r['sourcePath'].endswith('/full-maximum/input-event-production.json'))
methods = record['content']['functions']
raw = SOURCE.read_bytes()
assert sha(raw) == SOURCE_SHA
pe = struct.unpack_from('<I', raw, 60)[0]
opt = pe + 24
base = struct.unpack_from('<I', raw, opt + 28)[0]
count = struct.unpack_from('<H', raw, pe + 6)[0]
size = struct.unpack_from('<H', raw, pe + 20)[0]
sections = [struct.unpack_from('<IIII', raw, opt + size + i * 40 + 8) for i in range(count)]

def original(address, n):
    for vs, rva, rs, start in sections:
        if base + rva <= address and address + n <= base + rva + min(vs, rs):
            return raw[start + address - base - rva:start + address - base - rva + n]
    raise ValueError(hex(address))

selected = ['0x31c44c30', '0x31c44550', '0x31c445a0', '0x31d08ba0', '0x31d08e90', '0x320cfdc0']
blocks = []
for entry in selected:
    f = next(f for f in methods if f['entry'] == entry)
    data = bytes.fromhex(f['sourceSpanHex'])
    assert sha(data) == f['sourceSpanSha256']
    assert original(int(f['sourceSpanStart'], 16), len(data)) == data
    for row in f['instructions']:
        address = int(row.get('va', row.get('address')), 16)
        assert original(address, len(bytes.fromhex(row['bytes']))) == bytes.fromhex(row['bytes'])
    blocks.append({'entry': entry, 'bytes': len(data), 'sha256': sha(data), 'hex': data.hex(),
                   'unresolved': f['unresolved'], 'instructions': f['instructions']})
game = next(f for f in methods if f['entry'] == '0x320c07c0')
rows = [r for r in game['instructions'] if 0x320c1065 <= int(r.get('va', r.get('address')), 16) < 0x320c108a]
callsite = original(0x320c1065, 0x25)
assert b''.join(bytes.fromhex(r['bytes']) for r in rows) == callsite
blocks.append({'entry': '0x320c1065', 'bytes': len(callsite), 'sha256': sha(callsite),
               'hex': callsite.hex(), 'instructions': rows, 'scope': 'logical action0 → game input+311 once byte callsite'})
reset = original(0x31f915e3, 0x26)
blocks.append({'entry': '0x31f915e3', 'bytes': len(reset), 'sha256': sha(reset), 'hex': reset.hex(),
               'scope': 'Common state entry zeroes flag byte5d69 via dword at31f915f7; not a Manager79 clear'})
for address, n, scope in [
    (0x31f66b80, 0x334, 'FullSetInputData: raw80B backup, suppression, direction swaps, old/current copy, virtual56c tail'),
    (0x31f35610, 0x8d, 'Actual Add/User virtual56c: conditional suppressor, input-lock zeroes, conditional clear80 tail'),
    (0x31fb3960, 0xca, 'Five-way input suppressor; AL=0 before switch, all selected write paths clear only'),
    (0x31ee5080, 0x8c, 'Full80B input clear; no held-to-once synthesis'),
]:
    data = original(address, n)
    instructions = [{'address': hex(i.address), 'bytes': i.bytes.hex(), 'mnemonic': i.mnemonic, 'operands': i.op_str}
                    for i in Cs(CS_ARCH_X86, CS_MODE_32).disasm(data, address)]
    assert sum(len(bytes.fromhex(r['bytes'])) for r in instructions) == n
    blocks.append({'entry': hex(address), 'bytes': n, 'sha256': sha(data), 'hex': data.hex(),
                   'instructions': instructions, 'scope': scope})
table = original(0x31fb3a2c, 20)
targets = [hex(v) for v in struct.unpack('<5I', table)]
assert targets == ['0x31fb3a27', '0x31fb3973', '0x31fb397f', '0x31fb3997', '0x31fb39bb']
blocks.append({'entry': '0x31fb3a2c', 'bytes': 20, 'sha256': sha(table), 'hex': table.hex(),
               'targets': targets, 'scope': 'Complete suppressor jump table: each target is in the sealed zero-write body'})
bindings = []
for address in [0x330625bc+0x56c, 0x3301576c+0x56c]:
    data = original(address, 4)
    assert struct.unpack('<I', data)[0] == 0x31f35610
    bindings.append({'address': hex(address), 'bytesHex': data.hex(), 'sha256': sha(data), 'target': '0x31f35610'})
old = json.loads((ROOT/'contracts/add-movement-command-v61.json').read_text(encoding='utf-8'))
loop = next(b for b in old['blocks'] if b['address'] == '0x32765210')
assert original(0x32765210, loop['bytes']) == bytes.fromhex(loop['hex'])
out = {'schemaVersion': 1, 'id': 'add-onez-production-v62', 'originalTargetExecuted': False,
       'source': {'path': str(SOURCE), 'sha256': SOURCE_SHA,
                  'originalClientSha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
                  'qualification': 'Existing possibly non-atomic late-snapshot3; no match/device/heap measurement.'},
       'pinnedAnalysisInput': {'repository': REPO, 'commit': REF, 'path': path, 'bytes': len(packed), 'sha256': sha(packed),
                          'selectedNestedSource': record['sourcePath'], 'selectedNestedSourceSha256': record['sha256']},
       'blocks': blocks, 'inputPostVtableBindings': bindings,
       'loopConsumer': {'path': 'contracts/add-movement-command-v61.json', 'address': '0x32765210', 'sha256': loop['sha256']},
       'findings': [
           'Manager31c44c30 clears49 action levels, reads actual devices and repopulates levels.31c44d15 clears79 only when the corresponding49 is zero.',
           'Once getter31c44550 requires49!=0 and79==0, writes79=1, returns1 once. Pure getter31c445a0 independently reports49!=0.',
           '320cfdc0 calls doublePure/doubleOne/pure/once in that order; logical action0 call320c1085 writes the once result to game311, later actor6453.',
           'FullSetInputData31f66b80 copies80B raw, applies suppression/direction swaps, copies previous/current input, then calls actualAdd/User56c31f35610. Its conditional31fb3960/31ee5080 paths clear selected/all bytes; they do not turn held6452 into fresh6453.',
           'XXZZ post32765210 reads actor6453, not pure6452. It latchesflag5d69 within the current loop and checks that flag only after the minimum count.',
           'Base state entry31f915f7 clears5d69 independently of Manager79. This instruction does not unlock the device once getter; all lifecycle descendants are not established by this local write.',
           'Under normal fresh device polling a continuously held Z does not create a new oneZ each loop. The original mandatory two loops still produce a short sustained action.',
           'Once means one Manager consumption, not necessarily one unique physical press in every callback: force/recomputation may reread the already-copied80B input.'],
       'limits': ['Actual selected keyboard/joystick mode, mapping and physical repeat behavior were not observed.',
                  'SelectedXXZZ received Start callsAdd61432753a00→User31f96ef0; End calls62c3272b9a0→31f75e70. Their complete transitive lifecycle callbacks have not all been ruled out as additional input-lock writers.',
                  'No global theorem that every original force/recomputation schedule yields exactly two loops from one held key.',
                  'No speculative timer/auto-repeat or held→fresh conversion is introduced into production.']}
target = ROOT/'contracts/add-onez-production-v62.json'
serialized = json.dumps(out, ensure_ascii=False, indent=2)+'\n'
if '--verify-only' in sys.argv:
    assert target.read_text(encoding='utf-8') == serialized
else:
    target.write_text(serialized, encoding='utf-8', newline='\n')
print(json.dumps({'staticOnly': True, 'sourceSha256': SOURCE_SHA, 'blocks': len(blocks), 'contract': str(target)}))
