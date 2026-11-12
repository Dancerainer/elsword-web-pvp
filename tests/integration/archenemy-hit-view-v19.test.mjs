import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,SceneLoader,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
import {instantiateNativeEffectRandom} from '../../packages/native-source/effect-random.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {makeChain,inputTimeline,read,project,profile,samplers,poses,impactIndex,audioManifest} from '../helpers/archenemy-v19-fixture.mjs';
// Same complete visual-index merge as game.mjs, including unrelated skill,
// awakening and command declarations. A reduced impact-only index can hide
// duplicate declaration conflicts and is insufficient publication evidence.
const index=mergeVisualEffectIndexes(...['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx',
  'core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'].map(p=>read('artifacts/rf/'+p+'/index.json')));
const fullPoses={...poses,...Object.fromEntries(collectEffectPoseFiles(index).map(f=>[f,read('artifacts/rf/'+f)]))};

for(const facing of [-1,1])for(const hyper of [false,true])test(`full source Start/Waiting/flight/independent hit-FX/audio closure ${facing}/${hyper?'Hyper':'normal'}`,async()=>{
  const loader=SceneLoader.LoadAssetContainerAsync;
  SceneLoader.LoadAssetContainerAsync=async(root,file,scene)=>loadPoseContainer(scene,resolve(project,'artifacts/rf',file));
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('arc-hit-camera',new Vector3(0,0,10),scene);
  const played=[];
  const audio=createBattleAudio({createAudio:url=>({volume:0,currentTime:0,onended:null,onerror:null,pause(){},play(){played.push(url);return Promise.resolve();}})});
  audio.configure({manifest:audioManifest});audio.setEnabled(true);
  try{
    const nativeRandom=await instantiateNativeEffectRandom(readFileSync(resolve(project,'artifacts/native/effect-random.wasm')));
    const view=await createEffectsView({scene,engine,index,profile,samplers,effectPoses:fullPoses,loadout:[{skillId:24008}],nativeRandom});
    const s=await makeChain({facing,hyper});let cursor=0,hitCount=0,hitId,independentAfterDeath=false;
    const visible=new Set();
    for(const frame of inputTimeline({facing,hyper})){
      s.step(frame.dt,frame.input,{snapshot:false});
      const events=s.state.events.slice(cursor);cursor=s.state.events.length;
      for(const e of events){view.event(e,s.state);if(e.type==='sound')audio.play(e.name);
        if(e.type==='hit'&&e.origin.skillId===24008){hitCount++;hitId=e.origin.id;}}
      view.step(frame.dt,s.state);view.render();
      for(const mesh of scene.meshes)if(mesh.name.startsWith('native-particle:')&&mesh.thinInstanceCount>0){
        const name=mesh.name.slice('native-particle:'.length).split('|')[0];if(impactIndex.templates[name]){
          visible.add(name);if(hitId&&!s.state.effects.some(e=>e.id===hitId))independentAfterDeath=true;
        }
      }
    }
    assert.equal(hitCount,1);assert.equal(independentAfterDeath,true,'impact remains independently visible after one-hit spear retirement');
    for(const name of ['FireDamageImpactCoreRed','FireDamageImpactRingRed','FireDamageImpactSlashRed'])assert.ok(visible.has(name),name);
    assert.equal(visible.has('Wally8thMissileExplosion'),hyper,'normal source does not invent Hyper explosion');
    assert.equal(visible.has('FireDamageImpactRed'),hyper);
    assert.ok(played.includes('/assets/audio/Raven_OT_SP2_FlyingImpact3.ogg'));
    assert.ok(played.includes('/assets/audio/HitSlash.wav'));
    assert.equal(s.actor('rf').sourceArcEnemy.data.length,3,'one accepted hit retires one of the four source waiting javelins');
    s.actor('rf').hp=0;
    for(let i=0;i<240;i++){
      s.step(1/60,{}, {snapshot:false});for(const e of s.state.events.slice(cursor))view.event(e,s.state);cursor=s.state.events.length;
      view.step(1/60,s.state);view.render();
    }
    assert.equal(view.proof().activeEffectParents,0);
    view.clear();audio.stop();
  }finally{scene.dispose();engine.dispose();SceneLoader.LoadAssetContainerAsync=loader;}
});
