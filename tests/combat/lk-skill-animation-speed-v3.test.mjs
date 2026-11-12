import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {actionAnimationSpeed} from '../../packages/combat-core/action-animation-speed.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/lk-profile.json'),preset=authoredEquipmentPreset(read('config/lk-preset.json')),frozen=read('tests/fixtures/lk-skill-animation-speed-v3.json'),source=read('contracts/lk-skill-animation-speed-source-v3.json');
const dt=1/120,map={sceneId:'lk-action-speed-v3',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LT_NORMAL'}]};
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-10,`${message}: ${a} != ${b}`);
function make(multiplier){
 const sim=createSimulation({profile,map,preset:{...preset,passives:[],guildPassives:[],bannedSkillIds:[],loadout:Array(8).fill(null),
 attributes:{...preset.attributes,hpMax:1000000,mpMax:1000,animationSpeedMultiplier:Math.max(1,multiplier),moveSpeedMultiplier:1,jumpSpeedMultiplier:1}},
 actors:[{id:'lk',professionId:'LK',team:0,x:0,y:0,facing:1},{id:'target',professionId:'LK',team:1,x:9000,y:0,facing:-1}]});
 // .5 probes ResetAnimSpeed's already-composed runtime stat boundary. It is
 // not a negative equipment option or a claim about an acquired slow Buff.
 if(multiplier<1)sim.actor('lk').stats.animationSpeedMultiplier=Math.fround(multiplier);
 return sim;
}
// Preserve the independent target gate/authored speed fixture. Only convert
// its final equipment input to the source binary32 representation.
const expectedSpeed=(state,multiplier)=>state.authoredSpeed*(state.webItemAbility?Math.fround(multiplier):1);
test('all 20 target LK actives / 38 traits retain original speed fields and separate confirmed fixed-speed corrections',()=>{
 assert.equal(frozen.rows.length,20);assert.equal(source.branchCount,38);assert.equal(source.targetExplicitFalseCount,5);
 assert.equal(createHash('sha256').update(readFileSync(new URL('../../'+source.fixture,import.meta.url))).digest('hex'),source.fixtureSha256);
 for(const row of frozen.rows){const skill=profile.skillCatalog.find(s=>s.skillId===row.skillId);assert.deepEqual(skill.states,row.states.map(s=>s.state));
  assert.deepEqual(skill.branches.map(b=>({id:b.id,memoType:b.memoType,rawPositions:b.rawPositions})),row.branches);
  for(const state of row.states)for(const field of ['ANIM_SPEED','APPLY_ANIM_SPEED_BY_ITEM_ABILITY','TRANSITION']){
   assert.equal(Object.hasOwn(profile.states[state.state].raw,field),Object.hasOwn(state.raw,field));assert.deepEqual(profile.states[state.state].raw[field],state.raw[field]);}}
});
for(const row of frozen.rows)test(`LK ${row.skillId}: normal/awake and every trait gate clocks at .5/1/1.4/1.5 final action speed`,()=>{
 for(const multiplier of frozen.multipliers)for(const awake of [false,true])for(const branchId of ['none',...row.branches.map(b=>b.id)]){
  const s=make(multiplier),a=s.actor('lk');a.awakening.remaining=awake?30:0;s.configureLoadout([{skillId:row.skillId,branchId},...Array(7).fill(null)],a.id);
  const initialState=a.state;s.step(dt,{lk:{pressed:['A']}},{snapshot:false});
  assert.ok(s.drainEvents().some(e=>e.type==='skillStarted'&&e.skillId===row.skillId));
  if(row.noStateChange){assert.equal(a.state,initialState);assert.equal(a.skillId,null);continue;}
  assert.equal(a.skillId,row.skillId);assert.equal(a.skillContext.branchId,branchId);assert.equal(a.skillContext.hyperState,awake);
  const expected=row.states.find(state=>state.state===a.state);assert.ok(expected,a.state);close(s.animationSpeed(a),expectedSpeed(expected,multiplier),a.state);
  for(const state of row.states){s.enter(a,state.state,'source-speed-successor-fixture');
   close(s.animationSpeed(a),expectedSpeed(state,multiplier),state.state+' target');
   close(a.animationTargetSpeed,expectedSpeed(state,multiplier),state.state+' controller target');
   const before=a.animationTime;s.advanceAnimation(a,profile.states[a.state],dt);
   close(a.animationTime-before,dt*expectedSpeed(state,multiplier),state.state+' event / pose clock');}
 }
});
test('fixed LK skills respect stops and explicit overrides while ordinary commands still use final speed',()=>{
 const s=make(1.5),a=s.actor('lk');s.configureLoadout([{skillId:21031},...Array(7).fill(null)],'lk');s.step(dt,{lk:{pressed:['A']}});
 close(s.animationSpeed(a),1,'Spiral Blast fixed');a.hitStop=.1;const before=a.animationTime;s.step(dt,{});assert.equal(a.animationTime,before);
 for(const override of [0,.5,2]){a.animationSpeedOverride=override;assert.equal(actionAnimationSpeed(a,profile.states[a.state]),override);}
 a.animationSpeedOverride=null;s.enter(a,'RSI_COMBO_Z','normal-command');close(s.animationSpeed(a),1.5*(profile.states.RSI_COMBO_Z.raw.ANIM_SPEED??1),'normal Z stat speed');
});
