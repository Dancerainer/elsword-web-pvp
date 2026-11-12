/** Actual compiled-native receiving steps, including independent local effect
 * allocation and prediction/report handoff. These test the Web owner adapter;
 * they are not original-client packet, combat timing, or runtime goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {encodeOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
const skillIds=assets.profile.skillCatalog.filter(skill=>skill.topTier&&!skill.passive&&skill.supported&&skill.skillId!==900).map(skill=>skill.skillId);
const dt=1/60;

async function simulation(skillId,owner,{targetX=1858.11}={}){
  const {native,samplers}=await assets.createRuntime();
  return createSimulation({profile:assets.profile,map:assets.map,seed:2016,networkOwnerId:owner,
    preset:{...assets.preset,onlineMatch:true,loadout:[{skillId},null,null,null,null,null,null,null]},
    actors:[{id:'sender',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},
      {id:'receiver',team:1,position:[targetX,2840,0],lineId:6,facing:1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
}
const cast=frame=>frame===1?{sender:{held:['A'],pressed:['A']}}:{};

function assertLocalReferences(simulation,{knownEffects=new Map(),allowRetired=false}={}){
  const actor=simulation.actor('sender'),effects=simulation.state.effects;
  for(const effect of effects)knownEffects.set(effect.id,effect.ownerId);
  for(const effect of effects.filter(effect=>effect.ownerId==='sender')){
    assert.ok(effect.definition,'received effect has a local static definition');
    if(effect.parentEffectId!=null){
      const parent=effects.find(candidate=>candidate.id===effect.parentEffectId);
      assert.ok(parent||allowRetired&&knownEffects.has(effect.parentEffectId),'child refers to a live or observed retired receiver-local parent');
      assert.equal(parent?.ownerId??knownEffects.get(effect.parentEffectId),'sender','child cannot capture another player effect');
    }
  }
  for(const key of ['sourceWildChargeEffectGroup','sourceAwakeningAuraEffectGroup','sourceCustomStateEffectGroup','sourceDashJumpEffectGroup']){
    for(const entry of actor[key]??[]){
      const effect=effects.find(effect=>effect.id===entry.id);
      // Original cleanup groups can retain handles to effects that completed
      // during this very step. Their receiver-local provenance must survive.
      assert.ok(effect||allowRetired&&knownEffects.has(entry.id),key+' refers to a live or observed retired receiver-local effect');
      assert.equal(effect?.ownerId??knownEffects.get(entry.id),'sender',key+' cannot capture another player effect');
    }
  }
  for(const entry of actor.sourceArcEnemy?.data??[]){
    const effect=effects.find(effect=>effect.id===actor.sourceArcEnemy.effectIds[entry.handle]);
    assert.ok(effect,'live Archenemy command handle resolves after receiving step');
    assert.equal(effect.ownerId,'sender');
    assert.equal(effect.sourceArcHandle,entry.handle);
  }
}

test('native Archenemy handles survive different receiver allocation, follow updates and owner death',async()=>{
  const sender=await simulation(24008,'sender'),receiver=await simulation(24008,'receiver');
  // Deliberately occupy one of the sender's eventual effect IDs with a local
  // player's real future effect. A foreign command must not update/destroy it.
  receiver.state.nextEffectId=5;
  const localEffect=receiver.createEffect(receiver.actor('receiver'),{NAME:'Raven_ReadyS_PM'},{clock:'custom',start:1000});
  receiver.state.nextEffectId=1000;
  let frame=0;
  while(frame<180&&!sender.actor('sender').sourceArcEnemy?.data.length){
    sender.step(dt,cast(++frame),{snapshot:false});sender.drainEvents();
  }
  assert.equal(sender.actor('sender').sourceArcEnemy?.data.length,4,'native cast actually creates four owned spears');
  const report=encodeOwnedState(sender,'sender',{frameSeq:frame});
  applyOwnedState(receiver,'sender',report);receiver.drainEvents();
  const imported=receiver.actor('sender').sourceArcEnemy.data.map(entry=>{
    const effect=receiver.state.effects.find(effect=>effect.id===receiver.actor('sender').sourceArcEnemy.effectIds[entry.handle]);
    assert.ok(effect,'sender dictionary is translated into receiver-local IDs');
    assert.equal(effect.networkId,report.actor.sourceArcEnemy.effectIds[entry.handle]);
    assert.ok(effect.id>=1000,'independent receiver allocator is actually used');
    return effect;
  });
  receiver.step(dt,{}, {snapshot:false});
  const updates=receiver.drainEvents().filter(event=>event.type==='originalSkillEffectUpdate'&&event.actorId==='sender');
  assert.equal(receiver.actor('sender').sourceArcEnemy.data.length,4,'native follow must retain received spears');
  assert.equal(updates.length,4,'native follow updates every received spear');
  assert.deepEqual(new Set(updates.map(event=>event.effectId)),new Set(imported.map(effect=>effect.id)));
  assertLocalReferences(receiver);
  receiver.actor('sender').hp=0;receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();
  assert.equal(receiver.actor('sender').sourceArcEnemy.data.length,0,'owner death clears the received native spear handles');
  assert.ok(imported.every(effect=>effect.dead||!receiver.state.effects.includes(effect)),'owner death retires its receiver-local spears');
  assert.ok(receiver.state.effects.includes(localEffect),'another player effect with the sender ID remains present');
  assert.notEqual(localEffect.dead,true,'foreign command cleanup cannot destroy a local player effect');
});

for(const awakened of [false,true])for(const skillId of skillIds){
  test(`native receiving step retains references for skill ${skillId}${awakened?' awakened':''}`,async()=>{
    const sender=await simulation(skillId,'sender'),receiver=await simulation(skillId,'receiver');
    receiver.state.nextEffectId=1000;
    if(awakened){const actor=sender.actor('sender');actor.awakening.pendingOrbs=3;actor.awakening.pendingAvailableOrbs=3;sender.activateAwakening(actor);}
    sender.drainEvents();let observedSkill=false,observedEffect=false;const knownEffects=new Map();
    for(let frame=1;frame<=420;frame++){
      sender.step(dt,cast(frame),{snapshot:false});sender.drainEvents();
      if(sender.actor('sender').skillId===skillId)observedSkill=true;
      if(frame===1||frame%3===0){
        const localBefore=structuredClone(receiver.actor('receiver'));
        applyOwnedState(receiver,'sender',encodeOwnedState(sender,'sender',{frameSeq:frame}));
        assert.deepEqual(receiver.actor('receiver'),localBefore,'report never overwrites the receiving player');
        // A predicted child can survive the source mesh's native retirement.
        // Its ownership handoff preserves that observed receiver-local parent;
        // unknown IDs and foreign-owner handles remain rejected below.
        assertLocalReferences(receiver,{knownEffects,allowRetired:true});
      }
      observedEffect||=receiver.state.effects.some(effect=>effect.ownerId==='sender');
      const remote=receiver.actor('sender'),hp=remote.hp,mp=remote.mp;
      receiver.step(dt,{}, {snapshot:false});
      for(const event of receiver.drainEvents())if(Number.isSafeInteger(event.effectId)&&event.actorId)
        knownEffects.set(event.effectId,event.actorId);
      assert.equal(remote.hp,hp,'receiving step does not own remote HP');
      assert.equal(remote.mp,mp,'receiving step does not own remote MP');
      assert.ok(Number.isFinite(receiver.actor('receiver').hp));
      assertLocalReferences(receiver,{knownEffects,allowRetired:true});
    }
    assert.ok(observedSkill,'the native skill actually executes');
    assert.ok(observedEffect,'real native effect instances reach the receiving simulation');
  });
}

for(const [skillId,name] of [[24029,'DamageEffect_ROT_VALKYRIESJAVELIN_NEW'],[24010,'DamageEffect_SA_RRF_XCrash1_Damage']]){
  test(`first canonical report claims native predicted ${skillId} effect and retains victim hit receipts`,async()=>{
    const sender=await simulation(skillId,'sender',{targetX:1920}),receiver=await simulation(skillId,'receiver',{targetX:1920});
    receiver.state.nextEffectId=1000;
    sender.step(dt,cast(1),{snapshot:false});sender.drainEvents();
    applyOwnedState(receiver,'sender',encodeOwnedState(sender,'sender',{frameSeq:1}));receiver.drainEvents();
    let frame=1,predicted=null,firstHit=null;
    while(frame++<250&&!predicted){
      sender.step(dt,{}, {snapshot:false});sender.drainEvents();receiver.step(dt,{}, {snapshot:false});
      const events=receiver.drainEvents();
      predicted=receiver.state.effects.find(effect=>effect.ownerId==='sender'&&effect.name===name&&effect.networkId===undefined&&effect.hits?.receiver!==undefined);
      if(predicted)firstHit=events.find(event=>event.type==='hit'&&event.targetId==='receiver'&&event.origin?.id===predicted.id);
    }
    assert.ok(predicted,'receiving native step creates and hits with an effect before its first canonical report');
    assert.ok(firstHit,'the predicted effect performs a real native collision');
    if(skillId===24010)assert.equal(predicted.damage.DAMAGE_DATA.RE_ATTACK,0,'XCrash native damage origin permits only one hit');
    else assert.ok(predicted.damage.DAMAGE_DATA.HIT_GAP>dt,'the other native source requires its retained per-victim repeat-hit gap');
    const report=encodeOwnedState(sender,'sender',{frameSeq:frame}),wire=report.effects.find(effect=>effect.name===name);
    assert.ok(wire,'sender reports the same source effect');
    if(skillId===24010)assert.ok(predicted.parentEffectId!=null&&wire.parentEffectId!=null,'XCrash covers receiver-local versus sender child-parent identities');
    const hp=receiver.actor('receiver').hp,receipt=predicted.hits.receiver,id=predicted.id;
    applyOwnedState(receiver,'sender',report);
    const canonical=receiver.state.effects.find(effect=>effect.networkId===wire.id&&effect.networkEpoch===report.epoch);
    assert.equal(canonical,predicted,'canonical ownership claims the existing predicted source member');
    assert.equal(canonical.id,id,'receiver-local render/collision identity remains stable');
    assert.equal(canonical.hits.receiver,receipt,'victim-local hit receipt remains stable');
    receiver.drainEvents();receiver.step(dt,{}, {snapshot:false});
    assert.equal(receiver.actor('receiver').hp,hp,'canonical handoff cannot charge the same native hit twice');
    assert.equal(receiver.drainEvents().filter(event=>event.type==='hit'&&event.targetId==='receiver'&&event.origin?.id===id).length,0);
    assertLocalReferences(receiver);
  });
}

for(const retirement of ['canonical disappearance','room disconnect','owner life epoch']){
  test(`native Nuclear victim control identity retires on ${retirement}`,async()=>{
    const sender=await simulation(24007,'sender',{targetX:1920}),receiver=await simulation(24007,'receiver',{targetX:1920});
    const sync=createLocalOwnershipSync();receiver.state.nextEffectId=1000;
    const room=()=>({ownership:{mode:'local-owner-v1',actors:{sender:{epoch:0},receiver:{epoch:0}}},
      snapshot:structuredClone(receiver.state),pvp:{phase:'fight',fightTime:0,
        players:[{id:'sender',connected:true,alive:true,lockUntil:0,invincibleUntil:0},
          {id:'receiver',connected:true,alive:true,lockUntil:0,invincibleUntil:0}]}});
    // Establish the current life before any control effect exists. A lifecycle
    // update must retain the surviving victim rather than reset its state.
    sync.reconcile(receiver,room(),'receiver');
    let frame=0;
    while(frame<180&&!receiver.actor('receiver').effectiveBlackHoleIds.length){
      sender.step(dt,cast(++frame),{snapshot:false});sender.drainEvents();
      applyOwnedState(receiver,'sender',encodeOwnedState(sender,'sender',{frameSeq:frame}));
      receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();
    }
    const victim=receiver.actor('receiver'),ids=[...victim.effectiveBlackHoleIds];
    assert.ok(ids.length,'actual native Nuclear effect acquires the receiving victim');
    assert.ok(ids.every(id=>receiver.state.effects.some(effect=>effect.id===id&&effect.ownerId==='sender')),'control identities refer to imported local effect IDs');
    if(retirement==='canonical disappearance'){
      const report=encodeOwnedState(sender,'sender',{frameSeq:frame+1});
      applyOwnedState(receiver,'sender',{...report,effects:[]});
    }else{
      const value=room();
      if(retirement==='room disconnect'){
        value.snapshot.actors.find(actor=>actor.id==='sender').pvpDisconnected=true;
        value.pvp.players.find(player=>player.id==='sender').connected=false;
      }else value.ownership.actors.sender.epoch=1;
      sync.reconcile(receiver,value,'receiver');
    }
    assert.equal(receiver.actor('receiver'),victim,'retiring the caster preserves the surviving local victim');
    assert.equal(receiver.state.effects.filter(effect=>effect.ownerId==='sender').length,0);
    assert.deepEqual(victim.effectiveBlackHoleIds,[],'effect retirement revokes victim control identities immediately');
    for(let frame=0;frame<120;frame++){receiver.step(dt,{}, {snapshot:false});receiver.drainEvents();}
    assert.notEqual(receiver.skillAvailability('receiver','A').reason,'black-hole-held','ordinary combat remains usable after caster cleanup');
  });
}
