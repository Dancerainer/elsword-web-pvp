"""Read original inputs again; never execute client UI or derive source from web results."""
from pathlib import Path
import argparse,hashlib,json,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
sys.path.insert(0,str(ROOT/'tools/native'))
from kl82_static import read_declarations
from run_camera_source import extract,source,COMMIT
from ui import read_tet,crop_piece
sha=lambda data:hashlib.sha256(data).hexdigest()

def audit():
    layout=json.loads((ROOT/'contracts/rf-ui-source-layout.json').read_bytes())
    raw=Path(layout['source']);assert sha(raw.read_bytes())==layout['sha256']
    calls=read_declarations(raw,capture_calls=True,capture_unresolved=True)['nativeCalls']
    vectors={f'call@{i}.return0':v['args'] for i,v in enumerate(calls) if v['target']=='D3DXVECTOR2'}
    textures={v['args'][0]['$symbol']:v['args'][2] for v in calls if v['target'].endswith('.SetTex')}
    points=[]
    for call in calls:
        if call['target'].endswith('.SetPoint') and textures.get(call['args'][0]['$symbol'])=='MP_100_BAR':
            points.append({'localPoint':vectors[call['args'][1]['LEFT_TOP']['$symbol']],
                'instruction':call['instruction'],'piece':'MP_100_BAR'})
    assert [p['localPoint'] for p in points]==[[176,53],[250,53]]
    records=json.loads((ROOT/'contracts/rf-native-runtime-sources.json').read_bytes())['files']
    record=next(r for r in records if r['relativePath']=='X2Lib/X2GageUI.cpp')
    cpp=source([ROOT/'.cache/native-reference'],record)
    fragments=[]
    for signature in [b'void CX2MyGageUI::UpdateMpGuidePoint()',b'void CX2MyGageUI::UpdateDetonationGage(']:
        body,first,last=extract(cpp,signature)
        fragments.append({'name':signature.decode(),'lineStart':first,'lineEnd':last,'sha256':sha(body),'bytes':len(body)})
    ui=json.loads((ROOT/'artifacts/ui/manifest.json').read_bytes());piece=ui['pieces']['MP_100_BAR'];atlas=ui['atlases'][piece['atlas']]
    asset=Path('asset_work')
    original={}
    for kind,key in [('atlas','imageSource'),('tet','tetSource')]:
        row=atlas[key];data=(asset/row['raw_path']).read_bytes();assert sha(data)==row['sha256'];original[kind]=data
    import io
    with Image.open(io.BytesIO(original['atlas'])) as image:
        crop,bounds=crop_piece(image.convert('RGBA'),read_tet(original['tet'])['MP_100_BAR'])
    with Image.open(ROOT/'artifacts/ui/mp_100_bar.png') as delivered:
        assert delivered.size==(2,12) and delivered.convert('RGBA').tobytes()==crop.tobytes()
    enum=asset/'raw/data/data036.kom/Enum.lua';raven=asset/'raw/data/data036.kom/RAVEN_FIGHTER.lua'
    mana=json.loads((ROOT/'contracts/rf-mana-break-source-v12.json').read_bytes())
    assert sha(raven.read_bytes())==mana['targetComponent']['ravenSource']['sha256']
    charge=read_declarations(raven,read_declarations(enum)['globals'])['globals']['INIT_COMPONENT']['MP_CHARGE_RATE']
    assert charge==130
    return {'schemaVersion':1,'targetClientMeasured':False,'browserGpuMeasured':False,
        'evidenceClass':'target2016 raw UI/TET/atlas/KL plus fixed-V5 source; display interpolation is host adapter',
        'targetLayout':{'path':str(raw),'sha256':sha(raw.read_bytes()),'markers':points},
        'targetMarker':{k:piece[k] for k in ['file','width','height','atlas','sha256','rgbaSha256']},
        'reference':{'commit':COMMIT,'source':record,'fragments':fragments},
        'charge':{'rateMpPerSecond':charge,'minimum':100,'maximum':300,'sourceContract':'rf-mana-break-source-v12.json',
            'sourceOrder':'Gauge consumes last CommonEvent latch, adds rate*float elapsed, existing Increase/currentMP clamp; stop-at-packet-start skips charge'},
        'display':{'width':224,'previousHudIntervalMs':80,'redraw':'every render packet',
            'policy':'interpolate only increasing completed charge samples; decreasing/reset/paused/manual state is exact; aria reports authoritative charge',
            'combatChanged':False,'unverified':'original2016 frame clock, GPU appearance and charge trajectory remain unmeasured'}}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--write-contract',action='store_true');args=parser.parse_args()
    result=audit();path=ROOT/'contracts/rf-mana-hud-source-v17.json'
    if args.write_contract:path.write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    else:assert json.loads(path.read_bytes())==result,'Frozen original source metadata changed'
    print(json.dumps({'verified':True,'targetRate':130,'originalMarkerPoints':[[176,53],[250,53]],'originalClientMeasured':False}))
