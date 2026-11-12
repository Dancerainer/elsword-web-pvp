import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile,visualIndex} from '../helpers/rf-passive-fixture-v12.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';

test('actual XCrash effect births and hit origins select density from their retained skill ownership',async()=>{
  const simulation=await make({skillId:24010,passives:[]});simulation.drainEvents();
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  let births=0,hits=0;
  for(let frame=0;frame<360;frame++){
    simulation.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
    for(const event of simulation.drainEvents()){
      if(event.type==='effectStarted'&&event.skillId===24010){
        assert.deepEqual(policy.effect(event),{level:'medium',particleDivisor:16});births++;
      }
      if(event.type==='hit'&&event.origin?.skillId===24010){
        assert.deepEqual(policy.characterHit(event),{level:'medium',particleDivisor:16});hits++;
      }
    }
  }
  assert.ok(births>1);assert.ok(hits>0);
  // Ownership is on the event, never inferred from the owner's current state.
  assert.deepEqual(policy.effect({skillId:24010,setName:'late-tail'}),{level:'medium',particleDivisor:16});
});

test('XCrash density leaves short scratch, singleton flash and mesh geometry complete; other skills and combos keep their existing quality',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),quality=policy.effect({skillId:24010});
  const scratch=visualIndex.templates.XCrash_ScrachP01;
  assert.equal(particlePresentationBudget(scratch,scratch.fields.NumParticles,-1,quality).divisor,1);
  const fire=visualIndex.templates.Raven_Hand_Fire05;
  assert.equal(particlePresentationBudget(fire,fire.fields.NumParticles,-1,quality).divisor,16);
  assert.equal(particlePresentationBudget({...fire,kind:'mesh'},fire.fields.NumParticles,-1,quality).divisor,1);
  assert.equal(particlePresentationBudget(fire,fire.fields.NumParticles,1,quality).divisor,1);
  for(const skillId of [24206,24203,24027])assert.deepEqual(policy.effect({skillId}),DEFAULT_EFFECT_QUALITY);
  assert.deepEqual(policy.effect({skillId:null,setName:'EffectSet_A_RF_XXX'}),FULL_EFFECT_QUALITY);
  assert.deepEqual(createEffectPresentationPolicy(profile,FULL_EFFECT_QUALITY).effect({skillId:24010}),FULL_EFFECT_QUALITY);
});
