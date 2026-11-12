/** Hash actual retained source, bounded compiled units and resource bytes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {index,visualIndex,profile} from '../../tests/helpers/rf-passive-fixture-v12.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),read=p=>JSON.parse(readFileSync(p));
const trackedJsonSha=path=>sha(readFileSync(path,'utf8').replace(/\r\n/g,'\n'));
const original=read('.cache/native-skills-generated/source-contract.json'),rebuilt=read('.cache/native-awakened-skills-v17/source-contract.json');
for(const key of ['functions','extraFunctions','animationFunctions','arcSourceFragments','macros','constants','shadowMacroEvidence','arcMacroEvidence','arcLockOnConstructor'])assert.deepEqual(rebuilt[key],original[key],key+' original source drift');
const spans=[['X2EffectSet.cpp',1798,1806,'PlayEffectSet API default bool'],['X2EffectSet.cpp',1862,1868,'saved explicit bool'],
  ['X2EffectSet.cpp',282,310,'delayed DAMAGE_EFFECT mode selector'],['X2EffectSet.cpp',474,484,'delayed major mesh selector'],
  ['X2EffectSet.cpp',701,709,'delayed major particle selector'],['X2EffectSet.cpp',2239,2246,'HYPER_NAME raw consumer'],
  ['X2EffectSet.cpp',2637,2647,'instance defaults false'],['X2GUUser.cpp',37769,37788,'state HYPER_EFFECT_SET default and explicit PlayEffectSet'],
  ['X2GUUser.h',996,1002,'registered state default false'],['X2GUUser.h',1712,1712,'IsHyperState reads Now registered state'],
  ['X2GURaven.cpp',2703,2718,'skill registration initializes normal/Hyper records'],['X2GURaven.cpp',17001,17028,'WildCharge live-time callsite']];
const sourceSpans=spans.map(([file,startLine,endLine,purpose])=>{
  const path='.cache/native-source-runtime/X2Lib/'+file,bytes=readFileSync(path),lines=bytes.toString('latin1').split(/(?<=\n)/);
  return {file:'X2Lib/'+file,startLine,endLine,purpose,sourceFileSha256:sha(bytes),fragmentSha256:sha(Buffer.from(lines.slice(startLine-1,endLine).join(''),'latin1'))};
});
const nativeModule=await WebAssembly.compile(readFileSync('.cache/native-awakened-skills-v17/skills.wasm'));
assert.equal(WebAssembly.Module.imports(nativeModule).length,0);
const nativeExports=(await WebAssembly.instantiate(nativeModule)).exports;
assert.equal(nativeExports.skills_output_count(),33);assert.equal(typeof nativeExports.skills_effect_hyper_mask,'function');
const execution={schemaVersion:1,compilationStatus:'compiled',executionStatus:'passed',targetClientMeasured:false,
  translationUnitSha256:sha(readFileSync('.cache/native-awakened-skills-v17/skills.generated.cpp')),
  moduleSha256:rebuilt.wasm.sha256,compiler:rebuilt.compiler,imports:WebAssembly.Module.imports(nativeModule),
  effectHyperModeExport:true,outputFloats:33,callbackGroups:69,completeOriginalMethods:70,allOriginalMethodRecordsUnchanged:true,
  debugPolicy:'explicit -g0; execution/data/name/target features identical, absolute-path DWARF removed',
  reproducibilityReportSha256:trackedJsonSha('reports/rf-skills-wasm-reproducibility-v17.json'),
  tests:'focused nativeBool and original-source checks on -g0 candidate; earlier76 keyboard traces are current before-g0 observations with identical code/data, final versions rerun by root'};
writeFileSync('.cache/native-awakened-skills-v17/execution.json',JSON.stringify(execution,null,2)+'\n');
const compiledFiles=['skills.wasm','skills.generated.cpp','source-contract.json','execution.json','original_skill_methods.inc','original_extra_skill_methods.inc',
  'original_vector_lockon.inc','original_skill_macros.inc','original_skill_timer_inline.inc','original_skill_timer_out.inc',
  'original_arc_follow.inc','original_arc_cooldown.inc','original_arc_lifecycle.inc'].map(file=>{
    const path='.cache/native-awakened-skills-v17/'+file,bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};
  });
const source=read('reports/rf-awakened-skills-source-v17.json');
const names=new Set(source.skills.flatMap(r=>r.targetClosure.flatMap(x=>[x.main,...x.resourceReferences])).filter(x=>index.templates[x]));
function strings(v){return typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(strings):v&&typeof v==='object'?Object.values(v).flatMap(strings):[];}
function visit(name){if(!index.templates[name])return;for(const n of strings(index.templates[name]))if(index.templates[n]&&!names.has(n)){names.add(n);visit(n);}}
for(const name of [...names])visit(name);
const files=new Map(),sources=new Map();
function resources(v){
  if(!v||typeof v!=='object')return;
  if(v.sha256&&(v.rawPath||v.raw_path)){
    const path=v.rawPath??v.raw_path,bytes=readFileSync(resolve('asset_work',path));assert.equal(sha(bytes),v.sha256,path);
    sources.set(path,{path,sha256:sha(bytes),bytes:bytes.length});
  }
  for(const [key,value] of Object.entries(v)){
    if(['file','glb','poseData'].includes(key)&&typeof value==='string'&&/\.(png|glb|json)$/.test(value)){
      const path='artifacts/rf/'+value;if(existsSync(path)){const bytes=readFileSync(path);files.set(path,{path,sha256:sha(bytes),bytes:bytes.length});}
      else throw new Error('Resource closure missing: '+path);
    }
    resources(value);
  }
}
for(const name of names)resources(index.templates[name]);
const audio=read('artifacts/audio/manifest.json');
const soundNames=new Set(source.skills.flatMap(r=>r.targetClosure.flatMap(x=>x.resourceReferences)).filter(x=>/\.ogg$/i.test(x)));
// State voices accompany each actual keyboard mode. These declarations also
// belong to the same authored sound set; no extra Hyper-only voice invented.
for(const skill of source.skills)for(const state of skill.targetStates)for(const s of strings(profile.states[state.name].raw))if(/\.ogg$/i.test(s))soundNames.add(s);
const missingSounds=[];
for(const name of soundNames){const entry=audio.files[name];if(!entry){missingSounds.push(name);continue;}
  const path='artifacts/audio/'+entry.file,bytes=readFileSync(path);assert.equal(sha(bytes),entry.sha256,path);
  files.set(path,{path,sha256:sha(bytes),bytes:bytes.length});resources(entry.source);
}
const closure={schemaVersion:1,evidenceClass:'target-file-resource-closure-not-native-renderer-acceptance',targetClientMeasured:false,
  selection:'target reachable state/effect/damage roots plus target-defined reference-created candidates; recursive known template references',
  templateCount:names.size,templates:[...names].sort(),files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),
  originalSources:[...sources.values()].sort((a,b)=>a.path.localeCompare(b.path)),missingSounds,
  d3dx:'Retained exact original-DLL keyframe/pose artifacts are hashed with mesh closure; no new mesh converter or substitute effect.',
  limits:['Absent fixed-V5 _HYPER state tables are not newly activated','A source literal outside target damage/EffectSet registries does not prove a missing visual resource','GPU blend/client playback is unmeasured']};
writeFileSync('reports/rf-awakened-skills-resource-closure-v17.json',JSON.stringify(closure,null,2)+'\n');
const manifest=read('artifacts/native/manifest.json'),old=read('contracts/rf-xcrash-source-v14.json').runtimeModule;
const contract={schemaVersion:1,evidenceClass:'target-static-declarations-plus-fixed-source-host-adapter-not-1:1',targetClientMeasured:false,
  referenceCommit:rebuilt.sourceCommit,referenceRavenSha256:rebuilt.sourceFileSha256,sourceSpans,
  sourceMatrixSha256:trackedJsonSha('reports/rf-awakened-skills-source-v17.json'),
  resourceClosureSha256:trackedJsonSha('reports/rf-awakened-skills-resource-closure-v17.json'),
  trackedReportHashNormalization:'UTF-8 LF; original source/compiled units/resources retain raw-byte SHA256',
  previousRuntimeVersion:'original-source-functions-v9',previousSkills:{sha256:old.sha256,bytes:old.bytes},
  runtimeModule:rebuilt.wasm,unchangedOriginalMethods:rebuilt.functions.length+rebuilt.extraFunctions.length,
  retainedPairings:Object.fromEntries(Object.entries(manifest.modules).filter(([n])=>n!=='skills')),
  compiledFiles,compiler:rebuilt.compiler,
  reproducibilityReportSha256:trackedJsonSha('reports/rf-skills-wasm-reproducibility-v17.json'),
  compilerExeSha256:sha(readFileSync('./.cache/native-toolchain/ziglang/zig.exe')),
  boundaries:{effectSetMode:'PlayEffectSet bool captured at creation; delayed entries consume saved bool. Empty HYPER_NAME falls back to NAME.',
    rawStateMode:'Only raw HYPER_EFFECT_SET true/1 supplies true; missing is original Lua-consumer false.',
    wildCharge:'live GetRemainHyperModeTime()>0 at .01 dash Now callback; defaultfalse for other set calls',
    xCrash:'unchanged original IsHyperState registered cast flag through existing69 ABI; expiry does not switch it',
    legacyBridge:'V7/V8/V9 module without getter remains loadable; exact fixed WildCharge group3 bool composed at callback time, all other supported sets false',
    damage:'Existing prototype live-at-hit1.2 global multiplier not changed; target final-damage consumer unverified',
    traits:'All36 original arrays independently checked; no invented Hyper trait multiplier',
    targetRegistration:'Matching 2016 executable Normal/Hyper registration not acquired; missing old _HYPER tables not added'},
  sealHandoff:{owner:'root',runtimeVersion:'original-source-functions-v10',onlyChangedModule:'skills',
    paths:['.cache/native-awakened-skills-v17/skills.wasm','.cache/native-awakened-skills-v17/source-contract.json','.cache/native-awakened-skills-v17/skills.generated.cpp','artifacts/native/manifest.json','artifacts/native/skills.wasm'],
    preserve:'nine other module records/bytes, old10-module manifest/source-release seal and superseded skills bytes; append boundedRebuildHistory',
    reason:'Only EffectSet explicit bool sink/ABI transport added. 33 outputs,69 callbackgroups,70 complete original method records unchanged.'}};
writeFileSync('contracts/rf-awakened-skills-source-v17.json',JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({templates:names.size,files:files.size,originalSources:sources.size,missingSounds,newSkills:rebuilt.wasm.sha256,
  contractSha256:sha(readFileSync('contracts/rf-awakened-skills-source-v17.json')),closureSha256:contract.resourceClosureSha256}));
