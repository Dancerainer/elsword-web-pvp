/** Actual sampled input + project edge adapter + Garpai/native pose. No
 * original client execution or browser/GPU claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {recoverAddSecondUp} from '../../apps/web/add-second-up-input-v58.mjs';
const dt=1/60;
function run(id,facing,adapt){
 const {sim,a}=originalAddFixture(id),buffer=createInputBuffer({sampledLevels:true}),rows=[],events=[];
 function step(){const raw=buffer.consume(sim.state.time+dt),input=adapt?recoverAddSecondUp(raw,a):raw;
  sim.step(dt,{[a.id]:input},{snapshot:false});events.push(...sim.drainEvents());
  rows.push({state:a.state,serial:a.stateSerial,y:a.y,grounded:a.grounded,vy:a.vy,raw,input});}
 const edge=(key,on)=>{buffer[on?'down':'up'](key,sim.state.time+.001);step();};
 step();if(facing<0){edge('LEFT',true);edge('LEFT',false);}
 const initialY=a.y;edge('UP',true);assert.equal(a.state,'RSI_JUMP_UP');
 // Real release/second-down/release all occur before next fixed cutoff.
 const base=sim.state.time;buffer.up('UP',base+.002);buffer.down('UP',base+.005);buffer.up('UP',base+.008);step();
 const second=rows.at(-1);assert.deepEqual(second.raw.pressed,[]);assert.equal(second.raw.edges.filter(e=>e.key==='UP'&&e.down).length,1);
 edge('Z',true);edge('Z',false);for(let n=0;n<90;n++)step();
 return {sim,a,rows,events,second,initialY};
}
for(const id of ['LP','MM','DE'])for(const facing of [-1,1])test(`${id} ${facing}: low real88Z recovers coalesced secondUP without extra jump or changed jump speed`,()=>{
 const before=run(id,facing,false),after=run(id,facing,true);
 assert.equal(before.second.state,'RSI_JUMP_UP');assert.equal(after.second.state,'ANSI_LEVITATION_WAIT');
 assert.equal(before.second.input.pressed.includes('UP'),false);assert.deepEqual(after.second.input.pressed,['UP']);
 assert.equal(after.second.grounded,false);assert.ok(after.second.y-after.initialY>0&&after.second.y-after.initialY<108);
 assert.equal(after.rows.filter(r=>r.state==='RSI_JUMP_UP'&&r.raw.pressed.includes('UP')).length,1,'one actual initial jump');
 const states=after.events.filter(e=>e.type==='stateChanged'&&e.actorId===after.a.id).map(e=>e.state);
 assert.equal(states.filter(n=>n==='ANSI_LEVITATION_WAIT').length,1);assert.equal(states.filter(n=>n==='RSI_JUMP_COMBO_Z').length,1);
 assert.equal(states.filter(n=>n==='RSI_JUMP_UP').length,1,'recovered UP cannot be replayed after hover as a second jump');
 assert.equal(after.a.grounded,true);assert.ok(['RSI_WAIT','RSI_JUMP_LANDING'].includes(after.a.state));
 assert.equal(after.sim.profileFor(after.a).physics.JUMP_SPEED,before.sim.profileFor(before.a).physics.JUMP_SPEED);
 assert.equal(after.a.sourceAddMovement.levitationAvailable,true,'actual landing restores original eligibility');
});
