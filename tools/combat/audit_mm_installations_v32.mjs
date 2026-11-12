/** Re-check the target2016 scripts, distinct from the pinned reconstructed
 * C++ reference and current Web runtime. This never runs the original client. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=read('packages/combat-core/mm-profile.json');
const damage=read('.cache/client-skills-ui-v32/add-target/damage-declarations.json');
const skill=read('.cache/client-skills-ui-v32/add-target/skill-declarations.json');
for(const document of [damage,skill])assert.equal(sha(readFileSync(document.source.path)),document.source.sha256);
const previous=read('contracts/add-mm-sustained-audit-v1.json');
assert.equal(previous.missing.length,0);assert.equal(previous.scanned,previous.registered);
const referenceFile='.cache/client-skills-ui-v32/X2GUAdd.cpp';
const bytes=readFileSync(resolve(root,referenceFile)),reference=bytes.toString('latin1');
assert.equal(sha(bytes),'b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a');
const originalSkills=new Map(skill.nativeCalls.filter(row=>row.target.endsWith('AddSkillTemplet_LUA')).map(row=>[row.args.at(-1).m_eID,row.args.at(-1)]));
const inventory=Object.entries(damage.globals).filter(([name])=>/Star_?Fall|Shooting_?Chaser/i.test(name)).map(([name,raw])=>({name,sourcePc:damage.locations[name],
 rawSha256:sha(Buffer.from(JSON.stringify(raw))),mainEffectName:raw.MAIN_EFFECT_NAME,
 noDamage:raw.DAMAGE_DATA?.NO_DAMAGE??null,damage:raw.DAMAGE_DATA?.DAMAGE??null,
 targetSideAttachment:Object.fromEntries(Object.entries(raw).filter(([key])=>/BUFF_FACTOR|HIT_DAMAGE_EFFECT|LOCK_ON_DATA|CREATE_DAMAGE_EFFECT/.test(key)))}));
const checks=[];
for(const id of [29016,29018]){
 const current=profile.skillCatalog.find(row=>row.skillId===id);assert.deepEqual(current.raw,originalSkills.get(id));
 assert.equal(current.supported,false,'Do not publish an enabled startup without a bound attack driver');
 checks.push({skillId:id,executor:current.executor,supported:current.supported,unavailableReason:current.unavailableReason,
  rawFields:Object.fromEntries(Object.entries(current.raw).filter(([key])=>/^SA_/.test(key)).map(([key,value])=>[key,value[current.maxLevel]])),
  effectDescription:current.raw.m_EffectiveDesc[current.maxLevel]});
}
const timerReferences=reference.split(/\r?\n/).map((text,index)=>({line:index+1,text:text.trim()})).filter(row=>row.text.includes('m_fInstall9022Timer'));
assert.equal(timerReferences.length,2);assert.ok(timerReferences.every(row=>/^m_fInstall9022Timer\s*=/.test(row.text)));
const result={schemaVersion:1,originalClientExecuted:false,evidenceClass:'target2016 declarations and prior complete Lua literal inventory; bounded V5 source separately qualified',
 sources:[damage.source,skill.source],completeLuaInventory:{sourceContract:'contracts/add-mm-sustained-audit-v1.json',registered:previous.registered,scanned:previous.scanned,missing:previous.missing,
  interpretation:'Every registered script was scanned for these identifiers. Matches are declarations/preloads, with no target-side native attack driver represented by those names. Absence of names is not proof that the packed original executable lacks an implementation.'},
 qualifiedReference:{commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',path:referenceFile,sha256:sha(bytes),target2016:false,timerReferences},checks,inventory,
 conclusions:{Starfall:'Original SA_EFFECTIVE_TIME=7.4 and SA_COOLTIME_1=.5 plus a complete single Explode damage/animation payload do not specify target scan range or per-target placement. No original script supplies the repeat caller. Enabling a guessed owner-centered or global scan would change the skill, so it stays unavailable.',
 ShootingChaser:'The original Attacker is explicitly NO_DAMAGE. A complete Attack dummy supplies .5sec child emission from1sec, but no original collision path links that dummy to a victim or resolves connected drone count. Standalone owner-position emission would be a different attack. The reconstructed reference initial target range700 conflicts with target2016 raw PvP550 and cannot fill the missing victim attachment.'},
 deliverable:'Original missing resources are retained for future verified drivers; MM Fission DA is independently closed with exact target declarations and explicitly qualified UID inheritance.'};
const output=resolve(root,'runtime/mm-completion-v32');mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'installation-source-audit.json'),JSON.stringify(result,null,2)+'\n');
writeFileSync(resolve(root,'reports/mm-installations-source-v32.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({skills:checks.map(c=>({id:c.skillId,supported:c.supported})),originalDamageRows:inventory.length,timerReferences:timerReferences.length,report:'reports/mm-installations-source-v32.json'}));
