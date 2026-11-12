"""Freeze original target2016 Gatling declarations, not simulation output."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda p: json.loads(p.read_text('utf8'))
sha = lambda b: hashlib.sha256(b).hexdigest()
STATE = 'RSI_SA_RWT_HELLFIRE_GATLING'
SET_NAMES = ['EffectSet_SA_RWT_HellFire'+suffix for suffix in ('', '_Loop', '_Loop_OverHit', '_End', '_End_OverHit')]


def build():
    docs = {k: read(ROOT/f'.cache/vc/{k}-declarations.json') for k in ('raven', 'effect', 'damage', 'skill')}
    for doc in docs.values():
        if sha(Path(doc['source']['path']).read_bytes()) != doc['source']['sha256']:
            raise ValueError('Original Lua input changed')
    fx = read(ROOT/'artifacts/vc/fx/index.json')
    calls = {c['args'][-1]['NAME']: c for c in docs['effect']['nativeCalls']
             if c['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(c['args'][-1], dict) and c['args'][-1].get('NAME')}
    sets = {n: {'raw': calls[n]['args'][-1], 'sourcePc': {k: calls[n][k] for k in ('prototype', 'instruction')}} for n in SET_NAMES}
    states = {n: {'raw': docs['raven']['globals'][n], 'sourcePc': docs['raven']['locations'][n]}
              for n in [STATE+suffix for suffix in ('', '_LOOP', '_END', '_OVER_END')]}
    damages = {}; templates = set()
    def follow(name):
        if name in damages:
            return
        raw = docs['damage']['globals'][name]
        damages[name] = {'raw': raw, 'sourcePc': docs['damage']['locations'][name]}
        templates.add(raw['MAIN_EFFECT_NAME'])
        for row in raw.values():
            if isinstance(row, dict):
                if row.get('PARTICLE_NAME'):
                    templates.add(row['PARTICLE_NAME'])
                if row.get('DAMAGE_EFFECT_NAME'):
                    follow(row['DAMAGE_EFFECT_NAME'])
    for record in sets.values():
        for key, row in record['raw'].items():
            if key.startswith('EFFECT') and isinstance(row, dict):
                if row.get('EFFECT_TYPE') == 1:
                    follow(row['NAME'])
                elif row.get('NAME'):
                    templates.add(row['NAME'])
    records = {name: {k:fx['templates'][name][k] for k in ('name', 'kind', 'fields', 'events', 'source', 'declarationSha256')}
               for name in sorted(templates) if name in fx['templates']}
    for t in records.values():
        source = t['source']
        if sha((Path('asset_work')/source['rawPath']).read_bytes()) != source['sha256']:
            raise ValueError('Original particle/mesh input changed')
    fragments = {
        'X2Lib/X2GURaven.cpp': [(12, 27), (18908, 19115)],
        'X2Lib/X2DamageEffect.cpp': [(2350, 2430), (3830, 3880), (6163, 6370)],
        'X2Lib/X2DamageManager.h': [(1294, 1308)],
    }
    consumers = []
    for relative, spans in fragments.items():
        data = (ROOT/'.cache/native-source-runtime'/relative).read_bytes(); lines = data.splitlines(keepends=True)
        consumers.append({'path': relative, 'sha256': sha(data), 'fragments': [
            {'start': a, 'end': b, 'sha256': sha(b''.join(lines[a-1:b]))} for a,b in spans]})
    skill = next(c['args'][-1] for c in docs['skill']['nativeCalls'] if c['target'].endswith('AddSkillTemplet_LUA') and c['args'][-1].get('m_eID') == 24020)
    return {'schemaVersion': 1, 'evidenceClass': 'original target2016 declarations; fixed V5 callback is a distinct version reference',
        'clientMeasured': False, 'luaSources': {k:v['source'] for k,v in docs.items()}, 'skill': skill,
        'states': states, 'effectSets': sets, 'damageEffects': damages, 'templates': records,
        'missingTemplates': sorted(templates-set(records)), 'fixedV5Sources': consumers,
        'targetFacts': {'loopStartAnimationTime': .01, 'loopBone': 'Bip01', 'loopOffsets': [350,35,0],
            'normalMagic': 1.86, 'overheatMagic': 2.5854, 'pvpRate': .7,
            'childExplosionTimes': [.01,.03,.06,.09,.12,.15,.18,.21],
            'childExplosionOffsets': [[-100,10,0],[-20,90,-50],[-20,-90,50],[50,-100,50],[50,100,-50],[110,-90,75],[110,90,-75],[170,10,0]],
            'muzzleParticle': {'name':'RWT_HellFireEP02','positionType':1,'bone':'Dummy2_Lhand','rotateY':10,'scale':[.4,.5,.5]},
            'impactPointParticlesInTargetLoop': 0},
        'adapterChoices': {'normalLoops':17,'overheatLoops':27,'overheatPresses':5,
            'loopSetSchedule':'one target set on loop state entry, preserving original child START_TIME .01',
            'overheatSelfDamage':'one target Explosion_OverHit data penalty at .01 per extra loop; generic V5 HP-cost formula',
            'evidence':'17/27/5 remain old V5 constants; set selection and penalty scheduling are target-data adapter decisions, not matching target2016 callback proof'},
        'removedFromActualSkill':['EffectSet_Raven_Hellfire_Gatling','RAVEN_HELLFIRE_GATLING_BULLET','RAVEN_HELLFIRE_GATLING_BULLET_OVERHEAT'],
        'limits':['No original target2016 execution/GPU trajectory available',
                  'Target Explosion_End_Bomb is present in Lua but has no established selected consumer; not auto-added or emitted',
                  'Old impactPoint default zero and first-frame DamageCheck evidence applies to the old impact consumer; it is not the target2016 skill design']}


if __name__ == '__main__':
    out = build(); path = ROOT/'contracts/vc-gatling-source-v4.json'
    path.write_bytes((json.dumps(out, ensure_ascii=False, indent=2)+'\n').encode('utf8'))
    print(json.dumps({'effectSets':len(out['effectSets']), 'damageEffects':len(out['damageEffects']),
                      'templates':len(out['templates']), 'missingTemplates':out['missingTemplates']}))
