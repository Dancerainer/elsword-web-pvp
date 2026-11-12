/** Independent original2016 source uses Bip01_Footsteps, not the qualified
 * fixedV5 reconstruction's Bip01+150. Native contacts use original helpers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
const LOOP='DamageEffect_ALP_Psychic_Storm_Loop',BLACK='DamageEffect_ALP_Psychic_Storm_Start_BlackHole',dt=1/60;
for(const formed of [false,true])for(const facing of [1,-1])test(`Storm original foot birth permits real ground multihit, formed=${formed}, facing=${facing}`,()=>{
 const {sim,a,b,profile}=originalAddFixture('LP',{skillId:29009});a.facing=facing;b.x=facing*250;a.mp=a.mpMax;a.sourceAdd.dp=8000;a.sourceAdd.mutation=3;
 for(let i=0;i<60;i++)sim.step(dt,{});
 if(formed){sim.step(dt,{add:{pressed:['AWAKEN'],held:['AWAKEN']}});
  for(let i=0;i<240&&(!a.sourceAdd.formation||!sim.skillAvailability(a.id,0).available);i++)sim.step(dt,{});
  assert.equal(a.sourceAdd.formation,true);assert.equal(sim.skillAvailability(a.id,0).available,true);}
 sim.drainEvents();const before=b.hp,births=[],hits=[],ids=new Map();
 for(let i=0;i<300;i++){
  sim.step(dt,i===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  for(const event of sim.drainEvents()){
   if(event.type==='effectStarted'){ids.set(event.effectId,event.name);if(event.name===LOOP)births.push(event);}
   if(event.type==='hit'&&event.targetId===b.id)hits.push(event);
  }
 }
 assert.ok(births.length>=8,'original periodic LOOP factory executed');
 assert.ok(births.every(e=>e.definition.BONE_NAME==='Bip01_Footsteps'&&(e.definition.POSITION_OFFSET_Y??0)===0),
  'original3273b180 UTF16 foot node / unchanged returned XYZ must reach every real birth');
 assert.equal(profile.damageEffects[BLACK].raw.DAMAGE_DATA.NO_DAMAGE,1);assert.equal(profile.damageEffects[BLACK].raw.DAMAGE_DATA.DAMAGE.MAGIC,0);
 const attraction=hits.filter(e=>ids.get(e.origin?.id)===BLACK);assert.ok(attraction.length>0);assert.ok(attraction.every(e=>e.amount===0),'the sourced attraction carrier is never relabelled as damage');
 const attacks=hits.filter(e=>ids.get(e.origin?.id)===LOOP&&e.amount>0);
 assert.ok(attacks.length>=2,`real original LOOP helper must repeatedly hit a normally attracted ground target; observed${attacks.length}`);
 assert.ok(b.hp<before);assert.ok(Math.abs(before-b.hp-hits.reduce((sum,e)=>sum+e.amount,0))<1e-6,'actual HP loss is explained by accepted sourced hit events');
 assert.equal(profile.damageEffects[LOOP].raw.DAMAGE_DATA.DAMAGE.MAGIC,3.49);assert.equal(profile.damageEffects[LOOP].raw.DAMAGE_DATA.PVP_RATE,.48);
});
