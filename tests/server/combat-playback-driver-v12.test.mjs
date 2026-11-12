/** Lightweight original-profile host fixtures; not Native/P2P/WAN evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const players=['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}));
const input={held:[],pressed:[],released:[]};
function fixture(t,playback=1){
  const map={sceneId:'playback-driver-v12',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
    starts:players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*2000,0,0],lineId:0,facingRight:true}))};
  const make=owner=>createSimulation({profile,map,seed:2016,networkOwnerId:owner,
    collisionSampler:()=>[],effectSampler:()=>[],defenderSampler:()=>[],actors:players.map((player,index)=>({...player,position:[index*2000,0,0],lineId:0}))});
  const server=make(null),templates=structuredClone(server.state.actors),events=[];
  const pvp=new PvpMatch({players,map,mode:'2v2',seed:2016,
    versions:{referenceVersion:server.versions.baseline,presetVersion:server.versions.preset,programVersion:CORE_VERSION},
    onRespawn(id){const index=server.state.actors.findIndex(actor=>actor.id===id);server.state.actors[index]=structuredClone(templates[index]);return server.state.actors[index];}});
  const match={id:'playback-driver-room',players,ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:playback};
  const driver=createLocalOwnerBattleDriver({match,simulation:server,pvp,manual:true,clock:()=>0,emit:(type,data)=>events.push({type,data}),finish(){}});
  t.after(()=>driver.stop());for(const player of players)driver.ready(player.id);driver.tick(10);
  const source=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1});
  // A genuine new-mode producer creates the fixture event. Legacy receiver
  // rooms are only used below as negative delivery destinations.
  const baseline=driver.snapshot();baseline.ownership.combatPlaybackVersion=1;sync.reconcile(source,baseline,'a');t.after(()=>sync.clear());
  const step=()=>{sync.beforeStep(source,'a');source.step(1/60,{a:input},{snapshot:false});return sync.afterStep(source,'a',source.drainEvents(),input);};
  const start=()=>{step();source.enter(source.actor('a'),'RSI_OVER_TAKER_COMBO_XXfrontXX','real-frozen-playback-start');
    for(let i=0;i<60;i++){const report=step();if(report?.actions.some(action=>action.playback?.start===true))return report;}
    throw Error('no real playback start was produced');};
  // The producer's ageFrames is internal continuation metadata. Mirror the
  // real online-client wire mapping, with the fixture's source-frame base 0.
  const submit=report=>driver.submitInput('a',{frames:[{held:[],frameSeq:report.frameSeq}],owner:{...report,
    actions:(report.actions??[]).map(({ageFrames=0,...action})=>({...structuredClone(action),frameSeq:Math.max(0,report.frameSeq-ageFrames)}))}});
  return {server,source,sync,driver,events,pvp,match,start,step,submit};
}
test('a new-mode start is admitted once, ACKed before any playback and keeps status independent of a held body',t=>{
  const f=fixture(t),report=f.start();report.actor.x+=100;report.actionFrontierComplete=false;
  const x=f.server.actor('a').x,result=f.submit(report);assert.equal(result.ignored,'actions-pending');assert.deepEqual(result.consumedActionIds,report.actions.map(action=>action.id));
  assert.equal(f.server.actor('a').x,x);assert.equal(f.driver.snapshot().ownership.combatPlaybackVersion,1);
  const outbound=f.events.filter(event=>['owner-status','input'].includes(event.type));assert.deepEqual(outbound.map(event=>event.type),['owner-status','input']);
  assert.ok(outbound[1].data.actions.every(action=>action.playback?.version===1));
  const repeated=f.submit(report);assert.deepEqual(repeated.consumedActionIds,result.consumedActionIds);assert.equal(f.events.filter(event=>event.type==='input').length,1);
});
test('a historical action is rejected in a new room before its changed protection can escape',t=>{
  const f=fixture(t),report=f.start();delete report.actions[0].playback;report.actor.superArmor=true;
  assert.throws(()=>f.submit(report),/combat-playback-required/);assert.equal(f.events.filter(event=>['owner-status','input','owned-state'].includes(event.type)).length,0);
});
test('a legacy room rejects a valid new-mode start even when it supports status and aura independently',t=>{
  const f=fixture(t,0),report=f.start();assert.throws(()=>f.submit(report),/combat-playback-not-negotiated/);
  assert.equal(f.events.filter(event=>['owner-status','input','owned-state'].includes(event.type)).length,0);
});
test('old-life and disconnected playback events cannot enter the current room action or status ledgers',t=>{
  const f=fixture(t),report=f.start(),old=structuredClone(report);old.epoch=0;
  const rejected=f.submit(old);assert.equal(rejected.ignored,'old-life');assert.deepEqual(rejected.consumedActionIds,[]);
  assert.equal(f.events.filter(event=>['owner-status','input'].includes(event.type)).length,0);
  f.submit(report);f.driver.disconnect('a');assert.equal(f.driver.snapshot().owners.a,undefined);assert.equal(f.submit(report).accepted,false);
});
test('a manually constructed new-mode room cannot omit the frozen status and aura dependencies',t=>{
  const f=fixture(t);
  for(const patch of [{ownerStatusVersion:0},{continuousAuraVersion:1},{combatPlaybackVersion:2}])
    assert.throws(()=>createLocalOwnerBattleDriver({match:{...f.match,...patch},simulation:f.server,pvp:f.pvp,manual:true,emit(){},finish(){}}),/invalid-combat-playback-capability/);
});
