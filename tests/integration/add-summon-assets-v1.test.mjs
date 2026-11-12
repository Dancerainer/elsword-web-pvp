import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {loadAddSummonAssets,mergeAddSummonAudio,rebaseAddSummonEffectIndex} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createAddSummonSamplers,addSummonAnimation} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {createAddSummonView} from '../../apps/web/add-summon-view.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createPoseLibrary,samplePose,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';
const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..');
const json=file=>JSON.parse(readFileSync(resolve(root,'artifacts',file)));
const dir='mm/summons/apocalypse/',manifest=json(dir+'manifest.json'),pose=json(dir+manifest.poseData);
const npc=(overrides={})=>({kind:'apocalypse',serial:4,state:'APOCALYPSE_ATTACK_C',animationTime:.75,position:[101,203,307],facing:1,yaw:37,aimZ:-24,...overrides});
const close=(a,b,tolerance=1e-7)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<tolerance,`${i}: ${a[i]} vs ${b[i]}`);};

test('independent source hierarchy supplies bone anchors, original periods and one scaled collision sphere',()=>{
 const notes=[],sampler=createAddSummonSamplers({manifest,pose,onUnsupported:v=>notes.push(v)}),n=npc();
 const library=createPoseLibrary(pose),worldMatrix=compose(n.position,[1.33,1.33,1.33],nativeEffectQuaternion([0,37,-24]));
 const matrices=samplePose(library,'Attack_C',.75,{worldMatrix});
 const def={BONE_NAME:'Dummy_B15',POSITION_OFFSET_X:7,POSITION_OFFSET_Y:11,POSITION_OFFSET_Z:13,ROTATE_Y:5};
 const actual=sampler.summonPoseSampler(n,def),point=transform(matrices.get('Dummy_B15'),[0,0,0]);
 close(actual.position,point.map((v,i)=>v+[7,11,13][i]));assert.deepEqual(actual.rotation,[0,42,-24]);
 assert.equal(sampler.summonAnimationDuration(n,'APOCALYPSE_ATTACK_C'),3.8333332538604736,'original 1.3 state speed belongs to core');
 const spheres=sampler.summonDefenderSampler(n),h=pose.helpers.find(h=>h.name==='COLLISION_SPHERE1'),matrix=matrices.get(h.name);
 assert.equal(spheres.length,1);close(spheres[0].center,transform(matrix,[0,0,0]));
 assert.equal(spheres[0].radius,h.geometryBoundingSphereCandidate.radius*Math.hypot(...matrix.slice(0,3)));
 assert.match(spheres[0].source.radiusEvidence,/unverified/);
 const before=sampler.summonPoseSampler(n,def).position;n.position[0]+=90;
 close(sampler.summonPoseSampler(n,def).position,before.map((v,i)=>v+(i?0:90)));
 assert.equal(sampler.summonPoseSampler(n,{BONE_NAME:'Bip01'}),null);assert.equal(notes.length,1);
 assert.equal(sampler.summonPoseSampler(n,{BONE_NAME:'Bip01'}),null);assert.equal(notes.length,1,'unsupported reported once');
 assert.equal(addSummonAnimation(manifest,npc({state:'APOCALYPSE_WAIT'})).loop,true);
 assert.equal(addSummonAnimation(manifest,npc({state:'APOCALYPSE_FINISH_ATTACK'})).name,'Attack_F');
 assert.equal(addSummonAnimation(manifest,npc({state:'Unknown'})),null);
});

test('resource loader adds all 22 original templates and exact audio bytes without rewriting old indexes',async()=>{
 const calls=[],resource=await loadAddSummonAssets({base:'/assets/mm/',data:async url=>{calls.push(url);return json(url.replace('/assets/',''));}});
 assert.equal(resource.bodyContainer,null);assert.equal(resource.pose.frames.length,117);
 const old=json('mm/fx/index.json'),before=JSON.stringify(old),merged=mergeVisualEffectIndexes(old,resource.fxIndex);
 assert.equal(Object.keys(resource.fxIndex.templates).length,22);
 // The base closure grew with the later original MM installations. Its old
 // total507 is not the summon contract: retain the exact union, including
 // shared source templates, without dropping or replacing either input.
 const expectedNames=[...new Set([...Object.keys(old.templates),...Object.keys(resource.fxIndex.templates)])].sort();
 assert.deepEqual(Object.keys(merged.templates).sort(),expectedNames);
 for(const [name,template]of Object.entries(old.templates))assert.deepEqual(merged.templates[name],template);
 for(const [name,template]of Object.entries(resource.fxIndex.templates))assert.deepEqual(merged.templates[name],template);
 assert.equal(JSON.stringify(old),before);
 for(const t of Object.values(resource.fxIndex.templates)){
  for(const file of [t.glb,t.poseData,...Object.values(t.textures??{}).map(v=>v.file)].filter(Boolean)){
   assert.ok(file.startsWith('summons/apocalypse/'));assert.ok(readFileSync(resolve(root,'artifacts/mm',file)).length);
  }
 }
 const original=json('mm/audio/manifest.json'),audio=mergeAddSummonAudio(original,resource.audio);
 for(const [name,value]of Object.entries(resource.audio.files))assert.equal(audio.files[name].sha256,value.sha256);
 assert.ok(audio.states.APOCALYPSE_ATTACK_C);assert.equal(calls.length,4);
 const conflict=structuredClone(resource.audio),name=Object.keys(original.files)[0];conflict.files[name]={sha256:'wrong'};
 assert.throws(()=>mergeAddSummonAudio(original,conflict),/Conflicting original summon audio/);
 await assert.rejects(loadAddSummonAssets({base:'/assets/mm/',data:async url=>json(url.replace('/assets/','')),profile:{summonDeclarations:{apocalypse:{source:{sha256:'wrong'}}}}}),/source mismatch/);
 const broken=structuredClone(resource.fxIndex);Object.values(broken.templates)[0].glb='https://unexpected/x';
 assert.throws(()=>rebaseAddSummonEffectIndex(broken),/Invalid summon resource path/);
});

test('actual visible NPC follows its own yaw and aim, survives resampling, and disposes clones on expiry/recast',async t=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 const container=await loadPoseContainer(scene,resolve(root,'artifacts',dir,manifest.runtimeGlb));
 const baseline={meshes:scene.meshes.length,materials:scene.materials.length};
 let styled=0;const view=createAddSummonView({scene,assets:{manifest,pose,bodyContainer:container},styleView:v=>{assert.equal(v.meshes.filter(m=>m.getTotalVertices()).length,37);styled++;}});
 t.after(()=>{view.dispose();container.dispose();scene.dispose();engine.dispose();});
 const sampler=createAddSummonSamplers({manifest,pose}),a={id:'owner',x:9999,y:9999,z:9999,facing:-1,sourceAddSummon:npc()};
 for(const [yaw,aimZ,state,time]of [[37,-24,'APOCALYPSE_ATTACK_C',.75],[147,33,'APOCALYPSE_ATTACK_B',1.9],[0,0,'APOCALYPSE_WAIT',6.25]]){
  Object.assign(a.sourceAddSummon,{yaw,aimZ,state,animationTime:time});view.update([a]);
  const expected=sampler.summonPoseSampler(a.sourceAddSummon,{BONE_NAME:'Dummy_B15'}).position;
  const node=scene.getTransformNodeByName('owner-apocalypse-4_Dummy_B15'),m=node.computeWorldMatrix(true).asArray();
  close([m[12]*100,m[13]*100,-m[14]*100],expected,.002);
  assert.equal(view.proof().instances,1);assert.equal(view.proof().meshes,37);
 }
 a.sourceAddSummon.serial=5;view.update([a]);assert.equal(view.proof().instances,1);assert.equal(view.proof().meshes,37);
 const rootNode=scene.getTransformNodeByName('owner-apocalypse-5-world');assert.equal(rootNode.scaling.x,.01*manifest.unitScale);
 assert.equal(rootNode.getChildMeshes().every(m=>m.alphaIndex===11),true);
 view.update([a,{id:'other',sourceAddSummon:npc({serial:9})}]);assert.equal(view.proof().instances,2);
 assert.equal(styled,3,'style applied only at clone creation, including recast');
 view.update([]);assert.equal(view.proof().instances,0);assert.equal(scene.meshes.length,baseline.meshes);assert.equal(scene.materials.length,baseline.materials);
 view.dispose();view.update([a]);assert.equal(view.proof().instances,0);
});
