import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,MeshBuilder,PBRMaterial} from '@babylonjs/core';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {characterToonMaterial} from '../../apps/web/character-toon-material.mjs';
import {createPoseAudio} from '../../apps/web/pose-audio.mjs';
import {createHitLighting} from '../../apps/web/hit-lighting.mjs';
import rfSounds from '../../contracts/rf-pose-sounds-v25.json' with {type:'json'};
import rfPoses from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};
for(const c of ['rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de'])test(`${c} all source intro/win/lose sounds play once on the displayed clock`,()=>{
 const profile=JSON.parse(readFileSync(`packages/combat-core/${c}-profile.json`)),poses=profile.presentation?.pvpPoses??rfPoses.poses,
 audio=JSON.parse(readFileSync(c==='rf'?'artifacts/audio/manifest.json':`artifacts/${c}/audio/manifest.json`));
 if(c==='rf')Object.assign(audio.files,JSON.parse(readFileSync('artifacts/audio/pose-v25/manifest.json')).files);
 const played=[],controller=createPoseAudio({profileFor:()=>profile,localActorId:()=>c,play:n=>played.push(n),random:()=>0});
 for(const kind of ['start','win','lose'])for(const pose of poses[kind]){
   const raw=profile.states[pose.state]?.raw??rfSounds.states[pose.state],actor={id:c,x:0,y:0,z:0,pvpPresentation:pose};controller.clear();played.length=0;
   const expected=Object.entries(raw).filter(([k,v])=>/^SOUND_PLAY\d+$/.test(k)&&v['1']<=pose.duration*(raw.ANIM_SPEED??1)).map(([,v])=>v['2']);
   controller.step(actor,0);controller.step(actor,pose.duration);controller.step(actor,pose.duration);
   assert.deepEqual(played.sort(),expected.sort());assert.ok(expected.length>0,pose.state);
   assert.ok(expected.every(name=>audio.files[name]),'each pose resolves an original audio asset');
   controller.clear();played.length=0;controller.step({...actor,id:'remote'},pose.duration);
   assert.deepEqual(played,[],'user preference: all remote intro/result cues are filtered');
 }
});
test('model hit illumination is mesh scoped, expires at .2 seconds and stays bounded on repeated critical hits',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),mesh=MeshBuilder.CreateBox('actor',{},scene),other=MeshBuilder.CreateBox('other',{},scene);
 mesh.material=new PBRMaterial('a',scene);other.material=new PBRMaterial('b',scene);styleCharacter({meshes:[mesh,other]});
 const light=createHitLighting({scene,viewFor:id=>id==='a'?{meshes:[mesh]}:{meshes:[other]}}),state={actors:[{id:'a',x:0,z:0},{id:'b',x:100,z:0}]};
 for(let i=0;i<10;i++)light.event({type:'hit',actorId:'a',targetId:'b',critical:true,amount:1},state);
 light.step(.01);assert.equal(light.proof().length,2);assert.equal(scene.lights.length,0);
 assert.ok(light.proof().every(row=>row.activeMaterials===1));assert.equal(characterToonMaterial(mesh.material).damage,true);
 light.step(.2);assert.ok(light.proof().every(row=>row.activeMaterials===0));assert.equal(characterToonMaterial(mesh.material).damage,false);light.clear();assert.equal(scene.lights.length,0);
 scene.dispose();engine.dispose();
});
