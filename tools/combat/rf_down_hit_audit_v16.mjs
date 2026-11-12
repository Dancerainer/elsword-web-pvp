/** Read-only instrumentation around production input/physics/helper consumers.
 * Simulation observations are not target-client hit/miss expectations.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dashZxFixture,dashZxFrame} from './rf_dash_zx_audit.mjs';
import {canRepeatHit} from '../../packages/combat-core/hit-gap-memory.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const map=JSON.parse(readFileSync(resolve(root,'artifacts/scene/sander-garpai-rock-pvp/collision.json')));
const jumpZ=new Set(['RSI_JUMP_COMBO_Z','RSI_DASH_JUMP_COMBO_Z']);
const isActive=(raw,t)=>Object.entries(raw).some(([k,v])=>/^ATTACK_TIME\d+$/.test(k)&&t>v['1']&&t<v['2']);
const actorPosition=a=>[a.x,a.y,a.z];
const inLine=(line,x)=>x>=line.start[0]&&x<line.end[0];
let sharedInputs;

async function fixtureWithSharedReadOnlyInputs(options){
  if(!sharedInputs){
    const f=await dashZxFixture(),{s,n}=f;
    const keys=['profile','map','preset','collisionSampler','defenderSampler','effectSampler','effectAnchorSampler',
      'effectBoneSampler','motionOffsetSampler','nasodAttackSampler','nativeGeometry','nativeCommands','nativeSkills',
      'nativeSkillValues','nativeNasod','nativeCritical','nativeManaBreak','versions'];
    sharedInputs={n,config:Object.fromEntries(keys.map(k=>[k,s[k]]))};
  }
  const {facing,gap,position,lineId}=options;
  const s=createSimulation({...sharedInputs.config,seed:2016,actors:[
    {id:'rf',team:0,position,lineId,facing},
    {id:'target',team:1,position:[position[0]+facing*gap,position[1],position[2]],lineId,facing:-facing}]});
  return {s,a:s.actor('rf'),b:s.actor('target'),n:sharedInputs.n};
}

export async function downHitFixture({lineId=5,position='center',facing=1,gap=70,delay=0,
  dash=false,targetFloor='same',mode='held',attackSpeed=1.3,reuseReadOnlyInputs=false}={}){
  const line=map.lines.find(l=>l.lineId===lineId),choices=['center','start','end'];
  if(![3,4,5,9,10].includes(lineId)||!choices.includes(position)||![-1,1].includes(facing)||
    ![0,-20,20,-70,70].includes(gap)||!Number.isInteger(delay)||delay<0||delay>12||
    typeof dash!=='boolean'||!['same','lower'].includes(targetFloor)||
    !['held','release-before-z','ordered-same'].includes(mode)||![1,1.3,1.5].includes(attackSpeed))
    throw new TypeError('Invalid bounded source-map Down-hit fixture');
  const x=position==='center'?(line.start[0]+line.end[0])/2:position==='start'?line.start[0]+1:line.end[0]-1;
  if(targetFloor==='same'&&!inLine(line,x+facing*gap))throw new TypeError('Target would be outside the authored platform');
  const factory=reuseReadOnlyInputs?fixtureWithSharedReadOnlyInputs:dashZxFixture;
  const f=await factory({lineId,position:[x,line.start[1],0],facing,gap}),{s,a,b}=f;
  if(targetFloor==='lower'){
    const lower=f.n.geometry.down({position:[x+facing*gap,line.start[1],0],radius:s.profile.referenceSemantics.lineRadius,
      lastLineId:lineId,downRadius:true,onLine:true});
    if(!lower.found)throw new TypeError('No authored lower target platform at this fixture position');
    [b.x,b.y,b.z]=lower.point;b.lineId=b.lastTouchLineId=lower.lineId;b.landPosition=[...lower.point];
  }
  // Explicit test configuration, never a change to the published preset.
  a.stats.animationSpeedMultiplier=attackSpeed;
  f.case={lineId,position,facing,gap,delay,dash,targetFloor,mode,attackSpeed,
    initialPosition:actorPosition(a),initialTargetPosition:actorPosition(b),targetLineId:b.lineId};
  f.inputs=[];
  return f;
}

export function downHitFrame(f,input={}){
  const packet={...input,edges:input.edges??[
    ...(input.pressed??[]).map((key,i)=>({key,down:true,time:f.s.state.time+(i+1)/10000})),
    ...(input.released??[]).map((key,i)=>({key,down:false,time:f.s.state.time+(i+1)/10000}))]};
  f.inputs.push({step:f.s.state.step+1,...packet});
  dashZxFrame(f,packet);
}

export function startDownHit(f){
  const {facing,delay,dash,mode}=f.case,key=facing===1?'RIGHT':'LEFT';
  if(dash){
    downHitFrame(f,{pressed:[key],held:[key]});downHitFrame(f,{released:[key]});
    downHitFrame(f,{pressed:[key],held:[key]});
  }
  const heldDown=dash?[key,'DOWN']:['DOWN'];
  if(mode==='ordered-same'){
    downHitFrame(f,{pressed:['DOWN','Z'],held:[...heldDown,'Z']});
    downHitFrame(f,{held:heldDown});
  }else{
    downHitFrame(f,{pressed:['DOWN'],held:heldDown});
    for(let i=0;i<delay;i++)downHitFrame(f,i===0&&mode==='release-before-z'?{released:['DOWN'],held:dash?[key]:[]}:
      {held:mode==='held'?heldDown:dash?[key]:[]});
    downHitFrame(f,{pressed:['Z'],held:mode==='held'?[...heldDown,'Z']:dash?[key,'Z']:['Z'],
      ...(mode==='release-before-z'&&delay===0?{released:['DOWN']}:{} )});
  }
  return f;
}

export async function observeDownHit(options={}){
  const f=await downHitFixture(options),{s,a,b}=f,samples=[],receptions=[],physicsExits=[];
  let current=null;
  const originalCharacter=s.checkCharacterAttack.bind(s),originalHits=s.checkHits.bind(s),
    originalApply=s.applyHit.bind(s),originalIntegrate=s.integrate.bind(s);
  s.integrate=(actor,...args)=>{
    const state=actor.state;
    originalIntegrate(actor,...args);
    if(actor===a&&jumpZ.has(state)&&actor.state!==state){
      physicsExits.push({step:s.state.step,state,next:actor.state,position:actorPosition(actor)});
    }
  };
  s.checkCharacterAttack=(actor,before,after)=>{
    if(actor!==a||!jumpZ.has(actor.state))return originalCharacter(actor,before,after);
    const raw=s.profile.states[actor.state].raw,shapes=s.collisionSampler(actor,{raw}),defenders=s.defenderSampler(b);
    const overlapPairs=shapes.flatMap(shape=>defenders.flatMap(defender=>{
      const point=s.hitPoint(shape,defender);
      return point?[{attackerHelper:shape.source.helper,defenderHelper:defender.source.helper,point}]:[];
    }));
    current={step:s.state.step,time:s.state.time,state:actor.state,before,after,grounded:actor.grounded,
      position:actorPosition(actor),targetPosition:actorPosition(b),targetState:b.state,
      active:isActive(raw,after),overlap:overlapPairs.length>0,overlapPairs,
      invincible:b.invincible,priorHit:Object.hasOwn(a.hits,b.id),
      repeatEligible:canRepeatHit(a.hits,a.hitGaps??{},b.id,s.state.time,raw.DAMAGE_DATA),
      hp:b.hp,helpers:shapes.map(x=>({kind:x.kind,...(x.center?{center:x.center}:{start:x.start,end:x.end}),
        radius:x.radius,source:x.source})),checkHitsCalled:false,accepted:false};
    samples.push(current);
    const result=originalCharacter(actor,before,after);current=null;return result;
  };
  s.checkHits=(actor,shapes,data,hits,origin)=>{
    if(current&&actor===a&&origin.kind==='character')current.checkHitsCalled=true;
    return originalHits(actor,shapes,data,hits,origin);
  };
  s.applyHit=(attacker,defender,data,origin)=>{
    const result=originalApply(attacker,defender,data,origin);
    if(attacker===a&&defender===b&&origin.kind==='character'){
      receptions.push({step:s.state.step,time:s.state.time,accepted:result?.accepted??false,reason:result?.reason??null});
      if(current)current.accepted=result?.accepted??false;
    }
    return result;
  };
  startDownHit(f);
  for(let i=0;i<90;i++)downHitFrame(f,{held:f.case.mode==='release-before-z'?[]:['DOWN']});
  const events=s.drainEvents(),hits=events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.origin?.kind==='character');
  const attackEntered=events.some(e=>e.type==='stateChanged'&&e.actorId===a.id&&jumpZ.has(e.state));
  const active=samples.filter(x=>x.active),eligibleOverlaps=active.filter(x=>x.overlap&&!x.invincible&&x.hp>0&&x.repeatEligible);
  const landingTimes=events.filter(e=>e.type==='landed'&&e.actorId===a.id).map(e=>e.time);
  const landingSamples=samples.filter(x=>landingTimes.includes(x.time)&&x.grounded&&x.active);
  const classification=hits.length?'accepted-hit':!attackEntered?'input-no-jump-z':!active.length?'landed-before-active-window':
    !active.some(x=>x.overlap)?'active-helper-no-overlap':eligibleOverlaps.some(x=>!x.accepted)?'eligible-overlap-rejected':'overlap-reception-filtered';
  return {fixture:f.case,classification,attackEntered,hitCount:hits.length,
    activeSampleCount:active.length,activeOverlapCount:active.filter(x=>x.overlap).length,
    eligibleOverlapRejectedCount:eligibleOverlaps.filter(x=>!x.accepted).length,
    landingActiveOverlapCount:landingSamples.filter(x=>x.overlap).length,
    landingAcceptedCount:landingSamples.filter(x=>x.accepted).length,
    preActiveOverlapCount:samples.filter(x=>!x.active&&x.overlap).length,
    dropRejected:events.filter(e=>e.type==='dropRejected'&&e.actorId===a.id),
    inputs:f.inputs,physicsExits,receptions,landingTimes,
    stateChanges:events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id).map(e=>({time:e.time,state:e.state,reason:e.reason})),
    samples,finished:{state:a.state,position:actorPosition(a),targetState:b.state,targetPosition:actorPosition(b),targetHp:b.hp}};
}

export function downHitCases(){
  const cases=[];
  for(const lineId of [3,4,5,9,10])for(const position of ['center','start','end'])for(const facing of [-1,1])
    for(const gap of [0,-20,20,-70,70])for(const targetFloor of ['same','lower']){
      const line=map.lines.find(l=>l.lineId===lineId),x=position==='center'?(line.start[0]+line.end[0])/2:position==='start'?line.start[0]+1:line.end[0]-1;
      if(targetFloor==='same'&&!inLine(line,x+facing*gap))continue;
      for(const dash of [false,true])for(const mode of ['held','release-before-z','ordered-same'])
        for(const delay of mode==='ordered-same'?[0]:[0,1,2,5,8])for(const attackSpeed of [1,1.3,1.5])
          cases.push({lineId,position,facing,gap,targetFloor,dash,mode,delay,attackSpeed});
    }
  return cases;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cases=[];
  for(const options of downHitCases()){
    try{cases.push(await observeDownHit({...options,reuseReadOnlyInputs:true}));}
    catch(error){if(error.message.startsWith('No authored lower target'))continue;throw error;}
  }
  const summary={caseCount:cases.length,classifications:{},eligibleOverlapRejectedCases:cases.filter(c=>c.eligibleOverlapRejectedCount).length,
    earlyPhysicsExitCases:cases.filter(c=>c.physicsExits.length).length,
    landingActiveOverlapCases:cases.filter(c=>c.landingActiveOverlapCount).length,
    landingAcceptedCases:cases.filter(c=>c.landingAcceptedCount).length,
    preActiveOverlapOnlyMissCases:cases.filter(c=>c.hitCount===0&&c.preActiveOverlapCount&&c.activeOverlapCount===0).length};
  for(const c of cases)summary.classifications[c.classification]=(summary.classifications[c.classification]??0)+1;
  const output=resolve(root,process.argv[2]??'artifacts/proof-v16/down-hit-implementation.json');
  if(!output.startsWith(resolve(root,'artifacts')+'/')&&!output.startsWith(resolve(root,'artifacts')+'\\'))throw new TypeError('Private output must stay in task artifacts');
  const paths=['packages/combat-core/index.mjs','packages/combat-assets/index.mjs','packages/combat-core/rf-profile.json',
    'config/rf-preset.json','tools/combat/rf_down_hit_audit_v16.mjs','artifacts/rf/runtime-pose.json',
    'artifacts/scene/sander-garpai-rock-pvp/collision.json','artifacts/native/manifest.json'];
  const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
  const record={schema:'rf-down-hit-implementation-v16',evidenceClass:'current-simulation-observations',
    targetClientMeasured:false,originalClientMeasurementCount:0,summary,inputHashes:hashes,
    method:'Production timestamped input, original map lines, current native WASM and target pose helpers; wrappers observe integrate/checkCharacterAttack/checkHits/applyHit without changing state or filters.',
    limits:['Published preset unchanged; attackSpeed is an explicit independent fixture setting.',
      '0/negative gap fixtures may be separated by original-reference body push; samples retain actual positions.',
      'No original2016 trajectories. These hit/miss counts cannot become client golden expectations.'],cases};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(record)+'\n');
  const handover={...record,cases:undefined,privateObservation:{path:output.replace(root,'').replaceAll('\\','/'),bytes:readFileSync(output).length,
    sha256:createHash('sha256').update(readFileSync(output)).digest('hex')},
    examples:cases.filter(c=>c.fixture.lineId===5&&c.fixture.position==='center'&&c.fixture.facing===1&&c.fixture.attackSpeed===1.3&&c.fixture.targetFloor==='same'&&
      !c.fixture.dash&&c.fixture.gap===70&&c.fixture.mode==='held'&&[0,2,8].includes(c.fixture.delay))};
  writeFileSync(resolve(root,'reports/rf-down-hit-observations-v16.json'),JSON.stringify(handover,null,2)+'\n');
  console.log(JSON.stringify({output,...summary,targetClientMeasured:false}));
}
