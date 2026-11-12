"""Append the one target2016 mutation FX template missing from the 507 closure."""
import argparse,json,re,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog,write_json,digest
from build_rf_fx import read_definitions,select_templates
from build_lk_fx import build as build_fx
OUT=ROOT/'artifacts/mm/mutation-fx'
NAME='ADD_Countdown_Bomb_Trace_Mutation'
def read(p):return json.loads(p.read_text('utf8'))
def build(profile_path):
    profile_raw=profile_path.read_bytes();profile=json.loads(profile_raw);c=Catalog(Path('asset_work'));definitions=read_definitions(c)
    selected,_=select_templates(definitions,profile,[])
    if NAME not in selected:raise ValueError('Original mutation DamageEffect root missing')
    private=ROOT/'.cache/add-npc/mm-mutation-fx-delta.json';write_json(private,{'professionId':'mm-mutation','effectSets':{},'damageEffects':{},'resourceOnlyTemplates':[NAME]})
    index=build_fx(OUT,private,c.root,None)
    for t in index['templates'].values():
        for key in ('glb','poseData'):
            if t.get(key):t[key]='mutation-fx/'+t[key].removeprefix('fx/')
        for value in t['textures'].values():value['file']='mutation-fx/'+value['file'].removeprefix('fx/')
        for key in ('SLASH_TRACE_TEXTURE',):
            if name:=t['fields'].get(key):
                source=c.path(name);image=Image.open(source).convert('RGBA');name_file=Path(name).stem+'-'+digest(source.read_bytes())[:10]+'.png'
                (OUT/'textures').mkdir(exist_ok=True);image.save(OUT/'textures'/name_file)
                t['textures'][name]={'file':'mutation-fx/textures/'+name_file,'width':image.width,'height':image.height,'source':c.evidence(source),
                    'declarationField':key,'consumerStatus':'preserved original field; missing UseSlashTrace and original TRACE_START0/END0 prevent qualified fixed-V5 trace emission'}
    index['profileSha256']=digest(profile_raw.replace(b'\r\n',b'\n'))
    index['assetPathBase']='MM profession root; file references already include mutation-fx/'
    index['sourceFiles']+=list(c.used.values())
    if index['meshFailures']or index['missingTemplates']or any(t['unsupported']or t.get('animationRequiresUnconfirmedRate')for t in index['templates'].values()):raise ValueError('Mutation resource closure incomplete')
    write_json(OUT/'index.json',index);write_json(ROOT/'contracts/mm-mutation-fx-index-v1.json',index)
    pose=read(ROOT/'artifacts/mm'/index['templates'][NAME]['poseData'])
    templates={name:{'fields':definitions[name]['fields'],'events':definitions[name]['events'],'source':definitions[name]['source'],'declarationSha256':definitions[name]['declarationSha256']}
        for name in ('ADD_Countdown_Bomb_Trace','ADD_Countdown_Bomb_Trace_Mutation','ADD_Countdown_Bomb_Hit','ADD_Countdown_Bomb_Mesh_01')}
    reference=Path('./.cache')
    receipts=[]
    for relative,expected,spans in [
        ('native-reference/KTDXLIB/KTDGXMeshPlayer.cpp','0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d',[(1466,1515),(1956,2029)]),
        ('fx-realcolor-v3/KTDGXMeshPlayer.h','3da8130eccaa2aaf196ab815ad5eacf78c541e6be023e8587fb9ec57367c9ab0',[(871,881)]),
        ('native-source-runtime/KTDXLIB/KTDGSlashTrace.cpp','a77b40ed64abe405b8e85273d075cc76d95f0785ade7af0dde677c62dbcdda2c',[(20,83),(225,353),(853,973)])]:
        source=reference/relative;raw=source.read_bytes()
        if digest(raw)!=expected:raise ValueError('Pinned reference changed: '+relative)
        lines=raw.splitlines(keepends=True);receipts.append({'path':str(source),'sha256':expected,'evidence':'fixed-V5 a8438f3; not target2016 execution',
            'fragments':[{'start':start,'end':end,'sha256':digest(b''.join(lines[start-1:end]))}for start,end in spans]})
    write_json(ROOT/'reports/mm-countdown-trace-source-v1.json',{'schemaVersion':1,'clientMeasured':False,'templates':templates,'fixedReference':receipts,
        'meshFrames':[f['name']for f in pose['frames']],'meshSource':c.evidence(c.path('DummyAttackBox_50x50x50.X')),
        'sourceFacts':['All three DummyAttackBox Countdown Trace/Mutation/Hit templates omit UseSlashTrace. Their SlashTrace event is retained.',
            'Actual original DummyAttackBox_50x50x50.X has Scene_Root, Dummy01, ATTACK_SPHERE1 only; no TRACE_START0/TRACE_END0.',
            'Fixed-V5 mesh constructor defaults bUseSlashTrace=false, creates strips only when enabled, then requires both original TRACE endpoints to emit.',
            'These MAIN_EFFECT_NAME entries are explosion/hit collision helpers. Visible explosion START_PARTICLE dependencies remain present.'],
        'decision':'Do not invent endpoints, width or enablement. Under the qualified fixed-V5 consumer this declared trace does not emit. A target2016 trace consumer change is unverified, not an optimization-induced missing layer.',
        'newMutationRoots':['DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation',
            'EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation0','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation1']})
    files=[]
    for p in sorted(OUT.rglob('*')):
        if p.is_file()and not p.name.endswith('.animation.json'):files.append({'file':p.relative_to(ROOT/'artifacts').as_posix(),'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size})
    write_json(ROOT/'reports/mm-mutation-assets-handoff-v1.json',{'schemaVersion':1,'artifactRoot':str(ROOT/'artifacts'),'files':files,
        'bytes':sum(r['bytes']for r in files),'integration':'Append mutation-fx/index.json to MM manifest.visualEffectIndexes. Index paths already relative to MM root; do not add a second prefix.',
        'profileSha256':index['profileSha256'],'templates':[NAME],'frozenExistingAssetsModified':False})
    print({'files':len(files),'bytes':sum(r['bytes']for r in files),'templates':[NAME]},flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile',required=True,type=Path);a=p.parse_args();build(a.profile)
