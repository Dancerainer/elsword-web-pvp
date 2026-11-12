/** Current Web/Native regression for the captured V61 Finish crash. Original
 * NPC pose/configuration are inputs; no original-client dynamic claim. */
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
import {addSummonCombatActor} from '../../packages/combat-core/add-summon-damage.mjs';
import {addSummonPoseActor} from '../../packages/combat-core/add-summons.mjs';
import {initializeGuildSkills,guildCriticalCounterRequest} from '../../packages/combat-core/guild-skills.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../artifacts/'+file,import.meta.url))),profile=PROFESSION_PROFILES.MM;
const npc=await loadAddSummonAssets({base:'mm/',data:read,profile}),info=read('mm/manifest.json'),raw=read('mm/'+info.runtimePose),
  visual=mergeVisualEffectIndexes(...(info.visualEffectIndexes??[]).map(file=>read('mm/'+file)),npc.fxIndex),
  effectIndex=mergeEffectIndexes(read('mm/'+info.effectAssetIndex),visual),
  effectPoses=Object.fromEntries(collectEffectPoseFiles(effectIndex,visual).map(file=>[file,read('mm/'+file)]));
const samplers={...createNativeSamplers({profile,characterPose:composeCharacterPose(raw,raw.sharedPose?read('mm/'+raw.sharedPose):null),effectIndex,effectPoses,map:addMap}),...createAddSummonSamplers(npc)};
const empty={held:[],pressed:[],released:[],sampledDevice:true},dt=1/60,
  speedKeys=['animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'];
function fixture(){
  const result=addFixture('MM',{skillId:29604,samplers});
  for(const actor of [result.a,result.b]){
    initializeGuildSkills(actor,{passiveIds:[509]});
    assert.equal(actor.formulaRules.version,'pvp-equipment-source-candidate-v1');
    for(const key of speedKeys)assert.ok(Number.isFinite(actor.equipmentAttributes[key]),'real player has finite '+key);
  }
  return result;
}

test('real PvP MM numeric NPC contact excludes owner guild509 but still grants the defender original Buff54',()=>{
  const {sim,a,b}=fixture(),ownerBefore=structuredClone(a),proxy={...structuredClone(a),...addSummonCombatActor(a)};
  sim.rng=()=>0;
  // Before the fix this genuine consumer grants Buff54 to a numeric NPC with
  // empty equipment; its crit-only Template57 still invokes speed composition.
  assert.doesNotThrow(()=>sim.processGuildContact(proxy,b));
  assert.equal(guildCriticalCounterRequest(proxy),null);
  assert.equal(proxy.buffs.length,0);assert.deepEqual(proxy.equipmentAttributes,{});
  assert.equal(b.buffs.some(buff=>buff.templateId===57),true,'real defender remains eligible');
  assert.deepEqual(a,ownerBefore,'temporary numeric contact never mutates the actual owner');
  assert.notEqual(guildCriticalCounterRequest(a),null,'owner retains its player guild qualification');
  proxy.stats.magicAttack=1;proxy.buffBaseStats.magicAttack=2;
  assert.equal(a.stats.magicAttack,ownerBefore.stats.magicAttack);
  assert.equal(a.buffBaseStats.magicAttack,ownerBefore.buffBaseStats.magicAttack);
});

test('genuine A cast survives natural60s and original Finish contact with guild509 before independent NPC retirement',t=>{
  const {sim,a,b}=fixture(),base=structuredClone(a.buffBaseStats),equipment=structuredClone(a.equipmentAttributes),guild=structuredClone(a.guild);
  a.mp=a.mpMax;a.sourceAdd.dp=8000;b.invincible=true;sim.rng=()=>.99;
  for(let frame=0;frame<8;frame++){sim.step(dt,{}, {snapshot:false});sim.drainEvents();}
  assert.equal(sim.skillAvailability(a.id,0).available,true);
  let cast=false,created=false,finish=false,finishHit=0,ended=false,spawnTime=null,finishTime=null;
  const effectNames=new Map(),finishContacts=[];
  for(let frame=0;frame<4200;frame++){
    const state=a.sourceAddSummon;
    if(state?.state==='APOCALYPSE_FINISH_ATTACK'){
      finish=true;finishTime??=sim.state.time;b.invincible=false;sim.rng=()=>0;
      const posed=addSummonPoseActor(a,state);
      assert.equal(guildCriticalCounterRequest(posed),null,'independent NPC pose also excludes player guild');
    }
    sim.step(dt,{[a.id]:frame===0?{...empty,held:['A'],pressed:['A']}:empty},{snapshot:false});
    for(const event of sim.drainEvents()){
      if(event.type==='effectStarted')effectNames.set(event.effectId,event.name);
      if(event.type==='skillStarted'&&event.actorId===a.id)cast=true;
      if(event.type==='addSummonCreated'){created=true;spawnTime??=sim.state.time;}
      if(event.type==='hit'&&event.origin?.sourceAddSummonSerial!==undefined&&event.origin?.skillId===29604){
        const effectName=effectNames.get(event.origin.id);
        if(finish)finishContacts.push({effectName,amount:event.amount});
        if(effectName==='DamageEffect_AMM_HA_Apocalypse_Finish_Hit2'&&event.amount>0)finishHit++;
      }
      if(event.type==='addSummonEnded')ended=true;
    }
    if(ended)break;
  }
  assert.equal(cast,true);assert.equal(created,true);assert.equal(finish,true);assert.equal(ended,true);
  t.diagnostic(JSON.stringify({spawnTime,finishTime,finishContacts}));
  assert.ok(finishTime-spawnTime>=59.9,'natural original60s lifetime is not shortened to create a Finish fixture');
  assert.ok(finishHit>0,'original independent NPC pose produces a real accepted Finish Hit2');
  assert.equal(a.sourceAddSummon,null);assert.equal(b.buffs.some(buff=>buff.templateId===57),true);
  assert.deepEqual(a.buffBaseStats,base);assert.deepEqual(a.equipmentAttributes,equipment);
  assert.deepEqual(a.guild,guild);assert.equal(a.buffs.some(buff=>buff.templateId===57),false);
  for(const actor of [a,b])for(const key of speedKeys)assert.ok(Number.isFinite(actor.stats[key]));
});
