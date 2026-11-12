/** Actual shipped profile, native modules, scene and helper poses. These are
 * source equation/flow regressions; current hit counts are never client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeCommandsRecovery} from '../../packages/native-source/commands.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {collectEffectPoseFiles,mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {evaluateStateProtection} from '../../packages/combat-core/state-protection.mjs';
import {resolveDamageValues} from '../../packages/combat-core/damage-values.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
const path=f=>new URL('../../'+f,import.meta.url),read=f=>JSON.parse(readFileSync(path(f)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx'].map(f=>read('artifacts/rf/'+f+'/index.json')));
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const poses=Object.fromEntries(collectEffectPoseFiles(index,visual).map(f=>[f,read('artifacts/rf/'+f)]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:f=>readFileSync(path('artifacts/native/'+f))});
const commands=await createNativeCommandsRecovery({base:native.commands,bytes:readFileSync(path('artifacts/native/commands-recovery.wasm'))});
function make({facing=-1,gap=5,p=profile,passives,position=[2023,2840,0],lineId=6}={}){
  return createSimulation({profile:p,map,preset,seed:2016,
    actors:[{id:'rf',team:0,position,lineId,facing,...(passives?{passives}:{})},
      {id:'target',team:1,position:[position[0]+facing*gap,position[1],position[2]],lineId,facing:-facing}],
    ...createNativeSamplers({profile:p,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:native.geometry,nativeCommands:commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,versions:native.versions});
}
const step=(s,input={})=>s.step(1/60,input,{snapshot:false});
const advance=(s,count,input={})=>{for(let i=0;i<count;i++)step(s,input);};
function dash(s,facing){const key=facing===1?'RIGHT':'LEFT';step(s,{pressed:[key],held:[key]});step(s,{released:[key]});step(s,{pressed:[key],held:[key]});return key;}

test('actual profile has complete damage-main dependency closure; loading an incomplete profile fails explicitly',()=>{
  for(const [name,e] of Object.entries(profile.damageEffects))if(e.raw.MAIN_EFFECT_NAME)
    assert.ok(profile.effectTemplates[e.raw.MAIN_EFFECT_NAME],name);
  const p=structuredClone(profile);delete p.effectTemplates.RRF_DASHJUMP_X;
  assert.throws(()=>make({p}),/Incomplete effect dependency: RRF_DASH_JUMP_X -> RRF_DASHJUMP_X/);
  assert.equal(profile.effectTemplates.RRF_DASHJUMP_X.fields.LifeTime,.7);
});

for(const facing of [-1,1])for(const gap of [0,5,80,180])test(`real 668XX input ends after five seconds at facing${facing} gap${gap}`,()=>{
  const s=make({facing,gap}),key=dash(s,facing),a=s.actor('rf'),b=s.actor('target');
  step(s,{pressed:['UP'],held:[key,'UP']});step(s,{pressed:['X'],held:[key,'X']});
  advance(s,8,{held:[key]});step(s,{pressed:['X'],held:[key,'X']});
  advance(s,300);
  const events=s.drainEvents(),started=events.filter(e=>e.type==='effectStarted'&&e.name==='RRF_DASH_JUMP_X');
  assert.ok(started.length>0,'real Now callback must create its damage effect');
  for(const birth of started){
    const end=events.find(e=>e.type==='effectEnded'&&e.effectId===birth.effectId);assert.ok(end,'every first-X damage handle ends');
    assert.ok(end.time-birth.time<=.7+2/60+1e-8,'source LT_TIME .7 + old-time guard + one fixed-packet margin');
    assert.equal(events.filter(e=>e.type==='hit'&&e.origin?.id===birth.effectId&&e.time>end.time).length,0);
  }
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state==='RRF_DASH_JUMP_COMBO_XX'));
  assert.equal(s.state.effects.filter(e=>e.damage&&e.damage.MAIN_EFFECT_NAME==='RRF_DASHJUMP_X').length,0);
  assert.equal(a.hitStop,0);assert.equal(b.hitStop,0);assert.equal(a.state,'RSI_WAIT');assert.equal(b.state,'RSI_WAIT');
  const hp=b.hp;advance(s,60);assert.equal(b.hp,hp);assert.equal(s.drainEvents().filter(e=>e.type==='hit').length,0);
});

test('real 668ZXX inputs spawn FOUR target2016 child events, deal final-X damage, then retire',()=>{
  // Freeze no passives for the literal base2.13 expectation; product-passive
  // combinations are exercised separately by the full-load 668XX cases.
  const s=make({gap:80,passives:[]}),a=s.actor('rf'),key=dash(s,-1);
  step(s,{pressed:['UP'],held:[key,'UP']});step(s,{pressed:['Z'],held:[key,'Z']});
  for(let i=0;i<300&&a.state==='RSI_DASH_JUMP_COMBO_Z';i++)step(s,{pressed:i===3?['X']:[],held:[key]});
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX');
  for(let i=0;i<300&&a.state!=='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING';i++)step(s,{held:[key]});
  assert.equal(a.state,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING');step(s,{pressed:['X']});advance(s,300);
  const events=s.drainEvents(),calls=events.filter(e=>e.type==='originalRecoveredCommand');assert.equal(calls.length,1);
  const children=events.filter(e=>e.type==='damageChildCreated'&&e.parentEffectId===calls[0].effectId);
  assert.deepEqual(children.map(e=>e.eventTime),[.01,.11,.21,.31]);
  assert.ok(children.every(e=>e.name==='DamageEffect_RSI_OVER_TAKER_BIG_SPINE'));
  for(const child of children){
    const ideal=calls[0].position[0]-1000*child.eventTime;
    assert.ok(child.position[0]<=ideal+1e-6&&child.position[0]>=ideal-1000/60-1e-6);
  }
  assert.equal(events.filter(e=>e.type==='hit'&&e.origin?.id===calls[0].effectId).length,0,'RT_NO_DAMAGE parent never accepts a hit');
  const childIds=new Set(children.map(e=>e.effectId)),hits=events.filter(e=>e.type==='hit'&&childIds.has(e.origin?.id));
  assert.ok(hits.length>0,'actual child helper and target helper intersect');
  assert.ok(hits.every(e=>e.data.DAMAGE.MAGIC===2.13));
  assert.equal(s.state.effects.filter(e=>e.damage).length,0);
});

test('a no-damage parent overlapping a defender keeps all four source events and never adds hit-stop/MP/HP damage',()=>{
  const s=make({gap:0}),a=s.actor('rf'),b=s.actor('target'),hp=b.hp,mp=a.mp;
  const parent=s.createEffect(a,{NAME:'DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX'},
    {birthAnchor:{position:[a.x,a.y,a.z],facing:1}});
  // Keep only the parent's original dummy collision for this routing test:
  // the real child collision is covered above, and must not hide parent damage.
  const sample=s.effectSampler;s.effectSampler=(e,owner,options)=>e.id===parent.id?sample(e,owner,options):[];
  advance(s,30);const events=s.drainEvents();
  assert.equal(parent.hitCount,0);assert.deepEqual(parent.hits,{});assert.equal(b.hp,hp);assert.equal(a.mp,mp);
  assert.equal(a.hitStop,0);assert.equal(b.hitStop,0);
  assert.deepEqual(events.filter(e=>e.type==='damageChildCreated').map(e=>e.eventTime),[.01,.11,.21,.31]);
});

test('real 66ZX inputs execute target rushing state, armored window and a 3.85 physical airborne impact',()=>{
  const s=make({gap:500}),key=dash(s,-1),a=s.actor('rf');
  step(s,{pressed:['Z'],held:[key,'Z']});advance(s,3,{held:[key]});step(s,{pressed:['X'],held:[key,'X']});
  let armorSeen=false;
  for(let i=0;i<300;i++){step(s);if(a.state==='RSI_OVER_TAKER_DASH_COMBO_ZX'&&a.animationTime>=.325&&a.animationTime<1.1){assert.equal(a.superArmor,true);armorSeen=true;}}
  const events=s.drainEvents();assert.ok(events.some(e=>e.type==='stateChanged'&&e.state==='RSI_OVER_TAKER_DASH_COMBO_ZX'));
  assert.ok(armorSeen);assert.ok(events.some(e=>e.type==='velocityEvent'&&e.values?.['1']===900));
  const hit=events.find(e=>e.type==='hit'&&e.data.DAMAGE.PHYSIC===3.85);assert.ok(hit);
  assert.equal(hit.data.REACT_TYPE,5);assert.equal(hit.data.BACK_SPEED_X,2075);assert.equal(hit.data.BACK_SPEED_Y,1700);
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.actorId==='target'&&/RSI_DAMAGE_AIR_FLY/.test(e.state)));
  const raw=profile.states.RSI_OVER_TAKER_DASH_COMBO_ZX.raw;
  assert.equal(evaluateStateProtection(raw,.324).superArmor,false);
  assert.equal(evaluateStateProtection(raw,.325).superArmor,true);
  assert.equal(evaluateStateProtection(raw,1.1).superArmor,true,'source timed armor includes the end');
  assert.equal(evaluateStateProtection(raw,1.101).superArmor,false);
});

test('known target nil hit-type resolves through explicit reference-loader default; unrelated unknowns remain rejected',()=>{
  const raw=profile.damageEffects.Damage_Effect_Raven_ROT_Dash_ZX.raw.DAMAGE_DATA;
  assert.equal(raw.HIT_TYPE.$symbol,'HIT_TYPE.HT_METEL_PUNCH_HIT');
  const resolved=resolveDamageValues(raw,profile.physics);assert.equal(resolved.supported,true);assert.equal(resolved.data.HIT_TYPE,0);
  assert.equal(resolveDamageValues({...raw,HIT_TYPE:{$symbol:'HIT_TYPE.DO_NOT_GUESS',$unsupported:'target enum member absent'}},profile.physics).supported,false);
});

test('real XX6XXX input follows corrected target clips and original timed/state armor survives a struck punch',()=>{
  const s=make({position:[-1100,3080,0],lineId:2,facing:1,gap:2400}),a=s.actor('rf'),held=['RIGHT'];
  const waitUntil=(fn,label)=>{for(let i=0;i<180&&!fn();i++)step(s,{held});assert.ok(fn(),label);};
  step(s,{pressed:['X'],held});advance(s,10,{held});step(s,{pressed:['X'],held});
  waitUntil(()=>a.state==='RSI_COMBO_XX','second X');advance(s,10,{held});step(s,{pressed:['X'],held});
  waitUntil(()=>a.state==='RSI_OVER_TAKER_COMBO_XXfrontX','forward third X');
  assert.equal(a.animationName,'OT_ComboX3Down_New');assert.equal(a.superArmor,false,'timed armor starts at .1, not entry');
  waitUntil(()=>a.animationTime>=.2,'third-X input window');assert.equal(a.superArmor,true);
  step(s,{pressed:['X'],held});waitUntil(()=>a.state==='RSI_OVER_TAKER_COMBO_XXfrontXX','fourth X');
  assert.equal(a.animationName,'OT_ComboX4Down_New');assert.equal(a.superArmor,true);
  waitUntil(()=>a.animationTime>=.2,'fourth-X input window');step(s,{pressed:['X'],held});
  waitUntil(()=>a.state==='RSI_OVER_TAKER_COMBO_XXfrontXX2','fifth X');
  assert.equal(a.animationName,'OT_ComboX5Down_New');assert.equal(a.superArmor,true);
  const state=a.state,serial=a.stateSerial,hp=a.hp;
  const hit=s.injectHit({attackerId:'target',targetId:'rf',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:3,BACK_SPEED_X:500,BACK_SPEED_Y:1000,STOP_TIME_DEF:.1}});
  assert.equal(hit.accepted,true);assert.ok(a.hp<hp);assert.equal(a.state,state);assert.equal(a.stateSerial,serial);assert.equal(a.hitStop,0);
});
