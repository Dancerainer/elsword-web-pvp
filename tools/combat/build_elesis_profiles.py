"""Compile original Elesis profiles through the shared declaration compiler."""
import argparse
import hashlib
import json
from pathlib import Path
from build_lk_profile import build, ROOT
from elesis_definitions import JOBS, bindings


def compile_job(job, cache, assets=None):
    unit = json.loads((cache/'elsword-declarations.json').read_text('utf8'))
    roots = ['EffectSet_VigorStart', 'EffectSet_VigorEnd', 'EffectSet_DestructionStart',
             'EffectSet_DestructionEnd', 'EffectSet_EL_ENDURANCE_POWER', 'EffectSet_EL_ENDURANCE_POWER_PUNISH',
             'ELESIS_ENDURANCE_ANGRY_WIND', 'ELESIS_ENDURANCE_ANGRY_WIND_PUNISH']
    roots += ['EffectSet_SA_EL_WILD_SHOCK_DAMAGE'+suffix for suffix in ('','_Sub','_MEMO','_Sub_MEMO')]
    if job == 'gm': roots += ['EffectSet_SGM_JuggernautBuster_'+kind+suffix
        for kind in ('BLACKHOLE','Finish') for suffix in ('','_WithVictoriousSword')]
    if job == 'gm': roots.append('EffectSet_SA_SSK_JUDGEMENT_DAMAGE')
    if job == 'ca': roots += ['EffectSet_SI_A_SCA_ASSAULT_STRIKE_Attack','DamageEffect_SA_SDK_BRANDISH_BREAKER_LOOP_DUMMY']
    if job == 'bh': roots.append('DamageEffect_SBH_Judgement_Fire')
    reference = ROOT/'contracts/elesis-skill-reference-v1.json'
    if reference.exists():
        for method in json.loads(reference.read_text('utf8'))['methods']:
            if any('_'+code+'_' in method['method'] for code in ('SSK','SGM','SPK','SBH','SDK','SCA') if code not in JOBS[job][4]) and 'SPIRAL_BLAST' not in method['method']: continue
            roots.extend(name for name in method['literalResources'] if name.startswith(('EffectSet_', 'Effectset_', 'DamageEffect_', 'DAMAGE_EFFECT_')) and not Path(name).suffix)
    configuration = bindings(job, unit['globals'], sorted(set(roots)),
        ['HyperBoostRight', 'HyperBoostLeft', 'DropDown', 'GroundShockWave', 'AirDownTick', 'DownSmoke'])
    result = build(cache, (assets or ROOT/'artifacts')/job, configuration)
    result['sources']['elesis'] = result['sources'].pop('elsword')
    result['sourceLiteralResources'] = sorted(set(configuration.RESOURCE_ROOTS + configuration.VISUAL_ROOTS))
    result['referenceSemantics']['commonConsumerEvidence'] = 'Shared fixedV5 GUUser movement/collision/awakening candidates; class physics exclusively original Elesis target2016'
    result['unsupported'] = [r for r in result['unsupported'] if r['id'] != 'consumer-version']
    result['unsupported'].append({'id': 'consumer-version', 'reason': 'Target2016 Elesis declarations and qualified fixedV5/reconstruction consumers; original target runtime trace unavailable'})
    target = ROOT/f'packages/combat-core/{job}-profile.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', 'utf8', newline='\n')
    print(json.dumps({'profession': job, 'states': len(result['states']), 'skills': len(result['skillCatalog']),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profession', choices=JOBS)
    parser.add_argument('--cache', type=Path, default=ROOT/'.cache/elesis-target')
    parser.add_argument('--assets', type=Path, help='Task-local converted asset index or correction layer')
    args = parser.parse_args()
    for job in [args.profession] if args.profession else JOBS:
        compile_job(job, args.cache, args.assets)
