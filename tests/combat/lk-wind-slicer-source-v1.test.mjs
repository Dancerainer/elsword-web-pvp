import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

// Literal expectations come from target2016 declarations and fixed-V5 consumers,
// not a captured output of this executor. See reports/lk-wind-slicer-audit-v1.md.
const root=fileURLToPath(new URL('../../',import.meta.url));
const base=process.env.LK_NATIVE_FIXTURE_ROOT??root;
const assets=process.env.LK_ASSET_FIXTURE_ROOT??resolve(root,'artifacts/lk');
const read=p=>JSON.parse(readFileSync(p));
const profile=read(resolve(root,'packages/combat-core/lk-profile.json'));
const preset=read(resolve(root,'config/lk-preset.json'));
const map={...read(resolve(base,'artifacts/scene/sander-garpai-rock-pvp/manifest.json')),
  ...read(resolve(base,'artifacts/scene/sander-garpai-rock-pvp/collision.json'))};
const index=mergeEffectIndexes(read(resolve(assets,'effect-assets.json')),read(resolve(assets,'fx/index.json')));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
  .map(p=>[p,read(resolve(assets,p))]));
const characterPose=read(resolve(assets,'runtime-pose.json'));
const native=await createNativeRuntime({manifest:read(resolve(base,'artifacts/native/manifest.json')),map,
  loadBinary:file=>readFileSync(resolve(base,'artifacts/native',file))});
const SET='EffectSet_SI_P_ELK_WIND_SLICER',CARRIER='ELK_Wild_Slicer_Projetile';
const DAMAGE='DamageEffect_ELK_Wind_Slicer_Projectile';
const near=(actual,expected,label,tolerance=1e-3)=>assert.ok(Math.abs(actual-expected)<tolerance,
  `${label}: expected ${expected}, actual ${actual}`);
const at=e=>e.currentAnchor??e.birthAnchor;
function make(facing=1,extra={}){
  return createSimulation({profile,map,preset:{...preset,guildPassives:[],bannedSkillIds:[900],loadout:Array(8).fill(null)},
    seed:2016,actors:[{id:'lk',professionId:'LK',team:0,position:[2022.98,2840,0],lineId:6,facing,
      guildPassives:[],passives:[]}],
    ...createNativeSamplers({profile,characterPose,effectIndex:index,effectPoses:poses}),
    nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeManaBreak:native.manaBreak,...extra});
}
function spawn(sim){
  const first=sim.state.nextEffectId;
  sim.spawnSet(sim.actor('lk'),SET);
  const effects=sim.state.effects.filter(e=>e.id>=first);
  for(const e of effects)e.skillId=21402;
  assert.equal(effects.length,5);
  return {effects,carrier:effects.find(e=>e.name===CARRIER),damage:effects.find(e=>e.name===DAMAGE)};
}
function step(sim,count,dt=.01){for(let i=0;i<count;i++)sim.step(dt,{}, {snapshot:false});}

test('Wind Slicer target2016 declares a Bip01 carrier and four traced children with separate clocks',()=>{
  const set=profile.effectSets[SET].raw,carrier=profile.effectTemplates[CARRIER];
  assert.deepEqual(set.EFFECT2,{BONE_NAME:'Bip01',NAME:CARRIER,EFFECT_TYPE:4,
    BONE_TRACE_TARGET_MESH:1,TRACE_USER_TARGET_FORCE:1});
  for(const n of [0,1,3,4])assert.equal(set[`EFFECT${n}`].TRACE_MORE,1);
  assert.equal(carrier.source.sha256,'b3927c83e113e3b931f29ca5058063a63440a85d2c211bf335cb1fd4054757d5');
  assert.equal(carrier.declarationSha256,'e0f2638527dd86c90dff18e0b39ef7899e92b812519ffb8c93089629e2a5195c');
  assert.equal(carrier.source.line,77021);
  assert.deepEqual(carrier.initialVelocity,[1500,0,0]);assert.equal(carrier.initialDirSpeed,1000);
  assert.equal(carrier.fields.LifeTime,.55);assert.equal(carrier.fields.DrawCount,0);
  const damage=profile.damageEffects[DAMAGE].raw;
  assert.equal(damage.MAIN_EFFECT_NAME,'Mesh_Elesis_SBH_Command_Flame_Attackbox');
  assert.equal(damage.ATTACK_TIME_END,.3);assert.equal(damage.USE_GLOBAL_TIME,1);
  assert.equal(damage.DAMAGE_TIME,100);assert.equal(damage.DAMAGE_DATA.DAMAGE.PHYSIC,2.13);
  assert.equal(damage.DAMAGE_DATA.PVP_RATE,.54);
  assert.deepEqual(profile.effectTemplates[damage.MAIN_EFFECT_NAME].initialVelocity,[750,0,0]);
  assert.equal(profile.effectTemplates[damage.MAIN_EFFECT_NAME].fields.LifeTime,.65);
  for(const name of ['ELK_WIND_SLICER_M01','ELK_WIND_SLICER_M02','ELK_WIND_SLICER_M03']){
    const p=profile.effectTemplates[name];assert.equal(p.fields.TriggerTime,.4);assert.equal(p.fields.Lifetime,.55);
    assert.equal(p.source.sha256,'1980b71606233f87c29c2a32a9c4d52f758952059b819b29a421b00a4521324b');
  }
  assert.deepEqual(profile.states.RSI_COMBO_Z.raw.CREATE_EFFECT_SET,{'1':SET,'2':.1,'3':0});
  assert.deepEqual(profile.skillCatalog.find(s=>s.skillId===21402).raw.SA_EFFECTIVE_RATE,{'1':.07,'2':.14,'3':.21});
});

for(const facing of [-1,1])test(`Wind Slicer facing ${facing}: 2500/s from birth bone, unaffected by owner translation and turn`,()=>{
  const sim=make(facing),a=sim.actor('lk'),group=spawn(sim);
  step(sim,1);
  const carrier=group.carrier;
  const bone=sim.effectAnchorSampler(carrier,a).position;
  assert.equal(carrier.sourceSetTargetMesh,true);
  assert.equal(group.effects.every(e=>e.sourceEffectSetId===carrier.id),true);
  assert.deepEqual(carrier.birthAnchor.position,bone,'carrier starts at the original Bip01, not a hard-coded hand/ground offset');
  // KTDGXMeshPlayer.cpp:369 initializes a newly created mesh with .0001f.
  // The current unit callback cannot retroactively spend this frame's mesh dt.
  near(at(carrier).position[0]-bone[0],.25*facing,'birth initialization combines Velocity and DirSpeed');
  const before=[...at(carrier).position];
  a.x+=600;a.y+=400;a.facing=-facing;
  sim.enter(a,'RSI_WAIT','audit-owner-left-command');
  step(sim,10);
  near(at(carrier).position[0]-before[0],250*facing,'owner movement does not change world displacement');
  near(at(carrier).position[1],before[1],'owner vertical movement does not pull the projectile');
  assert.equal(at(carrier).facing,facing,'birth direction survives owner turn');
  assert.ok(sim.state.effects.includes(carrier),'leaving the original action does not remove this set');
  for(const child of group.effects.filter(e=>e!==carrier)){
    assert.equal(child.sourceTargetMeshId,carrier.id);
    assert.equal(at(child).facing,facing);
    near(at(child).position[0],at(carrier).position[0],`${child.name} pending anchor tracks the carrier`);
  }
  near(at(group.damage).position[0]-group.damage.sourcePosedAnchor.position[0],17.5*facing,
    'cached damage pose adds its own 750/s before SetPos replaces pending position with the 2500/s carrier');
});

test('Wind Slicer two overlapping triggers keep independent carrier identities and opposite world directions',()=>{
  const sim=make(1),a=sim.actor('lk'),first=spawn(sim);step(sim,10);
  const previous=at(first.carrier).position[0];a.facing=-1;
  const second=spawn(sim);step(sim,1);
  assert.notEqual(first.carrier.id,second.carrier.id);
  near(at(first.carrier).position[0]-previous,25,'older projectile retains its original direction');
  near(at(second.carrier).position[0]-second.carrier.birthAnchor.position[0],-.25,'new projectile uses new facing and source initialization time');
  for(const group of [first,second])for(const child of group.effects.filter(e=>e!==group.carrier))
    assert.equal(child.sourceTargetMeshId,group.carrier.id,'same effect-set name must not bind distinct activations');
  step(sim,8);
  for(const group of [first,second])for(const child of group.effects.filter(e=>e!==group.carrier))
    near(at(child).position[0],at(group.carrier).position[0],`${child.name} follows only its own carrier`);
});

test('Wind Slicer attack closes at .3 seconds, carrier lives .55, and no survivor returns to the owner',()=>{
  const observed=[];
  const sim=make(1,{effectSampler:(e)=>{if(e.name===DAMAGE)observed.push({time:e.elapsed,x:e.sourcePosedAnchor?.position[0]});return [];}});
  const a=sim.actor('lk'),group=spawn(sim);step(sim,1);
  const birth=group.carrier.birthAnchor.position[0];step(sim,29);
  assert.ok(observed.length>=28,'the real damage callback stays enabled through the original attack interval');
  assert.ok(observed.every(s=>s.time<.3),'ATTACK_TIME_END closes damage independently from carrier lifetime');
  assert.ok(observed.every(s=>s.x>=birth-1e-5&&s.x<birth+750),'active center remains inside 2500 × .3 source travel');
  assert.ok(observed.at(-1).x>birth+650,'the hit helper does not remain at the owner or move at its own 750/s');
  const count=observed.length;step(sim,25);
  assert.equal(observed.length,count);
  near(at(group.carrier).position[0]-birth,1350.25,'54 complete mesh frames plus source .0001 initialization');
  step(sim,1);
  near(at(group.carrier).position[0]-birth,1375.25,'55 complete mesh frames plus source .0001 initialization');
  step(sim,2);
  assert.equal(sim.state.effects.includes(group.carrier),false,'original LT_TIME carrier is reclaimed');
  const pending=[...at(group.damage).position];a.x-=900;a.y+=300;a.facing=-1;
  step(sim,2);
  near(at(group.damage).position[1],pending[1],'V5 missing target handle stops SetPos; owner height cannot pull the helper');
  near(at(group.damage).position[0]-pending[0],15,'untraced damage helper keeps its own 750/s for two .01 frames');
  assert.equal(observed.length,count);
});

test('Wind Slicer does not acquire an undeclared death or state-end deletion condition',()=>{
  const sim=make(1),group=spawn(sim);step(sim,1);
  const origin=at(group.carrier).position[0],a=sim.actor('lk');a.hp=0;
  sim.enter(a,'RSI_WAIT','audit-owner-death');step(sim,10);
  assert.ok(sim.state.effects.includes(group.carrier));
  near(at(group.carrier).position[0]-origin,250,'world projectile outlives owner motion while its own timer remains');
  assert.deepEqual(group.carrier.deleteConditions,[]);
});

test('Wind Slicer owner snapshots remap all carrier links and keep the same trajectory after restoration',()=>{
  const sender=make(-1),group=spawn(sender);step(sender,10);
  const packet=encodeOwnedState(sender,'lk',{epoch:7,frameSeq:10});
  validateOwnedReferences(packet,sender.actor('lk'),profile,map);
  const receiver=make(-1);receiver.state.nextEffectId=500;
  applyOwnedState(receiver,'lk',packet);
  const received=receiver.state.effects.filter(e=>e.setName===SET),carrier=received.find(e=>e.name===CARRIER);
  assert.ok(carrier);assert.notEqual(carrier.id,group.carrier.id);
  assert.equal(carrier.networkId,group.carrier.id);
  assert.deepEqual(carrier.initialVelocity,[1500,0,0]);assert.equal(carrier.initialDirSpeed,1000);
  for(const e of received){
    assert.equal(e.sourceEffectSetId,carrier.id);
    if(e!==carrier)assert.equal(e.sourceTargetMeshId,carrier.id);
  }
  const original=[...at(carrier).position];receiver.actor('lk').x+=1200;receiver.actor('lk').facing=1;
  step(receiver,10);
  near(at(carrier).position[0]-original[0],-250,'restored carrier continues source velocity');
  for(const e of received.filter(e=>e!==carrier))near(at(e).position[0],at(carrier).position[0],`${e.name} remapped target`);
  step(sender,10);
  near(at(carrier).position[0],at(group.carrier).position[0],'receiver and sender preserve the same world projectile');
});

test('Wind Slicer late owner packet after carrier expiry preserves detached tails and helper motion',()=>{
  const sender=make(1);spawn(sender);step(sender,58);
  const packet=encodeOwnedState(sender,'lk',{epoch:9,frameSeq:58});
  assert.equal(packet.effects.some(e=>e.name===CARRIER),false);
  assert.equal(packet.effects.filter(e=>e.setName===SET).length,4);
  validateOwnedReferences(packet,sender.actor('lk'),profile,map);
  const receiver=make(1);receiver.state.nextEffectId=800;applyOwnedState(receiver,'lk',packet);
  const effects=receiver.state.effects.filter(e=>e.setName===SET),damage=effects.find(e=>e.name===DAMAGE);
  for(const e of effects){assert.equal(e.sourceEffectSetId,null);assert.equal(e.sourceTargetMeshId,null);}
  const before=effects.map(e=>({e,position:[...at(e).position]}));
  receiver.actor('lk').x-=1500;receiver.actor('lk').y+=200;receiver.actor('lk').facing=-1;step(receiver,2);
  for(const {e,position} of before){
    near(at(e).position[0]-position[0],e===damage?15:0,`${e.name} retains its own final trajectory`);
    near(at(e).position[1],position[1],`${e.name} cannot fall back to the receiver's owner pose`);
  }
  encodeOwnedState(receiver,'lk',{epoch:9,frameSeq:60});
});
