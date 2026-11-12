/** Frozen local-owner room, independent status and exact attack receipts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const players=['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}));
const map={sceneId:'status-driver-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*1000,0,0],lineId:0,facingRight:true}))};
function fixture(t,{status=1,aura=0}={}){
  const sim=createSimulation({profile,map,actors:players.map((player,index)=>({...player,position:[index*1000,0,0]})),seed:2016}),events=[];
  const templates=structuredClone(sim.state.actors),pvp=new PvpMatch({players,map,mode:'2v2',seed:2016,
    versions:{referenceVersion:sim.versions.baseline,presetVersion:sim.versions.preset,programVersion:CORE_VERSION},
    onRespawn(id){const index=sim.state.actors.findIndex(actor=>actor.id===id);sim.state.actors[index]=structuredClone(templates[index]);return sim.state.actors[index];}});
  const driver=createLocalOwnerBattleDriver({match:{id:'status-room',players,ownerStatusVersion:status,continuousAuraVersion:aura},simulation:sim,pvp,manual:true,clock:()=>0,
    emit:(type,data)=>events.push({type,data}),finish(){}});t.after(()=>driver.stop());for(const player of players)driver.ready(player.id);driver.tick(10);assert.equal(driver.snapshot().pvp.phase,'fight');
  const report=(frame,revision=1)=>{const value=encodeOwnedState(sim,'a',{epoch:driver.snapshot().ownership.actors.a.epoch,frameSeq:frame});
    value.actor.sourceStatusClock={version:1,revision,frameSeq:frame};return value;};
  return {sim,pvp,driver,events,report,submit:value=>driver.submitInput('a',{frames:[{held:[],frameSeq:value.frameSeq}],owner:value})};
}
test('status escapes a held attack frontier without moving or acknowledging its newest body',t=>{
  const f=fixture(t),value=f.report(6);value.actor.superArmor=true;value.actor.x+=100;value.actionFrontierComplete=false;
  const x=f.sim.actor('a').x,result=f.submit(value);assert.equal(result.ignored,'actions-pending');assert.deepEqual(result.consumedActionIds,[]);
  const events=f.events.filter(row=>row.type==='owner-status');assert.equal(events.length,1);assert.equal(events[0].data.status.actor.superArmor,true);
  assert.equal(f.events.filter(row=>row.type==='owned-state').length,0);assert.equal(f.sim.actor('a').x,x);assert.equal(f.sim.actor('a').superArmor,false);
  const seed=f.driver.snapshot();assert.equal(seed.ownership.ownerStatusVersion,1);assert.equal(seed.owners.a.frameSeq,0);assert.equal(seed.owners.a.status.frameSeq,6);
});
test('status revision changes and periodic calibration emit once, without re-emitting duplicate revisions',t=>{
  const f=fixture(t),first=f.report(6);f.submit(first);const same=f.report(9);same.actor.sourceStatusClock=first.actor.sourceStatusClock;f.submit(same);
  const calibration=f.report(36,2);f.submit(calibration);f.submit(first);
  const events=f.events.filter(row=>row.type==='owner-status');assert.equal(events.length,2);assert.deepEqual(events.map(row=>row.data.status.actor.sourceStatusClock.revision),[1,2]);
  assert.equal(f.driver.snapshot().owners.a.status.frameSeq,36);
});
test('legacy rooms reject status markers and new rooms require the negotiated clock',t=>{
  const old=fixture(t,{status:0});assert.throws(()=>old.submit(old.report(6)),/owner-status-not-negotiated/);
  const current=fixture(t);const report=current.report(6);delete report.actor.sourceStatusClock;assert.throws(()=>current.submit(report),/owner-status-clock-required/);
});
test('a full source reference failure cannot publish a priority status',t=>{
  const f=fixture(t),value=f.report(6);value.actor.state='NOT_IN_FROZEN_PROFILE';assert.throws(()=>f.submit(value),/unknown-owner-action/);
  assert.equal(f.events.filter(row=>row.type==='owner-status').length,0);
});
test('a higher revision cannot move its source frame backward',t=>{
  const f=fixture(t);f.submit(f.report(36,2));assert.throws(()=>f.submit(f.report(9,3)),/owner-status-frame-regression/);
  assert.equal(f.events.filter(row=>row.type==='owner-status').length,1);assert.equal(f.driver.snapshot().owners.a.status.frameSeq,36);
});
test('old lives and disconnected owners cannot publish or retain status',t=>{
  const f=fixture(t),old=f.report(6);old.epoch=0;assert.equal(f.submit(old).ignored,'old-life');assert.equal(f.events.filter(row=>row.type==='owner-status').length,0);
  f.submit(f.report(9));assert.ok(f.driver.snapshot().owners.a.status);f.driver.disconnect('a');assert.equal(f.driver.snapshot().owners.a,undefined);
  assert.equal(f.submit(f.report(12)).accepted,false);
});
test('aura room v2 accepts its exact marker and rejects mixed v1 history',t=>{
  const f=fixture(t,{aura:2});Object.assign(f.sim.actor('a').awakening,{full:true,remaining:8});f.sim.spawnSet(f.sim.actor('a'),'EffectSet_RAVEN_HYPER_AURA');
  const effect=f.sim.state.effects.find(row=>row.name==='RAVEN_HYPER_AURA');assert.ok(effect);Object.assign(effect,{active:true,sourceContinuousAura:{version:2,revision:1,phase:'active'}});
  const value=f.report(6);assert.equal(f.driver.snapshot().ownership.continuousAuraVersion,2);assert.equal(f.submit(value).accepted,true);
  value.frameSeq=9;value.actor.sourceStatusClock.frameSeq=9;value.effects.find(row=>row.name==='RAVEN_HYPER_AURA').sourceContinuousAura.version=1;
  assert.throws(()=>f.submit(value),/continuous-aura-not-negotiated/);
});
