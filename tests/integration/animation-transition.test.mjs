import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { NullEngine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import { loadPoseContainer } from '../helpers/babylon-assets.mjs';
import { createActorView, sampleAnimation, placeActor, transitionSample, getActorNativePoints } from '../../apps/web/actor-presentation.mjs';
import { createPoseLibrary, sampleChannel, samplePose, sampleLocalTransform, sampleTransitionTrack, mapClipTime, compose, transform } from '../../tools/assets/character/sample_pose.mjs';
import { createNativeSamplers } from '../../packages/combat-assets/index.mjs';
import { createPoseAudit } from '../../apps/web/pose-audit.mjs';
import { createSkinAudit } from '../helpers/skin-audit.mjs';
import { readGlb } from '../helpers/babylon-assets.mjs';

const url = value => new URL('../../' + value, import.meta.url);
const available = existsSync(url('artifacts/rf/rf-runtime.glb'));

test('native-reference track transition uses old period/speed, freezes clock, and rejects unknown clocks', () => {
  const clip = { from:0,to:60,targetedAnimations:[{animation:{framePerSecond:60}}] };
  const view = {clips:new Map([['Dash',clip]]),sourceDurations:new Map([['Dash',1]])};
  const input = {enabled:true,fromName:'Dash',fromTime:.9,fromLoop:true,fromSpeed:2,durationSeconds:.05,elapsedSeconds:.025};
  const sampled = transitionSample(view,input);
  assert.equal(sampled.weight,.5);
  assert.ok(Math.abs(sampled.oldSeconds-.9375)<1e-12);
  assert.deepEqual(transitionSample(view,input),sampled,'same frozen simulation clock produces same sample');
  assert.equal(transitionSample(view,{...input,elapsedSeconds:.05}),null);
  assert.equal(transitionSample(view,{...input,enabled:false}),null);
  assert.throws(()=>transitionSample(view,{...input,durationSeconds:NaN}));
  assert.throws(()=>transitionSample(view,{...input,fromName:'unknown'}));
  // The binary asset says D3DXPLAY_LOOP even when User state says XAP_ONE_WAIT.
  const oneWait={...input,fromLoop:false,fromTime:1.1};
  assert.ok(Math.abs(sampleTransitionTrack(oneWait,()=>1,()=>0).timeSeconds-.1375)<1e-12);
  assert.equal(mapClipTime(1.5,1,false,1),1);
  assert.equal(mapClipTime(1.5,1,false,2),.5);
  assert.throws(()=>mapClipTime(.5,1,false,3),/Unsupported/);
});

test('loop restarts preserve original vertical motion and display/helpers/root extraction use one pose', {skip:!available},async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,10),scene);
  try{
    const source=JSON.parse(gunzipSync(readFileSync(url('artifacts/rf/pose-tracks.json.gz'))));
    const library=createPoseLibrary(source),runtime=JSON.parse(readFileSync(url('artifacts/rf/runtime-pose.json')));
    const samplers=createNativeSamplers({characterPose:runtime,effectIndex:{templates:{}},effectPoses:{},profile:{}});
    const view=createActorView(await loadPoseContainer(scene,url('artifacts/rf/rf-runtime.glb')),scene,'cycle',.01,source);
    const audit=createPoseAudit(source),skinAudit=createSkinAudit(source,readGlb(url('artifacts/rf/rf-runtime.glb')));
    const names=['Bip01','Bip01_Head','TRACE_START0','TRACE_END0','ATTACK_SPHERE1_Lhand1','Bip01_L_Hand'];
    let frames=0,endpoints=0,vertices=0,maxError=0,maxSkinError=0;
    for(const name of ['Walk','Dash']){
      const clip=library.clips.get(name),period=clip.durationSeconds,D=Math.max(period/10,.03);
      // Actual old keys retain their authored bob; they are not flattened to
      // make a smoother screenshot. Dash spans 17.675 native Y units.
      const ys=clip.tracks.get('Bip01').translation.values.map(p=>p[1]);
      assert.ok(Math.max(...ys)-Math.min(...ys)>7,'source vertical keys must survive');
      for(let cycle=0;cycle<3;cycle++)for(const e of [0,D*.125,D*.5,D*.999,D,D+1/60]){
        const fromTime=period-D+1/60,newTime=e<D?e*e/(2*D):e-D/2;
        const tr={enabled:true,serial:cycle,fromName:name,fromTime,fromLoop:true,fromSpeed:1,durationSeconds:D,elapsedSeconds:e};
        const actor={id:'cycle',animationName:name,animationTime:newTime,animationLoop:true,
          x:100+cycle*50,y:200,z:37,facing:cycle%2?-1:1,applyMotionOffset:false,presentationTransition:tr};
        sampleAnimation(view,name,newTime,true,tr);placeActor(view,actor);scene.render();
        const blend=e<D?{clipName:name,timeSeconds:(fromTime+e-e*e/(2*D))%period,weight:e/D}:null;
        const root=sampleChannel(clip.tracks.get('Bip01').translation,newTime);
        if(blend){const old=sampleChannel(clip.tracks.get('Bip01').translation,blend.timeSeconds);for(let axis=0;axis<3;axis++)root[axis]=old[axis]+(root[axis]-old[axis])*blend.weight;}
        assert.ok(Math.abs(view.bip01.position.y-root[1])<.001,'consume only X/Z, preserve source blended Y');
        assert.equal(view.bip01.position.x,0);assert.equal(view.bip01.position.z,0,'physics gate false does not keep root Z');
        const extracted=samplers.motionOffsetSampler(actor);
        assert.ok(Math.abs(extracted.x-root[0])<1e-10);assert.ok(Math.abs(extracted.z-root[2])<1e-10);
        const expected=samplePose(library,name,newTime,{transition:blend,rootTranslationOverride:[0,null,0],
          worldMatrix:compose([actor.x,actor.y,actor.z],[1,1,1],actor.facing<0?[0,1,0,0]:[0,0,0,1])});
        const displayed=getActorNativePoints(view,[...names,'missing-source-bone']);
        assert.equal(displayed.has('missing-source-bone'),false);
        for(const boneName of names){
          const point=transform(expected.get(boneName),[0,0,0]),actual=displayed.get(boneName);assert.ok(actual,boneName);
          maxError=Math.max(maxError,...actual.map((n,i)=>Math.abs(n-point[i])));endpoints++;
        }
        for(const shape of samplers.collisionSampler(actor,{raw:{}})){
          const point=transform(expected.get(shape.source.helper),[0,0,0]);
          (shape.center??shape.start).forEach((n,i)=>assert.ok(Math.abs(n-point[i])<1e-8));
        }
        assert.ok(audit(view,actor).maximumErrorNative<.002);
        const skin=skinAudit(view,actor);maxSkinError=Math.max(maxSkinError,skin.maximumErrorNative);vertices+=skin.vertices;
        // Repeated frozen ticks and a same-clip loop restart cannot flash bind.
        const frozen=displayed.get('Bip01_Head');
        for(let hold=0;hold<3;hold++){sampleAnimation(view,name,newTime,true,tr);placeActor(view,actor);scene.render();assert.deepEqual(getActorNativePoints(view,['Bip01_Head']).get('Bip01_Head'),frozen);}
        frames++;
      }
    }
    // Reproduce the former no-period helper path with the outgoing track just
    // past the last source key. The displayed track wraps, not clamps.
    const period=library.clips.get('Dash').durationSeconds,tr={enabled:true,fromName:'Dash',fromTime:period-.005,fromLoop:true,fromSpeed:1,durationSeconds:.1,elapsedSeconds:.04};
    const actor={id:'cross-period',animationName:'ComboZ1',animationTime:.12,animationLoop:false,x:0,y:0,z:0,facing:1,presentationTransition:tr};
    sampleAnimation(view,actor.animationName,actor.animationTime,false,tr);placeActor(view,actor);scene.render();
    const displayed=getActorNativePoints(view,['Dummy2_Lhand']).get('Dummy2_Lhand'),helper=samplers.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},actor).position;
    helper.forEach((n,i)=>assert.ok(Math.abs(n-displayed[i])<.002,'renderer and collision must wrap the same original period'));
    assert.ok(maxError<.002);assert.ok(maxSkinError<.003);
    t.diagnostic(JSON.stringify({frames,endpoints,vertices,maxError,maxSkinError,evidence:'original key interpolation/display contract; native2016 runtime unmeasured'}));
  }finally{scene.dispose();engine.dispose();}
});

test('root extraction is independent from APPLY_ANIM_MOVE and raw frozen inspection restores original root', {skip:!available},async()=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,10),scene);
  try{
    const source=JSON.parse(gunzipSync(readFileSync(url('artifacts/rf/pose-tracks.json.gz')))),library=createPoseLibrary(source);
    const view=createActorView(await loadPoseContainer(scene,url('artifacts/rf/rf-runtime.glb')),scene,'root-extract',.01,source);
    const root=sampleLocalTransform(library,'ComboZ1',.23,'Bip01').translation;
    const base={x:0,y:0,z:0,facing:1,applyMotionOffset:false};
    sampleAnimation(view,'ComboZ1',.23);placeActor(view,base);scene.render();
    assert.equal(view.bip01.position.x,0);assert.equal(view.bip01.position.z,0);
    for(let i=0;i<4;i++){
      sampleAnimation(view,'ComboZ1',.23);placeActor(view,{...base,consumeRootTranslation:false});scene.render();
      assert.ok(view.bip01.position.equalsWithEpsilon(new Vector3(root[0],root[1],-root[2]),.001));
      sampleAnimation(view,'ComboZ1',.23);placeActor(view,base);scene.render();
      assert.equal(view.bip01.position.x,0);assert.equal(view.bip01.position.z,0);
    }
    const identity={...base,x:17,y:100,z:20};
    sampleAnimation(view,'ComboZ1',.23);placeActor(view,identity);
    const before=getActorNativePoints(view,['TRACE_START0']).get('TRACE_START0');
    placeActor(view,{...identity,x:217,y:130,z:57});
    const moved=getActorNativePoints(view,['TRACE_START0']).get('TRACE_START0');
    [200,30,37].forEach((delta,i)=>assert.ok(Math.abs(moved[i]-before[i]-delta)<.001,'this frame placement must refresh before render'));
    placeActor(view,{...identity,facing:-1});
    const turned=getActorNativePoints(view,['TRACE_START0']).get('TRACE_START0');
    assert.ok(Math.abs(turned[0]+before[0]-2*identity.x)<.001);
    assert.ok(Math.abs(turned[2]+before[2]-2*identity.z)<.001,'this frame facing must refresh before render');
    scene.render();
    assert.deepEqual(getActorNativePoints(view,['TRACE_START0']).get('TRACE_START0'),turned);
    assert.throws(()=>samplePose(library,'Dash',0,{transition:{clipName:'Walk',timeSeconds:0,weight:NaN}}),/previous animation/);
    assert.throws(()=>samplePose(library,'Dash',0,{transition:{clipName:'Walk',timeSeconds:0,weight:1.1}}),/previous animation/);
    assert.throws(()=>getActorNativePoints(view,['Bip01'],0),/scale/);
  }finally{scene.dispose();engine.dispose();}
});

test('actual RF old/new local tracks blend after render without bind flashes or hitstop drift', {skip:!available},async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;
  scene.skipFrustumClipping=true;new FreeCamera('camera',new Vector3(0,0,10),scene);
  try{
    const source=JSON.parse(gunzipSync(readFileSync(url('artifacts/rf/pose-tracks.json.gz'))));
    const library=createPoseLibrary(source),container=await loadPoseContainer(scene,url('artifacts/rf/rf-runtime.glb'));
    const view=createActorView(container,scene,'blend',.01,source);
    const nodes=new Map(view.root.getDescendants().map(node=>[node.name.slice('blend_'.length),node]));
    let comparisons=0,maxTranslationError=0,maxQuaternionError=0;
    for(const [fromName,name,fromTime,fromLoop] of [['Dash','Dash',.65,true],['Wait','Dash',.2,true],['ComboZ1','ComboZ2',.32,false]]){
      const oldClip=library.clips.get(fromName),newClip=library.clips.get(name),D=.1;
      for(const fraction of [0,.25,.5,.9]){
        const elapsed=D*fraction,oldTrackTime=fromTime+elapsed-elapsed*elapsed/(2*D),newTime=.08*fraction;
        const oldPeriod=Math.max(...[...oldClip.tracks.values()].flatMap(track=>['rotation','translation','scale'].map(k=>track[k].times.at(-1))));
        const oldTime=fromLoop?oldTrackTime%oldPeriod:Math.min(oldTrackTime,oldPeriod);
        const transition={enabled:true,serial:comparisons,fromName,fromTime,fromLoop,fromSpeed:1,durationSeconds:D,elapsedSeconds:elapsed};
        sampleAnimation(view,name,newTime,true,transition);placeActor(view,{x:0,y:0,z:0,facing:1,applyMotionOffset:false,consumeRootTranslation:false});scene.render();
        for(const [frameName,newTrack] of newClip.tracks){
          const oldTrack=oldClip.tracks.get(frameName),node=nodes.get(frameName);
          if(!oldTrack||!node)continue;
          const left=sampleChannel(oldTrack.translation,oldTime),right=sampleChannel(newTrack.translation,newTime);
          const expected=left.map((x,i)=>(x+(right[i]-x)*fraction)*(i===2?-1:1));
          maxTranslationError=Math.max(maxTranslationError,...expected.map((x,i)=>Math.abs(x-node.position.asArray()[i])));
          const qa=sampleChannel(oldTrack.rotation,oldTime,true),qb=sampleChannel(newTrack.rotation,newTime,true);
          const q=sampleChannel({times:[0,1],values:[qa,qb]},fraction,true).map((x,i)=>i<2?-x:x);
          const actual=node.rotationQuaternion.asArray();
          maxQuaternionError=Math.max(maxQuaternionError,1-Math.abs(q.reduce((n,x,i)=>n+x*actual[i],0)));
          comparisons++;
        }
        const frozen=view.bip01.position.clone();
        for(let i=0;i<6;i++){sampleAnimation(view,name,newTime,true,transition);scene.render();assert.deepEqual(view.bip01.position.asArray(),frozen.asArray());}
      }
      sampleAnimation(view,name,.18,true);scene.render();
      const position=sampleChannel(newClip.tracks.get('Bip01').translation,.18);
      assert.ok(view.bip01.position.equalsWithEpsilon(new Vector3(position[0],position[1],-position[2]),.001),'ending blend restores unmodified new clip');
    }
    assert.ok(maxTranslationError<.001,`translation ${maxTranslationError}`);
    assert.ok(maxQuaternionError<1e-6,`quaternion ${maxQuaternionError}`);
    t.diagnostic(JSON.stringify({comparisons,maxTranslationError,maxQuaternionError,evidence:'source2016 keys + V5 reference weight schedule; target-native blending unmeasured'}));
  }finally{scene.dispose();engine.dispose();}
});
