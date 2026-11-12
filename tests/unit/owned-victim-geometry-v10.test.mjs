/** Geometry-only late-contact policy with the real combat consumer.
 * The supplied sphere/line-query fixtures are explicit geometry inputs, not
 * original-client or WASM measurements. Frozen RF damage stays unchanged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {captureOwnedContactGeometry,ownedContactGeometry} from '../../packages/combat-core/contact-observation.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {ION_BLACK_HOLE_NAME} from '../../packages/combat-core/black-hole.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'victim-geometry-v10',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const damage=profile.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA;
const shape={kind:'sphere',center:[30,50,0],radius:30};
const origin={kind:'character',state:'RSI_WAIT',powerMultiplier:1,damageStateRaw:{}};

function fixture({owner='victim',helper=true,ground=false}={}){
  const sampled=[],settled=[],hookTargets=[],queries=[];
  const nativeGeometry=ground?{
    reset(){},support(){return {found:false};},down(){return {found:false};},land(){return {found:false};},
    canPassUp(){return true;},collisionPoint(){return null;},
    nearest({position}){queries.push([...position]);return {found:true,lineId:0};},
    lineGroup(){return {nativeStartIndex:0,nativeEndIndex:1};},
    distance(a,b){return Math.hypot(...a.map((v,i)=>v-b[i]));},
  }:undefined;
  const sim=createSimulation({profile,map,networkOwnerId:owner,seed:2016,nativeGeometry,
    ...(helper?{defenderSampler(actor){sampled.push(actor);return [{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}];}}:{}),
    actors:[{id:'source',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'victim',team:1,position:[30,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const source=sim.actor('source'),victim=sim.actor('victim');
  const saved=structuredClone(victim),pose=captureOwnedContactGeometry(saved);
  Object.assign(victim,{x:500,hp:victim.hpMax*.75,mp:40,stateSerial:50,facing:1});
  const apply=sim.applyParticipantHit.bind(sim),accepted=sim.acceptedSkillHit.bind(sim);
  sim.applyParticipantHit=(a,b,data,details)=>{settled.push({actor:b,before:structuredClone(b),origin:structuredClone(details)});return apply(a,b,data,details);};
  sim.acceptedSkillHit=(a,b,data,details)=>{hookTargets.push(b);return accepted(a,b,data,details);};
  const scope={playerId:'victim',attackerId:'source',epoch:1,pose};
  return {sim,source,victim,saved,scope,sampled,settled,hookTargets,queries,
    hit(){return sim.checkHits(source,[shape],structuredClone(damage),source.hits,origin);},
  };
}

test('the scoped pose changes geometry while keeping current state, protection, buffs and resources out of the historical override',()=>{
  const f=fixture();Object.assign(f.victim,{state:'RSI_SI2_POWER_ASSAULT',invincible:true,forceInvincible:.5,superArmor:true,
    skillId:24032,skillContext:{key:'A'},buffs:[{id:'live-buff'}],grounded:false,vx:120,vy:80});
  Object.assign(f.scope.pose,{state:'RSI_WAIT',stateSerial:2,invincible:false,forceInvincible:0,superArmor:false,
    skillId:null,skillContext:null,hp:1,mp:1,buffs:[],grounded:true,vx:0,vy:0});
  const before=structuredClone(f.victim),view=ownedContactGeometry(f.victim,f.scope,'source','victim');
  assert.notEqual(view,f.victim);assert.equal(view.x,30);assert.equal(view.animationName,f.saved.animationName);
  for(const key of ['state','stateSerial','invincible','forceInvincible','superArmor','skillId','skillContext','hp','mp','buffs','grounded','vx','vy'])assert.deepEqual(view[key],f.victim[key],key);
  assert.deepEqual(f.victim,before);assert.equal(view.buffs,f.victim.buffs);assert.equal(view.skillContext,f.victim.skillContext);
});

test('geometry captures retain actual controller/root flags but contain no combat protection or skill state',()=>{
  const actor={x:1,y:2,z:3,facing:-1,lineId:7,lastTouchLineId:7,landPosition:[1,0,3],animationName:'source-clip',animationTime:.4,
    animationLoop:false,animationTransitionSerial:9,presentationTransition:{fromName:'earlier-clip',weight:.2},
    consumeRootTranslation:false,applyMotionOffset:true,rootMotionEnabled:false,state:'cast',stateSerial:12,invincible:true,hp:99,mp:88,buffs:[{id:1}],skillId:24032};
  const pose=captureOwnedContactGeometry(actor);
  assert.equal(pose.consumeRootTranslation,false);assert.equal(pose.applyMotionOffset,true);assert.equal(pose.rootMotionEnabled,false);
  for(const key of ['state','stateSerial','invincible','hp','mp','buffs','skillId'])assert.equal(Object.hasOwn(pose,key),false);
  pose.presentationTransition.weight=.8;pose.landPosition[0]=400;
  assert.equal(actor.presentationTransition.weight,.2);assert.equal(actor.landPosition[0],1);
});

for(const invalid of ['offline','different-victim','different-source','own-attacker','missing-source','invalid-life','bad-position'])test(`geometry scope ${invalid} leaves the actual actor unchanged`,()=>{
  const f=fixture();let owner='victim',attacker='source';
  if(invalid==='offline')owner=null;if(invalid==='different-victim')f.scope.playerId='elsewhere';
  if(invalid==='different-source')f.scope.attackerId='elsewhere';if(invalid==='own-attacker')attacker='victim';
  if(invalid==='missing-source'){attacker=undefined;delete f.scope.attackerId;}
  if(invalid==='invalid-life')f.scope.epoch=-1;if(invalid==='bad-position')f.scope.pose.x=NaN;
  assert.equal(ownedContactGeometry(f.victim,f.scope,attacker,owner),f.victim);
});

for(const guard of ['invincible','forceInvincible'])test(`current ${guard} prevents a late hit despite an old vulnerable pose`,()=>{
  const f=fixture();f.sim.receiverContactGeometry=f.scope;
  if(guard==='invincible')f.victim.invincible=true;else f.victim.forceInvincible=.4;
  f.scope.pose.invincible=false;f.scope.pose.forceInvincible=0;
  const before=structuredClone(f.victim);assert.equal(f.hit(),0);assert.deepEqual(f.victim,before);
  assert.equal(f.settled.length,0);assert.equal(f.hookTargets.length,0);assert.deepEqual(f.source.hits,{});
});

for(const helper of [true,false])test(`an old invincible pose cannot protect a currently vulnerable owner through ${helper?'supplied helper spheres':'declared prototype geometry'}`,()=>{
  const f=fixture({helper});Object.assign(f.scope.pose,{invincible:true,forceInvincible:100,state:'RSI_WAIT',stateSerial:1});
  f.sim.receiverContactGeometry=f.scope;const hp=f.victim.hp,serial=f.victim.stateSerial;
  assert.equal(f.hit(),1);assert.ok(f.victim.hp<hp);assert.equal(f.victim.x,500);assert.equal(f.victim.stateSerial,serial+1);
  assert.ok(f.settled.every(row=>row.actor===f.victim));assert.ok(f.hookTargets.every(actor=>actor===f.victim));
  assert.equal(f.settled[0].before.x,500);assert.equal(f.settled[0].before.invincible,false);assert.equal(f.settled[0].before.stateSerial,50);
  if(helper){assert.equal(f.sampled[0].x,30);assert.equal(f.sampled[0].animationName,f.saved.animationName);assert.notEqual(f.sampled[0],f.victim);}
});

test('current armor and skill controls survive a late geometry contact and accepted hooks retain the real owner reference',()=>{
  const f=fixture();f.sim.grantBuff(f.victim,f.victim,437,1,null);
  Object.assign(f.victim,{state:'RSI_SI2_POWER_ASSAULT',superArmor:true,skillId:24032,skillContext:{key:'A',traitPolicy:{superArmor:true}},
    vx:120,vy:-20,grounded:false});
  Object.assign(f.scope.pose,{state:'RSI_WAIT',superArmor:false,skillId:null,skillContext:null,buffs:[],vx:0,vy:0,grounded:true,facing:-1});
  f.sim.receiverContactGeometry=f.scope;const state=f.victim.state,serial=f.victim.stateSerial,hp=f.victim.hp,ids=f.victim.buffs.map(buff=>buff.id);
  assert.equal(f.hit(),1);assert.ok(f.victim.hp<hp);assert.equal(f.victim.state,state);assert.equal(f.victim.stateSerial,serial);
  assert.equal(f.victim.superArmor,true);assert.equal(f.victim.skillId,24032);assert.equal(f.victim.skillContext.key,'A');
  assert.equal(f.victim.facing,1);assert.equal(f.victim.vx,120);assert.equal(f.victim.vy,-20);assert.equal(f.victim.grounded,false);
  assert.deepEqual(f.victim.buffs.map(buff=>buff.id),ids);assert.ok(f.settled.every(row=>row.actor===f.victim));assert.ok(f.hookTargets.every(actor=>actor===f.victim));
});

test('a current Limit Crusher charge chooses its normal local received-hit branch instead of the old witness state',()=>{
  const f=fixture();Object.assign(f.victim,{state:'RSI_A_RRF_LIMIT_CRUSHER_CHARGE',limitCrusherCharging:true,invincible:false});
  Object.assign(f.scope.pose,{state:'RSI_WAIT',limitCrusherCharging:false});f.sim.receiverContactGeometry=f.scope;
  const serial=f.victim.stateSerial;assert.equal(f.hit(),1);assert.equal(f.victim.state,'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK');assert.equal(f.victim.stateSerial,serial+1);
  assert.equal(f.settled[0].before.limitCrusherCharging,true);assert.equal(f.settled[0].before.state,'RSI_A_RRF_LIMIT_CRUSHER_CHARGE');
});

test('ground distance, foot and line-group queries use the old pose while actual current reaction inputs and resources remain local',()=>{
  const f=fixture({helper:false,ground:true});Object.assign(f.victim,{y:300,grounded:false,vy:-20,landPosition:[500,0,0]});
  f.sim.receiverContactGeometry=f.scope;const hp=f.victim.hp;
  const data={...structuredClone(damage),HIT_TYPE:26,DAMAGE_DISTANCE:60,DAMAGE_LINEGROUP:1};
  assert.equal(f.sim.checkGroundHits(f.source,data,f.source.hits,origin),1);assert.ok(f.victim.hp<hp);assert.equal(f.victim.x,500);assert.equal(f.victim.y,300);
  assert.ok(f.queries.some(position=>position[0]===30));assert.equal(f.settled[0].actor,f.victim);
  assert.equal(f.settled[0].before.grounded,false);assert.equal(f.settled[0].before.vy,-20);assert.equal(f.settled[0].before.y,300);
  assert.deepEqual(f.settled[0].origin.impactPoint,[30,0,0]);assert.ok(f.hookTargets.every(actor=>actor===f.victim));
});

test('local attacker observations of remote players preserve their existing speculative policy',()=>{
  const f=fixture({owner:'source'});f.victim.invincible=true;
  f.sim.setContactObservations([{...structuredClone(f.victim),x:30,invincible:false,forceInvincible:0}]);
  f.sim.receiverContactGeometry=f.scope;const hp=f.victim.hp;
  assert.equal(f.hit(),1);assert.equal(f.victim.hp,hp);assert.equal(f.victim.invincible,true);assert.equal(f.victim.x,500);
  assert.notEqual(f.settled[0].actor,f.victim,'remote speculative settlement remains disposable');
});

for(const throws of [false,true])test(`consumer contact scope preserves the original local actor and restores its previous scope ${throws?'after an exception':'after normal admission'}`,()=>{
  const f=fixture(),consumer=createRemoteActionConsumer({clock:()=>0}),prior={playerId:'other',attackerId:'third',epoch:0,pose:{x:0,y:0,z:0}};
  f.victim.x=30;consumer.rememberVictim(f.sim,'victim',1,3);f.victim.x=500;
  const before=structuredClone(f.victim);f.sim.receiverContactGeometry=prior;let calls=0;
  const check=f.sim.checkCharacterAttack.bind(f.sim);
  f.sim.checkCharacterAttack=a=>{calls++;assert.equal(f.sim.actor('victim'),f.victim);assert.equal(f.sim.receiverContactGeometry.playerId,'victim');
    assert.equal(f.sim.contactGeometry(f.victim,a).x,30);if(throws)throw Error('controlled collision callback failure');return check(a,a.animationTime,a.animationTime);};
  const report=encodeOwnedState(f.sim,'source',{epoch:1,frameSeq:6}),action=encodeCriticalAction(report,{id:6,
    targetViews:[{playerId:'victim',epoch:1,frameSeq:3,position:[30,0,0]}]});
  assert.equal(consumer.receive('source',[action],1,6),true);
  if(throws)assert.throws(()=>consumer.consume(f.sim,'victim',()=>1),/controlled collision callback failure/);else consumer.consume(f.sim,'victim',()=>1);
  assert.equal(calls,1);assert.equal(f.sim.actor('victim'),f.victim);assert.deepEqual(f.victim,before);assert.equal(f.sim.receiverContactGeometry,prior);
});

test('selected remote effect collision retains the full local scene for actual received-hit cleanup without ticking a local attack',()=>{
  const f=fixture(),sampled=[];f.sim.receiverContactGeometry=f.scope;
  f.sim.effectSampler=effect=>{sampled.push(effect.id);return [shape];};
  const create=(owner,position,deleteConditions=[])=>{
    const effect=f.sim.createEffect(owner,{NAME:'RAVEN_MAXIMUM_CANNON'},
      {clock:'custom',birthAnchor:{position,facing:1},deleteConditions});
    assert.ok(effect);Object.assign(effect,{active:true,dead:false,elapsed:.1,animationTime:.1,setElapsed:.1});return effect;
  };
  const remote=create(f.source,[30,0,0]),local=create(f.victim,[0,0,0],[1]);
  const hp=f.victim.hp,localClock=local.elapsed;
  f.sim.drainEvents();f.sim.tickEffects(0,[remote]);
  assert.deepEqual(sampled,[remote.id],'the selection never runs the local attack sampler');
  assert.ok(f.victim.hp<hp);assert.equal(local.elapsed,localClock);assert.equal(local.hitCount,0);assert.deepEqual(local.hits,{});
  assert.equal(local.dead,true,'the real received-hit hook can still find the local damage-react effect');
  assert.equal(local.endEmitted,true);assert.ok(!f.sim.state.effects.includes(local));
  assert.equal(f.sim.state.events.filter(event=>event.type==='effectEnded'&&event.effectId===local.id).length,1);
  assert.ok(f.settled.some(row=>row.actor===f.victim));
});

test('an empty selection still cleans and emits the end of a dead unselected scene effect once',()=>{
  const f=fixture(),definition=profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT1;
  const effect=f.sim.createEffect(f.victim,structuredClone(definition),{setName:'EffectSet_RAVEN_HYPER_AURA',clock:'custom'});
  assert.ok(effect);effect.dead=true;effect.endReason='explicit-local-retirement';let sampled=0;
  f.sim.effectSampler=()=>{sampled++;return [shape];};f.sim.drainEvents();
  f.sim.tickEffects(0,[]);f.sim.tickEffects(0,[]);
  assert.equal(sampled,0);assert.ok(!f.sim.state.effects.includes(effect));assert.equal(effect.endEmitted,true);
  assert.equal(f.sim.state.events.filter(event=>event.type==='effectEnded'&&event.effectId===effect.id).length,1);
});

test('a delayed canonical birth retains the real receiving-owner hit of an unbound predicted collider',()=>{
  const f=fixture(),consumer=createRemoteActionConsumer({clock:()=>0});f.victim.x=30;
  f.sim.effectSampler=()=>[shape];f.sim.state.time=1;
  const effect=f.sim.createEffect(f.source,structuredClone(profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),
    {setName:'EffectSet_RAVEN_HYPER_AURA',clock:'custom',start:0});
  Object.assign(effect,{active:true,dead:false,elapsed:.1,animationTime:.1,setElapsed:.1});
  assert.equal(effect.networkId,undefined);assert.equal(effect.damage.DAMAGE_DATA.HIT_GAP,2.5);
  consumer.bind(f.sim,'victim',()=>1);const hp=f.victim.hp;
  f.sim.tickEffects(0,[effect]);assert.ok(f.victim.hp<hp);assert.equal(effect.hits.victim,1);assert.equal(effect.hitGaps.victim,2.5);
  const nativeMemory=structuredClone(effect.sourceHitMemory2016);
  assert.equal(nativeMemory.length,1);assert.equal(nativeMemory[0].remaining,2.5);
  const once=f.victim.hp,report=encodeOwnedState(f.sim,'source',{epoch:1,frameSeq:6});
  assert.equal(Object.hasOwn(report.effects[0],'hits'),false,'the wire supplies no hit receipt');
  const action=encodeCriticalAction(report,{id:6});assert.equal(consumer.receive('source',[action],1,6),true);
  consumer.consume(f.sim,'victim',()=>1);
  assert.equal(f.victim.hp,once,'strict claim preserves the accepted local receipt instead of hitting twice at the same clock');
  assert.deepEqual(effect.sourceHitMemory2016,nativeMemory,'the predicted collider keeps the locally accepted native record');
  assert.equal(effect.networkId,undefined,'temporary history never installs an older body');
  f.sim.state.time=3.499;f.sim.tickEffects(0,[effect]);assert.equal(f.victim.hp,once);
  f.sim.state.time=3.5;f.sim.tickEffects(0,[effect]);assert.equal(f.victim.hp,once,'wall-clock changes cannot age a native record at effect dt0');
  f.sim.tickEffects(2,[effect]);assert.equal(f.victim.hp,once);assert.equal(effect.sourceHitMemory2016[0].remaining,.5);
  f.sim.state.time=4;f.sim.tickEffects(.5,[effect]);assert.ok(f.victim.hp<once,'2.5s of actual carrier delta permits the next valid repeat');
});

test('selected historical black-hole damage cannot replace the real owners queued live physics packet with a zero vector',()=>{
  const f=fixture();Object.assign(f.victim,{x:30,y:0,invincible:true,blackHoleDisplacement:[7,8,9],sourceBlackHoleCanPass:false});
  const effect=f.sim.createEffect(f.source,{NAME:ION_BLACK_HOLE_NAME},{clock:'custom',birthAnchor:{position:[0,0,0],facing:1}});
  assert.ok(effect.damage.BLACKHOLE_DATA);Object.assign(effect,{active:true,skillId:24007,elapsed:.1,animationTime:.1,setElapsed:.1});
  effect.hits.victim=f.sim.state.time;f.sim.effectSampler=()=>[shape];const hp=f.victim.hp;
  f.sim.tickEffects(0,[effect]);assert.equal(f.victim.hp,hp);
  assert.deepEqual(f.victim.blackHoleDisplacement,[7,8,9]);assert.equal(f.victim.sourceBlackHoleCanPass,false);
  f.sim.tickEffects(1/60,[effect]);assert.notDeepEqual(f.victim.blackHoleDisplacement,[7,8,9],'normal elapsed-time physics still updates the sourced black-hole packet');
});
