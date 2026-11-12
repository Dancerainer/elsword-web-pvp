import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createActorRenderClock} from '../../apps/web/actor-render-clock.mjs';

// Exercise the real render selection expression without creating a WebGL
// window. The actual clock feeds both players, camera and trail consumers.
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const selection=source.match(/const actors=shownActors=([^;]+);/)[1];
function select(actualActors,fixedActors,{playback=true,owner=true,exact=false}={}){
  let remoteSamples=0;
  const actors=runInNewContext(selection,{actualActors,fixedActors,usesCombatPlayback:()=>playback,ownsLocalUnit:()=>owner,
    remoteActorClock:{sample:actors=>{remoteSamples++;return actors;}},localPlayerId:'local',now:100,paused:exact,motionInspector:{active:false}});
  return {actors,remoteSamples};
}
test('negotiated online playback uses the same fractional completed steps as practice for both players',()=>{
  const clock=createActorRenderClock(),actors=['local','remote'].map((id,i)=>({id,x:i*200,y:0,z:0,state:'RSI_DASH',stateSerial:1,
    animationName:'Dash',animationTime:0,animationTransitionSerial:1}));
  clock.reset(actors);for(const actor of actors){actor.x+=20;actor.animationTime+=1/60;}clock.push(actors);
  const before=structuredClone(actors),positions=[];
  for(const alpha of [0,.25,.5,.75,1]){
    const fixed=clock.sample(actors,alpha),online=select(actors,fixed),practice=select(actors,fixed,{playback:false,owner:false});
    assert.equal(online.actors,fixed);assert.deepEqual(online.actors,practice.actors);assert.equal(online.remoteSamples,0);
    positions.push(online.actors[0].x);assert.equal(online.actors[1].x,200+20*alpha);
  }
  assert.deepEqual(positions,[0,5,10,15,20]);assert.deepEqual(actors,before,'display cannot change combat or contacts');
});
test('paused inspection remains exact and legacy remote observation keeps its own source buffer',()=>{
  const actors=[{id:'local',x:20,y:0,z:0}],clock=createActorRenderClock();clock.reset(actors);
  const fixed=clock.sample(actors,.25,{exact:true});assert.equal(select(actors,fixed,{exact:true}).actors[0],actors[0]);
  assert.equal(select(actors,fixed,{playback:false}).remoteSamples,1);
});
