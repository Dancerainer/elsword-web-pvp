import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));

test('real DamageImpactCore production upload applies the DWORD diffuse representation before its Star texture',async()=>{
  const source=read('contracts/rf-fx-index.json'),name='DamageImpactCore',template=source.templates[name];
  assert.equal(template.events.find(event=>event.property==='Color'&&!event.fade).value[3],100);
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('color-upload',new Vector3(0,0,10),scene);
  const profile={...read('packages/combat-core/rf-profile.json'),states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
  const view=await createEffectsView({engine,scene,index:{...source,templates:{[name]:template}},profile,samplers:{}});
  try{
    const state={actors:[{id:1,hp:800000,facing:1,awakening:{remaining:0}}],effects:[]};
    view.event({type:'effectStarted',effectId:1,actorId:1,name,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    view.step(1/60,state);view.render();
    const batch=scene.meshes.find(mesh=>mesh.name.startsWith('native-particle:'+name+'|'));
    assert.equal(batch.thinInstanceCount,1);
    assert.deepEqual(Array.from(batch._userThinInstanceBuffersStorage.data.fxColor.slice(0,4)),[1,1,1,1]);
    assert.equal(view.performance().fxClampedVertexColors,1);
    assert.equal(view.performance().fxQuadBatches,1);
    assert.equal(view.proof().nativeQuadVertexColor,'DWORD-saturated-8bit-before-texture-modulation');
    for(let i=0;i<30;i++){view.step(1/60,state);view.render();}
    view.clear();assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});
