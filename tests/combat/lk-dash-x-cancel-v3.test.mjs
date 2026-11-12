import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {lordKnightCommands} from '../../packages/combat-core/lk-commands.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const source='ESSI_DASH_ATTACK_X';
const actor=(time,facing)=>({state:source,animationTime:time,stateTime:time,grounded:true,facing,vx:0,vy:0,y:0,
 passiveSpeed:{x:0,y:0},sourceCommandFlags:0,awakening:{orbs:3,remaining:0}});
const keys=(held,pressed=[])=>({held:new Set(held),pressed:new Set(pressed)});
// .666 is an independent target2016 EVENT_PROCESS_TIME1 declaration. The
// consumer is a qualified fixed-source/target-table binding, not a client trace.
for(const facing of [-1,1])for(const key of ['LEFT','RIGHT','UP','DOWN','Z','A','S','D','C','Q','W','E','R'])test(`66X ${facing}/${key}: strict target skip boundary accepts a still-held key`,()=>{
 for(const [time,changed] of [[.66599,false],[.666,false],[.66601,true]]){
  const r=lordKnightCommands.runEvent(actor(time,facing),keys([key]),profile);
  assert.equal(r.state,changed?'RSI_WAIT':null);
 }
});
test('66X keeps original X branch priority, input window, and no-input recovery',()=>{
 const early=lordKnightCommands.runEvent(actor(.1,1),keys(['X'],['X']),profile);assert.equal(early.flags,0);
 const accepted=lordKnightCommands.runEvent(actor(.4,1),keys(['X'],['X']),profile);assert.equal(accepted.flags,1);
 const next=actor(.667,1);next.sourceCommandFlags=accepted.flags;
 assert.equal(lordKnightCommands.runEvent(next,keys(['X']),profile).state,'ESSI_ELK_DASH_COMBO_XChargeX');
 assert.equal(lordKnightCommands.runEvent(actor(.667,1),keys([]),profile).state,null);
 assert.equal(lordKnightCommands.runEvent(actor(1.01,1),keys([]),profile).state,'RSI_WAIT');
});
for(const facing of [-1,1])test(`actual 66X input ${facing} accepts a jump held before skip, then leaves recovery`,()=>{
 const sim=createSimulation({profile,preset:{guildPassives:[],doubleTapWindowSeconds:.4,loadout:Array(8).fill(null)},
  map:{sceneId:'dash-x-source-input-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},
  actors:[{id:'lk',professionId:'LK',team:0,position:[0,0,0],lineId:0,facing}]});
 const a=sim.actor('lk'),b=createInputBuffer(),forward=facing>0?'RIGHT':'LEFT';
 const step=()=>sim.step(1/60,{lk:b.consume(sim.state.time+1/60)});
 const tap=k=>{b.tap(k,sim.state.time+.001);step();};tap(forward);b.down(forward,sim.state.time+.001);step();tap('X');
 assert.equal(profile.states[a.state].sourceState,source);b.up(forward,sim.state.time+.001);
 for(let n=0;n<120&&a.animationTime<.5;n++)step();b.down('UP',sim.state.time+.001);step();
 assert.equal(profile.states[a.state].sourceState,source);
 for(let n=0;n<20&&profile.states[a.state].sourceState===source;n++)step();
 assert.equal(a.state,'RSI_WAIT');assert.ok(a.animationTime<.7);
 step();assert.equal(a.state,'RSI_JUMP_UP');assert.ok(a.vy>0);
});
