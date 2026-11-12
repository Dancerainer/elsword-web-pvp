import test from 'node:test';
import assert from 'node:assert/strict';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';
test('original target charge completes near one second including startup, fires feedback once and cannot hold forever',async()=>{
 const sim=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[8500,2840,0]]}),actor=sim.actor('rf');actor.mp=300;
 const events=[];sim.step(1/60,{pressed:['A'],held:['A']});
 let fullAt=null,releasedAt=null,elapsedAtFull=null;
 for(let i=0;i<360;i++){
  sim.step(1/60,{held:['A']},{snapshot:false});const next=sim.drainEvents();events.push(...next);
  if(next.some(e=>e.type==='sound'&&e.name==='Raven_WildCharge_ChargeFull.ogg')){fullAt=(i+1)/60;elapsedAtFull=actor.sourceWildCharge.elapsed;}
  if(actor.state==='RSI_SA_RRF_WILD_CHARGE_DASH'){releasedAt=(i+1)/60;break;}
 }
 assert.ok(fullAt!==null&&elapsedAtFull>=.75&&elapsedAtFull<.78,`charge segment ${elapsedAtFull}; full at ${fullAt}`);
 assert.ok(releasedAt!==null&&releasedAt>fullAt&&releasedAt<5,`release at ${releasedAt}`);
 assert.equal(events.filter(e=>e.type==='sound'&&e.name==='Raven_WildCharge_ChargeFull.ogg').length,1);
 assert.ok(events.some(e=>e.type==='originalSkillCommand'&&e.name==='EffectSet_WILD_CHARGE_MAX'));
});
