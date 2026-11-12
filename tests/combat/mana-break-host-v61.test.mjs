import test from 'node:test';
import assert from 'node:assert/strict';
import {createManaBreak,holdManaBreakDown,resumeManaBreakDown,manaBreakDamageReact,manaBreakStateStart} from '../../packages/combat-core/mana-break.mjs';
import {requestActorStop,advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';
function actor(){return {id:'a',state:'RSI_DAMAGE_BIG_FRONT',hp:100,mp:200,manaBreak:{...createManaBreak(),active:true,pendingCost:156},
 buffs:[],buffControls:{inputBlock:false},knockdown:{now:83,pending:7},animationName:'DamageBigFront',animationTime:0,grounded:true,vy:0,lineId:2,hitStop:0,worldStop:0};}
test('V61 holds the last hit reaction for source .7 stop and requests down once at resumed packet',()=>{
 const a=actor(),calls=[];assert.equal(holdManaBreakDown(a,{state:'RSI_DAMAGE_DOWN_FRONT',vy:0}),true);requestActorStop(a,'hit',.7,'b');
 assert.equal(a.hitStop,Math.fround(.7),'same-packet public owner stop projection is already nonzero');
 const sim={enter(_a,state,reason){calls.push({state,reason});_a.state=state;}};
 for(let i=0;i<41;i++){assert.equal(advanceActorStops(a,1/60),0);assert.equal(a.state,'RSI_DAMAGE_BIG_FRONT');assert.equal(a.mp,200);assert.deepEqual(a.knockdown,{now:83,pending:7});}
 let n=0;while(!advanceActorStops(a,1/60))assert.ok(++n<3);
 assert.equal(resumeManaBreakDown(sim,a),true);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');assert.equal(resumeManaBreakDown(sim,a),false);
 assert.equal(calls.length,1);assert.equal(a.manaBreak.pendingCost,156,'StateStart remains the consumer');
});
test('air reservation retains native backY; death cannot resurrect pending down',()=>{
 const a=actor(),sim={enter(_a,state){_a.state=state;}};holdManaBreakDown(a,{state:'RSI_DAMAGE_AIR_DOWN_INVINCIBLE',vy:700});
 assert.equal(resumeManaBreakDown(sim,a),true);assert.equal(a.vy,700);assert.equal(a.grounded,false);assert.equal(a.lineId,null);
 const b=actor();b.hp=0;b.state='RSI_DIE';holdManaBreakDown(b,{state:'RSI_DAMAGE_DOWN_FRONT',vy:0});
 assert.equal(resumeManaBreakDown(sim,b),false);assert.equal(b.state,'RSI_DIE');assert.equal(b.mp,200);assert.equal(b.manaBreak.active,false);
});
test('same-packet public cache survives JSON owner restore without private queues and matches source hold clock',()=>{
 const a=actor();holdManaBreakDown(a,{state:'RSI_DAMAGE_DOWN_FRONT',vy:0,hitStop:.7});requestActorStop(a,'hit',.7,'b');
 const restored=JSON.parse(JSON.stringify(a));delete restored.sourceStopQueues;
 let resumed=false;for(let n=0;n<44;n++){
  const first=advanceActorStops(a,1/60),second=advanceActorStops(restored,1/60);assert.equal(second,first);assert.equal(restored.hitStop,a.hitStop);
  if(n<41)assert.equal(second,0);
  if(second>0){resumed=true;break;}
 }
 assert.equal(resumed,true);assert.equal(restored.worldStop,0);
});
test('charge loops block voluntarily, ordinary hit clears the flag, buff hit preserves it',()=>{
 for(const state of ['ANSI_COMBO_XXZZ_LOOP','ANSI_DASH_JUMP_COMBO_XX_CHARGE','ANSI_AMM_COMBO_XXDownX_LOOP','RVC_DASH_COMBO_ZZZPushZ','ESSI_COMBO_ZZZ_CHARGE']){
  const a=actor();a.state=state;a.manaBreak.charge=60;manaBreakStateStart(null,a,state.startsWith('ESSI')?{CAN_MANA_BREAK:0}:{});
  assert.equal(a.manaBreak.noDetonation,true);assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,false);
  manaBreakDamageReact(a,{DAMAGE_TYPE:6});a.state='RSI_DAMAGE_BIG_FRONT';manaBreakStateStart(null,a,{});assert.equal(a.manaBreak.noDetonation,true);
  manaBreakDamageReact(a,{DAMAGE_TYPE:0,NO_DETONATION:0});manaBreakStateStart(null,a,{});assert.equal(a.manaBreak.noDetonation,false);
 }
});
