/** Actual installed Babylon engine cancellation/queue integration, no GPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core';
import {createBackgroundFrameRequester} from '../../apps/web/background-frame-requester.mjs';
test('actual Babylon keeps one callback while blur replaces RAF and stop/dispose cancel the timer',()=>{
 const events=new Map(),raf=new Map(),timers=new Map();let serial=0,focused=true,clock=0,ticks=0;
 const add=(key,fn)=>events.set(key,fn),remove=key=>events.delete(key);
 const window={addEventListener:add,removeEventListener:remove,requestAnimationFrame:fn=>{raf.set(++serial,fn);return serial;},cancelAnimationFrame:id=>raf.delete(id),
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
 const document={hidden:false,hasFocus:()=>focused,addEventListener:add,removeEventListener:remove};
 const requester=createBackgroundFrameRequester({window,document,now:()=>clock}),engine=new NullEngine();
 engine.customAnimationFrameRequester=requester;engine.onDisposeObservable.add(()=>requester.dispose());engine.runRenderLoop(()=>ticks++);
 assert.equal(raf.size,1);focused=false;events.get('blur')();assert.equal(raf.size,0);assert.equal(timers.size,1);
 const [id,run]=timers.entries().next().value;timers.delete(id);clock=1000/60;run();assert.equal(ticks,1);assert.equal(timers.size,1);
 engine.stopRenderLoop();assert.equal(timers.size,0);assert.equal(requester.proof().pending,0);
 engine.runRenderLoop(()=>ticks++);assert.equal(timers.size,1);engine.dispose();assert.equal(timers.size,0);assert.equal(events.size,0);
});
