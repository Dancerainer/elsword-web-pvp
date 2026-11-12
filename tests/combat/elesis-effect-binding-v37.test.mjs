/** Actual target poses, original Garpai geometry and shipped native WASM.
 * Current executor regressions are independent of an original-client trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {sampleSetMeshBoneAnchor} from '../../packages/combat-core/lk-effect-set-targets.mjs';
import {compose,createPoseLibrary,samplePose} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';

const near=(a,b,label,tolerance=1e-5)=>{assert.equal(a?.length,b?.length,label);a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<tolerance,`${label}: ${a} != ${b}`));};
const castStep=(f,step)=>f.sim.step(1/60,step===0?{[f.a.id]:{pressed:['A'],held:['A']}}:{},{snapshot:false});
const bloodName='DamageEffect_SI_SA_SCA_BLOOD_CUTTER';

for(const facing of [-1,1])test(`Blood Cutter ${facing}: all seven exact target-mesh siblings follow and receive carrier retirement`,()=>{
 const f=elesisFixture('CA',{skillId:28023,gap:1800,facing}),{sim,a}=f;let carrier;
 for(let i=0;i<240&&!carrier;i++){castStep(f,i);carrier=sim.state.effects.find(e=>e.name===bloodName&&e.active);}
 assert.ok(carrier,'a real normal skill cast creates NPC1641 carrier');
 while(carrier.elapsed<.13)sim.step(1/60,{},{snapshot:false});
 const children=sim.state.effects.filter(e=>e.sourceBoneTargetMeshId===carrier.id&&e.active),ids=children.map(e=>e.id);
 assert.equal(children.length,7);assert.ok(children.every(e=>e.sourceBoneEffectSetId===carrier.id));
 const births=new Map(children.map(e=>[e.id,[...e.currentAnchor.position]]));
 for(let i=0;i<4;i++){
  sim.step(1/60,{},{snapshot:false});
  for(const id of ids){const child=sim.state.effects.find(e=>e.id===id);assert.ok(child,'bound visual identity must survive combat retirement');
   const bone=sim.effectBoneSampler(carrier,a,child.definition.BONE_NAME);
   near(child.currentAnchor.position,bone,'child uses its flying weapon Dummy01');
   assert.ok(child.currentAnchor.position.every(Number.isFinite));
  }
 }
 assert.ok(ids.every(id=>Math.abs(sim.state.effects.find(e=>e.id===id).currentAnchor.position[0]-births.get(id)[0])>1),
  'every sibling travels after the carrier begins moving');
 carrier.dead=true;carrier.endReason='fixture-explicit-npc-end';sim.drainEvents();sim.step(1/60,{},{snapshot:false});
 assert.ok(ids.every(id=>!sim.state.effects.some(e=>e.id===id)));
 const ended=sim.drainEvents().filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId));
 assert.equal(ended.length,7);assert.ok(ended.every(e=>e.reason==='elesis-effect-set-carrier-ended'));
});

for(const facing of [-1,1])test(`Blood Cutter ${facing}: TRACE_MATRIX is the exact source weapon bone, including animated spin and mesh scale`,()=>{
 const {samplers,effectIndex,effectPoses}=elesisAssets('CA');
 const template=effectIndex.templates.BLOOD_CUTTER_Weapon,pose=effectPoses[template.poseData],library=createPoseLibrary(pose);
 const frame=pose.frames.find(f=>f.name==='Dummy01');assert.deepEqual(frame.nativeRowMatrix,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 const position=[700,130,20],rotation=[0,facing<0?180:0,0],point={position,rotation,facing};
 const carrier={id:1,ownerId:'owner',name:bloodName,mainEffectName:'BLOOD_CUTTER_Weapon',
  setName:'EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile',sourceBoneEffectSetId:1,active:true,elapsed:.1,animationTime:.1,
  definition:{SCALE_X:1.5,SCALE_Y:1.5,SCALE_Z:1.5},damage:{MAIN_EFFECT_NAME:'BLOOD_CUTTER_Weapon'},
  currentAnchor:point,sourcePosedAnchor:point,birthAnchor:point};
 const child={id:2,ownerId:'owner',setName:carrier.setName,sourceBoneEffectSetId:1,sourceBoneTargetMeshId:1,
  definition:{BONE_NAME:'Dummy01',TRACE_MATRIX:1},active:true};
 // Independent original pose evaluation from explicit source time-zero Rotate
 // [-20,-30,0], literal scale1.5 and measured Normal key phase .1 seconds.
 const meshWorld=compose(position,[1.5,1.5,1.5],nativeEffectQuaternion([-20,rotation[1]-30,0]));
 const expected=samplePose(library,'Normal',.1,{worldMatrix:meshWorld}).get('Dummy01');
 const a={id:'owner',facing},matrix=samplers.effectBoneMatrixSampler(carrier,a,'Dummy01');near(matrix,expected,'complete native target frame');
 const bound=sampleSetMeshBoneAnchor(child,[carrier,child],a,samplers.effectBoneSampler,samplers.effectBoneMatrixSampler);
 near(bound.matrix,expected,'bound child keeps all16 entries');near(bound.position,expected.slice(12,15),'same frame position');
 assert.ok(Math.abs(bound.matrix[1])>.01||Math.abs(bound.matrix[2])>.01,'native matrix preserves the non-cardinal rotation');
 assert.equal(samplers.effectBoneMatrixSampler(carrier,a,'Missing_Target_Bone'),null);
 child.definition.TRACE_MATRIX=0;
 assert.equal(sampleSetMeshBoneAnchor(child,[carrier,child],a,samplers.effectBoneSampler,samplers.effectBoneMatrixSampler).matrix,undefined,
  'position-only declaration never inherits a target frame matrix');
});

for(const [state,setName,y]of [
 ['ESI_COMBO_SDK_ZZZX','EffectSet_C_SDK_Combo_SDK_ZZZX',-50],
 ['ESI_COMBO_SDK_ZZZXX','EffectSet_C_SDK_Combo_SDK_ZZZXX',-100],
])for(const facing of [-1,1])test(`CA ${state} ${facing}: original forced-owner missing Dummy03 fallback restores native attack helpers`,()=>{
 const {sim,a,profile}=elesisFixture('CA',{gap:120,facing});sim.enter(a,state,'source-state-geometry-regression');
 const raw=profile.effectSets[setName].raw.EFFECT1;
 assert.equal(raw.BONE_NAME,'Dummy03');assert.equal(raw.TRACE_USER_TARGET_FORCE,1);
 a.animationTime=.6;
 const head=sim.effectAnchorSampler({definition:{BONE_NAME:'_HEAD_BONE'}},a);
 const anchor=sim.effectAnchorSampler({setName,definition:raw},a);
 near(anchor.position,[head.position[0]+125*facing,head.position[1]+y,head.position[2]],'original head fallback + declared offsets');
 assert.equal(sim.effectAnchorSampler({setName:'unproved-actor-bone-set',definition:raw},a),null,'unknown bone groups stay unsupported');
 // Normal state dispatch creates the original member; no custom effect/shape
 // injection substitutes for missing attack geometry.
 a.animationTime=0;sim.drainEvents();let attack;
 for(let i=0;i<100&&!attack;i++){sim.step(1/60,{},{snapshot:false});attack=sim.state.effects.find(e=>e.setName===setName&&e.damage&&e.active);}
 assert.ok(attack,'real state EffectSet dispatch activates its damage member');
 const shapes=sim.effectSampler(attack,a);assert.ok(shapes.length>0);
 assert.ok(shapes.every(s=>s.kind==='sphere'&&s.radius>0&&s.center.every(Number.isFinite)));
});

for(const facing of [-1,1])test(`BH Blaze Wing ${facing}: real cast owns a visible-passive carrier, flies and hits original target geometry`,()=>{
 const f=elesisFixture('BH',{skillId:28017,gap:350,facing}),{sim,a,b,profile}=f;
 const beforeHp=b.hp,starts=[],hits=[],positions=[];let main,sub;
 for(let i=0;i<300;i++){
  castStep(f,i);const events=sim.drainEvents();starts.push(...events.filter(e=>e.type==='effectStarted'));
  hits.push(...events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.origin?.skillId===28017&&e.targetId===b.id));
  main=sim.state.effects.find(e=>e.name==='DamageEffect_SBH_Blaze_Wing_Main'&&e.active)??main;
  sub=sim.state.effects.find(e=>e.name==='DamageEffect_SBH_Blaze_Wing_Sub'&&e.active)??sub;
  if(sub?.active&&!sub.dead)positions.push([...sub.currentAnchor.position]);
 }
 assert.ok(main&&sub,'actual skill cast creates both source attack handles');
 assert.equal(main.sourceBoneTargetMeshId,sub.id,'main visible-passive carrier binds its exact homing helper');
 const passive=Object.entries(profile.damageEffects[main.name].raw).filter(([k])=>/^PASSIVE_PARTICLE\d+$/.test(k));
 assert.equal(passive.length,4);assert.ok(passive.every(([,entry])=>entry.POSITION_TYPE===0&&entry.BONE_NAME==='Dummy01'));
 assert.ok(starts.some(e=>e.effectId===main.id));assert.ok(starts.some(e=>e.effectId===sub.id));
 assert.ok(positions.length>=4&&Math.abs(positions[3][0]-positions[0][0])>10,'source speed2400 advances the helper');
 assert.ok(hits.length>0,'native effect/body geometry accepts actual source damage');assert.ok(b.hp<beforeHp);
 assert.ok(hits.every(hit=>hit.amount>0&&hit.origin.kind==='effect'));
 assert.ok(sim.state.events.every(e=>e.type!=='unsupported'||!String(e.id).includes('blaze-wing-native-lock-on')));
 assert.ok(!sim.state.effects.some(e=>e.id===main.id||e.id===sub.id),'both original3.5s handles retire');
});
