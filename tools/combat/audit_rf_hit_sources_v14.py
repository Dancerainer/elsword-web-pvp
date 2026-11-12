"""Read-only source/target audit for XXX and platform Down -> Z.

This extracts evidence; it neither executes the target client nor authorizes a
state-to-effect binding from similar resource names. Outputs stay task-local.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import re

from kl82_static import OPS, parse, read_declarations

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
from run_camera_source import extract
REFERENCE = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
RECOVERY = 'a1bcdabf39ee1699873b587b40cedefcce61c7f0'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def file_evidence(path, relative=None):
    raw = path.read_bytes()
    return {'path': relative or str(path), 'bytes': len(raw), 'sha256': sha(raw),
            'gitBlob': hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()}


def method_span(path, signature):
    raw = path.read_bytes()
    matches = list(re.finditer(rb'(?m)^([ \t]*)' + re.escape(signature.encode('ascii')), raw))
    if len(matches) != 1:
        raise ValueError('Missing/ambiguous method definition: ' + signature)
    token = b'\n' + matches[0].group(0)
    if raw.count(token) != 1:
        raise ValueError('Missing/ambiguous method: ' + signature)
    body, first, last = extract(raw, token)
    body = body[1:]
    return {'signature': signature, 'firstLine': first + 1,
            'lastLine': last, 'bytes': len(body), 'sha256': sha(body)}


def global_instruction_evidence(chunk, declaration, name):
    location = declaration['locations'][name]
    proto = chunk['prototypes'][location['prototype']]
    final = location['assignmentInstruction']
    earlier = [i for i, word in enumerate(proto['instructions'][:final]) if word & 255 == 0x3d]
    first = earlier[-1] + 1 if earlier else 0
    instructions = []
    for pc in range(first, final + 1):
        word = proto['instructions'][pc]
        op, a, b, c, d = word & 255, word >> 8 & 255, word >> 24, word >> 16 & 255, word >> 16
        row = {'pc': pc, 'word': f'{word:08x}', 'opcode': OPS.get(op, f'unsupported-{op:02x}'), 'a': a, 'b': b, 'c': c, 'd': d}
        if op in (0x14, 0x3b, 0x3c, 0x3d):
            constant = proto['gc'][-1 - d]
            if isinstance(constant, str):
                row['gcConstant'] = constant
            else:
                row['gcConstantSha256'] = sha(json.dumps(constant, sort_keys=True, ensure_ascii=False).encode())
        if op in (0x3f, 0x42):
            row['fieldConstant'] = proto['gc'][-1 - c]
        instructions.append(row)
    return {'prototype': location['prototype'], 'firstPc': first, 'lastPc': final,
            'wordBytesSha256': sha(struct.pack(f'<{final-first+1}I', *proto['instructions'][first:final+1])),
            'instructions': instructions}


def exe_evidence(path):
    raw = path.read_bytes()
    if len(raw) < 64 or raw[:2] != b'MZ':
        raise ValueError('Invalid original PE input')
    pe = struct.unpack_from('<I', raw, 60)[0]
    if pe + 24 > len(raw) or raw[pe:pe+4] != b'PE\0\0':
        raise ValueError('Invalid original PE signature')
    machine, count = struct.unpack_from('<HH', raw, pe + 4)
    optional_size = struct.unpack_from('<H', raw, pe + 20)[0]
    sections = []
    for i in range(count):
        start = pe + 24 + optional_size + 40*i
        if start + 40 > len(raw):
            raise ValueError('Truncated original PE section table')
        name = raw[start:start+8].rstrip(b'\0').decode('ascii', errors='replace')
        virtual_size, rva, disk_size, offset = struct.unpack_from('<IIII', raw, start + 8)
        if disk_size and offset + disk_size > len(raw):
            raise ValueError('Original PE raw section escapes input')
        sections.append({'name': name, 'virtualSize': virtual_size, 'rva': rva,
                         'rawSize': disk_size, 'rawOffset': offset,
                         'rawSha256': sha(raw[offset:offset+disk_size])})
    searches = []
    for text in ('RSI_COMBO_XXX', 'EffectSet_A_RF_XXX', 'DamageEffect_RF_XXX',
                 'Smoke_Raven_ComboX03', 'ComboX3', 'RAVEN_FIGHTER.lua'):
        for encoding in ('ascii', 'utf-16le'):
            needle = text.encode(encoding)
            offsets, pos = [], 0
            while (pos := raw.find(needle, pos)) >= 0:
                offsets.append(pos)
                pos += len(needle)
            searches.append({'text': text, 'encoding': encoding, 'count': len(offsets), 'offsets': offsets})
    return {**file_evidence(path), 'machine': machine, 'sections': sections,
            'method': 'exact whole-file raw byte search; ASCII and UTF-16LE; no execution, unpacking, or disassembly',
            'searches': searches,
            'limit': 'No literal match proves neither absence of the callback nor absence of an encoded/dynamic name. No target consumer or xref was recovered.'}


def build(target_root, exe, source_root=ROOT / '.cache/native-reference', recovery=ROOT / '.cache/reference-combat-fixes-v11/X2GURaven.cpp'):
    enum_path = target_root / 'Enum.lua'
    enums = read_declarations(enum_path)['globals']
    paths = {kind: target_root / name for kind, name in
             [('raven', 'RAVEN_FIGHTER.lua'), ('effect', 'EffectSet.lua'), ('damage', 'DamageEffect.lua')]}
    target = {kind: read_declarations(path, enums, capture_calls=kind != 'raven', capture_unresolved=kind != 'raven') for kind, path in paths.items()}
    chunk = parse(paths['raven'].read_bytes())
    raven = target['raven']
    states = ['RSI_COMBO_XXX', 'RSI_JUMP_COMBO_Z', 'RSI_JUMP_DOWN', 'RSI_DASH_JUMP_COMBO_Z']
    constants = [{'prototype': p['id'], 'gcIndex': i, 'value': v}
                 for p in chunk['prototypes'] for i, v in enumerate(p['gc'])
                 if isinstance(v, str) and any(x in v for x in ('XXX', 'EffectSet_A_RF', 'DamageEffect_RF_XXX'))]
    methods = {'X2Lib/X2GURaven.cpp': ['void CX2GURaven::RSI_COMBO_XXX_FrameMove(',
        'void CX2GURaven::RSI_COMBO_XXX_EventProcess(', 'void CX2GURaven::RSI_JUMP_COMBO_Z_FrameMoveFuture(',
        'void CX2GURaven::RSI_JUMP_COMBO_Z_EventProcess(', 'void CX2GURaven::RSI_JUMP_DOWN_EventProcess(',
        'void CX2GURaven::RSI_DASH_JUMP_COMBO_Z_EventProcess('],
        'X2Lib/X2GUUser.cpp': ['void CX2GUUser::CommonStateStart(', 'void CX2GUUser::DoFrameMoveFuture(',
            'void CX2GUUser::DoFrameMove(', 'void CX2GUUser::DoStateEndStartFuture(',
            'void CX2GUUser::DoStateEndStart(', 'bool CX2GUUser::StateChange( int state, bool bDirectChange )',
            'void CX2GUUser::PushFrameData(', 'void CX2GUUser::CommonFrameMove_TimedEvent('],
        'X2Lib/X2DamageManager.cpp': ['bool CX2DamageManager::DamageCheck(', 'bool CX2DamageManager::CollisionDataToUnit(']}
    files = []
    for relative, signatures in methods.items():
        path = source_root / relative
        files.append({**file_evidence(path, '.cache/native-reference/' + relative),
                      'spans': [method_span(path, signature) for signature in signatures]})
    header = source_root / 'X2Lib/X2DamageManager.h'
    files.append({**file_evidence(header, '.cache/native-reference/X2Lib/X2DamageManager.h'),
                  'spans': [method_span(header, 'void SimpleInit(')]})
    files.append({**file_evidence(recovery, '.cache/reference-combat-fixes-v11/X2GURaven.cpp'),
                  'sourceCommit': RECOVERY,
                  'spans': [method_span(recovery, 'void CX2GURaven::RSI_COMBO_XXX_FrameMove(')]})
    effect_roots = json.loads((ROOT / 'contracts/rf-command-resource-roots-v9.json').read_bytes())
    # Confirm independently frozen target entries against the fresh full KL parse.
    for kind, root_key, name in [('effect', 'effectSets', 'EffectSet_A_RF_XXX'), ('damage', 'damageEffects', 'DamageEffect_RF_XXX')]:
        frozen = effect_roots[root_key][name]
        actual = target[kind]['globals'].get(name)
        if actual is None:
            actual = next(v['args'][-1] for v in target[kind]['nativeCalls'] if isinstance(v.get('args', [None])[-1], dict) and v['args'][-1].get('NAME') == name)
        if json.loads(json.dumps(actual)) != frozen['raw']:
            raise ValueError('Independent target declaration drift: ' + name)
    source_text = (source_root / 'X2Lib/X2GURaven.cpp').read_bytes()
    reference_literals = {text: source_text.count(text.encode()) for text in ('EffectSet_A_RF_XXX', 'DamageEffect_RF_XXX', 'RSI_COMBO_XXX', 'UC_RAVEN_RECKLESS_FIST')}
    return {'schema': 'rf-hits-source-v14', 'targetVersion': 'Steam-NA-2016-V6.0420.5',
        'referenceCommit': REFERENCE, 'recoveryCommit': RECOVERY,
        'evidenceClass': 'target2016-static-declarations + fixed-V5-source + separately-pinned-2026-reconstruction',
        'targetClientMeasured': False, 'originalClientMeasurementCount': 0,
        'sourceFiles': files, 'targetFiles': [file_evidence(enum_path)] + [file_evidence(p) for p in paths.values()],
        'targetRaven': {'prototypes': len(chunk['prototypes']), 'rootCallInstructionCount': sum((w & 255) in (0x2b, 0x2c) for w in chunk['prototypes'][-1]['instructions']),
            'xxxNameConstants': constants,
            'states': [{'name': name, 'raw': raven['globals'][name],
                        'instructionEvidence': global_instruction_evidence(chunk, raven, name)} for name in states]},
        'targetXxxResources': {'effectSet': effect_roots['effectSets']['EffectSet_A_RF_XXX'],
                               'damageEffect': effect_roots['damageEffects']['DamageEffect_RF_XXX']},
        'fixedRavenLiteralCounts': reference_literals, 'originalExe': exe_evidence(exe),
        'conclusions': [
            'Target XXX has no character DAMAGE_DATA, ATTACK_TIME or EFFECT_SET fields. The sole target Raven prototype has no owner callback or native call to resolve its resource-only set.',
            'Fixed V5 XXX at animation .16 charges7MP, spawns three smoke/flare particles, and calls a manual sphere110 DamageCheck. CommonStateStart SimpleInit then missing DAMAGE_DATA has RT_NO_DAMAGE/zero damage. Enabling this sphere cannot recover target2016 damage.',
            'Target resource-only XXX set schedules DamageEffect_RF_XXX at set-relative .25; 18-hit lock-on/global phase fields are known, but set-start animation/global time and owner binding are unknown. No .16+.25 mapping is assumed.',
            'Reference StateChange stores nextState. JumpZ Future reduces speed under heldDown, then CommonFuture physics runs, then EventProcess requests landing. Common Now attack uses strict >.11, unchanged target helper geometry. Missing a prior attack window after a too-late landing is not license to replay it.',
            'No combat constants, helper radius, or unsupported target owner binding is changed by this audit.'
        ]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target-root', type=Path, default=Path('asset_work/raw/data/data036.kom'))
    parser.add_argument('--exe', type=Path, default=Path('asset_sources/client/data/x2.exe'))
    parser.add_argument('--output', type=Path, default=ROOT / 'contracts/rf-hits-source-v14.json')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(args.target_root.resolve()):
        raise ValueError('Output must stay inside this task checkout')
    data = build(args.target_root, args.exe)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'sourceFiles': len(data['sourceFiles']), 'xxxFields': len(data['targetRaven']['states'][0]['raw']),
                      'prototypes': data['targetRaven']['prototypes'], 'targetClientMeasured': False}))


if __name__ == '__main__':
    main()
