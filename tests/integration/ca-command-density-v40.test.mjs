import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import profile from '../../packages/combat-core/ca-profile.json' with {type:'json'};
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {CA_DENSE_COMMAND_EFFECT_SETS,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,createEffectPresentationPolicy,
  particlePresentationBudget,showsDamageParticle,showsCharacterHit} from '../../packages/effect-runtime/presentation-quality.mjs';
import {collectEffectMeshBudget,collectCommandTemplateQualities} from '../../apps/web/effect-prewarm.mjs';

const root='EffectSet_SDK_Dash_Jump_Combo_ZX',damage='DamageEffect_SDK_Dash_Jump_Combo_ZX';
const dense={level:'high',particleDivisor:8};
const base=resolve(process.env.ELSWORD_ASSETS_ROOT??(existsSync('runtime/v29-assets')?'runtime/v29-assets':'artifacts'),'ca');
const json=file=>JSON.parse(readFileSync(file)),hasAssets=existsSync(resolve(base,'manifest.json'));
function indexFor(){const manifest=json(resolve(base,'manifest.json'));
  return mergeVisualEffectIndexes(...(manifest.visualEffectIndexes??['fx/index.json']).map(file=>json(resolve(base,file))));}

test('CA 668ZX has an exact high-layer density exception; other commands, skills and siblings keep their quality',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  assert.deepEqual(CA_DENSE_COMMAND_EFFECT_SETS,[root]);assert.deepEqual([...policy.denseCommandSets],[root]);
  assert.equal(profile.effectSets[root].raw.EFFECT0.NAME,damage);
  assert.equal(profile.damageEffects[damage].raw.MAIN_EFFECT_NAME,'SDK_Combo_Projectile');
  assert.deepEqual(policy.effect({setName:root,skillId:null}),dense);
  assert.deepEqual(policy.effect({name:damage,skillId:null}),dense);
  for(const setName of policy.comboSets)if(setName!==root)
    assert.deepEqual(policy.effect({setName,skillId:null}),FULL_EFFECT_QUALITY,setName);
  for(const name of policy.comboEffects)if(name!==damage)
    assert.deepEqual(policy.effect({name,skillId:null}),FULL_EFFECT_QUALITY,name);
  for(const skill of profile.skillCatalog)
    assert.deepEqual(policy.effect({setName:root,name:damage,skillId:skill.skillId}),DEFAULT_EFFECT_QUALITY,'skill owner '+skill.skillId);
  assert.equal(showsDamageParticle({SHOW_LEVEL:'OL_HIGH'},dense),true);
  assert.equal(showsDamageParticle({SHOW_LEVEL:'OL_HIGH'},DEFAULT_EFFECT_QUALITY),false,'high layers were previously gated');
  assert.equal(showsCharacterHit({actorId:'a',targetId:'b'},'observer',policy.characterHit({origin:{skillId:null}})),true);
  const native=createEffectPresentationPolicy(profile,FULL_EFFECT_QUALITY);
  assert.deepEqual(native.effect({setName:root}),FULL_EFFECT_QUALITY);
  assert.deepEqual(native.effect({name:damage}),FULL_EFFECT_QUALITY);
  for(const unitClass of [123,124]){
    const sibling=createEffectPresentationPolicy({...profile,target:{...profile.target,unitClass}},DEFAULT_EFFECT_QUALITY);
    assert.equal(sibling.denseCommandSets.size,0,'CA density must not leak to a sibling class');
  }
});

test('CA actual hit descendants inherit high/8 while projectile and singleton cues keep their source birth clocks',
  {skip:!hasAssets},()=>{
    const index=indexFor(),raw=profile.damageEffects[damage].raw;
    const hit=raw.HIT_PARTICLE0.PARTICLE_NAME,children=index.templates[hit].repeated.TraceParticleList;
    assert.equal(hit,'SDK_HIT_P00_1');
    assert.deepEqual(children,['SDK_HIT_P02','SDK_HIT_P03','SDK_DREAD_TRACE4','SDK_BR_BR_PE05_S']);
    const before=JSON.stringify({set:profile.effectSets[root],damage:profile.damageEffects[damage],templates:index.templates});
    const qualities=collectCommandTemplateQualities(profile,index,DEFAULT_EFFECT_QUALITY);
    // The 668ZX instance inherits high/8, but the shared template pool must
    // still cover the full-density 66ZX end/attack owners. This singleton has
    // divisor1 under either owner; lowering its global pool would be wrong.
    const shared='SDK_BR_BR_PE05_S',policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
    for(const setName of ['EffectSet_C_SCA_Dash_ZX_END','EffectSet_C_SCA_Dash_ZX_Attack']){
      assert.ok(policy.comboSets.has(setName));assert.deepEqual(policy.effect({setName}),FULL_EFFECT_QUALITY);
      const parent=profile.effectSets[setName].raw.EFFECT0.NAME;
      assert.equal(parent,'SDK_BRANDISH_BREAKER_PE00_S_1');assert.ok(index.templates[parent].repeated.TraceParticleList.includes(shared));
    }
    for(const name of [raw.MAIN_EFFECT_NAME,raw.PASSIVE_PARTICLE0.PARTICLE_NAME,hit,...children])
      assert.deepEqual(qualities.get(name),name===shared?FULL_EFFECT_QUALITY:dense,'shared-template prewarm '+name);
    const preserved=[raw.MAIN_EFFECT_NAME,hit,'SDK_HIT_P02','SDK_BR_BR_PE05_S'];
    const firstBirths=[];
    for(const quality of [FULL_EFFECT_QUALITY,dense]){
      let frame=0;const births=new Map(),seen=new Set();
      const runtime=createEffectRuntime({index,effectQuality:quality,onBirth:p=>{if(!births.has(p.name))births.set(p.name,frame);}});
      runtime.add(raw.MAIN_EFFECT_NAME,{effectQuality:quality});
      runtime.add(hit,{effectQuality:quality,triggerCount:raw.HIT_PARTICLE0.TRIGGER_COUNT});
      for(;frame<90;frame++){
        runtime.step(1/60,{});
        for(const emitter of runtime.emitters.values()){
          seen.add(emitter.name);assert.deepEqual(emitter.quality,quality,'inherited owner '+emitter.name);
        }
      }
      for(const name of [hit,...children])assert.ok(seen.has(name),'actual descendant '+name);
      for(const name of preserved)assert.ok(births.has(name),'structural cue '+name);
      firstBirths.push(preserved.map(name=>[name,births.get(name)]));runtime.clear();
    }
    assert.deepEqual(firstBirths[1],firstBirths[0]);
    for(const name of preserved){const t=index.templates[name],f=t.fields;
      assert.equal(particlePresentationBudget(t,f.NumParticles??0,f.TriggerCount??-1,dense).divisor,1,name);}
    for(const name of ['SDK_HIT_P03','SDK_DREAD_TRACE4']){
      const t=index.templates[name];
      assert.deepEqual(particlePresentationBudget(t,25,25,dense),{divisor:8,max:4,limit:4});
      assert.equal(particlePresentationBudget(t,25,25,FULL_EFFECT_QUALITY).divisor,1);
    }
    assert.equal(JSON.stringify({set:profile.effectSets[root],damage:profile.damageEffects[damage],templates:index.templates}),before,'no source mutation');
  });

test('CA two-target command prewarm sheds 1,078 decorative mesh slots without dropping either template',
  {skip:!hasAssets},()=>{
    const index=indexFor();
    const reduced=collectEffectMeshBudget(profile,index,[],{effectQuality:DEFAULT_EFFECT_QUALITY,targetCount:2});
    const full=collectEffectMeshBudget(profile,index,[],{effectQuality:FULL_EFFECT_QUALITY,targetCount:2});
    const expected=[['SDK_HIT_P03',19,836,176,2],['SDK_DREAD_TRACE4',23,506,88,1]];
    let saved=0;
    for(const [name,fullPeak,fullViews,reducedViews,drawCount]of expected){
      const a=full.demands.get(name),b=reduced.demands.get(name);
      assert.deepEqual(a,{views:fullViews,peakParticles:fullPeak,drawCount,effectSetInstances:22},name+' full');
      assert.deepEqual(b,{views:reducedViews,peakParticles:4,drawCount,effectSetInstances:22},name+' local density');
      assert.ok(reduced.templates.has(name));saved+=a.views-b.views;
    }
    assert.equal(saved,1078);
  });
