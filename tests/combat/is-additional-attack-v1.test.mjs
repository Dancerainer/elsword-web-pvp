import test from 'node:test';
import assert from 'node:assert/strict';
import {isAdditionalAttackRatio,isAdditionalAttackDamage} from '../../packages/combat-core/is-additional-attack.mjs';
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
test('IS Cruel Slayer source curve: 10 points per stack is not ten final percent',()=>{
  // Independent algebra of target prototypes: <=.4 -> x*.375;
  // 50 points -> (.5*(1.32-.4*.5)-.064)*.375 = .186.
  for(const [points,expected] of [[0,0],[10,.0375],[20,.075],[30,.1125],[40,.15],[50,.186],[165,.384375],[500,.384375]])
    close(isAdditionalAttackRatio(points,85),expected);
  close(isAdditionalAttackRatio(10,1),.035625);
  assert.throws(()=>isAdditionalAttackRatio(-1,85));
  assert.throws(()=>isAdditionalAttackRatio(10,undefined));
});
test('IS additional damage physical/magic/mixed and weapon channels use the source total stat',()=>{
  const options={points:10,level:85,stats:{physicalAttack:2000,magicAttack:1000},data:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1,MAGIC:1}}};
  for(const [type,expected] of [[0,112.5],[1,56.25],[2,84.375],[3,112.5],[4,56.25],[5,84.375]])
    close(isAdditionalAttackDamage({...options,data:{...options.data,DAMAGE_TYPE:type}}),expected,.0003);
  close(isAdditionalAttackDamage({...options,points:50}),558,.0003);
  close(isAdditionalAttackDamage({...options,powerMultiplier:2}),112.5*2**.65,.0003);
  assert.equal(isAdditionalAttackDamage({...options,powerMultiplier:0}),0);
  assert.equal(isAdditionalAttackDamage({...options,data:{...options.data,NO_DAMAGE:1}}),0);
  assert.equal(isAdditionalAttackDamage({...options,data:{...options.data,LV_DAMAGE:true}}),0);
  assert.equal(isAdditionalAttackDamage({...options,data:{...options.data,DAMAGE_TYPE:6}}),0);
});
