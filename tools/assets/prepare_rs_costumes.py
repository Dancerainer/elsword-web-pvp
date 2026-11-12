"""Snapshot read-only costume assets and audit their actual RS compatibility.

This records resource facts only. Runtime integration is verified separately
through the shared costume interface. All writes stay in this task's artifacts,
contracts and reports; neither the source checkout nor original client changes.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from extract_equipment_2016 import Kim208
from kl82_static import read_declarations

SETS=('officer','nasod','royal','solace')
SHA=lambda value:hashlib.sha256(value).hexdigest()


def json_glb(data):
    if len(data)<20 or data[:4]!=b'glTF' or struct.unpack_from('<I',data,4)[0]!=2 or struct.unpack_from('<I',data,8)[0]!=len(data):
        raise ValueError('Invalid complete glTF2 file')
    size,kind=struct.unpack_from('<II',data,12)
    if kind!=0x4e4f534a or size>len(data)-20:raise ValueError('Invalid glTF JSON chunk')
    return json.loads(data[20:20+size])


def local_matrix(node):
    if 'matrix' in node:return node['matrix']
    x,y,z,w=node.get('rotation',[0,0,0,1]);sx,sy,sz=node.get('scale',[1,1,1]);tx,ty,tz=node.get('translation',[0,0,0])
    return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,
            (2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,
            (2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1]


def original_item(kim,item_id):
    offset=kim.records[item_id]
    def string(field):
        pointer=kim.uint(offset+field)
        if not pointer:return ''
        size=struct.unpack('<H',kim.blob_bytes(pointer,2))[0]
        if not 0<size<=4096:raise ValueError('Invalid selected original costume string')
        value=kim.blob_bytes(pointer+2,size*2).decode('utf-16le')
        if '\0' in value or kim.blob_bytes(pointer+2+size*2,2)!=b'\0\0':raise ValueError('Invalid selected original costume terminator')
        return value
    return dict(itemId=item_id,recordOffset=offset,recordSha256=SHA(kim.data[offset:offset+208]),
        name=string(56),models=[string(100+4*i) for i in range(6)],unitType=kim.data[offset+194],slot=kim.data[offset+197])


def prepare(source_project,raw_root):
    source_project=source_project.resolve();raw_root=raw_root.resolve()
    if source_project==ROOT or ROOT.is_relative_to(source_project):raise ValueError('Separate read-only source checkout required')
    source=source_project/'artifacts/costumes'
    manifest_bytes=(source/'manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
    source_contract_bytes=(source_project/'contracts/costumes-2016-source-v1.json').read_bytes();source_contract=json.loads(source_contract_bytes)
    if manifest.get('id')!='costumes-2016-v1' or set(manifest.get('characters',{}).get('elsword',{}))!=set(SETS):
        raise ValueError('Expected complete source Elsword four-set manifest')
    snapshot={p.relative_to(source).as_posix():p.read_bytes() for p in (source/'elsword').rglob('*') if p.is_file()}
    snapshot['manifest.json']=manifest_bytes
    original_inputs={name:(raw_root/name).read_bytes() for name in ['UnitTemplet.lua','item.kim']}
    for row in source_contract['inputs']:
        name=Path(row['rawPath']).name
        if name in original_inputs and SHA(original_inputs[name])!=row['sha256']:raise ValueError('Original costume input digest mismatch')
    unit=read_declarations(raw_root/'UnitTemplet.lua',capture_calls=True,capture_unresolved=True)
    matches=[call for call in unit['nativeCalls'] if call['target']=='g_pUnitManager.AddUnitTemplet'
        and call['args'][1].get('unitClass',{}).get('$symbol')=='UNIT_CLASS.UC_ELSWORD_RUNE_SLAYER']
    if len(matches)!=1:raise ValueError('Unique original RS UnitTemplet required')
    call=matches[0];raw=call['args'][1];kim=Kim208(original_inputs['item.kim'])
    face=original_item(kim,raw['basicFaceItemID'])
    if face['itemId']!=45 or face['models'][0].lower()!='mesh_elsword_ers_basic_face_sorted.x':raise ValueError('Original RS face mismatch')
    rs_path=ROOT/'artifacts/rs/rs-runtime.glb';rs_bytes=rs_path.read_bytes();rs=json_glb(rs_bytes)
    rs_nodes={node.get('name'):node for node in rs['nodes']};rs_names=set(rs_nodes)
    rs_meshes=[dict(node=node['name'],mesh=rs['meshes'][node['mesh']].get('name'),skin=node.get('skin')) for node in rs['nodes'] if 'mesh' in node]
    face_meshes=[row for row in rs_meshes if row['mesh'].split('/')[-1]=='Elsword_Face']
    if len(face_meshes)!=1:raise ValueError('Exactly one runtime RS face mesh required')
    sets={}
    for key in SETS:
        row=manifest['characters']['elsword'][key];prefix='elsword/'+key+'/'
        body=json_glb(snapshot[prefix+row['glb']]);nodes={n.get('name'):n for n in body['nodes']}
        skin_joints={body['nodes'][index]['name'] for skin in body.get('skins',[]) for index in skin['joints']}
        frame_names={frame['name'] for frame in row['poseFrames']}
        if frame_names-rs_names or skin_joints-rs_names:raise ValueError('Source costume requires bones absent from RS')
        transform_differences=[];max_error=0
        for name in sorted(frame_names):
            costume_matrix,rs_matrix=local_matrix(nodes[name]),local_matrix(rs_nodes[name])
            error=max(abs(a-b) for a,b in zip(costume_matrix,rs_matrix));max_error=max(max_error,error)
            if error>1e-5:transform_differences.append(dict(name=name,maxAbsoluteError=error,costume=costume_matrix,rs=rs_matrix))
        mesh_names=[body['meshes'][n['mesh']].get('name') for n in body['nodes'] if 'mesh' in n]
        if any(name.split('/')[-1]=='Elsword_Face' for name in mesh_names):raise ValueError('Shared costume must not replace the RS face')
        accessories=[]
        for accessory in row['accessories']:
            item=source_contract['items'][str(accessory['itemId'])]
            models=[]
            for model in accessory['models']:
                if model['bone'] not in rs_names:raise ValueError('Original accessory mount absent from RS')
                modes={}
                for mode in ('normal','awakened'):
                    if mode in model:
                        value=model[mode]
                        for relative in (value['glb'],value['poseData']):
                            if prefix+relative not in snapshot:raise ValueError('Incomplete source accessory mode')
                        modes[mode]=dict(glb=prefix+value['glb'],poseData=prefix+value['poseData'],animations=value['animations'])
                if bool('awakened' in modes)!=item['canHyperMode']:raise ValueError('Source Hyper_ flag/mode mismatch')
                models.append(dict(bone=model['bone'],bonePresentInRs=True,**modes))
            accessories.append(dict(itemId=accessory['itemId'],name=item['name'],canHyperMode=item['canHyperMode'],models=models))
        sets[key]=dict(name=row['name'],sourceItems=source_contract['sets'][key]['elsword'],
            bodyGlb=prefix+row['glb'],meshCount=len(mesh_names),meshNames=mesh_names,
            poseFrameCount=len(frame_names),skinJointCount=len(skin_joints),missingRsBones=[],
            bindTransformComparison=dict(method='compose local glTF TRS or original matrix; tolerance1e-5',maxAbsoluteError=max_error),
            bindTransformDifferences=transform_differences,accessories=accessories)
    # The other task is active. Reject a moving source instead of publishing a
    # mixture of two resource versions; no writes ever target that checkout.
    for relative,data in snapshot.items():
        if (source/relative).read_bytes()!=data:raise ValueError('Source costume changed during snapshot: '+relative)
    if (source_project/'contracts/costumes-2016-source-v1.json').read_bytes()!=source_contract_bytes:raise ValueError('Source contract changed during snapshot')
    output=ROOT/'artifacts/costumes'
    for relative,data in snapshot.items():
        target=(output/relative).resolve()
        if not target.is_relative_to(output.resolve()):raise ValueError('Costume output escaped task directory')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    files=[dict(file=relative,bytes=len(data),sha256=SHA(data)) for relative,data in sorted(snapshot.items())]
    contract=dict(schemaVersion=1,id='rs-costumes-source-v1',clientMeasured=False,professionId='RS',unitClass=101,unitType=1,
        sharedCharacter='elsword',sourceTask=dict(checkout=str(source_project),state='active-uncommitted-resource-snapshot; no runtime completion claimed',
            contract='contracts/costumes-2016-source-v1.json',contractSha256=SHA(source_contract_bytes),manifestSha256=SHA(manifest_bytes)),
        originalInputs={name:dict(path='data/data036.kom/'+name,sha256=SHA(data)) for name,data in original_inputs.items()},
        unitTemplate=dict(prototype=call['prototype'],instruction=call['instruction'],raw=raw),
        face=face,presentationBaseline=dict(file='rs/rs-runtime.glb',sha256=SHA(rs_bytes),meshCount=len(rs_meshes),meshes=rs_meshes,
            keepFaceNodes=[row['node'] for row in face_meshes],replaceBodyAndWeaponNodes=[row['node'] for row in rs_meshes if row not in face_meshes],
            restoration='Show all original RS meshes when the profession costume is selected; no collision or stat changes.'),
        sets=sets,files=files,resourceTotals=dict(sharedFiles=len(files)-1,sharedBytes=sum(row['bytes'] for row in files if row['file']!='manifest.json'),manifestFiles=1),
        runtimeStatus=dict(mapped=True,copied=True,evidenceClass='resource-compatibility-not-runtime-approval',
            verificationTest='tests/integration/rs-costumes-v1.test.mjs',report='reports/rs-costumes-v1.md',
            note='This contract pins original item identities and resource compatibility; runtime adapter validation is recorded separately.'))
    path=ROOT/'contracts/rs-costumes-source-v1.json';path.write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n','utf-8',newline='\n')
    return contract


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-project',type=Path,required=True)
    parser.add_argument('--raw-root',type=Path,default=Path('asset_work/raw/data/data036.kom'))
    args=parser.parse_args();result=prepare(args.source_project,args.raw_root)
    print(json.dumps(dict(sets=list(result['sets']),resources=result['resourceTotals'],keepFace=result['presentationBaseline']['keepFaceNodes'],
        bindTransformDifferences={key:len(row['bindTransformDifferences']) for key,row in result['sets'].items()})))
