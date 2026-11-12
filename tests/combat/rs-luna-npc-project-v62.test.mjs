/** Actual independent NPC constructors and numeric hit receivers. Controlled
 * damage contacts below are not an original-client recording or a GPU test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {fixture,read,profile} from '../helpers/rs-fixture.mjs';
import {loadAddSummonAssets} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {startAddApocalypse,tickAddSummons,npcHitTargets} from '../../packages/combat-core/add-summons.mjs';
import {startAddPrismEndpoints,prismHitTargets} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const base=fixture(),mm=read('packages/combat-core/mm-profile.json');
const summon=await loadAddSummonAssets({base:'mm/',data:p=>read('artifacts/'+p),profile:mm});
const samplers=createAddSummonSamplers(summon);
function make(){
 const sim=createSimulation({profile,profiles:{MM:mm},preset:read('config/rs-preset.json'),presets:{MM:read('config/mm-preset.json')},map:base.map,seed:2016,
  actors:[{id:'rs',professionId:'RS',team:0,position:[2022.98,2840,0],lineId:6,facing:1,loadout:[{skillId:21017},...Array(7).fill(null)],passives:[],guildPassives:[]},
   {id:'mm',professionId:'MM',team:1,position:[2500,2840,0],lineId:6,facing:-1,loadout:[{skillId:29029},{skillId:29604},...Array(6).fill(null)],passives:[],guildPassives:[]}],
  nativeGeometry:base.sim.nativeGeometry,nativeSkillValues:base.sim.nativeSkillValues,nativeCritical:base.sim.nativeCritical,nativeManaBreak:base.sim.nativeManaBreak,...samplers});
 const a=sim.actor('rs'),b=sim.actor('mm');a.skillId=21017;b.hp=b.hpMax=1e8;return {sim,a,b};
}
function damage(f,target,name,serial=7){
 f.a.skillId=21017;const e=f.sim.createEffect(f.a,{NAME:name});e.ownerStateSerial=serial;
 return f.sim.applySummonHit(f.a,target,e.damage.DAMAGE_DATA,{kind:'effect',id:e.id,skillId:21017,impactPoint:[target.x,target.y,target.z]});
}
test('both independently owned Prism endpoints and owner player get separate cast quotas; endpoint receipt survives owned restore',()=>{
 const f=make();assert.equal(startAddPrismEndpoints(f.sim,f.b,[2400,2840,0],[2600,2840,0]),true);
 const targets=prismHitTargets(f.sim);assert.equal(targets.length,2);const mp=f.b.mp;
 for(const {actor,npc}of targets){const hp=npc.hp;
  assert.ok(damage(f,actor,'DamageEffect_SA_ERS_LunaBlade').amount>0);
  const after=npc.hp;assert.ok(after<hp);assert.equal(damage(f,actor,'DamageEffect_SA_ERS_LunaBlade_ExposionFinal').amount,0);assert.equal(npc.hp,after);
 }
 assert.equal(f.b.mp,mp,'independent NPC receiver has no MP channel and must not spend its owner MP');
 const packet=encodeOwnedState(f.sim,f.b.id,{epoch:0,frameSeq:1});validateOwnedState(packet);assert.equal(Object.keys(packet.actor.sourceRuneSlayerHitReceipts).length,2);
 const peer=make();applyOwnedState(peer.sim,peer.b.id,packet);
 for(const {actor,npc}of prismHitTargets(peer.sim)){const hp=npc.hp;assert.equal(damage(peer,actor,'DamageEffect_SA_ERS_LunaBlade_ExposionFinal').amount,0);assert.equal(npc.hp,hp);}
 const e=f.sim.createEffect(f.a,{NAME:'DamageEffect_SA_ERS_LunaBlade'});e.ownerStateSerial=7;
 assert.ok(f.sim.applyHit(f.a,f.b,e.damage.DAMAGE_DATA,{kind:'effect',id:e.id,skillId:21017}).amount>0,'owner player is not either endpoint');
});
test('real Apocalypse construction/pose-clock NPC receiver shares one HP attempt while owner MP remains independent',()=>{
 const f=make();f.b.skillId=29604;assert.equal(startAddApocalypse(f.sim,f.b),true);
 for(let n=0;n<180;n++)tickAddSummons(f.sim,f.b,1/60);
 const target=npcHitTargets(f.sim).find(t=>t.owner.id===f.b.id);assert.ok(target);assert.equal(target.actor.invincible,false);
 const hp=target.npc.hp,mp=f.b.mp;
 assert.ok(damage(f,target.actor,'DamageEffect_SA_ERS_LunaBlade').amount>0);const after=target.npc.hp;assert.ok(after<hp);
 assert.equal(damage(f,target.actor,'DamageEffect_SA_ERS_LunaBlade_ExposionFinal').amount,0);assert.equal(target.npc.hp,after);assert.equal(f.b.mp,mp);
 assert.equal(Object.keys(f.b.sourceRuneSlayerHitReceipts).length,1);
 validateOwnedState(encodeOwnedState(f.sim,f.b.id,{epoch:0,frameSeq:1}));
});
