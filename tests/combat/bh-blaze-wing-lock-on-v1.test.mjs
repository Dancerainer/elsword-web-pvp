import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {selectBlazeWingTarget,advanceBlazeWingLockOn} from '../../packages/combat-core/bh-blaze-wing-lock-on.mjs';
const {elesisFixture}=await import(process.env.ELESIS_SKILL_FIXTURE?pathToFileURL(resolve(process.env.ELESIS_SKILL_FIXTURE)):
  new URL('../helpers/elesis-skill-fixture.mjs',import.meta.url));
const fixture=elesisFixture('BH');
test('zero-time historical collision probes never mutate lock decisions or history',()=>{
  for(const dt of [0,-1/60]){
    const effect={name:'DamageEffect_SBH_Blaze_Wing_Sub',damage:{LOCK_ON_DATA:{LOCK_ON_TYPE:6}},
      currentAnchor:{position:[0,0,0]},sourceBlazeWingLockOn:{targetId:null,selectionSerial:3,historySnapshot:['target']}};
    const sim={profileFor:()=>fixture.profile,state:{sourceBlazeWingPreviousTargets:['target'],sourceBlazeWingSelectionSerial:3}};
    const before=structuredClone({effect,state:sim.state});
    assert.equal(advanceBlazeWingLockOn(sim,effect,{},dt),true);
    assert.deepEqual({effect,state:sim.state},before);
  }
});
function make(distance=350){
  return fixture.make(28017,'none',{distance});
}
test('LOT6 target selection uses strict original PvP endpoints and shared exclusion reset',()=>{
  const owner={id:'owner',team:0},actor=(id,x,extra={})=>({id,x,y:0,z:0,team:1,hp:100,...extra});
  const actors=[actor('same',20,{team:0}),actor('dead',30,{hp:0}),actor('invincible',40,{invincible:true}),
    actor('zero',0),actor('edge',700),actor('first',100),actor('tie',100),actor('farther',500)],previous=[];
  assert.equal(selectBlazeWingTarget(actors,owner,[0,0,0],[0,700],previous).id,'first');
  assert.equal(selectBlazeWingTarget(actors,owner,[0,0,0],[0,700],previous).id,'tie');
  assert.equal(selectBlazeWingTarget(actors,owner,[0,0,0],[0,700],previous).id,'farther');
  assert.equal(selectBlazeWingTarget(actors,owner,[0,0,0],[0,700],previous),null);
  assert.deepEqual(previous,[]);
  assert.equal(selectBlazeWingTarget(actors,owner,[0,0,0],[0,700],previous).id,'first');
});
test('original Blaze Wing carrier steers through the native bridge and lands repeated real-geometry hits',()=>{
  const sim=make(),directions=[],hits=[];let selected=false;
  for(let step=0;step<260;step++){
    sim.step(1/60,step===0?{elesis:{pressed:['A']}}:{},{snapshot:false});
    for(const e of sim.state.effects)if(e.sourceBlazeWingLockOn){
      selected||=e.sourceBlazeWingLockOn.targetId==='target';
      if(e.sourceBlazeWingLockOn.useManualDir)directions.push([...e.sourceBlazeWingLockOn.manualDirDegree]);
    }
    hits.push(...sim.drainEvents().filter(e=>e.type==='hit'&&e.origin?.skillId===28017));
  }
  assert.ok(selected);assert.ok(directions.length>0);assert.ok(directions.some(v=>v.some(n=>Math.abs(n)>0)));
  assert.ok(hits.length>1,'homing source must land after the first straight pass');
});
test('a real remote Blaze Wing carrier only advances its owner mirror',()=>{
  const sim=make();sim.networkOwnerId='target';
  sim.state.sourceBlazeWingPreviousTargets=['target'];sim.state.sourceBlazeWingSelectionSerial=17;
  let selected=false,serial=0;
  for(let step=0;step<180;step++){
    sim.step(1/60,step===0?{elesis:{pressed:['A']}}:{},{snapshot:false});
    for(const effect of sim.state.effects)if(effect.sourceBlazeWingLockOn){
      selected||=effect.sourceBlazeWingLockOn.targetId==='target';
      serial=Math.max(serial,effect.sourceBlazeWingLockOn.selectionSerial);
    }
  }
  assert.ok(selected,'remote mirror selects independently of local exclusion history');
  assert.ok(serial>0);assert.ok(sim.state.sourceBlazeWingMirrors.elesis.serial>=serial);
  assert.deepEqual(sim.state.sourceBlazeWingPreviousTargets,['target']);
  assert.equal(sim.state.sourceBlazeWingSelectionSerial,17);
});

test('target death retargets using updated remote actor positions and exclusion state survives snapshot restore',()=>{
  const sim=make();let carrier;
  for(let step=0;step<110;step++){
    sim.step(1/60,step===0?{elesis:{pressed:['A']}}:{},{snapshot:false});
    carrier=sim.state.effects.find(e=>e.sourceBlazeWingLockOn?.targetId==='target');if(carrier)break;
  }
  assert.ok(carrier);
  const target=sim.actor('target'),second=structuredClone(target);second.id='remote-second';second.x=carrier.x+200;
  second.y=carrier.y;second.z=carrier.z;second.hp=second.hpMax;second.invincible=false;second.forceInvincible=0;
  sim.state.actors.push(second);target.hp=0;
  advanceBlazeWingLockOn(sim,carrier,sim.actor('elesis'),1/60);
  // A prior hit and death can cause both source branches to select in this
  // packet: the second selection excludes the just-selected unit and clears
  // the shared list. The next packet retries from the projectile position.
  if(carrier.sourceBlazeWingLockOn.targetId===null){
    assert.deepEqual(sim.state.sourceBlazeWingPreviousTargets,[]);
    advanceBlazeWingLockOn(sim,carrier,sim.actor('elesis'),1/60);
  }
  assert.equal(carrier.sourceBlazeWingLockOn.targetId,'remote-second');
  assert.ok(carrier.sourceBlazeWingLockOn.historySnapshot.includes('remote-second'));
  const snapshot=sim.snapshot();sim.state.sourceBlazeWingPreviousTargets=[];sim.restore(snapshot);
  assert.deepEqual(sim.state.sourceBlazeWingPreviousTargets,snapshot.sourceBlazeWingPreviousTargets);
  assert.equal(sim.state.sourceBlazeWingSelectionSerial,snapshot.sourceBlazeWingSelectionSerial);
});
