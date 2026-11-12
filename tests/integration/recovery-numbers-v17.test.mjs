import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,VertexBuffer} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {layoutRecoveryText,emitAwakeningRecoveryNumbers,emitDamageNumber} from '../../apps/web/damage-number-layout.mjs';
import {createDamageNumbers} from '../../apps/web/damage-numbers.mjs';
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));
const recovery=(extra={})=>({type:'awakeningEnded',position:[100,500,4],restoredHp:12.9,restoredMp:3.7,
  requestedHp:9999,requestedMp:999,hp:10000,mp:300,...extra});

test('HP+/MP+ use original full-string center advance with a blank gap and integer actual recovery',()=>{
  assert.deepEqual(layoutRecoveryText(12.9,[100,500,4],manifest.styles.hp),[
    {digit:'H',position:[10,550,4]},{digit:'P',position:[40,550,4]},{digit:'+',position:[70,550,4]},
    {digit:'1',position:[130,550,4]},{digit:'2',position:[160,550,4]}]);
  assert.deepEqual(layoutRecoveryText(3.7,[100,500,4],manifest.styles.mp),[
    {digit:'M',position:[25,530,4]},{digit:'P',position:[55,530,4]},{digit:'+',position:[85,530,4]},
    {digit:'3',position:[145,530,4]}]);
  assert.deepEqual(layoutRecoveryText(.5,[0,0,0],manifest.styles.hp).map(g=>g.digit),['H','P','+','0']);
  for(const amount of [0,-1,NaN,Infinity,1e22])assert.deepEqual(layoutRecoveryText(amount,[0,0,0],manifest.styles.hp),[]);
});

test('awakening end emits actual HP/MP changes using separate original colors and does not mutate the event',()=>{
  const runtime=createEffectRuntime({index:manifest}),event=recovery(),before=structuredClone(event);
  assert.equal(emitAwakeningRecoveryNumbers(runtime,manifest,event),9);
  const particles=[...runtime.particles.values()];
  assert.deepEqual(particles.map(p=>[p.name,p.options.digit,p.position,p.values.Color]),[
    ['PicCharGreen','H',[10,550,4],[.3,1,.3,1]],['PicCharGreen','P',[40,550,4],[.3,1,.3,1]],
    ['PicCharGreen','+',[70,550,4],[.3,1,.3,1]],['PicCharGreen','1',[130,550,4],[.3,1,.3,1]],
    ['PicCharGreen','2',[160,550,4],[.3,1,.3,1]],['PicCharBlue','M',[25,530,4],[.3,1,1,1]],
    ['PicCharBlue','P',[55,530,4],[.3,1,1,1]],['PicCharBlue','+',[85,530,4],[.3,1,1,1]],
    ['PicCharBlue','3',[145,530,4],[.3,1,1,1]]]);
  assert.deepEqual(event,before);assert.ok(particles.every(p=>p.age===0));
});

test('full/clamped zero restoration, missing old-event fields and malformed anchors never invent a recovery',()=>{
  const runtime=createEffectRuntime({index:manifest});
  for(const event of [recovery({restoredHp:0,restoredMp:0}),{type:'awakeningEnded',recalledGauge:3,hp:9999,mp:300},
    recovery({restoredHp:-1,restoredMp:NaN}),recovery({position:[100,NaN,0]}),recovery({position:undefined}),
    recovery({type:'awakening'}),recovery({type:'hit'})])assert.equal(emitAwakeningRecoveryNumbers(runtime,manifest,event),0);
  assert.equal(runtime.count,0);
  assert.equal(emitAwakeningRecoveryNumbers(runtime,manifest,recovery({restoredHp:0})),4);
  assert.ok([...runtime.particles.values()].every(p=>p.name==='PicCharBlue'));
  assert.equal(emitDamageNumber(runtime,manifest,{type:'hit',amount:10,damageNumber:{style:'hp',position:[0,0,0]}}),0);
});

test('original sequence caps remain independent for normal/red/green/blue and expire using original lifetimes',()=>{
  const runtime=createEffectRuntime({index:manifest});
  for(let i=0;i<30;i++)emitAwakeningRecoveryNumbers(runtime,manifest,recovery());
  assert.equal(runtime.count,200);
  assert.equal(emitAwakeningRecoveryNumbers(runtime,manifest,recovery()),0);
  for(const style of ['normal','red'])assert.equal(emitDamageNumber(runtime,manifest,
    {type:'hit',amount:1234,damageNumber:{style,position:[0,0,0]}}),4);
  assert.equal(runtime.count,208);runtime.step(.801);
  assert.equal(runtime.count,204,'only the unchanged .8-second normal sequence expired');
  runtime.step(.7);assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

test('real NullEngine renderer uses 16 shared source textures and only required style batches, without hit-time allocations',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  const camera=new FreeCamera('recovery-camera',new Vector3(0,0,10),scene);camera.rotation.set(.1,.2,.3);
  const view=await createDamageNumbers({scene,manifest});
  try{
    assert.equal(scene.textures.length,16);assert.equal(scene.meshes.length,50);
    assert.equal(scene.meshes.filter(m=>m.name.startsWith('picchar:normal')).length,10);
    assert.equal(scene.meshes.filter(m=>m.name.startsWith('picchar:red')).length,14);
    for(const name of ['normalH','normal+','redH','hpM','mpH'])assert.equal(scene.meshes.some(m=>m.name==='picchar:'+name),false);
    const warm={textures:scene.textures.length,meshes:scene.meshes.length,materials:scene.materials.length};
    view.event(recovery());view.event({type:'hit',amount:42,damageNumber:{style:'red',position:[0,0,0]}});view.render();
    const proof=view.proof();assert.equal(proof.originalDigitTextures,10);assert.equal(proof.originalPrefixTextures,6);
    assert.equal(proof.activeDigits,11);assert.equal(proof.emittedDigits,11);assert.deepEqual(proof.unsupported,[]);
    assert.deepEqual({textures:scene.textures.length,meshes:scene.meshes.length,materials:scene.materials.length},warm);
    const hpH=scene.meshes.find(m=>m.name==='picchar:hpH'),mpM=scene.meshes.find(m=>m.name==='picchar:mpM');
    assert.equal(hpH.thinInstanceCount,1);assert.equal(mpM.thinInstanceCount,1);
    for(const mesh of [hpH,mpM]){
      const texture=mesh.material.getActiveTextures()[0];assert.equal(texture.invertY,true);assert.equal(texture.hasAlpha,true);
      assert.equal(mesh.material.disableDepthTest,true);assert.equal(mesh.material.disableDepthWrite,true);
      assert.equal(mesh.material.backFaceCulling,false);assert.equal(mesh.renderingGroupId,3);
      assert.deepEqual(Array.from(mesh.getVerticesData(VertexBuffer.UVKind)),[0,0,1,0,1,1,0,1]);
    }
    const hpMatrix=hpH.thinInstanceGetWorldMatrices()[0],mpMatrix=mpM.thinInstanceGetWorldMatrices()[0];
    assert.ok(Math.abs(hpMatrix.m[12]-.1)<1e-7);assert.ok(Math.abs(hpMatrix.m[13]-5.5)<1e-7);
    assert.ok(Math.abs(mpMatrix.m[12]-.25)<1e-7);assert.ok(Math.abs(mpMatrix.m[13]-5.3)<1e-6);
    assert.ok(Math.abs(hpMatrix.m[14]+.04)<1e-7);
    view.step(1.501);view.render();assert.equal(view.proof().activeDigits,0);assert.ok(scene.meshes.every(m=>!m.isEnabled()));
    view.event(recovery());view.render();view.clear();assert.equal(view.proof().activeDigits,0);assert.ok(scene.meshes.every(m=>!m.isEnabled()));
  }finally{view.clear();scene.dispose();engine.dispose();}
});
