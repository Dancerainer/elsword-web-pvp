import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundFrameRequester} from '../../apps/web/background-frame-requester.mjs';
function fixture(){
 const events=new Map(),frames=new Map(),timers=new Map();let serial=0,focused=true,clock=0;
 const listen=(name,fn)=>events.set(name,fn),remove=(name,fn)=>{if(events.get(name)===fn)events.delete(name);};
 const window={addEventListener:listen,removeEventListener:remove,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),
  setTimeout:(fn,ms)=>{assert.equal(ms,1000/60);timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
 const document={hidden:false,hasFocus:()=>focused,addEventListener:listen,removeEventListener:remove};
 const requester=createBackgroundFrameRequester({window,document,now:()=>clock});
 return {requester,frames,timers,events,document,blur(){focused=false;events.get('blur')();},focus(){focused=true;events.get('focus')();},
  fire(kind){const map=kind==='timer'?timers:frames,[id,fn]=map.entries().next().value;map.delete(id);clock+=1000/60;fn(clock);}};
}
test('a stranded native RAF is immediately replaced on blur, background stays60Hz and focus returns to one native RAF',()=>{
 const f=fixture(),times=[];const callback=time=>{times.push(time);f.requester.requestAnimationFrame(callback);};
 f.requester.requestAnimationFrame(callback);f.fire('raf');assert.equal(f.frames.size,1);f.blur();assert.equal(f.frames.size,0);assert.equal(f.timers.size,1);
 for(let i=0;i<60;i++)f.fire('timer');assert.equal(times.length,61);assert.ok(Math.abs(times.at(-1)-times[0]-1000)<1e-9);
 f.focus();assert.equal(f.timers.size,0);assert.equal(f.frames.size,1);f.fire('raf');assert.equal(times.length,62);
 assert.deepEqual(f.requester.proof(),{background:false,rafFrames:2,timerFrames:60,switches:2,pending:1,backgroundFramesPerSecond:60});
 f.requester.dispose();assert.equal(f.frames.size,0);assert.equal(f.events.size,0);
});
test('cancel, hidden state and disposal retire scheduled callbacks without double delivery during a rearm race',()=>{
 const f=fixture();let calls=0;const id=f.requester.requestAnimationFrame(()=>calls++),stale=[...f.frames.values()][0];
 f.document.hidden=true;f.events.get('visibilitychange')();stale(100);assert.equal(calls,0,'the canceled native callback is retired even when already queued');
 f.fire('timer');assert.equal(calls,1,'its rearmed timer delivers exactly once');
 const next=f.requester.requestAnimationFrame(()=>calls++);f.requester.cancelAnimationFrame(next);assert.equal(f.timers.size,0);
 f.requester.dispose();assert.throws(()=>f.requester.requestAnimationFrame(()=>{}),/disposed/);f.requester.cancelAnimationFrame(id);
});
