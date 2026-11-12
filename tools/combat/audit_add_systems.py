"""Freeze small Add system declarations and fixed-source provenance, read-only.

Uses the existing KL82 parser; never executes target Lua or the game. Full
private declarations and C++ snapshots remain under the task's ignored cache.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--target-cache', type=Path, required=True)
    ap.add_argument('--reference-cache', type=Path, required=True)
    args = ap.parse_args()
    read = lambda name: json.loads((args.target_cache / (name+'-declarations.json')).read_text('utf-8'))
    add, skills, factors = read('add'), read('skill'), read('buff-factor')
    ids = {29000,29001,29002,29005,29009,29012,29013,29015,29016,29017,29018,29019,29021,
           29027,29028,29031,29032,29033,29035,29213,29400,29401,29405,29406,29407,29410,29411,29413}
    kept = {}
    for call in skills['nativeCalls']:
        row = call['args'][-1]
        if row.get('m_eID') not in ids:
            continue
        kept[row['m_eID']] = {k:v for k,v in row.items() if k.startswith('SA_') or k in
            ['m_eID','m_eType','m_wstrName','m_wstrIconTexturePieceName','m_usFPConsumtion',
             'm_usCBConsumption','m_MPConsumption','m_SkillCoolTime','m_DeleteSkillIDByUpgrade','m_EffectiveDesc']}
    buff = {r['BUFF_FACTOR_ID']:r['BUFF_FACTOR'] for c in factors['nativeCalls']
            if isinstance((r:=c['args'][-1]),dict) and r.get('BUFF_FACTOR_ID') in [315,366,367,474,501,683]}
    component = {k:v for k,v in add['globals']['INIT_COMPONENT'].items() if 'DP' in k or 'FORMATION' in k}
    reference = json.loads((args.reference_cache/'source-files.json').read_text('utf-8'))
    wanted = {
        'X2GUAdd.cpp':['FormationModeStart','GetPossibleChangeFormationMode','GetDPRateByType','UpNowDPValue',
            'UpNowDPValueByDamage','UpNowDPValueByHit','UpNowDPValueByUseMP','GetActualDPConsume',
            'SetIsFormationMode','ANSI_SA_COMMON_CREST_OF_TIME_FrameMove','RecordCrestSnapshot','RestoreCrestSnapshot',
            'ANSI_SA_ALP_PSYCHIC_STORM_StateStart'],
        'X2GUUser.cpp':['ProcessSkillAtDie','RecordCrestSnapshot','RestoreCrestSnapshot'],
    }
    consumers = []
    for name, names in wanted.items():
        data = (args.reference_cache/name).read_bytes()
        for method in names:
            match = re.search(rb'^[^\r\n]*CX2\w+::'+method.encode()+rb'\([^;\r\n]*\)\s*(?:const)?\s*\{',data,re.M)
            if not match:
                raise ValueError('Missing reference method '+method)
            start = match.start()
            # This fixed tree uses column-zero closing braces for these
            # top-level definitions; //{{ reconstruction comments are not C++
            # scopes. Refuse missing terminators rather than scanning forever.
            closing = re.search(rb'^}', data[match.end():], re.M)
            if not closing:
                raise ValueError('Missing reference terminator '+method)
            end = match.end()+closing.end()
            excerpt=data[start:end]
            consumers.append(dict(file=name,method=method,startLine=data[:start].count(b'\n')+1,
                endLine=data[:end].count(b'\n')+1,sha256=hashlib.sha256(excerpt).hexdigest(),
                reconstructionMarker=b'2026-' in excerpt,evidenceClass='fixed-V5-reference-with-2026-reconstruction'))
    payload = dict(schemaVersion=1,version='add-systems-target2016-candidate-v1',targetClientMeasured=False,
        targetSources={name:read(name)['source'] for name in ['add','skill','buff-factor','battle-buff','enum']},
        reference=reference,consumerRanges=consumers,components=component,skills=kept,buffFactors=buff,
        constants=dict(dpMax=8000,mutationMax=6,dpDisplayScale=20,formationSentinel=99999),
        constantEvidence={'dpMaxMutationMax':'fixed X2Define.h lines 88,90; matching target native consumer unavailable',
            'dpDisplayScale':'fixed X2GUAdd GetActualDPConsume and FormationModeStart',
            'formationSentinel':'fixed X2GUAdd FormationModeStart'},
        targetDescriptionAdapters={
            'formedNaturalMp':'LP29401/MM29406/DE29411 target effective descriptions give .5/.75/1 per second; old factor346 tier3 .258 conflicts and is not used.',
            '29213':'PvP HP cap 50%; exclude wedding/hyper/seal cooldown; time sickness 120s. No position rewind.',
            'DEOverlimit':'Awakened SA declares MP recovery equal to 20% listed MP. Kept separate from old source passive.',
            'mutation':'Only complete numeric damage payloads are consumed by shared cast hook; other payloads belong to skill executors.'},
        customPolicy={'equipmentDpGainBonus':.5,'equipmentDpConsumptionReduction':.5,'source':'project rule; not original default'},
        unsupported=['2016 native consumers and original-client traces unavailable',
            'unknown DPRT_SPECIAL symbol and anomalous old DT_MIX branch do not receive guessed DP',
            'full factory autonomous projectiles/target ownership remains skill-executor work',
            'unknown mutation effect payloads never consume points with no effect',
            'map death, void fall and external room penalty are not inferred as ring-revivable'])
    out = ROOT/'contracts/add-systems-source-v1.json'
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(output=str(out),skills=len(kept),buffFactors=len(buff),consumers=len(consumers))))


if __name__ == '__main__':
    main()
