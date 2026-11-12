import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,MeshBuilder,PBRMaterial} from '@babylonjs/core';
import source from '../../contracts/character-toon-source-v27.json' with {type:'json'};
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {characterToonMaterial,setCharacterWorldLight} from '../../apps/web/character-toon-material.mjs';
import {createHitLighting} from '../../apps/web/hit-lighting.mjs';
import {updateActorInvulnerabilityPresentation} from '../../apps/web/invulnerability-presentation.mjs';
import {installNativeEffectMaterial} from '../../apps/web/native-effect-material.mjs';
const original='asset_work/raw/';
test('tiny original BMP ramp bytes and independently decoded pixels match target source evidence',()=>{
 for(const ramp of Object.values(source.ramps)){
  const bytes=readFileSync(original+ramp.archive+'/'+ramp.name),offset=bytes.readUInt32LE(10),width=bytes.readInt32LE(18),pixels=[];
  assert.equal(createHash('sha256').update(bytes).digest('hex'),ramp.sha256);assert.equal(width,ramp.width);
  for(let i=0;i<width;i++){const p=offset+i*3;pixels.push(bytes[p+2],bytes[p+1],bytes[p],255);}
  assert.deepEqual(pixels,ramp.rgba);
 }
 const bytes=readFileSync(original+'data/data041.kom/XRenderer.fx');assert.equal(createHash('sha256').update(bytes).digest('hex'),source.shader.sha256);
 assert.equal(source.ramps.damage.width,2);assert.deepEqual(source.ramps.invincible.rgba,[109,109,109,255]);
});
function fixture(t){const engine=new NullEngine(),scene=new Scene(engine),views=new Map();
 t.after(()=>{scene.dispose();engine.dispose();});
 function view(id){const mesh=MeshBuilder.CreateBox(id,{},scene);mesh.material=new PBRMaterial(id,scene);const v={meshes:[mesh]};styleCharacter(v);views.set(id,v);return v;}
 return {scene,views,view,controller:createHitLighting({scene,viewFor:id=>views.get(id)})};
}
test('all source maps supply their authored light and missing/malformed fields stay unsupported',t=>{
 const f=fixture(t);let maps=0;
 for(const name of readdirSync('artifacts/scene')){
  const file='artifacts/scene/'+name+'/manifest.json';let map;try{map=JSON.parse(readFileSync(file));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const call=map.worldSettings?.findLast(v=>v.callee==='SetLightPos');if(!call)continue;maps++;
  const p=setCharacterWorldLight(f.scene,map),len=Math.hypot(...call.arguments,1);
  assert.deepEqual(p.rendererDirection,[call.arguments[0]/len,call.arguments[1]/len,-call.arguments[2]/len]);
 }
 assert.ok(maps>=15);assert.equal(setCharacterWorldLight(f.scene,{}).supported,false);
 assert.equal(setCharacterWorldLight(f.scene,{worldSettings:[{callee:'SetLightPos',arguments:[1,2,NaN]}]}).supported,false);
});
test('six simultaneous model hit modes need no extra scene lights and do not affect idle models',t=>{
 const f=fixture(t),actors=Array.from({length:7},(_,i)=>({id:String(i),x:i*100,z:0,facing:1}));actors.forEach(a=>f.view(a.id));
 const residentTextures=f.scene.textures.length;
 for(let n=0;n<50;n++)for(let i=0;i<6;i+=2)f.controller.event({type:'hit',actorId:String(i),targetId:String(i+1),amount:1},{actors});
 f.controller.step(.01);assert.equal(f.scene.lights.length,0);assert.equal(f.scene.textures.length,residentTextures);
 assert.equal(f.controller.proof().length,6);assert.ok(f.controller.proof().every(p=>p.activeMaterials===1));
 assert.equal(characterToonMaterial(f.views.get('6').meshes[0].material).damage,false);
 f.controller.step(.2);for(const v of f.views.values())assert.equal(characterToonMaterial(v.meshes[0].material).damage,false);
});
test('ordinary accepted hits trigger both sides, zero damage does not; clear and view replacement restore old materials',t=>{
 const f=fixture(t),a=f.view('a'),b=f.view('b'),state={actors:[{id:'a',x:0,z:0},{id:'b',x:100,z:0}]};
 f.controller.event({type:'hit',actorId:'a',targetId:'b',amount:0},state);assert.equal(f.controller.proof().length,0);
 f.controller.event({type:'observedHit',actorId:'a',targetId:'b',amount:1,critical:false},state);f.controller.step(0);
 assert.equal(characterToonMaterial(a.meshes[0].material).damage,true);assert.equal(characterToonMaterial(b.meshes[0].material).damage,true);
 const replacement=f.view('a');f.controller.step(.01);assert.equal(characterToonMaterial(a.meshes[0].material).damage,false);
 assert.equal(characterToonMaterial(replacement.meshes[0].material).damage,true);f.controller.clear();
 assert.equal(characterToonMaterial(replacement.meshes[0].material).damage,false);assert.equal(f.scene.lights.length,0);
});
test('authored show-invincible shader overrides hit ramp and preserves source alpha without changing protection',t=>{
 const f=fixture(t),v=f.view('a'),p=characterToonMaterial(v.meshes[0].material);p.damage=true;
 const actor={deathAlpha:.3,invincible:true,showInvincible:{remaining:1,swapRemaining:.05,white:true}};
 updateActorInvulnerabilityPresentation(v,actor);assert.equal(p.proof().mode,'invincible');assert.equal(v.meshes[0].visibility,.3);
 actor.showInvincible.white=false;updateActorInvulnerabilityPresentation(v,actor);assert.equal(p.proof().mode,'damage');assert.equal(actor.invincible,true);
});
test('REAL_COLOR accessories keep the independent raw-colour shader and do not acquire cartoon hit ramps',t=>{
 const f=fixture(t),v=f.view('a');const effect=installNativeEffectMaterial(v.meshes[0].material);assert.ok(effect);
 assert.equal(characterToonMaterial(v.meshes[0].material),null);
});
test('CEffect and core owners do not invent GUUser AttackResult light; their defenders still use DamageReact',t=>{
 const f=fixture(t),a=f.view('a'),b=f.view('b'),state={actors:[{id:'a',x:0,z:0},{id:'b',x:100,z:0}]};
 for(const kind of ['effect','core']){f.controller.clear();f.controller.event({type:'hit',actorId:'a',targetId:'b',amount:1,origin:{kind}},state);f.controller.step(0);
  assert.equal(characterToonMaterial(a.meshes[0].material).damage,false);assert.equal(characterToonMaterial(b.meshes[0].material).damage,true);
  assert.equal(f.controller.proof().length,1);}
});
test('incoming effect side uses the stored defender side on a real curved line, rather than owner position',t=>{
 const f=fixture(t);f.view('a');const b=f.view('b');
 const base='artifacts/scene/summer-2008-pvp/',manifest=JSON.parse(readFileSync(base+'manifest.json'));
 const map={...manifest,...JSON.parse(readFileSync(base+manifest.collision.url))};
 const controller=createHitLighting({scene:f.scene,viewFor:id=>f.views.get(id),mapFor:()=>map});
 const state={actors:[{id:'a',x:100000,y:446,z:543,lineId:19,lastTouchLineId:19,facing:1},
  {id:'b',x:2702.790283203125,y:446.42,z:543.7986450195312,lineId:19,lastTouchLineId:19,facing:1,lastAttackerFront:false}]};
 controller.event({type:'hit',actorId:'a',targetId:'b',amount:1,origin:{kind:'effect'}},state);controller.step(0);
 const p=characterToonMaterial(b.meshes[0].material);assert.ok(p.direction[0]<0,'source back-side flag wins over distant owner to the right');
 assert.ok(Math.abs(p.direction[2])>.1,'curved native line direction is preserved');controller.clear();
 assert.ok(Math.hypot(...p.direction)>.99999,'source renderer renormalizes a non-unit interpolated line tangent as float4');
});
