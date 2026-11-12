import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isSafeBrowserPort,listenOnSafePort,analyzeGmTrace} from '../../tools/validation/browser-gm-remote-v34-analysis.mjs';

test('safe-port allocation keeps the selected listener and retries browser forbidden ephemeral ports',async()=>{
  class Server extends EventEmitter{
    ports=[6667,10080,43125];closed=0;
    listen(_port,_host,done){this.port=this.ports.shift();queueMicrotask(done);}
    address(){return {port:this.port};}
    close(done){this.closed++;done();}
  }
  const server=new Server();assert.equal(await listenOnSafePort(server),43125);assert.equal(server.closed,2);
  for(const port of [0,1023,6000,6667,10080,65536,NaN])assert.equal(isSafeBrowserPort(port),false);
});

test('contact analysis distinguishes victim-owned receipts and exposes asynchronous four-position evidence',()=>{
  const gm={id:'gm',x:0,y:0,z:0},rf={id:'rf',x:90,y:0,z:0};
  const hit={type:'hit',actorId:'gm',targetId:'rf',phase:'near-jump-x',observedAt:1000,eventStepLag:0,origin:{state:'RSI_JUMP_COMBO_X'},actors:[gm,rf]};
  const row={at:1010,step:1,phase:'near-jump-x',actors:[{...gm,x:5},{...rf,x:95}]};
  const result=analyzeGmTrace([{rows:[row],events:[hit],skippedSteps:0},{rows:[],events:[hit],skippedSteps:2}],['gm','rf']);
  assert.equal(result.committedVictimHits.length,1,'attacker speculative feedback is not counted twice');
  const value=result.nearGmJumpXHits[0];assert.equal(value.view,1);assert.equal(value.counterpartSampleGapMs,10);
  assert.equal(value.attackerOwner.x,5);assert.equal(value.attackerSeenByVictim.x,0);
  assert.equal(value.victimOwner.x,90);assert.equal(value.victimSeenByAttacker.x,95);assert.deepEqual(result.skippedSteps,[0,2]);
});

test('motion evidence normalizes observed tick gaps and keeps actual skill phases separate',()=>{
  const actor=(x)=>({id:'rf',x,y:0,z:0,state:'RSI_DASH',stateSerial:3});
  const row=(step,x,phase='remote-motion')=>({at:step*17,step,phase,actors:[actor(x)],rendered:[actor(x-5)]});
  const result=analyzeGmTrace([{rows:[row(1,0),row(3,40),row(4,340,'near-jump-x')],events:[],skippedSteps:1},{rows:[],events:[],skippedSteps:0}],['gm','rf']);
  assert.equal(result.maxRemoteMotionDistancePerObservedTick,20);assert.equal(result.remoteMotionSamples,1);assert.equal(result.maxRenderGap,5);
});

test('browser observer is read-only, bounded by RAF and declares intermediate skipped simulation steps',async()=>{
  let step=1,callback=null;const actor=Object.freeze({id:'gm',x:0,y:0,z:0,state:'RSI_WAIT',stateSerial:1});
  const events=[Object.freeze({type:'hit',eventId:1,step:1,actorId:'gm',targetId:'rf',amount:5})];
  const workbench=Object.freeze({snapshot:()=>({step,time:step/60,actors:[actor]}),renderSnapshot:()=>({mode:'online',localPlayerId:'gm',actors:[actor]}),events:()=>events});
  const context={window:{rfWorkbench:workbench},Date,performance:{now:()=>step*17},requestAnimationFrame:fn=>(callback=fn,1),cancelAnimationFrame:()=>{callback=null;}};
  vm.runInNewContext(await readFile(new URL('../../tools/validation/browser-gm-remote-v34-observer.js',import.meta.url),'utf8'),context);
  context.window.__gmRemoteV34.phase('remote-motion');context.window.__gmRemoteV34.start();callback();step=4;callback();
  const result=context.window.__gmRemoteV34.stop();assert.equal(result.rows.length,2);assert.equal(result.events.length,1);
  assert.equal(result.skippedSteps,2);assert.equal(result.events[0].eventStepLag,0);assert.equal(actor.x,0);
});
