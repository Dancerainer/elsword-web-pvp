import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {tryReflectProjectile,reflectedDisplacement} from '../../packages/combat-core/projectile-reflection.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createWorldColorController} from '../../apps/web/world-color.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));
const profile=read('packages/combat-core/rs-profile.json'),preset=read('config/rs-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/rs/effect-assets.json'),read('artifacts/rs/fx/index.json'));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/rs/'+p)]));
const samplers=createNativeSamplers({profile,characterPose:read('artifacts/rs/runtime-pose.json'),effectIndex:index,effectPoses:poses});
function make(networkOwnerId=null){return createSimulation({profile,map,preset,seed:2016,networkOwnerId,...samplers,
 actors:[{id:'shooter',professionId:'RS',team:0,position:[1800,2840,0],lineId:6,facing:1,passives:[],guildPassives:[]},
 {id:'guard',professionId:'RS',team:1,position:[2000,2840,0],lineId:6,facing:-1,passives:[],guildPassives:[]}]});}
function projectile(sim){const a=sim.actor('shooter');return sim.createEffect(a,{NAME:'FIREBALL_SMALL_DOWN_ELSWORD'},
 {birthAnchor:{position:[1970,2940,0],facing:1,rotation:[0,0,0],customPosition:true}});}
function guard(sim,time=.5){const b=sim.actor('guard');sim.enter(b,'ESSI_ERS_COUNTER_GUARD','test-guard');b.animationTime=time;return b;}
test('RS magic guard strict source window, front gate and CAN_REFLEX are independent',()=>{
 for(const [time,front,can,expected] of [[.01,true,1,false],[.01001,true,1,true],[10,true,1,false],[.5,false,1,false],[.5,true,0,false]]){
  const s=make(),b=guard(s,time),a=s.actor('shooter'),e=projectile(s);
  assert.equal(tryReflectProjectile(s,a,b,{...e.damage.DAMAGE_DATA,CAN_REFLEX:can},{kind:'effect',id:e.id},front),expected);
 }
});
test('RS source fireball hits original helper, guard creates a reversed new owner projectile, then hits shooter',()=>{
 const s=make(),b=guard(s),a=s.actor('shooter'),before=b.hp,e=projectile(s);
 s.tickEffects(0);const r=s.state.effects.find(x=>x.sourceReflection);
 assert.ok(r,'actual original fireball helper intersects guard');assert.equal(b.hp,before);assert.equal(r.ownerId,b.id);
 assert.equal(r.sourceProfessionId,'RS');assert.equal(r.sourceReflection.remaining,1);assert.equal(r.birthAnchor.rotation[2],180);
 assert.ok(!s.state.effects.includes(e));const hp=a.hp,x=r.x;
 s.tickEffects(1/60);assert.ok(r.x<x,'projectile reverses its travel direction');
 for(let i=0;i<30;i++)s.tickEffects(1/60);
 assert.ok(a.hp<hp,'reflected fireball uses the original collision geometry to hit its former owner');
 assert.ok(s.state.events.some(x=>x.type==='hit'&&x.actorId==='guard'&&x.targetId==='shooter'));
});
test('RS passive excludes special active, has no front requirement, and original two-reflection limit terminates',()=>{
 const s=make(),a=s.actor('shooter'),b=s.actor('guard');b.passivePolicy={runeSlayer:{magicReflectChance:1}};
 let e=projectile(s),origin={kind:'effect',id:e.id};
 assert.equal(tryReflectProjectile(s,a,b,{...e.damage.DAMAGE_DATA,ATTACK_TYPE:1},origin,false),false);
 assert.equal(tryReflectProjectile(s,a,b,e.damage.DAMAGE_DATA,origin,false),true);
 let r=s.state.effects.find(x=>x.sourceReflection);a.passivePolicy={runeSlayer:{magicReflectChance:1}};
 r.currentAnchor=structuredClone(r.birthAnchor);
 assert.equal(tryReflectProjectile(s,b,a,r.damage.DAMAGE_DATA,{kind:'effect',id:r.id},false),true);
 const twice=s.state.effects.find(x=>x.sourceReflection?.remaining===0);assert.ok(twice);
 const count=s.state.nextEffectId;
 assert.equal(tryReflectProjectile(s,a,b,twice.damage.DAMAGE_DATA,{kind:'effect',id:twice.id},false),true);
 assert.equal(s.state.nextEffectId,count,'guard still rejects damage but count zero cannot create a third reflection');
});
test('RS reflection owned state restores frozen source definition and retires original without stale replay',()=>{
 const source=make(),a=source.actor('shooter'),b=guard(source),original=projectile(source);
 const originalReport=encodeOwnedState(source,a.id,{frameSeq:1,epoch:0});source.tickEffects(0);
 const report=encodeOwnedState(source,b.id,{frameSeq:2,epoch:0});
 validateOwnedReferences(report,b,source.profileFor(b),map,{actors:source.state.actors,profiles:source.profiles});
 const restored=make();applyOwnedState(restored,a.id,originalReport);applyOwnedState(restored,b.id,report);
 assert.ok(restored.state.effects.some(e=>e.ownerId===a.id&&e.dead));
 const remote=restored.state.effects.find(e=>e.sourceReflection);
 assert.deepEqual(remote.damage,profile.damageEffects.FIREBALL_SMALL_DOWN_ELSWORD.raw);
 assert.deepEqual(remote.birthAnchor.rotation,[0,0,180]);
 restored.state.effects=restored.state.effects.filter(e=>!e.sourceReflection);
 applyOwnedState(restored,a.id,originalReport);assert.ok(restored.state.effects.filter(e=>e.ownerId===a.id).every(e=>e.dead));
 const forged=structuredClone(report);forged.effects[0].sourceProfessionId='VC';
 assert.throws(()=>validateOwnedReferences(forged,b,source.profileFor(b),map,{actors:source.state.actors,profiles:source.profiles}),/reflection-source/);
 assert.ok(original.id>0);
});
test('attacker peer cannot publish reflection for remote defender; source roll reverses vertical velocity',()=>{
 const s=make('shooter'),a=s.actor('shooter'),b=guard(s),e=projectile(s);
 assert.equal(tryReflectProjectile(s,a,b,e.damage.DAMAGE_DATA,{kind:'effect',id:e.id},true),false);
 const d=reflectedDisplacement({sourceReflected:true,birthAnchor:{rotation:[0,0,180]}},[100,-200,0],1);
 assert.ok(Math.abs(d[0]+100)<1e-9);assert.ok(Math.abs(d[1]-200)<1e-9);
});
test('reflection receipts bind original declaration, remaining count and life epoch before retiring an effect',()=>{
 const s=make(),a=s.actor('shooter'),b=guard(s);s.networkEpochFor=()=>3;
 const original=projectile(s),unrelated=s.createEffect(a,{NAME:'DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST'});
 const attack=encodeOwnedState(s,a.id,{epoch:3,frameSeq:1});s.tickEffects(0);
 const report=encodeOwnedState(s,b.id,{epoch:3,frameSeq:2});
 assert.equal(report.effects.find(e=>e.sourceReflection).sourceReflection.sourceEpoch,3);
 for(const mutation of ['unrelated','count','epoch']){
  const restored=make(),forged=structuredClone(report);restored.networkEpochFor=()=>3;
  const receipt=forged.effects.find(e=>e.sourceReflection).sourceReflection;
  if(mutation==='unrelated')receipt.sourceEffectId=unrelated.id;
  if(mutation==='count')receipt.remaining=0;
  if(mutation==='epoch')receipt.sourceEpoch=2;
  applyOwnedState(restored,b.id,forged);applyOwnedState(restored,a.id,attack);
  const candidate=restored.state.effects.find(e=>e.ownerId===a.id&&e.networkId===(mutation==='unrelated'?unrelated.id:original.id));
  assert.ok(candidate&&!candidate.dead,mutation+' must not retire a different original');
 }
 const restored=make();restored.networkEpochFor=()=>3;
 applyOwnedState(restored,b.id,report);applyOwnedState(restored,a.id,attack);
 assert.equal(restored.state.effects.find(e=>e.ownerId===a.id&&e.networkId===original.id).endReason,'projectile-reflected');
 const nextLife={...attack,epoch:4};applyOwnedState(restored,a.id,nextLife);
 assert.ok(!restored.state.effects.find(e=>e.ownerId===a.id&&e.networkId===original.id).dead,'old receipt cannot kill same ID after respawn');
});
test('both CAN_REFLEX-only runes show feedback without recreation; observer replay is deduplicated and expires',()=>{
 for(const name of ['ELSWORD_RUNE_SLAYER_DASH_ZZX','ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ']){
  const s=make(),a=s.actor('shooter'),b=guard(s),e=s.createEffect(a,{NAME:name});
  const next=s.state.nextEffectId,position=[1999,2940,0];
  assert.equal(tryReflectProjectile(s,a,b,e.damage.DAMAGE_DATA,{kind:'effect',id:e.id,impactPoint:position},true),true);
  assert.equal(s.state.nextEffectId,next);assert.ok(!e.dead);
  const local=s.state.events.filter(e=>e.type==='projectileReflectionFeedback');
  assert.equal(local.length,1);assert.equal(local[0].particles,true);assert.deepEqual(local[0].position,position);
  const report=encodeOwnedState(s,b.id,{epoch:2,frameSeq:1});
  validateOwnedReferences(report,b,profile,map,{actors:s.state.actors,profiles:s.profiles});
  const restored=make();applyOwnedState(restored,b.id,report);applyOwnedState(restored,b.id,report);
  const notices=restored.state.events.filter(e=>e.type==='projectileReflectionFeedback');
  assert.equal(notices.length,1);assert.equal(notices[0].networkArrival,true);assert.deepEqual(notices[0].position,position);
  const nextLife=structuredClone(report);nextLife.epoch=3;delete nextLife.actor.sourceReflectionNotice;
  applyOwnedState(restored,b.id,nextLife);
  assert.equal(restored.state.events.filter(e=>e.type==='projectileReflectionFeedback').length,1,'respawn without a notice must not replay old-life feedback');
  assert.equal(restored.actor(b.id).sourceReflectionNotice,undefined);
  const delayed=make();applyOwnedState(delayed,b.id,report,{presentationAge:.6});
  assert.equal(delayed.state.events.filter(e=>e.type==='projectileReflectionFeedback').length,0);
 }
});
test('reflection feedback restores black world color over the original one-second fade',()=>{
 const c=createWorldColorController({profile});c.event({type:'projectileReflectionFeedback',remaining:.5,particles:false});
 assert.deepEqual(c.step({actors:[]},0),[0,0,0]);assert.deepEqual(c.step({actors:[]},.5),[.5,.5,.5]);
 assert.deepEqual(c.step({actors:[]},.5),[1,1,1]);
 c.event({type:'projectileReflectionFeedback',remaining:.3});
 assert.deepEqual(c.step({actors:[]},.3),[.5,.5,.5],'network age does not restart the full fade');
});
