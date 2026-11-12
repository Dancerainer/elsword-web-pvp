/** Real ownership producer over the frozen three Raven declarations.
 * No Native clocks, original-client networking or WAN performance claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {CONTINUOUS_AURA_NAME,CONTINUOUS_AURA_SET} from '../../packages/combat-core/continuous-aura.mjs';

const profiles=Object.fromEntries(['RF','BM','VC'].map(id=>[id,JSON.parse(readFileSync(
  new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const map={sceneId:'raven-aura-producer-v11',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(profession,version){
  const profile=profiles[profession],sim=createSimulation({profile,map,networkOwnerId:'source',actors:[
    {id:'source',professionId:profession,team:0,position:[0,0,0]},
    {id:'victim',professionId:profession,team:1,position:[1000,0,0]}]});
  const actor=sim.actor('source');Object.assign(actor.awakening,{full:true,remaining:30});
  const effect=sim.createEffect(actor,structuredClone(profile.effectSets[CONTINUOUS_AURA_SET].raw.EFFECT0),{setName:CONTINUOUS_AURA_SET,clock:'custom'});
  Object.assign(effect,{active:true,dead:false,elapsed:.1,animationTime:.1,setElapsed:.1});
  actor.sourceAwakeningAuraEffectGroup=[{id:effect.id,name:effect.name,setName:effect.setName}];
  const sync=createLocalOwnershipSync({continuousAuraVersion:version,clock:()=>0});
  function step(events=[]){
    const report=sync.afterStep(sim,'source',events);if(!report)return null;
    const clean=validateOwnedState({...report,actions:report.actions.map(({ageFrames,...action})=>action)});
    validateOwnedReferences(clean,actor,profile,map,{profiles:sim.profiles,actors:sim.state.actors});return report;
  }
  return {sim,actor,effect,sync,step};
}
const auraStates=report=>(report?.actions??[]).flatMap(action=>action.effects).filter(effect=>effect.name===CONTINUOUS_AURA_NAME);

for(const profession of ['RF','BM','VC'])for(const version of [0,1,2])test(`${profession} mode ${version} selects its negotiated lifecycle or legacy three-frame samples`,()=>{
  const f=fixture(profession,version),reports=[];
  for(let frame=1;frame<=12;frame++){const report=f.step();if(report)reports.push(report);}
  const managed=version===2||version===1&&profession==='RF';
  const samples=reports.flatMap(report=>report.actions.map(action=>({action,effects:action.effects.filter(effect=>effect.name===CONTINUOUS_AURA_NAME)}))).filter(row=>row.effects.length);
  assert.ok(reports.length>=4,'the ordinary calibration cadence remains active');
  if(managed){
    assert.equal(samples.length,1);assert.equal(samples[0].action.frameSeq,1);
    assert.deepEqual(samples[0].effects[0].sourceContinuousAura,{version,revision:1,phase:'active'});
    assert.equal(f.sync.sampledEffectCount,0,'the live aura does not enter periodic historical collision sampling');
    assert.equal(f.sync.continuousAuraDiagnostics.localActive,1);
    for(const report of reports)assert.deepEqual(report.effects[0].sourceContinuousAura,{version,revision:1,phase:'active'});
  }else{
    assert.deepEqual(samples.map(row=>row.action.frameSeq),[1,4,7,10]);
    assert.ok(samples.every(row=>row.effects[0].sourceContinuousAura===undefined));
    assert.ok(reports.every(report=>report.effects[0].sourceContinuousAura===undefined));
    assert.equal(f.sync.sampledEffectCount,1);assert.equal(f.sync.continuousAuraDiagnostics.localActive,0);
  }
  f.sync.clear();assert.equal(f.sim.continuousAuraVersion,0);
});

for(const profession of ['RF','BM','VC'])test(`${profession} mode 2 sends renewal and end once while retaining the original collider and accepted hit gap`,()=>{
  const f=fixture(profession,2),born=f.step(),id=f.effect.id;assert.equal(auraStates(born).length,1);
  const hits=f.effect.hits,gaps=f.effect.hitGaps;hits.victim=.1;gaps.victim=2.5;
  for(let frame=2;frame<=5;frame++)assert.equal(auraStates(f.step()).length,0);
  f.actor.awakening.remaining=60;
  const renewal=f.step([{actorId:'source',type:'reawakenCoreRefill'}]);
  assert.deepEqual(auraStates(renewal).map(effect=>effect.sourceContinuousAura),[{version:2,revision:2,phase:'active'}]);
  assert.equal(auraStates(renewal)[0].id,id);assert.equal(f.sim.state.effects[0],f.effect);
  assert.equal(f.effect.hits,hits);assert.equal(f.effect.hitGaps,gaps);assert.equal(hits.victim,.1);assert.equal(gaps.victim,2.5);
  f.sim.state.effects=[];Object.assign(f.actor.awakening,{full:false,remaining:0});
  const end=f.step();assert.deepEqual(auraStates(end).map(effect=>effect.sourceContinuousAura),[{version:2,revision:3,phase:'ended'}]);
  assert.equal(end.effects.length,0);assert.equal(auraStates(end)[0].active,false);assert.equal(auraStates(end)[0].dead,true);
  for(let frame=0;frame<6;frame++)assert.equal(auraStates(f.step()).length,0);
  assert.equal(f.sync.continuousAuraDiagnostics.localActive,0);f.sync.clear();
});

test('mode 2 same-tick birth retirement cannot synthesize an active legacy sample from a display event',()=>{
  const f=fixture('BM',2);f.actor.hp=0;f.effect.dead=true;f.sim.state.effects=[];
  const report=f.step([{actorId:'source',type:'effectStarted',effectId:f.effect.id,
    name:CONTINUOUS_AURA_NAME,setName:CONTINUOUS_AURA_SET,ownerStateSerial:f.actor.stateSerial}]);
  assert.ok(report);assert.equal(auraStates(report).some(effect=>effect.active&&!effect.dead),false);
  assert.equal(f.sync.sampledEffectCount,0);assert.equal(f.sync.continuousAuraDiagnostics.localActive,0);f.sync.clear();
});
