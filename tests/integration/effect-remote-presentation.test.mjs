import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {profile,visualIndex,make,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
import {makeArc,profile as arcProfile,starts,poses as arcPoses,samplers as arcSamplers} from '../helpers/archenemy-v17-fixture.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..'),moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const wrapper=moduleUrl(`export * from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
import {RawTexture,Engine} from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
export class Texture extends RawTexture {constructor(_path,scene,_noMipmap,_invertY,_samplingMode,onLoad){super(new Uint8Array([255,255,255,255]),1,1,Engine.TEXTUREFORMAT_RGBA,scene,false,false);queueMicrotask(()=>onLoad?.());}isReady(){return true;}}`);
const preparation=moduleUrl(`export {updateControlledEffectLookup,scheduleRenderPreparation,createPreparationDiagnostics} from ${JSON.stringify(pathToFileURL(resolve(root,'apps/web/render-preparation.mjs')).href)};
export function createRenderPreparationCache(){return async()=>{};}`);
// Real 2016 templates, native bone samplers and production draw matrices.
// One ready pixel replaces image transport only; this is not GPU visual QA.
const source=readFileSync(resolve(root,'apps/web/effects-view.mjs'),'utf8')
 .replace("from '@babylonjs/core'",'from '+JSON.stringify(wrapper))
 .replace("from './render-preparation.mjs'",'from '+JSON.stringify(preparation))
 .replace(/(import\s+(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,(_all,start,quote,file)=>
   start+quote+(file.startsWith('.')?pathToFileURL(resolve(root,'apps/web',file)).href:file.startsWith('data:')?file:import.meta.resolve(file))+quote);
const {createEffectsView}=await import(moduleUrl(source));
const near=(a,b)=>assert.ok(Math.abs(a-b)<.00002,`${a} != ${b}`);
function matrices(scene){return new Map(scene.meshes.filter(m=>m.name.startsWith('native-particle:')&&m.isEnabled()).map(m=>[m.name,
  Array.from({length:m.thinInstanceCount},(_,i)=>Array.from(m._thinInstanceDataStorage.matrixData.subarray(i*16,i*16+16)))]));}

test('RF awakening bone flames follow displayed remote poses while real runtime anchors and fixed world effects stay unchanged',async t=>{
  const simulation=await make({passives:[]}),actor=simulation.actor('rf');actor.awakening.remaining=20;
  const worldName='raven_beed_hit_03',names=['HyperBoostRightBlack','HyperBoostLeftBlack',worldName];
  const index={templates:Object.fromEntries(names.map(name=>[name,visualIndex.templates[name]]))};
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('attachment-camera',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index,profile:bounded,samplers:{effectAnchorSampler:simulation.effectAnchorSampler,effectBoneSampler:simulation.effectBoneSampler}});
  const facade=createProfessionEffects({RF:view});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  // This real particle template has an independent birth/world anchor. Its
  // declaration does not enable TRACE, so it must not follow actor correction.
  view.event({type:'effectStarted',actorId:'rf',effectId:876,name:worldName,definition:{},birthAnchor:{position:[500,600,700],facing:1}},simulation.state);
  for(let frame=0;frame<18;frame++)facade.step(1/60,simulation.state);
  facade.render();const before=matrices(scene),stateBefore=structuredClone(simulation.state),proofBefore=view.proof();
  assert.equal(proofBefore.awakening.emitters,4);assert.ok(before.size>=4);
  const shown={...actor,x:actor.x-120,y:actor.y+25,z:actor.z+10};
  facade.render({actors:simulation.state.actors.map(a=>a.id===actor.id?shown:a)});
  const displayed=matrices(scene);let moved=0,world=0;
  for(const [name,rows]of before){const after=displayed.get(name);assert.equal(after.length,rows.length);
    if(name.startsWith('native-particle:'+worldName+'|')){assert.deepEqual(after,rows);world+=rows.length;continue;}
    for(let i=0;i<rows.length;i++){
      near(after[i][12]-rows[i][12],-1.2);near(after[i][13]-rows[i][13],.25);near(after[i][14]-rows[i][14],-.1);moved++;
      for(const j of [0,1,2,3,4,5,6,7,8,9,10,11,15])near(after[i][j],rows[i][j]);
    }
  }
  assert.ok(moved>0);assert.ok(world>0);assert.deepEqual(simulation.state,stateBefore);
  assert.deepEqual(view.proof().awakening,proofBefore.awakening,'runtime emitter anchors and particle counts are unchanged');
  facade.render();assert.deepEqual(matrices(scene),before,'sampling does not accumulate correction into source data');
  view.clear();facade.render({actors:[shown]});assert.equal(view.count,0);
});

test('actual independently controlled Arc Start GLBs retain source transforms and mesh clocks under delayed actor presentation',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('source-control-camera',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index:starts,profile:arcProfile,samplers:arcSamplers,effectPoses:arcPoses,loadout:[{skillId:24008}],
    loadContainer:async(_root,file)=>loadPoseContainer(scene,resolve(fixtureRoot,'artifacts/rf',file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const s=await makeArc(-1);s.step(1/60,{pressed:['A']},{snapshot:false});let cursor=0;
  for(let i=0;i<30;i++){
    s.step(1/60,{}, {snapshot:false});
    for(const e of s.state.events.slice(cursor))if(e.sourceArcStartMesh||e.type==='effectEnded')view.event(e,s.state);
    cursor=s.state.events.length;view.step(1/60,s.state);
    if(view.sourceMeshClocks().length)break;
  }
  view.render();const clocks=view.sourceMeshClocks();assert.ok(clocks.length>0);
  const source=s.snapshot(),nodes=scene.transformNodes.filter(n=>n.name.startsWith('fx-'));
  const matrices=()=>nodes.map(node=>Array.from(node.computeWorldMatrix(true).m));
  const before=matrices();assert.ok(before.length>0);
  view.render({actors:s.state.actors.map(actor=>({...actor,x:actor.x-150,y:actor.y+80,animationTime:0,facing:-actor.facing}))});
  assert.deepEqual(matrices(),before);assert.deepEqual(view.sourceMeshClocks(),clocks);assert.deepEqual(s.snapshot(),source);
});
