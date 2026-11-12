/** Expectations come from original Manager49/79 and XXZZ2/8 source gates.
 * Pure input/command contracts; not an original-device or recomputation run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
const LOOP='ANSI_COMBO_XXZZ_LOOP',FINISH='ANSI_COMBO_XXZZ_FINISH';
const profile={states:{[LOOP]:{sourceState:LOOP,raw:{},clip:{durationSeconds:.2}},[FINISH]:{sourceState:FINISH,raw:{},clip:{durationSeconds:1}}},stateAliases:{},referenceSemantics:{lineRadius:30}};
const actor=id=>({id:'a',professionId:id,state:LOOP,stateSerial:1,animationTime:0,animationStopped:false,grounded:true,facing:1,
 y:3080,vx:0,vy:0,passiveSpeed:{x:-1,y:-1},sourceCommandFlags:0,sourceAddCombat:{xxzzLoops:0}});
const keys=p=>({...p,held:new Set(p.held),pressed:new Set(p.pressed)});
function cycle(a,packet){
 a.animationTime=.02;const latch=addCommands.runEvent(a,keys(packet),profile);a.sourceCommandFlags=latch.flags;
 a.animationStopped=true;a.animationTime=.2;const end=addCommands.runEvent(a,keys({...packet,pressed:[]}),profile);
 a.state=end.state;a.stateSerial++;a.animationTime=0;a.animationStopped=false;a.sourceCommandFlags=0;addCommands.runStart(a,profile);return end.state;
}
test('continuous sampled held Z produces one Manager once result, without keyboard-repeat rearming',()=>{
 const input=createSampledKeyboardBuffer();input.down('Z',.001);
 let pressed=0;
 for(let frame=0;frame<180;frame++){
  if(frame)assert.equal(input.down('Z',frame/60+.001),false);
  const p=input.consume((frame+1)/60);assert.ok(p.held.includes('Z'));pressed+=Number(p.pressed.includes('Z'));
 }
 assert.equal(pressed,1);
 input.up('Z',3.001);assert.ok(input.consume(3.02).released.includes('Z'));
 input.down('Z',3.03);assert.ok(input.consume(3.04).pressed.includes('Z'));
});
for(const id of ['LP','MM','DE'])test(`${id}: an already-held Z crosses state entries without rearming oneZ; original minimum still sustains two loops`,()=>{
 const input=createSampledKeyboardBuffer();input.down('Z',.001);assert.ok(input.consume(.02).pressed.includes('Z'));
 const a=actor(id);let loops=0;
 while(a.state===LOOP){const p=input.consume(.04+loops*.25);assert.deepEqual(p.pressed,[]);cycle(a,p);loops++;assert.ok(loops<=9);}
 assert.equal(loops,2);assert.equal(a.state,FINISH);
});
for(const id of ['LP','MM','DE'])test(`${id}: real release/repress once samples extend only through the original ninth loop`,()=>{
 const input=createSampledKeyboardBuffer(),a=actor(id);let loops=0;
 while(a.state===LOOP){const t=loops*.25;input.down('Z',t+.001);const p=input.consume(t+.02);assert.ok(p.pressed.includes('Z'));
  input.up('Z',t+.03);input.consume(t+.04);cycle(a,p);loops++;assert.ok(loops<=9);}
 assert.equal(loops,9);assert.equal(a.state,FINISH);
});
test('once is not a physical-press count: explicitly replayed old sampled packet can relatch subsequent consumer records',()=>{
 const input=createSampledKeyboardBuffer(),a=actor('LP');input.down('Z',.001);const saved=input.consume(.02);assert.ok(saved.pressed.includes('Z'));
 let loops=0;while(a.state===LOOP){cycle(a,saved);loops++;assert.ok(loops<=9);}
 assert.equal(loops,9);
 assert.deepEqual(input.consume(3).pressed,[],'The device itself still emitted only the initial once');
 // This deliberate consumer fixture demonstrates the source distinction.
 // It does not claim the original runtime actually schedules this replay.
});
