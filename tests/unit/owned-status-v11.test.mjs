/** Independent status contract with real Simulation and frozen Buff math.
 * These source-frame/container checks are not public network measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {createBuffFromFactor} from '../../packages/combat-core/buffs.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,applyOwnedState,encodeOwnedStatusSource,validateOwnedTargetViews} from '../../packages/online/owned-state.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {encodeOwnedStatus,validateOwnedStatus,validateOwnedStatusReferences,captureOwnedStatusActor,applyOwnedStatusActor,applyOwnedStatus} from '../../packages/online/owned-status.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const map={sceneId:'owned-status-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const make=owner=>createSimulation({profile,map,nativeSkillValues,networkOwnerId:owner,
  preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
  actors:[{id:'local',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'remote',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
function source({buff=true,frame=6}={}){
  const sim=make('remote'),actor=sim.actor('remote');
  if(buff)assert.ok(sim.grantBuff(actor,actor,18,1,null));
  const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame});
  report.actor={...report.actor,...createOwnerStatusClock().encode(encodeOwnedStatusSource(actor),1,frame).actor};
  return {sim,actor,report,status:encodeOwnedStatus(report)};
}

test('lightweight status source encodes only detached Buff and protection fields',()=>{
  const f=source(),before=structuredClone(f.actor),value=encodeOwnedStatusSource(f.actor);
  for(const key of ['x','state','hp','mp','skillContext','animationTime','core','sourceStatusClock'])assert.equal(Object.hasOwn(value,key),false);
  value.buffs[0].finalizers[0].remaining=0;assert.deepEqual(f.actor,before);
  assert.equal(f.status.protocol,'owner-status-v1');assert.equal(f.status.actor.superArmor,true);
});
test('legacy full reports and action samples retain their old keys while negotiated status supplies exact protection',()=>{
  const f=source({buff:false}),actor=f.actor;actor.forceInvincible=.5;actor.invincible=true;
  const legacy=encodeOwnedState(f.sim,'remote',{epoch:1,frameSeq:6});assert.equal(Object.hasOwn(legacy.actor,'forceInvincible'),false);
  const oldAction=encodeCriticalAction(legacy,{id:6});for(const key of ['sourceStatusClock','forceInvincible','invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed'])
    assert.equal(Object.hasOwn(oldAction.actor,key),false,key);
  Object.assign(legacy.actor,createOwnerStatusClock().encode(encodeOwnedStatusSource(actor),1,6).actor);
  const action=encodeCriticalAction(legacy,{id:6});assert.equal(action.actor.forceInvincible,.5);assert.equal(action.actor.invincible,true);
  assert.ok(action.actor.sourceStatusClock);assert.ok(validateOwnedState({...legacy,actions:[action]}));
});

test('status rejects pose/resource fields and future, malformed or unbounded source clocks',()=>{
  const f=source();for(const field of ['x','hp','mp','state','pressed']){
    const status=structuredClone(f.status);status.actor[field]=1;assert.throws(()=>validateOwnedStatus(status),/invalid-owner-status-actor/);
  }
  for(const patch of [{frameSeq:7},{revision:0},{version:2},{frameSeq:-1}]){
    const status=structuredClone(f.status);Object.assign(status.actor.sourceStatusClock,patch);assert.throws(()=>validateOwnedStatus(status),/owner-status-clock/);
  }
  const status=structuredClone(f.status);status.frameSeq=607;assert.throws(()=>validateOwnedStatus(status),/owner-status-clock-frame/);
});

test('status reuses source Buff identities, factor/template and recipient validation',()=>{
  const f=source(),actor=f.sim.actor('remote'),context={profiles:f.sim.profiles,actors:f.sim.state.actors};
  assert.equal(validateOwnedStatusReferences(f.status,actor,f.sim.profileFor(actor),context),true);
  for(const change of [buff=>buff.templateId=999,buff=>buff.factorId=70,buff=>buff.targetActorId='local',buff=>buff.sourceActorId='missing']){
    const status=structuredClone(f.status);change(status.actor.buffs[0]);
    assert.throws(()=>validateOwnedStatusReferences(status,actor,f.sim.profileFor(actor),context),/owner-buff/);
  }
});
test('the real LP Buff factor stores an exact binary32 DP gain accepted by shared status references',()=>{
  // This is a lightweight Buff/math fixture with the original numeric WASM,
  // not a full Native combat or public-network measurement.
  const lp=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
  const actor={id:'lp',professionId:'LP',profileId:lp.profileId,hp:5000,hpMax:10000,mp:100,mpMax:300,stateSerial:1,
    stats:{physicalAttack:2000,magicAttack:1500},buffResistances:{0:0,1:0},debuffDurationMultiplier:1};
  const result=createBuffFromFactor(lp,{factor:357,sourceActor:actor,targetActor:actor,skillLevel:1,roll:0,nativeValues:nativeSkillValues});
  assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.accepted,true);
  const raw=lp.buffFactors[357].raw.BEHAVIOR.BBT_CHANGE_HYPER_CHARGE_SPEED.PERCENT['1'],row=result.buff.behaviors.find(value=>value.kind==='addDpGain');
  assert.ok(row);assert.equal(row.value,Math.fround(raw));assert.notEqual(row.value,raw);
  const status=validateOwnedStatus({protocol:'owner-status-v1',epoch:1,frameSeq:6,
    actor:{buffs:[result.buff],invincible:false,superArmor:false,superArmorNotRed:true,sourceStatusClock:{version:1,revision:1,frameSeq:6}}});
  const context={actors:[actor],profiles:{LP:lp}};
  assert.equal(validateOwnedStatusReferences(status,actor,lp,context),true);
  for(const invalid of [raw,Math.fround(raw)+1e-9]){
    const rewritten=structuredClone(status);rewritten.actor.buffs[0].behaviors.find(value=>value.kind==='addDpGain').value=invalid;
    assert.throws(()=>validateOwnedStatusReferences(rewritten,actor,lp,context),/invalid-owner-add-dp-buff/);
  }
});

test('remote status advances only normal-time finalizers while force and white display stay exact',()=>{
  const f=source();Object.assign(f.status.actor,{forceInvincible:.5,showInvincible:{remaining:.4,swapRemaining:.02,white:true}});
  f.status.frameSeq=36;const receiving=make('local'),remote=receiving.actor('remote'),before=structuredClone(remote);
  let remaining=f.status.actor.buffs[0].finalizers[0].remaining;for(let i=0;i<30;i++)remaining=Math.fround(remaining-Math.fround(1/60));
  applyOwnedStatus(receiving,'remote',f.status);
  assert.equal(remote.buffs[0].finalizers[0].remaining,remaining);assert.equal(remote.forceInvincible,.5);
  assert.deepEqual(remote.showInvincible,f.status.actor.showInvincible);assert.equal(remote.superArmor,true);
  for(const field of ['x','y','z','hp','mp','state','stateSerial','animationTime','skillId','skillContext','pendingPressed','inputLock'])assert.deepEqual(remote[field],before[field],field);
});

test('a status is forbidden from applying to the local actor without any mutation',()=>{
  const f=source(),receiving=make('local'),before=structuredClone(receiving.state);
  assert.throws(()=>applyOwnedStatus(receiving,'local',f.status),/owner-status-cannot-apply-local|owner-buff-target/);
  assert.deepEqual(receiving.state,before);
  assert.throws(()=>applyOwnedStatusActor(receiving,'local',captureOwnedStatusActor(f.actor)),/owner-status-cannot-apply-local/);
  assert.deepEqual(receiving.state,before);
});

test('decoded status capture and restore neither redecode its timer nor retain absent optional flags',()=>{
  const f=source(),receiving=make('local'),remote=receiving.actor('remote');applyOwnedStatus(receiving,'remote',f.status);
  const saved=captureOwnedStatusActor(remote);assert.equal(Object.hasOwn(saved,'sourceStatusClock'),false);
  remote.buffs=[];remote.skillSuperArmorNotRed=true;applyOwnedStatusActor(receiving,'remote',saved);
  assert.equal(remote.buffs[0].finalizers[0].remaining,saved.buffs[0].finalizers[0].remaining);
  assert.equal(Object.hasOwn(remote,'skillSuperArmorNotRed'),false);
});

test('full owner application decodes the same Buff base once at its report source frame',()=>{
  const f=source(),receiving=make('local');f.report.frameSeq=36;applyOwnedState(receiving,'remote',validateOwnedState(f.report),{effects:false});
  let remaining=f.report.actor.buffs[0].finalizers[0].remaining;for(let i=0;i<30;i++)remaining=Math.fround(remaining-Math.fround(1/60));
  assert.equal(receiving.actor('remote').buffs[0].finalizers[0].remaining,remaining);
});

test('critical action status clocks are bounded by their captured frame, not the later body frame',()=>{
  const f=source();f.report.frameSeq=12;f.report.actions=[encodeCriticalAction(f.report,{id:9,frameSeq:9})];
  assert.ok(validateOwnedState(f.report));f.report.actions[0].actor.sourceStatusClock.frameSeq=10;
  assert.throws(()=>validateOwnedState(f.report),/owner-status-clock-frame/);
});

test('independent status has the existing full owner byte budget',()=>{
  const f=source(),status=structuredClone(f.status);status.actor.buffs=Array.from({length:400},()=>structuredClone(f.status.actor.buffs[0]));
  assert.throws(()=>validateOwnedStatus(status),/owner-status-too-large/);
});

test('body push witnesses name only a strict subset of their confirmed source frames',()=>{
  const view={playerId:'local',epoch:1,frameSeq:3,position:[0,0,0],positionSamples:[{frameSeq:3,weight:.5},{frameSeq:6,weight:.5}],bodyPushFrames:[3,6]};
  assert.ok(validateOwnedTargetViews([view]));for(const frames of [[],[3,3],[6,3],[4],[-1],[3,6,9,12,15]]){
    assert.throws(()=>validateOwnedTargetViews([{...view,bodyPushFrames:frames}]),/body-push-witness/);
  }
});
