"""Read original assets and pinned consumers. Outputs belong to this worktree."""
import hashlib, json, struct, sys, math
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent))
import importlib.util
spec=importlib.util.spec_from_file_location('toon',Path(__file__).with_name('build-character-toon-v27.py'))
toon=importlib.util.module_from_spec(spec);spec.loader.exec_module(toon)
RAW=Path('asset_work/raw')
sha=lambda b:hashlib.sha256(b).hexdigest()
def read_motion_center(data):
    if len(data)<32 or data[:4]!=b'KSM ' or struct.unpack_from('<I',data,4)[0]!=0x200:
        raise ValueError('Unsupported original KSM center header')
    center=list(struct.unpack_from('<3f',data,12));radius=struct.unpack_from('<f',data,24)[0]
    if not all(math.isfinite(x) for x in center+[radius]) or radius<0:raise ValueError('Invalid original center/radius')
    count=struct.unpack_from('<I',data,28)[0]
    if count<1 or count>4096 or 32+84*count>len(data):raise ValueError('Invalid original frame extent')
    return {'center':center,'radius':radius}
def main():
    refs=json.loads((ROOT/'runtime/v28/fetched-source.json').read_text())
    for name in ['X2Lib/X2GUUser.cpp','X2Lib/X2GameUnit.cpp','X2Lib/X2DamageManager.cpp','KTDXLIB/KTDGCamera.cpp','KTDXLIB/KTDGXRenderer.cpp']:
        b=(ROOT/'.cache/native-source-runtime'/name).read_bytes()
        refs.append({'path':name,'sha256':sha(b),'bytes':len(b),'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'})
    shadow=RAW/'data/data045.kom/shadow.dds';b=shadow.read_bytes()
    if sha(b)!='166e4ebcdae00e48254b350a790b272aaae352a8f4364fd6c51cda9152f7e027':raise ValueError('Shadow source changed')
    image=Image.open(shadow).convert('RGBA')
    if image.size!=(128,128) or b[84:88]!=b'DXT5':raise ValueError('Unexpected shadow layout')
    out=ROOT/'artifacts/common-buffs/native-shadow.png';image.save(out)
    weapon={};centers={}
    for id in ['rf','lk','rs','is','bm','vc']:
        manifest=json.loads((ROOT/f'artifacts/{id}/manifest.json').read_text())
        attachments=[r for r in manifest['attachments'] if r['type']=='rigid' and r['parent']=='Dummy1_Rhand']
        if len(attachments)!=1:raise ValueError('Ambiguous weapon attachment '+id)
        row=attachments[0];weapon[id]={'node':row['node'],'parent':row['parent'],'source':row['source'],
          'sourceSha256':sha((RAW.parent/row['source']).read_bytes())}
        path=manifest['character']['sources'][0];motion=(RAW.parent/path).read_bytes()
        centers[id]={**read_motion_center(motion),'source':path,'sha256':sha(motion),
          'consumer':'GUUser1577 SetCenter(GetMotion()->GetCenter); KSMHeader center offset12; KTDGObject GetTransformCenter/IsInFrustum'}
    result={'schemaVersion':1,'originalClientMeasured':False,
      'evidenceClass':'target2016 shader/assets/declarations + independently pinned fixed-V5 consumers',
      'fixedReferences':refs,'ramps':{'fire':toon.read_ramp(RAW/'data/data042.kom/CartoonFire.BMP')},
      'weaponBindings':weapon,'unitCenters':centers,'costumeWeaponNode':'Costume_SwordMount',
      'shadow':{'originalPath':'data/data045.kom/shadow.dds','sha256':sha(b),'size':[128,128],
        'pngPath':'common-buffs/native-shadow.png','pngSha256':sha(out.read_bytes()),'rgbaSha256':sha(image.tobytes()),
        'sourceSize':200,'surfaceOffset':2,'sizeDistanceDivisor':300,'alphaBase':.8,'alphaDistanceDivisor':200,'layer':14},
      'camera':{'supportedTypes':[3,4,7,8],'defaultType':3,'interval':.05,'initialPositive':False,
        'unimplementedInReference':[0,1,2,5,6,9],'focusGate':'received unit or direct character attacker; effect-owner base callback returns'},
      'framebuffer':{'clearInterval':.2,'comparison':'strictly greater','countUnit':'rendered frames',
        'defaults':{'count':0,'color':[1,1,1,0]},'gate':'CLEAR_SCREEN_ON_HIT and not GetFlashEffect when VERTICAL_SYNC_OPTION is compiled',
        'motionBlur':'construction/begin/end are commented out in pinned reference; never infer accumulation'},
      'weaponAwakening':{'palette':'CartoonFire.BMP','mode':'RT_CARTOON_COLOR_EDGE','edgeRGBA':[1,85/255,17/255,1],
        'precedence':'after inherited damage/invincible params; later alpha REAL_COLOR and custom render effect override it'},
      'edge':{'worldExtrusion':'unnormalized palette normal * source width','color':'solid black except source colored-edge overrides',
        'cameraWidth':{'threshold':700,'aboveDivisor':1000,'belowDivisor':500},'armorUserOverrideMultiplier':2},
      'rim':{'shaderDefault':False,'coordinate':'1 - abs((normalized palette normal * view).z), y=.5',
        'status':'coordinate-consumer-implemented; automatic enable/texture/stage2-op not verified',
        'reason':'2016 shader does not assign ColorOp[2]; fixed-V5 predates rim; packed target executable has no available consumer',
        'rawDefaultOption':0,'rawDefaultOptionMeaning':'unverified; not interpreted as enabled/disabled'}}
    (ROOT/'contracts/common-presentation-source-v28.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'shadowPngBytes':out.stat().st_size,'weaponBindings':len(weapon),'sourceFiles':len(refs)}))
if __name__=='__main__':main()
