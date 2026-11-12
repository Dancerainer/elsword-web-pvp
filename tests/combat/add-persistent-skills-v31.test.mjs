import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
for(const [id,skillId,name]of [['LP',29009,'DamageEffect_ALP_Psychic_Storm_Start_BlackHole'],['DE',29023,'DamageEffect_ATT_Void_Field']])test(`${id}/${skillId} clears persistent attack and display handles after ending or interruption`,()=>{
 for(const interrupt of [false,true]){
  const {sim,a,b}=originalAddFixture(id,{skillId});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1200;
  for(let i=0;i<60;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:['A']}});
  assert.ok(sim.state.effects.some(e=>e.name===name));
  if(interrupt)sim.enter(a,'RSI_WAIT','received-interrupt-lifecycle-case');
  if(id==='DE'){
   // Independent original3273d1e0 constants. Collapse is per actual callback,
   // not a five-second duration and not the earlier alpha-to-zero boundary.
   const factor=.9800000190734863,threshold=.0010000000474974513;
   let oracle=1,requiredCallbacks=0;while(oracle>threshold){oracle=Math.fround(oracle*factor);requiredCallbacks++;}
   assert.equal(requiredCallbacks,342);
   const field=sim.state.effects.find(e=>e.name===name);assert.equal(field.sourceAddVoidCollapse?.scale??1,1);
   let callbacks=0,expectedScale=1;
   const endDuration=sim.profileFor(a).states.ANSI_SA_ATT_VOID_FIELD_END.clip.durationSeconds;
   const budget=Math.ceil((5+endDuration)*60)+requiredCallbacks+2;
   for(let frame=0;frame<budget&&!field.dead;frame++){
    const previous=field.sourceAddVoidCollapse?.scale??1;sim.step(1/60,{});const scale=field.sourceAddVoidCollapse?.scale??1;
    if(scale!==previous){callbacks++;expectedScale=Math.fround(expectedScale*factor);assert.equal(scale,expectedScale);if(callbacks<requiredCallbacks)assert.equal(Boolean(field.dead),false,'original threshold has not yet been crossed');}
   }
   assert.equal(callbacks,requiredCallbacks);assert.equal(field.dead,true);
  }else for(let i=0;i<300;i++)sim.step(1/60,{});
  assert.equal(sim.state.effects.some(e=>e.name===name),false);
  assert.ok(sim.state.events.some(e=>e.type==='effectEnded'&&e.name===name));
 }
});
