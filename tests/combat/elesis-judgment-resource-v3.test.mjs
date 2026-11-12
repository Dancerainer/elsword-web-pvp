/** Original Judgment follow-up carrier and visual dependencies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';

const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(p,'utf8'));
const assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
const profile=read(resolve(root,'packages/combat-core/gm-profile.json'));
const index=read(resolve(assets,'gm/fx/index.json'));
const name='SA_SSK_JUDGEMENT_DRIVE_M03',template=index.templates[name];
const native=read(resolve(assets,'gm',template.poseData));

test('Judgment retains original damage and all resolvable layers in its source set',()=>{
  const source=profile.effectSets.EffectSet_SA_SSK_JUDGEMENT_DAMAGE.raw;
  assert.equal(source.EFFECT0.NAME,name);
  assert.equal(source.EFFECT0.POSITION_OFFSET_X,-200);assert.equal(source.EFFECT0.POSITION_OFFSET_Y,50);
  for(const axis of ['X','Y','Z'])assert.equal(source.EFFECT0['SCALE_'+axis],1.3);
  const damage=profile.damageEffects[name].raw;
  assert.equal(damage.DAMAGE_DATA.APPLIED_SKILL_ID,28007);assert.equal(damage.DAMAGE_DATA.DAMAGE.PHYSIC,8.4);
  assert.equal(damage.ATTACK_TIME_START,.1);assert.equal(damage.ATTACK_TIME_END,.45);
  for(const layer of [name,'SA_SSK_JUDGEMENT_DRIVE_M02','SA_ALH_PEERLESSNESS_SLASH_END_P02','SI_SA_ALH_DESCENT_DRAGON_LED_Eye']){
    assert.ok(index.templates[layer]);assert.ok(profile.effectTemplates[layer]);
  }
  // This exact original declaration is absent; its spelling is never guessed.
  assert.ok(index.missingTemplates.includes('EffectSet_SA_SSK_JUDGEMENT_DRIVE'));
});

test('Judgment native carrier uses measured keys and original nonzero attack geometry',()=>{
  assert.equal(native.unsupportedTracks.length,0);
  assert.equal(native.clips[0].ticks_per_second,4800);assert.equal(native.clips[0].nativePlaybackField,0);
  assert.equal(native.helpers[0].name,'ATTACK_SPHERE1');
  assert.deepEqual(native.helpers[0].nativeLocalBounds,{min:[-140,-140,-140],max:[140,140,140]});
  const samplers=createNativeSamplers({profile,characterPose:read(resolve(root,'artifacts/gm/runtime-pose.json')),
    effectIndex:mergeEffectIndexes({templates:{}},index),effectPoses:{[template.poseData]:native}});
  for(const time of [.1,.2,.3,.4]){
    const shapes=samplers.effectSampler({name,damage:{MAIN_EFFECT_NAME:name},definition:{},
      birthAnchor:{position:[0,0,0],facing:1,customPosition:true},elapsed:time,animationTime:time},{});
    assert.equal(shapes.length,1);assert.equal(shapes[0].kind,'sphere');assert.ok(shapes[0].radius>0);
    assert.ok(shapes[0].center.every(Number.isFinite));
  }
});
