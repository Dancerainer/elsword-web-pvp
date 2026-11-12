/** v32 control identities in the real source-event producer. Table-based
 * signature tests do not claim Native execution; no synthetic damage table
 * or collision function is installed. Root runs this suite serially. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createCombatPlaybackProducer,combatPlaybackEffectSignature} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const map={sceneId:'playback-v32-controls',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const parentName='DamageEffect_ADD_Dividing_Missile_Dynamo_DA';
const plain={id:1,name:'DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA',skillId:29209,
  sourceAddFissionSplit:{parentName,member:'DIE_DAMAGE_EFFECT0'},sourceAddMarkedDrone:{targetEpoch:1,unlockRemaining:.3},
  sourceAddLockOn:{targetId:'target',manualDirDegree:[1,0,0],useManualDir:false},
  sourceAddMaximumStrikeOrbit:{sphereIndex:0,targetEpoch:1,angle:0}};

test('v32 typed identities change the logical signature while unlock/angle/manual-steering frames do not',()=>{
  const effect=structuredClone(plain),base=combatPlaybackEffectSignature(effect);
  for(let frame=1;frame<=30;frame++){
    effect.sourceAddMarkedDrone.unlockRemaining=Math.max(0,.3-frame/60);
    effect.sourceAddMaximumStrikeOrbit.angle=frame/30;
    effect.sourceAddLockOn.manualDirDegree=[1-frame/60,frame/60,0];effect.sourceAddLockOn.useManualDir=true;
    assert.equal(combatPlaybackEffectSignature(effect),base);
  }
  for(const change of [e=>e.sourceAddFissionSplit.member='DIE_DAMAGE_EFFECT1',e=>e.sourceAddFissionSplit.parentName='DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA',
    e=>e.sourceAddMarkedDrone.targetEpoch=2,e=>e.sourceAddLockOn.targetId='other',e=>e.sourceAddMaximumStrikeOrbit.sphereIndex=1,
    e=>e.sourceAddMaximumStrikeOrbit.targetEpoch=2,e=>delete e.sourceAddMaximumStrikeOrbit,e=>delete e.sourceAddMarkedDrone]){
    const changed=structuredClone(plain);change(changed);assert.notEqual(combatPlaybackEffectSignature(changed),base);
  }
  const orb={...plain,sourceAddMaximumStrike:{index:0,group:10}};
  const orbBase=combatPlaybackEffectSignature(orb);orb.sourceAddMaximumStrike.index=1;
  assert.notEqual(combatPlaybackEffectSignature(orb),orbBase);
});

test('a real MM fission birth retains typed fields, canonical dead parent dependency and no repeated steering actions',()=>{
  const sim=createSimulation({profile,map,networkOwnerId:'source',actors:[
    {id:'source',professionId:'MM',team:0,position:[0,0,0],lineId:0,loadout:[{skillId:29209},...Array(7).fill(null)]},
    {id:'target',professionId:'MM',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const actor=sim.actor('source');actor.skillId=29209;
  const producer=createCombatPlaybackProducer({version:1});producer.capture(sim,'source',{epoch:1,frameSeq:1});
  const parent=sim.createEffect(actor,{NAME:parentName});parent.sourceAddMarkedDrone={targetEpoch:1,unlockRemaining:0};
  parent.sourceAddLockOn={targetId:'target',manualDirDegree:[1,0,0],useManualDir:false};
  const born=producer.capture(sim,'source',{epoch:1,frameSeq:2});assert.ok(born.effects.some(e=>e.id===parent.id));
  producer.beforeStep(sim,'source');parent.dead=true;
  const child=sim.createEffect(actor,{NAME:plain.name},{parentEffectId:parent.id});
  child.sourceAddFissionSplit={parentName,member:'DIE_DAMAGE_EFFECT0'};
  child.sourceAddMarkedDrone={targetEpoch:1,unlockRemaining:0};child.sourceAddLockOn={targetId:'target',manualDirDegree:[1,0,0],useManualDir:false};
  sim.state.effects=sim.state.effects.filter(e=>e!==parent);
  const action=producer.capture(sim,'source',{epoch:1,frameSeq:3});
  const childWire=action.effects.find(e=>e.id===child.id),parentWire=action.effects.find(e=>e.id===parent.id);
  assert.ok(childWire&&parentWire);assert.deepEqual(childWire.sourceAddFissionSplit,child.sourceAddFissionSplit);
  assert.equal(childWire.parentEffectId,parentWire.id);assert.equal(parentWire.dead,true);
  const report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:3});report.actions=[action];
  const validated=validateOwnedState(report);validateOwnedReferences(validated,actor,profile,map,{actors:sim.state.actors,profiles:sim.profiles});
  for(let frame=4;frame<20;frame++){
    child.elapsed+=1/60;child.animationTime+=1/60;child.sourceAddLockOn.manualDirDegree=[1-frame/100,frame/100,0];
    assert.equal(producer.capture(sim,'source',{epoch:1,frameSeq:frame}),null);
  }
});
