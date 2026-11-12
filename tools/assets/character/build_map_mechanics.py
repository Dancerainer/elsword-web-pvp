"""Build original PvP ambient/teleport resources; never execute client scripts."""
from pathlib import Path
import argparse, copy, json, re
from PIL import Image
from build_rf import Catalog, build_effect, digest, write_json
from native_d3dx_keys import PVP_MAP_REQUEST, PVP_MAP_REQUEST_SHA
from build_rf_fx import declaration
from build_landing_fx import mesh_material_closure

ROOT = Path(__file__).resolve().parents[3]
PORTAL = ['RespawnLanding_P0'+str(i) for i in range(1,5)] + ['RespawnLanding01','RespawnLanding02']
ALIASES = dict(lifeType='LifeType',playCount='PlayCount',meshType='MeshType',
    meshName='MeshName',zEnable='ZEnable',usedieevent='UseDieEvent')

def family(value):
    return value.get('$symbol',value.get('symbol','')) if isinstance(value,dict) else value

def prepare_native_request():
    receipt=ROOT/PVP_MAP_REQUEST
    if digest(receipt.read_bytes())!=PVP_MAP_REQUEST_SHA:
        raise ValueError('Frozen map D3DX source receipt hash mismatch')
    request=json.loads(receipt.read_bytes())
    for row in request['sources']:
        source=Path(row['source'])
        if len(source.read_bytes())!=row['sourceBytes'] or digest(source.read_bytes())!=row['sourceSha256']:
            raise ValueError('Original map D3DX input hash mismatch: '+str(source))
        row.pop('actualLoaderHresult',None);row.pop('nativeAnimations',None)
    destination=ROOT/'artifacts/native-d3dx/pvp-map-sources-request.json'
    write_json(destination,request)
    print(str(destination))

def build(source_root=Path('asset_work'),output=ROOT/'artifacts/map-mechanics'):
    output=Path(output).resolve()
    if not output.is_relative_to(ROOT/'artifacts'):
        raise ValueError('Map mechanics outputs must stay in task artifacts')
    catalog=Catalog(source_root)
    maps,requests={},{}
    for entry in json.loads((ROOT/'artifacts/scene/catalog.json').read_bytes())['maps']:
        scene_id=entry['sceneId']
        source_dir=ROOT/'artifacts/scene'/scene_id
        declarations=json.loads((source_dir/'declarations.json').read_bytes())
        manifest=json.loads((source_dir/'manifest.json').read_bytes())
        objects={o['id']:o for o in manifest['objects']}
        rows=[]
        for call in declarations['scene']['calls']:
            if call['callee']!='CreateObjectParticle':
                continue
            system,name=call['arguments']
            source_family=family(system)
            if source_family not in ('g_pMinorParticle','g_pUIMajorParticle'):
                raise ValueError('Unsupported source particle family: '+source_family)
            key=source_family+':'+name
            requests[key]=(source_family,name)
            obj=objects['object-'+str(call['id'])]
            fields={d['callee']:d['arguments'] for d in obj['declarations']}
            position=fields.get('SetParticlePos',[None])[0]
            if not isinstance(position,list) or len(position)!=3:
                raise ValueError('Missing original particle position: '+key)
            rows.append(dict(objectId=obj['id'],template=key,position=position,setters=obj['declarations']))
        maps[scene_id]=dict(ambient=rows,declarationsSha256=digest((source_dir/'declarations.json').read_bytes()))
    for name in PORTAL:
        requests['g_pMinorParticle:'+name]=('g_pMinorParticle',name)
    templates,converted={},{}
    for source_family in sorted({f for f,n in requests.values()}):
        if source_family=='g_pMinorParticle':
            filenames=['GameMinorParticle.txt','GameMinorXMeshPlayer.txt']
        else:
            filenames=sorted(row[0]['name'] for key,row in catalog.rows.items()
                if key.startswith('uimajorparticle') or key.startswith('gameuimajorparticle'))
        for filename in filenames:
            path=catalog.path(filename);text=path.read_bytes().decode('latin1')
            for keyword,kind in [('eventsequence','particle'),('TEMPLET','mesh')]:
                for match in re.finditer(keyword+r'\s+"([^"\r\n]+)"\s*\{([^{}]*)\}',text,re.I):
                    key=source_family+':'+match[1]
                    if key not in requests:
                        continue
                    rec=declaration(match[2],casefold_tokens=True)
                    rec['fields']={ALIASES.get(k,k):v for k,v in rec['fields'].items()}
                    rec.update(name=key,sourceName=match[1],kind=kind,sourceFamily=source_family,
                        source={**catalog.evidence(path),'byteOffset':match.start(),'line':text.count('\n',0,match.start())+1},
                        declarationSha256=digest(match[0].encode('latin1')),textures={})
                    if key in templates:
                        raise ValueError('Ambiguous source particle: '+key)
                    templates[key]=rec
    if set(requests)!=set(templates):
        raise ValueError('Missing original map templates: '+str(set(requests)-set(templates)))
    for key,rec in templates.items():
        for event in rec['events']:
            if event['property']!='Texture':
                continue
            name=event['value'];source=catalog.path(name)
            relative='textures/'+Path(name).stem+'-'+digest(source.read_bytes())[:10]+'.png'
            destination=output/relative;destination.parent.mkdir(parents=True,exist_ok=True)
            image=Image.open(source).convert('RGBA');image.save(destination)
            rec['textures'][name]=dict(file=relative,width=image.width,height=image.height,source=catalog.evidence(source))
        mesh=rec['fields'].get('MeshName') or rec['fields'].get('Mesh')
        if mesh:
            rec['meshMaterialClosure']=mesh_material_closure(catalog,mesh)
            if mesh.casefold() not in converted:
                converted[mesh.casefold()]=build_effect(catalog,output/'meshes',mesh)
            data=converted[mesh.casefold()]
            if data['unsupportedPoseTracks'] or (data['animations'] and data['missingExplicitTickRate']):
                raise ValueError('Original map mesh pose/clock incomplete: '+mesh)
            rec.update(glb='meshes/'+Path(data['glb']).name if data['glb'] else None,
                poseData='meshes/'+Path(data['poseData']).name,
                animationClips=data['animations'],animationRequiresUnconfirmedRate=False,
                animationMissingTickRate=data['missingExplicitTickRate'])
    # Each map object creates a sequence then applies its own literal setters.
    # Clone by object so rate/type overrides never alter portal or other copies.
    for scene_id,m in maps.items():
        for obj in m['ambient']:
            name=scene_id+':'+obj['objectId'];rec=copy.deepcopy(templates[obj['template']])
            rec['name']=name;rec['sourceTemplate']=obj['template']
            fields={d['callee']:d['arguments'] for d in obj['setters']}
            # WorldObjectParticle creates the sequence with drawCount=1 before
            # applying object setters, independently of the template default.
            rec['fields']['DrawCount']=1
            for setter,field in [('SetTriggerCount','TriggerCount'),('SetTriggerTime','TriggerTime'),('SetDrawCount','DrawCount'),('SetLayer','Layer')]:
                if setter in fields:rec['fields'][field]=family(fields[setter][0])
            if 'SetEmitMinMax' in fields:rec['fields']['Emitrate']={'random':fields['SetEmitMinMax']}
            if 'SetParticleType' in fields:
                rec['fields']['particleType']=fields['SetParticleType'][0]['symbol'].split('.')[-1]
                if rec['fields']['particleType']=='PT_3D_PLANE':
                    rec.pop('glb',None);rec.pop('poseData',None)
            rec['objectOverrides']=obj['setters']
            if rec['fields'].get('particleType')=='PT_3D_PLANE' and not rec['textures']:
                rec['untexturedPlane']=True
            rec['unconsumedSourceFields']=[k for k in rec['fields'] if k.startswith('fadeso')]
            templates[name]=rec;obj['template']=name
    audio={}
    for name in ['Nasod_Element_Teleport.ogg','HighJump.ogg']:
        source=catalog.path(name);target=output/'audio'/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(source.read_bytes());audio[name]=dict(file='audio/'+name,source=catalog.evidence(source))
    result=dict(schemaVersion=1,version='authored-pvp-map-mechanics-v1',
        referenceVersion='Steam-NA-2016-V6.0420.5',clientMeasured=False,templates=templates,
        sourceFiles=list(catalog.used.values()),maps=maps,portalTemplates=['g_pMinorParticle:'+n for n in PORTAL],audio=audio,
        limits=['Consumer semantics are pinned V5, not matching target2016 C++.',
            'Malformed native DSL remains unsupported; no invented replacement.'])
    write_json(output/'index.json',result)
    write_json(ROOT/'contracts/pvp-map-fx-index-v1.json',result)
    print(json.dumps(dict(templates=len(templates),maps=len(maps),meshes=len(converted),
        unsupported={n:r['unsupported'] for n,r in templates.items() if r['unsupported']})))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--prepare-native-request',action='store_true',help='Write verified original-DLL probe inputs without building effects')
    args=parser.parse_args()
    if args.prepare_native_request:prepare_native_request()
    else:build(args.source_root)
