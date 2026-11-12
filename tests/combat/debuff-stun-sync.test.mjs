/** Fixed inputs on the real map/native buff arithmetic. Source declarations,
 * user-requested stun precedence and web network regressions are separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../../'+name,import.meta.url)));
const professions=['RF','LK','VC'];
const profiles=Object.fromEntries(professions.map(id=>[id,read(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const presets=Object.fromEntries(professions.map(id=>[id,read(`config/${id.toLowerCase()}-preset.json`)]));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const stun=profiles.RF.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
const fire=profiles.RF.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR;
const wound=profiles.RF.damageEffects.RAVEN_OVER_TAKER_CHARGED_BOLT.raw.DAMAGE_DATA.BUFF_FACTOR;
const hit={REACT_TYPE:1,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},BACK_SPEED_X:0,BACK_SPEED_Y:0,FORCE_DOWN:7};
function make(profession='RF',networkOwnerId=null){
  const sim=createSimulation({profile:profiles[profession],profiles,map,preset:presets[profession],presets,nativeSkillValues,networkOwnerId,seed:2016,
    actors:[{id:'source',professionId:'RF',team:0,position:[2022.98,2840,0],lineId:6,facing:-1,passives:[],guildPassives:[]},
      {id:'victim',professionId:profession,team:1,position:[1858.11,2840,0],lineId:6,facing:1,passives:[],guildPassives:[]}]});
  sim.rng=()=>0;return sim;
}
const rows=sim=>buildBuffRows(sim.actor('victim'),{profile:sim.profileFor(sim.actor('victim')),profileForBuff:buff=>sim.profileFor(sim.actor(buff.sourceActorId))});

for(const profession of professions)for(const freeze of ['hitStop','worldStop'])test(`${profession} all timed debuffs expire during continuously refreshed ${freeze}`,()=>{
  const sim=make(profession),a=sim.actor('source'),b=sim.actor('victim');
  for(const factor of [fire,wound,42])assert.ok(sim.grantBuff(a,b,factor));
  const longest=Math.max(...b.buffs.flatMap(buff=>buff.finalizers.filter(row=>row.kind==='time').map(row=>row.remaining)));
  const animationBefore=b.animationTime;
  for(let frame=0;frame<Math.ceil((longest+.1)*60);frame++){
    b[freeze]=1;sim.step(1/60,{}, {snapshot:false});
  }
  assert.equal(b.animationTime,animationBefore,'actor animation remains frozen');
  assert.equal(b.buffs.length,0,'normal-time finalizers are independent of actor frame stop');
  assert.deepEqual(rows(sim),[]);assert.equal(b.buffControls.dashBlock,false);
  assert.equal(b.stats.physicalAttack,b.buffBaseStats.physicalAttack);
  assert.ok(sim.state.effects.filter(effect=>effect.ownerId===b.id&&effect.buffTemplateId!=null).every(effect=>effect.dead));
});

for(const profession of professions)test(`${profession} a stunning hit overrides full knockdown, uses target Fatal and returns to standing`,()=>{
  const sim=make(profession),a=sim.actor('source'),b=sim.actor('victim');
  b.knockdown.now=b.knockdown.max;
  sim.applyHit(a,b,{...hit,BUFF_FACTOR:stun},{kind:'fixture'});
  assert.equal(b.state,'RSI_DAMAGE_GROGGY');assert.equal(b.animationName,'Fatal');assert.equal(b.animationLoop,true);
  assert.equal(b.knockdown.now,0);assert.equal(b.knockdown.pending,null);assert.equal(b.knockdown.activated,false);
  assert.equal(b.buffControls.inputBlock,true);
  sim.step(1/60,{victim:{pressed:['Z'],held:['Z']}},{snapshot:false});
  assert.equal(b.state,'RSI_DAMAGE_GROGGY','command input cannot leave stun');
  for(let i=0;i<180&&b.buffs.length;i++)sim.step(1/60,{}, {snapshot:false});
  assert.equal(b.buffs.length,0);assert.equal(b.buffControls.inputBlock,false);
  assert.equal(b.state,'RSI_WAIT');assert.equal(b.knockdown.now,0);
});

const room=(sim,owners={})=>({snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',actors:{source:{epoch:1},victim:{epoch:1}}},owners});
const report=(sim,frameSeq)=>validateOwnedState(encodeOwnedState(sim,'victim',{epoch:1,frameSeq}));
for(const profession of professions)test(`${profession} owner expiration replaces all remote debuffs through coalesced relay deltas; late peer/server packets cannot resurrect icons`,()=>{
  const owner=make(profession,'victim'),observer=make(profession,'source');
  const ownerSync=createLocalOwnershipSync(),sync=createLocalOwnershipSync(),encoder=createOwnedRelayDelta(),decoder=createOwnedRelayDelta();
  ownerSync.reconcile(owner,room(owner),'victim');sync.reconcile(observer,room(owner),'source');
  for(const factor of [fire,wound,42,stun])owner.grantBuff(owner.actor('source'),owner.actor('victim'),factor);
  const oldReport=report(owner,1),baseline=encoder.encode('victim',oldReport);
  assert.equal(baseline.critical,true);
  assert.equal(sync.receivePeer(observer,'victim',decoder.decode(baseline.value),'source'),true);
  assert.equal(rows(observer).length,4);assert.equal(observer.actor('victim').state,'RSI_DAMAGE_GROGGY');
  let latest;
  for(let frame=2;frame<=850;frame++){
    owner.actor('victim').worldStop=1;owner.step(1/60,{}, {snapshot:false});
    const packet=encoder.encode('victim',report(owner,frame));
    // Critical effect birth baselines are reliable; replaceable intermediates
    // are deliberately omitted, as when relay congestion coalesces frames.
    if(packet.critical)decoder.decode(packet.value);
    latest=packet;
  }
  assert.equal(latest.critical,false);
  assert.equal(sync.receivePeer(observer,'victim',decoder.decode(latest.value),'source'),true);
  const target=observer.actor('victim');
  assert.deepEqual(target.buffs,[]);assert.deepEqual(rows(observer),[]);
  assert.deepEqual(target.buffControls,{inputBlock:false,dashBlock:false});
  assert.equal(target.stats.physicalAttack,target.buffBaseStats.physicalAttack);assert.equal(target.state,'RSI_WAIT');
  assert.ok(observer.state.effects.filter(e=>e.ownerId==='victim'&&e.buffTemplateId!=null).every(e=>e.dead));
  for(const late of [oldReport,oldReport,decoder.decode(latest.value)])assert.equal(sync.receivePeer(observer,'victim',late,'source'),false);
  sync.reconcile(observer,room(owner,{victim:oldReport}),'source');
  ownerSync.reconcile(owner,room(owner,{victim:oldReport}),'victim');
  assert.deepEqual(rows(observer),[]);assert.deepEqual(rows(owner),[]);
});

test('empty authoritative buff list removes stale control flags instead of keeping wire-derived locks',()=>{
  const owner=make('RF','victim'),observer=make('RF','source'),sync=createLocalOwnershipSync();
  sync.reconcile(observer,room(owner),'source');
  const packet=report(owner,1);packet.actor.buffControls={inputBlock:true,dashBlock:true};
  sync.receivePeer(observer,'victim',packet,'source');
  assert.deepEqual(observer.actor('victim').buffControls,{inputBlock:false,dashBlock:false});
});

test('a remote DOT observer expires icons without speculatively killing the remote owner',()=>{
  const owner=make('RF','victim'),observer=make('RF','source'),sync=createLocalOwnershipSync();
  sync.reconcile(observer,room(owner),'source');
  owner.grantBuff(owner.actor('source'),owner.actor('victim'),fire);owner.actor('victim').hp=1;
  sync.receivePeer(observer,'victim',report(owner,1),'source');observer.drainEvents();
  for(let i=0;i<400;i++)observer.step(1/60,{}, {snapshot:false});
  const b=observer.actor('victim');assert.equal(b.hp,1);assert.equal(b.deathComplete,false);assert.notEqual(b.death,true);
  assert.equal(b.state,'RSI_WAIT');assert.deepEqual(rows(observer),[]);
  assert.ok(!observer.drainEvents().some(e=>['death','buffHpChanged'].includes(e.type)&&e.actorId==='victim'));
  owner.advanceActorBuffs(owner.actor('victim'),1);assert.equal(owner.actor('victim').hp,0,'only owner applies DOT');
});

test('stun clears partial/pending KD, interrupts attack, and does not queue input pressed during a freeze',()=>{
  const sim=make(),a=sim.actor('source'),b=sim.actor('victim');
  sim.enter(b,'RSI_COMBO_Z','fixture');b.knockdown.now=40;b.knockdown.pending=7;
  sim.grantBuff(a,b,stun);assert.equal(b.state,'RSI_DAMAGE_GROGGY');assert.equal(b.knockdown.now,0);assert.equal(b.knockdown.pending,null);
  const duration=b.buffs[0].finalizers.find(f=>f.kind==='time').remaining;
  b.worldStop=duration+.2;
  for(let i=0;i<Math.floor(duration*60);i++)sim.step(1/60,{victim:{pressed:['Z'],held:['Z']}},{snapshot:false});
  for(let i=0;i<30;i++)sim.step(1/60,{}, {snapshot:false});
  assert.deepEqual(b.buffs,[]);assert.deepEqual(b.pendingPressed,[]);assert.equal(b.state,'RSI_WAIT');
});

test('airborne stun keeps Fatal through landing and expires during a stop; dead actors never return to wait',()=>{
  const sim=make(),a=sim.actor('source'),b=sim.actor('victim');b.grounded=false;b.lineId=null;b.y+=30;b.vy=-200;
  sim.grantBuff(a,b,stun);
  for(let i=0;i<30;i++){sim.step(1/60,{}, {snapshot:false});assert.equal(b.state,'RSI_DAMAGE_GROGGY');}
  assert.equal(b.grounded,true);
  b.hitStop=5;for(let i=0;i<180;i++)sim.step(1/60,{}, {snapshot:false});
  assert.equal(b.state,'RSI_WAIT');assert.deepEqual(rows(sim),[]);
  sim.grantBuff(a,b,stun);b.hp=0;sim.step(1/60,{}, {snapshot:false});
  for(let i=0;i<180;i++)sim.step(1/60,{}, {snapshot:false});
  assert.notEqual(b.state,'RSI_WAIT');assert.notEqual(b.state,'RSI_DAMAGE_GROGGY');
});

test('stun expires by received count during stop and deterministic restoration preserves timers and state',()=>{
  const sim=make(),a=sim.actor('source'),b=sim.actor('victim');sim.grantBuff(a,b,stun);
  for(const unused of [0,1])sim.applyHit(a,b,{REACT_TYPE:0,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:0}},{kind:'fixture'});
  assert.deepEqual(rows(sim),[],'count-exhausted identity is already hidden before manager cleanup');
  b.worldStop=1;sim.step(1/60,{}, {snapshot:false});assert.equal(b.state,'RSI_WAIT');assert.deepEqual(b.buffs,[]);
  sim.grantBuff(a,b,stun);sim.grantBuff(a,b,fire);sim.step(.1,{}, {snapshot:false});
  const copy=make();copy.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  for(let i=0;i<400;i++){sim.step(1/60,{}, {snapshot:false});copy.step(1/60,{}, {snapshot:false});sim.drainEvents();copy.drainEvents();}
  assert.deepEqual(copy.snapshot(),sim.snapshot());
});
