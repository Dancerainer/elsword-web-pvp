import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
// Buff declarations/consumers are measured with Focus only, neutral gear and
// no guild bonuses. RF24405 and proc408 compose in their separate v20 suite.
const buffFixturePreset={...preset,attributes:{...preset.attributes,
  animationSpeedMultiplier:1.3,moveSpeedMultiplier:1.3,jumpSpeedMultiplier:1.21,
  damageReduction:0,awakeningChargeBonus:0},passives:[24400],guildPassives:[]};
const make=()=>createSimulation({profile,map,preset:buffFixturePreset,nativeSkillValues,seed:2016,
  actors:[{id:'rf',team:0,position:[2022.98,2840,0],facing:-1,guildPassives:[]},{id:'target',team:1,position:[1858.11,2840,0],facing:1,guildPassives:[]}]});
const fire=profile.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR;
const wound=profile.damageEffects.RAVEN_OVER_TAKER_CHARGED_BOLT.raw.DAMAGE_DATA.BUFF_FACTOR;
const stun=profile.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
const zeroDamage={REACT_TYPE:0,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:0}};
function advance(s,steps,dt=.1,input={}){for(let i=0;i<steps;i++)s.step(dt,input,{snapshot:false});}
test('accepted skill hit applies original factor; DOT has independent one-second timer and no ordinary hit reaction',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');
  s.applyHit(a,b,{...zeroDamage,BUFF_FACTOR:fire},{kind:'character',skillId:24218});
  assert.equal(b.buffs.length,1);assert.equal(b.buffs[0].templateId,37);
  const beforeHp=b.hp,serial=b.stateSerial;s.advanceActorBuffs(b,.5);
  assert.equal(b.hp,beforeHp);s.advanceActorBuffs(b,.5);
  const delta=Math.fround(2000*Math.fround(-.3));
  assert.equal(b.hp,beforeHp+delta);assert.equal(b.stateSerial,serial);
  assert.equal(b.knockdown.pending,null);
  const display=s.state.effects.filter(e=>e.ownerId===b.id&&e.buffTemplateId===37);
  assert.ok(display.some(e=>e.name==='SwordFireTip'));
  s.tickEffects(.01);assert.ok(display.every(e=>s.state.effects.includes(e)));
  s.advanceActorBuffs(b,4);assert.equal(b.buffs.length,0);
  assert.ok(display.every(e=>e.dead&&e.endReason==='buff-finished'));
  s.tickEffects(.01);assert.ok(s.state.events.some(e=>e.type==='effectEnded'&&e.name==='SwordFireTip'));
});
test('source stun blocks command edges and expires after two received hits on next positive update',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');s.grantBuff(a,b,stun);
  s.step(.1,{target:{pressed:['Z'],held:['Z']}});assert.equal(b.state,'RSI_DAMAGE_GROGGY');assert.equal(b.animationName,'Fatal');
  s.applyHit(a,b,zeroDamage,{kind:'character'});assert.equal(b.buffs[0].finalizers.find(v=>v.kind==='received').remaining,1);
  s.applyHit(a,b,zeroDamage,{kind:'character'});assert.equal(b.buffs.length,1);
  s.step(.1,{target:{pressed:['Z'],held:['Z']}});assert.equal(b.buffs.length,0);
  assert.equal(b.buffControls.inputBlock,false);assert.equal(b.state,'RSI_COMBO_Z');
});
test('wound prevents double-tap dash while keeping walk inputs',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');
  const originalRng=s.rng;s.rng=()=>0;s.grantBuff(a,b,wound);s.rng=originalRng;
  advance(s,1,.02,{target:{pressed:['RIGHT'],held:['RIGHT']}});
  advance(s,1,.02,{target:{released:['RIGHT']}});
  advance(s,1,.02,{target:{pressed:['RIGHT'],held:['RIGHT']}});
  assert.equal(b.buffControls.dashBlock,true);assert.equal(b.state,'RSI_WALK');
});
test('EnchantHand inserts only original empty marker at default animation time zero',()=>{
  const s=make(),a=s.actor('rf');s.configureLoadout([{skillId:24206},null,null,null,null,null,null,null]);
  s.step(.02,{pressed:['A']});assert.ok(a.buffs.some(b=>b.templateId===543));
  assert.deepEqual(a.buffs.find(b=>b.templateId===543).behaviors,[{type:55,kind:'empty'}]);
  assert.ok(!a.buffs.some(b=>b.templateId===544));
});
test('buff native clocks and combat state survive JSON restore; already dead actors cannot revive through later HP behavior',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');s.grantBuff(a,b,fire);advance(s,7);
  const copy=make();copy.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<12;i++){s.step(.1);copy.step(.1);s.drainEvents();copy.drainEvents();}
  assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(copy.snapshot())));
  b.hp=1;const healing=structuredClone(b.buffs[0]);healing.templateId=999;
  healing.behaviors[0].value=2000;b.buffs.push(healing);
  s.advanceActorBuffs(b,1);assert.equal(b.hp,0);
});
test('AIR condition accepts ShadowStep; ground-only FlameSword is rejected without WeaponTaker AirSlicer',()=>{
  const s=make(),a=s.actor('rf');s.configureLoadout([{skillId:24217},{skillId:24218},null,null,null,null,null,null]);
  a.grounded=false;a.y+=100;s.enter(a,'RSI_JUMP_DOWN','fixture-air');
  s.step(.02,{pressed:['S']});assert.equal(a.skillId,null);
  s.step(.02,{pressed:['A']});assert.equal(a.skillId,24217);
});
test('WeaponCrash numeric buff factor applies original .57 attacks for12 seconds and restores the base without compounding',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');
  const data=profile.damageEffects.DamageEffect_Raven_Weapon_Break.raw.DAMAGE_DATA;
  assert.deepEqual(data.BUFF_FACTOR_ID,{'1':42});s.applyHit(a,b,data,{kind:'effect',skillId:24204});
  assert.equal(b.buffs[0].templateId,48);s.advanceActorBuffs(b,.1);
  const expected=Math.fround(2000*Math.fround(.57));assert.equal(b.stats.physicalAttack,expected);assert.equal(b.stats.magicAttack,expected);
  s.grantBuff(a,b,42,1);s.advanceActorBuffs(b,.1);assert.equal(b.stats.magicAttack,expected);
  for(let i=0;i<49;i++)s.advanceActorBuffs(b,.25);
  assert.equal(b.buffs.length,0);assert.equal(b.stats.physicalAttack,2000);assert.equal(b.stats.magicAttack,2000);
});
