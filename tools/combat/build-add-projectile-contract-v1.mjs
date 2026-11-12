/** Extract only the two target2016 NPC projectile declarations. Inputs are
 * read-only; this contract records source data, never simulator answers. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const profile=JSON.parse(readFileSync(process.argv[2])),output=process.argv[3];
if(!output)throw new TypeError('usage: node build-add-projectile-contract-v1.mjs MM_PROFILE OUTPUT');
const names=['A','B'].map(n=>'DamageEffect_AMM_APOCALYPSE_Attack_'+n+'_Projectile_PVP');
const contract={version:1,targetClientMeasured:false,
 evidence:'target2016 declarations; fixed-source selection and unchanged VectorLockOn ABI; qualified Web scheduling/rotation adapter',
 targetDamageSource:{name:'DamageEffect.lua',sha256:'21747879161f19722278568dc2392c8778f88be491123a15f5f550cd63ac7397'},
 fixedReference:[
  {file:'X2Lib/X2DamageEffect.cpp',sha256:'8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8',lines:'2780 (unlock), 3092..3298 (LOT6), 6712..6790 (VectorLockOn)',role:'qualified non-target reference'},
  {file:'X2Lib/X2Game.cpp',sha256:'7f7660945348ea32516f61339af0262517ed940471b5104919010cdce21f6ff4',lines:'11993..12102',role:'nearest live enemy, strict range bounds and first tie'},
  {file:'KTDXLIB/KTDGXMeshPlayer.cpp',sha256:'0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d',lines:'1276,1796..1832',role:'creation angle retained until manual steering; move with preceding callback direction'}],
 projectiles:Object.fromEntries(names.map(name=>{
  const damage=profile.damageEffects[name],templateName=damage.raw.MAIN_EFFECT_NAME??damage.raw.MAIN_EFFECT?.NAME;
  // This field is spelled MAIN_EFFECT in the original DamageEffect table.
  const resolved=typeof damage.raw.MAIN_EFFECT==='string'?damage.raw.MAIN_EFFECT:templateName;
  const template=profile.effectTemplates[resolved];if(!template)throw new TypeError('original projectile template absent: '+JSON.stringify(damage.raw));
  return [name,{raw:damage.raw,sourcePc:damage.sourcePc,template:{name:resolved,source:template.source,declarationSha256:template.declarationSha256,
   fields:template.fields,events:template.events,initialVelocity:template.initialVelocity,initialDirSpeed:template.initialDirSpeed}}];
 })),
 qualifications:[
  'Target NPC Lua has original local-rotation edits. Shared EffectSet sampling currently combines global/declared/aim angles into birthAnchor.rotation; full native global-versus-local rotation splitting is not verified.',
  'Web unit order is actors then available Apocalypse NPC proxies. It is deterministic but native m_UnitList creation order is unmeasured.',
  'After-hit retarget maps native m_DamageTimeNow to the existing accepted effect hitCount; target projectile DAMAGE_TIME is 1.',
  'Target lock points require actual original collision helpers. No generic target-height fallback is introduced.',
  'Original renderer mesh phase and damage-effect callback are ordered in the host fixed step; target executable scheduling has not been measured.'
 ]};
writeFileSync(output,JSON.stringify(contract,null,2)+'\n');
console.log(path.resolve(output),createHash('sha256').update(JSON.stringify(contract)).digest('hex'));
