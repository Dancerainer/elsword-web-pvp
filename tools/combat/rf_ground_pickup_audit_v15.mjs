/** Observe identical real input against a read-only baseline and this task.
 * Outputs describe current simulations and contain no original-client oracle. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(readFileSync(resolve(root,p)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map=read('artifacts/scene/sander-garpai-rock-pvp/collision.json');
const fx=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx','awakening-fx','core-shield-fx','critical-fx','skill-fx-v11','xx2x-fx','xxx-fx'].map(p=>read('artifacts/rf/'+p+'/index.json')));
const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),fx);
const effectPoses=Object.fromEntries(collectEffectPoseFiles(effectIndex,fx).map(p=>[p,read('artifacts/rf/'+p)]));
const characterPose=read('artifacts/rf/runtime-pose.json');
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native/'+p))});
const nativeOptions={nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
  nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak,nativeEffectRandom:native.effectRandom,versions:native.versions};
const clone=v=>JSON.parse(JSON.stringify(v));
const state=a=>({state:a.state,x:a.x,y:a.y,z:a.z,vy:a.vy,grounded:a.grounded,animation:a.animationName,animationTime:a.animationTime,
  landPosition:clone(a.landPosition),hitStop:a.hitStop,passiveSpeed:clone(a.passiveSpeed),transition:clone(a.presentationTransition)});
function run(factory,{facing=1,gap=120,delay=3,cycles=1,airForward=false}){
  const x=facing===1?-650:650;
  const s=factory({profile,preset,map,seed:2016,...nativeOptions,...createNativeSamplers({characterPose,effectIndex,effectPoses,profile}),
    actors:[{id:'rf',team:0,x,y:3800,z:0,lineId:4,facing},{id:'target',team:1,x:x+gap*facing,y:3800,z:0,lineId:4,facing:-facing}]});
  const a=s.actor('rf'),b=s.actor('target'),inputs=[],accepted=[],airXFrames=[],stateEntries=[],targetFrames=[];s.drainEvents();const initial=s.snapshot();
  const enter=s.enter.bind(s);s.enter=(unit,name,reason)=>{
    const before=state(unit),result=enter(unit,name,reason);stateEntries.push({time:s.state.time,actorId:unit.id,reason,before,after:state(unit)});return result;
  };
  const attack=s.checkCharacterAttack.bind(s);s.checkCharacterAttack=(unit,before,after)=>{
    if(unit.id===a.id&&unit.state==='RSI_JUMP_COMBO_X'){
      const raw=s.profile.states[unit.state].raw,shapes=s.collisionSampler(unit,{profile:s.profile,raw,stateTime:unit.stateTime,animationTime:after}),defenders=s.defenderSampler(b);
      const points=shapes.flatMap(shape=>defenders.map(defender=>s.hitPoint(shape,defender)).filter(Boolean));
      const margins=shapes.flatMap(shape=>defenders.filter(d=>shape.kind==='sphere'&&d.kind==='sphere').map(d=>
        Math.hypot(...shape.center.map((n,i)=>n-d.center[i]))-shape.radius-d.radius));
      airXFrames.push({time:s.state.time,serial:unit.stateSerial,beforeTime:before,afterTime:after,
        active:after>raw.ATTACK_TIME0['1']&&after<raw.ATTACK_TIME0['2'],attacker:state(unit),target:state(b),
        priorHit:Object.hasOwn(unit.hits,b.id),targetInvincible:b.invincible,geometricOverlap:points.length>0,
        minSphereMargin:margins.length?Math.min(...margins):null,shapes,defenders});
    }
    return attack(unit,before,after);
  };
  const original=s.applyHit.bind(s);
  s.applyHit=(owner,target,data,origin)=>{
    const before=state(target),result=original(owner,target,data,origin);
    if(result?.accepted)accepted.push({time:s.state.time,owner:state(owner),origin:clone(origin),before,after:state(target)});
    return result;
  };
  const step=(input={})=>{inputs.push({actorId:'rf',...input});s.step(1/60,inputs.at(-1),{snapshot:false});targetFrames.push({time:s.state.time,...state(b)});};
  const until=(fn,input={},max=240)=>{let n=0;while(!fn()&&n++<max)step(input);if(!fn())throw new Error('Input sequence exhausted at '+a.state);};
  for(let cycle=0;cycle<cycles;cycle++){
    if(cycle===0)step({pressed:['Z']});
    for(const [source,key,next] of [['RSI_COMBO_Z','Z','RSI_COMBO_ZZ'],['RSI_COMBO_ZZ','X','RSI_COMBO_ZZX'],['RSI_COMBO_ZZX','X','RSI_COMBO_ZZXX']]){
      until(()=>a.state===source&&a.animationTime>=.1);step({pressed:[key]});until(()=>a.state===next);
    }
    const direction=airForward?[facing===1?'RIGHT':'LEFT']:[];
    until(()=>a.animationTime>=.6);step({pressed:['UP'],held:['UP',...direction]});
    for(let i=0;i<delay-1;i++)step({held:['UP',...direction]});step({pressed:['DOWN'],held:['DOWN',...direction]});step({pressed:['X'],held:['DOWN',...direction]});
    until(()=>a.grounded,{held:['DOWN',...direction]});step({pressed:['Z']});until(()=>a.state==='RSI_COMBO_Z');for(let i=0;i<12;i++)step();
  }
  return {fixture:{facing,gap,delay,cycles,airForward},inputs,initial,accepted,airXFrames,stateEntries,targetFrames,events:s.drainEvents(),final:s.snapshot(),originalExpectations:null};
}
const baselinePath=process.argv[2];
if(!baselinePath)throw new TypeError('Provide an explicit read-only baseline combat-core/index.mjs');
const baseline=await import(pathToFileURL(resolve(baselinePath)).href);
const cases=[];
for(const facing of [-1,1])for(const gap of [70,120,170])for(const delay of [1,3,8]){
  const fixture={facing,gap,delay},before=run(baseline.createSimulation,fixture),after=run(createSimulation,fixture);
  if(JSON.stringify(before.inputs)!==JSON.stringify(after.inputs))throw new Error('Comparison input mismatch');
  cases.push({fixture,before,after});
}
const repeated=run(createSimulation,{facing:1,gap:120,delay:3,cycles:3});
const forwardLoops=[-1,1].map(facing=>run(createSimulation,{facing,gap:120,delay:3,cycles:2,airForward:true}));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const summary={cases:cases.length,identicalInputComparisons:cases.length,
  baselineFinalZAirSmall:cases.filter(c=>c.before.accepted.at(-1).after.state==='RSI_DAMAGE_AIR_SMALL').length,
  candidateFinalZGroundSmall:cases.filter(c=>/^RSI_DAMAGE_SMALL_/.test(c.after.accepted.at(-1).after.state)).length,
  candidateRelocatedVictimAtZ:cases.filter(c=>c.after.accepted.at(-1).before.y!==c.after.accepted.at(-1).after.y).length,
  repeatedCycles:3,repeatedAirXHitCount:repeated.accepted.filter(e=>e.owner.state==='RSI_JUMP_COMBO_X').length,
  repeatedFinalZHeight:repeated.accepted.at(-1).before.y-3800,repeatedFinalZReaction:repeated.accepted.at(-1).after.state,
  repeatedGroundPickups:repeated.accepted.filter(e=>e.owner.state==='RSI_COMBO_Z'&&e.before.state!=='RSI_WAIT'&&/^RSI_DAMAGE_SMALL_/.test(e.after.state)).length,
  repeatedAirSmallEvents:repeated.stateEntries.filter(e=>e.actorId==='target'&&e.after.state==='RSI_DAMAGE_AIR_SMALL').length,
  repeatedLoopClosed:false,
  forwardLoops:forwardLoops.map(c=>({facing:c.fixture.facing,cycles:2,airXHits:c.accepted.filter(e=>e.owner.state==='RSI_JUMP_COMBO_X').length,
    finalZReaction:c.accepted.at(-1).after.state}))};
const record={schema:'rf-ground-pickup-observations-v15',evidenceClass:'current simulation comparison, not native2016 oracle',
  targetClientMeasured:false,baselineCore:{path:resolve(baselinePath),sha256:sha(resolve(baselinePath))},
  implementationHashes:Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/reaction-owner-policy.mjs',
    'packages/combat-core/reaction-policy.mjs','config/rf-preset.json','packages/combat-core/rf-profile.json',
    'artifacts/rf/runtime-pose.json','artifacts/scene/sander-garpai-rock-pvp/collision.json','artifacts/native/manifest.json']
    .map(p=>[p,sha(resolve(root,p))])),summary,cases,repeated,forwardLoops,
  limits:['Target2016 AT_EFFECT ground-pickup consumer remains unavailable. The near-ground body-Z adapter is explicit.',
    'Three no-direction cycles restore Small at each final Z without relaunch, but later air X helpers do not overlap due to relative distance. This is current geometry observation, not an original hit/miss oracle.',
    'Original JumpX Future applies GetWalkSpeed only for held same-direction movement. Both two-cycle forward-input cases hit their air X helpers; no automatic pursuit or expanded geometry is added.']};
const output=resolve(root,process.argv[3]??'artifacts/proof-v15/ground-pickup.json');
if(!output.startsWith(resolve(root,'artifacts')+'/')&&!output.startsWith(resolve(root,'artifacts')+'\\'))throw new TypeError('Output must remain in this task artifacts');
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({output,sha256:sha(output),summary,targetClientMeasured:false}));
