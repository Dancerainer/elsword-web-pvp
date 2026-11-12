/** Typed ownership-boundary tests. Source guards are explicit fixture inputs;
 * these synthetic contacts are distinct from original-pose trajectory tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/add-moonlight-explosions-v45.json' with {type:'json'};
import {rememberAddMoonlightOrigins,finalizeAddMoonlightContact,receiveAddMoonlightNotice,flushAddMoonlightNotices,validateAddMoonlightNotice} from '../../packages/combat-core/add-moonlight-receipts-v45.mjs';
const buff=stack=>({templateId:439,factorId:477,accumulationCount:stack,sourceActorId:'debuffer',behaviors:[{kind:'sourceCallback',type:43}],finalizers:[{kind:'time',remaining:20}]});
function fixture(ownerId){
 const a={id:'attacker',professionId:'RF',team:0,hp:100,mp:30,sourceAdd:{dp:4000,mutation:2,formation:false},state:'attack',stateSerial:7,facing:1,skillId:null,skillScale:1,x:0,y:0,z:0};
 const b={id:'recipient',team:1,hp:100,mp:50,buffs:[buff(3)]},events=[];
 const effect={id:10,ownerId:a.id,ownerStateSerial:7,damage:{DAMAGE_DATA:{DAMAGE:{PHYSIC:1},REACT_TYPE:1}},skillId:null};
 const sim={networkOwnerId:ownerId,observationOnly:false,networkEpochFor:()=>1,map:{bounds:{min:[-1000,-1000,-1000],max:[1000,1000,1000]}},
  state:{step:20,effects:[effect],actors:[a,b],nextEffectId:11},profileFor:()=>({...source,states:{attack:{raw:{DAMAGE_DATA:{DAMAGE:{PHYSIC:1},REACT_TYPE:1}}}}}),
  emit:(type,id,data)=>events.push({type,id,...data}),note(){},
  createEffect(actor,definition,options){const e={id:this.state.nextEffectId++,ownerId:actor.id,ownerStateSerial:actor.stateSerial,skillId:actor.skillId,powerMultiplier:actor.skillScale,definition,...options};this.state.effects.push(e);return e;}};
 return {sim,a,b,effect,events};
}
const effectOrigin={kind:'effect',id:10,impactPoint:[50,100,0]},options={sourceGuardsPassed:true,power:1,hyperMode:false};
test('recipient consumes only its439 and attacker later creates the original attack after a typed receipt, with no peer resource mutation',()=>{
 const receiver=fixture('recipient'),attacker=fixture('attacker');rememberAddMoonlightOrigins(attacker.sim,attacker.a);
 const foreign=structuredClone(receiver.a);
 assert.equal(finalizeAddMoonlightContact(receiver.sim,receiver.a,receiver.b,{},effectOrigin,options),true);
 assert.deepEqual(receiver.a,foreign);assert.equal(receiver.sim.state.effects.length,1);assert.equal(receiver.b.buffs.length,0);
 const notice=receiver.b.sourceAddMoonlightNotice;assert.doesNotMatch(JSON.stringify(notice),/power|damage|\bmp\b|\bhp\b/i);
 const targetBefore=structuredClone(attacker.b),resources=structuredClone(attacker.a);
 assert.equal(receiveAddMoonlightNotice(attacker.sim,attacker.b,1,notice,{powerFor:()=>1}),true);
 assert.deepEqual(attacker.b,targetBefore);assert.deepEqual(attacker.a,resources);assert.equal(attacker.sim.state.effects.at(-1).ownerId,'attacker');
 assert.equal(receiveAddMoonlightNotice(attacker.sim,attacker.b,1,notice,{powerFor:()=>1}),false);assert.equal(attacker.sim.state.effects.length,2);
});
test('the same persistent effect can trigger a new stack application, while restored snapshots cannot replay a consumed receipt',()=>{
 const r=fixture('recipient'),a=fixture('attacker');rememberAddMoonlightOrigins(a.sim,a.a);
 finalizeAddMoonlightContact(r.sim,r.a,r.b,{},effectOrigin,options);receiveAddMoonlightNotice(a.sim,a.b,1,r.b.sourceAddMoonlightNotice,{powerFor:()=>1});
 r.b.buffs=[buff(1)];assert.equal(finalizeAddMoonlightContact(r.sim,r.a,r.b,{},effectOrigin,options),true);
 assert.equal(receiveAddMoonlightNotice(a.sim,a.b,1,r.b.sourceAddMoonlightNotice,{powerFor:()=>1}),true);assert.equal(a.sim.state.effects.length,3);
 const restored=fixture('attacker');restored.sim.state=structuredClone(a.sim.state);
 assert.equal(receiveAddMoonlightNotice(restored.sim,restored.sim.state.actors[1],1,r.b.sourceAddMoonlightNotice,{powerFor:()=>1}),false);
 assert.equal(restored.sim.state.effects.length,3);
});
test('a real declared character state has a separate origin proof from effect IDs',()=>{
 const r=fixture('recipient'),a=fixture('attacker');rememberAddMoonlightOrigins(a.sim,a.a);
 const origin={kind:'character',id:'state-7',state:'attack',impactPoint:[0,100,0]};
 assert.equal(finalizeAddMoonlightContact(r.sim,r.a,r.b,{},origin,options),true);
 const receipt=r.b.sourceAddMoonlightNotice.receipts[0];assert.equal(receipt.effectId,0);assert.equal(receipt.state,'attack');
 assert.equal(receiveAddMoonlightNotice(a.sim,a.b,1,r.b.sourceAddMoonlightNotice,{powerFor:()=>({power:1,hyperMode:false})}),true);
});
test('missing native guard, unknown origin, malformed receipt and unproved/old-life/expired histories never create an explosion',()=>{
 const r=fixture('recipient');assert.equal(finalizeAddMoonlightContact(r.sim,r.a,r.b,{},effectOrigin,{}),false);
 assert.equal(finalizeAddMoonlightContact(r.sim,r.a,r.b,{}, {...effectOrigin,id:99},options),false);
 assert.equal(r.b.buffs.length,1);finalizeAddMoonlightContact(r.sim,r.a,r.b,{},effectOrigin,options);
 const notice=r.b.sourceAddMoonlightNotice;
 for(const alter of [n=>n.receipts[0].power=999,n=>n.receipts[0].stack=4,n=>n.receipts[0].position[0]=NaN,n=>n.receipts[0].effectId=0]){
  const bad=structuredClone(notice);alter(bad);assert.throws(()=>validateAddMoonlightNotice(bad),TypeError);
 }
 for(const kind of ['missing','life','retired','old-sender','position']){
  const a=fixture('attacker');if(kind!=='missing')rememberAddMoonlightOrigins(a.sim,a.a);
  if(kind==='life')a.sim.networkEpochFor=()=>2;
  if(kind==='retired')a.sim.state.step+=241;
  if(kind==='old-sender')a.sim.state.localOwnerAddMoonlightReceipts={version:1,owners:[{playerId:'recipient',epoch:2,serial:1}]};
  const n=structuredClone(notice);if(kind==='position')n.receipts[0].position[0]=5000;
  assert.equal(receiveAddMoonlightNotice(a.sim,a.b,1,n,{powerFor:()=>1}),false);assert.equal(a.sim.state.effects.length,1);
 }
});
test('roster baselines defer receipts until epochs exist; failed baselines discard queued work',()=>{
 const r=fixture('recipient'),a=fixture('attacker');rememberAddMoonlightOrigins(a.sim,a.a);finalizeAddMoonlightContact(r.sim,r.a,r.b,{},effectOrigin,options);
 a.sim.deferAddTimeRingNotices=true;assert.equal(receiveAddMoonlightNotice(a.sim,a.b,1,r.b.sourceAddMoonlightNotice,{powerFor:()=>1}),false);
 delete a.sim.deferAddTimeRingNotices;flushAddMoonlightNotices(a.sim,{powerFor:()=>1});assert.equal(a.sim.state.effects.length,2);
 a.sim.pendingAddMoonlightNotices=[{senderId:'recipient',senderEpoch:1,notice:r.b.sourceAddMoonlightNotice}];
 flushAddMoonlightNotices(a.sim,{discard:true,powerFor:()=>{throw Error('discarded baseline');}});assert.equal(a.sim.pendingAddMoonlightNotices,undefined);
});
