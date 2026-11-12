import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveDamageValues} from '../../packages/combat-core/damage-values.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={lines:[{lineId:0,start:[-5000,0,0],end:[5000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
test('target dash Z recovered ADDVN executes the target WALK_SPEED +250 without altering original data',()=>{
  const raw=profile.damageEffects.DamageEffect_RF_DASH_COMBO_Z.raw.DAMAGE_DATA,before=JSON.stringify(raw);
  const result=resolveDamageValues(raw,profile.physics);
  assert.equal(raw.BACK_SPEED_X.$expression,'ADDVN');assert.equal(profile.physics.WALK_SPEED,500);
  assert.equal(result.supported,true);assert.equal(result.data.BACK_SPEED_X,750);assert.equal(JSON.stringify(raw),before);
});
test('actual dash Z damage no longer throws and every recovered target damage table has executable scalar values',()=>{
  const sim=createSimulation({profile,map,actors:[{id:'rf',team:0,position:[0,0,0]},{id:'target',team:1,position:[100,0,0]}]});
  const result=sim.applyHit(sim.actor('rf'),sim.actor('target'),profile.damageEffects.DamageEffect_RF_DASH_COMBO_Z.raw.DAMAGE_DATA,{kind:'effect',attackPosition:[0,0,0]});
  assert.equal(result.accepted,true);assert.equal(Math.abs(sim.actor('target').vx),750);
  for(const [name,effect] of Object.entries(profile.damageEffects))for(const stage of ['DAMAGE_DATA','DAMAGE_DATA_NEXT']){
    if(effect.raw[stage])assert.deepEqual(resolveDamageValues(effect.raw[stage],profile.physics).unsupported,[],name+':'+stage);
  }
});
test('unconfirmed symbols and operators do not fall back to zero or evaluate arbitrary text',()=>{
  for(const raw of [{$symbol:'INIT_PHYSIC.UNCONFIRMED'},{$expression:'CALL',left:1,right:2}]){
    const result=resolveDamageValues({BACK_SPEED_X:raw},profile.physics);assert.equal(result.supported,false);assert.deepEqual(result.data.BACK_SPEED_X,raw);
  }
  const sim=createSimulation({profile,map,actors:[{id:'rf',team:0,position:[0,0,0]},{id:'target',team:1,position:[100,0,0]}]});
  const b=sim.actor('target'),hp=b.hp;
  assert.deepEqual(sim.applyHit(sim.actor('rf'),b,{REACT_TYPE:1,BACK_SPEED_X:{$symbol:'unknown'},DAMAGE:{PHYSIC:1}}),{accepted:false,reason:'unsupported-damage-values'});
  assert.equal(b.hp,hp);assert.equal(b.state,'RSI_WAIT');
});

