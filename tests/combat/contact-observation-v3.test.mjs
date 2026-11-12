/** Current Web observer/owner regressions using original posed helpers and
 * the real Garpai map. Synthetic report timing is not original-client proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createRemoteActorClock} from '../../apps/web/remote-actor-clock.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:root+'artifacts'});
const hit={REACT_TYPE:1,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1,MAGIC:0},HIT_ADD_MP:5,BACK_SPEED_X:0,BACK_SPEED_Y:0,FORCE_DOWN:7};
async function make(profession='RF',owner='local'){
  const {native,samplers}=await assets.createRuntime();
  const sim=createSimulation({profile:assets.profile,profiles:assets.profiles,preset:{...assets.preset,onlineMatch:true},
    presets:assets.presets,commonBuffs:assets.commonBuffs,map:assets.map,networkOwnerId:owner,seed:2016,
    actors:[{id:'local',professionId:profession,team:0,position:[-650,3800,0],lineId:4,facing:1,passives:[],guildPassives:[]},
      {id:'remote',professionId:profession,team:1,position:[0,3800,0],lineId:4,facing:-1,passives:[],guildPassives:[]}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  for(const actor of sim.state.actors){actor.mp=0;actor.forceInvincible=0;actor.inputLock=0;sim.enter(actor,'RSI_WAIT','observation-fixture');}
  sim.drainEvents();return sim;
}
function prime(sim,{last=()=>{},captureContacts=true}={}){
  let now=0;const clock=createRemoteActorClock({clock:()=>now,captureContacts});
  const sync=createLocalOwnershipSync({remotePresentation:clock}),remote=sim.actor('remote');
  sync.reconcile(sim,{snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',actors:{local:{epoch:1},remote:{epoch:1}}}},'local');
  for(let frame=1;frame<=18;frame++){
    now=frame*1000/60;
    if(frame%3===0){
      const actor=sim.actor('remote');actor.x=frame*50;
      if(frame===18)last(actor);
      sync.receivePeer(sim,'remote',encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame}),'local');
    }
    clock.sample(sim.state.actors,'local',{now});
  }
  return {clock,sync,now,remote:sim.actor('remote')};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const sphereAt=(sim,actor)=>({kind:'sphere',center:sim.defenderSampler(actor,{profile:sim.profileFor(actor)})[0].center,radius:1});

for(const profession of ['RF','LK','VC'])test(`${profession} local hit uses the displayed original helper, grants local MP once and never commits remote HP`,async()=>{
  const sim=await make(profession),f=prime(sim),local=sim.actor('local'),remote=sim.actor('remote');
  const shown=f.clock.sample(sim.state.actors,'local',{now:f.now})[1],point=sphereAt(sim,shown);
  assert.equal(sim.intersects(point,shown),true);assert.equal(sim.intersects(point,remote),false,'independent old-path mismatch');
  const before=structuredClone(remote),mp=local.mp;
  assert.equal(sim.checkHits(local,[point],hit,{}, {kind:'character'}),0,'latest-state baseline misses visible body');
  f.sync.beforeStep(sim,'local',{now:f.now});
  const observed=sim.contactActor(remote,local);near(observed.x,shown.x);
  assert.deepEqual(sim.defenderSampler(observed),sim.defenderSampler(shown));
  const ledger={};assert.equal(sim.checkHits(local,[point],hit,ledger,{kind:'character'}),1);
  assert.ok(local.mp>mp);const gained=local.mp;
  assert.equal(sim.checkHits(local,[point],hit,ledger,{kind:'character'}),0);assert.equal(local.mp,gained);
  assert.deepEqual(remote,before,'speculative reaction/resources stay on the contact copy');
  assert.equal(sim.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='remote').length,1);
});

test('new remote protection and modifier fields begin at the same source boundary as the observed pose',async()=>{
  const sim=await make(),f=prime(sim,{last:a=>{a.invincible=true;a.skillDamageReducePercent=99;}}),local=sim.actor('local'),remote=sim.actor('remote');
  f.sync.beforeStep(sim,'local',{now:300});
  assert.equal(remote.invincible,true);assert.equal(sim.contactActor(remote,local).invincible,false);
  assert.equal(f.clock.sample(sim.state.actors,'local',{now:300})[1].invincible,false);
  assert.equal(sim.contactActor(remote,local).skillDamageReducePercent,undefined,'absent old modifier cannot inherit latest');
  assert.equal(sim.applyHit(local,remote,hit,{kind:'fixture'}).accepted,true);
  for(let now=310;now<=380;now+=10)f.sync.beforeStep(sim,'local',{now});
  assert.equal(sim.contactActor(remote,local).invincible,true);
  assert.equal(f.clock.sample(sim.state.actors,'local',{now:380})[1].invincible,true);
  assert.equal(sim.applyHit(local,remote,hit,{kind:'fixture'}).accepted,false);
});

test('local protection and room death, disconnect and respawn protection take effect immediately',async()=>{
  const sim=await make(),f=prime(sim),local=sim.actor('local'),remote=sim.actor('remote');f.sync.beforeStep(sim,'local',{now:f.now});
  local.invincible=true;const hp=local.hp;
  assert.equal(sim.applyHit(remote,local,hit,{kind:'fixture'}).accepted,false);assert.equal(local.hp,hp);
  remote.hp=0;assert.equal(sim.applyHit(local,remote,hit,{kind:'fixture'}).accepted,false);
  remote.hp=remote.hpMax;remote.pvpInvincibleRemaining=1;
  assert.equal(sim.applyHit(local,remote,hit,{kind:'fixture'}).accepted,false);
  delete remote.pvpInvincibleRemaining;remote.pvpDisconnected=true;remote.hp=0;
  assert.equal(sim.applyHit(local,remote,hit,{kind:'fixture'}).accepted,false);
});

test('observation is serializable, detached, and reproduces hit feedback after JSON restore without a renderer',async()=>{
  const sim=await make(),f=prime(sim);f.sync.beforeStep(sim,'local',{now:f.now});
  const snapshot=JSON.parse(JSON.stringify(sim.snapshot())),copy=await make();copy.restore(snapshot);
  for(const run of [sim,copy])run.applyHit(run.actor('local'),run.actor('remote'),hit,{kind:'fixture'});
  assert.deepEqual(JSON.parse(JSON.stringify(sim.snapshot())),JSON.parse(JSON.stringify(copy.snapshot())));
  const remembered=f.clock.contacts(sim.state.actors,'local',{now:f.now})[0].stats.physicalDefence;
  sim.state.contactObservations.remote.stats.physicalDefence=999999;
  assert.equal(f.clock.contacts(sim.state.actors,'local',{now:f.now})[0].stats.physicalDefence,remembered);
});

test('live debuff removal is not restored by sampling an older contact or drawing a buffered pose',async()=>{
  const sim=await make(),remote=sim.actor('remote');
  const factor=assets.profiles.RF.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR;
  assert.ok(sim.grantBuff(sim.actor('local'),remote,factor));
  const f=prime(sim,{last:a=>{a.buffs=[];}});f.sync.beforeStep(sim,'local',{now:f.now});
  assert.equal(sim.actor('remote').buffs.length,0);
  assert.ok(sim.contactActor(sim.actor('remote'),sim.actor('local')).buffs.length>0);
  assert.equal(f.clock.sample(sim.state.actors,'local',{now:f.now})[1].buffs.length,0);
  f.clock.reset('remote');f.sync.beforeStep(sim,'local',{now:f.now});
  assert.equal(sim.state.contactObservations,undefined);
});

test('physics blocks at the observed body, never at the newer unseen body',async()=>{
  const sim=await make(),f=prime(sim),local=sim.actor('local'),remote=sim.actor('remote');f.sync.beforeStep(sim,'local',{now:f.now});
  const view=sim.contactActor(remote,local),old=view.x-120;local.x=view.x+120;local.y=view.y;local.z=view.z;
  sim.blockUnits(local,old,local.y,local.z);near(local.x,old);
  assert.equal(remote.x,900,'body contact cannot push or rewrite the remote owner report');
});

test('ordinary standalone combat and an unconfigured observer do not add a second state',async()=>{
  const sim=await make('RF',null),remote=sim.actor('remote');sim.setContactObservations([{...remote,x:999}]);
  assert.equal(sim.contactActor(remote,sim.actor('local')),remote);assert.equal(sim.state.contactObservations,undefined);
  const clock=createRemoteActorClock();clock.observe(remote,{epoch:1,frameSeq:3,at:50});assert.deepEqual(clock.contacts(sim.state.actors,'local',{now:50}),[]);
});

test('a room life reset drops the old contact immediately and rejects delayed reports from that life',async()=>{
  const sim=await make(),f=prime(sim);f.sync.beforeStep(sim,'local',{now:f.now});
  const old=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:21}),snapshot=sim.snapshot();
  snapshot.actors.find(a=>a.id==='remote').x=-500;
  f.sync.reconcile(sim,{snapshot,ownership:{mode:'local-owner-v1',actors:{local:{epoch:1},remote:{epoch:2}}}},'local');
  assert.equal(sim.state.contactObservations?.remote,undefined);
  assert.equal(sim.contactActor(sim.actor('remote'),sim.actor('local')),sim.actor('remote'));
  assert.equal(f.sync.receivePeer(sim,'remote',old,'local'),false);
  f.sync.beforeStep(sim,'local',{now:400});assert.equal(sim.state.contactObservations,undefined);
  const fresh=encodeOwnedState(sim,'remote',{epoch:2,frameSeq:3});
  assert.equal(f.sync.receivePeer(sim,'remote',fresh,'local'),true);
  f.sync.beforeStep(sim,'local',{now:450});near(sim.contactActor(sim.actor('remote'),sim.actor('local')).x,-500);
});

test('ground contact uses the observed foot and original line group without grounding the live remote actor',async()=>{
  const sim=await make(),f=prime(sim),local=sim.actor('local'),remote=sim.actor('remote');
  f.sync.beforeStep(sim,'local',{now:f.now});const observed=sim.contactActor(remote,local);
  local.x=observed.x-100;local.y=observed.y;local.landPosition=[local.x,local.y,0];
  remote.y+=300;remote.grounded=false;remote.lineId=null;
  const before=structuredClone(remote),data=assets.profiles.RF.states.RRF_DASH_JUMP_COMBO_XX_LANDING.raw.DAMAGE_DATA;
  assert.equal(sim.checkGroundHits(local,data,{}, {kind:'character'}),1);
  assert.deepEqual(remote,before);assert.equal(sim.drainEvents().find(e=>e.type==='hit').origin.groundHit,true);
  sim.setContactObservations([]);assert.equal(sim.checkGroundHits(local,data,{}, {kind:'character'}),0);
});
