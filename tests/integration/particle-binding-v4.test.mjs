/** Small binding fixture with actual 2016 P3 geometry. Test declarations isolate
 * source switch branches; they are not authored skill configurations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';

test('source position branches apply offsets only to main-bone; unit-bone axis is independent of AddRotate and TRACE0 passive follows',async t=>{
  const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
  const particle='Raven_HarpoonSpearFireP3',template=index.templates[particle];
  const pose=JSON.parse(readFileSync(resolve('artifacts/vc',template.poseData)));
  const entry=positionType=>({PARTICLE_NAME:particle,POSITION_TYPE:positionType,BONE_NAME:'source-fixture',
    OFFSET_X:1,OFFSET_Y:2,OFFSET_Z:3,ROTATE_Y:10,TRACE:0});
  const originalOffset=vcProfile.damageEffects.DamageEffect_SA_Raven_PowerAssault.raw.PASSIVE_PARTICLE6;
  assert.equal(originalOffset.OFFSET_X,150);assert.equal(originalOffset.APPLY_ROTATED_OFFSET,1);
  const damage={MAIN_EFFECT_NAME:'source-binding-fixture',PASSIVE_PARTICLE0:entry(0),PASSIVE_PARTICLE1:{...entry(1),APPLY_ROTATE:0},
    PASSIVE_PARTICLE2:{...originalOffset,PARTICLE_NAME:particle},
    PASSIVE_PARTICLE3:{...entry(0),APPLY_ROTATED_OFFSET:1}};
  const profile={...vcProfile,states:{},skillCatalog:[],buffTemplates:{},effectTemplates:{},effectSets:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[],damageEffects:{source:{raw:damage}}};
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);
  scene.useRightHandedSystem=true;new FreeCamera('particle-binding-v4',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  let ownerYaw=45,ownerBone=[10,20,30];
  const view=await createEffectsView({scene,engine,index:{...index,templates:{[particle]:template}},profile,effectPoses:{[template.poseData]:pose},
    effectQuality:{level:'high',particleDivisor:1},samplers:{effectBoneSampler:()=>[100,200,300],
      effectAnchorSampler:()=>({position:ownerBone,rotation:[0,ownerYaw,0]}),actorRotationSampler:()=>[0,ownerYaw,0]}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const {a}=vcFixture(),anchor={position:[400,500,600],facing:1,rotation:[0,90,0]};
  a.facing=-1;
  const e={id:70,ownerId:a.id,name:'source',mainEffectName:'source-binding-fixture',definition:{},birthAnchor:anchor,currentAnchor:anchor,sourceSkillMeshControl:true};
  const state={actors:[a],effects:[e]};
  view.event({type:'effectStarted',effectId:70,actorId:a.id,name:'source',definition:{},birthAnchor:anchor},state);
  view.event({type:'effectStartParticles',effectId:70,actorId:a.id,impactPoint:[800,900,1000],mainAnchor:anchor,
    entries:[{key:'START_PARTICLE0',entry:entry(2)},{key:'START_PARTICLE1',entry:entry(3)}]},state);
  view.step(.02,state);view.render();
  let proof=view.proof({includeDraws:true}).nativeParticleDraws;
  const near=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-8,JSON.stringify({actual,expected})));
  proof.sequences.map(row=>row.position).forEach((p,i)=>near(p,[[101,202,303],[10,20,30],[100,200,150],[103,202,299],[800,900,1000],[400,500,600]][i]));
  assert.deepEqual(proof.samples.map(row=>row.axis),[[0,100,0],[0,55,0],[0,90,0],[0,100,0],[0,0,0],[0,100,0]]);
  assert.deepEqual(proof.samples.map(row=>row.visualRotation),[[0,100,0],[0,0,0],[0,90,0],[0,100,0],[0,0,0],[0,100,0]]);
  anchor.rotation=[0,135,0];
  ownerYaw=135;ownerBone=[110,220,330];view.step(.02,state);view.render();proof=view.proof({includeDraws:true}).nativeParticleDraws;
  assert.deepEqual(proof.sequences[1].position,ownerBone,'PASSIVE TRACE0 still invokes SetParticleData');
  assert.deepEqual(proof.samples[1].axis,[0,145,0]);assert.deepEqual(proof.samples[1].visualRotation,[0,0,0]);
  near(proof.sequences[2].position,[100-150/Math.SQRT2,200,300-150/Math.SQRT2]);
  near(proof.sequences[3].position,[100+2/Math.SQRT2,202,300-4/Math.SQRT2]);
  // A pitched/rolled mesh must project and normalize its native +X direction,
  // not use yaw alone; this is a source-consumer probe, not a skill declaration.
  anchor.rotation=[30,135,40];view.step(.02,state);view.render();proof=view.proof({includeDraws:true}).nativeParticleDraws;
  const r=Math.PI/180,c=Math.cos(40*r),d=Math.sin(40*r)*Math.sin(30*r),
    x=c*Math.cos(135*r)+d*Math.sin(135*r),z=-c*Math.sin(135*r)+d*Math.cos(135*r),length=Math.hypot(x,z);
  near(proof.sequences[2].position,[100+150*x/length,200,300+150*z/length]);
  view.event({type:'effectEnded',effectId:70,actorId:a.id,reason:'source-owner-end'},state);state.effects=[];
  ownerYaw=270;ownerBone=[1100,2200,3300];view.step(.02,state);view.render();proof=view.proof({includeDraws:true}).nativeParticleDraws;
  assert.deepEqual(proof.sequences[1].position,[110,220,330],'retired owner freezes surviving particles at last sequence position');
  assert.deepEqual(proof.samples[1].axis,[0,145,0],'retired owner stops dynamic rotation sampling too');
});
