import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadMinimalNative} from '../../packages/minimal-runtime/native.mjs';
import {createExperiment} from '../../packages/minimal-runtime/experiment.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
const assets=new URL('../../artifacts/',import.meta.url);
const binary=p=>readFile(new URL(p,assets));
const json=async p=>JSON.parse(await binary(p));
const native=async()=>loadMinimalNative(await json('minimal/manifest.json'),p=>binary('minimal/'+p));
const make=mode=>createExperiment({json,binary,mode});

test('same-packet press+release collapses to released in original WinKey Read; old adapter retains press',async()=>{
 const n=await native(),d=n.createDevice(),old=createInputBuffer();
 d.enqueue('Z',true,1);d.enqueue('Z',false,2);old.down('Z',.001);old.up('Z',.002);
 assert.deepEqual(d.sample(16,1/60).pressed,[]);assert.deepEqual(old.consume(.016).pressed,['Z']);
});
test('device waits for due stamp, emits one once, unlocks only after observed release',async()=>{
 const d=(await native()).createDevice();d.enqueue('Z',true,20);
 assert.deepEqual(d.sample(16,1/60).pressed,[]);assert.deepEqual(d.sample(33,1/60).pressed,['Z']);
 assert.deepEqual(d.sample(50,1/60).pressed,[]);d.enqueue('Z',false,55);d.sample(66,1/60);
 d.enqueue('Z',true,70);assert.deepEqual(d.sample(83,1/60).pressed,['Z']);
});
test('native double requires an observed released sample; compact taps cannot synthesize a dash',async()=>{
 const d=(await native()).createDevice();d.enqueue('RIGHT',true,1);d.sample(16,1/60);
 d.enqueue('RIGHT',false,18);d.enqueue('RIGHT',true,19);
 assert.equal(d.sample(33,1/60).pureDoubleRight,false);
 d.enqueue('RIGHT',false,40);d.sample(50,1/60);d.enqueue('RIGHT',true,55);
 assert.equal(d.sample(66,1/60).pureDoubleRight,true);
});
test('DWORD timestamp wrap uses signed 32-bit difference, not host long width',async()=>{
 const d=(await native()).createDevice(),t=2**32;
 d.enqueue('LEFT',true,t+4);assert.deepEqual(d.sample(t-4,1/60).pressed,[]);
 assert.deepEqual(d.sample(t+5,1/60).pressed,['LEFT']);
});
test('device snapshots preserve queued future edges and locks across JSON restoration',async()=>{
 const a=(await native()).createDevice(),b=(await native()).createDevice();
 a.enqueue('UP',true,1);a.sample(16,1/60);a.enqueue('UP',false,22);a.enqueue('Z',true,42);
 b.restore(JSON.parse(JSON.stringify(a.snapshot())));
 for(const t of [33,50,66,83])assert.deepEqual(a.sample(t,1/60),b.sample(t,1/60));
 assert.deepEqual(a.snapshot(),b.snapshot());
 assert.throws(()=>b.restore({schema:1,bytes:[]}),/snapshot/);
});
test('source drift and malformed device inputs fail explicitly',async()=>{
 const m=await json('minimal/manifest.json');m.modules.input.sha256='0'.repeat(64);
 await assert.rejects(loadMinimalNative(m,p=>binary('minimal/'+p)),/hash mismatch/);
 const d=(await native()).createDevice();assert.throws(()=>d.enqueue('UNKNOWN',true,0),/Unsupported/);
 d.sample(16,1/60);assert.throws(()=>d.enqueue('Z',true,1),/ordered/);assert.throws(()=>d.sample(10,1/60),/interval/);
});
test('six unchanged movement events preserve literal reference branch priority',async()=>{
 const m=(await native()).movement;
 const actor={state:'RSI_WAIT',grounded:true,facing:1,vy:0,animationTime:0,reAttackZ1Time:0,reAttackZ1Right:false,stats:{jumpSpeedMultiplier:1}};
 const keys={held:new Set(['RIGHT','UP']),pressed:new Set(['UP'])};
 assert.equal(m.evaluate(actor,keys,profile,false).state,'RSI_WALK');
 const up=m.evaluate(actor,{held:new Set(['UP']),pressed:new Set(['UP'])},profile,false);
 assert.equal(up.state,'RSI_JUMP_UP');assert.equal(up.offsetY,30);assert.equal(up.vy,1500);
 const off=m.evaluate({...actor,grounded:false},{held:new Set(),pressed:new Set(['Z'])},profile,false);
 assert.equal(off.state,'RSI_JUMP_DOWN');assert.equal(off.offsetY,-45);
});
test('production original resources: movement, jump, fall and reset stay finite and deterministic',async()=>{
 const e=await make('source'),initial=e.sim.snapshot();
 e.enqueue('UP',true,1);e.enqueue('UP',false,40);
 let airborne=false;
 for(let i=1;i<=140;i++){e.step(i*1000/60);airborne||=!e.sim.state.actors[0].grounded;}
 assert.ok(airborne);assert.ok(e.sim.state.actors[0].grounded);
 assert.ok(e.sim.state.actors.every(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)));
 const replay=await make('source');for(const edge of e.trace().rawEdges)replay.enqueue(edge.key,edge.down,edge.time);
 for(let i=1;i<=140;i++)replay.step(i*1000/60);
 assert.deepEqual(e.sim.snapshot(),replay.sim.snapshot());e.reset();assert.deepEqual(e.sim.snapshot(),initial);
});
test('a short Z tap creates a measured implementation difference without inventing original-client gold',async()=>{
 const a=await make('source'),b=await make('baseline');
 for(const e of [a,b]){e.enqueue('Z',true,1);e.enqueue('Z',false,2);e.step(1000/60);}
 assert.equal(a.sim.state.actors[0].state,'RSI_WAIT');assert.equal(b.sim.state.actors[0].state,'RSI_COMBO_Z');
});
test('real helper Z hits the mirror and produces a reaction; no guessed collision box',async()=>{
 const e=await make('source');e.enqueue('Z',true,1);e.enqueue('Z',false,70);
 for(let i=1;i<=90;i++)e.step(i*1000/60);
 const hits=e.trace().events.filter(x=>x.type==='hit');assert.ok(hits.length>0,'original helper should connect at authored spawns');
 assert.ok(e.sim.state.actors[1].hp<e.sim.state.actors[1].hpMax);
});
