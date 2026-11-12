import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createInputStepClock} from '../../apps/web/input-step-clock.mjs';

test('50ms render catch-up reads UP at16.7ms before its18ms release and19ms DOWN',()=>{
 const input=createInputBuffer(),clock=createInputStepClock();clock.rebase(0);
 input.down('UP',.012);input.up('UP',.018);input.down('DOWN',.019);
 const batch=clock.advance(.05);assert.deepEqual(batch.cutoffs,[1/60,2/60,3/60]);
 const packets=batch.cutoffs.map(cutoff=>input.consume(cutoff));
 assert.deepEqual(packets[0],{held:['UP'],pressed:['UP'],released:[],edges:[{key:'UP',down:true,time:.012}]});
 assert.deepEqual(packets[1].pressed,['DOWN']);assert.deepEqual(packets[1].released,['UP']);assert.deepEqual(packets[1].held,['DOWN']);
 assert.deepEqual(packets[2].pressed,[]);assert.equal(input.pending,0);
});

test('cutoff includes an exact timestamp but never reads a later edge',()=>{
 const b=createInputBuffer();b.down('UP',.1);b.up('UP',.2);b.down('X',.3);
 assert.deepEqual(b.consume(.1).pressed,['UP']);assert.equal(b.pending,2);
 assert.deepEqual(b.consume(.199).released,[]);assert.deepEqual(b.consume(.2).released,['UP']);
 assert.deepEqual(b.consume(.3).pressed,['X']);
});

test('duplicate RIGHT retains its per-key tap delay without blocking eligible82/X',()=>{
 const b=createInputBuffer();b.down('RIGHT',.01);b.up('RIGHT',.011);b.down('RIGHT',.012);b.up('RIGHT',.013);
 b.down('UP',.014);b.up('UP',.015);b.down('DOWN',.016);b.down('X',.017);
 const first=b.consume(.02);assert.deepEqual(first.pressed,['RIGHT','UP','DOWN','X']);
 assert.deepEqual(first.released,['RIGHT','UP']);assert.deepEqual(first.held,['DOWN','X']);
 assert.deepEqual(first.edges.map(e=>e.key),['RIGHT','RIGHT','UP','UP','DOWN','X']);assert.equal(b.pending,2);
 const second=b.consume(.02);assert.deepEqual(second.pressed,['RIGHT']);assert.deepEqual(second.released,['RIGHT']);
 assert.deepEqual(second.held,['DOWN','X']);assert.equal(b.pending,0);
});

test('deferred key order retains releases and future edges; unrelated keys still pass',()=>{
 const b=createInputBuffer();b.down('RIGHT',1);b.up('RIGHT',2);b.down('UP',.1);
 const first=b.consume(.2);assert.deepEqual(first.held,['UP']);assert.deepEqual(first.pressed,['UP']);assert.equal(b.pending,2);
 assert.deepEqual(b.consume(1).pressed,['RIGHT']);assert.deepEqual(b.consume(2).released,['RIGHT']);
});

test('manual no-argument consumption stays unbounded and preserves repeat suppression, clear and releaseAll',()=>{
 const b=createInputBuffer();assert.equal(b.down('X',100),true);assert.equal(b.down('X',101),false);
 b.tap('UP',0);assert.deepEqual(b.consume().pressed,['X','UP']);b.releaseAll(200);
 assert.deepEqual(b.consume().released,['X']);b.down('Z',300);b.clear();assert.equal(b.pending,0);
 assert.deepEqual(b.consume(),{held:[],pressed:[],released:[],edges:[]});
 assert.throws(()=>b.consume(NaN));assert.throws(()=>b.consume(-Infinity));
});

// These analytic wall-clock events are independent of either implementation.
// The oracle places each edge at the first fixed boundary >= its timestamp.
const events=[['UP',true,.012],['UP',false,.018],['DOWN',true,.019],['DOWN',false,.042],
 ['RIGHT',true,.121],['RIGHT',false,.181],['RIGHT',true,.241],['RIGHT',false,.301],
 ['X',true,.413],['X',false,.444],['UP',true,.601],['DOWN',true,.631],['UP',false,.650],['DOWN',false,.680]];
function sampled(hz){
 const input=createInputBuffer(),clock=createInputStepClock();clock.rebase(0);let event=0;const packets=[];
 for(let frame=1;frame<=hz;frame++){
  const now=frame/hz;
  while(event<events.length&&events[event][2]<=now){const [key,down,time]=events[event++];input[down?'down':'up'](key,time);}
  for(const cutoff of clock.advance(now).cutoffs)packets.push({cutoff,...input.consume(cutoff)});
 }
 assert.equal(event,events.length);assert.equal(input.pending,0);return packets;
}
test('30/60/144Hz execute the same60 timestamped packets against an independent cutoff oracle',()=>{
 const schedules=[30,60,144].map(sampled);assert.deepEqual(schedules[0],schedules[1]);assert.deepEqual(schedules[1],schedules[2]);
 assert.equal(schedules[0].length,60);
 for(const [key,down,time] of events){
  const index=Math.ceil(time*60)-1;
  assert.ok(schedules[0][index].edges.some(e=>e.key===key&&e.down===down&&e.time===time));
 }
});

test('pause and inspector suspension rebase without catch-up; resume gets a new packet interval',()=>{
 const c=createInputStepClock();c.rebase(10);c.advance(10.01);
 const paused=c.advance(20,{paused:true});assert.equal(paused.cutoffs.length,0);assert.equal(paused.alpha,0);assert.equal(paused.reason,'suspended');
 assert.equal(c.advance(20.01).cutoffs.length,0);
 assert.deepEqual(c.advance(20.02).cutoffs,[20+1/60]);
 c.rebase(30);assert.equal(c.advance(30).cutoffs.length,0);assert.equal(c.advance(30.01).cutoffs.length,0);
});

test('large stalled frame rebases to the retained100ms window, six ordered packets, then resumes without old debt',()=>{
 const c=createInputStepClock(),b=createInputBuffer();c.rebase(0);c.advance(.01);
 b.down('UP',.94);b.up('UP',.96);b.down('DOWN',.97);
 const stalled=c.advance(1);assert.equal(stalled.reason,'clipped-frame');assert.equal(stalled.cutoffs.length,6);
 assert.equal(stalled.cutoffs[0],.9+1/60);assert.equal(stalled.cutoffs.at(-1),1);
 const packets=stalled.cutoffs.map(t=>b.consume(t));assert.deepEqual(packets[0].pressed,[]);
 assert.deepEqual(packets[2].pressed,['UP']);assert.deepEqual(packets[3].released,['UP']);assert.deepEqual(packets[4].pressed,['DOWN']);
 assert.equal(c.advance(1.01).cutoffs.length,0);assert.deepEqual(c.advance(1.02).cutoffs,[.9+7/60]);
});

test('manual stepping and explicit reset rebase live input time without introducing a simulation-time origin',()=>{
 const c=createInputStepClock(),b=createInputBuffer();c.rebase(100);
 b.tap('UP',3);assert.deepEqual(b.consume().pressed,['UP']); // old manual semantics
 c.rebase(101);b.down('DOWN',101.012);
 assert.deepEqual(c.advance(101.01).cutoffs,[]);
 const [cutoff]=c.advance(101.02).cutoffs;assert.deepEqual(b.consume(cutoff).pressed,['DOWN']);
 b.clear();c.rebase(102);assert.equal(c.advance(102.005).cutoffs.length,0);assert.equal(b.pending,0);
});

test('clock rejects invalid intervals and backward/nonfinite times rather than guessing a wall-clock origin',()=>{
 for(const options of [{stepSeconds:0},{maxDeltaSeconds:Infinity},{maxSteps:0},{maxDeltaSeconds:1}])assert.throws(()=>createInputStepClock(options));
 const c=createInputStepClock();assert.throws(()=>c.rebase(NaN));c.rebase(1);
 assert.throws(()=>c.advance(.9));assert.throws(()=>c.advance(Infinity));assert.equal(c.advance(1).cutoffs.length,0);
});
