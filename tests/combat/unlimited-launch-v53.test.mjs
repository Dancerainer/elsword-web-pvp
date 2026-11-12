/** Explicit project rule: repeated UP/FLY keeps the authored height.
 * The source juggle counter remains observable; this is not a native trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelAuditFixture} from '../helpers/cancel-audit-fixture.mjs';
import {selectHitReaction,nextFlyCount} from '../../packages/combat-core/reaction-policy.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

for(const type of [4,5])test(`user V53 repeated reaction ${type} keeps authored Y speed through the third and later launches`,()=>{
 const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE:type,BACK_SPEED_X:100,BACK_SPEED_Y:1200,
  FORCE_FLY:0,FORCE_DOWN:0,NO_MISS:1,NO_CRITICAL:1,STOP_TIME_ATT:0,STOP_TIME_DEF:0};
 for(const count of [0,1,2,3,4,8,64]){
  const reaction=selectHitReaction(data,{flyCount:count,grounded:count===0});
  assert.equal(reaction.vy,1200);assert.equal(reaction.grounded,false);
 }
 const first=cancelAuditFixture('RF',{preset:{passives:[],guildPassives:[]}}),second=cancelAuditFixture('RF',{preset:{passives:[],guildPassives:[]}});
 const a=first.a,b=first.sim.actor('target');
 for(let index=1;index<=6;index++){
  const result=first.sim.applyHit(a,b,data,{kind:'character',powerMultiplier:1});
  assert.equal(result.accepted,true);assert.equal(b.flyCount,index);assert.equal(b.vy,1200);
  assert.equal(b.state,type===4?'RSI_DAMAGE_AIR_UP':'RSI_DAMAGE_AIR_FLY_FRONT');
  if(index===3){
   const snapshot=JSON.parse(JSON.stringify(first.sim.snapshot()));second.sim.restore(snapshot);
   const wire=validateOwnedState(encodeOwnedState(first.sim,b.id,{epoch:1,frameSeq:3}));
   validateOwnedReferences(wire,second.sim.actor(b.id),second.sim.profileFor(second.sim.actor(b.id)),second.map,{actors:second.sim.state.actors,profiles:second.sim.profiles});
   applyOwnedState(second.sim,b.id,wire);
   assert.equal(second.sim.actor(b.id).flyCount,3);
   const resumed=second.sim.applyHit(second.sim.actor(a.id),second.sim.actor(b.id),data,{kind:'character',powerMultiplier:1});
   assert.equal(resumed.accepted,true);assert.equal(second.sim.actor(b.id).vy,1200);
  }
 }
 assert.equal(nextFlyCount(8,{...data,FORCE_FLY:1}),0,'authored force-fly still resets the source counter');
 assert.equal(selectHitReaction(data,{flyCount:8,superArmor:true,vy:-17}).vy,-17,'armor still rejects ordinary launching');
});
