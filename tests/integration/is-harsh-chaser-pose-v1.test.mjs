import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPoseLibrary} from '../../tools/assets/character/sample_pose.mjs';
import {arcEffectPose} from '../../packages/combat-assets/effect-transform.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';

test('original Harsh Chaser failed Normal name retains first bind helpers and then uses serialized index0 source pose',()=>{
  const root=resolve(import.meta.dirname,'../../artifacts/is');
  const visual=JSON.parse(readFileSync(resolve(root,'fx/index.json'),'utf8'));
  const index=mergeEffectIndexes({templates:{}},visual),template=index.templates.HarshChaserBlade;
  const pose=JSON.parse(readFileSync(resolve(root,template.poseData),'utf8')),library=createPoseLibrary(pose);
  assert.equal(template.initialAnimation.name,'Normal');
  assert.deepEqual([...library.clips.keys()],['Elsword_SisKnight_sword']);
  const effect={name:'ELSWORD_HASHCHASER_BLADE',damage:{MAIN_EFFECT_NAME:'HarshChaserBlade'},definition:{},
    birthAnchor:{position:[0,0,0],facing:1},elapsed:0,animationTime:0};
  assert.deepEqual(arcEffectPose(template,library,effect),{bind:true});
  const notes=[],samplers=createNativeSamplers({characterPose:{schemaVersion:1,frames:[],helpers:[],clips:[]},effectIndex:index,
    effectPoses:{[template.poseData]:pose},profile:{},onUnsupported:(...note)=>notes.push(note)});
  const initial=samplers.effectSampler(effect,{});
  assert.equal(initial.length,1);assert.equal(initial[0].kind,'line');assert.ok(initial[0].radius>0);
  effect.sourceArcPose={animationName:'Elsword_SisKnight_sword',animationTime:.01,animationLoop:true,presentationTransition:null};
  assert.equal(arcEffectPose(template,library,effect).bind,false);
  const advanced=samplers.effectSampler(effect,{});assert.equal(advanced.length,1);
  assert.ok(advanced[0].start.every(Number.isFinite));assert.ok(advanced[0].end.every(Number.isFinite));
  assert.ok(notes.every(note=>!JSON.stringify(note).includes('effect-clip:')));
  assert.equal(arcEffectPose({...template,name:'UnverifiedOtherTemplate'},library,effect),null,
    'unverified missing animation names remain unsupported');
});

test('Sword Fall literal velocity control retains its independent failed Normal animation controller',()=>{
  const root=resolve(import.meta.dirname,'../../artifacts/is');
  const visual=JSON.parse(readFileSync(resolve(root,'fx/index.json'),'utf8'));
  const index=mergeEffectIndexes({templates:{}},visual);
  for(const name of ['SwordFallBlade1','SwordFallBlade2','SwordFallBlade3','SwordFallBlade4']){
    const template=index.templates[name],pose=JSON.parse(readFileSync(resolve(root,template.poseData),'utf8'));
    const library=createPoseLibrary(pose);
    assert.equal(template.initialAnimation.name,'Normal');
    assert.deepEqual([...library.clips.keys()],['Elsword_SisKnight_sword']);
    const effect={sourceShadowMesh:{literalMotion:true,animationName:'Normal',animationTime:9,animationPlayback:'XAP_LOOP'}};
    assert.deepEqual(arcEffectPose(template,library,effect),{bind:true});
    effect.sourceArcPose={animationName:'Elsword_SisKnight_sword',animationTime:.02,animationLoop:true,presentationTransition:null};
    const sampled=arcEffectPose(template,library,effect);
    assert.equal(sampled.bind,false);
    assert.equal(sampled.controllerState.animationName,'Elsword_SisKnight_sword');
    assert.equal(sampled.controllerState.animationTime,.02);
  }
});
