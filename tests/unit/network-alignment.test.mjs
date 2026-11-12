import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from '@babylonjs/core';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {placeActor} from '../../apps/web/actor-presentation.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const input={held:[],pressed:[],released:[]};
function owner(){
  const simulation=createSimulation({profile,networkOwnerId:'local',map:{sceneId:'timing-fixture',lines:[
    {lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    actors:[{id:'local',team:0,position:[0,0,0]},{id:'remote',team:1,position:[5000,0,0]}]});
  const sync=createLocalOwnershipSync();
  sync.reconcile(simulation,{snapshot:simulation.snapshot(),ownership:{mode:'local-owner-v1',actors:{local:{epoch:1,frameSeq:0},remote:{epoch:1,frameSeq:0}}},
    owners:{},pvp:{phase:'fight',fightTime:0,players:simulation.state.actors.map(a=>({id:a.id,alive:true,connected:true}))}},'local');
  return {simulation,sync,step(keys=input,events=[]){sync.beforeStep(simulation,'local');simulation.step(1/60,{local:keys},{snapshot:false});
    return sync.afterStep(simulation,'local',[...simulation.drainEvents(),...events]);}};
}

test('movement start, reversal and stop report their exact owner tick without waiting for the periodic send',()=>{
  const f=owner();
  assert.equal(f.step({held:['RIGHT'],pressed:['RIGHT'],released:[]})?.frameSeq,1);
  assert.equal(f.step({held:['LEFT'],pressed:['LEFT'],released:['RIGHT']})?.frameSeq,2);
  f.step({held:['LEFT'],pressed:[],released:[]});
  const stopped=f.step({held:[],pressed:[],released:['LEFT']});
  assert.equal(stopped?.frameSeq,4);assert.equal(stopped.actor.state,'RSI_WAIT');
});

test('unchanged ownership still uses 20 Hz while a victim receipt is sent at its originating tick exactly once',()=>{
  const f=owner(),reports=[];
  for(let frame=1;frame<=60;frame++){const report=f.step();if(report)reports.push(report);}
  assert.equal(reports.length,20);
  const hit={type:'hit',targetId:'local',actorId:'remote',amount:10,eventId:777};
  const urgent=f.step(input,[hit]);assert.equal(urgent?.frameSeq,61);assert.deepEqual(urgent.hits,[{id:777,attackerId:'remote',damage:10}]);
  const following=[];
  for(let frame=62;frame<=67;frame++){const report=f.step();if(report)following.push(report);}
  assert.deepEqual(following.map(report=>report.frameSeq),[64,67],'the urgent receipt resets the next ordinary deadline');
  for(const report of following)assert.deepEqual(report.hits,[],'a victim receipt is emitted only once by its producer');
});

test('remote model root extraction and skill identity stay on the displayed controller, not the newest packet',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0});
  const a={id:'remote',x:0,y:0,z:0,facing:1,state:'old',stateSerial:1,animationName:'Old',animationTime:.2,
    animationTransitionSerial:1,consumeRootTranslation:false,skillId:24010,stateTime:.2};
  const b={...a,x:50,state:'new',stateSerial:2,animationName:'New',animationTime:0,consumeRootTranslation:true,skillId:null,stateTime:0};
  clock.observe(a,{epoch:1,frameSeq:3,at:50});clock.observe(b,{epoch:1,frameSeq:6,at:100});
  const shown=clock.sample([b],'local',{now:75})[0];
  const view={root:{position:new Vector3(),rotation:new Vector3()},bip01:{position:new Vector3()},sample:{rootTranslation:[30,0,20]}};
  placeActor(view,shown);
  assert.equal(shown.state,'old');assert.equal(shown.skillId,24010);assert.equal(shown.stateTime,.2);
  assert.equal(view.bip01.position.x,30);assert.equal(view.bip01.position.z,20);
  const next=clock.sample([b],'local',{now:100})[0];placeActor(view,next);assert.equal(next.skillId,null);assert.equal(view.bip01.position.x,0);
  assert.equal(b.x,50);assert.equal(b.consumeRootTranslation,true);
});

test('a stable 20 Hz track needs only one report interval of display buffer, without holds or extrapolation',()=>{
  const clock=createRemoteActorClock(),own={id:'local'},remote={id:'remote',x:0,y:0,z:0,state:'walk',stateSerial:1,facing:1,
    animationName:'Walk',animationTime:0,animationTransitionSerial:1};let frame=0,last;
  for(let display=0;display<=432;display++){
    const now=display*1000/144;
    while((frame+3)*1000/60+70<=now+1e-7){frame+=3;clock.observe({...remote,x:frame*1000/60,animationTime:frame/60},{epoch:1,frameSeq:frame,at:frame*1000/60+70});}
    const shown=clock.sample([own,remote],'local',{now});assert.equal(shown[0],own);
    if(now<1000)continue;
    assert.ok(Math.abs(shown[1].x-(now-120))<1e-6);
    if(last!==undefined)assert.ok(Math.abs(shown[1].x-last-1000/144)<1e-6);last=shown[1].x;
    assert.ok(shown[1].x<=frame*1000/60+1e-7);
  }
});

test('idle HTTP ownership uploads immediately, coalesces in flight, and backs off failed sends',async t=>{
  let now=0;const requests=[],pending=[],intervals=[];
  const oldInterval=globalThis.setInterval,oldClear=globalThis.clearInterval;
  globalThis.setInterval=callback=>{intervals.push(callback);return 1;};globalThis.clearInterval=()=>{};
  class Source{addEventListener(){}close(){}}
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,clock:()=>now,
    fetch:async(url,options)=>url==='/api/online/input'?new Promise(resolve=>{requests.push({at:now,value:JSON.parse(options.body)});pending.push(resolve);}):{ok:true,json:async()=>({})}});
  t.after(()=>{client.close();globalThis.setInterval=oldInterval;globalThis.clearInterval=oldClear;for(const resolve of pending)resolve({ok:true,json:async()=>({})});});
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  await client.open();await client.setMatch({id:'match',ownership:'local-owner-v1',players:[{id:'local'}]},'local');
  const report=frameSeq=>({epoch:1,frameSeq,actor:{},effects:[],hits:[],actions:[]});
  now=17;client.send(input,report(1));assert.equal(requests.length,1);assert.equal(requests[0].at,17);
  now=33;client.send(input,report(2));now=50;client.send(input,report(3));assert.equal(requests.length,1);
  now=60;pending.shift()({ok:true,json:async()=>({})});await settle();assert.equal(requests[1].value.owner.frameSeq,3);assert.equal(requests[1].at,60);
  pending.shift()({ok:false,status:503,json:async()=>({error:'temporary'})});await settle();
  now=70;client.send(input,report(4));await intervals[0]();assert.equal(requests.length,2);
  now=109;client.send(input,report(5));await intervals[0]();assert.equal(requests.length,2);
  now=110;void intervals[0]();assert.equal(requests.length,3);assert.equal(requests[2].value.owner.frameSeq,5);
});

test('one-tick root movement in an urgent report is smoothed without overshoot, local mutation or a delayed controller boundary',()=>{
  const clock=createRemoteActorClock({minDelayMs:0,maxDelayMs:0}),remote={id:'remote',x:0,y:0,z:0,facing:1,
    state:'walk',stateSerial:1,animationName:'Walk',animationTime:0,animationTransitionSerial:1,lineId:0};
  for(const [frameSeq,x]of [[3,0],[6,0],[7,50],[9,50],[12,50]])clock.observe({...remote,x,
    state:frameSeq<7?'walk':'attack',stateSerial:frameSeq<7?1:2},{epoch:1,frameSeq,at:frameSeq*1000/60});
  const own={id:'local',x:10},steps=[];let previous=0;
  for(let frame=8;frame<=24;frame++){
    const now=frame*1000/120,shown=clock.sample([own,remote],'local',{now});
    assert.equal(shown[0],own);assert.ok(shown[1].x>=0&&shown[1].x<=50);
    steps.push(Math.abs(shown[1].x-previous));previous=shown[1].x;
    assert.equal(shown[1].state,now<7*1000/60?'walk':'attack');
  }
  assert.ok(Math.max(...steps)<25,'confirmed 50-unit/one-source-tick movement must not retain its unfiltered 25-unit display step');
  assert.equal(previous,50);assert.deepEqual(own,{id:'local',x:10});assert.equal(remote.x,0);
});
