import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';

const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const rs=read('artifacts/rs/runtime-pose.json'),lk=read('artifacts/lk/runtime-pose.json');
const pose=composeCharacterPose(rs,lk),profile=read('packages/combat-core/rs-profile.json');
const proof=JSON.parse(gunzipSync(readFileSync(new URL('../../artifacts/rs/source-proof/runtime-pose-full.json.gz',import.meta.url))));

for(const name of ['Wait_W0','Wait_W1','Fatal'])test(`published RS original ${name} supports current pose and transition to movement`,()=>{
  const original=proof.clips.find(clip=>clip.name===name),published=pose.clips.find(clip=>clip.name===name);
  assert.ok(original,'Independent retained original conversion contains '+name);
  assert.ok(published,'Published pose contains '+name);
  assert.ok(isDeepStrictEqual(published,original),'Runtime pack retains original compact pose and clocks');
  const unsupported=[],samplers=createNativeSamplers({characterPose:pose,profile,effectIndex:{templates:{}},effectPoses:{},onUnsupported:value=>unsupported.push(value)});
  const actor={id:'rs',professionId:'RS',x:0,y:0,z:0,facing:1,animationName:name,animationTime:.1,animationLoop:true};
  assert.ok(samplers.defenderSampler(actor).length>0);
  assert.ok(samplers.motionOffsetSampler(actor));
  actor.animationName='Walk';actor.animationTime=.02;
  actor.presentationTransition={enabled:true,fromName:name,fromTime:.1,fromSpeed:1,fromLoop:true,durationSeconds:.1,elapsedSeconds:.02};
  assert.ok(samplers.defenderSampler(actor).length>0);
  assert.ok(samplers.motionOffsetSampler(actor));
  assert.deepEqual(unsupported,[]);
});
