import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
for(const formed of [false,true])test(`DE668XZZ recovers gravity after its original controller ends, formation ${formed}`,()=>{
 const {sim,a,b}=originalAddFixture('DE');a.sourceAdd.formation=formed;a.sourceAdd.dp=8000;a.y+=500;a.grounded=false;a.lineId=null;b.x=2000;
 sim.enter(a,'ANSI_ADE_DASH_JUMP_COMBO_XZZ','player-air-freeze-case');
 for(let i=0;i<180;i++)sim.step(1/60,{});
 assert.notEqual(a.state,'ANSI_ADE_DASH_JUMP_COMBO_XZZ');assert.equal(a.grounded,true);assert.ok(a.y<3300);
 assert.ok(sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='RSI_JUMP_DOWN'));
});
