import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {ADD_PHANTOM_LOT8} from '../../packages/combat-core/add-mm-lot6-2016.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
test('normal MM Phantom Fire1/Fire2 actual input binds the recovered LOT8 consumer and owner state',()=>{
 const {sim,a,b,profile}=originalAddFixture('MM',{skillId:29015}),dt=1/60;a.mp=a.mpMax;
 const step=input=>sim.step(dt,input??{},{snapshot:false});
 for(let i=0;i<120&&!sim.skillAvailability(a.id,0).available;i++)step();
 assert.equal(sim.skillAvailability(a.id,0).available,true);step({add:{pressed:['A'],held:['A']}});
 let guided;
 for(let i=0;i<180&&!guided;i++){step();guided=sim.state.effects.find(e=>e.name===ADD_PHANTOM_LOT8&&e.sourceAddLot6?.targetId===b.id);}
 assert.ok(guided,'normal declared child enters the actual LOT8 candidate acquisition after its unlock gate');
 assert.ok(guided.setName.endsWith('Fire1')||guided.setName.endsWith('Fire2'));
 assert.equal(guided.damage.LOCK_ON_DATA.LOCK_ON_TYPE,8);assert.equal(guided.sourceAddLot6.started<=0,true);
 const report=validateOwnedState(JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:2,frameSeq:sim.state.step}))));
 validateOwnedReferences(report,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 assert.ok(report.effects.some(e=>e.id===guided.id&&e.sourceAddLot6?.targetId===b.id));
});
