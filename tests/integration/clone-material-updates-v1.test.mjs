import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssetContainer, Color3, Engine, FreeCamera, Material, MeshBuilder, MorphTarget,
  MorphTargetManager, MultiMaterial, NullEngine, PBRMaterial, RenderTargetTexture,
  Scene, Texture, Vector3 } from '@babylonjs/core';
import { cloneWithFreshMaterialUpdates } from '../../apps/web/clone-material-updates.mjs';
import { createActorView } from '../../apps/web/actor-presentation.mjs';
import { loadPoseContainer } from '../helpers/babylon-assets.mjs';

function setup() {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.getCaps().maxVertexUniformVectors = 1024;
  scene.skipFrustumClipping = true;
  new FreeCamera('camera', new Vector3(0, 0, -10), scene);
  return { scene, dispose() { scene.dispose(); engine.dispose(); } };
}
function fixture(scene, { multi = false, textures = false, morph = false } = {}) {
  const material = new PBRMaterial('source', scene);
  material.albedoColor = new Color3(.2, .4, .6); material.metallic = .37;
  material.roughness = .62; material.backFaceCulling = false;
  const mesh = MeshBuilder.CreateBox('mesh', {}, scene);
  mesh.material = material;
  const container = new AssetContainer(scene);
  container.meshes.push(mesh); container.materials.push(material);
  if (multi) {
    const shared = new MultiMaterial('multi', scene);
    shared.subMaterials = [material, material, null]; mesh.material = shared;
    container.multiMaterials.push(shared);
  }
  if (textures) {
    const ordinary = new Texture(null, scene); ordinary.name = 'ordinary';
    const target = new RenderTargetTexture('target', 16, scene);
    material.albedoTexture = ordinary; material.emissiveTexture = ordinary;
    material.reflectionTexture = target;
    container.textures.push(ordinary, target);
  }
  if (morph) {
    const manager = new MorphTargetManager(scene), target = MorphTarget.FromMesh(mesh, 'morph', .2);
    manager.addTarget(target); mesh.morphTargetManager = manager;
    container.morphTargetManagers.push(manager);
  }
  container.removeAllFromScene();
  return { container, material, mesh };
}
const instantiate = container => container.instantiateModelsToScene(name => 'clone_' + name, true, { doNotInstantiate: true });
function cleanSerialized(value) {
  if (Array.isArray(value)) return value.map(cleanSerialized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['uniqueId', 'id'].includes(key))
    .map(([key, child]) => [key, cleanSerialized(child)]));
}
function materialState(material) { return cleanSerialized(material.serialize()); }
function defineState(mesh) {
  const defines = mesh.subMeshes[0].materialDefines;
  assert.ok(defines, 'production PBR readiness must create real defines');
  return defines.toString();
}
function countIterations(scene, fn) {
  const meshes = scene.meshes, iterator = meshes[Symbol.iterator]; let visits = 0;
  Object.defineProperty(meshes, Symbol.iterator, { configurable: true, value: function* () {
    for (const item of Reflect.apply(iterator, this, [])) { visits++; yield item; }
  } });
  try { return { result: fn(), visits: () => visits }; }
  finally { delete meshes[Symbol.iterator]; }
}

test('single-mesh clone preserves serialization, fresh defines and independent views after source render', async () => {
  const snapshots = [];
  for (const optimized of [false, true]) {
    const { scene, dispose } = setup();
    try {
      const { container, mesh, material } = fixture(scene);
      container.addAllToScene(); await scene.whenReadyAsync(); scene.render();
      assert.ok(mesh.subMeshes[0].materialDefines);
      const oldWrapper = mesh.subMeshes[0]._drawWrapper;
      const make = () => optimized ? cloneWithFreshMaterialUpdates(container, scene, () => instantiate(container)) : instantiate(container);
      const first = make(), second = make();
      const a = first.rootNodes[0], b = second.rootNodes[0];
      assert.notEqual(a.material, material); assert.notEqual(a.material, b.material);
      assert.notEqual(a.subMeshes[0]._drawWrapper, oldWrapper);
      assert.equal(a.subMeshes[0].materialDefines, null);
      assert.equal(Object.hasOwn(a.material, '_markAllSubMeshesAsDirty'), false);
      await scene.whenReadyAsync(); scene.render();
      snapshots.push({ source: materialState(material), clone: materialState(a.material),
        firstDefines: defineState(a), secondDefines: defineState(b) });
      a.subMeshes[0].materialDefines.markAsProcessed();
      b.subMeshes[0].materialDefines.markAsProcessed();
      a.material.backFaceCulling = true;
      assert.equal(a.subMeshes[0].materialDefines.isDirty, true);
      assert.equal(b.subMeshes[0].materialDefines.isDirty, false);
    } finally { dispose(); }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

test('shared MultiMaterial, ordinary texture copies, render targets and morphs retain Babylon clone behavior', () => {
  const snapshots = [];
  for (const optimized of [false, true]) {
    const { scene, dispose } = setup();
    try {
      const { container, mesh, material } = fixture(scene, { multi: true, textures: true, morph: true });
      const sourceMulti = mesh.material, originalTexture = material.albedoTexture, originalTarget = material.reflectionTexture;
      const clone = optimized ? cloneWithFreshMaterialUpdates(container, scene, () => instantiate(container)) : instantiate(container);
      const child = clone.rootNodes[0], copied = scene.materials.find(m => m !== material);
      assert.notEqual(copied.albedoTexture, originalTexture);
      assert.equal(copied.albedoTexture, copied.emissiveTexture);
      assert.equal(copied.reflectionTexture, originalTarget);
      assert.notEqual(child.morphTargetManager, mesh.morphTargetManager);
      assert.equal(child.morphTargetManager.getTarget(0).influence, .2);
      snapshots.push({ source: materialState(material), copied: materialState(copied),
        // Babylon 9.29 changes SOURCE multi.subMaterials in its existing clone path.
        // Preserve that upstream behavior rather than folding a second fix into this gate.
        sourcePointsToCopy: sourceMulti.subMaterials[0] === copied,
        clonePointsToSource: child.material.subMaterials[0] === material,
        sharedSlots: child.material.subMaterials[0] === child.material.subMaterials[1] });
    } finally { dispose(); }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
  assert.equal(snapshots[1].sharedSlots, true);
});

test('existing rendered materials remain dirtyable inside cloning; synchronous new-material compile disables its gate', async () => {
  const { scene, dispose } = setup();
  try {
    const { container } = fixture(scene);
    const old = MeshBuilder.CreateBox('existing', {}, scene);
    old.material = new PBRMaterial('existing', scene);
    await scene.whenReadyAsync(); scene.render();
    old.subMeshes[0].materialDefines.markAsProcessed();
    cloneWithFreshMaterialUpdates(container, scene, () => {
      old.material.backFaceCulling = false;
      assert.equal(old.subMeshes[0].materialDefines.isDirty, true);
      const fresh = new PBRMaterial('fresh', scene);
      assert.equal(Object.hasOwn(fresh, '_markAllSubMeshesAsDirty'), true);
      fresh.albedoTexture = new Texture(null, scene);
      fresh.albedoTexture.isBlocking = true;
      old.material = fresh;
      const ready = fresh.isReadyForSubMesh(old, old.subMeshes[0]);
      assert.equal(ready, false, 'an unloaded blocking texture prevents material readiness');
      assert.equal(Object.hasOwn(fresh, '_markAllSubMeshesAsDirty'), false);
      const defines = old.subMeshes[0].materialDefines;
      assert.ok(defines);
      defines.markAsProcessed(); fresh.backFaceCulling = false;
      assert.equal(defines.isDirty, true, 'ready may return false but its defines must still be invalidated');
    });
  } finally { dispose(); }
});

test('a plugin replacing readiness during clone retains its method and cannot hide later define changes', () => {
  const { scene, dispose } = setup();
  try {
    const { container } = fixture(scene);
    const old = MeshBuilder.CreateBox('existing', {}, scene);
    old.material = new PBRMaterial('existing', scene);
    let fresh;
    const replacement = function (...args) {
      return Reflect.apply(PBRMaterial.prototype.isReadyForSubMesh, this, args);
    };
    cloneWithFreshMaterialUpdates(container, scene, () => {
      fresh = new PBRMaterial('fresh-plugin', scene);
      fresh.albedoTexture = new Texture(null, scene);
      fresh.albedoTexture.isBlocking = true;
      old.material = fresh;
      // Equivalent to a serialized plugin's copyTo replacing the ready entry.
      fresh.isReadyForSubMesh = replacement;
      assert.equal(fresh.isReadyForSubMesh(old, old.subMeshes[0]), false);
      const defines = old.subMeshes[0].materialDefines;
      assert.ok(defines, 'the actual PBR readiness path prepares defines even when not ready');
      defines.markAsProcessed();
      assert.equal(defines.isDirty, false);
      fresh.backFaceCulling = false;
      assert.equal(defines.isDirty, true);
      assert.equal(Object.hasOwn(fresh, '_markAllSubMeshesAsDirty'), false);
      assert.equal(fresh.isReadyForSubMesh, replacement);
    });
    assert.equal(fresh.isReadyForSubMesh, replacement, 'finally preserves the plugin replacement');
    assert.equal(Object.hasOwn(fresh, 'isReady'), false);
  } finally { dispose(); }
});

test('nested and throwing clone calls restore exact descriptors, this/return values, and custom dirty methods', () => {
  const { scene, dispose } = setup();
  try {
    const { container, material } = fixture(scene);
    const originalAdd = scene.addMaterial, added = [];
    Object.defineProperty(scene, 'addMaterial', { configurable: true, writable: true, enumerable: true,
      value: function (...args) { assert.equal(this, scene); added.push(args[0]); Reflect.apply(originalAdd, this, args); return 41; } });
    const before = Object.getOwnPropertyDescriptor(scene, 'addMaterial');
    let outer, inner;
    class CustomMaterial extends PBRMaterial { _markAllSubMeshesAsDirty(callback) { this.customCalls = (this.customCalls ?? 0) + 1; return super._markAllSubMeshesAsDirty(callback); } }
    const custom = cloneWithFreshMaterialUpdates(container, scene, () => {
      const value = new CustomMaterial('custom', scene); value.backFaceCulling = false; return value;
    });
    assert.ok(custom.customCalls > 0);
    assert.equal(Object.hasOwn(custom, '_markAllSubMeshesAsDirty'), false);
    const failure = new Error('clone failed');
    assert.throws(() => cloneWithFreshMaterialUpdates(container, scene, () => {
      outer = new PBRMaterial('outer', scene);
      const outerAdd = scene.addMaterial;
      cloneWithFreshMaterialUpdates(container, scene, () => { inner = new PBRMaterial('inner', scene); });
      assert.equal(scene.addMaterial, outerAdd);
      assert.equal(Object.hasOwn(outer, '_markAllSubMeshesAsDirty'), true);
      assert.equal(Object.hasOwn(inner, '_markAllSubMeshesAsDirty'), false);
      assert.equal(scene.addMaterial(material), 41, 'original method return must survive');
      assert.equal(Object.hasOwn(material, '_markAllSubMeshesAsDirty'), false, 'source is never gated');
      throw failure;
    }), error => error === failure);
    assert.deepEqual(Object.getOwnPropertyDescriptor(scene, 'addMaterial'), before);
    assert.equal(Object.hasOwn(scene, 'addMultiMaterial'), false);
    for (const fresh of [outer, inner]) for (const name of ['_markAllSubMeshesAsDirty', 'isReady', 'isReadyForSubMesh'])
      assert.equal(Object.hasOwn(fresh, name), false);
    assert.ok(added.includes(inner));
  } finally { dispose(); }
});

test('unknown Babylon versions retain the original clone path', () => {
  const { scene, dispose } = setup(), descriptor = Object.getOwnPropertyDescriptor(Engine, 'Version');
  try {
    const { container } = fixture(scene), originalAdd = scene.addMaterial;
    Object.defineProperty(Engine, 'Version', { configurable: true, value: 'unknown-version' });
    const result = cloneWithFreshMaterialUpdates(container, scene, () => {
      assert.equal(scene.addMaterial, originalAdd);
      return new PBRMaterial('ungated', scene);
    });
    assert.equal(Object.hasOwn(result, '_markAllSubMeshesAsDirty'), false);
  } finally { Object.defineProperty(Engine, 'Version', descriptor); dispose(); }
});

test('new-material gates retain cached-material and prepass invalidation outside the empty mesh scan', () => {
  const { scene, dispose } = setup();
  try {
    const { container } = fixture(scene);
    let prepassInvalidations = 0;
    const enable = scene.enablePrePassRenderer;
    scene.enablePrePassRenderer = () => ({ markAsDirty() { prepassInvalidations++; } });
    try {
      cloneWithFreshMaterialUpdates(container, scene, () => {
        const fresh = new PBRMaterial('fresh', scene);
        scene._cachedMaterial = fresh;
        fresh.markAsDirty(Material.TextureDirtyFlag);
        assert.equal(scene._cachedMaterial, null);
        fresh.subSurface.isScatteringEnabled = true;
        assert.ok(fresh.pluginManager._activePlugins.includes(fresh.subSurface), 'plugin activation still runs');
        fresh._markScenePrePassDirty();
        assert.equal(prepassInvalidations, 1);
      });
    } finally { scene.enablePrePassRenderer = enable; }
  } finally { dispose(); }
});

const assetRoot = process.env.ACTOR_CLONE_ASSET_ROOT ?? resolve('artifacts');
const fateFile = resolve(assetRoot, 'ca/fx/meshes/SCA_FATE_SMASHER_P01.glb');
test('real Fate 78-mesh clones keep material and first-frame defines while avoiding repeated whole-scene walks',
  { skip: !existsSync(fateFile) }, async t => {
    const snapshots = [], visits = [];
    for (const optimized of [false, true]) {
      const { scene, dispose } = setup();
      try {
        const container = await loadPoseContainer(scene, fateFile, { materials: true });
        assert.equal(container.meshes.filter(m => m.getTotalVertices()).length, 78);
        for (let i = 0; i < 250; i++) MeshBuilder.CreateBox('background-' + i, {}, scene);
        const measured = countIterations(scene, () => optimized
          ? createActorView(container, scene, 'fate')
          : instantiate(container));
        visits.push(measured.visits());
        const meshes = optimized ? measured.result.meshes : measured.result.rootNodes.flatMap(n => [n, ...n.getChildMeshes()]);
        const visible = meshes.filter(m => m.getTotalVertices?.());
        assert.equal(visible.length, 78);
        assert.ok(visible.every(m => !m.subMeshes.some(s => s.materialDefines)));
        await scene.whenReadyAsync(); scene.render();
        snapshots.push(visible.map(m => ({ material: materialState(m.material), defines: defineState(m) })));
      } finally { dispose(); }
    }
    // Both clone call sites deliberately use different prefixes, normalize those only.
    const normalized = snapshots.map(rows => JSON.stringify(rows).replaceAll('clone_', '').replaceAll('fate_', ''));
    assert.equal(normalized[1], normalized[0]);
    assert.ok(visits[0] > visits[1] * 10, `mesh visits baseline=${visits[0]}, gated=${visits[1]}`);
    t.diagnostic(JSON.stringify({ meshes: 78, baselineMeshVisits: visits[0], gatedMeshVisits: visits[1] }));
  });
