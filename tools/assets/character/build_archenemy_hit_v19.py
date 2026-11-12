"""Export the bounded original ArcEnemy impact/audio closure, without client execution.

Target KL/particle/audio bytes are independently verified before publication.
Fixed V5 HYPER/trigger consumers remain separately labelled reference candidates.
"""
from pathlib import Path
import argparse, json, re, sys
from PIL import Image
from build_rf import Catalog, digest, write_json
from build_rf_fx import read_definitions

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'tools/combat'))
sys.path.insert(0, str(ROOT/'tools/assets'))
from kl82_static import read_declarations
from audio import inspect_ogg

OWNERS = ('RAVEN_OVER_TAKER_ARC_ENEMY', 'RAVEN_OVER_TAKER_ARC_ENEMY_HYPER',
          'RAVEN_OVER_TAKER_ARC_ENEMY_MEMO', 'RAVEN_OVER_TAKER_ARC_ENEMY_MEMO_HYPER')
SOUND = 'Raven_OT_SP2_FlyingImpact3.ogg'
CPP_SHA = 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'
KL_SHA = '21747879161f19722278568dc2392c8778f88be491123a15f5f550cd63ac7397'

def build(source_root=Path('asset_work')):
    source_root = Path(source_root).resolve()
    catalog = Catalog(source_root)
    enum = read_declarations(catalog.path('Enum.lua'))['globals']
    damage_path = catalog.path('DamageEffect.lua')
    if digest(damage_path.read_bytes()) != KL_SHA:
        raise ValueError('Target2016 DamageEffect changed')
    target = read_declarations(damage_path, enum, True, True)['globals']
    profile = json.loads((ROOT/'packages/combat-core/rf-profile.json').read_bytes())
    bindings = {}
    for name in OWNERS:
        original = target[name]
        if original != profile['damageEffects'][name]['raw']:
            raise ValueError('Runtime ArcEnemy definition differs from independently decoded target: '+name)
        bindings[name] = original
    names = sorted({v['PARTICLE_NAME'] for raw in bindings.values() for k,v in raw.items()
                    if re.fullmatch(r'HIT_PARTICLE\d+', k)})
    definitions = read_definitions(catalog)
    templates = {}
    served_index = ROOT/'artifacts/rf/fx/index.json'
    served = json.loads(served_index.read_bytes())
    existing_closure = {served_index}
    for name in names:
        template = definitions[name]
        if template['unsupported'] or template['kind'] != 'particle' or template['fields']['particleType'] != 'PT_3D_PLANE':
            raise ValueError('Unsupported original Archenemy impact declaration: '+name)
        template['textures'] = {}
        for event in template['events']:
            if event['property'] != 'Texture': continue
            source_name = event['value']; path = catalog.path(source_name)
            filename = 'fx/textures/'+Path(source_name).stem+'-'+digest(path.read_bytes())[:10]+'.png'
            image = Image.open(path).convert('RGBA')
            converted_path = ROOT/'artifacts/rf'/filename
            converted = Image.open(converted_path).convert('RGBA')
            if image.size != converted.size or image.tobytes() != converted.tobytes():
                raise ValueError('Existing original impact texture differs: '+filename)
            existing_closure.add(converted_path)
            template['textures'][source_name] = {'file':filename,
                'width':image.width,'height':image.height,'source':catalog.evidence(path)}
        if template != served['templates'][name]:
            raise ValueError('Existing visual declaration differs from independent source: '+name)
        templates[name] = template
    index = {'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
        'templates':templates,'sourceFiles':list(catalog.used.values()),'missingTemplates':[],'meshFailures':[],
        'limits':['Target2016 resource declarations are frozen data; fixed V5 trigger/registered Hyper mode remain candidates.',
                  'Normal hits own only three FireDamageImpact records; larger missile explosion belongs to HYPER/MEMO declarations.',
                  'No target client/GPU/audio-mixer comparison was performed.']}
    write_json(ROOT/'contracts/rf-archenemy-hit-fx-index-v19.json', index)
    raven = (ROOT/'.cache/native-source-runtime/X2Lib/X2GURaven.cpp').read_bytes()
    if digest(raven) != CPP_SHA or b'PlaySound( L"Raven_OT_SP2_FlyingImpact3.ogg" );' not in raven:
        raise ValueError('Pinned ArcEnemy release sound consumer changed')
    source = catalog.path(SOUND); raw = source.read_bytes(); metadata = inspect_ogg(raw)
    audio_output = ROOT/'artifacts/audio'; manifest = json.loads((audio_output/'manifest.json').read_bytes())
    (audio_output/SOUND).write_bytes(raw)
    record = {'file':SOUND,'sha256':digest(raw),'bytes':len(raw),'source':catalog.evidence(source),
              'mimeType':'audio/ogg','format':metadata}
    manifest['files'][SOUND] = record; write_json(audio_output/'manifest.json', manifest)
    inventory = []
    for path in [*sorted(existing_closure), audio_output/SOUND, audio_output/'manifest.json']:
        if path.is_file(): inventory.append({'path':path.relative_to(ROOT).as_posix(),
            'sha256':digest(path.read_bytes()),'bytes':path.stat().st_size})
    contract = {'schemaVersion':1,'targetClientMeasured':False,'targetDamageSource':catalog.evidence(damage_path),
        'bindings':bindings,'releaseSound':record,'releaseSoundConsumer':{'path':'X2Lib/X2GURaven.cpp',
            'sha256':CPP_SHA,'lines':[474,552],'classification':'fixed-V5-reference-not-target2016'},
        'integration':{'servedIndex':'/assets/rf/fx/index.json','inventory':inventory,
            'addedFiles':['artifacts/audio/'+SOUND],
            'updatedFiles':['artifacts/audio/manifest.json'],
            'existingImpactClosureVerified':True},
        'limits':index['limits']}
    write_json(ROOT/'contracts/rf-archenemy-hit-assets-v19.json', contract)
    print(json.dumps({'templates':names,'newAudio':SOUND,'files':len(inventory)}))
    return contract

if __name__=='__main__':
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument('--source-root',type=Path,default=Path('asset_work'))
    options=args.parse_args();build(options.source_root)
