/** Independent original dummy-world math + actual visible child origins.
 * This deliberately tests geometry/presentation rather than counting hits.
 * Fixed-V5 EffectSet is a reference; target-client/GPU traces remain absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {compose,createPoseLibrary,samplePose,mapClipTime} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';
const start='EffectSet_SA_SDK_BRANDISH_BREAKER_START',loop='EffectSet_SA_SDK_BRANDISH_BREAKER_LOOP';
const close=(a,b,tolerance=.01)=>a?.length===b?.length&&a.every((n,i)=>Math.abs(n-b[i])<tolerance);
for(const facing of [-1,1])test(`CA Brandish ${facing}: original -100/.8/-7 dummy math matches attack spheres, visible slash births and loop origins`,async t=>{
 const f=elesisFixture('CA',{skillId:28022,facing,gap:1800}),{sim,a,profile}=f,{effectIndex,effectPoses,samplers}=elesisAssets('CA'),
  definitions=[start,loop].flatMap(name=>Object.values(profile.effectSets[name].raw).filter(v=>v&&typeof v==='object'&&v.NAME)),
  names=new Set(definitions.map(d=>d.NAME)),templates={},queue=[...names].map(name=>profile.damageEffects[name]?.raw.MAIN_EFFECT_NAME??name);
 for(const name of queue){if(templates[name])continue;const template=effectIndex.templates[name];assert.ok(template,name);templates[name]=template;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[])));
 }
 const carrierName=profile.effectSets[start].raw.EFFECT1.NAME,carrierTemplate=profile.effectTemplates.SDK_BRANDISH_BREAKER_START_AttackBox,
  library=createPoseLibrary(effectPoses[carrierTemplate.poseData]),clip=library.clips.get('Normal');
 assert.ok(definitions.every(d=>d.TRACE_MATRIX!==1),'this skill is position-only; matrix transport cannot be credited as its repair');
 assert.equal(profile.effectSets[start].raw.EFFECT1.POSITION_OFFSET_X,-100);
 assert.deepEqual(carrierTemplate.events.find(e=>e.property==='Size').value,[.8,.8,.8]);
 assert.deepEqual(carrierTemplate.events.find(e=>e.property==='Rotate').value,[0,0,-7]);
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('brandish-source-position',new Vector3(0,0,10),scene);
 const assetRoot=resolve(process.env.ELESIS_ASSET_ROOT??resolve(import.meta.dirname,'../../artifacts')),
  view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers,
   profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
   effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/ca/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assetRoot,'ca',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const handles=new Set(),births=[],seenBones=new Set();let shapeFrames=0,renderOrigins=0,loopOrigins=0;
 // Below20% is the original declared free-extension branch. Hold the actual
 // skill key to cover both START and LOOP without forcing a skill state.
 a.hp=a.hpMax*.1;sim.drainEvents();
 for(let frame=0;frame<300;frame++){
  sim.step(1/60,{[a.id]:{held:frame<150?['A']:[],pressed:frame===0?['A']:[]}},{snapshot:false});
  for(const event of sim.drainEvents()){
   if(event.type==='effectStarted'&&names.has(event.name)){handles.add(event.effectId);view.event(event,sim.state);
    if(event.setName===start&&event.sourceBoneTargetMeshBound){
     const child=sim.state.effects.find(e=>e.id===event.effectId),carrier=sim.state.effects.find(e=>e.id===child.sourceBoneTargetMeshId),
      anchor=carrier.sourcePosedAnchor??carrier.currentAnchor??carrier.birthAnchor,
      world=compose(anchor.position,[.8,.8,.8],nativeEffectQuaternion([0,anchor.rotation?.[1]??0,-7])),
      phase=mapClipTime(carrier.animationTime,clip.durationSeconds,false,clip.nativePlaybackField),
      expected=samplePose(library,'Normal',phase,{worldMatrix:world}).get(child.definition.BONE_NAME);
     assert.ok(expected,child.definition.BONE_NAME);assert.ok(close(event.birthAnchor.position,expected.slice(12,15)),'raw target dummy world point at actual visual birth');
     births.push([...event.birthAnchor.position]);seenBones.add(child.definition.BONE_NAME);
    }
   }else if(event.type==='effectEnded'&&handles.has(event.effectId))view.event(event,sim.state);
  }
  const carrier=sim.state.effects.find(e=>e.name===carrierName&&e.active&&!e.dead);
  if(carrier){
   const anchor=carrier.sourcePosedAnchor??carrier.currentAnchor??carrier.birthAnchor,
    world=compose(anchor.position,[.8,.8,.8],nativeEffectQuaternion([0,anchor.rotation?.[1]??0,-7])),
    phase=mapClipTime(carrier.animationTime,clip.durationSeconds,false,clip.nativePlaybackField),expected=samplePose(library,'Normal',phase,{worldMatrix:world}),
    shapes=sim.effectSampler(carrier,a,{profile});
   for(const shape of shapes.filter(s=>s.kind==='sphere')){const matrix=expected.get(shape.source.helper);assert.ok(matrix);
    assert.ok(close(shape.center,matrix.slice(12,15)),'real collision sphere center uses exactly the same original dummy world transform');shapeFrames++;
   }
  }
  view.step(1/60,sim.state);view.render({actors:sim.state.actors});
  for(const node of scene.transformNodes.filter(n=>/^fx-SCA_BR_BR_(?:PA01|PT01(?:_[1-4])?)-\d+-world$/.test(n.name)&&n.isEnabled())){
   const world=node.computeWorldMatrix(true).asArray(),point=[world[12]*100,world[13]*100,-world[14]*100];
   assert.ok(births.some(b=>close(point,b)),`visible slash origin ${point} must retain an actual original target-bone birth`);renderOrigins++;
  }
  const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences.filter(s=>/^SDK_BRANDISH_BREAKER_PE00/.test(s.name));
  for(const sequence of sequences){const matches=sim.state.effects.filter(e=>e.setName===loop&&e.name===sequence.name&&e.active&&!e.dead);
   if(matches.length){assert.ok(matches.some(e=>close(sequence.position,e.currentAnchor.position)),'loop emitter origin follows its exact source dummy point');loopOrigins++;}
  }
 }
 for(const bone of ['Dummy01','Dummy02','Dummy03','Dummy04','Dummy05','ATTACK_SPHERE02'])assert.ok(seenBones.has(bone),bone);
 assert.ok(shapeFrames>20,'comparison samples real attack helpers over the moving START');
 assert.ok(renderOrigins>5,'the actual original PT_MESH slash geometry reaches production presentation');assert.ok(loopOrigins>5);
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
});
