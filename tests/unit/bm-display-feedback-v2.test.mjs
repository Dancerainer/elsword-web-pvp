import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {BM_SOURCE_CLOCK_CUES,DEFAULT_EFFECT_QUALITY,particlePresentationBudget} from '../../packages/effect-runtime/presentation-quality.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profile=read('packages/combat-core/bm-profile.json'),index=read('contracts/bm-fx-index.json');
const rawPose=read('artifacts/bm/runtime-pose.json');
const characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?read('artifacts/bm/'+rawPose.sharedPose):null);

test('Bloody Accel and HA original weapon fields attach to actual mounted TRACE frames in both facings',()=>{
  const notes=[],samplers=createNativeSamplers({profile,characterPose,effectIndex:{templates:{}},effectPoses:{},onUnsupported:n=>notes.push(n)});
  const buff=profile.effectSets.EffectSet_Bloody_Weapon.raw.EFFECT0;
  const finish=profile.effectSets.EffectSet_SA_RBM_Extrem_Blade_Finish.raw.EFFECT7;
  assert.equal(buff.WEAPON_BONE_NAME,'TRACE_END0');assert.equal(finish.WEAPON_BONE_NAME,'TRACE_START0');
  assert.equal(characterPose.frames.find(f=>f.name==='TRACE_END0').parent,characterPose.frames.find(f=>f.name==='TRACE_START0').parent);
  for(const facing of [-1,1])for(const animationTime of [.1,.4,.9]){
    const actor={id:'bm',x:120,y:3080,z:17,facing,animationName:profile.states.RSI_A_RST_BLOODY_ACCEL.animationName,animationTime,animationLoop:false};
    for(const definition of [buff,finish]){
      const actual=samplers.effectAnchorSampler({definition},actor);
      const originalFrame=samplers.effectAnchorSampler({definition:{BONE_NAME:definition.WEAPON_BONE_NAME}},actor);
      assert.deepEqual(actual.position,originalFrame.position);
      assert.ok(Math.hypot(...actual.position.map((n,i)=>n-[actor.x,actor.y,actor.z][i]))>30,'weapon must not fall back to the feet');
      const matrix=samplers.effectAnchorSampler({definition:{...definition,TRACE_MATRIX:1}},actor).matrix;
      assert.deepEqual(matrix.slice(12,15),originalFrame.position,'full weapon combine matrix includes its mounted translation');
    }
  }
  assert.deepEqual(notes,[]);
});

test('attachment precedence and unsupported weapon slots cannot silently use the major sword or feet',()=>{
  const notes=[],s=createNativeSamplers({profile,characterPose,effectIndex:{templates:{}},effectPoses:{},onUnsupported:n=>notes.push(n)});
  const actor={id:'bm',x:100,y:3080,z:0,facing:1,animationName:profile.states.RSI_WAIT.animationName,animationTime:.2,animationLoop:true};
  const head=s.effectAnchorSampler({definition:{BONE_NAME:'Bip01_Head'}},actor);
  assert.deepEqual(s.effectAnchorSampler({definition:{BONE_NAME:'Bip01_Head',WEAPON_BONE_NAME:'TRACE_END0',WEAPON_BONE_WEAPON_INDEX:2}},actor).position,head.position);
  for(const definition of [{WEAPON_BONE_NAME:'absent-original-frame'},{WEAPON_BONE_NAME:'TRACE_END0',WEAPON_BONE_WEAPON_INDEX:1},{WEAPON_BONE_NAME:'TRACE_END0',WEAPON_BONE_MODEL_INDEX:1}])
    assert.equal(s.effectAnchorSampler({definition},actor),null);
  assert.equal(notes.length,3);
});

function births(name,quality,seconds){
  let now=0;const born=[];
  const runtime=createEffectRuntime({index,effectQuality:quality,onBirth:p=>{if(p.name===name)born.push(now);}});
  runtime.add(name);
  for(let i=0;i<Math.round(seconds*60);i++){now=(i+1)/60;runtime.step(1/60,{});}
  return born;
}
test('medium preserves the three source shockwave mesh layers inside their actual .6-second owner lifetime',()=>{
  assert.equal(index.templates.RST_ShockWave_ProDummy.fields.LifeTime,.6);
  for(const [name,rate]of [['RST_ShockWave_Pro01',15],['RST_ShockWave_Pro01D',10],['RST_ShockWave_Pro02',20]]){
    assert.equal(index.templates[name].fields.Emitrate,rate);
    const source=births(name,{level:'high',particleDivisor:1},.6),medium=births(name,DEFAULT_EFFECT_QUALITY,.6);
    assert.deepEqual(medium,source,name+' must keep every structural birth time');
    assert.ok(medium.length>=5,name);assert.ok(medium[0]<=1/rate+1/60+.000001,name);
  }
});
test('HA short glow, initial burst and hand ring are born before their source windows close',()=>{
  for(const [name,window]of [['SA_RBM_Extrem_Blade_Dubble_Glow_P01',.5],['EffectSet_RBM_HYPER_STEP_EXPLO_P08',.2],['Ring_Raven_ShockWave01',.6]]){
    const source=births(name,{level:'high',particleDivisor:1},window),medium=births(name,DEFAULT_EFFECT_QUALITY,window);
    assert.deepEqual(medium,source,name);assert.ok(medium.length>=2,name);
  }
  assert.equal(BM_SOURCE_CLOCK_CUES.size,8,'bounded source-cue policy, including both persistent black-hole planes');
  for(const name of ['RST_ShockWave_Pro03','Raven_PowerAssault02','SA_RBM_Extrem_Blade_Sasun_P01']){
    const t=index.templates[name];assert.equal(particlePresentationBudget(t,t.fields.NumParticles,t.fields.TriggerCount??-1,DEFAULT_EFFECT_QUALITY).divisor,8,name+' remains density limited');
  }
});
