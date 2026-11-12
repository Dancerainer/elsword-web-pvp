/** Original declaration/native stack-selection contract, synthetic spawn
 * boundary only. Genuine original-pose hit trajectories are tested separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/add-moonlight-explosions-v45.json' with {type:'json'};
import {consumeAddMoonlightExplosion} from '../../packages/combat-core/add-moonlight-v45.mjs';
function fixture(stack){
 const attacker={id:'current-attacker',professionId:'RF',team:0,x:0,y:0,z:0,facing:1,skillId:900,skillScale:9,skillContext:{traitPolicy:{damageMultiplier:9}}};
 const buff={templateId:439,factorId:477,sourceActorId:'different-debuffer',accumulationCount:stack,
  behaviors:[{kind:'sourceCallback',type:43}],finalizers:[{kind:'time',remaining:20}]};
 const recipient={id:'recipient',team:1,buffs:[buff]},effects=[{id:1,ownerId:'recipient',buffTemplateId:439},{id:2,ownerId:'current-attacker',buffTemplateId:439}],calls=[],events=[];
 const sim={networkOwnerId:null,observationOnly:false,state:{effects},profileFor:()=>source,
  createEffect(actor,definition,options){calls.push({actor,definition,options});const e={id:3};effects.push(e);return e;},
  emit:(type,actorId,data)=>events.push({type,actorId,...data}),note(){}};
 return {sim,attacker,recipient,buff,calls,events,effects};
}
for(const stack of [1,2,3])test(`original Moonlight stack${stack} chooses its exact set and consumes the recipient's439 once`,()=>{
 const f=fixture(stack),args={sourceGuardsPassed:true,position:[100,3200,5],power:1,hyperMode:false};
 assert.equal(consumeAddMoonlightExplosion(f.sim,f.attacker,f.recipient,args),true);
 const {actor,definition,options}=f.calls[0];assert.equal(actor.id,'current-attacker');assert.equal(actor.professionId,'RF');
 assert.equal(actor.skillId,29024);assert.equal(actor.skillScale,1);assert.equal(actor.skillContext,null);
 assert.equal(options.setName,'EffectSet_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_'+stack);
 assert.deepEqual(options.birthAnchor,{position:[100,3200,5],rotation:[0,0,0],facing:1,customPosition:true});
 assert.equal(definition.NAME,'DAMAGE_EFFECT_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_'+stack);
 assert.equal(source.damageEffects[definition.NAME].raw.DAMAGE_DATA.DAMAGE.MAGIC,[4.65,9.3,13.95][stack-1]);
 assert.equal(definition.SCALE_X??1,[1,1.5,2][stack-1]);assert.equal(f.recipient.buffs.length,0);
 assert.equal(f.effects[0].dead,true);assert.equal(f.effects[1].dead,undefined);
 assert.equal(consumeAddMoonlightExplosion(f.sim,f.attacker,f.recipient,args),false);assert.equal(f.calls.length,1);
});
test('unqualified native guards, speculative observation, foreign recipient, missing closure and malformed world point cannot consume Moonlight',()=>{
 for(const variant of ['guard','observation','foreign','closure']){
  const f=fixture(3),args={sourceGuardsPassed:variant!=='guard',position:[0,0,0],power:1};
  if(variant==='observation')f.sim.observationOnly=true;
  if(variant==='foreign')f.sim.networkOwnerId='current-attacker';
  if(variant==='closure')f.sim.profileFor=()=>({effectSets:{},damageEffects:{}});
  assert.equal(consumeAddMoonlightExplosion(f.sim,f.attacker,f.recipient,args),false);assert.equal(f.recipient.buffs[0],f.buff);assert.equal(f.calls.length,0);
 }
 const f=fixture(1);assert.throws(()=>consumeAddMoonlightExplosion(f.sim,f.attacker,f.recipient,{sourceGuardsPassed:true,position:[NaN,0,0],power:1}),/Moonlight/);
});
