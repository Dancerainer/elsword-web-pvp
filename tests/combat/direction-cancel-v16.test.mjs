import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame as frame} from '../../tools/combat/rf_dash_zx_audit.mjs';
import {targetZzxBackwardCancel} from '../../packages/combat-core/direction-cancel-candidates.mjs';
const source=JSON.parse(readFileSync(new URL('../../reports/rf-direction-consumer-source-v16.json',import.meta.url)));
function device(f){
  const b=createInputBuffer();
  return {b,step(){frame(f,b.consume(f.s.state.time+1/60));},
    tap(k){b.tap(k,f.s.state.time+.001);this.step();},
    down(k){b.down(k,f.s.state.time+.001);this.step();}};
}
function until(f,d,state){for(let i=0;i<180&&f.a.state!==state;i++)d.step();assert.equal(f.a.state,state);}
async function zzx(facing){
  const f=await dashZxFixture({facing,gap:1500}),d=device(f);
  d.tap('Z');d.tap('Z');until(f,d,'RSI_COMBO_ZZ');d.tap('X');until(f,d,'RSI_COMBO_ZZX');
  return {f,d};
}
test('independently compiled unchanged consumers retain direction and branch priority',()=>{
  assert.equal(source.assertionsPassed,24);assert.equal(source.publishedNativeModulesModified,false);
  assert.ok(source.fragments.every(v=>v.bodyUnchanged));
  for(const facing of [-1,1]){
    const cases=source.cases.filter(v=>v.facing===facing);
    assert.equal(cases.find(v=>v.case==='dash-opposite').afterFacing,facing);
    assert.equal(cases.find(v=>v.case==='dash-end-fresh-original-direction').requested,1);
    assert.equal(cases.find(v=>v.case==='jump-up-touched-floor-z').requested,15);
    assert.equal(cases.find(v=>v.case==='backward-equal').requested,0);
    assert.equal(cases.find(v=>v.case==='backward-after').requested,3);
  }
});
for(const facing of [-1,1])for(const secondHeld of [false,true])test(`ZZX6646 actual device clocks, facing${facing}, second66held${secondHeld}`,async()=>{
  const {f,d}=await zzx(facing),forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  const entered=f.s.state.events.findLast(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state==='RSI_COMBO_ZZX').time;
  d.tap(forward);secondHeld?d.down(forward):d.tap(forward);
  assert.equal(f.a.state,'RSI_DASH');
  const raw=f.s.profile.states.RSI_COMBO_ZZX.raw;
  assert.ok((f.s.state.time-entered)*(raw.ANIM_SPEED??1)*f.a.stats.animationSpeedMultiplier<raw.ATTACK_TIME0['1'],
    'actual X->66 cancel occurred before the target X attack window');
  d.b.up(forward,f.s.state.time+.001);d.b.tap(back,f.s.state.time+.002);d.step();
  assert.equal(f.a.state,'RSI_DASH_END');assert.equal(f.a.facing,facing);
  d.down(forward);assert.equal(f.a.state,'RSI_DASH');assert.equal(f.a.facing,facing);
  d.tap('Z');assert.equal(f.a.state,'RSI_DASH_COMBO_Z');
  const own=f.s.state.events.filter(v=>v.actorId==='rf');
  assert.ok(!own.some(v=>v.type==='stateChanged'&&v.state==='RSI_WALK'));
  assert.ok(!own.some(v=>v.type==='hit'&&v.origin==='character'&&v.state==='RSI_COMBO_ZZX'));
});
for(const facing of [-1,1])for(const jumpFrames of [0,3])test(`66824Z ordered Down/turn packet, facing${facing}, airborne wait${jumpFrames}`,async()=>{
  const f=await dashZxFixture({facing,gap:1500}),d=device(f);
  const forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  d.tap(forward);d.down(forward);d.tap('UP');
  assert.equal(f.a.state,'RSI_DASH_JUMP');
  for(let i=0;i<jumpFrames;i++)d.step();
  d.b.tap('DOWN',f.s.state.time+.001);d.b.up(forward,f.s.state.time+.002);d.b.down(back,f.s.state.time+.003);d.step();
  assert.ok(['RSI_JUMP_UP','RSI_JUMP_DOWN'].includes(f.a.state));assert.equal(f.a.vy,-2000);
  d.tap('Z');assert.equal(f.a.state,'RSI_JUMP_COMBO_Z');assert.equal(f.a.facing,-facing);
  assert.ok(f.s.state.events.some(v=>v.type==='dashJumpForcedDown'));
});
for(const facing of [-1,1])test(`same packet opposite/down/Z preserves original DashJump Z priority, facing${facing}`,async()=>{
  const f=await dashZxFixture({facing,gap:1500}),d=device(f),forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  d.tap(forward);d.down(forward);d.tap('UP');d.step();d.step();
  d.b.up(forward,f.s.state.time+.001);d.b.down(back,f.s.state.time+.002);d.b.tap('DOWN',f.s.state.time+.003);d.b.tap('Z',f.s.state.time+.004);d.step();
  assert.equal(f.a.state,'RSI_DASH_JUMP_COMBO_Z');assert.equal(f.a.facing,facing);assert.equal(f.a.vy,-2000);
});
test('selected ZZX backward candidate follows strict macro threshold, hold/release and fail-closed priority',()=>{
  for(const facing of [-1,1]){
    const a={state:'RSI_COMBO_ZZX',grounded:true,facing,animationTime:.35},raw={BWALK_CANCEL_AFTER:.35};
    const key=facing===1?'LEFT':'RIGHT',input={held:new Set([key]),pressed:new Set()};
    assert.equal(targetZzxBackwardCancel(a,input,raw),false);
    a.animationTime=.35+1e-9;assert.equal(targetZzxBackwardCancel(a,input,raw),false,'source binary32 equality remains closed');
    a.animationTime=.350001;assert.equal(targetZzxBackwardCancel(a,input,raw),true);
    assert.equal(targetZzxBackwardCancel(a,{...input,held:new Set()},raw),false);
    assert.equal(targetZzxBackwardCancel(a,{...input,pressed:new Set(['X'])},raw),false);
    assert.equal(targetZzxBackwardCancel(a,{...input,pureDoubleLeft:true},raw),false);
    assert.equal(targetZzxBackwardCancel({...a,cancelInput:{stage:'pending',commands:['UP','DOWN','X']}},input,raw),false);
    assert.equal(targetZzxBackwardCancel({...a,state:'RSI_COMBO_ZZ'},input,raw),false);
    assert.equal(targetZzxBackwardCancel(a,input,{BWALK_CANCEL_AFTER:-1}),false);
  }
});
for(const facing of [-1,1])test(`actual ZZX backward held cancellation resumes original direction/dash, facing${facing}`,async()=>{
  const {f,d}=await zzx(facing),back=facing===1?'LEFT':'RIGHT';d.down(back);
  assert.equal(f.a.state,'RSI_COMBO_ZZX');until(f,d,'RSI_WAIT');assert.equal(f.a.facing,facing);
  d.step();assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,-facing);
  d.b.up(back,f.s.state.time+.001);d.step();d.down(back);assert.equal(f.a.state,'RSI_DASH');
});
test('JSON restore continues a cancelled ZZX6646 for120 frames with identical input and complete state',async()=>{
  const {f,d}=await zzx(1);d.tap('RIGHT');d.tap('RIGHT');d.tap('LEFT');d.tap('RIGHT');
  const g=await dashZxFixture({gap:1500});f.s.drainEvents();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<120;i++){const input=i===3?{pressed:['UP'],held:['RIGHT','UP']}:i===5?{pressed:['Z'],held:['RIGHT']}:{held:['RIGHT']};
    frame(f,input);frame(g,input);assert.deepEqual(g.s.snapshot(),JSON.parse(JSON.stringify(f.s.snapshot())));}
});
