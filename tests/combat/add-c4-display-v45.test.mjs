/** Actual C4 projectile/RT12 creates the authored three pairs of digits.
 * Source declaration clocks and native posed anchors remain independent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
for(const formed of [false,true])test(`C4 ${formed?'mutation':'normal'} actual3/2/1 layers retain target identity, follow movement and retire finitely`,()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29211});a.mp=a.mpMax;a.sourceAdd.dp=8000;
 if(formed){a.sourceAdd.formation=true;a.sourceAdd.mutation=3;sim.step(1/60,{});}
 const seen=new Set(),ids=[];
 for(let frame=0;frame<310;frame++){
  sim.step(1/60,{add:{pressed:frame===0?['A']:[],held:frame===0?['A']:[]}});
  for(const digit of [3,2,1]){
   if(seen.has(digit))continue;
   const name='ADD_Countdown_Bomb0'+digit,layers=sim.state.effects.filter(e=>e.active&&e.name.replace(/_D$/,'')===name&&e.setName?.startsWith('EffectSet_Countdown_Bomb_Trace'));
   if(layers.length!==2)continue;
   if(digit===3){
    const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:frame+1})));
    validateOwnedState(wire);validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
    const sent=wire.effects.filter(e=>layers.some(row=>row.id===e.id));assert.equal(sent.length,2);
    assert.ok(sent.every(e=>e.traceActorId===b.id));
    applyOwnedState(sim,a.id,wire);
   }
   seen.add(digit);ids.push(...layers.map(e=>e.id));const x=layers[0].currentAnchor.position[0];b.x+=100;
   for(let i=0;i<3;i++)sim.step(1/60,{});
   for(const e of layers){
    const live=sim.state.effects.find(row=>row.id===e.id);assert.ok(live,'active digit cannot retire before its one original particle lifetime');
    assert.equal(live.traceActorId,b.id);assert.ok(live.currentAnchor.position[0]>x+70,'recipient movement moves the digit, independent of caster');
   }
  }
 }
 assert.deepEqual([...seen],[3,2,1]);assert.equal(ids.length,6);
 assert.equal(sim.state.effects.some(e=>ids.includes(e.id)),false);
 assert.equal(sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId)).length,6);
});
