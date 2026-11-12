import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import {historicalRfPreset} from '../helpers/rf-historical-preset-v20.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const preset=authoredEquipmentPreset(JSON.parse(readFileSync(new URL('../../config/rf-preset.json',import.meta.url))));
const map={sceneId:'explicit-protection-unit-fixture',lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LT_NORMAL'}]};
const damage={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,STOP_TIME_ATT:.02,STOP_TIME_DEF:.1};
function make(selected=historicalRfPreset(preset)){return createSimulation({profile,map,preset:{...selected,passives:[],guildPassives:[]},
  actors:[{id:'rf',team:0,x:0,y:0},{id:'target',team:1,x:150,y:0,facing:-1}],
  effectAnchorSampler:(effect,actor)=>({position:[actor.x,actor.y+170+(effect.definition.POSITION_OFFSET_Y??0),actor.z],facing:actor.facing})});}
test('requested v20 RF equipment fixture is 800,000 HP with 40% action and23% movement/jump final options',()=>{
  const s=make(preset),a=s.actor('rf');assert.equal(a.hpMax,800000);assert.equal(a.hp,800000);
  assert.equal(a.stats.animationSpeedMultiplier,Math.fround(1.4));
  assert.equal(a.stats.moveSpeedMultiplier,Math.fround(1.115));
  assert.equal(a.stats.jumpSpeedMultiplier,Math.fround(1.115));
  assert.deepEqual(a.speedAttributeOptions,{animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23});
});
test('accepted armored hit keeps owner effects and emits source head+70 yellow integer display metadata',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');s.drainEvents();b.superArmor=true;
  const state=b.state;s.state.effects.push({id:99,ownerId:b.id,deleteConditions:[1],dead:false});
  const result=s.applyHit(a,b,damage);assert.equal(result.accepted,true);assert.equal(result.amount,1000);
  assert.equal(b.state,state);assert.equal(s.state.effects[0].dead,false);assert.equal(b.hitStop,0);
  const event=s.drainEvents().find(e=>e.type==='hit');
  assert.deepEqual(event.damageNumber,{position:[150,240,0],style:'normal'});assert.equal(event.deleteDamageReactEffects,false);
});
test('unprotected hit cleans damage-react effects; rejected invincible hit never displays damage',()=>{
  const s=make(),a=s.actor('rf'),b=s.actor('target');s.drainEvents();
  s.state.effects.push({id:99,ownerId:b.id,deleteConditions:[1],dead:false});
  s.applyHit(a,b,damage);assert.equal(s.state.effects[0].dead,true);
  assert.equal(s.drainEvents().find(e=>e.type==='hit').deleteDamageReactEffects,true);
  b.invincible=true;const hp=b.hp;assert.equal(s.applyHit(a,b,damage).accepted,false);assert.equal(b.hp,hp);
  assert.equal(s.drainEvents().filter(e=>e.type==='hit').length,0);
});
