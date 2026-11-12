/** Seal only the historical Web capture's declaration dependencies. The old
 * full-profile digest remains provenance; unrelated asset closure additions
 * cannot invalidate transport admission of an unchanged captured frame. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

import {resolveBaselineCommit} from './baseline-ref.mjs';
const profilePath='packages/combat-core/mm-profile.json',fixturePath='tests/fixtures/network2016-mm-capacity.json';
export const capacityHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Display labels can differ by language without changing the recorded frame.
export function capacityPresetHash(preset){
 const {displayName,bannedSkillReasons,...fields}=preset;
 return capacityHash(fields);
}
// Compare the retained gameplay fields even when provenance prose is sanitized.
export function capacityPresetBehaviorHash(preset){
 const {attributesEvidence,...fields}=preset;
 return capacityPresetHash(fields);
}
const fileHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const own=(o,k)=>Object.hasOwn(o??{},k);
function selected(object,names){return Object.fromEntries(names.filter(k=>own(object,k)).map(k=>[k,object[k]]));}

/** This projector reads source declarations, never the current simulation's
 * output. Null explicitly locks a missing damage/template declaration too. */
export function captureProfileDependencies(profile,fixture){
 const reports=[fixture.report,...fixture.report.actions],effects=reports.flatMap(report=>report.effects),
  states=[...new Set(reports.map(report=>report.actor.state))].sort(),
  skillIds=[...new Set(reports.flatMap(report=>[report.actor.skillId,...report.effects.map(e=>e.skillId)]).filter(id=>id!=null))].sort((a,b)=>a-b),
  sets=[...new Set(effects.map(effect=>effect.setName).filter(Boolean))].sort(),
  names=[...new Set(effects.flatMap(effect=>[effect.name,effect.mainEffectName]).filter(Boolean))].sort();
 const damageEffects=Object.fromEntries(names.map(name=>[name,profile.damageEffects?.[name]?.raw??null]));
 for(const raw of Object.values(damageEffects))if(raw?.MAIN_EFFECT_NAME&&!names.includes(raw.MAIN_EFFECT_NAME))names.push(raw.MAIN_EFFECT_NAME);
 names.sort();
 return {
  identity:{profileId:profile.profileId,target:selected(profile.target,['region','build','unitType','unitClass'])},
  states:Object.fromEntries(states.map(name=>[name,profile.states?.[name]?selected(profile.states[name],['sourceState','raw']):null])),
  skills:Object.fromEntries(skillIds.map(id=>{const skill=profile.skillCatalog.find(s=>s.skillId===id);
   return [id,skill?selected(skill,['skillId','unitClass','maxLevel','type','useCondition','state','states','executor','raw']):null];})),
  effectSets:Object.fromEntries(sets.map(name=>[name,profile.effectSets?.[name]?.raw??null])),
  damageEffects,
  effectTemplates:Object.fromEntries(names.map(name=>[name,profile.effectTemplates?.[name]?
   selected(profile.effectTemplates[name],['kind','fields','events','repeated','declarationSha256']):null]))};
}

function seal(){
 const root=fileURLToPath(new URL('../',import.meta.url)),fixtureBytes=readFileSync(resolve(root,fixturePath)),
  fixture=JSON.parse(fixtureBytes),baselineCommit=resolveBaselineCommit(root),oldBytes=execFileSync('git',['show',baselineCommit+':'+profilePath],{cwd:root,maxBuffer:16*1024*1024}),
  oldProfile=JSON.parse(oldBytes),profileSha256=capacityHash(oldProfile);
 assert.equal(profileSha256,fixture.source.profileSha256,'historical Git profile must verify the capture original canonical digest');
 const oldPreset=JSON.parse(execFileSync('git',['show',baselineCommit+':config/mm-preset.json'],{cwd:root,encoding:'utf8'}));
 assert.equal(capacityHash(oldPreset),fixture.source.presetSha256,'historical preset must match the independent capture before deriving its language-neutral digest');
 const dependencies=captureProfileDependencies(oldProfile,fixture),currentProfile=JSON.parse(readFileSync(resolve(root,profilePath)));
 assert.deepEqual(captureProfileDependencies(currentProfile,fixture),dependencies,
  'capture dependencies changed: review the source change instead of blessing a new baseline');
 const contract={schemaVersion:1,evidenceClass:'historical-current-Web-Native-capture-dependency-lock; not original-client measurement',
  source:{profilePath,profileSha256,presetSha256:fixture.source.presetSha256,presetFieldsSha256:capacityPresetHash(oldPreset),presetBehaviorFieldsSha256:capacityPresetBehaviorHash(oldPreset),
   presetBehaviorFieldsScope:'Historical preset with the known mana-break/version adaptation, display fields and attributesEvidence excluded; original preset and original lock remain independent.',
   hashEncoding:'SHA256(JSON.stringify(JSON.parse(UTF8))); original parsed property order',
   scope:'Captured actor/action states and skills; each retained effect set raw declaration, damage raw declaration and template original fields/events. Generated asset paths, conversion metadata and unrelated skills are excluded.'},
  capture:{fixturePath,fixtureFileSha256:fileHash(fixtureBytes),reportSha256:capacityHash(fixture.report),
   reportBytes:Buffer.byteLength(JSON.stringify(fixture.report)),effectCount:fixture.report.effects.length,
   actionEffectCounts:fixture.report.actions.map(a=>a.effects.length),skillId:fixture.source.skillId},
  dependenciesSha256:capacityHash(dependencies),dependencies};
 const output=resolve(root,'contracts/network2016-mm-capacity-dependencies-v37.json');
 writeFileSync(output,JSON.stringify(contract,null,2)+'\n');
 console.log(JSON.stringify({output,sourceCommit:CAPACITY_CAPTURE_COMMIT,profileSha256,
  dependencySha256:contract.dependenciesSha256,effects:contract.capture.effectCount,
  states:Object.keys(dependencies.states).length,skills:Object.keys(dependencies.skills).length,
  sets:Object.keys(dependencies.effectSets).length,templates:Object.keys(dependencies.effectTemplates).length}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))seal();
