import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {particlePresentationBudget,createEffectPresentationPolicy} from '../../packages/effect-runtime/presentation-quality.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
import {resolveBaselineCommit} from '../baseline-ref.mjs';
const policyFile='packages/effect-runtime/presentation-quality.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>JSON.parse(readFileSync(resolve(root,path)));
export function loadContinuityInputs(id){
 const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json'),templates={};
 for(const file of manifest.visualEffectIndexes??[])Object.assign(templates,read(base+file).templates);
 return {profile:read('packages/combat-core/'+id.toLowerCase()+'-profile.json'),index:{templates}};
}
export async function baselinePresentationBudget(ref){
 const baselineCommit=resolveBaselineCommit(root,ref);
 const source=execFileSync('git',['show',baselineCommit+':'+policyFile],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
 // Only import resolution changes; the frozen policy's code and its current,
 // unchanged data contracts execute directly rather than duplicating its rules.
 const resolved=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_all,_quote,path)=>'from '+JSON.stringify(new URL(path,pathToFileURL(resolve(root,policyFile))).href));
 const baseline=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));
 return {baselineCommit,budget:baseline.particlePresentationBudget,sourceSha256:sha(source)};
}
export function sampleContinuity(template,{budget=particlePresentationBudget,quality,ownerSeconds=1,dt=1/60}={}){
 const index={templates:{[template.name]:template}},births=[],samples=[];let frame=-1;
 // The selected cues have no Trace/Final children, so single-template execution
 // preserves their exact original events while isolating their visibility gaps.
 const runtime=createEffectRuntime({index,seed:2016,effectQuality:quality,onBirth:p=>births.push({frame,age:p.age})});
 const emitter=runtime.add(template.name,{triggerTime:Math.min(template.fields.TriggerTime??Infinity,ownerSeconds)});
 Object.assign(emitter,{firstSourcePacket:false},budget(template,emitter.sourceMax,emitter.sourceLimit,quality));
 const selectedBudget={divisor:emitter.divisor,max:emitter.max,limit:emitter.limit,firstSourcePacket:emitter.firstSourcePacket};
 const ownerFrames=Math.round(ownerSeconds/dt),frames=ownerFrames+Math.ceil(1.5/dt);
 for(frame=0;frame<frames;frame++){
  if(frame===ownerFrames)runtime.stop(emitter.id);
  runtime.step(dt,{});
  let visible=0,peakAlpha=0;
  for(const p of runtime.particles.values()){
   const alpha=p.values.Color?.[3]??1,size=p.values.Size??[1,1,1];
   if(alpha>1/255&&Math.abs(size[0])>0&&Math.abs(size[1])>0){visible++;peakAlpha=Math.max(peakAlpha,alpha);}
  }
  samples.push({frame,time:Number(((frame+1)*dt).toFixed(6)),live:runtime.count,visible,peakAlpha:Number(peakAlpha.toFixed(6))});
 }
 const active=samples.slice(0,ownerFrames),firstVisible=active.findIndex(row=>row.visible>0);
 let maxEmptyRun=0,run=0,emptyFrames=0;
 for(const row of active.slice(firstVisible<0?0:firstVisible)){
  if(row.visible===0){emptyFrames++;maxEmptyRun=Math.max(maxEmptyRun,++run);}else run=0;
 }
 return {budget:selectedBudget,birthFrames:births.map(row=>row.frame),firstVisibleFrame:firstVisible,emptyFramesAfterFirst:emptyFrames,maxEmptyRunAfterFirst:maxEmptyRun,
  peakLive:Math.max(...samples.map(row=>row.live)),peakVisible:Math.max(...samples.map(row=>row.visible)),births:births.length,
  retired:runtime.count===0&&runtime.emitters.size===0,notes:[...runtime.notes],samples};
}
export async function auditContinuity(){
 const baseline=await baselinePresentationBudget(),rows=[],sources=[];
 for(const id of ['RF','BM','VC','LP']){
  const {profile,index}=loadContinuityInputs(id),quality=id==='LP'?{level:'medium',particleDivisor:8,sourceFamily:'add'}:{level:'medium',particleDivisor:8};
  const names=id==='LP'?['ADD_PSYCHIC_STORM_11','ADD_PSYCHIC_STORM_L05']:
   ['CannonBlade_P01','CannonBlade_P02','CannonBlade_P03','CannonBlade_P05','Raven_ReadyS_P01','Raven_ReadyS_P06'];
  const policy=createEffectPresentationPolicy(profile,quality),skillId=id==='LP'?29009:24026;
  sources.push({profession:id,skillId,quality:policy.actor({skillId,state:profile.skillCatalog.find(s=>s.skillId===skillId)?.state}),profileSha256:sha(readFileSync(resolve(root,'packages/combat-core/'+id.toLowerCase()+'-profile.json')))});
  for(const name of names){
   const template=index.templates[name];if(!template)throw Error('Missing published template '+id+'/'+name);
   const ownerSeconds=name.startsWith('Raven_ReadyS')?.3:name.endsWith('_L05')?1.5:name.endsWith('_11')?.9:1;
   const options={quality,ownerSeconds},before=sampleContinuity(template,{...options,budget:baseline.budget}),after=sampleContinuity(template,options),source=sampleContinuity(template,{...options,quality:{...quality,level:'high',particleDivisor:1}});
   rows.push({profession:id,name,templateSha256:sha(JSON.stringify(template)),originalFields:template.fields,ownerSeconds,before,after,source});
  }
 }
 return {schemaVersion:1,evidenceClass:'current-web-presentation-single-sequence-simulation',baseline:baseline.baselineCommit,baselinePolicySha256:baseline.sourceSha256,
  policySha256:sha(readFileSync(resolve(root,policyFile))),scope:'Published original template events in the current particle runtime, 60 Hz; measures sampled alpha/size visibility, not final GPU pixels, full skill appearance, damage, or FPS.',
  sources,rows,summary:{cases:rows.length,allRetire:rows.every(row=>row.before.retired&&row.after.retired&&row.source.retired),allFixedCuesFollowSourceClock:rows.every(row=>JSON.stringify(row.after.birthFrames)===JSON.stringify(row.source.birthFrames)),
   beforeEmptyFrames:rows.reduce((sum,row)=>sum+row.before.emptyFramesAfterFirst,0),afterEmptyFrames:rows.reduce((sum,row)=>sum+row.after.emptyFramesAfterFirst,0)}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=resolve(root,process.argv[2]??'runtime/client-performance-v60/fx-continuity.json'),result=await auditContinuity();
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output,...result.summary}));
}
