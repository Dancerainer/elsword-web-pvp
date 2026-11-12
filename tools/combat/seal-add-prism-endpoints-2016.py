"""Build a bounded invisible NPC pose/HP/defence contract from read-only inputs.

This does not run Lua or target code. Audio is copied without transcoding to
the mandatory task-owned artifact output. No shared artifacts are written.
"""
from pathlib import Path
import argparse,gzip,json,sys,hashlib
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog,parse_ksm,to_tree,walk,helpers_from_tree,clips
SHA='43cd694a00e7e1d34f45959c7ff4d6aa35efc4176377795a5e6340694e6c65d0'
sha=lambda b:hashlib.sha256(b).hexdigest()

def build(source_root,analysis_root,output):
    # Reuse the existing read-only KOM decoder as a source utility; no original
    # Lua bytecode is executed and no static analysis project or shared cache is mutated.
    sys.path.append(str(analysis_root/'tools'))
    import kom
    catalog=Catalog(source_root);path=catalog.path('SI_A_CTT_REMOTE_MORTAR_Effect.x')
    raw=path.read_bytes()
    if sha(raw)!=SHA:raise ValueError('Original Prism model SHA mismatch')
    archive=Path('asset_sources/client/data/data117.kom')
    with archive.open('rb') as stream:
        entries,index=kom.index(stream)
        ordinal,entry=next((i,e)for i,e in enumerate(entries)if e['Name'].casefold()==path.name.casefold())
        stream.seek(entry['offset']);packed=stream.read(int(entry['CompressedSize']))
        if kom.unpack(entry,packed)!=raw:raise ValueError('Catalog model differs from original KOM')
    decoded=parse_ksm(path);tree=to_tree(decoded)
    wanted={'Scene_Root','Bip01','COLLISION_SPHERE1','COLLISION_SPHERE2'}
    frames=[(n,a)for n,a in walk(tree)if n.kind=='Frame'and n.name in wanted]
    ids={n.name:i for i,(n,a)in enumerate(frames)}
    if set(ids)!=wanted:raise ValueError('Missing original Prism collision hierarchy')
    helpers=[{k:h[k]for k in ('name','parent','nativeStoredBoundingRadius')}for h in helpers_from_tree(tree,path.name)if h['name']in wanted]
    if len(helpers)!=2 or any(h['nativeStoredBoundingRadius']<=0 for h in helpers):raise ValueError('Original stored sphere radius unavailable')
    selected=[]
    for clip,original in zip(clips(decoded),decoded['animations']):
        if clip['name']not in ('Start','Wait','Damage'):continue
        selected.append({'name':clip['name'],'ticks_per_second':clip['ticks_per_second'],
            'durationSeconds':original['duration_seconds'],'nativePlaybackField':original['playback_field'],
            'tracks':[t for t in clip['tracks']if t['frame_name']in wanted]})
    if len(selected)!=3:raise ValueError('Missing original Prism state clip')
    pose={'schemaVersion':1,'frames':[{'name':n.name,'parent':ids[a[-2].name]if len(a)>1 else None,
        'nativeRowMatrix':n.child('FrameTransformMatrix').nums()}for n,a in frames],'helpers':helpers,'clips':selected}
    resources_path=analysis_root/'reports/analysis/add-prism-consumers-2016/original-resources.json.gz'
    resources=json.loads(gzip.decompress(resources_path.read_bytes()))
    entries=resources['archives']['data037.kom']['entries'];scripts={}
    for entry_row in entries:
        if entry_row['name'].startswith('Particle_Prism_'):
            scripts[entry_row['name']]={k:entry_row[k]for k in ('name','ordinal','rawSha256','packedSha256','indexSha256','declarations')}
    stats=next(e for e in entries if e['name']=='NPCStat.lua')
    npc_stats={str(c['args'][1]['NPC_ID']):c['args'][1]for c in stats['calls']}
    sound_names=sorted({v['2']for script in scripts.values()for declaration in script['declarations'].values()if isinstance(declaration,dict)for key,v in declaration.items()if key.startswith('SOUND_PLAY')})
    files={};artifacts=[];folder=output/'common/add-prism/audio';folder.mkdir(parents=True,exist_ok=True)
    for name in sound_names:
        p=catalog.path(name);body=p.read_bytes()
        if not body.startswith(b'OggS'):raise ValueError('Original NPC sound is not Ogg')
        evidence=catalog.evidence(p)
        with (archive.parent/Path(evidence['archive']).name).open('rb') as audio_stream:
            audio_entries,audio_index=kom.index(audio_stream)
            audio_ordinal,audio_entry=next((i,e)for i,e in enumerate(audio_entries)if e['Name']==name)
            audio_stream.seek(audio_entry['offset']);audio_packed=audio_stream.read(int(audio_entry['CompressedSize']))
            if kom.unpack(audio_entry,audio_packed)!=body:raise ValueError('Catalog audio differs from original KOM')
        (folder/name).write_bytes(body)
        files[name]={'file':'../common/add-prism/audio/'+name,'sha256':sha(body),'bytes':len(body),'source':evidence,
            'originalKom':{'ordinal':audio_ordinal,'indexSha256':sha(audio_index),'packedSha256':sha(audio_packed)}}
        artifacts.append({'file':'common/add-prism/audio/'+name,'sha256':sha(body),'bytes':len(body)})
    contract={'schemaVersion':1,'scope':'Target2016 invisible Prism NPC1576/1577 bounded motion, collision and defence host',
        'targetExecuted':False,'packageScriptsExecuted':False,'sourceModel':{'archive':'data117.kom','ordinal':ordinal,'indexSha256':sha(index),
        'packedSha256':sha(packed),'rawSha256':SHA,'bytes':len(raw)},'declarationEvidence':{'path':'reports/analysis/add-prism-consumers-2016/original-resources.json.gz','sha256':sha(resources_path.read_bytes())},
        'scripts':scripts,'npcStats':npc_stats,'pose':pose,
        'audio':{'schemaVersion':1,'profile':{'id':'add-prism-endpoints-2016'},'files':files,'states':{},'effectSounds':{},'unsupported':[]},
        'limits':['Pose uses original KSM stored collision radii and selected source tracks; target battle not measured.',
        'Source SHOW=0 means no visible NPC body resource is needed; caster field remains independently visible.',
        'Current deterministic simulation timeline supplies the wallclock input. No original battle clock or runtime heap sampled.',
        'NPC defence0/HARD_LEVEL defence0 are source declarations. The common qualified Web NPC damage formula is reused.']}
    target=ROOT/'contracts/add-prism-endpoints-2016.json';target.write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    handoff={'schemaVersion':1,'artifactRoot':str(output.resolve()),'files':artifacts,'bytes':sum(r['bytes']for r in artifacts),
        'contract':str(target.relative_to(ROOT)),'contractSha256':sha(target.read_bytes()),'additionalNpcGlbRequired':False}
    report=ROOT/'reports/add-prism-endpoints-2016-assets.json';report.write_text(json.dumps(handoff,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'contractBytes':target.stat().st_size,'poseFrames':len(frames),'clips':len(selected),'artifacts':len(artifacts),'artifactBytes':handoff['bytes']}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,default=Path('asset_work'));p.add_argument('--analysis-root',type=Path,default=Path('asset_sources/analysis-project'));p.add_argument('--artifact-output',type=Path,required=True)
    a=p.parse_args();build(a.source_root,a.analysis_root,a.artifact_output)
