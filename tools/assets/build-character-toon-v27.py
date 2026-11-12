"""Measure the three tiny original BMP ramps; never modify source assets."""
import argparse, hashlib, json, struct
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
def sha(data): return hashlib.sha256(data).hexdigest()
def read_ramp(file):
    data=file.read_bytes()
    if data[:2]!=b'BM': raise ValueError('Missing original BMP header')
    offset=struct.unpack_from('<I',data,10)[0]
    width,height=struct.unpack_from('<ii',data,18)
    planes,bpp=struct.unpack_from('<HH',data,26)
    compression=struct.unpack_from('<I',data,30)[0]
    if width<1 or abs(height)!=1 or planes!=1 or bpp!=24 or compression!=0:
        raise ValueError('Unsupported original ramp layout')
    stride=(width*3+3)//4*4
    if offset+stride>len(data): raise ValueError('Truncated original ramp')
    rgba=[]
    for i in range(width):
        b,g,r=data[offset+i*3:offset+i*3+3]; rgba.extend([r,g,b,255])
    return {'name':file.name,'archive':'data/data042.kom','sha256':sha(data),'bytes':len(data),
            'width':width,'height':1,'rgba':rgba}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--raw-root',type=Path,required=True)
    args=parser.parse_args();base=args.raw_root/'data/data042.kom'
    ramps={key:read_ramp(base/name) for key,name in
           [('normal','CartoonNormal.bmp'),('damage','CartoonDamage.bmp'),('invincible','CartoonInvincible.bmp')]}
    shader=(args.raw_root/'data/data041.kom/XRenderer.fx').read_bytes()
    if sha(shader)!='96b4bb61c56924a3427d6ab800631489471cd70538f30ad0919544ea2a244cc8':
        raise ValueError('Original 2016 shader differs from the existing source pin')
    refs={}
    for path in ['X2Lib/X2GUUser.cpp','KTDXLIB/KTDGXRenderer.cpp','X2Lib/X2World.cpp','X2Lib/X2DamageEffect.cpp']:
        data=(ROOT/'.cache/native-source-runtime'/path).read_bytes()
        refs[path]={'sha256':sha(data),'bytes':len(data),'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'}
    result={'schemaVersion':1,'evidenceClass':'original2016-shader-and-tiny-ramp-pixels + fixed-V5-consumer',
            'originalClientMeasured':False,'ramps':ramps,
            'shader':{'archive':'data/data041.kom','name':'XRenderer.fx','sha256':sha(shader),
                      'vertexDotLines':[366,510],'multiplyPassLines':[1285,1320],'addPassLines':[1322,1357]},
            'fixedReferences':refs,'consumer':{'hitSeconds':.2,'receivedHitLine':8938,'outgoingHitLine':12290,
              'damageShaderLines':[7112,7159],'invincibleShaderLines':[7160,7164],
              'normalTextureLine':1228,'damageTextureLine':1248,'invincibleTextureLine':1252},
            'hitConsumerScope':{'defender':'accepted DamageReact contact','attacker':'unit-to-unit AttackResult only',
              'effectOwnerCallback':{'file':'X2Lib/X2DamageEffect.cpp','line':4610},
              'baseEffectOwnerCallbackReturns':{'file':'X2Lib/X2GUUser.cpp','lines':[12969,12972]}},
            'scope':'Display-space texture modulation / addition with vertex-normal ramp coordinates; retain existing skinning, alpha, outlines and world transforms. No target2016 whole-frame GPU equivalence claim.'}
    (ROOT/'contracts/character-toon-source-v27.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:{k:v for k,v in row.items() if k!='rgba'} for key,row in ramps.items()}))
if __name__=='__main__': main()
