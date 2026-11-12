import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame as step} from '../helpers/authored-command-fixture.mjs';
import {observeDoubleCancelV19,observePreinputV19,verifyDoubleCancelReplay} from '../helpers/authored-command-fixture.mjs';
import {jumpPressEdges} from '../helpers/authored-command-fixture.mjs';
const source=JSON.parse(readFileSync(new URL('../../reports/rf-keyboard-independent-source-v19.json',import.meta.url)));
test('sampled keyboard matches independent original Read plus ordered four getters',()=>{
 const b=createInputBuffer({sampledLevels:true});
 const events=[[1,'RIGHT',true],[20,'RIGHT',false],[40,'RIGHT',true],[65,'RIGHT',false],
  [66,'LEFT',true],[68,'RIGHT',true],[69,'LEFT',false],[100,'RIGHT',false],[120,'RIGHT',true]];
 for(const [time,key,down] of events)b[down?'down':'up'](key,time/1000);
 for(const c of source.cases){const packet=b.consume(c.timeMs/1000);
  for(const key of ['LEFT','RIGHT'])assert.deepEqual([packet.pureDouble.includes(key),packet.oneDouble.includes(key),packet.held.includes(key),packet.pressed.includes(key)].map(Number),c[key.toLowerCase()]);}
 assert.ok(source.fragments.every(f=>f.bodyUnchanged));assert.equal(source.targetClientMeasured,false);
 assert.equal(source.fragments.length,17);
 assert.deepEqual(source.macroBranches.map(b=>[b.KEY_MAPPING,b.CHANGE_KEY_DEVICE]),[[false,true],[true,true],[true,false]]);
 assert.deepEqual(source.macroBranches[0].cases,source.macroBranches[1].cases);
 assert.deepEqual(source.macroBranches[1].cases,source.macroBranches[2].cases);
 assert.equal(source.referenceBuildMacros.KEY_MAPPING.defined,true);
 assert.equal(source.referenceBuildMacros.CHANGE_KEY_DEVICE.condition,'X2TOOL');
 assert.equal(source.managerAcquisition.membershipVerifiedViaContentsRef,true);
});
test('whole original StateChange and Future scheduler preserve request until next packet',()=>{
 const r=JSON.parse(readFileSync(new URL('../../reports/rf-state-schedule-independent-source-v19.json',import.meta.url)));
 assert.deepEqual(r.fragments.map(f=>f.method),['StateChange','DoStateEndStartFuture','DoFrameMoveFuture']);
 assert.ok(r.fragments.every(f=>f.bodyUnchanged));assert.equal(r.targetClientMeasured,false);
 assert.deepEqual(r.cases.map(c=>c.now),[0,1,2,3,4]);assert.deepEqual(r.cases.map(c=>c.pending),[1,2,3,4,4]);
 assert.ok(r.cases.every(c=>c.moves===c.packet+1&&c.events===c.packet+1&&c.starts===c.packet));
});
test('all eligible messages reach their cutoff; unseen release does not unlock original one key',()=>{
 const b=createInputBuffer({sampledLevels:true});b.down('RIGHT',.001);assert.deepEqual(b.consume(.01).pressed,['RIGHT']);
 b.up('RIGHT',.011);b.down('LEFT',.012);b.down('RIGHT',.013);b.up('LEFT',.014);
 const p=b.consume(.02);assert.deepEqual(p.pressed,[]);assert.deepEqual(p.held,['RIGHT']);assert.equal(p.edges.length,4);assert.equal(b.pending,0);
 b.up('RIGHT',.021);b.consume(.03);b.down('RIGHT',.031);assert.deepEqual(b.consume(.04).pressed,['RIGHT']);
});
test('entire same-packet double gesture is one final level, never split into delayed fake dash',()=>{
 const b=createInputBuffer({sampledLevels:true});b.down('RIGHT',.001);b.up('RIGHT',.002);b.down('RIGHT',.003);
 const p=b.consume(.016);assert.deepEqual(p.pressed,['RIGHT']);assert.deepEqual(p.pureDouble,[]);assert.equal(b.pending,0);
 assert.deepEqual(b.consume(.032).pressed,[]);
});
test('released sampled direction during hitstop is not resurrected as held DASH after stop',async()=>{
 const f=await dashZxFixture({gap:1500}),b=createInputBuffer({sampledLevels:true});f.a.worldStop=.1;
 b.down('RIGHT',.001);step(f,b.consume(1/60));b.up('RIGHT',.02);step(f,b.consume(2/60));
 b.down('RIGHT',.04);step(f,b.consume(3/60));b.up('RIGHT',.06);step(f,b.consume(4/60));
 for(let i=4;i<10;i++)step(f,b.consume((i+1)/60));
 assert.equal(f.a.state,'RSI_WAIT');assert.deepEqual(f.a.pendingPressed,[]);
});
test('inspector tap remains an explicit edge adapter separate from live sampled keys',()=>{
 const b=createInputBuffer({sampledLevels:true});b.tap('Z',.001);const p=b.consume(.016);
 assert.deepEqual(p.pressed,['Z']);assert.equal(p.sampledDevice,false);assert.deepEqual(p.held,[]);
});
for(const facing of [-1,1])for(const gap of [70,1500])test(`full DOM ZZX6646 overlap cancels X then restarts regular ZZ: ${facing}, ${gap}`,async()=>{
 const before=await observeDoubleCancelV19({facing,gap,stepFrames:1,sampled:false,overlap:true});
 const after=await observeDoubleCancelV19({facing,gap,stepFrames:1,sampled:true,overlap:true});
 assert.equal(before.final6.state,'RSI_DASH');assert.equal(before.secondZStart,'RSI_DASH_COMBO_Z');
 assert.equal(after.final6.state,'RSI_DASH');assert.equal(after.secondZStart,'RSI_DASH_COMBO_Z');
 assert.ok(after.frames.filter(f=>f.state==='RSI_COMBO_ZZX').every(f=>f.animationTime<.26));
 assert.equal(after.stateChanges.filter(e=>e.state==='RSI_COMBO_Z').length,1);
 assert.equal(after.stateChanges.filter(e=>e.state==='RSI_COMBO_ZZ').length,1);
 assert.equal(after.hits.length>0,gap===70);
 assert.ok(after.dom.every(e=>e.prevented));assert.ok(after.frames.filter(f=>['RSI_COMBO_Z','RSI_COMBO_ZZ'].includes(f.state)).every(f=>f.facing===facing));
 assert.equal((await verifyDoubleCancelReplay(after)).jsonRestorePackets,120);
});
for(const facing of [-1,1])test(`sampled keyboard complete66824Z retains original8Z collision, facing ${facing}`,async()=>{
 const f=await dashZxFixture({facing,gap:110}),b=createInputBuffer({sampledLevels:true}),edges=jumpPressEdges({facing,wait:8,spacing:16});let at=0,hits=0;
 for(let i=1;i<=80;i++){while(at<edges.length&&edges[at].time<=i/60){const e=edges[at++];b[e.down?'down':'up'](e.key,e.time);}
  const previous=f.a.state;step(f,b.consume(i/60));for(const event of f.s.drainEvents())if(previous==='RSI_JUMP_COMBO_Z'&&event.type==='hit'&&event.actorId==='rf')hits++;}
 assert.ok(hits>0);assert.equal(f.a.hp,f.a.stats.hpMax);
});
for(const facing of [-1,1])for(const gap of [70,1500])test(`actual DOM sampled ZZXX82X/XZ preserves sequential preinput: ${facing}, ${gap}`,async()=>{
 for(const tailZ of [false,true]){
  const r=await observePreinputV19({facing,gap,tailZ});assert.equal(r.airXReached,true);
  assert.ok(r.frames.some(f=>JSON.stringify(f.cancelInput?.commands)==='["UP","DOWN","X"]'));
  const states=r.stateChanges.map(e=>e.state),i=states.indexOf('RSI_JUMP_COMBO_X');
  assert.ok(i>states.indexOf('RSI_COMBO_ZZXX'));if(tailZ)assert.ok(states.lastIndexOf('RSI_COMBO_Z')>i);
  assert.ok(r.dom.every(e=>e.prevented));assert.equal((await verifyDoubleCancelReplay(r)).jsonRestorePackets,120);
 }
 const same=await observePreinputV19({facing,gap,sameRead:true});assert.equal(same.airXReached,false);
 const collapsed=same.packets.find(p=>p.edges.some(e=>e.key==='UP'));
 assert.ok(!collapsed.pressed.includes('UP'));assert.ok(!collapsed.pressed.includes('DOWN'));
 const early=await observePreinputV19({facing,gap,tailZ:true,tailZMode:'air-start'});
 assert.equal(early.airXReached,true);assert.equal(early.stateChanges.filter(e=>e.state==='RSI_COMBO_Z').length,1);
});
