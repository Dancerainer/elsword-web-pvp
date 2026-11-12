"""Seal the selected original DE 66XXX frame and set. No target execution.

The declaration projection is an explicit read-only input. Its original script
SHA is verified; this tool does not execute Lua or write to that input cache.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, 'asset_sources/analysis/offline-libs')
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--effect-declarations', type=Path, required=True)
args = parser.parse_args()
source = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
raw = source.read_bytes()
sha = lambda value: hashlib.sha256(value).hexdigest()
expected = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
assert sha(raw) == expected
pe = struct.unpack_from('<I', raw, 60)[0]
opt = pe + 24
base = struct.unpack_from('<I', raw, opt + 28)[0]
count = struct.unpack_from('<H', raw, pe + 6)[0]
size = struct.unpack_from('<H', raw, pe + 20)[0]
sections = [struct.unpack_from('<IIII', raw, opt + size + i * 40 + 8) for i in range(count)]

def offset(address):
    for vs, rva, rs, start in sections:
        if base + rva <= address < base + rva + min(vs, rs):
            return start + address - base - rva
    raise ValueError(hex(address))

def span(address, length):
    value = raw[offset(address):offset(address) + length]
    return {'address': hex(address), 'fileOffset': offset(address), 'bytes': length,
            'sha256': sha(value), 'hex': value.hex()}

def function(address):
    rows = []
    for instruction in Cs(CS_ARCH_X86, CS_MODE_32).disasm(raw[offset(address):offset(address) + 0x800], address):
        rows.append({'address': hex(instruction.address), 'bytes': instruction.bytes.hex(),
                     'mnemonic': instruction.mnemonic, 'operands': instruction.op_str})
        if instruction.mnemonic == 'ret':
            break
    assert rows[-1]['mnemonic'] == 'ret'
    return {**span(address, instruction.address + instruction.size - address), 'instructions': rows}

def literal(address, value, encoding):
    value_bytes = value.encode(encoding) + bytes(2 if encoding == 'utf-16le' else 1)
    assert raw[offset(address):offset(address) + len(value_bytes)] == value_bytes
    return {**span(address, len(value_bytes)), 'value': value, 'encoding': encoding}

sets = json.loads(args.effect_declarations.read_text(encoding='utf-8-sig'))
assert sets['source']['sha256'] == '6c6a0fd7759921c070a8d04fa26ddd1a6432c307e185d9a4d5188919099b16c7'
assert sha(Path(sets['source']['path']).read_bytes()) == sets['source']['sha256']
name = 'EffectSet_ADE_DashCombo_XXX_Bomb'
call = next(row for row in sets['nativeCalls']
            if row['target'] == 'g_pEffectSet.AddEffectSetTemplet_LUA'
            and row.get('args', [None, {}])[1].get('NAME') == name)
assert call['args'][1]['EFFECT0'] == {
    'NAME': 'DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Projectile',
    'POSITION_OFFSET_X': 0, 'START_TIME': .25, 'BONE_NAME': 'Bip01', 'EFFECT_TYPE': 1}
closure_path = ROOT / 'contracts/add-de-command-closure-v45.json'
assert sha(closure_path.read_bytes()) == '9dcee16d446b06ce8e2135043c0c849bc593eba064afc7deb190b1f21d1c7132'
frame = function(0x32757010)
assert frame['bytes'] == 0x202
assert function(0x3272bf30)['bytes'] == 49
contract = {
    'schemaVersion': 1, 'id': 'de-dash-xxx-v58', 'targetExecuted': False, 'targetClientMeasured': False,
    'evidenceClass': 'original2016 static bytes/declarations; Web simulation tests are separate',
    'source': {'path': str(source), 'sha256': expected,
               'originalClientSha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
               'qualification': 'Historical derived PE may be non-atomic; not the original on-disk EXE.'},
    'registration': span(0x3276fc6f, 0x39),
    'stateName': literal(0x33062f48, 'ANSI_ADE_DASH_COMBO_XXX', 'ascii'),
    'frameThunk': span(0x327763c0, 5), 'frame': frame,
    'firstDashExit': {
        'stateName': literal(0x33061dac, 'ANSI_DASH_COMBO_X', 'ascii'),
        'registration': span(0x3276b628, 0x57),
        'endFutureThunk': span(0x32774330, 5),
        'endFuture': function(0x3272bf30),
        'commonStartFutureSlot': {**span(0x330625bc + 0x610, 4), 'target': '0x3272edb0'},
        'halfTurn': {**span(0x32fe8078, 8), 'value': struct.unpack_from('<d', raw, offset(0x32fe8078))[0]},
        'meaning': 'Shared Add state0x90 EndFuture calls VT+610, adds180 to Future yaw+5dd8 and toggles Future.bIsRight+5e26; no target-dependent turn.'},
    'forcedStateChange': {
        'baseCompleteBody': span(0x31f849c0, 783),
        'futureApplyCompleteBody': span(0x31f64a90, 807),
        'meaning': 'Original base request at31f84b82 compares force byte1; the accepted force branch directly calls31f64a90 at31f84be7. The original apply routine invokes oldrecord+50 (first66X EndFuture), then installs next state and invokes newrecord+20/fallback610. Direct change does not bypass the old future exit.',
        'priorFullContract': 'contracts/add-analysis-v53/STARDUST_TERMINAL_2016.md'},
    'physicsDirectionBranch': {
        **span(0x31f6e3c6, 0x1db),
        'enclosingFunction': '0x31f6c810',
        'meaning': 'Selected interior branch, not a complete function: loads local horizontal actor1ac at31f6e3cc; Future.bIsRight5e26 selects position addition at31f6e48f or subtraction at31f6e572. Preserving local speed while toggling facing reverses its Web world-vx representation.',
        'fullFunctionContract': 'contracts/add-analysis-v53/DE_PHYSICS_SIDEEFFECTS_2016.md'},
    'effectSetName': literal(0x33060168, name, 'utf-16le'),
    'constants': [
        {**span(0x32fe77f0, 4), 'value': struct.unpack_from('<f', raw, offset(0x32fe77f0))[0]},
        {**span(0x3305cf14, 4), 'value': struct.unpack_from('<f', raw, offset(0x3305cf14))[0]},
    ],
    'reusedClosure': {'path': 'contracts/add-de-command-closure-v45.json', 'sha256': sha(closure_path.read_bytes()),
                      'names': ['DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Projectile',
                                'DamageEffect_ANSI_ATT_DASH_JUMP_COMBO_ZX_Explosion']},
    'reusedResourceGate': {'contract': 'contracts/add-de-command-native-v45.json',
                          'function': 'resourceGate', 'address': '0x327427d0', 'vtableSlot': '0x560'},
    'effectSets': {name: {'raw': call['args'][1],
                          'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']},
                          'source': sets['source']}},
    'confirmed': {
        'frame': 'Registered state248 (0xf8), received327763c0 ->32757010; .01 once, Bip01 position; original VT+560 gate3 before named set.',
        'gate': 'Same original327427d0 as DE aerialZX: ordinary MP3 or formed learned29410 rawDP3 gate; no new amount.',
        'setClock': 'Original ordinary PlayEffectSet uses absolute actor animation time; callback .01 does not delay member .25.',
        'attack': 'Existing original projectile and HIT/DIE explosion closure; MAGIC1.17/PVP.6 and native finite collision mesh retained.',
        'direction': 'Original common first66X EndFuture flips facing once on leaving the state; DE XX/XXX retains this facing. Web world-vx changes sign to preserve the native local nowSpeed.x.',
    },
    'limits': ['Static original registration/frame, not original-client battle measurement.',
               'The existing qualified option-aware DP modifier remains the shared Web adapter.'],
}
(ROOT / 'contracts/de-dash-xxx-v58.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'state': contract['stateName']['value'], 'frameSha256': frame['sha256'],
                  'set': name, 'declarationSha256': sets['source']['sha256']}))
