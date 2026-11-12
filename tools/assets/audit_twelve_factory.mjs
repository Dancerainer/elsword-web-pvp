import assert from 'node:assert/strict';
/** Read-only actual merged-root factory audit; outputs only to the chosen report. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]),output=resolve(process.argv[3]);
const {loadServerCombatAssets}=await import(pathToFileURL(join(root,'packages/combat-assets/server-assets.mjs')));
const {createSimulation}=await import(pathToFileURL(join(root,'packages/combat-core/index.mjs')));
const assets=await loadServerCombatAssets({root,assetRoot:join(root,'artifacts')});
const expected=['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'];
assert.deepEqual(Object.keys(assets.profiles).sort(),[...expected].sort());
assert.deepEqual(assets.assetDiagnostics,[]);
assert.ok(expected.every(id=>assets.professions[id]));
const {native,samplers}=await assets.createRuntime();
const sim=createSimulation({profile:assets.profile,profiles:assets.profiles,preset:assets.preset,presets:assets.presets,
 map:assets.map,commonBuffs:assets.commonBuffs,seed:2016,...samplers,
 actors:expected.map((id,i)=>({id:'actor-'+id,professionId:id,team:i%2,position:[2022.98-i*120,2840,0],lineId:6,facing:i%2?-1:1,loadout:Array(8).fill(null),passives:[],guildPassives:[]})),
 nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
 nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions});
const professions={};
for(const id of expected){
 const actor=sim.actor('actor-'+id),spheres=samplers.defenderSampler(actor);
 assert.ok(spheres.length>0,id+' original defender helper closure');
 professions[id]={enabled:assets.professions[id],sourceClass:assets.profiles[id].target.unitClass,state:actor.state,
  defenderHelpers:spheres.length,profileTemplates:Object.keys(assets.profiles[id].effectTemplates).length};
}
const mmFile=join(root,'artifacts/mm/fx/index.json'),mmBytes=await readFile(mmFile),mm=JSON.parse(mmBytes);
assert.equal(Object.keys(mm.templates).length,507);
const pending=[];
for(const id of expected){
 const folder=id.toLowerCase(),manifest=JSON.parse(await readFile(join(root,'artifacts',folder,'manifest.json')));
 const profileBytes=(await readFile(join(root,'packages/combat-core',folder+'-profile.json'),'utf8')).replaceAll('\r\n','\n');
 const actual=createHash('sha256').update(profileBytes).digest('hex');
 if(manifest.profile?.sha256&&manifest.profile.sha256!==actual)pending.push({profession:id,reason:'profile-binding-stale',manifest:manifest.profile.sha256,actual});
}
const result={schemaVersion:1,evidenceClass:'merged-runtime-integration',originalClientMeasured:false,assetRoot:join(root,'artifacts'),
 scope:'Actual root server-assets factory, all 12 original profile dependency closures, common buff merge, native Wasm creation and original defender geometry sampling; no client visual or complete skill parity claim.',
 professions,assetDiagnostics:assets.assetDiagnostics,nativeModules:Object.keys(native),samplerInterfaces:Object.keys(samplers),
 mmMergedTemplates:507,mmIndexSha256:createHash('sha256').update(mmBytes).digest('hex'),
 pending,
 hostProgramSha256:assets.fingerprints.hostProgram.sha256,resourceSha256:assets.fingerprints.resources.sha256};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
