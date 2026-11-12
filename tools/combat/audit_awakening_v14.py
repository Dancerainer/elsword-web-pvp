"""Freeze exact old-source consumers separately from target/user behavior."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def sha(data): return hashlib.sha256(data).hexdigest()
def function(data, name):
    start = data.index(name.encode('ascii'))
    opening = data.index(b'{', start); cursor = opening + 1; depth = 1
    while depth:
        if data[cursor] == 123: depth += 1
        if data[cursor] == 125: depth -= 1
        cursor += 1
    return {'symbol': name, 'range': [data[:start].count(b'\n')+1, data[:cursor].count(b'\n')+1],
        'sha256': sha(data[start:cursor])}, data[start:cursor]

def build(reference):
    prior = json.loads((ROOT / 'contracts/rf-nasod-passives-source-v13.json').read_text('utf-8'))
    definitions = {
        'User': [('void CX2GUUser::HyperModeStart()', [b'm_iLastStateHyperModeCount =', b'GetLastStateHyperModeCount() - 1'])],
        'Raven': [('float CX2GURaven::GetHyperModeTime() const', [b'SA_EFFECTIVE_TIME', b'GetRemainHyperModeTime() > 0.0f']),
                  ('void CX2GURaven::HyperModeFrameMove()', [b'0.83f', b'ApplyHyperModeBuff()']),
                  ('void CX2GURaven::HyperModeBuffEffectStart()', [b'IsFullHyperMode()', b'EffectSet_RAVEN_HYPER_AURA'])],
        'BuffFactor': [('void CX2BuffFactor::SetGameUnitChangeHyperModeBehavior(', [b'GetHyperModeTime()', b'GetLastStateHyperModeCount()'])],
        'BuffBehavior': [('bool CX2BuffChangeHyperModeBehaviorTemplet::SetFactor(', [b'if ( 0 == m_uiHyperModeCount )', b'm_fRemainTime = m_fRemainTime +', b'SetFullHyperMode( true )'])],
    }
    sources, consumers = {}, []
    for key, methods in definitions.items():
        row = prior['sources'][key]; data = (reference / row['readOnlyInput']).read_bytes()
        if sha(data) != row['sha256']: raise ValueError('Pinned source changed: ' + key)
        sources[key] = {'readOnlyInput': row['readOnlyInput'], 'sha256': sha(data), 'bytes': len(data)}
        for name, tokens in methods:
            record, body = function(data, name)
            if any(token not in body for token in tokens): raise ValueError('Original consumer changed: ' + name)
            consumers.append({'source': key, **record})
    target = prior['originalTargetSources']['skills']; data = Path(target['path']).read_bytes()
    if sha(data) != target['sha256']: raise ValueError('Target2016 skill file changed')
    skill = next(row for row in json.loads((ROOT / 'packages/combat-core/rf-profile.json').read_text('utf-8'))['skillCatalog'] if row['skillId']==24405)
    if skill['maxLevel'] != 3 or skill['raw']['SA_EFFECTIVE_TIME'] != {'1':.7,'2':.7,'3':.7}:
        raise ValueError('Target passive declaration changed')
    contract = {'schemaVersion': 1, 'referenceCommit': prior['referenceCommit'], 'targetClientMeasured': False,
        'targetMeasuredTrajectories': 0, 'sources': sources, 'consumers': consumers, 'targetSkillSource': target,
        'behavior': {'skillId':24405,'maxLevel':3,'inputAvailableBeads':'save before decrement', 'reawakenCost':1,
            'applyAnimationTime':.83, 'fullModeUpgrade':'existing full OR input available beads == 3',
            'fullModeUpgradeEvidence':'user explicitly confirms target behavior; acquired old V5 differs',
            'existingAura':'keep; never duplicate/downgrade','newFullAura':'EffectSet_RAVEN_HYPER_AURA',
            'coreRefill':100,'coreRefillEvidence':'target2016 description adapter'},
        'duration': {'initialMultiplier':.7,'reawakenAddedSecondsCandidate':.7,
            'operation':'remaining += suppliedTime at original animation apply event',
            'classification':'unchanged old-V5 literal-field consumer candidate; target2016 seconds unresolved',
            'unknown':'Target2016 SA_EFFECTIVE_TIME .7 is described as a duration multiplier. No matched 2016 reawakening time consumer acquired; do not invent seconds or call .7s verified.'},
        'sourceDivergence': {'oldBuff':'only initializes activation count if m_uiHyperModeCount==0, so normal-to-full upgrade cannot be inferred from it',
            'userRequiredBehavior':'reawakening with three available beads upgrades to electric field while spending one',
            'classification':'explicit target-behavior adaptation, not an unchanged old-V5 execution'},
        'hudParticleContract':'contracts/rf-awakening-bead-fx-v14.json',
        'limits':['Matching target2016 full source/executable behavior unavailable', 'Current regression tests are simulation evidence only']}
    (ROOT / 'contracts/rf-awakening-source-v14.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return contract

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--reference-root',type=Path,required=True)
    args=p.parse_args(); result=build(args.reference_root)
    print(json.dumps({'sourceFiles':len(result['sources']),'functions':len(result['consumers']),
        'targetClientMeasured':result['targetClientMeasured'],'duration':'target2016 reawakening seconds unresolved'}))
