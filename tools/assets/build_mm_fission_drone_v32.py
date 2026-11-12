"""Close original Fission Drone Activator declarations with existing source mesh geometry.

The target damage rows and mesh declarations are read without executing Lua.
No source input or upstream cache is changed. Existing mesh/pose geometry is
reused only when its original MeshName matches the new declaration exactly.
"""
from pathlib import Path
import copy, hashlib, json, re, sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/assets/character')]
from build_rf import Catalog, digest
from build_rf_fx import declaration

NAMES = ['DamageEffect_ADD_Dividing_Missile_Dynamo_DA',
         'DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA',
         'DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA']
TEMPLATES = ['ADD_Dividing_Missile_MESH_01_DA', 'ADD_Dividing_Missile_MESH_02_DA']

def read(path): return json.loads(path.read_text('utf8'))
def write(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf8')

def main():
    cache = ROOT / '.cache/client-skills-ui-v32'
    original = read(cache / 'add-target/damage-declarations.json')
    source = original['source']
    if digest(Path(source['path']).read_bytes()) != source['sha256']:
        raise ValueError('Original DamageEffect.lua hash changed')
    profile_file = ROOT / 'packages/combat-core/mm-profile.json'
    fx_file = ROOT / 'artifacts/mm/fx/index.json'
    profile, fx = read(profile_file), read(fx_file)
    catalog = Catalog(Path('asset_work'))
    path = catalog.path('GameMajorXMeshPlayer.txt')
    text = path.read_bytes().decode('latin1')
    records, reuse = [], []
    for name in TEMPLATES:
        match = re.search(r'TEMPLET\s+"' + re.escape(name) + r'"\s*\{([^{}]*)\}', text)
        if match is None: raise ValueError('Missing original mesh declaration ' + name)
        row = declaration(match[1])
        row.update(name=name, kind='mesh', source={**catalog.evidence(path), 'byteOffset':match.start(),
             'line':text.count('\n', 0, match.start()) + 1}, declarationSha256=digest(match[0].encode('latin1')))
        base_name = name.removesuffix('_DA')
        base = profile['effectTemplates'][base_name]
        if row['fields']['MeshName'] != base['fields']['MeshName'] or not base.get('poseData'):
            raise ValueError('Unverified mesh geometry reuse ' + name)
        for key in ('textures', 'glb', 'poseData', 'animationMissingTickRate', 'animationClips',
                    'animationRequiresUnconfirmedRate'):
            if key in base: row[key] = copy.deepcopy(base[key])
        initial = {e['property']:e['value'] for e in row['events'] if e['start'] == 0 and not e['fade']}
        animation = initial.get('AniName')
        row.update(initialSize=initial.get('Size'), initialVelocity=initial.get('Velocity'),
             initialDirSpeed=initial.get('DirSpeed'), initialAnimation={'name':animation['animation'], 'playback':animation['playback']} if animation else None,
             missingExplicitTickRate=base.get('missingExplicitTickRate', False))
        profile['effectTemplates'][name] = row
        fx['templates'][name] = copy.deepcopy(row)
        records.append(row)
        reuse.append({'name':name, 'baseTemplate':base_name, 'meshName':row['fields']['MeshName'],
             'glb':row['glb'], 'poseData':row['poseData'],
             'glbSha256':digest((ROOT / 'artifacts/mm' / row['glb']).read_bytes()),
             'poseSha256':digest((ROOT / 'artifacts/mm' / row['poseData']).read_bytes())})
    damage = []
    for name in NAMES:
        raw = original['globals'][name]
        profile['damageEffects'][name] = {'raw':raw, 'sourcePc':original['locations'][name]}
        damage.append({'name':name, 'raw':raw, 'sourcePc':original['locations'][name],
             'rawSha256':digest(json.dumps(raw, ensure_ascii=False, sort_keys=True).encode('utf8'))})
    for skill in profile['skillCatalog']:
        if skill['skillId'] == 29209:
            skill['limitations'] = [{'key':'fission-lock',
                'message':'Original four/eight split payloads and accepted Drone Activator targeting execute; scoped DIE lock inheritance follows the original declaration through a qualified Web adapter, without a target2016 client trace',
                'evidenceClass':'target2016 declarations and qualified reference; scoped Web DIE inheritance adapter'}]
    profile['sourceLiteralResources'] = sorted(set(profile['sourceLiteralResources']) | set(NAMES))
    write(profile_file, profile)
    fx['profileSha256'] = digest(profile_file.read_bytes())
    write(fx_file, fx)
    contract = {'schemaVersion':1, 'originalClientMeasured':False,
        'evidenceClass':'target2016 literal declarations with a bounded qualified Add consumer adapter',
        'source':source, 'rows':records, 'damage':damage, 'geometryReuse':reuse,
        'qualifiedConsumer':{'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
             'path':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GUAdd.cpp',
             'sha256':'b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a',
             'lines':[17138,17166], 'laterReconstruction':True,
             'behavior':'At .4 choose base/mutation + _DA from valid Drone Activator mark; retarget with x1.2'},
        'inheritanceBoundary':'Target2016 DIE declarations explicitly request INHERITLOCKONDATA=1. The pinned reconstructed reference copies LockOnData on CREATE at2243..2253 and parses this DIE flag at6914, but lacks a DIE copy branch. The scoped child UID/epoch inheritance is a Web adapter of the target declaration, not a recovered2016 consumer or client trace.',
        'profileSha256':fx['profileSha256'], 'fxIndexSha256':digest(fx_file.read_bytes())}
    write(ROOT / 'contracts/mm-fission-drone-v32.json', contract)
    print(json.dumps({'damage':len(damage), 'templates':len(records), 'profileSha256':fx['profileSha256']}))

if __name__ == '__main__':main()
