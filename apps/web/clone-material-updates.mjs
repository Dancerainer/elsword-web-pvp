import { Engine, Material, MultiMaterial } from '@babylonjs/core';

const dirtyMethod = Material.prototype._markAllSubMeshesAsDirty;

function restoreProperty(object, name, descriptor) {
  if (descriptor) Object.defineProperty(object, name, descriptor);
  else delete object[name];
}

/** Babylon 9.29's material setters scan every scene mesh, even while copying a
 * new material that has never prepared any submesh defines. SubMesh.clone makes
 * fresh draw caches; assigning its cloned material resets those caches again.
 * Skip only that new instance's empty dirty scans during synchronous cloning.
 * Keep serialization, plugins, prepass and cached-material invalidation intact.
 * Public blockDirtyMechanism is unsuitable: releasing it scans the scene again.
 */
export function cloneWithFreshMaterialUpdates(container, scene, clone) {
  if (Engine.Version !== '9.29.0') return clone();
  const sources = new Set([...container.materials, ...container.multiMaterials]);
  for (const material of sources) for (const child of material?.subMaterials ?? []) sources.add(child);
  const restorers = [];
  const gate = material => {
    if (!material || sources.has(material) || material.getScene() !== scene
      || material._markAllSubMeshesAsDirty !== dirtyMethod
      || scene.materials[material._indexInSceneMaterialArray] === material
      || (material instanceof MultiMaterial && scene.multiMaterials.includes(material))) return;
    if (['_markAllSubMeshesAsDirty', 'isReady', 'isReadyForSubMesh'].some(name =>
      Object.getOwnPropertyDescriptor(material, name)?.configurable === false)) return;
    const properties = new Map();
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      for (const [name, { descriptor, value }] of properties) {
        // A plugin can replace an instance method while copying its settings.
        if (material[name] === value) restoreProperty(material, name, descriptor);
      }
    };
    const replace = (name, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(material, name);
      Object.defineProperty(material, name, { configurable: true, writable: true, value,
        enumerable: descriptor?.enumerable ?? false });
      properties.set(name, { descriptor, value });
    };
    restorers.push(restore);
    replace('_markAllSubMeshesAsDirty', function (...args) {
      // A plugin's copyTo may replace a readiness wrapper, then prepare defines
      // synchronously through its replacement. The next dirty request must use
      // the original scan, and restoration must retain the plugin's method.
      if (material.isReady !== properties.get('isReady')?.value
        || material.isReadyForSubMesh !== properties.get('isReadyForSubMesh')?.value) {
        restore();
        return Reflect.apply(dirtyMethod, this, args);
      }
    });
    // A synchronous plugin may prepare/render a new material before clone ends.
    // Restore BEFORE its first readiness call can create compiled defines.
    for (const name of ['isReady', 'isReadyForSubMesh']) {
      const ready = material[name];
      if (typeof ready === 'function') replace(name, function (...args) {
        restore();
        return Reflect.apply(ready, this, args);
      });
    }
  };
  const sceneProperties = new Map();
  try {
    for (const name of ['addMaterial', 'addMultiMaterial']) {
      const descriptor = Object.getOwnPropertyDescriptor(scene, name), add = scene[name];
      sceneProperties.set(name, descriptor);
      Object.defineProperty(scene, name, { configurable: true, writable: true,
        enumerable: descriptor?.enumerable ?? false, value: function (...args) {
          if (this === scene) gate(args[0]);
          return Reflect.apply(add, this, args);
        } });
    }
    return clone();
  } finally {
    for (let i = restorers.length - 1; i >= 0; i--) restorers[i]();
    for (const [name, descriptor] of sceneProperties) restoreProperty(scene, name, descriptor);
  }
}
