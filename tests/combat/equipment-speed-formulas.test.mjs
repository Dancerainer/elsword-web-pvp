import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEquipmentSpeedValue,composeEquipmentSpeedAttributes} from '../../packages/combat-core/equipment-speed-formulas.mjs';
const equipment={animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.000001,`${actual} != ${expected}`);
const percent=(value,stat='moveSpeedMultiplier')=>({stat,changeType:3,value});

// Expectations are hand-evaluated from the reference consumer and literal
// target Buff percentages, not outputs recorded from the implementation.
test('equipment values stay final percentages; the socket curve is not applied a second time',()=>{
  const result=composeEquipmentSpeedAttributes(equipment);
  close(result.animationSpeedMultiplier,1.4);
  close(result.moveSpeedMultiplier,1.115);
  close(result.jumpSpeedMultiplier,1.115);
  assert.deepEqual(equipment,{animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23});
});

test('target LK movement Buff 18 composes before the half-increment adjustment',()=>{
  // (1.23 * 1.625 - 1) / 2 + 1 = 1.499375, not 1.115 * 1.625.
  const result=composeEquipmentSpeedAttributes(equipment,{modifiers:[percent(1.625)]});
  close(result.moveSpeedMultiplier,1.499375);
  close(result.jumpSpeedMultiplier,1.115);
});

test('a slowing Buff skips half-increment adjustment and can reduce below half speed',()=>{
  close(composeEquipmentSpeedAttributes(equipment,{modifiers:[percent(.25)]}).moveSpeedMultiplier,.3075);
});

test('all percent Buff factors combine before the slow versus fast branch',()=>{
  // 1.25 * (2 * .5) => 1.25, positive branch => 1.125.
  assert.equal(composeEquipmentSpeedValue({baseValue:1,equipmentPercent:.25,halfIncrement:true,
    modifiers:[percent(2),percent(.5)]}),1.125);
  // Buff product .75 is slowing even though equipment 2 * .75 is above 1.
  assert.equal(composeEquipmentSpeedValue({baseValue:1,equipmentPercent:1,halfIncrement:true,
    modifiers:[percent(.75)]}),1.5);
});

test('passive sum and multiple join equipment and Buffs before speed adjustment',()=>{
  // (1.25 * 1.25 * 2 * 1.5 - 1) / 2 + 1 = 2.84375.
  assert.equal(composeEquipmentSpeedValue({baseValue:1,equipmentPercent:.25,passiveSum:.25,
    passiveMultiple:2,modifiers:[percent(1.5)],halfIncrement:true}),2.84375);
  assert.equal(composeEquipmentSpeedValue({baseValue:500,equipmentPercent:.25,passiveSum:.25,
    passiveMultiple:2,modifiers:[percent(1.5)],halfIncrement:true}),1421.875);
});

test('animation speed consumes the complete equipment/passive/Buff product without halving',()=>{
  assert.equal(composeEquipmentSpeedValue({baseValue:1,equipmentPercent:.25,passiveSum:.25,
    passiveMultiple:2,modifiers:[percent(1.5)]}),4.6875);
});

test('last absolute swap wins even if percent factors follow it',()=>{
  assert.equal(composeEquipmentSpeedValue({baseValue:500,equipmentPercent:.25,
    modifiers:[{changeType:0,value:200},percent(2),{changeType:0,value:300},percent(.5)],halfIncrement:true}),300);
  assert.equal(composeEquipmentSpeedAttributes(equipment,{modifiers:[{stat:'animationSpeedMultiplier',changeType:0,value:.5},percent(2,'animationSpeedMultiplier')]}).animationSpeedMultiplier,.5);
});
test('exact zero movement and jump swaps need no unknown source denominator',()=>{
  const result=composeEquipmentSpeedAttributes(equipment,{modifiers:[
    {stat:'moveSpeedMultiplier',changeType:0,value:0},percent(2),
    {stat:'jumpSpeedMultiplier',changeType:0,value:0},percent(.5,'jumpSpeedMultiplier')]});
  assert.equal(result.moveSpeedMultiplier,0);assert.equal(result.jumpSpeedMultiplier,0);
  assert.throws(()=>composeEquipmentSpeedAttributes(equipment,{modifiers:[{stat:'jumpSpeedMultiplier',changeType:0,value:1}]}),/separate source base/);
});

test('source zero-product guard is preserved, while unsupported raw-point factors fail closed',()=>{
  assert.equal(composeEquipmentSpeedValue({baseValue:500,equipmentPercent:.25,modifiers:[percent(0)],halfIncrement:true}),500);
  for(const changeType of [1,2,99])assert.throws(()=>composeEquipmentSpeedValue({baseValue:500,equipmentPercent:.25,modifiers:[{changeType,value:50}]}),/verified option converter/);
  assert.throws(()=>composeEquipmentSpeedAttributes(equipment,{modifiers:[{stat:'moveSpeedMultiplier',changeType:0,value:500}]}),/separate source base/);
});

test('nonfinite or invalid equipment values cannot become silent default speed',()=>{
  for(const value of [undefined,NaN,Infinity,1e100,'1.4',.9])assert.throws(()=>composeEquipmentSpeedAttributes({...equipment,animationSpeedMultiplier:value}));
  assert.throws(()=>composeEquipmentSpeedValue({baseValue:1,equipmentPercent:1e100}),/finite in binary32/);
  assert.throws(()=>composeEquipmentSpeedAttributes(equipment,{modifiers:[percent(1e100)]}),/finite in binary32/);
  assert.throws(()=>composeEquipmentSpeedValue({baseValue:1,equipmentPercent:-.1}),/nonnegative/);
  assert.throws(()=>composeEquipmentSpeedAttributes(equipment,{modifiers:[percent(-1)]}),/nonnegative/);
});
