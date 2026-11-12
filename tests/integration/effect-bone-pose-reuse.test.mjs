import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {make,profile,index,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

test('the actual seventeen FireDummy attachments reuse one full skeleton and invalidate every changed pose input',async()=>{
  const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});s.drainEvents();
  let effect;
  for(let frame=0;frame<240&&!effect;frame++){
    s.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
    effect=s.state.effects.find(e=>e.name==='DamageEffect_SA_RRF_XCrash_Fire_FX');
  }
  assert.ok(effect,'real native XCrash callback creates its original FireDummy');
  const samplers=createNativeSamplers({profile,characterPose:JSON.parse(readFileSync(resolve(fixtureRoot,'artifacts/rf/runtime-pose.json'))),effectIndex:index,effectPoses:poses});
  const names=Object.entries(profile.damageEffects.DamageEffect_SA_RRF_XCrash_Fire_FX.raw).filter(([key])=>/^TIME_PARTICLE\d+$/.test(key)).map(([,entry])=>entry.BONE_NAME);
  assert.equal(names.length,17);const actor=s.actor('rf');
  const first=names.map(name=>samplers.effectBoneSampler(effect,actor,name));assert.ok(first.every(point=>point?.every(Number.isFinite)));
  assert.deepEqual(samplers.effectSamplingStats(),{evaluations:1,reused:16});
  assert.deepEqual(names.map(name=>samplers.effectBoneSampler(effect,actor,name)),first);
  assert.deepEqual(samplers.effectSamplingStats(),{evaluations:1,reused:33});
  effect.animationTime+=.03125;
  const second=names.map(name=>samplers.effectBoneSampler(effect,actor,name));assert.equal(samplers.effectSamplingStats().evaluations,2);
  const anchor=effect.sourcePosedAnchor??effect.currentAnchor??effect.birthAnchor;
  anchor.position[0]+=100;
  const moved=names.map(name=>samplers.effectBoneSampler(effect,actor,name));assert.equal(samplers.effectSamplingStats().evaluations,3);
  for(let i=0;i<names.length;i++){assert.ok(Math.abs(moved[i][0]-second[i][0]-100)<1e-8);assert.equal(moved[i][1],second[i][1]);assert.equal(moved[i][2],second[i][2]);}
  anchor.rotation??=[0,0,0];anchor.rotation[2]+=10;names.map(name=>samplers.effectBoneSampler(effect,actor,name));
  assert.equal(samplers.effectSamplingStats().evaluations,4,'changing rotation without replacing the effect object invalidates its pose');
});
