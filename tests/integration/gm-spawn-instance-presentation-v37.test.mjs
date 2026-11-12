/** Actual keyboard 66XX -> source WASM -> original spwan_Dummy mesh ->
 * production particle presentation. NullEngine is not target GPU evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createPoseLibrary,samplePose,compose,mapClipTime} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';
import {GM_SPAWN_EFFECT,GM_SPAWN_TEMPLATE} from '../../packages/combat-core/gm-sword-spawn-instance.mjs';

const near=(a,b,label)=>{assert.equal(a.length,b.length,label);a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<.002,`${label} component ${i}: ${n} != ${b[i]}`));};
for(const facing of [-1,1])test(`GM actual 66XX ${facing}: shared source spin drives real child births and rendered swords fall vertically`,async t=>{
 const f=elesisFixture('GM',{facing,gap:10000}),{sim,a,profile}=f,{samplers,effectIndex,effectPoses}=elesisAssets('GM'),
  sword='DamageEffect_SGM_Dash_Combo_XX_LOOP',template=profile.effectTemplates[GM_SPAWN_TEMPLATE],
  library=createPoseLibrary(effectPoses[template.poseData]),clip=library.clips.get('Normal'),
  selected=[GM_SPAWN_TEMPLATE,'SGM_Dash_Combo_XX_LOOP'],index={templates:Object.fromEntries(selected.map(n=>[n,effectIndex.templates[n]]))};
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('gm-shared-source-instance',new Vector3(0,0,10),scene);
 const assetRoot=resolve(process.env.ELESIS_ASSET_ROOT??resolve(import.meta.dirname,'../../artifacts'));
 const view=await createEffectsView({scene,engine,index,effectPoses,samplers,profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/gm/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assetRoot,'gm',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const keyboard=createInputBuffer({sampledLevels:true}),parents=new Set();let births=0,sharedFrames=0,visibleFrames=0;
 function frame(){
  const dt=1/60,input=keyboard.consume(sim.state.time+dt,dt);sim.step(dt,{[a.id]:input},{snapshot:false});
  for(const event of sim.drainEvents()){
   if(event.type==='effectStarted'&&[GM_SPAWN_EFFECT,sword].includes(event.name)){parents.add(event.effectId);view.event(event,sim.state);}
   else if(event.type==='effectEnded'&&parents.has(event.effectId))view.event(event,sim.state);
   if(event.type==='damageChildCreated'&&event.name===sword){
    const parent=sim.state.effects.find(e=>e.id===event.parentEffectId),definition=parent.damage[event.field],state=parent.sourceGMSpawnRotation,
     time=parent.meshLifetimeElapsed,ratio=Math.max(0,Math.min(1,(time-.01)/1.99)),yaw=state.initialYaw+(state.endYaw-state.initialYaw)*ratio,
     anchor=parent.sourcePosedAnchor??parent.currentAnchor??parent.birthAnchor,
     world=compose(anchor.position,[.5,.5,.5],nativeEffectQuaternion([0,(anchor.rotation?.[1]??0)+yaw,0])),
     phase=mapClipTime(parent.animationTime,clip.durationSeconds,true,clip.nativePlaybackField),
     expected=samplePose(library,'Normal',phase,{worldMatrix:world}).get(definition.BONE_NAME);
    assert.ok(expected,'authored spwan_Dummy02..10 exists in the original pose');near(event.position,expected.slice(12,15),'source original matrix child birth');births++;
   }
  }
  view.step(1/60,sim.state);view.render({actors:sim.state.actors});
  for(const row of view.sourceMeshClocks().filter(row=>row.name===GM_SPAWN_TEMPLATE)){
   const parent=sim.state.effects.find(e=>e.id===row.effectId);if(!parent)continue;
   const state=parent.sourceGMSpawnRotation,ratio=Math.max(0,Math.min(1,(parent.meshLifetimeElapsed-.01)/1.99)),
    expected=state.initialYaw+(state.endYaw-state.initialYaw)*ratio;
   near(row.localRotation,[0,expected,0],'presentation consumes the same resolved endpoint instance');
   assert.equal(row.globalTime,parent.meshLifetimeElapsed);sharedFrames++;
  }
  const swords=scene.transformNodes.filter(n=>n.name.startsWith('fx-SGM_Dash_Combo_XX_LOOP-')&&n.name.endsWith('-world')&&n.isEnabled());
  for(const node of swords){const matrix=node.computeWorldMatrix(true).asArray();
   assert.ok(Math.abs(matrix[0])<1e-6&&matrix[1]<0,'rendered sword local +X points downward after one original -90 roll');visibleFrames++;
  }
 }
 const down=k=>keyboard.down(k,sim.state.time+.001),up=k=>keyboard.up(k,sim.state.time+.001),tap=k=>{down(k);frame();up(k);frame();},
  wait=(condition,n)=>{for(let i=0;i<n&&!condition();i++)frame();assert.ok(condition(),a.state+' @ '+a.animationTime);};
 frame();frame();const forward=facing>0?'RIGHT':'LEFT';tap(forward);down(forward);frame();
 wait(()=>/DASH$/.test(profile.states[a.state].sourceState??a.state),30);tap('X');tap('X');
 wait(()=>(profile.states[a.state].sourceState??a.state)==='ESI_DASH_COMBO_SGM_XX_ATTACK',120);
 up(forward);frame();for(let i=0;i<240;i++)frame();
 assert.ok(births>=4,'actual 66XX emits several original spawn-node children');assert.ok(sharedFrames>10);assert.ok(visibleFrames>5);
 assert.equal(sim.state.effects.some(e=>e.name===GM_SPAWN_EFFECT||e.name===sword),false,'source lifetimes reclaim generator and swords');
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
});
