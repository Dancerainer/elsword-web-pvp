import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';

test('repeated actual ADD ToKang zero-rate world births leave no empty parent or sequence',async t=>{
  const original=getProfessionProfile('LP'),name='ADD_STR_ToKang',template=original.effectTemplates[name];
  assert.equal(template.fields.Emitrate,undefined);
  const profile={...original,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('empty-sequence',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index:{templates:{[name]:template}},profile,samplers:{}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const state={actors:[{id:'add',professionId:'LP',hp:100,x:0,y:0,z:0,facing:1,sourceAdd:{formation:false},awakening:{remaining:0}}],effects:[]};
  for(let id=1;id<=1000;id++){
    view.event({type:'effectStarted',actorId:'add',effectId:id,name,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    view.step(1/60,state);
  }
  view.render();assert.equal(view.performance().fxActiveParents,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.count,0);
  assert.equal(view.hasPendingWork(),false);
  // Zero-rate templates still support explicit UI/direct creation elsewhere.
  const runtime=createEffectRuntime({index:{templates:{[name]:template}}});
  assert.ok(runtime.emitParticle(name,{position:[0,0,0]}));assert.equal(runtime.count,1);
});
