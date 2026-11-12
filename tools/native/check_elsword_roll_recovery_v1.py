"""Verify target2016 Roll rows and qualified shared SwordMan consumers."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['ESSI_SI_A_ES_ROLLING', 'ESSI_SI_A_ES_ROLLING_END']

def sha(data):
    return hashlib.sha256(data).hexdigest()

def fragment(path, first, last, purpose):
    data = path.read_bytes()
    lines = data.splitlines(keepends=True)
    return {'file': path.name, 'sha256': sha(data), 'firstLine': first, 'lastLine': last,
            'fragmentSha256': sha(b''.join(lines[first-1:last])), 'purpose': purpose,
            'evidenceClass': 'fixed-V5-version-reference',
            'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'}

def build(cache, sword, native):
    doc = json.loads((cache/'elsword-declarations.json').read_bytes())
    if sha(Path(doc['source']['path']).read_bytes()) != doc['source']['sha256']:
        raise ValueError('Original target2016 declaration bytes changed')
    rows = {}
    for profession in ['LK', 'IS', 'RS']:
        profile = json.loads((ROOT/'packages/combat-core'/f'{profession.lower()}-profile.json').read_bytes())
        rows[profession] = {}
        for name in NAMES:
            state = profile['states'][name]
            if state['raw'] != doc['globals'][name]:
                raise ValueError(f'{profession} {name} differs from the target declaration')
            rows[profession][name] = {'raw': state['raw'], 'clip': state['clip'], 'location': doc['locations'][name]}
    landing = doc['globals'][NAMES[1]]
    if landing['WALK_CANCEL_AFTER'] != 0.266 or landing['APPLY_ANIM_SPEED_BY_ITEM_ABILITY'] != 0:
        raise ValueError('Target Roll recovery rule changed')
    sword_lines = sword.read_bytes().splitlines(keepends=True)
    landing_callback = b''.join(sword_lines[16477:16492])
    if b'WALK_CANCEL_AFTER( m_fWalkCancelAfter )' not in landing_callback:
        raise ValueError('Shared Roll landing callback is unavailable')
    macro_path = native/'X2Lib/X2GUUser.h'
    macro = b''.join(macro_path.read_bytes().splitlines(keepends=True)[81:85])
    if b'GetNowAnimationTime() > (time)' not in macro or b'StateChange( USI_WAIT )' not in macro:
        raise ValueError('Strict source walk macro is unavailable')
    consumer = native/'X2Lib/X2GUUser.cpp'
    reader = b''.join(consumer.read_bytes().splitlines(keepends=True)[13894:13899])
    if b'"WALK_CANCEL_AFTER"' not in reader or b'm_fWalkCancelAfter' not in reader:
        raise ValueError('Source Lua field consumer is unavailable')
    refs = [fragment(sword,16444,16453,'Roll airborne animation-end to grounded landing'),
            fragment(sword,16478,16492,'Landing animation-end priority, then walk cancel'),
            fragment(macro_path,82,85,'Strict animation threshold; either horizontal key; Wait successor'),
            fragment(consumer,13895,13899,'Read authored WALK_CANCEL_AFTER from state data')]
    result = {'schemaVersion':1, 'originalClientMeasured':False, 'targetSource':doc['source'],
              'targetStatesByProfession':rows, 'references':refs,
              'implementationBoundary':[
                  'Target2016 declares .266 and disables item animation speed for both Roll phases.',
                  'Pinned V5 shared callback and strict horizontal macro supply qualified consumers; matching V6 runtime is unmeasured.',
                  'Generic facing-specific combo cancel must not preempt this shared landing callback.',
                  'Natural animation end retains priority; attack/skill/up/down inputs alone do not invoke the horizontal macro.']}
    (ROOT/'contracts/elsword-roll-recovery-source-v1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'professions':3, 'targetStates':6, 'references':len(refs), 'sourceChecked':True}))

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--sword',type=Path,required=True)
    p.add_argument('--native',type=Path,required=True)
    a=p.parse_args()
    build(a.cache,a.sword,a.native)
