import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraHandoff} from '../../apps/web/camera-handoff.mjs';
import {createSpectatorCamera} from '../../apps/web/spectator-camera.mjs';
import {createResultPresentation} from '../../apps/web/result-presentation.mjs';
import audio from '../../contracts/rf-pvp-audio-assets-v1.json' with {type:'json'};
test('death camera waits through fall and alpha fade; cycling starts only after model disappears',()=>{
  const me={id:'me',team:0,hp:0,hidden:false,deathComplete:false},ally={id:'ally',team:0,hp:100};
  const state={localId:'me',actors:[me,ally],players:[{id:'me',team:0,alive:false,connected:true},{id:'ally',team:0,alive:true,connected:true}]};
  const c=createSpectatorCamera();assert.equal(c.update(state).kind,'death');assert.equal(c.cycle(1),false);
  me.animationStopped=true;me.death={alpha:.01};assert.equal(c.update(state).targetId,'me');
  me.hidden=true;assert.equal(c.update(state).targetId,'ally');assert.equal(c.view().kind,'ally');
});
test('handoff begins at outgoing camera, reaches new camera in .45s, and changing targets has no discontinuity',()=>{
  const c=createCameraHandoff(),a={eye:[0,10,100],target:[0,10,0],up:[0,1,0]},b={eye:[1000,10,100],target:[1000,10,0],up:[0,1,0]};
  c.apply(a,'me',0);assert.deepEqual(c.apply(b,'ally',0),a);
  const midway=c.apply(b,'ally',.225);assert.equal(midway.eye[0],500);
  assert.deepEqual(c.apply(a,'enemy',0),midway);assert.deepEqual(c.apply(a,'enemy',.45),a);
  assert.deepEqual(c.apply(b,'revived',0,{transition:false}),b);
});
test('WIN/LOSE uses original audio duration before dialog; muted playback and cancellation are safe',()=>{
  const order=[],pending=new Map();let id=0;
  const timers={setTimeout(fn,delay){pending.set(++id,{fn,delay});return id;},clearTimeout(id){pending.delete(id);}};
  const p=createResultPresentation({timers,hud:()=>({announceResult:r=>{order.push('announce:'+r.outcome);return r.outcome;},result:()=>order.push('dialog')}),
    playSound:name=>{order.push(name);return false;},durationFor:name=>audio.files.find(row=>row.source.endsWith('/'+name)).durationSeconds});
  const r={outcome:'win'};p.present(r);assert.deepEqual(order,['announce:win','Win.ogg']);assert.equal(p.present(r),false);
  const job=[...pending.values()][0];assert.ok(job.delay>1000);job.fn();assert.equal(order.at(-1),'dialog');
  p.present({outcome:'loss'});const late=[...pending.values()].at(-1);p.clear();late.fn();assert.equal(order.at(-1),'Lose.ogg');
  p.present({outcome:'draw'});assert.equal(order.at(-1),'announce:draw');
});
