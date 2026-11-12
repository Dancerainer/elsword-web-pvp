/** Load the exact same compiled source modules in the browser and replay tool. */
import {createNativeGeometry} from './geometry.mjs';
import {instantiateNativeCamera} from './camera.mjs';
import {createNativeCommands,createNativeCommandsRecovery} from './commands.mjs';
import {instantiateNativeSkills} from './skills.mjs';
import {instantiateNativeSkillValues} from './skill-values.mjs';
import {instantiateNativeEffectRandom} from './effect-random.mjs';
import {instantiateNativeNasod} from './nasod.mjs';
import {instantiateNativeCritical} from './critical.mjs';
import {instantiateNativeManaBreak} from './mana-break.mjs';
import {NATIVE_RUNTIME_SUPPORTED,NATIVE_RUNTIME_VERSION} from './runtime-version.mjs';
import {sha256Hex as digest} from './sha256.mjs';

const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):
  v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(value));
async function validateCurrentSeal(manifest){
  const seal=manifest.seal,content={...manifest};delete content.seal;
  if(seal?.schemaVersion!==1||seal.moduleCount!==10||await digest(new TextEncoder().encode(canonical(content)))!==seal.manifestContentSha256)
    throw new TypeError('Native manifest seal mismatch');
  const modules=['geometry','camera','commands','skills','skill-values','effect-random','commands-recovery','nasod','critical','mana-break'];
  if(!manifest.modules||Object.keys(manifest.modules).length!==modules.length||modules.some(n=>!manifest.modules[n]))
    throw new TypeError('Native module seal inventory mismatch');
  const contracts=['artifacts/native/commands-recovery/source-contract.json','contracts/rf-native-nasod-v11.json',
    '.cache/native-critical-generated/module-entry.json','contracts/rf-critical-source-v11.json',
    'contracts/rf-mana-break-source-v12.json','.cache/native-mana-build/module-entry.json','.cache/native-mana-build/execution.json'];
  if(manifest.runtimeVersion==='original-source-functions-v11')contracts.push('contracts/rf-native-skills-arc-v19.json');
  if(!seal.sourceContracts||Object.keys(seal.sourceContracts).length!==contracts.length||
    contracts.some(p=>!/^[0-9a-f]{64}$/.test(seal.sourceContracts[p])))throw new TypeError('Native source-contract seal inventory mismatch');
  const mana=manifest.modules?.['mana-break'];
  if(mana?.sourceCommit!==manifest.referenceCommit||mana.sourceContract!=='contracts/rf-mana-break-source-v12.json'||mana.compilationStatus!=='compiled'||
    mana.compilation?.moduleSha256!==mana.sha256||!/^[0-9a-f]{64}$/.test(mana.compilation?.translationUnitSha256??'')||
    !/^[0-9a-f]{64}$/.test(mana.compilation?.compilerExeSha256??'')||mana.originalFunctions?.length!==6)
    throw new TypeError('Native Mana Break source pairing mismatch');
}

export async function createNativeRuntime({manifest,loadBinary,map}={}) {
  if(manifest?.schemaVersion!==1 || !NATIVE_RUNTIME_SUPPORTED.includes(manifest.runtimeVersion) || manifest.referenceCommit!=='a8438f3ed18dd6f0944793de6c0d8bb9334e9633')
    throw new TypeError('Unsupported native source runtime manifest');
  if(typeof loadBinary!=='function')throw new TypeError('Native binary loader required');
  if(manifest.runtimeVersion!==NATIVE_RUNTIME_VERSION&&manifest.modules?.['mana-break'])
    throw new TypeError('Mana Break requires the complete current sealed runtime; legacy version downgrade is unsupported');
  if(manifest.runtimeVersion===NATIVE_RUNTIME_VERSION)await validateCurrentSeal(manifest);
  const binaries={};
  const names=['geometry','camera','commands','skills','skill-values','effect-random'];
  for(const name of ['commands-recovery','nasod','critical'])
    if(manifest.runtimeVersion!=='original-source-functions-v7'||manifest.modules?.[name])names.push(name);
  if(manifest.runtimeVersion===NATIVE_RUNTIME_VERSION||manifest.modules?.['mana-break'])names.push('mana-break');
  for(const name of names) {
    const record=manifest.modules?.[name];
    if(!record || !/^[a-z0-9-]+\.wasm$/.test(record.file) || !/^[0-9a-f]{64}$/.test(record.sha256))
      throw new TypeError(`Invalid native ${name} provenance`);
    const bytes=new Uint8Array(await loadBinary(record.file));
    if(await digest(bytes)!==record.sha256)throw new Error(`Native ${name} binary hash mismatch`);
    const module=await WebAssembly.compile(bytes);
    if(WebAssembly.Module.imports(module).length)throw new Error(`Native ${name} has unsupported host imports`);
    if(name==='skills'&&['original-source-functions-v10','original-source-functions-v11'].includes(manifest.runtimeVersion)&&
        !WebAssembly.Module.exports(module).some(exported=>exported.name==='skills_effect_hyper_mask'&&exported.kind==='function'))
      throw new Error('Native skills Hyper command ABI missing');
    if(name==='skills'&&manifest.runtimeVersion==='original-source-functions-v11'&&
        !WebAssembly.Module.exports(module).some(exported=>exported.name==='skills_callback_group_count'&&exported.kind==='function'))
      throw new Error('Native skills awakened Arc callback ABI missing');
    if(name==='skills'&&manifest.runtimeVersion==='original-source-functions-v11'){
      const instance=await WebAssembly.instantiate(module,{});
      if(instance.exports.skills_callback_group_count()!==70)throw new Error('Native skills awakened Arc callback group mismatch');
    }
    binaries[name]=module;
  }
  const geometry=await createNativeGeometry({module:binaries.geometry,map});
  const camera=await instantiateNativeCamera(binaries.camera);
  const baseCommands=await createNativeCommands({module:binaries.commands});
  const commands=binaries['commands-recovery']?await createNativeCommandsRecovery({base:baseCommands,module:binaries['commands-recovery']}):baseCommands;
  const skills=await instantiateNativeSkills(binaries.skills);
  const skillValues=await instantiateNativeSkillValues(binaries['skill-values']);
  const effectRandom=await instantiateNativeEffectRandom(binaries['effect-random']);
  const nasod=binaries.nasod?await instantiateNativeNasod(binaries.nasod):null;
  const critical=binaries.critical?await instantiateNativeCritical(binaries.critical):null;
  const manaBreak=binaries['mana-break']?await instantiateNativeManaBreak(binaries['mana-break']):null;
  return Object.freeze({geometry,camera,commands,skills,skillValues,effectRandom,nasod,critical,manaBreak,manifest,versions:Object.freeze({
    nativeSourceCommit:manifest.referenceCommit,
    nativeGeometry:manifest.modules.geometry.sha256,
    nativeCamera:manifest.modules.camera.sha256,
    nativeCommands:manifest.modules.commands.sha256,
    nativeSkills:manifest.modules.skills.sha256,
    nativeSkillValues:manifest.modules['skill-values'].sha256,
    nativeEffectRandom:manifest.modules['effect-random'].sha256,
    ...(nasod?{nativeNasod:manifest.modules.nasod.sha256}:{}),
    ...(critical?{nativeCritical:manifest.modules.critical.sha256}:{}),
    ...(manaBreak?{nativeManaBreak:manifest.modules['mana-break'].sha256}:{}),
    ...(binaries['commands-recovery']?{nativeCommandsRecovery:manifest.modules['commands-recovery'].sha256}:{}),
  })});
}
