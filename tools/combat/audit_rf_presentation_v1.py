"""Freeze the original world-color and air-down consumer evidence, read-only."""
from pathlib import Path
import argparse, hashlib, json, re

ROOT=Path(__file__).resolve().parents[2]
REFERENCE=Path('./.cache')
EXPECTED={
    'pvp-source/X2Lib/X2GURaven.cpp':'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'pvp-source/X2Lib/X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
}
CONSUMER_FILES={
    'X2Lib/X2World.cpp':'native-source-runtime/X2Lib/X2World.cpp',
    'X2Lib/X2GameUnit.h':'native-reference/X2Lib/X2GameUnit.h',
    'KTDXLIB/KTDGParticleSystem.cpp':'native-reference/KTDXLIB/KTDGParticleSystem.cpp',
    'KTDXLIB/KTDGParticleSystem.h':'native-reference/KTDXLIB/KTDGParticleSystem.h',
}
def digest(data):return hashlib.sha256(data).hexdigest()
def verify_consumers(reference_root):
    manifest=json.loads((ROOT/'contracts/rf-native-runtime-sources.json').read_text('utf-8'))
    if manifest['commit']!='a8438f3ed18dd6f0944793de6c0d8bb9334e9633':raise ValueError('Reference commit mismatch')
    entries={row['relativePath']:row for row in manifest['files']}
    verified=[]
    for relative,cache in CONSUMER_FILES.items():
        raw=(reference_root/cache).read_bytes();row=entries[relative]
        blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        if digest(raw)!=row['sha256'] or blob!=row['gitBlob'] or len(raw)!=row['bytes']:
            raise ValueError('Native consumer SHA256 / Git blob mismatch: '+relative)
        verified.append({key:row[key] for key in ('relativePath','path','sha256','gitBlob','bytes')})
    return verified
def span(source,name):
    match=re.search(r'^(?:[^\n]*\s+)?(?:CX2GURaven|CX2GUUser|CX2World)::'+re.escape(name)+r'\([^\n]*\)\s*\{',source,re.M)
    if not match:raise ValueError('Source function missing: '+name)
    start=source.index('{',match.start());depth=1;i=start+1
    while depth and i<len(source):
        depth+=(source[i]=='{')-(source[i]=='}');i+=1
    if depth:raise ValueError('Unclosed reference function: '+name)
    body=source[match.start():i]
    return {'function':name,'startLine':source.count('\n',0,match.start())+1,
        'endLine':source.count('\n',0,i)+1,'sha256':digest(body.encode('latin1'))},body
def audit(reference_root=REFERENCE):
    consumers=verify_consumers(reference_root)
    sources={}
    for rel,expected in EXPECTED.items():
        raw=(reference_root/rel).read_bytes()
        if digest(raw)!=expected:raise ValueError('Fixed-V5 reference changed: '+rel)
        sources[rel]=raw.decode('latin1')
    object_path=ROOT/'.cache/presentation-source-v1/X2Lib/X2WorldObject.cpp'
    obj=object_path.read_bytes()
    if digest(obj)!='115c7b6dcc9bf95ee32fa4e13d6c2c79b610fa01c018473ce7a9d54320ccf34f':raise ValueError('WorldObject source changed')
    profile=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf-8'))
    raven=sources['pvp-source/X2Lib/X2GURaven.cpp'];user=sources['pvp-source/X2Lib/X2GUUser.cpp']
    callbacks={}
    for name in profile['states']:
        try:entry,body=span(raven,name+'_FrameMove')
        except ValueError:continue
        if 'ChangeWorldColorByHyperMode();' in body:callbacks[name]=entry
    functions={}
    for name in ['GetShowCutInAndChangeWorldColor','ChangeWorldColorByHyperMode','CommonStateEnd',
        'DamageAirDownLandingStart','DamageAirDownLandingFrameMove']:
        entry,body=span(user,name);functions[name]=entry
    entry,body=span(raven,'HyperModeFrameMove');functions['HyperModeFrameMove']=entry
    color_body=span(user,'ChangeWorldColorByHyperMode')[1]
    assert '0xffff0000' in color_body and '0xff222222' in color_body
    visibility=span(user,'GetShowCutInAndChangeWorldColor')[1]
    assert 'case CX2Game::GT_PVP:' in visibility and 'return true;' in visibility
    end=span(user,'CommonStateEnd')[1]
    assert 'FadeWorldColor( g_pX2Game->GetWorld()->GetOriginColor(), 1.0f )' in end
    landing=span(user,'DamageAirDownLandingStart')[1];frame=span(user,'DamageAirDownLandingFrameMove')[1]
    assert 'L"DropDown"' in landing and '5, 10,  1' in landing and '200.f, 200.f, 10' in landing
    assert '0.029f' in frame and '0.46f' in frame and '100, 100, 7' in frame
    report={'schemaVersion':1,'evidenceClass':'target2016-static + fixed-V5-consumers + source-DLL-resource-measurement + browser-adapter',
      'referenceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','targetClientMeasured':False,
      'files':[{'relativePath':rel,'sha256':EXPECTED[rel]} for rel in EXPECTED]+consumers+[
        {'relativePath':'X2Lib/X2WorldObject.cpp','sha256':digest(obj),'gitBlob':'56ecae457beed4c973f4d393187dcfb1a604d0b8','constructorDefaultUseWorldColor':True,'line':12}],
      'functions':functions,'colorCallbacks':callbacks,
      'targetChangeWorldColorStates':[n for n,v in profile['states'].items() if v['raw'].get('CHANGE_WORLD_COLOR')],
      'worldColor':{'normalArgb':'0xff222222','awakenedSkillArgb':'0xffff0000','awakeningMotionArgb':'0xff222222','pvpScope':'global world color; no distance gate',
          'battleFieldScope':'800-unit CutIn visibility gate; not implemented as PvP darken radius','restoreSeconds':1,'objects':'only UseWorldColor; sky dome receives color factor','actors':'original consumer reads world LightPos, independent of NowColor'},
      'landing':{'state':'RSI_DAMAGE_AIR_DOWN_LANDING','start':[{'name':'DropDown','position':'actor Now position'},
          {'name':'GroundShockWave','position':'landPosition + [0,5,0]','emitRate':[5,10],'triggerCount':1},
          {'name':'AirDownTick','position':'actor Now position','landY':'landPosition.y','emitRate':[200,200],'triggerCount':10}],
          'animationTimers':[.029,.46],'timerParticle':'DownSmoke','timerEmitRate':[100,100],'timerTriggerCount':7,
          'commonSequenceRetrigger':'SetTriggerCount resets Count to0; preserves live particles and per-sequence cap'},
      'targetResourceIndex':'contracts/rf-landing-fx-index-v1.json',
      'nativeKeyManifest':'reports/rf-landing-d3dx-keyframes-v1.json',
      'webAdapters':['World-material multiplication; character/particle/HUD materials excluded.',
          'Snapshot stateSerial drives one-shot landing births; old packet replay is ignored.',
          'A refreshed browser observing mid-landing omits historical births, keeping only future timer crossings.',
          'Common source minor sequence is reused per actor/name and retains NumParticles across retriggers.'],
      'limits':['Full target2016 client and GPU comparison remain unmeasured.','Exact multi-actor CommonStateEnd ordering is not transplanted; active source casts hold color until all observed casts finish.']}
    output=ROOT/'contracts/rf-screen-landing-source-v1.json';output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({'callbacks':len(callbacks),'flagStates':len(report['targetChangeWorldColorStates']),'output':str(output)}))
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--reference-root',type=Path,default=REFERENCE)
    args=p.parse_args();audit(args.reference_root)
