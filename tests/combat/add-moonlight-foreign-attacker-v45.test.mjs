/** Actual DE field on a third participant, then another profession's original
 * command contact and Moonlight explosion through production owner reports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {addMap,addNative} from '../helpers/add-fixture.mjs';
import {originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {readFileSync} from 'node:fs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const commonBuffs=JSON.parse(readFileSync(new URL('../../artifacts/common-buffs/catalog.json',import.meta.url)));
function fixture(id){
 const samplersBy={DE:originalAddSamplers('DE'),[id]:originalAddSamplers(id)},samplers={};
 for(const key of ['collisionSampler','defenderSampler','actorRotationSampler','motionOffsetSampler'])samplers[key]=(a,...args)=>samplersBy[a.professionId][key](a,...args);
 for(const key of ['effectAnchorSampler','effectSampler','effectBoneSampler','effectBoneMatrixSampler'])samplers[key]=(e,a,...args)=>samplersBy[a.professionId][key](e,a,...args);
 const n=addNative,sim=createSimulation({profile:PROFESSION_PROFILES[id],profiles:PROFESSION_PROFILES,presets:PROFESSION_PRESETS,
  preset:{...PROFESSION_PRESETS[id],passives:[],guildPassives:[]},commonBuffs,map:addMap,seed:2016,
  actors:[{id:'debuffer',professionId:'DE',team:0,position:[-200,3080,0],lineId:2,facing:1,loadout:[{skillId:29024},...Array(7).fill(null)],passives:[],guildPassives:[]},
   {id:'attacker',professionId:id,team:0,position:[0,3080,0],lineId:2,facing:1,loadout:Array(8).fill(null),passives:[],guildPassives:[]},
   {id:'recipient',professionId:'DE',team:1,position:[115,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
  nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,nativeCritical:n.critical,nativeNasod:n.nasod,nativeManaBreak:n.manaBreak,...samplers});
 // Install the same life identities before the offline checkpoint is made;
 // later owner assignment changes authority, never a participant's life.
 sim.networkEpochFor=key=>key==='attacker'?2:key==='recipient'?3:1;
 return {sim};
}
const report=(f,id,epoch,frameSeq)=>JSON.parse(JSON.stringify(encodeOwnedState(f.sim,id,{epoch,frameSeq})));
function receive(f,id,p){validateOwnedState(p);validateOwnedReferences(p,f.sim.actor(id),f.sim.profileFor(f.sim.actor(id)),f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});applyOwnedState(f.sim,id,p);}
for(const id of ['RF','LP'])test(`${id} actual current attacker owns Moonlight follow damage despite not equipping29024`,()=>{
 const source=fixture(id),victim=fixture(id);source.sim.actor('debuffer').mp=300;
 for(let i=0;i<350;i++){
  source.sim.step(1/60,{debuffer:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
  if(source.sim.actor('recipient').buffs.some(b=>b.templateId===439&&b.accumulationCount===2))break;
 }
 assert.equal(source.sim.actor('recipient').buffs.find(b=>b.templateId===439)?.accumulationCount,2);
 victim.sim.restore(structuredClone(source.sim.snapshot()));
 for(const[f,owner]of [[source,'attacker'],[victim,'recipient']])f.sim.networkOwnerId=owner;
 victim.sim.state.nextEffectId=600000;
 let packet;
 for(let i=0;i<30;i++){
  source.sim.step(1/60,{attacker:{pressed:i===0?['Z']:[],held:i===0?['Z']:[]}});
  const a=source.sim.actor('attacker');
  const effect=source.sim.state.effects.find(e=>e.ownerId===a.id&&e.name===(id==='RF'?'DamageEffect_RF_COMBO_Z':'DamageEffect_AN_Combo_Z')&&e.active);
  if(effect&&(id!=='RF'||source.sim.state.events.some(e=>e.type==='hit'&&e.actorId===a.id&&e.origin?.id===effect.id))){
   packet=report(source,'attacker',2,100);break;
  }
 }
 assert.ok(packet,'original command reaches its authored attack window');receive(victim,'attacker',packet);
 const a=victim.sim.actor('attacker'),b=victim.sim.actor('recipient');
 for(let i=0;i<12&&!b.sourceAddMoonlightNotice;i++)victim.sim.tickEffects(1/60);
 assert.ok(b.sourceAddMoonlightNotice,'real recipient contact issues the typed receipt');
 assert.equal(b.sourceAddMoonlightNotice.receipts[0].attackerId,'attacker');
 assert.equal(b.sourceAddMoonlightNotice.receipts[0].kind,'effect');
 const receiptStack=b.sourceAddMoonlightNotice.receipts[0].stack;
 // Independent original DD table, contracts/add-moonlight-explosions-v45.json.
 const originalMagicByStack={1:4.65,2:9.3,3:13.95};assert.ok(Object.hasOwn(originalMagicByStack,receiptStack));
 receive(source,'recipient',report(victim,'recipient',3,101));
 const explosion=source.sim.state.events.find(e=>e.type==='addMoonlightExplosion');assert.ok(explosion);assert.equal(explosion.stack,receiptStack);
 const current=source.sim.actor('attacker');assert.equal(current.professionId,id);assert.equal(current.loadout.some(s=>s?.skillId===29024),false);
 const p=report(source,'attacker',2,102),raw=p.effects.find(e=>e.id===explosion.effectId);
 assert.equal(raw.skillId,29024);assert.equal(raw.ownerId,undefined,'owner is the envelope identity');
 assert.doesNotThrow(()=>receive(victim,'attacker',p));
 const e=victim.sim.state.effects.find(e=>e.networkId===explosion.effectId),hp=b.hp;assert.ok(e);
 for(let i=0;i<12;i++)victim.sim.tickEffects(1/60);
 const hit=victim.sim.state.events.find(row=>row.type==='hit'&&row.origin?.id===e.id);
 assert.ok(hit?.amount>0);assert.equal(hit.actorId,'attacker');assert.equal(hit.data.DAMAGE.MAGIC,originalMagicByStack[receiptStack]);assert.ok(b.hp<hp);
});
