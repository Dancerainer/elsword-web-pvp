import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createPoseLibrary,samplePose,resolveControllerPose,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));

test('full keyboard air follow-ups preserve original source poses through mirrored dash cancellation and root transfer',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,10),scene);const containers=[];let view;
  t.after(()=>{view?.dispose();for(const c of containers)c.dispose();scene.dispose();engine.dispose();});
  const manifest=read('artifacts/vc/manifest.json');
  const source=JSON.parse(gunzipSync(readFileSync(resolve(root,'artifacts/vc/source-proof/pose-tracks.json.gz'))));
  const library=createPoseLibrary(source);
  const body=await loadPoseContainer(scene,resolve(root,'artifacts/vc/vc-runtime.glb'));containers.push(body);
  const rf=await loadPoseContainer(scene,resolve(root,'artifacts/rf/rf-runtime.glb'));containers.push(rf);
  installSharedCharacterAnimations(body,rf,manifest.sharedCharacterAnimations.clips);
  view=createActorView(body,scene,'vc-air-followup-v4',.01,source);
  // The report supplies only human-key events here, never expected coordinates.
  // Geometry expectations always come from independent full original key data.
  const traces=read('reports/vc-air-motion-validation-v4.json').cases.filter(c=>['same-zxx','reverse-xx'].includes(c.follow));
  const bones=['Bip01','Bip01_Head','Bip01_L_Forearm','Bip01_L_Hand','Dummy2_Lhand'];
  let frames=0,points=0,maxError=0,cancels=0;
  for(const trace of traces){
    const {sim,a}=vcFixture({position:[trace.initial.x,trace.initial.y,0],facing:trace.facing,gap:2500});
    const input=createInputBuffer({sampledLevels:true});
    for(let frame=1;frame<=175;frame++){
      for(const e of trace.inputs.filter(e=>e.frame===frame))input[e.down?'down':'up'](e.key,sim.state.time+.001);
      sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});
      cancels+=sim.drainEvents().filter(e=>e.type==='stateChanged'&&e.reason==='user-target2016-vc-air-followup').length;
      sampleAnimation(view,a.animationName,a.animationTime,a.animationLoop,a.presentationTransition);placeActor(view,a);scene.render();
      const pose=resolveControllerPose(a,n=>library.clips.get(n)?.durationSeconds,n=>library.clips.get(n)?.nativePlaybackField);
      const expected=samplePose(library,pose.clipName,pose.timeSeconds,{transition:pose.transition,rootTranslationOverride:[0,null,0],
        worldMatrix:compose([a.x,a.y,a.z],[1,1,1],a.facing<0?[0,1,0,0]:[0,0,0,1])});
      const displayed=getActorNativePoints(view,bones);
      for(const name of bones){
        const wanted=transform(expected.get(name),[0,0,0]),actual=displayed.get(name);assert.ok(actual,name);
        const error=Math.max(...actual.map((v,i)=>Math.abs(v-wanted[i])));maxError=Math.max(maxError,error);points++;
        assert.ok(error<.003,`${trace.mode}/${trace.follow}/${frame}/${a.state}/${name}: ${error}`);
      }
      frames++;
    }
  }
  assert.equal(cancels,8);assert.equal(view.missing.size,0);
  t.diagnostic(JSON.stringify({frames,points,maxError,evidenceClass:'original converted keys versus rendered CPU bones; not native-client timing or real-time feel'}));
});
