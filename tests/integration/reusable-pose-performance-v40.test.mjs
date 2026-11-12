import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {createPoseLibrary,createPoseSampleBuffer,samplePose,samplePoseToRef,compose,mapClipTime} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const channel=(values,times=[0,.2,.2,1])=>({times,values});
const track=(name,sign=1)=>({frame_name:name,
 translation:channel([[0,-0,1],[2,3,4],[5,6,7],[8,9,10]]),
 scale:channel([[1,2,3],[4,5,6]],[0,1]),
 rotation:channel([[0,0,0,2*sign],[0,3*sign,0,sign],[0,-4*sign,0,-sign]],[0,.2,1])});
function document(){return {schemaVersion:1,helpers:[],frames:[
 {name:'child',parent:2,nativeRowMatrix:[...identity.slice(0,12),7,8,9,1]},
 {name:'unanimated',parent:0,nativeRowMatrix:[...identity.slice(0,12),2,3,4,1]},
 {name:'Bip01',parent:null,nativeRowMatrix:identity}],clips:[
 {name:'current',tracks:[track('Bip01'),track('child')]},
 {name:'previous',tracks:[track('Bip01',-1),track('unanimated')]},
 {name:'bind',tracks:[]}]};}

test('reusable pose preserves exact double hierarchy, root extraction and partial-track transitions',()=>{
 for(const source of [document(),compactPoseDocument(document())]){
  const library=createPoseLibrary(source),buffer=createPoseSampleBuffer(library);
  for(const clipName of ['current','previous','bind'])for(const time of [-1,0,.1,.2,.37,1,2])
   for(const options of [{},{worldMatrix:compose([1,2,3],[2,3,4],[1,2,3,4])},
    {rootTranslationOverride:[0,null,0]},...['current','previous','bind'].flatMap(name=>[0,.37,1].map(weight=>({
     worldMatrix:compose([17,-23,39],[1.33,1.33,1.33],[0,1,0,1]),rootTranslationOverride:[0,undefined,0],
     transition:{clipName:name,timeSeconds:.63,weight}})))]){
    assert.deepEqual(samplePoseToRef(library,clipName,time,buffer,options),samplePose(library,clipName,time,options));
   }
 }
});

test('reusable outputs have stable storage, independent owners and explicit malformed-input failures',()=>{
 const library=createPoseLibrary(document()),a=createPoseSampleBuffer(library),b=createPoseSampleBuffer(library);
 const output=samplePoseToRef(library,'current',.1,a),rows=[...output.values()],retained=structuredClone(output);
 for(let i=0;i<300;i++){
  assert.equal(samplePoseToRef(library,'previous',i/60,a),output);
  assert.deepEqual([...output.values()].map((value,index)=>value===rows[index]),[true,true,true]);
 }
 samplePoseToRef(library,'current',.1,b);assert.deepEqual(b.matrices,retained);
 samplePoseToRef(library,'current',.9,a);assert.deepEqual(b.matrices,retained,'another owner never overwrites retained output');
 assert.throws(()=>samplePoseToRef(library,'current',NaN,a),/Invalid animation time/);
 assert.throws(()=>samplePoseToRef(library,'absent',0,a),/Unknown original animation/);
 assert.throws(()=>samplePoseToRef(createPoseLibrary(document()),'current',0,a),/another library/);
 assert.throws(()=>samplePoseToRef(library,'current',0,a,{transition:{clipName:'previous',timeSeconds:0,weight:2}}),/Invalid previous animation/);
 const cyclic=document();cyclic.frames[2].parent=0;assert.throws(()=>createPoseSampleBuffer(createPoseLibrary(cyclic)),/Cyclic skeleton/);
 const malformed=document();delete malformed.clips[0].tracks[0].rotation;
 const bad=createPoseLibrary(malformed);assert.throws(()=>samplePoseToRef(bad,'current',0,createPoseSampleBuffer(bad)),/Incomplete KAC/);
 const duplicate=document();duplicate.frames[1].name='child';
 const legacy=createPoseLibrary(duplicate),fallback=createPoseSampleBuffer(legacy);
 assert.equal(fallback.plan.referenceOnly,true,'duplicate-name traversal retains legacy semantics instead of guessing a new hierarchy');
 assert.deepEqual(samplePoseToRef(legacy,'current',.37,fallback),samplePose(legacy,'current',.37));
});

const assets=resolve(process.env.ELSWORD_ASSETS_ROOT??'artifacts'),dir=resolve(assets,'mm/summons/apocalypse');
test('actual Apocalypse117-node anchors, looping clocks and cache invalidation match original allocating pose',
 {skip:!existsSync(resolve(dir,'manifest.json'))},t=>{
 const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json'))),pose=JSON.parse(readFileSync(resolve(dir,manifest.poseData)));
 const library=createPoseLibrary(pose),buffer=createPoseSampleBuffer(library),samplers=createAddSummonSamplers({manifest,pose});
 assert.equal(library.frames.length,117);let matrices=0,anchors=0;
 for(const [state,binding]of Object.entries(manifest.stateBindings))for(const fraction of [0,.37,1,1.63]){
  const npc={kind:'apocalypse',state,animationTime:binding.durationSeconds*fraction,position:[101,203,307],facing:1,yaw:37,aimZ:-24};
  const time=mapClipTime(npc.animationTime,binding.durationSeconds,binding.rawPlayType===0,library.clips.get(binding.animationName).nativePlaybackField);
  const worldMatrix=compose(npc.position,[manifest.unitScale,manifest.unitScale,manifest.unitScale],nativeEffectQuaternion([0,npc.yaw,npc.aimZ]));
  const expected=samplePose(library,binding.animationName,time,{worldMatrix});
  assert.deepEqual(samplePoseToRef(library,binding.animationName,time,buffer,{worldMatrix}),expected);matrices+=expected.size;
  const selected=['Dummy_B15','COLLISION_SPHERE1'];
  for(const name of selected){
   const original=samplers.summonPoseSampler(npc,{BONE_NAME:name,TRACE_MATRIX:1});
   assert.deepEqual(original.matrix,expected.get(name));anchors++;
   const copy=structuredClone(original);npc.position[0]+=90;
   const shifted=samplers.summonPoseSampler(npc,{BONE_NAME:name,TRACE_MATRIX:1});
   assert.deepEqual(original,copy,'caller retained anchors must never alias reusable matrices');
   assert.ok(Math.abs(shifted.position[0]-copy.position[0]-90)<1e-7);
   npc.position[0]-=90;
  }
 }
 t.diagnostic(JSON.stringify({sourceFrames:library.frames.length,exactWorldMatrices:matrices,ownedAnchors:anchors}));
});
