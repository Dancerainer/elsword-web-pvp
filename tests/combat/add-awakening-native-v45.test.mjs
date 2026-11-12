import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import contract from '../../contracts/add-awakening-native-v45.json' with {type:'json'};
import {applyAddFormationSourceClock,ADD_FORMATION_SOURCE_SET} from '../../packages/combat-core/add-awakening-v45.mjs';

test('44 original source preserves absolute animation gates and37 visual members without inventing a stun attack',()=>{
 assert.equal(contract.constants.find(c=>c.id==='shock').value,Math.fround(.46));
 assert.equal(contract.confirmedClock.setStartAnimation,0);
 const raw=contract.originalDeclarations.formationSet.call.args.at(-1),rows=Object.entries(raw).filter(([k])=>/^EFFECT\d+$/.test(k));
 assert.equal(rows.length,37);assert.deepEqual([...new Set(rows.map(([,v])=>v.EFFECT_TYPE))].sort(),[4,8]);
 assert.equal(contract.originalDeclarations.formationBuffFactor.call.args.at(-1).BUFF_FACTOR.BEHAVIOR.BBT_EFFECT_SET_WITH_DAMAGE.NOT_USE,1);
 assert.equal(contract.attackProducerStatus,'unresolved-no-source-bound-hard-stagger-producer');
});

test('44 source clock projection applies only to the exact original Add set and owner',()=>{
 const f=originalAddFixture('LP'),e={ownerId:f.a.id,setName:ADD_FORMATION_SOURCE_SET,clock:'animation',setStartAnimation:.46};
 assert.equal(applyAddFormationSourceClock(e,f.a,f.profile),true);assert.equal(e.setStartAnimation,0);
 const ordinary={...e,setName:'EffectSet_AN_Combo_X_Projectile',setStartAnimation:.46};
 assert.equal(applyAddFormationSourceClock(ordinary,f.a,f.profile),false);assert.equal(ordinary.setStartAnimation,.46);
 const custom={...e,clock:'custom',setStartAnimation:.46};assert.equal(applyAddFormationSourceClock(custom,f.a,f.profile),false);assert.equal(custom.setStartAnimation,.46);
 assert.throws(()=>applyAddFormationSourceClock({...e,ownerId:'foreign'},f.a,f.profile));
});

for(const id of ['LP','MM','DE'])test(`44 ${id}: real awakening emits source.4 startup at native.46, and .6 mesh by.6`,()=>{
 const {sim,a}=originalAddFixture(id);a.sourceAdd.dp=8000;let formationApply=null,burst=null,mesh=null;
 for(let i=0;i<100;i++){
  const before=sim.state.events.length;
  sim.step(1/60,{add:{pressed:i===0?['AWAKEN']:[],held:i===0?['AWAKEN']:[]}},{snapshot:false});
  for(const e of sim.state.events.slice(before)){
   if(e.type==='addFormationStarted')formationApply={time:e.time,animation:a.animationTime};
   if(e.type==='effectStarted'&&e.setName===ADD_FORMATION_SOURCE_SET){
    if(e.name==='ADD_Effect_Explosion_30_1')burst={time:e.time,animation:a.animationTime,state:a.state};
    if(e.name==='ADD_Effect_Explosion_1')mesh={time:e.time,animation:a.animationTime,state:a.state};
   }
  }
 }
 assert.ok(formationApply);assert.ok(burst);assert.ok(mesh);
 assert.equal(burst.time,formationApply.time,'original .4 member is due at .46 buff application');
 assert.ok(burst.animation>=Math.fround(.46)&&burst.animation<.51);
 assert.ok(mesh.animation>=.6&&mesh.animation<.65,'original owner .6 gate is not delayed to1.06');
});

test('44 original absolute formation clock survives actual owned and critical serialization',async()=>{
 const {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState}=await import('../../packages/online/owned-state.mjs');
 const f=originalAddFixture('LP');f.a.sourceAdd.dp=8000;let frame=0;
 while(!f.sim.state.effects.some(e=>e.setName===ADD_FORMATION_SOURCE_SET)&&frame<60){
  f.sim.step(1/60,{add:{pressed:frame===0?['AWAKEN']:[],held:frame===0?['AWAKEN']:[]}},{snapshot:false});frame++;
 }
 const p=validateOwnedState(encodeOwnedState(f.sim,'add',{epoch:1,frameSeq:frame}));
 const wire=p.effects.filter(e=>e.setName===ADD_FORMATION_SOURCE_SET);
 assert.ok(wire.some(e=>e.name==='ADD_Effect_Explosion_1'),'original .6 member is still pending at the .46 snapshot');
 assert.ok(wire.every(e=>e.clock==='animation'&&e.setStartAnimation===0));
 for(const critical of [false,true]){
  const v=originalAddFixture('LP'),packet=structuredClone(p);
  if(critical)packet.actions=[encodeCriticalAction(p,{id:1,effectIds:new Set(wire.map(e=>e.id))})];
  const valid=validateOwnedState(packet);
  validateOwnedReferences(valid,v.a,v.sim.profileFor(v.a),v.sim.map,{actors:v.sim.state.actors,profiles:v.sim.profiles});
  applyOwnedState(v.sim,'add',valid);
  const received=v.sim.state.effects.filter(e=>e.setName===ADD_FORMATION_SOURCE_SET);
  assert.equal(received.length,wire.length);assert.ok(received.every(e=>e.setStartAnimation===0));
  assert.deepEqual(received.map(e=>e.networkId).sort(),wire.map(e=>e.id).sort());
 }
});
