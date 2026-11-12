import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const name='SHADOW_BURSTER_DIE_CHECK',damageName='DAMAGE_EFFECT_SHADOW_BURSTER';
const declaration=JSON.parse(readFileSync(new URL('../../contracts/rf-shadow-mesh-source-v11.json',import.meta.url))).target.meshDeclarations[name];
test('production effectsView uses source clock/position and destroys crash main immediately',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('shadow-test-camera',new Vector3(0,0,10),scene);
  const notes=[],index={templates:{[name]:{...declaration,name,kind:'mesh',glb:null}}};
  const fixture={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({engine,scene,index,profile:fixture,samplers:{},onUnsupported:n=>notes.push(n)});
  try{const control={position:[100,200,0],velocity:[0,-1000,0],nowLifeTime:.125,animationTime:.0625};
    const state={actors:[{id:'rf',x:100,y:0,z:0,facing:1,stateSerial:1,hp:800000,awakening:{remaining:0}}],
      effects:[{id:91,sourceSkillMeshControl:true,currentAnchor:{position:control.position},sourceShadowMesh:control}]};
    view.event({type:'effectStarted',effectId:91,actorId:'rf',name:damageName,sourceShadowMesh:true,
      definition:{NAME:damageName},birthAnchor:{position:[100,300,0],facing:1}},state);
    assert.equal(view.count,1);view.step(1/60,state);assert.equal(view.count,1);
    // Core has already ended the main mesh on this exact packet. The adapter
    // must destroy it rather than merely stop future emission until .95s.
    state.effects=[];view.event({type:'effectEnded',effectId:91,reason:'template-land-crash'},state);
    assert.equal(view.count,0);view.step(.125,state);assert.equal(view.count,0);
    assert.ok(!notes.some(n=>n.id===name+':land'));
  }finally{view.clear();scene.dispose();engine.dispose();}
});
