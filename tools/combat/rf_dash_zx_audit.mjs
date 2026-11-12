/** Production-pose diagnostic; its output is not original-client golden data. */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>JSON.parse(readFileSync(resolve(project,p)));
export const dashZxProfile=read('packages/combat-core/rf-profile.json');
const preset=read('config/rf-preset.json');
const manifest=read('artifacts/native/manifest.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['rf-fx-index.json','rf-buff-display-fx-index.json','rf-shadow-weapon-fx-index.json',
  'rf-awakening-fx-index.json','rf-command-fx-index-v9.json','rf-skill-fx-index-v11.json','rf-core-shield-fx-index-v11.json',
  'rf-critical-fx-index-v11.json','rf-xx2x-fx-index-v12.json'].map(n=>read('contracts/'+n)));
const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))]
  .map(p=>[p,read('artifacts/rf/'+p)]));
const characterPose=read('artifacts/rf/runtime-pose.json');
export async function dashZxFixture({facing=1,gap=70,position=[0,3080,0],lineId=2,presetOverride}={}){
  const n=await createNativeRuntime({manifest,map,loadBinary:p=>readFileSync(resolve(project,'artifacts/native',p))});
  const s=createSimulation({profile:dashZxProfile,map,preset:presetOverride??preset,seed:2016,
    actors:[{id:'rf',team:0,position,lineId,facing},{id:'target',team:1,position:[position[0]+facing*gap,position[1],position[2]],lineId,facing:-facing}],
    ...createNativeSamplers({profile:dashZxProfile,characterPose,effectIndex,effectPoses}),
    nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,
    versions:n.versions});
  return {s,a:s.actor('rf'),b:s.actor('target'),n};
}
export const dashZxFrame=(f,input={})=>f.s.step(1/60,input,{snapshot:false});
export function startDashZx(f,{facing=f.a.facing,xDelay=3}={}){
  const key=facing===1?'RIGHT':'LEFT';
  dashZxFrame(f,{pressed:[key],held:[key]});dashZxFrame(f,{released:[key]});dashZxFrame(f,{pressed:[key],held:[key]});
  dashZxFrame(f,{pressed:['Z'],held:[key,'Z']});
  for(let i=0;i<xDelay;i++)dashZxFrame(f,{held:[key]});
  dashZxFrame(f,{pressed:['X'],held:[key,'X']});
}
export async function observeDashZx(options={}){
  const f=await dashZxFixture(options),{s,a,b}=f;
  startDashZx(f,options);const samples=[];
  for(let i=0;i<180;i++){
    dashZxFrame(f);
    const e=s.state.effects.find(e=>e.name==='Damage_Effect_Raven_ROT_Dash_ZX'&&e.active);
    if(!e)continue;
    // Keep the hit-window diagnosis small; the simulation still runs all 180
    // frames to record state retirement and real platform/wall interactions.
    if(e.elapsed>=e.damage.ATTACK_TIME_END+.05)continue;
    const attacks=s.effectSampler(e,a),defenders=s.defenderSampler(b);
    const distance=Math.min(...attacks.flatMap(x=>defenders.map(d=>Math.hypot(...x.center.map((v,j)=>v-d.center[j]))-x.radius-d.radius)));
    samples.push({time:s.state.time,animationTime:a.animationTime,globalEffectTime:e.elapsed,
      position:[a.x,a.y,a.z],targetPosition:[b.x,b.y,b.z],targetState:b.state,
      relativeX:(b.x-a.x)*a.facing,sphereSeparation:distance,
      activeDamage:e.elapsed>=e.damage.ATTACK_TIME_START&&e.elapsed<e.damage.ATTACK_TIME_END,
      rootXZ:{...a.motionMoveNow},worldVelocityX:a.vx,hits:{...e.hits}});
  }
  const events=s.drainEvents(),hits=events.filter(e=>e.type==='hit');
  const births=events.filter(e=>e.type==='effectStarted'&&e.name==='Damage_Effect_Raven_ROT_Dash_ZX');
  return {fixture:options,enteredRush:events.some(e=>e.type==='stateChanged'&&e.state==='RSI_OVER_TAKER_DASH_COMBO_ZX'),
    stateChanges:events.filter(e=>e.type==='stateChanged').map(e=>({time:e.time,actorId:e.actorId,state:e.state,animationName:e.animationName,reason:e.reason})),
    candidateNotes:events.filter(e=>e.type==='unsupported'),
    sourceHitMultipliers:hits.map(e=>e.data.DAMAGE),hits:hits.map(e=>({time:e.time,damage:e.data.DAMAGE,origin:e.origin,amount:e.amount})),
    births:births.map(e=>({time:e.time,anchor:e.birthAnchor})),
    samples:options.recordFrames?samples:undefined,
    firstActiveSample:samples.find(e=>e.activeDamage)??null,
    closestBeforeDamage:samples.filter(e=>!e.activeDamage&&e.globalEffectTime<.15).sort((l,r)=>l.sphereSeparation-r.sphereSeparation)[0]??null,
    closestActive:samples.filter(e=>e.activeDamage).sort((l,r)=>l.sphereSeparation-r.sphereSeparation)[0]??null,
    finished:{state:a.state,targetState:b.state,position:[a.x,a.y,a.z],targetPosition:[b.x,b.y,b.z]}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cases=[];
  for(const facing of [-1,1])for(const gap of [0,5,70,80,180,300,400,500,600,800])for(const xDelay of [0,3,12,25])
    cases.push(await observeDashZx({facing,gap,xDelay,position:[0,3080,0],lineId:2,recordFrames:gap===70&&xDelay===3}));
  for(const facing of [-1,1])for(const gap of [0,70,180])for(const position of [[2023,2840,0],[1450,2840,0]])
    cases.push(await observeDashZx({facing,gap,xDelay:3,position,lineId:6}));
  const probe=await dashZxFixture();
  const implementationHashes=Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/reaction-policy.mjs',
    'packages/combat-core/rf-profile.json','tools/combat/rf_dash_zx_audit.mjs','artifacts/rf/runtime-pose.json',
    'artifacts/scene/sander-garpai-rock-pvp/collision.json'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(project,p),'utf8').replace(/\r\n/g,'\n')).digest('hex')]));
  const output={schema:'rf-dash-zx-observations-v12',evidenceClass:'simulation-implementation',targetClientMeasured:false,
    ruleVersions:probe.s.versions,implementationHashEncoding:'utf8-normalized-lf',implementationHashes,
    frameObservationWindow:'mesh global age < ATTACK_TIME_END + .05; simulation continues 180 frames for final states',
    sourceTimes:{effectStartAnimationTime:.2,damageStartGlobalTime:.15,damageEndGlobalTime:.35},
    warning:'Observed hit counts and frame positions are not regression expectations or evidence of intended original miss behavior.',cases};
  const out=process.argv[2]??'reports/rf-dash-zx-observations-v12.json';writeFileSync(resolve(project,out),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({out,cases:cases.length,entered:cases.filter(c=>c.enteredRush).length,
    rushHitCases:cases.filter(c=>c.hits.some(h=>h.damage.PHYSIC===3.85)).length,targetClientMeasured:false}));
}
