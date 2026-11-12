/** Actual source assets through the renderer. These checks do not execute the
 * target client's Quicksilver callback or establish full gameplay parity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial,PBRMaterial} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createPoseLibrary,samplePose} from '../../tools/assets/character/sample_pose.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectRenderState} from '../../apps/web/effect-render-anchors.mjs';
import {ADD_QUICKSILVER_LINK,addQuicksilverLinkEvents,updateAddQuicksilverLink} from '../../packages/combat-core/add-quicksilver-link.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..');
const json=path=>JSON.parse(readFileSync(resolve(root,path)));
const name='ADD_PYLON_DYNAMO_SPARK01_MAIN';
const index=json('artifacts/lp/fx/index.json'),template=index.templates[name];
const manifest=json('artifacts/lp/manifest.json');
const near=(actual,expected,tolerance=1e-5)=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<tolerance,`${actual} != ${expected}`));

test('both Quicksilver original actions contain the actual left-finger and root endpoint tracks',()=>{
  const library=createPoseLibrary(json('artifacts/lp/'+manifest.runtimePose));
  for(const animation of ['SI_SA_ALP_QUICKSILVER_ACCEL','SI_SA_ALP_QUICKSILVER_ACCEL_BACK']){
    assert.ok(library.clips.has(animation));
    const points=[.01,.25,.55].map(time=>{
      const matrices=samplePose(library,animation,time,{rootTranslationOverride:[0,null,0]});
      const hand=matrices.get('Bip01_L_Finger2')?.slice(12,15),body=matrices.get('Bip01')?.slice(12,15);
      assert.ok(hand?.every(Number.isFinite));assert.ok(body?.every(Number.isFinite));
      assert.ok(Math.hypot(...hand.map((v,i)=>v-body[i]))>1);
      return hand;
    });
    assert.ok(Math.hypot(...points[0].map((v,i)=>v-points[2][i]))>1,'hand must follow the original action');
  }
});

test('the link consumer samples the production LP skeleton without changing actual source collision helpers',()=>{
  const profile=json('packages/combat-core/lp-profile.json'),characterPose=json('artifacts/lp/'+manifest.runtimePose);
  const effectPose=json('artifacts/lp/'+template.poseData),map={lines:[{lineId:1,start:[0,0,0],end:[100,0,0]}]};
  const samplers=createNativeSamplers({characterPose,profile,map,effectIndex:mergeEffectIndexes({templates:profile.effectTemplates},{templates:{[name]:template}}),
    effectPoses:{[template.poseData]:effectPose}});
  const library=createPoseLibrary(characterPose);
  for(const suffix of ['', '_BACK']){
    const actor={id:'lp',professionId:'LP',team:0,hp:100,x:0,y:0,z:0,facing:1,lineId:1,stateSerial:1,skillId:29011,
      state:'ANSI_SA_ALP_QUICKSILVER_ACCEL'+suffix,animationName:'SI_SA_ALP_QUICKSILVER_ACCEL'+suffix,animationTime:.02,animationLoop:false,fired:[]};
    const sim={state:{actors:[actor],effects:[]},profileFor:()=>profile,map,...samplers,note(){assert.fail('original source pose must be present');},emit(){},
      fire(a,key,time,before,after,fn){if(!a.fired.includes(key)&&before<=time&&after>=time){a.fired.push(key);fn();}},
      createEffect(a,definition,options){const e={id:1,ownerId:a.id,ownerStateSerial:1,name:ADD_QUICKSILVER_LINK,mainEffectName:name,
        skillId:29011,definition,damage:structuredClone(profile.damageEffects[ADD_QUICKSILVER_LINK].raw),birthAnchor:options.birthAnchor,
        initialSize:[1,1,1],initialAnimationName:'Normal',initialAnimationPlayback:'XAP_LOOP',animationTime:.2,elapsed:.2};
        this.state.effects.push(e);return e;}};
    addQuicksilverLinkEvents(sim,actor,0,.02);const effect=sim.state.effects[0];assert.ok(effect);
    const originalMatrices=samplePose(library,actor.animationName,.02,{rootTranslationOverride:[0,null,0]});
    near(effect.sourceAddQuicksilverLink.mainAnchor.position,originalMatrices.get('Bip01_L_Finger2').slice(12,15));
    const before=samplers.effectSampler(effect,actor);assert.ok(before.length>0,'actual original link helper geometry sampled');
    actor.animationTime=.4;actor.x=200;updateAddQuicksilverLink(sim,actor);
    const movedMatrices=samplePose(library,actor.animationName,.4,{rootTranslationOverride:[0,null,0]});
    near(effect.sourceAddQuicksilverLink.mainAnchor.position,movedMatrices.get('Bip01_L_Finger2').slice(12,15).map((v,i)=>v+(i===0?200:0)));
    assert.deepEqual(samplers.effectSampler(effect,actor),before,'visual link transform cannot stretch/move source DamageEffect collision');
  }
});

test('the existing Quicksilver link GLB renders both authored draws with an X-only link scale',async t=>{
  assert.equal(template.fields.DrawCount,2);assert.equal(template.fields.LifeTime,30);
  const effectPose=json('artifacts/lp/'+template.poseData),library=createPoseLibrary(effectPose);
  assert.equal(library.clips.get('Normal').durationSeconds,.5);
  assert.equal(library.clips.get('Normal').ticks_per_second,4800);
  // The original callback uses LINK_EFFECT_RATE=800. The helper endpoint is
  // separately authored at 953.7; never normalize this model to its bounds.
  const matrices=samplePose(library,'Normal',.25);
  near(matrices.get('ATTACK_LINE_START0').slice(12,15),[0,0,0]);
  near(matrices.get('ATTACK_LINE_END0').slice(12,15),[953.70068359375,0,0]);
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('quicksilver-audit',new Vector3(0,0,10),scene);
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
  const original=json('packages/combat-core/rf-profile.json');
  const profile={...original,target:{...original.target,unitClass:122},states:{},skillCatalog:[],buffTemplates:{},effectTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
  const view=await createEffectsView({scene,engine,index:{templates:{[name]:template}},profile,samplers:{},
    effectPoses:{[template.poseData]:effectPose},effectQuality:{level:'high',particleDivisor:1},
    loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const actor={id:'lp',professionId:'LP',team:0,hp:100,x:0,y:0,z:0,facing:1,state:'WAIT',stateSerial:1,animationTime:0,awakening:{remaining:0},buffs:[]};
  const definition={SCALE_X:.375,SCALE_Y:1,SCALE_Z:1};
  const birthAnchor={position:[100,200,300],rotation:[0,0,0],facing:1,customPosition:true};
  const effect={id:1,ownerId:'lp',name,mainEffectName:name,definition,birthAnchor,active:true,elapsed:0,animationTime:0};
  const state={actors:[actor],effects:[effect]};
  view.event({type:'effectStarted',effectId:1,actorId:'lp',name,definition,birthAnchor,ownerStateSerial:1,deleteConditions:[2,3]},state);
  for(let i=0;i<30;i++)view.step(.01,state);
  view.render();
  const roots=scene.transformNodes.filter(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled());
  assert.equal(roots.length,2);
  roots.forEach(node=>{near(node.position.asArray(),[1,2,-3]);near(node.scaling.asArray(),[.00375,.01,.01]);});
  assert.ok(scene.meshes.some(mesh=>mesh.isEnabled()&&mesh.getTotalVertices()>0),'converted geometry is drawable');
});

test('owned Quicksilver packets drive only the main mesh; source hit particles retain their impact point and dispersion',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('quicksilver-owned-audit',new Vector3(0,0,10),scene);
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
  const original=json('packages/combat-core/lp-profile.json'),damage=original.damageEffects[ADD_QUICKSILVER_LINK];
  const names=[name,...Object.entries(damage.raw).filter(([key])=>/^HIT_PARTICLE\d+$/.test(key)).map(([,entry])=>entry.PARTICLE_NAME)];
  const profile={...original,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{[ADD_QUICKSILVER_LINK]:damage},
    resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  const effectPose=json('artifacts/lp/'+template.poseData);
  const view=await createEffectsView({scene,engine,index:{templates:Object.fromEntries(names.map(n=>[n,index.templates[n]]))},profile,samplers:{},
    effectPoses:{[template.poseData]:effectPose},effectQuality:{level:'high',particleDivisor:1},
    loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const actor={id:'lp',professionId:'LP',team:0,hp:100,x:0,y:0,z:0,facing:1,state:'ANSI_SA_ALP_QUICKSILVER_ACCEL',
    stateSerial:7,skillId:29011,animationTime:.2,awakening:{remaining:0},buffs:[]};
  const anchor=position=>({position,rotation:[0,0,0],facing:1});
  const effect={id:31,ownerId:'lp',ownerStateSerial:7,name:ADD_QUICKSILVER_LINK,mainEffectName:name,
    definition:{NAME:ADD_QUICKSILVER_LINK},birthAnchor:anchor([7,8,9]),currentAnchor:anchor([7,8,9]),
    damage:damage.raw,active:true,elapsed:.31,meshLifetimeElapsed:.31,animationTime:.17,
    sourceAddQuicksilverLink:{phase:'forward',group:7,mainAnchor:anchor([100,200,300]),mainScale:[.25,1,1]}};
  const state={actors:[actor],effects:[effect]};
  view.event({type:'effectStarted',effectId:31,actorId:'lp',name:ADD_QUICKSILVER_LINK,definition:effect.definition,
    birthAnchor:effect.birthAnchor,ownerStateSerial:7,deleteConditions:[2,3]},state);
  const impact=[600,200,400];view.event({type:'effectContact',actorId:'lp',origin:{kind:'effect',id:31,impactPoint:impact}},state);
  view.step(.04,state);view.render({actors:[{...actor,x:4000,y:3000}]});
  const roots=scene.transformNodes.filter(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled());
  assert.equal(roots.length,2);roots.forEach(n=>{near(n.position.asArray(),[1,2,-3]);near(n.scaling.asArray(),[.0025,.01,.01]);});
  assert.deepEqual(view.sourceMeshClocks(),[{name,effectId:31,animationTime:.17,globalTime:.31}]);
  const plane=scene.meshes.find(m=>m.name.startsWith('native-particle:ADD_DamageImpact01|')&&m.thinInstanceCount>0);
  assert.ok(plane,'original hit particle sequence is visible');
  const positions=()=>Array.from({length:plane.thinInstanceCount},(_,i)=>{
    const m=plane._thinInstanceDataStorage.matrixData;return [m[i*16+12]*100,m[i*16+13]*100,-m[i*16+14]*100];});
  const initial=positions();assert.ok(initial.every(p=>Math.hypot(...p.map((n,i)=>n-impact[i]))<100));
  assert.ok(new Set(initial.map(p=>p.map(n=>n.toFixed(4)).join(','))).size>1,'source radius/velocity retained');
  effect.sourceAddQuicksilverLink.mainAnchor={...anchor([400,500,600]),rotation:[0,90,0]};
  effect.sourceAddQuicksilverLink.mainScale=[.75,1,1];effect.animationTime=.23;effect.meshLifetimeElapsed=.37;
  view.step(.04,state);view.render();
  roots.forEach(n=>{near(n.position.asArray(),[4,5,-6]);near(n.scaling.asArray(),[.0075,.01,.01]);near(n.rotationQuaternion.toEulerAngles().asArray(),[0,-Math.PI/2,0]);});
  assert.deepEqual(view.sourceMeshClocks(),[{name,effectId:31,animationTime:.23,globalTime:.37}]);
  assert.ok(positions().every(p=>Math.hypot(...p.map((n,i)=>n-impact[i]))<150),'moving/resizing the main does not drag hit particles');
  near(effect.currentAnchor.position,[7,8,9]);assert.deepEqual(effect.definition,{NAME:ADD_QUICKSILVER_LINK});
  assert.strictEqual(createEffectRenderState(state,[{...actor,x:9999}]).effects[0],effect);
  effect.dead=true;view.event({type:'effectEnded',effectId:31,actorId:'lp'},state);view.step(.01,state);view.render();
  assert.ok(roots.every(n=>!n.isEnabled()),'destroying the original handle immediately ends both main draws');
  assert.deepEqual(view.sourceMeshClocks(),[]);
});
