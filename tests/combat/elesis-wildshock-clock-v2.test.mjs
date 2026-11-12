/** Original shipped DLL keys restore the actual WildShock attack-box sampler. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';

const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(p,'utf8'));
const assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
const target='SI_SA_EL_WILD_SHOCK_ATTACK',file='fx/meshes/SI_SA_EL_WILD_SHOCK_ATTACKBOX.pose.json';
const pose=read(resolve(root,'artifacts/gm/runtime-pose.json'));
const profile=read(resolve(root,'packages/combat-core/gm-profile.json'));
const current=read(resolve(assets,'gm/fx/index.json'));
const native=read(resolve(assets,'gm',file));
function sample(index,effectPose,time){
  const normalized=mergeEffectIndexes({templates:{}},index);
  const sampler=createNativeSamplers({profile,characterPose:pose,effectIndex:normalized,effectPoses:{[file]:effectPose}});
  return sampler.effectSampler({name:target,damage:{MAIN_EFFECT_NAME:target},definition:{},
    birthAnchor:{position:[0,0,0],facing:1,customPosition:true},elapsed:time,animationTime:time},{});
}

test('measured original 4800-Hz Normal clip has every source channel without guessed TRS or clock',()=>{
  const manifest=read(resolve(root,'reports/elesis-fx-d3dx-keyframes-v1.json'));
  const evidence=manifest.sources.find(s=>s.sourceSha256==='d75fee688e1aaeaa537a38387c7a0ee2a176235f7469614c715fb568fef45940').animations[0];
  assert.equal(native.unsupportedTracks.length,0);assert.equal(native.clips.length,1);
  const clip=native.clips[0];
  assert.equal(clip.ticks_per_second,evidence.ticksPerSecond);assert.equal(clip.ticks_per_second,4800);
  assert.equal(clip.durationSeconds,evidence.period);assert.equal(clip.nativePlaybackField,evidence.playbackType);
  assert.deepEqual(clip.tracks.map(t=>t.frame_name).sort(),evidence.channels.map(c=>c.name).sort());
  assert.equal(current.templates[target].animationRequiresUnconfirmedRate,false);
});

test('integrated correction preserves the source zero-scale interval and restores the original sphere',()=>{
  const report=read(resolve(root,'reports/elesis-wildshock-clock-v2.json'));
  assert.equal(report.before.animationMissingTickRate,true);
  assert.equal(report.source.sha256,'d75fee688e1aaeaa537a38387c7a0ee2a176235f7469614c715fb568fef45940');
  // Source Dummy01 scale is exactly zero through tick 1280 (0.2666s).
  for(const time of [.1,.2])assert.equal(sample(current,native,time)[0].radius,0);
  for(const time of [.3,.35,.4]){
    const shapes=sample(current,native,time);assert.equal(shapes.length,1);
    assert.equal(shapes[0].kind,'sphere');assert.ok(shapes[0].radius>0);
    assert.equal(shapes[0].source.helper,'ATTACK_SPHERE1');assert.ok(shapes[0].center.every(Number.isFinite));
  }
});
