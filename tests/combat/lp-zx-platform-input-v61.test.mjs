import test from 'node:test';
import assert from 'node:assert/strict';
import {lpPlatformInput} from '../helpers/lp-platform-input-v61.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const settlement=f=>f.sim.state.events.filter(e=>e.type==='lpZxTierSettled');
for(const side of [1,-1])test(`real66/8/Z/X accepted victim on Garpai side${side} settles onto that supported tier`,()=>{
 const f=lpPlatformInput({side});f.until(160);
 assert.ok(f.packets.some(p=>p.pureDouble.includes(side===1?'RIGHT':'LEFT')));
 for(const n of ['ANSI_DASH','ANSI_DASH_JUMP','ANSI_DASH_JUMP_COMBO_Z','ANSI_APT_DASH_JUMP_COMBO_ZX'])assert.ok(f.trace.some(r=>r.state===n),n);
 const land=f.trace.find(r=>r.state==='ANSI_APT_DASH_JUMP_COMBO_ZX_LANDING');assert.ok(land);
 assert.equal(settlement(f).length,1);assert.equal(settlement(f)[0].targetId,f.b.id);
 assert.equal(land.position[1],3320);assert.equal(land.lineId,f.line);assert.equal(f.a.y,3320);
 assert.equal(f.a.sourceAddCombat.lpZxTarget,undefined,'consumed once');
 assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.targetId===f.b.id&&e.amount>0));
});
test('real unhit third-tier3560 gesture retains original descent, without search or automatic attraction',()=>{
 const f=lpPlatformInput({unhit:true});f.until(160);
 assert.ok(f.trace.some(r=>r.state==='ANSI_APT_DASH_JUMP_COMBO_ZX'));
 assert.equal(f.b.hp,f.b.hpMax);assert.equal(settlement(f).length,0);assert.equal(f.a.y,3080);
});
test('a genuinely hit target which leaves its support before X does not provide an arbitrary air anchor',()=>{
 const f=lpPlatformInput();f.until(22);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 Object.assign(f.b,{grounded:false,lineId:null,y:3450,vy:600});f.until(160);
 assert.equal(settlement(f).length,0);assert.equal(f.a.y,3080);assert.equal(f.a.sourceAddCombat.lpZxTarget,undefined);
});
test('an already-above-tier caster keeps the original dive instead of teleporting early',()=>{
 const f=lpPlatformInput();f.until(22);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 f.a.y=3500;f.a.vy=0;f.until(160);assert.equal(settlement(f).length,0);
 assert.ok(f.trace.some(r=>r.state==='ANSI_APT_DASH_JUMP_COMBO_ZX'));
});
for(const who of ['add','target'])test(`capture cannot cross ${who} life epoch`,()=>{
 const f=lpPlatformInput({epochs:true});f.until(22);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 f.lives[who]++;f.until(160);assert.equal(settlement(f).length,0);assert.equal(f.a.y,3080);
});
test('actual acceptedZ capture survives snapshot and identical physical continuation deterministically',()=>{
 const f=lpPlatformInput({epochs:true});f.until(22);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 const snapshot=JSON.parse(JSON.stringify(f.sim.snapshot())),g=lpPlatformInput({epochs:true});
 g.primeDevice(22);g.sim.restore(snapshot);f.until(160);g.until(160);
 assert.deepEqual(g.sim.snapshot(),f.sim.snapshot());assert.equal(settlement(g).length,1);
});
test('leaving the original adjacent command record clears the capture before any later ZX entry',()=>{
 const f=lpPlatformInput();f.until(22);assert.ok(f.a.sourceAddCombat.lpZxTarget);
 f.sim.enter(f.a,'RSI_WAIT','explicit-command-interruption-fixture');assert.equal(f.a.sourceAddCombat.lpZxTarget,undefined);
 f.sim.enter(f.a,'ANSI_APT_DASH_JUMP_COMBO_ZX','later-unrelated-X-fixture');assert.equal(settlement(f).length,0);
});
test('captured identity is bounded in owned/critical packets and validates owner life, original command state and target',()=>{
 const f=lpPlatformInput({epochs:true});f.until(22);
 const packet=encodeOwnedState(f.sim,'add',{epoch:1,frameSeq:22});assert.ok(packet.actor.sourceAddCombat.lpZxTarget);
 const refs=p=>validateOwnedReferences(p,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:{LP:f.profile}});
 validateOwnedState(packet);refs(packet);
 const action=encodeCriticalAction(packet,{id:1,effectIds:new Set()});assert.deepEqual(action.actor.sourceAddCombat.lpZxTarget,packet.actor.sourceAddCombat.lpZxTarget);
 validateOwnedState({...packet,actions:[action]});
 for(const patch of [{ownerEpoch:2},{stateSerial:f.a.stateSerial+1},{targetId:'missing'},{targetId:'add'}]){
  const p=structuredClone(packet);Object.assign(p.actor.sourceAddCombat.lpZxTarget,patch);assert.throws(()=>refs(p),/lp-zx/);
 }
 for(const patch of [{extra:1},{targetEpoch:-1}]){const p=structuredClone(packet);Object.assign(p.actor.sourceAddCombat.lpZxTarget,patch);assert.throws(()=>validateOwnedState(p));}
 const stale=structuredClone(packet);stale.actor.state='RSI_WAIT';assert.throws(()=>refs(stale),/lp-zx/);
});
