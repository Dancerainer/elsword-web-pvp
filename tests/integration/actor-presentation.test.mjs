import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { NullEngine, Scene, FreeCamera, Vector3, TransformNode, Animation, AnimationGroup } from '@babylonjs/core';
import { loadPoseContainer, readGlb } from '../helpers/babylon-assets.mjs';
import { createSkinAudit } from '../helpers/skin-audit.mjs';
import { createActorView, sampleAnimation, placeActor } from '../../apps/web/actor-presentation.mjs';
import { createPoseAudit } from '../../apps/web/pose-audit.mjs';

const root = new URL('../../', import.meta.url);
const assetFixture=process.env.ACTOR_ASSET_FIXTURE_ROOT?pathToFileURL(resolve(process.env.ACTOR_ASSET_FIXTURE_ROOT)+'/'):root;
const path = value => new URL(value, value.startsWith('artifacts/')?assetFixture:root);
const read = value => JSON.parse(readFileSync(path(value)));
const available = existsSync(path('artifacts/rf/rf-runtime.glb'));
function setup() {
  const engine = new NullEngine();
  engine.getCaps().maxVertexUniformVectors = 1024; // Headless only: no physical GPU to report this limit.
  const scene = new Scene(engine); scene.useRightHandedSystem = true;
  // These are pose/deformation tests. Make every source mesh render even when
  // an authored attack moves outside this headless camera's view.
  scene.skipFrustumClipping = true;
  new FreeCamera('camera', new Vector3(0, 0, 10), scene);
  return { scene, dispose() { scene.dispose(); engine.dispose(); } };
}
function actor(overrides = {}) { return { x: 2022.98, y: 2840, z: 37, facing: 1, applyMotionOffset: false, consumeRootTranslation:false, ...overrides }; }
function close(value, bound, message) { assert.ok(value <= bound, `${message}: ${value} > ${bound}`); }

test('zero-speed seek is overwritten by rendering; paused manual sampling survives render and repeated freeze', () => {
  const { scene, dispose } = setup();
  try {
    const bone = new TransformNode('bone', scene);
    const animation = new Animation('move', 'position.x', 60, Animation.ANIMATIONTYPE_FLOAT);
    animation.setKeys([{ frame: 0, value: 0 }, { frame: 60, value: 10 }]);
    const group = new AnimationGroup('walk', scene); group.addTargetedAnimation(animation, bone);
    group.start(true, 0); group.goToFrame(30); assert.equal(bone.position.x, 5);
    scene.render(); assert.equal(bone.position.x, 0, 'reproduce the previous browser bug'); group.stop();
    const view = { clips: new Map([['walk', group]]), group: null, resetBindPose() { bone.position.x = 0; } };
    assert.equal(sampleAnimation(view, 'walk', .5, true), true);
    assert.equal(group.isPlaying, false); assert.equal(view.sample.paused, true);
    assert.ok(group.animatables.every(a => a.paused));
    for (let i = 0; i < 12; i++) { scene.render(); assert.equal(bone.position.x, 5); }
    sampleAnimation(view, 'walk', 2.75, true); scene.render(); assert.equal(bone.position.x, 7.5);
    sampleAnimation(view, 'walk', 5, false); scene.render(); assert.equal(bone.position.x, 10);
    assert.equal(sampleAnimation(view, 'missing-native-clip', 0), false);
    assert.throws(() => sampleAnimation(view, 'walk', NaN));
    const fractional = new Animation('fractional', 'position.x', 60, Animation.ANIMATIONTYPE_FLOAT);
    fractional.setKeys([{ frame: 0, value: 0 }, { frame: Math.fround(1.3) * 60, value: 13 }]);
    const nativePeriod = new AnimationGroup('fractional', scene); nativePeriod.addTargetedAnimation(fractional, bone);
    view.clips.set('fractional', nativePeriod); view.sourceDurations = new Map([['fractional', 1.3]]);
    sampleAnimation(view, 'fractional', 1.3 - 1e-8, true); scene.render();
    assert.equal(bone.position.x, 13, 'float32 export end must not wrap earlier than the source period');
    sampleAnimation(view, 'fractional', 1.5, true); scene.render();
    close(Math.abs(bone.position.x - 2), 1e-6, 'looping must use the original source period');
  } finally { dispose(); }
});

test('all selected original RF clips survive Babylon rendering with independent clone poses and both root-motion policies', { skip: !available }, async t => {
  const { scene, dispose } = setup();
  try {
    const container = await loadPoseContainer(scene, path('artifacts/rf/rf-runtime.glb'));
    const source = JSON.parse(gunzipSync(readFileSync(path('artifacts/rf/pose-tracks.json.gz'))));
    const first = createActorView(container, scene, 'first', .01, source), second = createActorView(container, scene, 'second', .01, source);
    await scene.whenReadyAsync();
    const audit = createPoseAudit(source);
    const skinAudit = createSkinAudit(source, readGlb(path('artifacts/rf/rf-runtime.glb')));
    const stats = { clips: 0, renderedNodePoses: 0, deformedVertices: 0, maximumPoseErrorNative: 0, maximumSkinErrorNative: 0 };
    assert.deepEqual([...first.clips.keys()].sort(), read('artifacts/rf/manifest.json').runtimeCharacter.animations.toSorted());
    assert.equal(first.skeletons.length, 7); assert.equal(first.meshes.filter(m => m.getTotalVertices()).length, 8);
    for (const clip of source.clips.filter(c => first.clips.has(c.name))) {
      stats.clips++;
      const duration = Math.max(...clip.tracks.flatMap(t => ['translation', 'rotation', 'scale'].map(k => t[k].times.at(-1))));
      for (const fraction of [0, .23, .61, 1]) {
        const a = actor({ applyMotionOffset: true, consumeRootTranslation:true }), b = actor({ x: 1858.11, facing: -1 });
        sampleAnimation(first, clip.name, duration * fraction); placeActor(first, a);
        sampleAnimation(second, 'Wait', .37, true); placeActor(second, b);
        scene.render();
        for (const [view, state] of [[first, a], [second, b]]) {
          const result = audit(view, state);
          assert.deepEqual(result.missing, []); assert.equal(result.comparedNodes, source.frames.length);
          close(result.maximumErrorNative, .002, `${clip.name} at ${fraction}: ${result.worstNode}`);
          stats.renderedNodePoses += result.comparedNodes; stats.maximumPoseErrorNative = Math.max(stats.maximumPoseErrorNative, result.maximumErrorNative);
          const skin = skinAudit(view, state);
          close(skin.maximumErrorNative, .003, `${clip.name} deformed skin at ${fraction} ${JSON.stringify(skin.worst)}`);
          stats.deformedVertices += skin.vertices; stats.maximumSkinErrorNative = Math.max(stats.maximumSkinErrorNative, skin.maximumErrorNative);
        }
      }
    }
    // Animation targets and linked skin nodes must belong to their own actor.
    for (const view of [first, second]) {
      for (const skeleton of view.skeletons) for (const bone of skeleton.bones) {
        const linked = bone.getTransformNode();
        assert.ok(!linked || linked.name.startsWith(view.id + '_'));
      }
    }
    // Preserve authored displacement for explicit internal raw-pose inspection.
    sampleAnimation(first, 'SP2a_PowerAssault', .4); placeActor(first, actor()); scene.render();
    close(audit(first, actor()).maximumErrorNative, .002, 'non-consuming root pose');
    const before = [...first.bip01.getWorldMatrix().asArray()];
    for (let i = 0; i < 6; i++) scene.render();
    assert.deepEqual([...first.bip01.getWorldMatrix().asArray()], before, 'pause/hitstop must freeze the actual rendered pose');
    t.diagnostic(JSON.stringify(stats));
  } finally { dispose(); }
});

test('all seven original Nasod core clips use the same paused playback path after render', { skip: !available }, async t => {
  const { scene, dispose } = setup();
  try {
    const container = await loadPoseContainer(scene, path('artifacts/rf/effects/Motion_Raven_RageMode_Nasod.glb'));
    const source = read('artifacts/rf/effects/Motion_Raven_RageMode_Nasod.pose.json'), audit = createPoseAudit(source);
    const view = createActorView(container, scene, 'core', .01, source);
    assert.equal(view.clips.size, 7);
    const stats = { clips: 7, renderedNodePoses: 0, maximumPoseErrorNative: 0 };
    for (const clip of source.clips) {
      const duration = Math.max(...clip.tracks.flatMap(t => ['translation', 'rotation', 'scale'].map(k => t[k].times.at(-1))));
      for (const fraction of [0, .31, .73, 1]) {
        const state = actor({ x: 1700, y: 3000, facing: -1 });
        sampleAnimation(view, clip.name, duration * fraction); placeActor(view, state); scene.render();
        const result = audit(view, state);
        assert.deepEqual(result.missing, []); close(result.maximumErrorNative, .002, `${clip.name} at ${fraction}`);
        stats.renderedNodePoses += result.comparedNodes; stats.maximumPoseErrorNative = Math.max(stats.maximumPoseErrorNative, result.maximumErrorNative);
      }
    }
    t.diagnostic(JSON.stringify(stats));
  } finally { dispose(); }
});

test('all 167 clips in the full skill source model preserve every original skeletal node after render', { skip: !available }, async t => {
  const { scene, dispose } = setup();
  try {
    const container = await loadPoseContainer(scene, path('artifacts/rf/rf.glb'));
    const source = JSON.parse(gunzipSync(readFileSync(path('artifacts/rf/pose-tracks.json.gz')))), audit = createPoseAudit(source);
    const view = createActorView(container, scene, 'full-source', .01, source);
    const stats = { clips: 0, renderedNodePoses: 0, maximumPoseErrorNative: 0 };
    assert.equal(view.clips.size, 167);
    for (const clip of source.clips) {
      const duration = Math.max(...clip.tracks.flatMap(t => ['translation', 'rotation', 'scale'].map(k => t[k].times.at(-1))));
      const state = actor(); sampleAnimation(view, clip.name, duration * .47); placeActor(view, state); scene.render();
      const result = audit(view, state);
      assert.deepEqual(result.missing, []); close(result.maximumErrorNative, .002, clip.name);
      stats.clips++; stats.renderedNodePoses += result.comparedNodes; stats.maximumPoseErrorNative = Math.max(stats.maximumPoseErrorNative, result.maximumErrorNative);
    }
    t.diagnostic(JSON.stringify(stats));
  } finally { dispose(); }
});
