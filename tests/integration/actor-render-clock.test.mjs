import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { NullEngine, Scene, FreeCamera, Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { loadPoseContainer } from '../helpers/babylon-assets.mjs';
import { createActorView, sampleAnimation, placeActor } from '../../apps/web/actor-presentation.mjs';
import { createPoseAudit } from '../../apps/web/pose-audit.mjs';
import { createActorRenderClock, captureActorPresentation, interpolateActorPresentation } from '../../apps/web/actor-render-clock.mjs';
import { hasVisibleSuperArmor, updateActorArmorPresentation } from '../../apps/web/armor-presentation.mjs';

const state = (override = {}) => ({ id: 'RF', x: 2000, y: 2800, z: 37, facing: 1,
  state: 'RSI_DASH', stateSerial: 1, animationName: 'Dash', animationTime: .2,
  animationLoop: true, animationTransitionSerial: 1, presentationTransition: null,
  consumeRootTranslation: true, deathAlpha: 1, core: { phase: 'idle', animationName: 'Wait', animationTime: .3, x: 2000, y: 2900, z: 37 }, ...override });

test('30% movement at 90/120/144/165 Hz eliminates known fixed-tick stair steps without extrapolating', t => {
  const speed = 725 * 1.3, fixed = 1 / 60;
  const measurements = [];
  for (const hz of [90, 120, 144, 165]) {
    const clock = createActorRenderClock();
    let actor = state({ x: 0, animationTime: 0 }), tick = 0;
    clock.reset([actor]);
    const old = [], shown = [];
    for (let n = 0; n < hz * 2; n++) {
      const time = n / hz;
      while ((tick + 1) * fixed <= time + 1e-12) {
        tick++;
        actor.x = speed * tick * fixed; actor.animationTime = 1.3 * tick * fixed;
        clock.push([actor]);
      }
      const alpha = Math.max(0, Math.min(1, (time - tick * fixed) / fixed));
      const display = clock.sample([actor], alpha)[0];
      old.push(actor.x); shown.push(display.x);
      assert.ok(display.x <= actor.x + 1e-10, 'never draw an unexecuted future position');
      if (tick) assert.ok(display.x >= speed * (tick - 1) * fixed - 1e-10);
      assert.equal(actor.animationTime, 1.3 * tick * fixed, 'sampling cannot alter combat clock');
    }
    // Exclude initialization before two complete fixed snapshots exist.
    const delta = a => a.slice(6).map((x, i) => x - a[i + 5]);
    const oldD = delta(old), newD = delta(shown);
    const variance = a => { const mean = a.reduce((s,x)=>s+x,0)/a.length; return a.reduce((s,x)=>s+(x-mean)**2,0)/a.length; };
    const record = { hz, speedNativePerSecond: speed, previousRepeatedFrames: oldD.filter(x => x === 0).length,
      interpolatedRepeatedFrames: newD.filter(x => x === 0).length,
      previousStepVariance: variance(oldD), interpolatedStepVariance: variance(newD) };
    assert.ok(record.previousRepeatedFrames > 0); assert.equal(record.interpolatedRepeatedFrames, 0);
    assert.ok(record.interpolatedStepVariance < 1e-20); measurements.push(record);
  }
  t.diagnostic(JSON.stringify(measurements));
});

test('render capture never retains mutable simulation pose references; clocks and core use one fraction', () => {
  const clock = createActorRenderClock(), actor = state();
  actor.presentationTransition = { serial: 1, elapsedSeconds: .1, enabled: true, retainedPose: { animationTime: .2 } };
  clock.reset([actor]);
  actor.x += 10; actor.animationTime += .02; actor.presentationTransition.elapsedSeconds += .02;
  actor.presentationTransition.retainedPose.animationTime += .1;
  actor.core.x += 10; actor.core.animationTime += .02; clock.push([actor]);
  const before = JSON.stringify(actor), shown = clock.sample([actor], .25)[0];
  assert.equal(shown.x, 2002.5); assert.ok(Math.abs(shown.animationTime - .205) < 1e-14);
  assert.ok(Math.abs(shown.presentationTransition.elapsedSeconds - .105) < 1e-14);
  assert.equal(shown.core.x, 2002.5); assert.ok(Math.abs(shown.core.animationTime - .305) < 1e-14);
  assert.equal(JSON.stringify(actor), before);
  assert.equal(clock.sample([actor], .25, { exact: true })[0], actor);
  clock.reset([actor]); assert.equal(clock.sample([actor], 0)[0].x, actor.x);
});

test('state/loop/transition/core phase changes do not interpolate backwards or invent a pose', () => {
  const previous = captureActorPresentation(state());
  for (const override of [{ stateSerial: 2, animationTime: .001 }, { animationName: 'DashComboZ1', animationTime: .001 },
    { animationTransitionSerial: 2, animationTime: .001 }, { animationTime: .001 }]) {
    const current = state(override), shown = interpolateActorPresentation(previous, current, .25);
    assert.equal(shown.animationTime, current.animationTime);
  }
  const frozen = state({ animationTime: previous.animationTime, superArmor: true, invincible: true });
  assert.equal(interpolateActorPresentation(previous, frozen, .25).animationTime, previous.animationTime);
  const coreChanged = state({ core: { phase: 'attack', animationName: 'Attack3', animationTime: .01, x: 2200, y: 2900, z: 37 } });
  assert.deepEqual(interpolateActorPresentation(previous, coreChanged, .5).core, coreChanged.core);
  assert.throws(() => interpolateActorPresentation(previous, frozen, 2), /alpha/);
  assert.throws(() => interpolateActorPresentation(previous, frozen, NaN), /alpha/);
});

test('fractional 30% clocks render original RF skeletons exactly; no bone smoothing/animatable added',
  { skip: !existsSync(new URL('../../artifacts/rf/rf.glb', import.meta.url)) }, async t => {
  const engine = new NullEngine(); engine.getCaps().maxVertexUniformVectors = 1024;
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.skipFrustumClipping = true;
  new FreeCamera('camera', new Vector3(0, 0, 10), scene);
  try {
    const file = s => new URL('../../artifacts/rf/' + s, import.meta.url);
    const container = await loadPoseContainer(scene, file('rf.glb'));
    const source = JSON.parse(gunzipSync(readFileSync(file('pose-tracks.json.gz'))));
    const view = createActorView(container, scene, 'RF', .01, source), audit = createPoseAudit(source);
    await scene.whenReadyAsync();
    let count = 0, maximumErrorNative = 0;
    for (const clip of source.clips) {
      const duration = clip.durationSeconds ?? Math.max(...clip.tracks.flatMap(track => ['translation', 'rotation', 'scale'].map(k => track[k].times.at(-1))));
      const a = state({ animationName: clip.name, animationLoop: false, animationTime: duration * .4 });
      const b = state({ animationName: clip.name, animationLoop: false, animationTime: duration * .4 + (1 / 60) * 1.3, x: 2000 + 725 * 1.3 / 60 });
      const shown = interpolateActorPresentation(captureActorPresentation(a), b, .37);
      sampleAnimation(view, shown.animationName, shown.animationTime, shown.animationLoop); placeActor(view, shown); scene.render();
      const result = audit(view, shown); assert.deepEqual(result.missing, []);
      assert.ok(result.maximumErrorNative <= .002, clip.name + ': ' + result.maximumErrorNative);
      count++; maximumErrorNative = Math.max(maximumErrorNative, result.maximumErrorNative);
    }
    assert.equal(count, 167);
    assert.ok(view.groups.every(group => !group.isPlaying));
    t.diagnostic(JSON.stringify({ clips: count, comparedNodes: count * source.frames.length, maximumErrorNative }));
  } finally { scene.dispose(); engine.dispose(); }
});

test('visible armor color and hidden default match frozen original source bytes',
  { skip: !existsSync(new URL('../../.cache/native-reference/KTDXLIB/KTDGXRenderer.cpp', import.meta.url)) }, () => {
    const contract = JSON.parse(readFileSync(new URL('../../contracts/rf-render-stability-source-v7.json', import.meta.url)));
    const documents = {};
    for (const [name, declaration] of Object.entries(contract.findings)) {
      if (!declaration.sha256) continue;
      const data = readFileSync(new URL('../../' + declaration.path, import.meta.url));
      assert.equal(createHash('sha256').update(data).digest('hex'), declaration.sha256);
      documents[name] = data.toString('latin1');
    }
    assert.match(documents.visibleArmor, /if\( IsSuperArmor\(\) && m_FrameDataNow\.stateParam\.bSuperArmorNotRed == false\)/);
    assert.match(documents.visibleArmor, /pRenderParam->outLineColor = 0xffff0000/);
    assert.match(documents.visibleArmor, /LUA_GET_VALUE\( m_LuaManager, "SUPER_ARMOR_NOT_RED", bSuperArmorNotRed,\s*true \)/);
    assert.doesNotMatch(documents.cartoonRenderer + documents.cartoonEnum, /CartoonSuperArmor/i);
  });

test('source visible-armor gate updates and restores every skin-aware outline independently', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const meshes = [MeshBuilder.CreateBox('a', {}, scene), MeshBuilder.CreateBox('b', {}, scene)];
    for (const mesh of meshes) { mesh.renderOutline = true; mesh.outlineColor = new Color3(.05, .04, .06); mesh.outlineWidth=1.15; }
    const view = { meshes };
    assert.equal(hasVisibleSuperArmor({ superArmor: true }), false, 'source default is hidden edge');
    assert.equal(hasVisibleSuperArmor({ superArmor: true }, { SUPER_ARMOR_NOT_RED: 0 }), true);
    assert.equal(hasVisibleSuperArmor({ superArmor: false }, { SUPER_ARMOR_NOT_RED: 0 }), false);
    assert.equal(hasVisibleSuperArmor({ superArmor: true, superArmorNotRed: true }, { SUPER_ARMOR_NOT_RED: 0 }), false);
    assert.equal(hasVisibleSuperArmor({superArmor:true,superArmorNotRed:true},{},{showAll:true}),true,
      'requested visible outlines expose real hidden-source armor without granting protection');
    assert.equal(hasVisibleSuperArmor({superArmor:false},{},{showAll:true}),false);
    updateActorArmorPresentation(view,{superArmor:true,superArmorNotRed:true},{},{showAll:true});
    assert.equal(view.armorPresentation.active,true);assert.equal(view.armorPresentation.sourceGateActive,false);
    for(const mesh of meshes)assert.deepEqual(mesh.outlineColor.asArray(),[1,0,0]);
    updateActorArmorPresentation(view, { superArmor: true }, { SUPER_ARMOR_NOT_RED: 0 });
    for (const mesh of meshes) { assert.deepEqual(mesh.outlineColor.asArray(), [1, 0, 0]); assert.equal(mesh.outlineWidth,2.875); }
    updateActorArmorPresentation(view, { superArmor: false }, { SUPER_ARMOR_NOT_RED: 0 });
    for (const mesh of meshes) { assert.deepEqual(mesh.outlineColor.asArray(), [.05, .04, .06]); assert.equal(mesh.outlineWidth,1.15); }
  } finally { scene.dispose(); engine.dispose(); }
});
