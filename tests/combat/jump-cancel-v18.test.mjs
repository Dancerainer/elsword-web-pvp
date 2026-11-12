import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freeAirInputDirection} from '../../packages/combat-core/air-direction.mjs';
import {dashZxFixture,dashZxFrame as frame} from '../helpers/authored-command-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {observeJumpPrefix} from '../helpers/authored-command-fixture.mjs';
const source=JSON.parse(readFileSync(new URL('../../reports/rf-jump-consumer-source-v18.json',import.meta.url)));
function device(f){const b=createInputBuffer();return {b,step(){frame(f,b.consume(f.s.state.time+1/60));},
 tap(k){b.tap(k,f.s.state.time+.001);this.step();},down(k){b.down(k,f.s.state.time+.001);this.step();}};}
async function dashJump(facing){const f=await dashZxFixture({facing,gap:1500}),d=device(f),fw=facing===1?'RIGHT':'LEFT';
 d.tap(fw);d.down(fw);d.tap('UP');for(let i=0;i<5;i++)d.step();assert.equal(f.a.state,'RSI_DASH_JUMP');return {f,d,fw,bk:facing===1?'LEFT':'RIGHT'};}
test('unchanged independent free-air consumers retain pending facing and raw Z priority',()=>{
 assert.equal(source.assertionsPassed,20);assert.equal(source.targetClientMeasured,false);assert.equal(source.fragments.length,7);
 for(const facing of [-1,1]){
  const rows=source.cases.filter(c=>c.facing===facing);
  assert.equal(rows.find(c=>c.case==='jump-future-overlap').afterFacing,1);
  assert.equal(rows.find(c=>c.case==='dash-jump-future-overlap').vx,1334);
  assert.equal(rows.find(c=>c.case==='dash-jump-reverse-down').afterFacing,facing);
  assert.equal(rows.find(c=>c.case==='dash-jump-reverse-down-z').requested,17);
 }
});
test('opposite pure-key priority is scoped to the three source-owned free-air states',()=>{
 const both=new Set(['LEFT','RIGHT']);
 for(const s of ['RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_DASH_JUMP'])assert.equal(freeAirInputDirection(s,both),1);
 for(const s of ['RSI_WAIT','RSI_WALK','RSI_DASH_END','RSI_COMBO_ZZX','RSI_JUMP_COMBO_Z'])assert.equal(freeAirInputDirection(s,both),0);
});
for(const facing of [-1,1])test(`normal jump overlapping keys respects first Left under user policy, facing${facing}`,async()=>{
 const f=await dashZxFixture({facing,gap:1500}),d=device(f);d.tap('UP');
 d.b.down('LEFT',f.s.state.time+.001);d.b.down('RIGHT',f.s.state.time+.002);d.step();
 assert.equal(f.a.state,'RSI_JUMP_UP');assert.equal(f.a.facing,-1);
 assert.ok(f.a.vx<0,'overlap retains the first direction');
});
for(const facing of [-1,1])test(`DashJump overlapping keys retain Now direction and original Event priority, facing${facing}`,async()=>{
 const {f,d,bk}=await dashJump(facing);const x=f.a.x;d.down(bk);
 assert.equal(f.a.facing,facing,'DashJump Event does not set Future facing');assert.equal(Math.sign(f.a.x-x),facing);
 assert.equal(f.a.state,'RSI_DASH_JUMP');
 d.step();assert.equal(f.a.facing,facing,'later opposite held key cannot turn the first direction');
});
for(const facing of [-1,1])test(`reverse DashJump Event retains facing until next JumpFuture, facing${facing}`,async()=>{
 const {f,d,fw,bk}=await dashJump(facing);
 d.b.up(fw,f.s.state.time+.001);d.b.down(bk,f.s.state.time+.002);d.step();
 assert.equal(f.a.state,'RSI_JUMP_UP');assert.equal(f.a.facing,facing);
 assert.ok(f.a.vy<=f.s.profile.physics.JUMP_SPEED*f.a.stats.jumpSpeedMultiplier);
 d.tap('Z');assert.equal(f.a.state,'RSI_JUMP_COMBO_Z');assert.equal(f.a.facing,-facing);
});
for(const facing of [-1,1])test(`complete millisecond66824Z emits actual8Z hit, facing${facing}`,async()=>{
 const {summary}=await observeJumpPrefix({facing,wait:8,spacing:16});
 assert.equal(summary.enteredJumpZ,true);assert.equal(summary.jumpZHits.length,1);
 assert.equal(summary.jumpZHits[0].data.DAMAGE.PHYSIC,1.78);
 assert.ok(summary.hpLost>0);
});
test('overlapping later Right cannot replace the first Left dash direction',async()=>{
 const {summary}=await observeJumpPrefix({facing:-1,wait:8,spacing:16,overlap:true,phase:.004});
 assert.equal(summary.enteredJumpZ,false);assert.equal(summary.jumpZHits.length,0);
 assert.ok(summary.states.some(s=>s.state==='RSI_DASH_JUMP_COMBO_Z'));
});
test('same packet Down/reverse/Z preserves original dash-Z branch rather than inventing multiple callbacks',async()=>{
 const {summary}=await observeJumpPrefix({facing:1,wait:4,spacing:0});
 assert.equal(summary.enteredJumpZ,false);assert.ok(summary.states.some(s=>s.state==='RSI_DASH_JUMP_COMBO_Z'));
});
test('too-low complete prefix can enter8Z and land before the authored.11 point; no synthetic hit is added',async()=>{
 const {summary}=await observeJumpPrefix({facing:1,wait:4,spacing:16});
 assert.equal(summary.enteredJumpZ,true);assert.equal(summary.jumpZHits.length,0);assert.equal(summary.hpLost,0);
});
