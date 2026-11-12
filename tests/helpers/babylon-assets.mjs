// Headless loader for the actual converted assets. Only textures are omitted:
// the original node hierarchy, geometry, skin bindings and animation bytes stay intact.
import { readFileSync } from 'node:fs';
import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from '@babylonjs/loaders/glTF/index.js';

export function readGlb(filename) {
  const bytes = readFileSync(filename);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid GLB');
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  const binary = bytes.subarray(28 + length);
  return { json, binary, accessor(index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    const method = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8' }[a.componentType];
    const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || width * size;
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => binary[method](start + i * stride + j * size)));
  } };
}

export async function loadPoseContainer(scene, filename, {materials=false}={}) {
  const source = readGlb(filename), json = structuredClone(source.json), binary = source.binary;
  if(materials){
    // Keep real exported material slots/flags for headless material regressions;
    // only texture I/O requires a browser. PNG bytes are checked separately.
    for(const material of json.materials??[]){
      delete material.pbrMetallicRoughness?.baseColorTexture;
      delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
      delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;
    }
  }else{
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
    delete json.materials;
  }
  delete json.textures; delete json.images; delete json.samplers;
  const loader = new GLTFFileLoader();
  loader.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
  return loader.loadAssetContainerAsync(scene, { json, bin: {
    byteLength: binary.length,
    readAsync: async (offset, count) => new Uint8Array(binary.buffer, binary.byteOffset + offset, count),
  } }, '', undefined, String(filename));
}
