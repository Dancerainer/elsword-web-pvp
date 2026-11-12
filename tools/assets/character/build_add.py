"""Convert LP/MM/DE original ADD bodies and complete native motion families."""
import argparse,json
from pathlib import Path
from build_rf import Catalog,build_character,digest,write_json,parse_ksm,json_bytes
from export_ksm_sample import clips
ROOT=Path(__file__).resolve().parents[3]
JOBS={'lp':(122,'PT','ALP','Lunatic Psyker'),'mm':(123,'AT','AMM','Mastermind'),'de':(126,'TT','ADE','Diabolic Esper')}
def spec(job):
    cls,parent,prefix,name=JOBS[job]
    return {'id':job,'motions':('Motion_ADD.x','Motion_ADD_Common.x',*dict.fromkeys(('Motion_ADD_PT.x','Motion_ADD_'+parent+'.x')),'Motion_ADD_'+job.upper()+'.x'),
      'supplementalMotions':{},'body':('Mesh_ADD_'+prefix+('_Basic_Hair_Sorted.X' if job=='de' else '_Base_Hair_Sorted.X'),'Mesh_ADD_Basic_Face_Sorted.X',
      *('Mesh_ADD_'+prefix+'_Cash_'+part+'_Sorted.X' for part in ('Upbody','Lowbody','Hand','Foot'))),
      'weapon':'Mesh_ADD_'+prefix+'_Cash_Weapon_Sorted.X',
      'weaponMounts':tuple({'source':'Weapon01','target':'Weapon'+str(i).zfill(2),'name':job.upper()+'_Dynamo'+str(i).zfill(2)}for i in range(1,7))}
def build(job,source,output,clips_only=False):
    if output.resolve().is_relative_to(source.resolve()):raise ValueError('Output must stay outside original inputs')
    c=Catalog(source);s=spec(job);output.mkdir(parents=True,exist_ok=True)
    if clips_only:
        rows=[];seen={}
        for filename in s['motions']:
            p=c.path(filename);data=parse_ksm(p)
            for index,(native,clip) in enumerate(zip(data['animations'],clips(data))):
                name=clip['name'];signature=digest(json_bytes(clip,True))
                if name in seen:
                    if seen[name]==signature:continue
                    name+='__'+p.stem
                else:seen[name]=signature
                rows.append({'name':name,'sourceName':clip['name'],'source':c.evidence(p)['rawPath'],'sourceAnimationIndex':index,
                   'durationSeconds':native['duration_seconds'],'durationTicks':native['duration_ticks'],'ticksPerSecond':native['ticks_per_second'],
                   'nativePlaybackField':native['playback_field'],'decodedKeysSha256':signature,'trackCount':len(clip['tracks'])})
        write_json(output/'clips.json',rows);print(job,len(rows),flush=True);return
    m={'schemaVersion':1,'converterVersion':'add-assets-target2016-v1','id':job,'unitClass':JOBS[job][0],'name':JOBS[job][3],
       'referenceVersion':'Steam-NA-2016-V6.0420.5','evidenceLevel':'original-file-data','clientMeasured':False,
       'costumeSelection':'Exact target2016 ADD promotion filenames; shared original basic face',
       'limits':['Original-client/GPU comparison unavailable; source original animation keys retained.',
                 'Six rigid dynamos are mounted on original Weapon01..06 authored bones; native registration consumer remains unmeasured.']}
    shared=None
    if job!='lp':
        shared=json.loads((output.parent/'lp/manifest.json').read_text('utf8'))
        included=set(shared['runtimeCharacter']['selection']['included'])
        s['sharedRuntimeClips']={row['name']:row['decodedKeysSha256'] for row in shared['clips'] if row['name'] in included}
    m.update(build_character(c,output,all_character_animations=True,spec=s))
    if shared:
        m['sharedCharacterAnimations']={'glb':'../lp/'+shared['runtimeGlb'],
          'clips':m['runtimeCharacter'].get('sharedAnimationNames',[]),
          'evidence':'Identical original decoded keys and names; source LP runtime contains every shared animation'}
    m['runtimeCharacter']['selection']['purpose']='All original ADD/common/first-job/second-job animation keys; independent promotion geometry'
    m['sourceEvidence']=sorted(c.used.values(),key=lambda r:r['rawPath']);write_json(output/'manifest.json',m)
    write_json(ROOT/f'contracts/{job}-assets-motion-index.json',{'schemaVersion':1,'selection':s,'clientMeasured':False,
      'sourceEvidence':m['sourceEvidence'],'runtimeClipNames':m['runtimeCharacter']['selection']['included'],
      'attachments':m['attachments'],'clips':[{k:v for k,v in row.items() if k!='rootMotion'}for row in m['clips']]})
    print(job,len(m['clips']),m['runtimeGlb'],flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--job',choices=JOBS);p.add_argument('--source',type=Path,default=Path('asset_work'));p.add_argument('--clips-only',action='store_true')
    a=p.parse_args()
    for job in ([a.job] if a.job else JOBS):build(job,a.source,ROOT/'artifacts'/job,a.clips_only)
