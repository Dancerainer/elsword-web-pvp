"""Re-parse target 2016 declarations and verify qualified V5 final-Z bodies.

Only task-local small evidence is written. No client or upstream is executed.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
from run_camera_source import extract
from prepare_lk_declarations import prepare

STATE = 'ESSI_ETK_COMBO_XXXZ'
sha = lambda data: hashlib.sha256(data).hexdigest()


def audit(source_root, sword_source, skin_source, scratch, output):
    prepare(source_root, scratch, names={'enum': 'Enum.lua', 'elsword': 'Elsword_SwordMan.lua'})
    declarations = json.loads((scratch / 'elsword-declarations.json').read_text('utf8'))
    profile = json.loads((ROOT / 'packages/combat-core/is-profile.json').read_text('utf8'))
    target = declarations['globals'][STATE]
    if target != profile['states'][STATE]['raw']:
        raise ValueError('Fresh target declaration differs from frozen profile')
    reference = json.loads((ROOT / 'contracts/is-reference-consumers-v1.json').read_text('utf8'))
    data = sword_source.read_bytes()
    if sha(data) != reference['source']['sha256']:
        raise ValueError('Pinned V5 SwordMan file hash mismatch')
    expected = {row['method']: row for row in reference['methods']}
    methods = []
    for suffix in ('FrameMove', 'EventProcess', 'StateEnd'):
        name = STATE + '_' + suffix
        block, first, last = extract(data, ('void CX2GUElsword_SwordMan::' + name + '()').encode('ascii'))
        if sha(block) != expected[name]['sha256']:
            raise ValueError('Pinned method hash mismatch: ' + name)
        methods.append({'method': name, 'line': first, 'lastLine': last, 'sha256': sha(block)})
        if suffix == 'EventProcess' and (b'IsAnimationEnd()' not in block or b'WALK_CANCEL_AFTER' not in block or b'SKILL_CANCEL_AFTER' not in block):
            raise ValueError('Qualified end/cancellation branch missing')
    motion_index = json.loads((ROOT / 'contracts/is-assets-motion-index.json').read_text('utf8'))
    motion = next(row for row in motion_index['sourceEvidence'] if row['name'] == 'Motion_Elsword_TK.x')
    if sha((source_root / motion['rawPath']).read_bytes()) != motion['sha256']:
        raise ValueError('Target 2016 motion input hash mismatch')
    clip = next(row for row in motion_index['clips'] if row['name'] == target['ANIM_NAME'])
    if clip['durationSeconds'] != 1.2 or clip['decodedKeysSha256'] != profile['states'][STATE]['clip']['decodedKeysSha256']:
        raise ValueError('Frozen original motion identity mismatch')
    skin_data = skin_source.read_bytes()
    skin_sha = '4ff5e681c5b63eb828d00e0e6fc848066af93ed39b0750615765da248911c76d'
    if sha(skin_data) != skin_sha:
        raise ValueError('Pinned V5 SkinAnim file hash mismatch')
    skin_methods = []
    for signature in ('HRESULT CKTDGXSkinAnim::OnFrameMove(', 'bool CKTDGXSkinAnim::ChangeAnim( LPD3DXANIMATIONSET'):
        block, first, last = extract(skin_data, signature.encode('ascii'))
        skin_methods.append({'signature': signature, 'line': first, 'lastLine': last, 'sha256': sha(block)})
    result = {'schemaVersion': 1, 'clientMeasured': False,
        'target': {'evidenceClass': 'fresh static target2016 declaration', 'source': declarations['source'], 'state': STATE, 'raw': target},
        'motion': {'evidenceClass': 'target2016 source hash rechecked; previously decoded original keyframes', 'source': motion, 'clip': clip},
        'reference': {**reference['source'], 'actualMethods': methods,
            'eventSemantics': ['not grounded: JUMP_DOWN', 'IsAnimationEnd: WAIT', 'WALK_CANCEL_AFTER with movement input', 'SKILL_CANCEL_AFTER with skill input'],
            'idleForcedRecoveryAtPoint4': False},
        'animationEndReference': {'path': 'KTDXLIB/KTDGXSkinAnim.cpp', 'fileSha256': skin_sha,
            'commit': reference['source']['commit'], 'evidenceClass': 'pinned V5 consumer; not target2016 executable', 'methods': skin_methods,
            'formula': 'IsAnimationEnd when animationTime > period - transitionTime',
            'fallbackTransitionTime': 'max(period/10, .03); per-clip target XET override has not been consumed',
            'currentDefaultEndAnimationSeconds': 1.08},
        'webChange': {'removed': 'prior user adapter recover=.4 forced WAIT without input',
            'retained': 'prior explicit-input .37 skill/dash/fresh-walk windows; source raw fields remain .5/.6'},
        'limits': ['Matching target2016 native callback/executable trace has not been acquired.',
            'Pinned V5 consumer is a version reference, not target2016 runtime proof.',
            'Simulation regressions and original-client evidence remain separate.']}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf8')
    print(json.dumps({'contract': str(output), 'sha256': sha(output.read_bytes()), 'methods': methods}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--sword-source', type=Path, required=True)
    parser.add_argument('--skin-source', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, default=ROOT / '.cache/is-final-z-review')
    parser.add_argument('--output', type=Path, default=ROOT / 'contracts/is-final-z-source-review.json')
    args = parser.parse_args()
    audit(args.source_root, args.sword_source, args.skin_source, args.scratch, args.output)
