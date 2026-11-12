"""Freeze/check actual Down-Z declarations, helper identities and phase consumers.

Read-only upstream; this evidence does not supply a target-client hit oracle.
"""
import argparse
import json
from pathlib import Path

from audit_rf_hit_sources_v14 import ROOT, REFERENCE, file_evidence, method_span, sha
from kl82_static import read_declarations


def line_span(path, first, last, meaning):
    raw = b''.join(path.read_bytes().splitlines(keepends=True)[first - 1:last])
    return {'firstLine': first, 'lastLine': last, 'bytes': len(raw),
            'sha256': sha(raw), 'meaning': meaning}


def build(target_root=Path('asset_work/raw/data/data036.kom')):
    reference = ROOT / '.cache/native-reference'
    signatures = {
        'X2Lib/X2GUUser.cpp': ['HRESULT CX2GUUser::OnFrameMove(',
            'void CX2GUUser::DoFrameMoveFuture(', 'void CX2GUUser::DoFrameMove(',
            'void CX2GUUser::DoStateEndStartFuture(', 'void CX2GUUser::DoStateEndStart(',
            'bool CX2GUUser::StateChange( int state, bool bDirectChange )',
            'void CX2GUUser::CommonFrameMoveFuture(', 'void CX2GUUser::CommonFrameMove(',
            'void CX2GUUser::CommonFrameMove_TimedEvent(',
            'void CX2GUUser::CommonStateStart(', 'void CX2GUUser::CommonStateEnd(',
            'void CX2GUUser::PhysicProcess('],
        'X2Lib/X2GURaven.cpp': ['void CX2GURaven::RSI_JUMP_DOWN_EventProcess(',
            'void CX2GURaven::RSI_JUMP_COMBO_Z_FrameMoveFuture(',
            'void CX2GURaven::RSI_JUMP_COMBO_Z_EventProcess(',
            'void CX2GURaven::RSI_DASH_JUMP_COMBO_Z_EventProcess('],
        'X2Lib/X2DamageManager.cpp': ['bool CX2DamageManager::UnitToUnit(',
            'bool CX2DamageManager::DamageCheck(',
            'bool CX2DamageManager::CollisionDataCheckFromUnitToUnit('],
        'KTDXLIB/KTDGXSkinAnim.cpp': ['HRESULT CKTDGXSkinAnim::OnFrameMove('],
        'KTDXLIB/KTDXDeviceXSkinMesh.cpp': [
            'void CKTDXDeviceXSkinMesh::XSkinMeshProxy::AddCollisionData('],
    }
    files = []
    for relative, methods in signatures.items():
        path = reference / relative
        files.append({**file_evidence(path, '.cache/native-reference/' + relative),
                      'methods': [method_span(path, method) for method in methods]})
    for relative, spans in {
        'KTDXLIB/KTDGXSkinAnim.h': [(381, 494, 'AdvanceTime -> track position -> combined bone matrices; root XZ consumption')],
        'KTDXLIB/KTDXCollision.h': [(106, 199, 'helper center and decomposed X radius'),
            (215, 348, 'enabled collision list entries, posed LineToSphere')],
        'X2Lib/X2GUUser.cpp': [(5215, 5289, 'equipment and character collision/attack list sets'),
            (14638, 14669, 'state-start explicit helper enable/disable'),
            (19578, 19605, 'state-end inverse helper restoration')],
    }.items():
        path = reference / relative
        files.append({**file_evidence(path, '.cache/native-reference/' + relative),
                      'lineSpans': [line_span(path, first, last, meaning) for first, last, meaning in spans]})
    trace = json.loads((ROOT / 'contracts/rf-trace-mesh-phase-source-v13.json').read_bytes())
    trace_files = []
    for file in trace['sourceFiles']:
        path = ROOT / file['path']
        if file_evidence(path)['sha256'] != file['sha256']:
            raise ValueError('Frozen TRACE source drift: ' + file['path'])
        for span in file['spans']:
            actual = line_span(path, span['startLine'], span['endLine'], span['meaning'])
            if actual['sha256'] != span['sha256']:
                raise ValueError('Frozen TRACE span drift: ' + file['path'])
        trace_files.append(file)
    enum = target_root / 'Enum.lua'
    raven = target_root / 'RAVEN_FIGHTER.lua'
    declarations = read_declarations(raven, read_declarations(enum)['globals'])['globals']
    profile = json.loads((ROOT / 'packages/combat-core/rf-profile.json').read_bytes())
    names = ('RSI_JUMP_DOWN', 'RSI_JUMP_COMBO_Z', 'RSI_DASH_JUMP_COMBO_Z')
    states = json.loads(json.dumps({name: declarations[name] for name in names}))
    for name, raw in states.items():
        if raw != profile['states'][name]['raw']:
            raise ValueError('Target declaration/profile drift: ' + name)
    pose_path = ROOT / 'artifacts/rf/runtime-pose.json'
    pose = json.loads(pose_path.read_bytes())
    helpers = [{key: helper[key] for key in ('name', 'nativeStoredBoundingRadius', 'geometryBoundingSphereCandidate', 'source') if key in helper}
               for helper in pose['helpers'] if helper['name'].startswith(('ATTACK_', 'COLLISION_'))]
    return {'schema': 'rf-down-hit-source-v16', 'referenceCommit': REFERENCE,
        'evidenceClass': 'target2016-static-declaration-and-helper + pinned-V5-source-consumer',
        'targetClientMeasured': False, 'originalClientMeasurementCount': 0,
        'sourceFiles': files, 'tracePhaseSourceFiles': trace_files,
        'targetFiles': [file_evidence(enum), file_evidence(raven)], 'targetStates': states,
        'helperInput': {**file_evidence(pose_path, 'artifacts/rf/runtime-pose.json'), 'helpers': helpers},
        'phaseInterpretation': [
            'Local Future: state start, CommonFrameMoveFuture advances Future animation then physics, EventProcess requests a later state.',
            'StateChange(false) changes nextState/stateChangeNum; it does not immediately erase the current Now attack.',
            'Now: consume sync position, update animation/bone matrices, then CommonFrameMove_TimedEvent evaluates the strictly open authored attack interval.',
            'UnitToUnit consumes enabled character/equipment helper lists and distinct defender collision lists; first-hit memory, team/death/invincibility policies remain.',
            'TRACE mesh/EffectSet pending-position phase is a separate cache boundary; it does not authorize resampling character sword from the previous animation frame.'],
        'limits': ['Target V6.0420.5 state scheduler/packet pipeline has not been obtained or measured.',
            'Sword ATTACK_LINE_START0 still uses its recorded source-vertex bounding-sphere candidate; original native .X radius construction is not independently measured.',
            'No simulated miss or hit count can be used as original-client golden data.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'contracts/rf-down-hit-source-v16.json')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT):
        raise ValueError('Output must stay in this task checkout')
    data = build()
    if args.check:
        if json.loads(output.read_bytes()) != data:
            raise ValueError('Committed Down-hit source contract drift')
    else:
        output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'check': args.check, 'sourceFiles': len(data['sourceFiles']),
                      'sourceMethods': sum(len(f.get('methods', [])) for f in data['sourceFiles']),
                      'states': len(data['targetStates']), 'targetClientMeasured': False}))


if __name__ == '__main__':
    main()
