import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {CA_FATE_SCREEN_LAYERS,BM_SCREEN_DARKEN,createProjectedHitView,projectedHitVertices} from '../../apps/web/projected-hit-effects.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const fate=read('contracts/elesis-fate-presentation-source-v1.json');
// Frozen pre-optimization renderer formula, independent of its new writer.
function referenceVertices(p,width,height,fields={}){
 const [w,h]=p.values.Size,[px,py]=p.position,angle=p.values.Rotate[2]*Math.PI/180;
 const x=fields.ResolutionConvert?px*width/1024:px,y=fields.ResolutionConvert?py*height/768:py;
 const c=Math.cos(angle),s=Math.sin(angle),result=[];
 for(const [u,v]of [[0,1],[0,0],[1,1],[1,1],[0,0],[1,0]]){
  const dx=(u-.5)*w*width/1024,dy=(v-.5)*h*height/768;
  result.push(Math.trunc(x+dx*c-dy*s)-.5,Math.trunc(y+dx*s+dy*c)-.5,0);
 }
 return result;
}
const f32=values=>Array.from(new Float32Array(values));
function assertGeometry(mesh,particles,width,height,fields){
 assert.equal(mesh.isEnabled(),particles.length>0);
 if(!particles.length)return;
 assert.equal(mesh.getTotalVertices(),particles.length*6);
 assert.deepEqual(Array.from(mesh.getVerticesData('position')),f32(particles.flatMap(p=>referenceVertices(p,width,height,fields))));
 assert.deepEqual(Array.from(mesh.getVerticesData('color')),f32(particles.flatMap(p=>Array.from({length:6},()=>p.values.Color).flat())));
 assert.deepEqual(Array.from(mesh.getVerticesData('uv')),particles.flatMap(()=>[0,1,0,0,1,1,1,1,0,0,1,0]));
 assert.deepEqual(Array.from(mesh.getIndices()),Array.from({length:particles.length*6},(_,i)=>i));
}
function fixture(t,index,profile){
 const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('buffer-camera',new Vector3(0,0,10),scene);
 const view=createProjectedHitView({scene,engine,index,profile,assetBase:'/assets/'});
 let width=1024,height=768;engine.getRenderWidth=()=>width;engine.getRenderHeight=()=>height;
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 return {view,scene,engine,resize(w,h){width=w;height=h;},dimensions:()=>[width,height]};
}

test('projected writer preserves original pixel rounding, triangle order and resolution conversion',()=>{
 for(const [width,height]of [[1024,768],[1920,1080],[777,539]])for(const angle of [0,13.75,-90,360])for(const convert of [false,true]){
  const p={position:[-93.125,256.875,7],values:{Size:[2048.25,1200.5,1],Rotate:[0,0,angle]}};
  assert.deepEqual(projectedHitVertices(p,width,height,{ResolutionConvert:convert}),referenceVertices(p,width,height,{ResolutionConvert:convert}));
 }
});

test('Fate smoke reuses every GPU buffer while positions and source colour advance exactly',t=>{
 const s=fixture(t,{templates:fate.templates},{target:{unitClass:125},states:{}}),saved=new Map();
 for(const [i,name]of CA_FATE_SCREEN_LAYERS.entries()){
  s.view.startEffect({name,effectId:'fate-'+i},DEFAULT_EFFECT_QUALITY);
  const mesh=s.scene.getMeshByName('projected-hit:'+name),calls={replace:0,indices:0,update:0};
  const set=mesh.setVerticesData.bind(mesh),indices=mesh.setIndices.bind(mesh),update=mesh.updateVerticesData.bind(mesh);
  mesh.setVerticesData=(...args)=>{calls.replace++;return set(...args);};
  mesh.setIndices=(...args)=>{calls.indices++;return indices(...args);};
  mesh.updateVerticesData=(...args)=>{calls.update++;return update(...args);};
  saved.set(name,{mesh,calls,vertices:['position','uv','color'].map(kind=>mesh.getVertexBuffer(kind)),indices:mesh.geometry.getIndexBuffer()});
 }
 s.view.step(.02);
 let visits=0;
 const iterate=s.view.runtime.particles.values.bind(s.view.runtime.particles);
 s.view.runtime.particles.values=function*(){for(const p of iterate()){visits++;yield p;}};
 for(let frame=0;frame<120;frame++){
  if(frame===60)s.resize(1537,901);
  const before=visits;s.view.render();assert.equal(visits-before,2,'one Map pass for both authored screen layers');
  for(const [name,row]of saved){
   const particles=Array.from(iterate()).filter(p=>p.name===name);
   assertGeometry(row.mesh,particles,...s.dimensions(),fate.templates[name].fields);
   for(const [i,kind]of ['position','uv','color'].entries())assert.equal(row.mesh.getVertexBuffer(kind),row.vertices[i]);
   assert.equal(row.mesh.geometry.getIndexBuffer(),row.indices);
  }
  s.view.step(1/60);
 }
 for(const row of saved.values())assert.deepEqual(row.calls,{replace:0,indices:0,update:240});
 for(let frame=0;frame<301;frame++)s.view.step(1/60);
 s.view.render();assert.equal(s.view.runtime.count,0);
 for(const row of saved.values())assert.equal(row.mesh.isEnabled(),false);
 s.view.clear();assert.equal(s.view.runtime.emitters.size,0);assert.equal(s.view.runtime.particles.size,0);
});

test('screen burst growth, retirement and clear keep exact active topology without stale quads',t=>{
 const template=read('contracts/bm-fx-index.json').templates[BM_SCREEN_DARKEN];
 const s=fixture(t,{templates:{[BM_SCREEN_DARKEN]:template}},{target:{unitClass:106},states:{}});
 const mesh=s.scene.getMeshByName('projected-hit:'+BM_SCREEN_DARKEN),particles=()=>[...s.view.runtime.particles.values()];
 const event={name:BM_SCREEN_DARKEN,effectId:'reused-after-clear'};
 s.view.startEffect(event,DEFAULT_EFFECT_QUALITY);s.view.step(.101);s.view.render();assert.equal(particles().length,1);
 assertGeometry(mesh,particles(),...s.dimensions(),template.fields);
 s.view.step(.2);s.view.render();assert.equal(particles().length,3);
 assertGeometry(mesh,particles(),...s.dimensions(),template.fields);
 // Isolate renderer compaction from the separately tested source death clock.
 s.view.runtime.particles.delete(particles()[0].id);s.resize(1919,1079);s.view.render();
 assert.equal(particles().length,2);assertGeometry(mesh,particles(),...s.dimensions(),template.fields);
 const vertices=mesh.getVertexBuffer('position'),indices=mesh.geometry.getIndexBuffer();
 s.view.render();assert.equal(mesh.getVertexBuffer('position'),vertices);assert.equal(mesh.geometry.getIndexBuffer(),indices);
 s.view.clear();s.view.render();assert.equal(mesh.isEnabled(),false);assert.equal(s.view.runtime.count,0);
 s.view.startEffect(event,DEFAULT_EFFECT_QUALITY);s.view.step(.101);s.view.render();
 assert.equal(particles().length,1);assertGeometry(mesh,particles(),...s.dimensions(),template.fields);
 s.view.clear();s.scene.dispose();assert.equal(mesh.isDisposed(),true);assert.equal(s.scene.meshes.length,0);
 assert.equal(s.scene.materials.length,0);assert.equal(s.scene.textures.length,0);
});
