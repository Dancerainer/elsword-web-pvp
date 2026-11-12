import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {xCrashMeshTransform} from '../../packages/combat-core/xcrash-mesh-transform.mjs';
import {make,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

const tick=(s,input={})=>s.step(1/60,input,{snapshot:false});
const close=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
const fire=profile.effectTemplates.RRF_XCrash_FireDummy;

test('pinned mesh consumer sums external/local angles, applies Size and destroys parent particle handles with AutoDie',()=>{
 const files=[['KTDXLIB/Always.h','/^#define LOCAL_ROTATE_EFFECT/m'],
  ['KTDXLIB/KTDGXMeshPlayer.cpp','m_vRotate.z+m_vRotateLocal.z'],
  ['X2Lib/X2DamageEffect.cpp','pParticleData->DestroyParticleSequence();']];
 const manifest=JSON.parse(readFileSync(new URL('../../contracts/rf-native-runtime-sources.json',import.meta.url)));
 for(const [file,check] of files){
  const bytes=readFileSync(new URL('../../.cache/native-source-runtime/'+file,import.meta.url));
  const pin=manifest.files.find(v=>v.relativePath===file);
  assert.ok(pin,file);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
  if(check.startsWith('/'))assert.match(bytes.toString('latin1'),/^#define LOCAL_ROTATE_EFFECT/m);
  else assert.ok(bytes.toString('latin1').includes(check));
 }
 const source=readFileSync(new URL('../../.cache/native-source-runtime/X2Lib/X2DamageEffect.cpp',import.meta.url)).toString('latin1');
 assert.match(source.slice(source.indexOf('void CX2DamageEffect::ParticleData::DestroyParticleSequence()'),
  source.indexOf('void CX2DamageEffect::ParticleData::DestroyParticleSequence()')+800),/pSeq->SetAutoDie\(\)/);
 assert.equal(fire.events.find(e=>e.property==='Rotate').value[2],45);
 assert.deepEqual(fire.events.filter(e=>e.property==='Size').map(e=>[e.start,e.end,e.value]),
  [[0,0,[1,1,1]],[.4,.8,[1.2,1.2,1.2]]]);
});

test('literal XCrash transforms are bounded, reject random/malformed events and do not touch unrelated mesh templates',()=>{
 const e={elapsed:.6,definition:{SCALE_X:2}},a={position:[100,200,0],facing:1,rotation:[0,0,-45]};
 const v=xCrashMeshTransform(fire,e,a);assert.deepEqual(v.rotation,[0,0,0]);
 close(v.scale[0],2.2);close(v.scale[1],1.1);assert.equal(xCrashMeshTransform({name:'unrelated'},e,a),null);
 for(const value of [{random:[0,45]},[0,0,NaN],[0,0]])
  assert.throws(()=>xCrashMeshTransform({...fire,events:[{property:'Rotate',value,start:0,end:0}]},e,a),/Unsupported/);
 assert.throws(()=>xCrashMeshTransform(fire,{elapsed:NaN},a),/clock and anchor/);
});

test('actual keyboard XCrash tail uses all four source diagonal arms, dynamic size, stable world birth and finite retirement in both directions',async()=>{
 for(const facing of [-1,1]){
  const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');a.facing=facing;
  s.drainEvents();tick(s,{pressed:['A'],held:['A']});
  let birth=null,ended=null,actorEnd=null,frames=0,grown=0;const timed=new Set();
  const source=poses[fire.poseData],sourceBone=name=>source.frames.find(f=>f.name===name).nativeRowMatrix.slice(12,15);
  for(let i=0;i<240;i++){
   const old=a.state;tick(s);
   const events=s.drainEvents();
   if(old==='SI_SA_RRF_X_CRASH'&&a.state!==old)actorEnd=s.state.time;
   for(const ev of events){
    if(ev.type==='effectStarted'&&ev.name==='DamageEffect_SA_RRF_XCrash_Fire_FX')birth=ev;
    if(ev.type==='effectEnded'&&ev.name==='DamageEffect_SA_RRF_XCrash_Fire_FX')ended=ev;
    if(ev.type==='effectTimedParticles'&&ev.name==='DamageEffect_SA_RRF_XCrash_Fire_FX')
     for(const item of ev.entries)timed.add(item.key);
   }
   const mesh=s.state.effects.find(e=>e.name==='DamageEffect_SA_RRF_XCrash_Fire_FX');if(!mesh?.active)continue;
   frames++;const center=s.effectBoneSampler(mesh,a,'Dummy00');
   assert.deepEqual(center,mesh.birthAnchor.position,'no follow to the owner after the skill ends');
   const ratio=mesh.meshLifetimeElapsed<=.4?1:1+Math.min(1,(mesh.meshLifetimeElapsed-.4)/.4)*.2;
   if(ratio>1.05)grown++;
   for(const name of ['Dummy01_3','Dummy02_3','Dummy03_3','Dummy04_3']){
    const point=s.effectBoneSampler(mesh,a,name),local=sourceBone(name);
    // This independent expected geometry reads original DLL/bind translations;
    // the consumer under test must cancel -45 external with +45 template local.
    close(point[0],center[0]+facing*local[0]*ratio);close(point[1],center[1]+local[1]*ratio);
    const dx=point[0]-center[0],dy=point[1]-center[1];
    close(Math.abs(dx),Math.abs(dy));assert.ok(Math.abs(dx)>220&&Math.abs(dy)>220,'diagonal X, not axial +');
   }
  }
  assert.ok(birth&&ended&&actorEnd);assert.ok(frames>40&&grown>8);
  assert.equal(timed.size,17);assert.ok(ended.time>actorEnd,'finite source tail legitimately outlives the actor state');
  assert.ok(!s.state.effects.some(e=>/XCrash|X_CRASH/.test(e.name)));
 }
});
