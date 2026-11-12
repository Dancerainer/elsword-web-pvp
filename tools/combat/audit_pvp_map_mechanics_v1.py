"""Hash pinned V5 map consumers and original2016 declarations, without running the client."""
from pathlib import Path
import argparse, json, subprocess, sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from run_camera_source import COMMIT, PREFIX, extract, sha, git_blob

METHODS=[
    ('KTDXLIB/KTDGLineMap.cpp',b'bool CKTDGLineMap::AddCameraData_LUA(', 'camera defaults and relative/absolute mode'),
    ('KTDXLIB/KTDGLineMap.cpp',b'bool CKTDGLineMap::AddLine_LUA(', 'line type, conveyor speed and trigger links'),
    ('KTDXLIB/KTDGLineMap.cpp',b'/*static*/ void CKTDGLineMap::MakeLine( LineData*', 'normalize full authored direction'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::PhysicProcess()', 'ground/air speed, conveyor and local animation offsets'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::PhysicProcess_Jumping(', 'launch direction, relative/absolute speed and key lock'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::PhysicProcess_Bungee(', '2-second wait, AIR_DOWN, nonfatal penalty and destination'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::PhysicProcess_Portal(', '.7-second dwell, .3-second lock and re-entry gate'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::InitPosByLineData(', 'destination midpoint and V5 overwritten above-floor placement'),
    ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::CreateTeleportEffect(', 'original entry/exit audio, eight particle sequences and two meshes'),
    ('X2Lib/X2GUUser.cpp',b'HRESULT CX2GUUser::OnCameraMove()', 'remembered line CAMERA_INDEX consumed with dynamic camera off'),
    ('X2Lib/X2Camera.cpp',b'void CX2Camera::NomalTrackingCamera( CX2GameUnit*', 'line-relative eye before land-height clamp'),
    ('X2Lib/X2Camera.cpp',b'void CX2Camera::GameLineCamera(', 'absolute eye, optional unit focus, .4-second tracking request'),
    ('X2Lib/X2Camera.h',b'struct LineScriptedCameraData', 'component-wise relative eye approach by speed * seconds'),
    ('X2Lib/X2WorldObjectParticle.cpp',b'CX2WorldObjectParticle::CX2WorldObjectParticle( CKTDGParticleSystem*', 'native world sequence constructor overrides draw count to1'),
    ('X2Lib/X2WorldObjectParticle.h',b'void SetParticleType(', 'object particle-type override forwarded to sequence'),
    ('X2Lib/X2WorldObjectMesh.cpp',b'HRESULT CX2WorldObjectMesh::OnFrameMove(', 'UV offsets increment by authored speed * elapsed seconds'),
]
FILES=sorted({r[0] for r in METHODS}|{'KTDXLIB/KTDGLineMap.h','KTDXLIB/KTDGParticleSystem.cpp','X2Lib/X2WorldObjectMesh.h'})

def audit(repository,cache):
    raw,files={},[]
    for name in FILES:
        data=subprocess.run(['git','-C',str(repository),'show',COMMIT+':'+PREFIX+name],check=True,capture_output=True).stdout
        destination=cache/name
        if destination.exists() and destination.read_bytes()!=data:
            raise ValueError('Source cache differs from pinned commit: '+name)
        destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(data)
        raw[name]=data;files.append(dict(path=PREFIX+name,bytes=len(data),sha256=sha(data),gitBlob=git_blob(data)))
    spans=[]
    for name,signature,purpose in METHODS:
        body,first,last=extract(raw[name],signature)
        spans.append(dict(path=PREFIX+name,signature=signature.decode('ascii'),lines=[first,last],
            bytes=len(body),sha256=sha(body),purpose=purpose))
    maps=[]
    for entry in json.loads((ROOT/'artifacts/scene/catalog.json').read_bytes())['maps']:
        scene=entry['sceneId'];directory=ROOT/'artifacts/scene'/scene
        collision=json.loads((directory/'collision.json').read_bytes())
        manifest=json.loads((directory/'manifest.json').read_bytes())
        maps.append(dict(sceneId=scene,declarationsSha256=sha((directory/'declarations.json').read_bytes()),
            collisionSha256=sha((directory/'collision.json').read_bytes()),
            specialLines=[dict(lineId=l['lineId'],type=l['type'],nativeFields=l.get('nativeFields',{}))
                for l in collision['lines'] if l['type'] not in ('LINE_TYPE.LT_NORMAL','LINE_TYPE.LT_WALL')
                or l.get('nativeFields',{}).get('SPEED') or l.get('nativeFields',{}).get('CAMERA_INDEX',-1)>=0],
            uvObjects=[dict(objectId=o['id'],speed=s['arguments']) for o in manifest['objects']
                for s in o['declarations'] if s['callee']=='SetTex0UVSpeed']))
    return dict(schemaVersion=1,version='authored-pvp-map-mechanics-v1',referenceCommit=COMMIT,
        evidenceClass='original2016-map-and-fx-data-with-pinned-V5-consumers',targetClientMeasured=False,
        fullClientExecuted=False,files=files,consumerSpans=spans,maps=maps,
        behavior=dict(direction='native normalized XYZ; airborne removes Y without horizontal renormalization',
            motionOffset='line direction * local X plus GetZVector * local Z; facing applied once; Y ignored',
            shadowStepRange='actual XZ path displacement rather than world X',
            portal=dict(waitSeconds=.7,strictlyGreater=True,keyLockSeconds=.3,reentry='another supported non-portal line'),
            jump='original REL/ABS line speed and LINEMAP_DIRECTION_OPTION with JUMP_REL_UP_KEYSTOP_TIME',
            camera='remembered line CAMERA_INDEX; original relative component speed and absolute focus defaults',
            conveyor='signed SPEED carries supported actors; per-object SetTex0UVSpeed runs on elapsed world seconds',
            bungee=dict(waitSeconds=2,state='RSI_DAMAGE_AIR_DOWN',hpMaxFraction=.1,hpMinimum=1,returnHeight=200,
                invincibility='preserve room/respawn protection while applying environment penalty',
                pickup='existing grounded hit reaction can stand a vulnerable return; respawn protection rejects that hit')),
        productOverrides=[
            'User requires10% max HP, while pinned V5 PhysicProcess_Bungee uses15%.',
            'User requires200 units above bridge centre; V5 InitPosByLineData assigns+200 then overwrites with floor Y.',
            'Existing user-selected teammate-position respawn is retained; it can occur while the teammate is falling.'],
        resourceEvidence=['contracts/pvp-map-fx-index-v1.json','reports/pvp-map-d3dx-sources-v1.json','reports/pvp-map-d3dx-keyframes-v1.json'],
        limitations=['Pinned C++ is V5 reference, not a matched NA2016 client build.',
            'No original full-client execution or original-client movement/portal/bridge trace is claimed.',
            'Sander Wind_P02 contains a malformed fadeso velocity token; literal unconsumed field is retained in the asset index.'])

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository',type=Path,default=Path('asset_sources/upstream/server/v5-source'))
    parser.add_argument('--cache',type=Path,default=ROOT/'.cache/pvp-map-source-v1')
    args=parser.parse_args();cache=args.cache.resolve()
    if not cache.is_relative_to(ROOT/'.cache'):
        raise ValueError('Source cache output must stay inside this task .cache')
    result=audit(args.repository.resolve(),cache)
    target=ROOT/'contracts/pvp-map-mechanics-source-v1.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(files=len(result['files']),consumers=len(result['consumerSpans']),maps=len(result['maps']),targetClientMeasured=False)))
