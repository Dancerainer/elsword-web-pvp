import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const source=JSON.parse(readFileSync(new URL('../fixtures/effects/shadow-edge-trace-2016.json',import.meta.url)));
const name='DAMAGE_EFFECT_SCA_SHADOW_EDGE_Link',index={templates:source.templates};
const profile={target:{unitType:8},states:{cast:{raw:{}}},skillCatalog:[{skillId:28215,states:['cast']}],effectSets:{},damageEffects:{[name]:source.damage},
  sourceLiteralResources:[name],skillEffectResourceRoots:{28215:[name]}};
const full={level:'high',particleDivisor:1};

test('long-lived Shadow Edge reserves concurrent Trace tails instead of 9999 seconds of cumulative births',()=>{
  const before=structuredClone(source),budget=collectEffectMeshBudget(profile,index,[{skillId:28215}],{effectQuality:full});
  const demand=budget.demands.get('SDK_LINK_P02');
  // Two source emitters, each with two live parents. Float32 .2 rounds up
  // to thirteen 60Hz packets: at 10/s allow three tail births plus one carry.
  assert.equal(demand.views,2*(2+3+1)*2);
  assert.equal(demand.budgetScope,undefined);assert.deepEqual(source,before);
  const runtime=createEffectRuntime({index,effectQuality:full});runtime.add('SDK_LINK_P00M');runtime.add('SDK_LINK_P00M');let peak=0;
  for(let frame=0;frame<1800;frame++){runtime.step(1/60,{});peak=Math.max(peak,[...runtime.particles.values()].filter(p=>p.name==='SDK_LINK_P02').length);}
  assert.ok(peak>0);assert.ok(peak<=demand.views,'all observed live original Trace meshes fit the source bound');
});

test('unequipped compiled callback still prepares every original mesh draw pass, then grows for its equipped skill',()=>{
  const cold=collectEffectMeshBudget(profile,index,[],{effectQuality:full}),ready=collectEffectMeshBudget(profile,index,[{skillId:28215}],{effectQuality:full});
  assert.deepEqual([...cold.templates].sort(),[...ready.templates].sort());
  for(const [name,demand]of cold.demands){assert.equal(demand.views,demand.drawCount,name);assert.equal(demand.budgetScope,'resource-materials-only');}
  assert.ok(ready.demands.get('SDK_LINK_P02').views>cold.demands.get('SDK_LINK_P02').views);
});
