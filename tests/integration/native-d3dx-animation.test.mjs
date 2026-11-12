import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,FreeCamera,Vector3,Quaternion,Animation} from '@babylonjs/core';
import {createPoseLibrary,sampleLocalTransform,sampleChannel,compose,sampleTransitionTrack,resolveControllerPose,nativeQuaternionNlerp} from '../../tools/assets/character/sample_pose.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints,evaluateNativeAnimation} from '../../apps/web/actor-presentation.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {createPoseAudit} from '../../apps/web/pose-audit.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const url=p=>new URL('../../'+p,import.meta.url);
const native=JSON.parse(readFileSync(url('reports/rf-native-d3dx-execution.json')));
const trace=label=>native.traces.find(row=>row.label===label);
const fullNative=JSON.parse(readFileSync(url('reports/rf-full-skill-d3dx-execution.json')));
const close=(actual,expected,tolerance=2e-6)=>{
  assert.equal(actual.length,expected.length);
  actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<=tolerance,`${i}: ${n} vs native ${expected[i]}`));
};
function channel(raw,width,tps,conjugate=false){
  const times=[],values=[];
  for(let i=0;i<raw.length;i+=width+1){times.push(raw[i]/tps);values.push(raw.slice(i+1,i+width+1).map((n,j)=>conjugate&&j<3?-n:n));}
  return {times,values};
}
function fixture(inputs){
  return createPoseLibrary({schemaVersion:1,frames:[{name:'Bip01',parent:null,nativeRowMatrix:compose([0,0,0],[1,1,1],[0,0,0,1])}],helpers:[],
    clips:inputs.map(row=>({name:row.name,nativePlaybackField:row.playback,tracks:[{frame_name:row.bone,
      translation:channel(row.translationTimeXYZ,3,row.ticksPerSecond),scale:channel(row.scaleTimeXYZ,3,row.ticksPerSecond),
      // Native RegisterAnimation inputs are raw row quaternions. The converter
      // already conjugates those into the column convention, once only.
      rotation:channel(row.rotationTimeXYZW,4,row.ticksPerSecond,true)}]}))});
}
function checkSrt(srt,row){
  close(srt.translation,row.translation,2e-5);close(srt.scale,row.scale);
  const q=srt.rotation.reduce((sum,n,i)=>sum+n*row.rotation[i],0)<0?srt.rotation.map(n=>-n):srt.rotation;
  close(q,row.rotation);if(row.matrix)close(compose(srt.translation,srt.scale,srt.rotation),row.matrix,2e-5);
}

test('actual shipped DLL preserves nonunit raw key endpoints and normalizes raw weighted output',()=>{
  const normalize=q=>{const length=Math.hypot(...q);return q.map(n=>n/length);};
  for(const row of fullNative.traces.filter(row=>row.label.startsWith('nonunit-quaternion-'))){
    const lib=fixture(row.inputs),raw=sampleLocalTransform(lib,row.inputs[0].name,row.track0.Position,'Bip01');
    close(raw.rotation,row.animationSetGetSRT.rotation);
    checkSrt({...raw,rotation:normalize(raw.rotation)},row);
  }
  for(const row of fullNative.traces.filter(row=>row.label.startsWith('nonunit-two-track-quarter-'))){
    const lib=fixture(row.inputs);
    checkSrt(sampleLocalTransform(lib,row.inputs[1].name,row.track1.Position,'Bip01',{
      transition:{clipName:row.inputs[0].name,timeSeconds:row.track0.Position,weight:.25}}),row);
  }
  const endpoint=fullNative.traces.find(row=>row.label==='nonunit-two-track-quarter-0');
  close(nativeQuaternionNlerp([0,0,0,1],[0,0,-.353553385,.353553385],.25),endpoint.rotation);
  assert.ok(Math.abs(endpoint.rotation[2]+.187365547)>.08,'per-input normalization measurably differs from original library');
});

test('actual RF render controller normalizes after raw source endpoint sampling',{
  skip:!existsSync(url('artifacts/rf/rf-runtime.glb'))},async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    const row=fullNative.traces.find(row=>row.label==='nonunit-quaternion-constant-0');
    const library=fixture(row.inputs),clip=library.clips.get(row.inputs[0].name);
    const source={schemaVersion:1,frames:library.frames,helpers:[],clips:[{...clip,name:'Wait',durationSeconds:10,tracks:[...clip.tracks.values()]}]};
    const view=createActorView(await loadPoseContainer(scene,url('artifacts/rf/rf-runtime.glb')),scene,'raw-q',.01,source);
    sampleAnimation(view,'Wait',0,false);
    close(view.bip01.rotationQuaternion.asArray(),row.rotation);
    close(sampleLocalTransform(createPoseLibrary(source),'Wait',0,'Bip01').rotation,row.animationSetGetSRT.rotation);
    assert.ok(Math.abs(view.bip01.rotationQuaternion.length()-1)<1e-12);
  }finally{scene.dispose();engine.dispose();}
});

test('shipped D3DX independent golden: both quaternion signs, partial weights, keyframe NLERP and rapid interrupt',()=>{
  assert.equal(native.dll.sha256,'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f');
  assert.equal(native.fullClientExecuted,false);
  for(const label of ['two-track-SRT-weights-.75-.25','weights-total-.5','non180-quaternion-quarter-sign-1',
    'partial-track-weights-sign-1','non180-quaternion-quarter-sign--1','partial-track-weights-sign--1']){
    const row=trace(label),lib=fixture(row.inputs),total=row.track0.Weight+row.track1.Weight;
    checkSrt(sampleLocalTransform(lib,row.inputs[1].name,row.track1.Position,'Bip01',{
      transition:{clipName:row.inputs[0].name,timeSeconds:row.track0.Position,weight:row.track1.Weight/total}}),row);
  }
  const keyframe=trace('within-keyframe-quarter-interpolation'),lib=fixture(keyframe.inputs);
  checkSrt(sampleLocalTransform(lib,keyframe.inputs[0].name,keyframe.animationSetGetSRT.position,'Bip01'),keyframe.animationSetGetSRT);
  // A->B->C really overwrites A. Carry B's raw .25 instead of inventing 1.
  const before=trace('rapid-before-interrupt'),row=trace('rapid-quarter-new-transition'),rapid=fixture(row.inputs);
  const sampled=sampleTransitionTrack({enabled:true,fromName:'B',fromTime:before.track1.Position,fromLoop:true,
    fromSpeed:before.track1.Speed,fromWeight:before.track1.Weight,durationSeconds:.1,elapsedSeconds:.025},()=>10);
  close([sampled.oldWeight,sampled.newWeight],[row.track1.Weight,row.track0.Weight]);
  close([sampled.timeSeconds],[row.track1.Position],1e-9);
  checkSrt(sampleLocalTransform(rapid,'C',row.track0.Position,'Bip01',{transition:sampled}),row);
  assert.ok(Math.abs(sampled.weight-4/7)<1e-12);
});

test('glTF animation adapter uses native quaternion interpolation, with no second axis conversion',()=>{
  const row=trace('within-keyframe-quarter-interpolation');
  const animation=new Animation('native rotation','rotationQuaternion',60,Animation.ANIMATIONTYPE_QUATERNION);
  animation.setKeys([{frame:0,value:new Quaternion(0,0,0,1)},
    {frame:600,value:new Quaternion(0,0,-Math.SQRT1_2,Math.SQRT1_2)}]);
  close(evaluateNativeAnimation(animation,2.5).asArray(),row.animationSetGetSRT.rotation);
  const slerp=animation.evaluate(150).asArray();
  assert.ok(Math.abs(slerp[2]-row.animationSetGetSRT.rotation[2])>.005,'Babylon SLERP is measurably different');
  assert.throws(()=>evaluateNativeAnimation(animation,NaN));
});

test('actual original Iron X supported channels agree with original DLL GetSRT; shear remains explicit',{
  skip:!existsSync(url('artifacts/rf/fx/meshes/Raven_Iron_Attack01.pose.json'))},t=>{
  const doc=JSON.parse(readFileSync(url('artifacts/rf/fx/meshes/Raven_Iron_Attack01.pose.json')));
  const row=trace('original-X-loader-Raven_Iron_Attack01.X'),animation=row.animations[0];
  assert.equal(animation.ticksPerSecond,4800);assert.equal(animation.channels.length,15);
  assert.equal(doc.clips[0].ticks_per_second,4800);
  const excluded=new Set(doc.unsupportedTracks?.map(x=>x.frame)??[]);
  // Audit supported channels independently. Do not erase an unsupported track
  // in production or pretend its bind matrix is the native animated result.
  if(excluded.size){assert.deepEqual([...excluded],['Nasod_Iron04']);assert.throws(()=>createPoseLibrary(doc),/unsupported/);}
  const library=createPoseLibrary({...doc,unsupportedTracks:[],
    clips:doc.clips.map(c=>({...c,tracks:c.tracks.filter(x=>!excluded.has(x.frame_name))}))});
  let comparisons=0,maxT=0,maxS=0,maxQ=0;
  for(const c of animation.channels){if(excluded.has(c.name))continue;for(const p of c.poses){
    const sampled=sampleLocalTransform(library,'Normal',p.timeSeconds,c.name);checkSrt(sampled,p);
    maxT=Math.max(maxT,...sampled.translation.map((n,i)=>Math.abs(n-p.translation[i])));
    maxS=Math.max(maxS,...sampled.scale.map((n,i)=>Math.abs(n-p.scale[i])));
    maxQ=Math.max(maxQ,Math.min(...[1,-1].map(sign=>Math.max(...sampled.rotation.map((n,i)=>Math.abs(n-sign*p.rotation[i]))))));comparisons++;
  }}
  assert.equal(comparisons,(15-excluded.size)*4);
  t.diagnostic(JSON.stringify({comparisons,maxT,maxS,maxQ,unsupported:[...excluded],evidence:'actual unmodified original X + shipped DLL GetSRT'}));
});

test('original DLL key extraction preserves all canonical key bytes and matches GetSRT including shear',{
  skip:!existsSync(url('artifacts/native-d3dx/keyframes.json'))},t=>{
  const bytes=readFileSync(url('artifacts/native-d3dx/keyframes.json')),data=JSON.parse(bytes);
  const manifest=JSON.parse(readFileSync(url('reports/rf-native-d3dx-keyframes.json')));
  const hash=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(bytes),manifest.artifact.sha256);assert.equal(bytes.length,manifest.artifact.bytes);
  assert.equal(data.dllSha256,native.dll.sha256);assert.equal(data.fullClientExecuted,false);
  assert.equal(data.sources[0].sourceSha256,'19c642c08554e16546fdee6a639152e8fd3df15d83f7b18ea8af2d2b446dfa4f');
  const original=trace('original-X-loader-Raven_Iron_Attack01.X');
  let groups=0,comparisons=0,maxT=0,maxS=0,maxQ=0;
  for(const animation of data.sources[0].animations)for(const c of animation.channels){
    const channels={};
    for(const [key,property,width] of [['scaleKeys','scale',4],['rotationKeys','rotation',5],['translationKeys','translation',4]]){
      const k=c[key],raw=Buffer.from(k.keyBytesBase64,'base64');
      assert.equal(k.stride,width);assert.equal(raw.length,k.count*width*4);assert.equal(hash(raw),k.keyBytesSha256);
      const gold=original.animations[animation.index].channels.find(row=>row.name===c.name);
      assert.equal(k.keyBytesSha256,gold[key].keyBytesSha256);
      const floats=Array.from({length:raw.length/4},(_,i)=>raw.readFloatLE(i*4));
      assert.ok(floats.every(Number.isFinite));
      channels[property]=channel(floats,width-1,animation.ticksPerSecond,property==='rotation');groups++;
    }
    const gold=original.animations[animation.index].channels.find(row=>row.name===c.name);
    for(const p of gold.poses){
      const srt={translation:sampleChannel(channels.translation,p.timeSeconds),scale:sampleChannel(channels.scale,p.timeSeconds),
        rotation:sampleChannel(channels.rotation,p.timeSeconds,true)};
      checkSrt(srt,p);maxT=Math.max(maxT,...srt.translation.map((n,i)=>Math.abs(n-p.translation[i])));
      maxS=Math.max(maxS,...srt.scale.map((n,i)=>Math.abs(n-p.scale[i])));
      maxQ=Math.max(maxQ,Math.min(...[1,-1].map(sign=>Math.max(...srt.rotation.map((n,i)=>Math.abs(n-sign*p.rotation[i]))))));comparisons++;
    }
  }
  assert.equal(groups,45);assert.equal(comparisons,60);
  t.diagnostic(JSON.stringify({groups,comparisons,maxT,maxS,maxQ,evidence:'full original DLL Get*Keys bytes versus independent GetSRT including Nasod_Iron04'}));
});

test('zero-total retained output and partial rapid transitions preserve display/shared helpers through hitstop',{
  skip:!existsSync(url('artifacts/rf/rf-runtime.glb'))},async()=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,10),scene);
  try{
    const source=JSON.parse(gunzipSync(readFileSync(url('artifacts/rf/pose-tracks.json.gz'))));
    const library=createPoseLibrary(source),view=createActorView(await loadPoseContainer(scene,url('artifacts/rf/rf-runtime.glb')),scene,'retained',.01,source);
    const samplers=createNativeSamplers({characterPose:source,effectIndex:{templates:{}},effectPoses:{},profile:{}}),audit=createPoseAudit(source);
    const period=n=>library.clips.get(n)?.durationSeconds;
    const old={animationName:'Dash',animationTime:.08,animationLoop:true,presentationTransition:{enabled:true,fromName:'Wait',fromTime:.2,fromLoop:true,
      fromSpeed:1,fromWeight:1,durationSeconds:.1,elapsedSeconds:.025}};
    const actor={id:'retained',x:17,y:120,z:37,facing:-1,...old};
    sampleAnimation(view,actor.animationName,actor.animationTime,true,actor.presentationTransition);placeActor(view,actor);scene.render();
    const names=['Bip01','Bip01_Head','TRACE_START0','TRACE_END0','ATTACK_SPHERE1_Lhand1'];
    const before=getActorNativePoints(view,names);
    const zero={...actor,animationName:'ComboZ1',animationTime:0,animationLoop:false,presentationTransition:{enabled:true,fromName:'Dash',
      fromTime:.08,fromLoop:true,fromSpeed:0,fromWeight:0,durationSeconds:.1,elapsedSeconds:0,retainedPose:old}};
    assert.equal(resolveControllerPose(zero,period).retained,true);
    assert.throws(()=>resolveControllerPose({...zero,presentationTransition:{...zero.presentationTransition,retainedPose:null}},period),/retained/);
    for(let i=0;i<5;i++){
      sampleAnimation(view,zero.animationName,zero.animationTime,false,zero.presentationTransition);placeActor(view,zero);scene.render();
      const after=getActorNativePoints(view,names);
      for(const name of names)close(after.get(name),before.get(name),.00001);
      assert.deepEqual(samplers.motionOffsetSampler(zero),{x:0,z:0});assert.ok(audit(view,zero).maximumErrorNative<.002);
      for(const shape of samplers.collisionSampler(zero,{raw:{}}))close(shape.center??shape.start,before.get(shape.source.helper)??getActorNativePoints(view,[shape.source.helper]).get(shape.source.helper),.002);
    }
    for(const e of [.025,.05,.099]){
      const rapid={...zero,animationTime:e*e/.2,presentationTransition:{...zero.presentationTransition,fromWeight:.25,fromSpeed:.25,elapsedSeconds:e}};
      sampleAnimation(view,rapid.animationName,rapid.animationTime,false,rapid.presentationTransition);placeActor(view,rapid);scene.render();
      const track=resolveControllerPose(rapid,period).transition;
      assert.ok(Math.abs(view.sample.transition.weight-track.weight)<1e-12);assert.ok(audit(view,rapid).maximumErrorNative<.002);
      for(const shape of samplers.collisionSampler(rapid,{raw:{}}))close(shape.center??shape.start,getActorNativePoints(view,[shape.source.helper]).get(shape.source.helper),.002);
    }
  }finally{scene.dispose();engine.dispose();}
});
