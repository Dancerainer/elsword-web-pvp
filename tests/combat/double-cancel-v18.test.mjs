import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame as frame} from '../../tools/combat/rf_dash_zx_audit.mjs';
import {observeDoubleCancel} from '../../tools/combat/rf_double_cancel_v18.mjs';

test('independent original fixed-source probes freeze ten ground overlap/request conditions',()=>{
  const r=JSON.parse(readFileSync(new URL('../../reports/rf-double-cancel-consumers-v18.json',import.meta.url)));
  assert.equal(r.assertionsPassed,10);assert.equal(r.targetClientMeasured,false);
  assert.equal(r.productionNativeModulesModified,false);assert.ok(r.fragments.every(v=>v.bodyUnchanged));
  for(const face of [-1,1]){
    const cases=r.cases.filter(v=>v.facing===face);
    assert.equal(cases.find(v=>v.case==='walk-both-pure').afterFacing,1);
    assert.equal(cases.find(v=>v.case==='dash-end-both-fresh-facing').requested,1);
    assert.equal(cases.find(v=>v.case==='dash-end-both-held-no-fresh').requested,2);
    assert.equal(cases.find(v=>v.case==='dash-request-opposite-held').afterFacing,face);
    assert.equal(cases.find(v=>v.case==='dash-end-fresh-facing-and-z').requested,13);
  }
});

for(const facing of [-1,1])test(`user first-direction policy filters ground overlap before the source callback, facing ${facing}`,async()=>{
  const f=await dashZxFixture({facing,gap:1500});
  f.s.enter(f.a,'RSI_WALK','isolated-ground-condition');
  frame(f,{held:['LEFT','RIGHT']});assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,-1);assert.ok(f.a.vx<0);
  f.a.facing=facing;f.s.enter(f.a,'RSI_DASH_END','isolated-ground-condition');
  frame(f,{held:['LEFT','RIGHT'],pressed:[facing===1?'RIGHT':'LEFT']});
  assert.equal(f.a.state,facing===-1?'RSI_DASH':'RSI_WALK');assert.equal(f.a.facing,facing);
  f.s.enter(f.a,'RSI_DASH_END','isolated-ground-condition');
  frame(f,{held:['LEFT','RIGHT']});assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,facing);
  frame(f,{held:['LEFT','RIGHT']});assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,-1);
});

for(const facing of [-1,1])test(`native dash request retains facing until original succeeding callback, facing ${facing}`,async()=>{
  const f=await dashZxFixture({facing,gap:1500}),back=facing===1?'LEFT':'RIGHT';
  f.s.enter(f.a,'RSI_COMBO_ZZX','isolated-source-request');
  frame(f,{held:[back],pressed:['DASH']});
  assert.equal(f.a.state,'RSI_DASH');assert.equal(f.a.facing,facing);
  frame(f,{held:[back]});assert.equal(f.a.state,'RSI_DASH_END');assert.equal(f.a.facing,facing);
});

for(const facing of [-1,1])for(const stepFrames of [2,3])test(`actual ZZX6646 then new ZZ hits twice per sword pair, facing ${facing}, direction packets ${stepFrames}`,async()=>{
  const r=await observeDoubleCancel({facing,stepFrames,releaseFrames:1,gap:70});
  assert.equal(r.secondZStart,'RSI_COMBO_Z');assert.equal(r.zzReached,true);
  const zzx=r.frames.filter(v=>v.state==='RSI_COMBO_ZZX');assert.ok(zzx.length);
  assert.ok(zzx.every(v=>v.animationTime<.26),'X only cancels before its target declared attack window');
  assert.equal(r.stateChanges.filter(v=>v.state==='RSI_COMBO_Z').length,2);
  assert.equal(r.stateChanges.filter(v=>v.state==='RSI_COMBO_ZZ').length,2);
  assert.equal(r.hits.length,4,'real original pose/helper collision participates in both new sword pairs');
  assert.ok(r.frames.filter(v=>v.state==='RSI_COMBO_Z'||v.state==='RSI_COMBO_ZZ').every(v=>v.facing===facing));
  assert.ok(!r.stateChanges.some(v=>v.state==='RSI_COMBO_XXX'||v.state==='RSI_DASH_COMBO_Z'));
});

for(const facing of [-1,1])test(`complete device packets replay and JSON restore for another 120 packets, facing ${facing}`,async()=>{
  const r=await observeDoubleCancel({facing,stepFrames:2,releaseFrames:1,gap:70});
  const f=await dashZxFixture({facing,gap:70}),g=await dashZxFixture({facing,gap:70});
  for(const packet of r.packets)frame(f,packet);
  assert.deepEqual(JSON.parse(JSON.stringify(f.s.drainEvents())),JSON.parse(JSON.stringify(r.events)));
  assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),r.snapshot);
  f.s.drainEvents();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<120;i++){const input=i===4?{pressed:['Z']}:i===6?{pressed:['Z']}:{};frame(f,input);frame(g,input);
    assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),JSON.parse(JSON.stringify(g.s.snapshot())));}
});

test('same-packet opposite held wins over a later fresh forward level',async()=>{
  const f=await dashZxFixture({gap:1500}),b=createInputBuffer();
  f.s.enter(f.a,'RSI_DASH_END','isolated-ground-condition');
  b.down('LEFT',.001);b.down('RIGHT',.002);const input=b.consume(1/60);frame(f,input);
  assert.deepEqual(input.held,['LEFT','RIGHT']);assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,1);
  frame(f,b.consume(1/30));assert.equal(f.a.facing,-1);
});
