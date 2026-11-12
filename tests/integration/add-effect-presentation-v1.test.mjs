/** Actual 2016 templates/38 NPC bones, with isolated presentation packets.
 * These are renderer regressions, not original-client trajectory evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial,PBRMaterial} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createEffectRenderState} from '../../apps/web/effect-render-anchors.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..');
const json=path=>JSON.parse(readFileSync(resolve(root,path)));
const npcDir='artifacts/mm/summons/apocalypse/',manifest=json(npcDir+'manifest.json'),pose=json(npcDir+manifest.poseData);
const raw=json('reports/mm-apocalypse-always-bones-v1.json').raw;
const actor=()=>({id:'mm',professionId:'MM',team:0,hp:100,x:0,y:0,z:0,facing:1,state:'WAIT',stateSerial:1,animationTime:0,awakening:{remaining:0},buffs:[]});
const anchor=position=>({position:[...position],rotation:[0,0,0],facing:1,customPosition:true});
const near=(actual,expected,tolerance=1e-5)=>{assert.equal(actual.length,expected.length);actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance,`${actual} != ${expected}`));};
async function setup(t,index,base,samplers={}){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('add-effect-probe',new Vector3(0,0,10),scene);
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
  const original=json('packages/combat-core/rf-profile.json');
  const profile={...original,target:{...original.target,unitClass:123},states:{},skillCatalog:[],buffTemplates:{},effectTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:Object.keys(index.templates)};
  const effectPoses=Object.fromEntries(Object.values(index.templates).filter(t=>t.poseData).map(t=>[t.poseData,json(base+t.poseData)]));
  const view=await createEffectsView({scene,engine,index,profile,samplers,effectPoses,effectQuality:{level:'high',particleDivisor:1},
    loadContainer:(_,file)=>loadPoseContainer(scene,resolve(root,base,file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {scene,view};
}
function start(view,state,e){
  state.effects.push(e);view.event({type:'effectStarted',effectId:e.id,actorId:e.ownerId,name:e.name,definition:e.definition,
    birthAnchor:e.birthAnchor,ownerStateSerial:state.actors[0].stateSerial,deleteConditions:[2,3]},state);
}
function planePositions(scene,name){
  const mesh=scene.meshes.find(m=>m.name.startsWith('native-particle:'+name+'|')&&m.thinInstanceCount>0);
  assert.ok(mesh,'source plane batch is active');
  // Babylon's diagnostic worldMatrices cache is not invalidated by an in-place
  // thinInstanceBufferUpdated upload. Read the actual uploaded source buffer.
  const matrices=mesh._thinInstanceDataStorage.matrixData;
  return Array.from({length:mesh.thinInstanceCount},(_,i)=>[matrices[i*16+12]*100,matrices[i*16+13]*100,-matrices[i*16+14]*100]);
}

test('all 38 Apocalypse Always sequences use independent NPC bones while M02 retains radius, velocity and finite particle age',async t=>{
  const source=json(npcDir+'fx/index.json'),definitions=Object.entries(raw).filter(([key])=>/^EFFECT\d+$/.test(key)).map(([,v])=>v);
  const names=new Set(definitions.map(d=>d.NAME)),index={templates:Object.fromEntries([...names].map(n=>[n,source.templates[n]]))};
  assert.equal(definitions.length,38);assert.equal(names.size,7);
  for(const template of Object.values(index.templates))assert.equal(template.kind,'particle');
  const sampler=createAddSummonSamplers({manifest,pose}),npc={kind:'apocalypse',serial:3,state:'APOCALYPSE_WAIT',animationTime:.25,position:[100,200,300],facing:1,yaw:0,aimZ:0};
  const {scene,view}=await setup(t,index,npcDir,{effectAnchorSampler(){assert.fail('caster skeleton used for NPC');},effectBoneSampler(){assert.fail('caster bone used for NPC');}});
  const a=actor(),state={actors:[a],effects:[]};
  definitions.forEach((definition,id)=>{const point={...sampler.summonPoseSampler(npc,definition),customPosition:true};
    start(view,state,{id:id+1,ownerId:a.id,name:definition.NAME,mainEffectName:definition.NAME,definition,birthAnchor:point,currentAnchor:point,
      sourcePosedAnchor:point,sourceAddSummonSerial:npc.serial,active:true,elapsed:5,animationTime:5});});
  view.step(.04,state);view.render({actors:[{...a,x:1000,y:2000,z:3000}]});
  assert.deepEqual(view.sourceMeshClocks(),[],'PT_MESH particles are not source-controlled main meshes');
  let sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
  assert.equal(sequences.length,38);sequences.forEach((row,i)=>near(row.position,state.effects[i].currentAnchor.position));
  const before=planePositions(scene,'ADD_APOCALYPSE_M02'),m02=state.effects.find(e=>e.name==='ADD_APOCALYPSE_M02'),origin=m02.currentAnchor.position;
  assert.ok(before.length>1);assert.ok(before.some(p=>Math.hypot(...p.map((n,i)=>n-origin[i]))>1),'original random radius survives rendering');
  assert.ok(new Set(before.map(p=>p.map(n=>n.toFixed(3)).join(','))).size>1,'particles do not collapse onto one anchor');
  const shift=[70,30,-20];npc.position=npc.position.map((n,i)=>n+shift[i]);a.stateSerial++;
  for(const e of state.effects){e.currentAnchor=e.sourcePosedAnchor={...sampler.summonPoseSampler(npc,e.definition),customPosition:true};}
  delete state.effects[0].sourcePosedAnchor; // Valid currentAnchor-only packet must not query the caster.
  view.step(.04,state);view.render({actors:[{...a,x:4000}]});
  const moved=planePositions(scene,'ADD_APOCALYPSE_M02');near(moved[0],before[0].map((n,i)=>n+shift[i]),1e-3);
  view.step(.04,state);view.render();const velocityMoved=planePositions(scene,'ADD_APOCALYPSE_M02');
  assert.ok(Math.abs(velocityMoved[0][0]-moved[0][0])>1e-4,'source velocity moves the old particle after its prepared packet');
  for(let i=0;i<20;i++)view.step(.04,state);
  view.render();sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
  assert.equal(sequences.length,38,'caster state changes do not cancel NPC-owned sequences');
  sequences.forEach((row,i)=>near(row.position,state.effects[i].currentAnchor.position));
  assert.ok(planePositions(scene,'ADD_APOCALYPSE_M02').length<100,'0.3-second native particle lifetimes prevent a 200-particle immortal cap');
});

test('Add owned meshes retain combat clocks, dynamic Fury link scale and original DrawCount',async t=>{
  const source=json('artifacts/mm/fx/index.json'),name='ADD_Ultimate_Fury_AttackLine01',template=source.templates[name];
  const {scene,view}=await setup(t,{templates:{[name]:template}},'artifacts/mm/');
  const a=actor(),state={actors:[a],effects:[]},point=anchor([100,200,300]);
  const e={id:71,ownerId:a.id,name,mainEffectName:name,definition:{SCALE_X:2,SCALE_Y:2,SCALE_Z:2},birthAnchor:point,currentAnchor:point,
    sourceAddFury:{role:'beam'},sourceAddLinkScale:2,active:true,elapsed:.7,meshLifetimeElapsed:.7,animationTime:.25};
  start(view,state,e);view.step(.01,state);view.render();
  const roots=scene.transformNodes.filter(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled());
  assert.equal(roots.length,2,'original DrawCount is preserved');roots.forEach(n=>near(n.scaling.asArray(),[.02,.01,.01]));
  assert.deepEqual(view.sourceMeshClocks(),[{name,effectId:71,animationTime:.25,globalTime:.7}]);
  e.definition.SCALE_X=5;e.sourceAddLinkScale=5;e.currentAnchor=anchor([400,500,600]);e.animationTime=.5;e.meshLifetimeElapsed=.8;
  view.step(.01,state);view.render();roots.forEach(n=>{near(n.scaling.asArray(),[.05,.01,.01]);near(n.position.asArray(),[4,5,-6]);});
  assert.deepEqual(view.sourceMeshClocks(),[{name,effectId:71,animationTime:.5,globalTime:.8}]);
});

test('display interpolation never translates an independent NPC or Fury transform with its caster',()=>{
  const a=actor(),source=anchor([100,200,300]);
  const effects=[{id:1,ownerId:a.id,damage:{},definition:{TRACE:1},sourcePosedAnchor:source,currentAnchor:source,sourceAddSummonSerial:1},
    {id:2,ownerId:a.id,damage:{},definition:{TRACE:1},sourcePosedAnchor:source,currentAnchor:source,sourceAddFury:{role:'beam'}}];
  const state={actors:[a],effects},before=structuredClone(state),display=createEffectRenderState(state,[{...a,x:999,y:333,z:777}]);
  effects.forEach((e,i)=>assert.strictEqual(display.effects[i],e));assert.deepEqual(state,before);
});
