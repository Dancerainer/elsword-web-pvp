"""Extract target air-down landing resources and measured original DLL keys."""
from pathlib import Path
import argparse, json, re
from PIL import Image
from build_rf import Catalog, build_effect, digest, write_json, load_x, walk
from build_rf_fx import declaration
from export_samples import named_material_definitions, resolve_mesh_materials

ROOT = Path(__file__).resolve().parents[3]
NAMES = ('GroundShockWave', 'AirDownTick', 'DownSmoke')


def mesh_material_closure(catalog, filename):
    """Freeze the original material slots and their referenced texture bytes."""
    path=catalog.path(filename);tree=load_x(path)
    definitions=named_material_definitions(tree);bindings=[]
    for node,_ in walk(tree):
        if node.kind!='Mesh':
            continue
        matlist=node.child('MeshMaterialList')
        entries=matlist.children if matlist else []
        for slot,material in enumerate(resolve_mesh_materials(matlist,definitions)):
            if material is None:
                continue
            binding={'meshName':node.name,'slot':slot,'materialName':material.name,
                'resolution':'named-reference' if entries[slot].kind=='REF' else 'inline',
                'color':material.nums()[:4],'meshSource':catalog.evidence(path)}
            texture=material.child('TextureFilename','TextureFileName')
            if texture and texture.strings():
                binding['texture']=texture.strings()[0]
                binding['textureSource']=catalog.evidence(catalog.path(binding['texture']))
            bindings.append(binding)
    return bindings


def parse(text, name, keyword='eventsequence'):
    matches = list(re.finditer(keyword + r'\s+"' + re.escape(name) + r'"\s*\{([^{}]*)\}', text))
    if len(matches) != 1:
        raise ValueError('Unique target landing declaration required: ' + name)
    match = matches[0]
    record = declaration(match[1], casefold_tokens=True)
    record['fields'] = {dict(lifeType='LifeType', playCount='PlayCount', meshType='MeshType',
        meshName='MeshName', zEnable='ZEnable', usedieevent='UseDieEvent').get(k, k): v
        for k, v in record['fields'].items()}
    if record['unsupported']:
        raise ValueError('Unsupported original landing declaration: ' + name)
    if keyword == 'eventsequence' and record['fields'].get('particleType') != 'PT_3D_PLANE':
        raise ValueError('Unexpected original landing particle geometry')
    return record, match


def build(source_root=Path('asset_work'), output=ROOT/'artifacts/rf/landing-fx'):
    output, source_root = Path(output).resolve(), Path(source_root).resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source_root):
        raise ValueError('Landing outputs must remain in task artifacts')
    catalog = Catalog(source_root)
    templates = {}
    for name in (*NAMES, 'DropDown'):
        mesh = name == 'DropDown'
        source = catalog.path('GameMinorXMeshPlayer.txt' if mesh else 'GameMinorParticle.txt')
        text = source.read_bytes().decode('latin1')
        record, match = parse(text, name, 'TEMPLET' if mesh else 'eventsequence')
        record.update(name=name, kind='mesh' if mesh else 'particle', sourceFamily='game-minor',
            source={**catalog.evidence(source), 'byteOffset':match.start(), 'line':text.count('\n',0,match.start())+1},
            declarationSha256=digest(match[0].encode('latin1')), textures={},
            sourceTokenNormalization='reference-V5 unquoted tokens; original byte hash retained')
        for event in record['events']:
            if event['property'] != 'Texture':
                continue
            texture_name = event['value']
            original = catalog.path(texture_name)
            relative = 'textures/'+Path(texture_name).stem+'-'+digest(original.read_bytes())[:10]+'.png'
            target = output/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            image = Image.open(original).convert('RGBA')
            image.save(target)
            record['textures'][texture_name] = {'file':'landing-fx/'+relative,
                'width':image.width,'height':image.height,'source':catalog.evidence(original)}
        if mesh:
            record['meshMaterialClosure']=mesh_material_closure(catalog,record['fields']['MeshName'])
            converted = build_effect(catalog, output/'meshes', record['fields']['MeshName'])
            if converted['unsupportedPoseTracks'] or converted['missingExplicitTickRate'] or not converted['glb']:
                raise ValueError('Original DLL DropDown animation closure incomplete')
            initial = next(e['value'] for e in record['events'] if e['property']=='AniName' and e['start']==0)
            record.update(glb='landing-fx/meshes/'+Path(converted['glb']).name,
                poseData='landing-fx/meshes/'+Path(converted['poseData']).name,
                animationMissingTickRate=False, animationRequiresUnconfirmedRate=False,
                animationClips=converted['animations'], initialAnimation={'name':initial['animation'],'playback':initial['playback']})
        templates[name] = record
    result = {'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
        'templates':templates,'sourceFiles':list(catalog.used.values()),'meshFailures':[],'missingTemplates':[],
        'limits':['Source air-down trigger uses fixed-V5 consumer, separate from target2016 static resources.',
            'Original DLL keys/tick rate are resource measurements; full client/GPU behavior remains unmeasured.']}
    write_json(output/'index.json', result)
    write_json(ROOT/'contracts/rf-landing-fx-index-v1.json', result)
    print(json.dumps({'templates':list(templates), 'output':str(output)}))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/rf/landing-fx')
    args=parser.parse_args()
    build(args.source_root,args.output)
