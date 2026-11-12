"""Extract target2016 sword-mode skill-slot pixels, with qualified V5 visibility."""
import argparse, hashlib, json
from pathlib import Path
from PIL import Image
from build_lk_sword_ui import inspect_picture_groups, Catalog, digest, write_json, read_flicker_sources
from ui import read_tet, crop_piece
from kl82_static import parse

ROOT=Path(__file__).resolve().parents[2]
GROUPS=['Static_EL_SKILL_B','Static_EL_SKILL_B_B','Static_EL_SKILL_R','Static_EL_SKILL_R_B']

def build(source,native,output,project=ROOT,evidence_root=None):
    source,native,output,project=map(lambda p:Path(p).resolve(),(source,native,output,project))
    if output.is_relative_to(source) or output.is_relative_to(native):
        raise ValueError('Output overlaps read-only source')
    frozen_flicker=read_flicker_sources(evidence_root)
    catalog=Catalog(source);layout=catalog.path('DLG_GAME_SKILL_SLOT_NEW.lua').read_bytes()
    all_groups=inspect_picture_groups(layout);groups={k:all_groups[k] for k in GROUPS}
    # Record the exact helper prototype, but do not execute its control flow
    # or infer absolute screen coordinates from a different client version.
    helper=parse(layout)['prototypes'][0]
    helper_digest=digest(json.dumps(helper,sort_keys=True,separators=(',',':')).encode())
    for name,rows in groups.items():
        if len(rows)!=4:raise ValueError('Expected four original skill-slot pictures')
        for i,row in enumerate(rows):
            # The source spells SKII (two I), not SKILL. Four slots per row
            # share the same captured GetSlotPosition helper and offsets.
            expected_piece='SKII_B_EFFECT' if name.startswith('Static_EL_SKILL_B') else 'SKII_R_EFFECT'
            if row['piece']!=expected_piece or row['atlas']!='DLG_UI_Common_Texture20.TGA' or row['color']!=[1,1,1,.7]:
                raise ValueError('Original sword skill-slot declaration changed')
            if row['sizeDelta']!=[-4,-4] or row.get('slotPoint',{}).get('args')!=[name.endswith('_B_B') or name.endswith('_R_B'),i+1,-6,-5]:
                raise ValueError('Unsupported original skill-slot relative position')
    output.mkdir(parents=True,exist_ok=True)
    pieces=read_tet(catalog.path('DLG_UI_Common_Texture20.tet').read_bytes())
    slots=read_tet(catalog.path('DLG_UI_Common_Texture64_NEW.tet').read_bytes())
    with Image.open(catalog.path('DLG_UI_Common_Texture64_NEW.tga')) as atlas:
        slot,_=crop_piece(atlas.convert('RGBA'),slots['SKILL_SLOT'])
        slot_size=[slot.width-4,slot.height-4]
    resources={}
    with Image.open(catalog.path('DLG_UI_Common_Texture20.tga')) as atlas:
        pixels=atlas.convert('RGBA')
        for side,piece in [('blue','SKII_B_EFFECT'),('red','SKII_R_EFFECT')]:
            image,bounds=crop_piece(pixels,pieces[piece]);file='skill-sword-'+side+'.png'
            image.save(output/file)
            resources[side]={'file':file,'piece':piece,'bounds':bounds,'sourceSize':[image.width,image.height],
                'displaySize':[image.width-4,image.height-4],'slotSize':slot_size,'offset':[-6,-5],
                'color':[1,1,1,.7],'sourceRgbaSha256':digest(image.tobytes()),'sha256':digest((output/file).read_bytes())}
    cpp=(native/'X2Lib/X2Game.cpp').read_bytes()
    if digest(cpp)!='7f7660945348ea32516f61339af0262517ed940471b5104919010cdce21f6ff4':
        raise ValueError('Pinned fixed V5 skill-slot consumer differs')
    fragment=b'\n'.join(cpp.split(b'\n')[10348:10475])+b'\n'
    flicker_sources=[]
    for name,blob,first,last in [('KTDGUIControl.cpp','73d6efcbbce8331b783a0a8c3a7dca43b237f139',1266,1291),
                               ('KTDGUIControl.h','8429e92202a03508eaa26d7d71ccd18f98a7f761',450,464)]:
        data,verified_blob=frozen_flicker[name]
        if verified_blob!=blob:raise ValueError('Pinned UI flicker source differs')
        fragment_data=b'\n'.join(data.split(b'\n')[first-1:last])+b'\n'
        flicker_sources.append({'path':'KTDXLIB/'+name,'gitBlob':blob,'sha256':digest(data),
            'startLine':first,'endLine':last,'fragmentSha256':digest(fragment_data)})
    result={'schemaVersion':1,'evidenceClass':'target2016-static-pixels-and-layout plus qualified-fixedV5-visibility',
        'targetClientMeasured':False,'resources':resources,'groups':groups,'sources':list(catalog.used.values()),
        'consumer':{'path':'X2Lib/X2Game.cpp','method':'UpdateElswordSkillSlotEffect','startLine':10349,'endLine':10475,
            'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','fileSha256':digest(cpp),'fragmentSha256':digest(fragment),
            'skillTypeField':'m_iWOSType','targetSkillTypeField':'m_usWOSType','vigor':{'state':2,'skillType':2},'destruction':{'state':-2,'skillType':1},
            'flicker':[.4,1,.1],'alphaConsumer':'FrameMove overwrites color.a, not multiplied by declared .7'},
        'flickerSources':flicker_sources,
        'layoutHelper':{'prototypeId':0,'params':helper['params'],'sha256':helper_digest,
            'evidenceClass':'captured relative helper arguments; absolute placement unexecuted'},
        'boundaries':['Web grid retains original relative offsets and scales by the displayed slot size',
            'GetSlotPosition absolute screen coordinates are not executed or defaulted',
            'No target2016 runtime or GPU comparison']}
    write_json(output/'index.json',result);write_json(project/'contracts/lk-skill-sword-ui-source-v3.json',result)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=Path('asset_work'))
    p.add_argument('--native-source',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'artifacts/ui/skill-sword')
    p.add_argument('--evidence-root',type=Path,help='Read-only directory containing the two pinned KTDGUIControl source files')
    a=p.parse_args();r=build(a.source,a.native_source,a.output,evidence_root=a.evidence_root);print(json.dumps({'pictures':sum(map(len,r['groups'].values())), 'slotSize':r['resources']['blue']['slotSize']}))
