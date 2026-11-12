/** Actual target character poses and production anchor consumers, not a GPU or
 * full original-client replay. Both mirrored facings sample authored hand bones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import cast from '../../contracts/cast-display-index-v1.json' with {type:'json'};
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createCastDisplay} from '../../apps/web/cast-display.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
for(const id of ['RF','LK','VC','RS','BM','IS'])test(id+' original casting anchors remain readable but the display policy emits no hand light on either facing',()=>{
 const profile=getProfessionProfile(id),base='artifacts/'+id.toLowerCase()+'/',manifest=json(base+'manifest.json'),raw=json(base+manifest.runtimePose);
 const characterPose=composeCharacterPose(raw,raw.sharedPose?json(base+raw.sharedPose):null);
 const samplers=createNativeSamplers({profile,characterPose,effectIndex:{templates:{}},effectPoses:{}});
 const name=Object.keys(cast.professions[id].states).find(n=>cast.professions[id].states[n].lightTimes.length),spec=cast.professions[id].states[name];
 for(const facing of [-1,1])for(const awake of [false,true]){
  const actor={id:'source',professionId:id,state:name,stateSerial:1,animationName:profile.states[name].animationName,
   animationTime:spec.lightTimes[0],animationLoop:false,hp:100,x:400,y:200,z:0,facing,awakening:{remaining:awake?20:0}};
  const runtime=createEffectRuntime({index:cast}),display=createCastDisplay({runtime,index:{...cast,castDisplay:cast},profile,samplers});
  const anchor=samplers.effectAnchorSampler({definition:{BONE_NAME:spec.bone}},actor);
  assert.ok(anchor.position.every(Number.isFinite));assert.notDeepEqual(anchor.position,[actor.x,actor.y,actor.z]);
  display.step({actors:[actor]});assert.equal(runtime.emitters.size,0,id+':'+facing+':'+awake);
  assert.equal(display.proof().handLights,false);
 }
});
