import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import gm from '../../packages/combat-core/gm-profile.json' with {type:'json'};
import evidence from '../../contracts/source-distance-native-v45.json' with {type:'json'};
import {sourceStopDuration,sourceStopRadii} from '../../packages/combat-core/source-stop-distance-v45.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const map={sceneId:'source-stop-distance-test',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const actor=(id,x,y=0,z=0,team=1)=>({id,x,y,z,team});
const near=(actual,wanted)=>assert.ok(Math.abs(actual-wanted)<1e-6,`${actual} vs ${wanted}`);
function fixture(positions,options={}){
 const actors=[{id:'cast',professionId:'GM',team:0,position:[0,0,0],lineId:0},
  ...positions.map(([id,x,y=0,z=0,team=1])=>({id,professionId:'GM',team,position:[x,y,z],lineId:z===0?0:null}))];
 const sim=createSimulation({profile:gm,map,preset:{passives:[],guildPassives:[]},actors,...options});
 return {sim,a:sim.actor('cast')};
}
function originalStop(sim,a){
 sim.enter(a,'ESI_HYPER_MODE','original-gm-stop-fixture');
 const row=sim.profileFor(a).states[a.state].raw.STOP_OTHER_UNIT0;
 assert.deepEqual(row,{'1':.03,'2':1.4});
 sim.processStateEvents(a,.03-1e-6,.03+1e-6);return row;
}

test('original PvP STOP and STOP2 iterator policy uses strict full/half boundaries and XYZ distance',()=>{
 assert.equal(evidence.unitStop.pvpGameType1.fullDurationWhen,'d < 1300');
 assert.deepEqual(sourceStopRadii(),{fullRadius:1300,halfRadius:2000});
 const a=actor('a',0,0,0,0);
 for(const[x,expected]of [[0,2],[1299,2],[1300,1],[1999,1],[2000,0],[2100,0]])assert.equal(sourceStopDuration(a,actor('b',x),2),expected);
 assert.equal(sourceStopDuration(a,actor('b',0,0,1500),2),1,'depth contributes to Euclidean distance');
 assert.equal(sourceStopDuration(a,actor('b',0,2000,0),2),0,'height contributes to the outer cutoff');
 assert.equal(sourceStopDuration(a,actor('b',780,1040),2),1,'3D length exactly1300 is in half band');
 assert.equal(sourceStopDuration(a,a,2),0,'Other never stops its source');
 assert.equal(sourceStopDuration(a,actor('ally',100,0,0,0),2),2,'ordinary PvP Other includes teammates');
 assert.equal(sourceStopDuration(a,actor('ally',100,0,0,0),2,{otherTeam:true}),0);
});

test('original native modes2..4 retain their independent700/800 radii; source-own All override bypasses ordinary bands',()=>{
 const a=actor('a',0,0,0,0);
 for(const nativeGameType of [2,3,4]){
  const options={nativeGameType};assert.deepEqual(sourceStopRadii(nativeGameType),{fullRadius:700,halfRadius:800});
  assert.equal(sourceStopDuration(a,actor('b',699),2,options),2);
  assert.equal(sourceStopDuration(a,actor('b',700),2,options),1);
  assert.equal(sourceStopDuration(a,actor('b',800),2,options),0);
  assert.equal(sourceStopDuration(a,actor('ally',1,0,0,0),2,options),0);
 }
 assert.equal(sourceStopDuration(a,a,2,{kind:'all',ownDuration:.4}),.4);
 assert.throws(()=>sourceStopRadii(99),TypeError);assert.throws(()=>sourceStopDuration(a,actor('b',1),NaN),TypeError);
});

test('actual original GM STOP appends per recipient and the next outer update selects its last request',()=>{
 const {sim,a}=fixture([['near',1299],['at1300',1300],['middle',1999],['at2000',2000],['ally',1200,0,0,0]]);
 sim.actor('middle').worldStop=2;const before=structuredClone(sim.actor('at2000'));originalStop(sim,a);
 assert.equal(sim.actor('near').worldStop,0,'the setter itself does not update scalar caches');
 for(const b of sim.state.actors)advanceActorStops(b,0);
 near(sim.actor('near').worldStop,1.4);near(sim.actor('at1300').worldStop,.7);
 near(sim.actor('middle').worldStop,.7);
 assert.equal(sim.actor('at2000').worldStop,0);near(sim.actor('ally').worldStop,1.4);assert.equal(a.worldStop,0);
 assert.equal(sim.actor('at2000').hp,before.hp);assert.equal(sim.actor('at2000').mp,before.mp);
 const event=sim.state.events.find(e=>e.type==='worldStop');assert.equal(event.distancePolicy,'source-stop-distance-v45');
 assert.equal(event.aggregation,'target2016-user-last-record');
});

test('real GM source stop freezes nearby movement while an outer-boundary actor continues, and snapshot replay remains deterministic',()=>{
 const first=fixture([['near',1299],['far',2000]]);originalStop(first.sim,first.a);
 const saved=first.sim.snapshot(),second=fixture([['near',1299],['far',2000]]);second.sim.restore(structuredClone(saved));
 const x=first.sim.actor('near').x,farX=first.sim.actor('far').x;
 for(let i=0;i<10;i++)for(const sim of [first.sim,second.sim])sim.step(1/60,{near:{held:['RIGHT']},far:{held:['RIGHT']}});
 assert.equal(first.sim.actor('near').x,x);assert.ok(first.sim.actor('far').x>farX);
 assert.deepEqual(first.sim.snapshot(),second.sim.snapshot());
});

test('actual remote GM source event catch-up shares strict recipient policy and does not refresh duplicate controls',()=>{
 for(const[x,expected]of [[1299,1.4],[1300,.7],[1999,.7],[2000,0]]){
  const {sim,a}=fixture([['local',x]],{networkOwnerId:'local'});originalStop(sim,a);
  const local=sim.actor('local');local.worldStop=0;a.animationTime=.03;a.animationPlaybackSpeed=1;
  const presentation=createOwnedPresentation({clock:()=>0});presentation.consume(sim,new Map(),'local',()=>1);
  advanceActorStops(local,0);
  near(local.worldStop,expected);const after=local.worldStop;presentation.consume(sim,new Map(),'local',()=>1);near(local.worldStop,after);
  assert.equal(local.hp,local.hpMax);
 }
});
