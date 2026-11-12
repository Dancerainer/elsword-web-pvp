import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {createFrameSupervisor} from '../../apps/web/frame-supervisor.mjs';

test('a caught battle error retains Babylon RAF scheduling and stops corrupt battle steps',()=>{
  const engine=new NullEngine(),queued=[],faults=[];let calls=0;
  engine._queueNewFrame=()=>{queued.push(true);return queued.length;};
  const supervisor=createFrameSupervisor({clock:()=>12,onFault:fault=>faults.push(fault)});
  engine.runRenderLoop(supervisor.wrap(stage=>{calls++;stage('owner-report');throw Error('invalid-owner-actor-shape:presentationTransition');}));
  try{
    queued.pop();engine._renderLoop(0);
    assert.equal(calls,1);assert.equal(queued.length,1,'next engine frame still scheduled');
    assert.equal(faults.length,1);assert.equal(faults[0].stage,'owner-report');
    queued.pop();engine._renderLoop(16);
    assert.equal(calls,1,'partially mutated battle must not continue');assert.equal(queued.length,1);
    assert.equal(supervisor.proof().message,'invalid-owner-actor-shape:presentationTransition');
  }finally{engine.dispose();}
});

test('a failing fault reporter cannot interrupt the engine scheduling callback',()=>{
  const supervisor=createFrameSupervisor({onFault:()=>{throw Error('report failed');}}),saved=console.error;
  let reported=0;console.error=()=>reported++;
  try{assert.doesNotThrow(()=>supervisor.wrap(()=>{throw Error('battle failed');})());assert.equal(reported,1);}
  finally{console.error=saved;}
});

test('presentation faults skip only their stage and never stop later combat frames',()=>{
 const faults=[],logs=[],supervisor=createFrameSupervisor({onFault:p=>faults.push(p),onPresentationFault:p=>logs.push(p)});
 let combat=0,hud=0;
 const frame=supervisor.wrap(()=>{combat++;supervisor.presentation('effects',()=>{throw TypeError("Cannot read properties of undefined (reading 'raw')");});supervisor.presentation('hud',()=>hud++);});
 for(let i=0;i<100;i++)frame();
 assert.equal(combat,100);assert.equal(hud,100);assert.equal(faults.length,0);assert.equal(logs.length,6);
 assert.equal(supervisor.presentationProof()[0].count,100);assert.equal(supervisor.proof(),null);
 const recovery=supervisor.presentation('effects',()=>42);assert.equal(recovery,42);
 supervisor.wrap(stage=>{stage('combat');throw Error('invalid combat state');})();frame();
 assert.equal(combat,100);assert.equal(faults.length,1);
});
