import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createPoseLibrary,samplePose,resolveControllerPose,compose,transform} from '../../tools/assets/character/sample_pose.mjs';

const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));
test('every rendered frame of sampled 668ZXX/668XXXX keeps original VC keys, motion and mirrored hand positions',async t=>{
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
 new FreeCamera('camera',new Vector3(0,0,10),scene);
 const containers=[];let view;
 t.after(()=>{view?.dispose();for(const c of containers)c.dispose();scene.dispose();engine.dispose();});
 const manifest=read('artifacts/vc/manifest.json');
 const source=JSON.parse(gunzipSync(readFileSync(resolve(root,'artifacts/vc/source-proof/pose-tracks.json.gz'))));
 const library=createPoseLibrary(source);
 const body=await loadPoseContainer(scene,resolve(root,'artifacts/vc/vc-runtime.glb'));containers.push(body);
 const rf=await loadPoseContainer(scene,resolve(root,'artifacts/rf/rf-runtime.glb'));containers.push(rf);
 installSharedCharacterAnimations(body,rf,manifest.sharedCharacterAnimations.clips);
 view=createActorView(body,scene,'vc-air-frames',.01,source);
 const bones=['Bip01','Bip01_Head','Bip01_L_Forearm','Bip01_L_Hand','Dummy2_Lhand'];
 let frames=0,points=0,maxError=0;const visited=new Set();
 for(const facing of[-1,1])for(const mode of['zxx','xxxx']){
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const input=createInputBuffer({sampledLevels:true}),direction=facing>0?'RIGHT':'LEFT';
  for(let i=0;i<155;i++){
   const time=sim.state.time+.001;
   if(i===0||i===2)input.down(direction,time);if(i===1||i===10)input.up(direction,time);
   if(i===3)input.down('UP',time);if(i===4)input.up('UP',time);
   for(const [at,key]of mode==='zxx'?[[10,'Z'],[20,'X'],[30,'X']]:[[10,'X'],[20,'X'],[40,'X'],[70,'X']]){
    if(i===at)input.down(key,time);if(i===at+1)input.up(key,time);
   }
   sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});sim.drainEvents();
   sampleAnimation(view,a.animationName,a.animationTime,a.animationLoop,a.presentationTransition);placeActor(view,a);scene.render();
   const pose=resolveControllerPose(a,name=>library.clips.get(name)?.durationSeconds,name=>library.clips.get(name)?.nativePlaybackField);
   const expected=samplePose(library,pose.clipName,pose.timeSeconds,{transition:pose.transition,rootTranslationOverride:[0,null,0],
    worldMatrix:compose([a.x,a.y,a.z],[1,1,1],a.facing<0?[0,1,0,0]:[0,0,0,1])});
   const displayed=getActorNativePoints(view,bones);
   for(const name of bones){
    const point=transform(expected.get(name),[0,0,0]),actual=displayed.get(name);assert.ok(actual,name);
    const error=Math.max(...actual.map((v,index)=>Math.abs(v-point[index])));maxError=Math.max(maxError,error);points++;
    assert.ok(error<.003,`${mode}/${a.state}/${a.animationTime}/${name}: ${error}`);
   }
   if(a.state.includes('DASH_JUMP_COMBO')){
    visited.add(a.state);
    assert.equal(a.presentationTransition.enabled,false,'target TRANSITION=0 is preserved, not smoothed by invented blending');
    const raw=vcProfile.states[a.state].raw;
    const speed=(raw.ANIM_SPEED??1)*(raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY===0?1:a.stats.animationSpeedMultiplier);
    assert.equal(a.animationPlaybackSpeed,speed,'same authored/gated clock drives controls and renderer');
   }
   frames++;
  }
 }
 for(const state of['RSI_DASH_JUMP_COMBO_Z','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',
  'RSI_DASH_JUMP_COMBO_X','RVC_DASH_JUMP_COMBO_XX_START','RVC_DASH_JUMP_COMBO_XX_LOOP','RVC_DASH_JUMP_COMBO_XX_FINISH'])assert.ok(visited.has(state),state);
 assert.equal(view.missing.size,0);
 t.diagnostic(JSON.stringify({frames,points,maxError,evidenceClass:'original converted keys vs rendered CPU transforms; not client/GPU timing'}));
});
