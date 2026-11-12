import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Literal target declarations + compiled fixed-V5 off-foot callback, not a
 * target-client measurement. The real Garpai map remains unmodified. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx'].map(f=>read('artifacts/rf/'+f+'/index.json'))));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(f=>[f,read('artifacts/rf/'+f)]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:file=>readFileSync(resolve(fixtureRoot,'artifacts/native',file))});
const assets={profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses};
const LAND='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING',FALL='RSI_JUMP_DOWN';
const DAMAGE='DamageEffect_ROT_DASH_JUMP_COMBO_ZX_Ground';
const step=(s,input={},dt=1/60)=>s.step(dt,input,{snapshot:false});
function make({position=[0,3800,0],lineId=4,facing=1,target=[2500,2600,0],targetLineId=7,nativeCommands=native.commands}={}){
  return createSimulation({profile,map,preset,seed:2016,
    actors:[{id:'rf',team:0,position,lineId,facing,passives:[]},{id:'target',team:1,position:target,lineId:targetLineId,facing:-facing,passives:[]}],
    ...createNativeSamplers(assets),nativeGeometry:native.geometry,nativeCommands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,versions:native.versions});
}

test('target landing has an independent ground damage effect; it never carries the preceding character attack table',()=>{
  const r=profile.states[LAND].raw,d=profile.damageEffects[DAMAGE].raw;
  assert.equal(r.DAMAGE_DATA,undefined);assert.equal(r.ATTACK_TIME0,undefined);
  assert.deepEqual(r.EVENT_PROCESS_TIME0,{'1':0,'2':.45,'3':.25});
  assert.deepEqual(r.EFFECT_SET_LIST,{'1':'EffectSet_ROT_DASH_JUMP_COMBO_ZX_Ground','2':.01});
  assert.equal(r.DELETE_EFFECT_SET_ON_STATE_END,undefined);
  assert.equal(d.USE_GLOBAL_TIME,1);assert.equal(d.ATTACK_TIME_START,.01);assert.equal(d.ATTACK_TIME_END,.1);
  assert.equal(d.DAMAGE_DATA.DAMAGE.MAGIC,4.31);
  assert.equal(profile.effectTemplates[d.MAIN_EFFECT_NAME].fields.LifeTime,.05);
});

for(const facing of [-1,1])test(`compiled original landing off-foot branch has no animation/input threshold (${facing})`,()=>{
  const s=make({facing}),a=s.actor('rf');s.enter(a,LAND,'source-fixture');
  a.grounded=false;a.lineId=null;a.y=3800;a.animationTime=0;
  const out=native.commands.probeLandingEvent(a,{pressed:['X'],held:['RIGHT','UP']},profile);
  assert.equal(out.handled,true);assert.equal(out.state,FALL);assert.equal(out.y,3755);
  assert.equal(out.boundaryCalls.down,0,'off-foot does not query manual CanDown');
});

for(const facing of [-1,1])test(`real map landing root movement leaves ${facing<0?'left':'right'} edge before the animation ends`,()=>{
  // Probe the real root sampler immediately before the authored open edge.
  const s=make({facing,position:[facing*(800-.001),3800,0]}),a=s.actor('rf');
  s.enter(a,LAND,'source-fixture');
  const integrate=s.integrate.bind(s);let physics;
  s.integrate=(...args)=>{integrate(...args);if(args[0]===a)physics={y:a.y,grounded:a.grounded,animationTime:a.animationTime};};
  let left=false;
  for(let i=0;i<30&&!left;i++){
    const before=a.state;step(s);
    if(before===LAND&&a.state!==LAND){
      assert.equal(a.state,FALL);assert.equal(a.grounded,false);left=true;
      assert.equal(physics.grounded,false);
      assert.ok(physics.animationTime<.15,'off-foot is earlier than even the target movement cancel time');
      assert.equal(a.y,Math.fround(Math.fround(physics.y)-45),'offset follows physics exactly once, with original binary32 arithmetic');
      assert.equal(s.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state===FALL).at(-1).reason,'original-zx-landing-off-line');
    }
  }
  assert.equal(left,true);
});

for(const facing of [-1,1])test(`already born landing blast survives ${facing<0?'left':'right'} edge fall and JSON replay`,()=>{
  const s=make({facing,position:[facing*788,3800,0],target:[facing*700,3800,0],targetLineId:4}),a=s.actor('rf');
  s.enter(a,LAND,'source-fixture');
  step(s,{},.005);step(s,{},.005);
  const e=s.state.effects.find(e=>e.name===DAMAGE);assert.ok(e?.active);
  const anchor=structuredClone(e.birthAnchor),saved=JSON.parse(JSON.stringify(s.snapshot())),copy=make({facing});copy.restore(saved);
  const start=s.state.events.length;
  step(s,{},.005);step(copy,{},.005);
  assert.equal(a.state,FALL);assert.equal(a.grounded,false);
  const hit=s.state.events.slice(start).find(v=>v.type==='hit'&&v.origin?.id===e.id);
  assert.ok(hit,'real converted ground helpers still apply the original4.31 damage after the state changes');
  assert.equal(hit.data.DAMAGE.MAGIC,4.31);assert.deepEqual(e.birthAnchor,anchor);
  for(let i=0;i<120;i++){step(s);step(copy);}
  assert.deepEqual(JSON.parse(JSON.stringify(copy.snapshot())),JSON.parse(JSON.stringify(s.snapshot())));
  const end=s.state.events.find(v=>v.type==='effectEnded'&&v.effectId===e.id);
  assert.equal(end.reason,'template-life-time');
  assert.ok(!s.state.effects.some(v=>v.id===e.id));
});

for(const facing of [-1,1])test(`real authored ${facing<0?'left':'right'} wall is retained by physics rather than treated as an open edge`,()=>{
  const position=facing<0?[-2199.999,2840,0]:[2199.999,2840,0],lineId=facing<0?0:6;
  const s=make({facing,position,lineId}),a=s.actor('rf');s.enter(a,LAND,'source-fixture');
  step(s);assert.equal(a.state,LAND);assert.equal(a.grounded,true);assert.equal(a.y,2840);
});

test('grounded target2016 X buffer still uses .25 rather than the older hardcoded .1 window',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,LAND,'source-fixture');
  a.animationTime=.12;step(s,{pressed:['X']},.005);assert.equal(a.state,LAND);
  a.animationTime=.249;step(s,{},.005);assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX');
});

for(const facing of [-1,1])test(`real 668ZX keyboard input lands on the upper map platform then leaves its ${facing<0?'left':'right'} edge`,()=>{
  const s=make({facing,position:[facing*400,3800,0]}),a=s.actor('rf'),key=facing===1?'RIGHT':'LEFT';
  step(s,{pressed:[key],held:[key]});step(s,{released:[key]});step(s,{pressed:[key],held:[key]});
  assert.equal(a.state,'RSI_DASH');
  step(s,{pressed:['UP'],held:[key,'UP']});step(s,{pressed:['Z'],held:[key,'Z']});
  for(let i=0;i<300&&a.state==='RSI_DASH_JUMP_COMBO_Z';i++)step(s,{pressed:i===3?['X']:[],held:[key]});
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
  for(let i=0;i<300&&a.state!==LAND;i++)step(s,{held:[key]});
  assert.equal(a.state,LAND);assert.equal(a.lineId,4);
  let lastTime=0;
  for(let i=0;i<30&&a.state===LAND;i++){lastTime=a.animationTime;step(s);}
  assert.equal(a.state,FALL);assert.ok(lastTime<.15,'real input leaves before target movement cancel or animation end');
  assert.equal(s.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='rf').at(-1).reason,'original-zx-landing-off-line');
});

test('off-foot landing branch precedes buffered X even under an input lock; JS source fallback also drops',()=>{
  for(const commands of [native.commands,null]){
    const s=make({position:[799.999,3800,0],nativeCommands:commands}),a=s.actor('rf');s.enter(a,LAND,'source-fixture');
    a.inputLock=.1;a.buffered='X';step(s,{pressed:['X'],held:['X']});
    assert.equal(a.state,FALL);assert.equal(a.grounded,false);assert.ok(a.y<3755);
  }
});
