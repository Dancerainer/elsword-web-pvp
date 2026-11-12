import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isFiniteVisualBirth} from '../../packages/combat-core/finite-visual-birth.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/vc-profile.json',import.meta.url)));
const particle=(fields={})=>({kind:'particle',fields:{Emitrate:20,Lifetime:.3,NumParticles:20,TriggerCount:3,...fields},events:[],repeated:{},unsupported:[]});
function fixture(template=particle(),children={}){return {target:{unitClass:115},damageEffects:{},effectTemplates:{pulse:template,...children},effectSets:{pulseSet:{raw:{EFFECT0:{NAME:'pulse'}}}}};}
const birth={name:'pulse',setName:'pulseSet',definitionMember:'EFFECT0'};
test('finite VC admission requires canonical membership and excludes live-controller/damage effects',()=>{
  const p=fixture();assert.equal(isFiniteVisualBirth(p,birth),true);
  for(const patch of [{setName:'missing'},{definitionMember:'EFFECT1'},{name:'missing'},{buffTemplateId:250},{sourceArcStartMesh:true},{sourceSetTargetMesh:true},{sourceSkillMeshControl:{}},{sourceVeteranTargetId:1}])assert.equal(isFiniteVisualBirth(p,{...birth,...patch}),false);
  p.damageEffects.pulse={raw:{}};assert.equal(isFiniteVisualBirth(p,birth),false);
  assert.equal(isFiniteVisualBirth({...fixture(),target:{unitClass:101}},birth),false);
});
test('missing, malformed, unbounded and long-running source declarations are not guessed finite',()=>{
  for(const fields of [{TriggerCount:-1},{Lifetime:0},{Lifetime:NaN},{Emitrate:0},{Emitrate:1e100},{Emitrate:{random:[0,10]}},{Lifetime:{random:[NaN,1]}},{NumParticles:0},{TriggerCount:undefined},{TriggerCount:-1,TriggerTime:999999}])
    assert.equal(isFiniteVisualBirth(fixture(particle(fields)),birth),false,JSON.stringify(fields));
  assert.equal(isFiniteVisualBirth(fixture({...particle(),unsupported:['unknown']}),birth),false);
  const missing=fixture();delete missing.effectTemplates.pulse;assert.equal(isFiniteVisualBirth(missing,birth),false);
  assert.equal(isFiniteVisualBirth(fixture(particle({Emitrate:{random:[40,20]}})),birth),true,'native reversed random interval has a positive first bound');
});
test('trace AutoDie tails may have unlimited emission; final children must terminate independently',()=>{
  const continuous=particle({TriggerCount:-1});
  assert.equal(isFiniteVisualBirth(fixture({...particle(),repeated:{TraceParticleList:['child']}},{child:continuous}),birth),true);
  assert.equal(isFiniteVisualBirth(fixture({...particle(),repeated:{FinalParticleList:['child']}},{child:continuous}),birth),false);
  assert.equal(isFiniteVisualBirth(fixture({...particle(),repeated:{TraceParticleList:['pulse']}}),birth),false);
  assert.equal(isFiniteVisualBirth(fixture({...particle(),repeated:{FinalParticleList:['missing']}}),birth),false);
});
test('mesh admission requires literal positive playback count and confirmed progressing original clip',()=>{
  const mesh={kind:'mesh',fields:{LifeType:'LT_PLAY_COUNT',MeshType:'X_SKIN_MESH',PlayCount:1},events:[{property:'AniName',start:0,end:0,fade:false,value:{animation:'Normal',playback:'XAP_ONE'}}],animationClips:[{name:'Normal',durationSeconds:1}],unsupported:[]};
  assert.equal(isFiniteVisualBirth(fixture(mesh),birth),true);
  for(const count of [undefined,0,-1,999999])assert.equal(isFiniteVisualBirth(fixture({...mesh,fields:{...mesh.fields,PlayCount:count}}),birth),false);
  for(const patch of [{animationClips:[]},{animationRequiresUnconfirmedRate:true},{events:[...mesh.events,{property:'AniSpeed',start:.2,end:.2,value:0}]}])assert.equal(isFiniteVisualBirth(fixture({...mesh,...patch}),birth),false);
});
test('original Ground Impact source fields prove finite three-layer births and all admitted VC templates actually retire',()=>{
  const setName='EffectSet_RAVEN_GROUND_IMPACT';
  for(const [name,count,rate] of [['UpLight_Raven_RRF_Ground_Impact01',3,20],['Ground_ShockWave_Raven_RRF_Ground_Impact01',2,15],['UpLight_Raven_RRF_Ground_Impact02',3,20]]){
    const t=profile.effectTemplates[name];assert.equal(t.fields.Lifetime,.3);assert.equal(t.fields.TriggerCount,count);assert.equal(t.fields.Emitrate,rate);
    assert.equal(isFiniteVisualBirth(profile,{name,setName}),true);
  }
  const admitted=new Set();for(const [setName,set]of Object.entries(profile.effectSets))for(const [definitionMember,def]of Object.entries(set.raw))
    if(/^EFFECT\d+$/.test(definitionMember)&&isFiniteVisualBirth(profile,{name:def.NAME,setName,definitionMember}))admitted.add(def.NAME);
  assert.ok(admitted.has('EffectSet_RVC_Flame_Buster_M02'));assert.ok(!admitted.has('raven_powrUp_01'));assert.ok(!admitted.has('RWT_BARRAGE_ATTACK_TRACE_Stand'));
  for(const name of admitted){
    const runtime=createEffectRuntime({index:{templates:profile.effectTemplates}});assert.ok(runtime.add(name,{position:[0,0,0]}),name+' creates');
    for(let frame=0;frame<1801&&runtime.emitters.size;frame++)runtime.step(1/60,{});
    assert.equal(runtime.emitters.size,0,name+' source emitter and descendants retire');assert.equal(runtime.particles.size,0,name+' source particles retire');
  }
});
