"""Freeze original Harpoon declarations separately from simulation results.

The decoded Lua cache is checked against original input hashes.  Mesh/particle
records retain original source-file and declaration hashes.  Fixed V5 source
is a version reference, never an original 2016 execution trace.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'.cache/native-source-runtime'
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_text('utf8'))
FRAGMENTS = {
    'X2Lib/X2GURaven.cpp': [(23, 29, 'Giga source maximum loop count is eight'),
        (18757, 18906, 'Harpoon state, input choice, gravity and overheat consumers'),
        (19227, 19306, 'Giga two flame EffectSets per loop and finite loop exit'),
        (19314, 19467, 'Giga normal/overheat finishing branches create two stones and two flame effects'),
        (20751, 20813, 'Ignition Crow normal/overheat directly creates damage from compiled callbacks'),
        (22783, 22844, 'Napalm callback directly creates three grenade damage effects absent from state DSL')],
    'X2Lib/X2DamageEffect.h': [(30, 40, 'DEPT_DIE_POS is position type four')],
    'X2Lib/X2DamageEffect.cpp': [
        (1024, 1034, 'Only SetLandHeightOnStart initializes the saved land vector from owner'),
        (1253, 1269, 'Saved land vector starts at literal zero; birth land scalar is distinct'),
        (1282, 1291, 'FollowLine direction is copied from the owner at construction'),
        (1427, 1434, 'Initial saved main mesh rotation and position'),
        (1579, 1584, 'FollowLine also runs at construction before the first movement packet'),
        (1854, 1914, 'Capture live mesh transform, then FollowLine, then passive particle updates'),
        (2038, 2074, 'Timed child lifetime bound and one global-time event per packet'),
        (2236, 2268, 'AUTO_DIE registers the new child for stage cleanup; it does not kill parent'),
        (2290, 2309, 'Successful CREATE_DAMAGE increments count and removes declaration at source cap'),
        (7110, 7114, 'CREATE_DAMAGE loop interval, count and end-time loader defaults'),
        (2494, 2531, 'Save current mesh position and full CrashLand query vector on live frames'),
        (5902, 5939, 'Die type four reads saved land vector, rejects negative Y and inherits main axis'),
        (6394, 6540, 'FollowLine native radius, yaw, move axis, height gates and missing-line stop'),
        (5390, 5443, 'Passive particle APPLY_ROTATE and TRACE both default true'),
        (6163, 6254, 'Bone particle uses main mesh transform and original bone position; only this branch consumes offset'),
        (6275, 6354, 'Unit-bone always updates AxisAngle but gates AddRotate; unit-bone, impact and main-position ignore offset')],
    'KTDXLIB/KTDGXMeshPlayer.h': [(857, 875, 'SetLandHeightOnStart defaults false')],
    'KTDXLIB/KTDGXMeshPlayer.cpp': [(1584, 1823, 'Native movement axes and gravity/DirSpeed order'),
        (2039, 2055, 'GetDirVec transforms +X by global plus local yaw/pitch/roll for rotated particle offsets'),
        (2062, 2153, 'Old lifetime/CrashLand branch; original global clock'),
        (3219, 3250, 'Literal Size fades update mesh scale during the active collision window'),
        (3573, 3624, 'LOCAL_ROTATE_EFFECT applies Rotate events to the local mesh rotation')],
    'KTDXLIB/KTDXCollision.h': [(99, 131, 'Sphere radius uses world X scale unless original radius-Y flag is enabled')],
    'KTDXLIB/KTDGParticleSystem.cpp': [(3090, 3097, 'Template Trace updates existing particle axis after current movement'),
        (5188, 5202, 'New particle copies current sequence movement axis before time-zero events'),
        (5242, 5243, 'New particle copies sequence AddRotate into its global visual rotation'),
        (4710, 4835, 'PT_MESH uses Size and global/local rotation, not Stretch')],
    'KTDXLIB/KTDGParticleSystem.h': [(344, 391, 'Velocity uses mutable movement axis; DirSpeed uses global plus local visual rotation')],
    'X2Lib/X2Game.h': [(1219, 1270, 'AUTO_DIE deferred stage cleanup list')],
}


def build():
    documents = {key: read(ROOT/f'.cache/vc/{key}-declarations.json') for key in ('raven', 'effect', 'damage')}
    for document in documents.values():
        if sha(Path(document['source']['path']).read_bytes()) != document['source']['sha256']:
            raise ValueError('Original Lua source identity changed')
    profile = read(ROOT/'packages/combat-core/vc-profile.json')
    fx = read(ROOT/'artifacts/vc/fx/index.json')
    effect_calls = {call['args'][-1]['NAME']: call for call in documents['effect']['nativeCalls']
                    if call['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(call['args'][-1], dict) and 'NAME' in call['args'][-1]}
    state_names = ['RSI_SA_RWT_HARPOON_SPEAR', 'RSI_SA_RWT_HARPOON_SPEAR_FIRE', 'RSI_SA_RWT_HARPOON_SPEAR_FIRE_OVERHEAT']
    states = {name: {'raw': documents['raven']['globals'][name], 'sourcePc': documents['raven']['locations'][name],
                    'clip': profile['states'][name]['clip']} for name in state_names}
    sets = {}; damages = {}; template_names = set()

    def damage(name):
        if name in damages:
            return
        raw = documents['damage']['globals'][name]
        if profile['damageEffects'][name]['raw'] != raw:
            raise ValueError('Profile changed original damage declaration: '+name)
        damages[name] = {'raw': raw, 'sourcePc': documents['damage']['locations'][name]}
        template_names.add(raw['MAIN_EFFECT_NAME'])
        for key, entry in raw.items():
            if not isinstance(entry, dict):
                continue
            if entry.get('DAMAGE_EFFECT_NAME'):
                damage(entry['DAMAGE_EFFECT_NAME'])
            if entry.get('PARTICLE_NAME'):
                template_names.add(entry['PARTICLE_NAME'])

    for state in states.values():
        for row in state['raw']['EFFECT_SET_LIST_FINAL_ULTIMATE'].values():
            name = row['EFFECT_NAME']
            call = effect_calls[name]; raw = call['args'][-1]
            sets[name] = {'raw': raw, 'sourcePc': {key: call[key] for key in ('prototype', 'instruction')}}
            for key, entry in raw.items():
                if not key.startswith('EFFECT') or not isinstance(entry, dict):
                    continue
                if entry.get('EFFECT_TYPE') == 1:
                    damage(entry['NAME'])
                elif entry.get('NAME'):
                    template_names.add(entry['NAME'])
    templates = {}
    source_files = {}
    for name in sorted(template_names):
        t = fx['templates'].get(name)
        if t is None:
            continue
        templates[name] = {key: t[key] for key in ('name', 'kind', 'fields', 'events', 'source', 'declarationSha256', 'glb', 'poseData', 'animationClips') if key in t}
        source_files[t['source']['rawPath']] = t['source']
    for source in source_files.values():
        path = Path('asset_work')/source['rawPath']
        if sha(path.read_bytes()) != source['sha256']:
            raise ValueError('Original FX source identity changed: '+str(path))
    consumers = []
    for relative, fragments in FRAGMENTS.items():
        data = (SOURCE/relative).read_bytes(); lines = data.splitlines(keepends=True)
        consumers.append({'path': relative, 'bytes': len(data), 'sha256': sha(data), 'fragments': [
            {'start': start, 'end': end, 'purpose': purpose, 'sha256': sha(b''.join(lines[start-1:end]))}
            for start, end, purpose in fragments]})
    mesh_names = {t['fields'].get('MeshName', '').casefold() for t in templates.values()}
    native = read(ROOT/'reports/vc-fx-d3dx-sources-v1.json')
    return {'schemaVersion': 1, 'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'evidenceClass': 'target2016 declarations and original D3DX periods; fixed V5 consumer reference',
        'targetClientMeasured': False, 'luaSources': {k: v['source'] for k, v in documents.items()},
        'sourceFiles': consumers, 'states': states, 'effectSets': sets, 'damageEffects': damages,
        'templates': templates, 'missingTemplates': sorted(template_names-set(templates)),
        'compiledCallbackResourceRoots': sorted(name for name in profile['sourceLiteralResources']
            if name in profile['damageEffects'] or name in profile['effectSets'] or name in fx['templates']),
        'compiledBurstLimits': {
            'evidenceClass': 'fixed-V5 callback bound; independently read source, not observed simulation peak',
            'giga': {'maxLoopCount': 8, 'flameTimesPerLoop': [0.01, 0.24],
                     'flameEffectSet': 'EffectSet_Raven_Giga_Prominence_Flame',
                     'finishStoneCount': 2, 'finishFlameCountPerBranch': 2, 'overheatSmokeCount': 1},
            'scope': 'equipped source burst only; resource union prepares materials without reserving unequipped repeated bursts'},
        'collateralParticleBinding': {
            'damage': 'DamageEffect_SA_Raven_PowerAssault', 'entry': 'PASSIVE_PARTICLE6',
            'raw': documents['damage']['globals']['DamageEffect_SA_Raven_PowerAssault']['PASSIVE_PARTICLE6'],
            'sourcePc': documents['damage']['locations']['DamageEffect_SA_Raven_PowerAssault'],
            'mainTemplate': 'EffectDummy_0_4',
            'mainTemplateFields': fx['templates']['EffectDummy_0_4']['fields'],
            'mainTemplateEvents': fx['templates']['EffectDummy_0_4']['events'],
            'mainTemplateDeclarationSha256': fx['templates']['EffectDummy_0_4']['declarationSha256']},
        'nativeMeshMeasurements': [row for row in native['sources'] if Path(row['source']).name.casefold() in mesh_names],
        'requiredConsumers': {
            'rootDeath': 'All four DIE_DAMAGE_EFFECT children use DEPT_DIE_POS=4; saved live land XYZ, not dead mesh position nor just landY',
            'landInitialValue': 'Harpoon root does not set SetLandHeightOnStart: saved vector starts [0,0,0]; live CrashLand refresh stores full radius90 native query',
            'followLine': 'CanDown radius30; copy line yaw into mesh and movement axis; FOLLOW_LINE_NEW snaps only within150; MUST_ON_LINE stops at gap>200 or no line',
            'timedChildren': 'Original EventTimerGlobal, source loop interval/count/lifetime bound; AUTO_DIE is child stage-cleanup ownership',
            'burstPool': 'CREATE_DAMAGE multiplicity is bounded by source loop count, strict loop end and live main-mesh lifetime. Harpoon one-second carrier yields eight 0.13-second children per branch. Equipped Giga sums sixteen source flame sets with two finishing directions; normal/overheat are alternatives',
            'presentation': 'Normal0.4333333373 shell animation; original RGBA jump at0.05; original shell velocity [1500,-2600,0]; all source scale/rotation curves retained',
            'passive': 'PASSIVE updates SetParticleData every frame even with TRACE0; TIME trace is conditional; PT_MESH source rendering ignores Stretch',
            'sequenceAxes': 'SetParticleData refreshes sequence AxisAngle/AddRotate. New particles copy both; existing template Trace particles update only movement axis after current packet movement. Old visual AddRotate and DirSpeed orientation stay at birth',
            'particleBindings': 'DEPT_UNIT_BONE always sets owner rotation plus entry rotation as movement axis, even when APPLY_ROTATE=0; AddRotate remains gated. Offset is consumed only by DEPT_BONE, not unit-bone, impact or main-position. APPLY_ROTATED_OFFSET uses main mesh GetDirVec projected horizontally, not owner facing or particle entry rotation',
            'attackMeshTransforms': 'ASSAULT literal Size fade and Z20 rotation, and Stone Size [.3,.6,.45] and Y90 rotation, apply to both original helper positions/radii and rendered mesh. Expectations are independently calculated from raw events and original helper poses'},
        'limits': ['No original 2016 GPU/trajectory capture', 'Fixed V5 has maintenance changes and is not the target executable',
                   'Missing Lightning01 original template remains separately proven by vc-missing-fx-search-v3.json']}


if __name__ == '__main__':
    result = build(); target = ROOT/'contracts/vc-harpoon-source-v4.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'path': str(target), 'damageEffects': len(result['damageEffects']),
                      'templates': len(result['templates']), 'missingTemplates': result['missingTemplates']}))
