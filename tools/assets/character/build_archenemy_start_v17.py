"""Build the four measured target Archenemy Start meshes; inputs stay read-only."""
from pathlib import Path
import argparse, copy, json, re
from build_rf import Catalog, build_effect, digest, write_json
from build_rf_fx import declaration

ROOT = Path(__file__).resolve().parents[3]
NAMES = [f'Raven_Overtaker_Sp2a_FlyingImpact_Start_0{i}' for i in range(1, 5)]
SCRIPT_SHA = 'b3927c83e113e3b931f29ca5058063a63440a85d2c211bf335cb1fd4054757d5'

def build(source_root=Path('asset_work'), output=ROOT/'artifacts/rf/archenemy-fx-v17'):
    output, source_root = Path(output).resolve(), Path(source_root).resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source_root):
        raise ValueError('Output must stay in this task artifacts')
    catalog = Catalog(source_root)
    script = catalog.path('GameMajorXMeshPlayer.txt')
    raw = script.read_bytes()
    if digest(raw) != SCRIPT_SHA:
        raise ValueError('Target mesh declarations changed')
    text = raw.decode('latin1')
    templates = {}
    for name in NAMES:
        matches = list(re.finditer(r'TEMPLET\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}', text))
        if len(matches) != 1:
            raise ValueError('Unique target Start declaration required')
        match = matches[0]
        # Preserve Anim/global clock domains. The generic particle DSL has no
        # Anim consumer; this exact original mesh event is executed by core.
        body = match[1]
        event = re.search(r'Anim at 0\.050\s+SlashTrace\s*=\s*true', body)
        if not event:
            raise ValueError('Original Anim SlashTrace event changed')
        parsed = declaration(body[:event.start()]+body[event.end():])
        if parsed['unsupported']:
            raise ValueError('Unsupported Start mesh declaration')
        parsed['events'].append({'property':'SlashTrace','start':.05,'end':.05,
            'fade':False,'value':True,'clock':'animation'})
        for value in parsed['events']:
            value.setdefault('clock','global')
        fields = parsed['fields']
        if fields.get('LifeType') != 'LT_PLAY_COUNT' or fields.get('PlayCount') != 1:
            raise ValueError('Original Start lifetime changed')
        asset = build_effect(catalog, output/'meshes', fields['MeshName'])
        if asset['unsupportedPoseTracks'] or asset['missingExplicitTickRate'] or not asset['glb']:
            raise ValueError('Incomplete original-DLL Start animation conversion')
        def initial(prop):
            return next(v['value'] for v in parsed['events'] if v['property']==prop and v['start']==0)
        record = copy.deepcopy(parsed)
        record.update(name=name,kind='mesh',source={**catalog.evidence(script),
            'byteOffset':match.start(),'line':text.count('\n',0,match.start())+1},
            declarationSha256=digest(match[0].encode('latin1')),textures={},
            glb='archenemy-fx-v17/meshes/'+Path(asset['glb']).name,
            poseData='archenemy-fx-v17/meshes/'+Path(asset['poseData']).name,
            animationMissingTickRate=False,animationRequiresUnconfirmedRate=False,
            animationClips=asset['animations'],missingExplicitTickRate=False,
            initialAnimation={'name':initial('AniName')['animation'],'playback':initial('AniName')['playback']},
            initialSize=initial('Size'),initialAniSpeed=initial('AniSpeed'),
            initialVelocity=None,initialDirSpeed=None)
        templates[name] = record
    result = {'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
        'templates':templates,'sourceFiles':list(catalog.used.values()),'meshFailures':[],'missingTemplates':[],
        'limits':['Original DLL keys are measured resource data; fixed V5 callback/controller scheduling remains a host candidate.',
            'No target client combat or GPU comparison was executed.']}
    write_json(output/'index.json',result)
    write_json(ROOT/'contracts/rf-archenemy-start-fx-index-v17.json',result)
    print(json.dumps({'templates':list(templates),'output':str(output)}))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/rf/archenemy-fx-v17')
    args=parser.parse_args()
    build(args.source_root,args.output)
