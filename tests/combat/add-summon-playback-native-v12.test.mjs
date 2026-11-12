/** Genuine MM Hyperactive input, source WASM and independent original NPC1604
 * bones. Web recipient playback evidence, not a target-client/WAN recording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addFixture,addMap} from '../helpers/add-fixture.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {loadAddSummonAssets} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {finishAddApocalypse,applyAddSummonDamage,npcHitTargets,triggerAddApocalypseEmergency,startAddApocalypse} from '../../packages/combat-core/add-summons.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../artifacts/'+file,import.meta.url))),profile=PROFESSION_PROFILES.MM;
const npc=await loadAddSummonAssets({base:'mm/',data:read,profile}),info=read('mm/manifest.json'),raw=read('mm/'+info.runtimePose),
  visual=mergeVisualEffectIndexes(...(info.visualEffectIndexes??[]).map(file=>read('mm/'+file)),npc.fxIndex),
  effectIndex=mergeEffectIndexes(read('mm/'+info.effectAssetIndex),visual),effectPoses=Object.fromEntries(collectEffectPoseFiles(effectIndex,visual).map(file=>[file,read('mm/'+file)]));
const samplers={...createNativeSamplers({profile,characterPose:composeCharacterPose(raw,raw.sharedPose?read('mm/'+raw.sharedPose):null),effectIndex,effectPoses,map:addMap}),...createAddSummonSamplers(npc)};
const empty={held:[],pressed:[],released:[],sampledDevice:true},dt=1/60;
function owner(id){
  const {sim}=addFixture('MM',{skillId:29604,networkOwnerId:id,samplers}),sync=createLocalOwnershipSync({ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1});
  sync.reconcile(sim,{snapshot:sim.snapshot(),owners:{},ownership:{mode:'local-owner-v1',ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1,
    actors:{add:{epoch:1,frameSeq:0},target:{epoch:1,frameSeq:0}}}},id);sim.actor(id).mp=sim.actor(id).mpMax;sim.actor(id).sourceAdd.dp=8000;
  return {sim,sync,step(input=empty,{prepared=false}={}){if(!prepared)sync.beforeStep(sim,id);sim.step(dt,{...sync.remoteInputs(sim,id),[id]:input},{snapshot:false});
    const events=sim.drainEvents(),report=sync.afterStep(sim,id,events,input);return {events,report};}};
}
test('real MM HA starts and advances a remote original Apocalypse under cap1 without owning source resources or NPC damage',t=>{
  const a=owner('add'),b=owner('target');t.after(()=>{a.sync.clear();b.sync.clear();});
  for(let frame=0;frame<8;frame++){a.step();b.step();}assert.equal(a.sim.skillAvailability('add',0).available,true);
  const remote=b.sim.actor('add');
  let cast=false,created=false,advanced=false;
  for(let frame=1;frame<=210;frame++){
    const result=a.step(frame===1?{...empty,held:['A'],pressed:['A']}:empty);cast ||= result.events.some(event=>event.type==='skillStarted'&&event.actorId==='add');
    const currentOwner=b.sim.actor('target'),ownerBefore=structuredClone(currentOwner);
    if(result.report){const actions=result.report.actions.map(({ageFrames=0,...action})=>({...action,frameSeq:result.report.frameSeq-ageFrames}));assert.equal(b.sync.receiveActions('add',actions,1,result.report.frameSeq),true);}
    b.sync.beforeStep(b.sim,'target');
    assert.deepEqual(currentOwner,ownerBefore,'foreign intent/header admission cannot replace any current-owner combat result');
    // A reliable foreign header may calibrate the displayed source DP and
    // mutation (the Native cast initializer needs its actual DP). Capture the
    // observation after admission, then verify that ordinary recipient ticks
    // never finalize another owner's resource costs or hit rewards.
    const observed={hp:remote.hp,mp:remote.mp,dp:remote.sourceAdd.dp,mutation:remote.sourceAdd.mutation};
    const received=b.step(empty,{prepared:true});created ||= received.events.some(event=>event.type==='addSummonCreated'&&event.actorId==='add');advanced ||= (remote.sourceAddSummon?.stateTime??0)>dt;
    assert.deepEqual({hp:remote.hp,mp:remote.mp,dp:remote.sourceAdd.dp,mutation:remote.sourceAdd.mutation},observed,'positive Native playback cannot finalize foreign owner resources');
  }
  assert.equal(cast,true);assert.equal(created,true,'received action uses the ordinary spawn callback');assert.equal(advanced,true,'remote NPC advances through normal Native dt');
  const state=remote.sourceAddSummon;assert.ok(state);assert.ok(b.sim.summonDefenderSampler(state,remote).some(sphere=>sphere.kind==='sphere'&&sphere.radius>0),'original independent NPC collision helpers exist');
  const target=npcHitTargets(b.sim).find(row=>row.owner.id==='add').actor,saved=structuredClone(state);
  assert.equal(applyAddSummonDamage(b.sim,target,999999),false,'remote playback grants no summon HP authority');assert.deepEqual(state,saved);
  assert.equal(triggerAddApocalypseEmergency(b.sim,remote),false,'speculative remote hit is not an owner DamageReact');
  assert.equal(startAddApocalypse(b.sim,structuredClone(remote)),false,'a disposable hit actor cannot recast the live remote NPC');
  assert.equal(finishAddApocalypse(b.sim,remote,'recast'),true);for(let frame=0;frame<180;frame++)b.step();assert.equal(remote.sourceAddSummon,null,'normal recipient finish retires its local summon');
});
