import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {comboStopFixture,comboStopFrame,comboStopProfile as profile} from '../../tools/combat/rf_combo_stop_v7.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {targetZzzBackwardCancel} from '../../packages/combat-core/direction-cancel-candidates.mjs';

test('third-Z candidate respects strict binary32 .45, release, direction, and higher-priority inputs',()=>{
  for(const facing of [-1,1]){
    const back=facing===1?'LEFT':'RIGHT',forward=facing===1?'RIGHT':'LEFT';
    const a={state:'RSI_COMBO_ZZZ',grounded:true,facing,animationTime:.45};
    const keys={held:new Set([back]),pressed:new Set()},raw=profile.states.RSI_COMBO_ZZZ.raw;
    assert.equal(targetZzzBackwardCancel(a,keys,raw),false);
    assert.equal(targetZzzBackwardCancel({...a,animationTime:.45+1e-9},keys,raw),false);
    const after={...a,animationTime:.450001};assert.equal(targetZzzBackwardCancel(after,keys,raw),true);
    for(const key of ['Z','X','A','AWAKEN','DASH'])assert.equal(targetZzzBackwardCancel(after,{...keys,pressed:new Set([key])},raw),false);
    assert.equal(targetZzzBackwardCancel(after,{...keys,held:new Set([forward])},raw),false);
    assert.equal(targetZzzBackwardCancel(after,{...keys,held:new Set()},raw),false);
    assert.equal(targetZzzBackwardCancel(after,{...keys,pureDoubleLeft:true},raw),false);
    assert.equal(targetZzzBackwardCancel({...after,grounded:false},keys,raw),false);
    assert.equal(targetZzzBackwardCancel({...after,state:'RSI_COMBO_ZZ'},keys,raw),false);
  }
});

async function fixture(facing,{hit=false}={}){
  const f=await comboStopFixture({facing,hit,corner:hit}),input=createInputBuffer({sampledLevels:true});
  const step=()=>comboStopFrame(f,input.consume(f.s.state.time+1/60));
  const until=(check,label)=>{for(let i=0;i<180&&!check();i++)step();assert.ok(check(),`${label}: ${f.a.state} ${f.a.animationTime}`);};
  const down=key=>{input.down(key,f.s.state.time+.001);step();};
  const up=key=>{input.up(key,f.s.state.time+.001);step();};
  const tap=key=>{down(key);up(key);};
  tap('Z');tap('Z');until(()=>f.a.state==='RSI_COMBO_ZZ','second Z');
  tap('Z');until(()=>f.a.state==='RSI_COMBO_ZZZ','third Z');
  return {...f,input,step,until,down,up,tap};
}
test('target third Z backward .45 differs from sealed V5 generic .6, while .59 fourth-Z and immediate dash remain separate',()=>{
  const raw=profile.states.RSI_COMBO_ZZZ.raw;
  assert.equal(raw.BWALK_CANCEL_AFTER,.45);assert.equal(raw.DASH_CANCEL_AFTER,0);assert.equal(raw.SKILL_CANCEL_AFTER,0);
  assert.equal(profile.referenceSemantics.comboBuffers.RSI_COMBO_ZZZ.after,.59);
  const bytes=readFileSync(new URL('../../.cache/native-source-runtime/X2Lib/X2GURaven.cpp',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237');
  const start=bytes.toString('latin1').indexOf('void CX2GURaven::RSI_COMBO_ZZZ_EventProcess()');
  const body=bytes.toString('latin1').slice(start).split('\n}')[0];
  assert.match(body,/GetNowAnimationTime\(\) > 0\.6f/);assert.match(body,/GetNowAnimationTime\(\) > 0\.59f/);
  assert.ok(body.includes('StateChangeDashIfPossible()'));assert.ok(!body.includes('BWALK_CANCEL_AFTER'));
});
for(const facing of [-1,1])for(const late of [false,true])test(`actual sampled ZZZ backward ${facing}, late=${late}: consumes .45 instead of .6`,async()=>{
  const f=await fixture(facing),back=facing===1?'LEFT':'RIGHT';
  if(late)f.until(()=>f.a.animationTime>.46,'late direction');
  f.down(back);let previous=f.a.animationTime;
  for(let i=0;i<90&&f.a.state==='RSI_COMBO_ZZZ';i++){previous=f.a.animationTime;f.step();}
  assert.equal(f.a.state,'RSI_WAIT');
  assert.ok(previous<.5,`late recovery at animation ${previous}`);
  assert.equal(f.a.facing,facing,'cancel itself retains facing');
  assert.equal(f.s.state.events.findLast(e=>e.type==='stateChanged'&&e.actorId==='rf').reason,'target-zzz-backward-cancel-candidate');
  f.step();assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,-facing);
  f.up(back);f.tap('Z');assert.equal(f.a.state,'RSI_COMBO_Z','fresh Z uses newly turned facing');
});
for(const facing of [-1,1])test(`ZZZ ${facing}: released backward tap is not buffered, forward retains .6`,async()=>{
  const f=await fixture(facing),back=facing===1?'LEFT':'RIGHT',forward=facing===1?'RIGHT':'LEFT';
  f.tap(back);f.until(()=>f.a.animationTime>.47,'released direction stays');assert.equal(f.a.state,'RSI_COMBO_ZZZ');
  f.down(forward);f.until(()=>f.a.animationTime>.58,'forward stays before .6');assert.equal(f.a.state,'RSI_COMBO_ZZZ');
  f.until(()=>f.a.state==='RSI_WAIT','original forward skip');
});
for(const facing of [-1,1])test(`ZZZ ${facing}: original fourth-Z, dash, and real skill routes remain available`,async()=>{
  const fourth=await fixture(facing);fourth.tap('Z');fourth.until(()=>fourth.a.state==='RSI_COMBO_ZZZZ','fourth Z');
  const dash=await fixture(facing),forward=facing===1?'RIGHT':'LEFT';dash.tap(forward);dash.down(forward);assert.equal(dash.a.state,'RSI_DASH');
  const skill=await fixture(facing),slot=skill.a.loadout.findIndex(s=>s?.skillId===24217);
  skill.down(['A','S','D','C','Q','W','E','R'][slot]);assert.equal(skill.a.skillId,24217);
});
for(const facing of [-1,1])test(`real third Z hit at Garpai edge ${facing} survives the earlier backward recovery`,async()=>{
  const f=await fixture(facing,{hit:true}),back=facing===1?'LEFT':'RIGHT';f.down(back);
  f.until(()=>f.a.state==='RSI_WAIT','backward recovery');
  const hits=f.s.state.events.filter(e=>e.type==='hit'&&e.actorId==='rf'&&e.origin?.state==='RSI_COMBO_ZZZ');
  assert.ok(hits.some(e=>e.amount>0),'third Z actual original attack hits before .45');
});
test('ZZZ backward recovery continues identically after JSON restoration',async()=>{
  const f=await fixture(1),g=await fixture(1);f.until(()=>f.a.animationTime>.4,'before target point');
  f.s.drainEvents();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<90;i++){
    const packet={sampledDevice:true,held:i<8?['LEFT']:[],pressed:i===0?['LEFT']:[],released:i===8?['LEFT']:[]};
    comboStopFrame(f,packet);comboStopFrame(g,packet);assert.deepEqual(g.s.snapshot(),JSON.parse(JSON.stringify(f.s.snapshot())));
  }
});
