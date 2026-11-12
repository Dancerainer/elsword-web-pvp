/** Separate fixed-source inventory from current executable input observations. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisCommands} from '../../packages/combat-core/elesis-commands.mjs';
import {elesisSkillEvent} from '../../packages/combat-core/elesis-skills.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>readFileSync(resolve(root,p)),json=p=>JSON.parse(read(p));
const hash=b=>createHash('sha256').update(b).digest('hex'),blob=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const fixedRoot=process.env.ELESIS_SOURCE_ROOT??resolve(root,'.cache/elesis-source'),files={};
for(const name of ['X2GUEL.cpp','X2GUEl.h','X2GageData.cpp','X2GageData.h','X2ComboManager.cpp','X2ComboManager.h','X2EffectSet.cpp','Always.h','X2GUUser.cpp']){
 const bytes=readFileSync(resolve(fixedRoot,name));files[name]={sha256:hash(bytes),gitBlob:blob(bytes),bytes:bytes.length};
}
const pinned={
 'X2GUEL.cpp':'f4f5a74f45688259f052c5b26fa667d9f781a59b3c771fc2f7ec7f24575714dc',
 'X2GUEl.h':'4e079ed3baf0ab48efea270fcc104f1fa8c4eed6fde8bc3b1e924538b3d5c681',
 'X2GageData.cpp':'d30c9acb4fa3f3f0e545259cde3d39d63c20dc1b2f3b5d74c5aa02e51f1583e8',
 'X2GageData.h':'ad9b998352f09864fb770a534d27e6d50c3f8c492a9131486efd7bd70bf7915f',
 'X2ComboManager.cpp':'891816605cf7d49d29b60c32211eb962c6d7735b00f171c33b3076ecb7d8a583',
 'X2ComboManager.h':'aa38126fed752a69bfdf60a30525b2d2fc11a0f24bcf158dbae574fd2043a9b5',
 'X2EffectSet.cpp':'395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440',
 'Always.h':'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069',
 'X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
};
for(const [name,sha256]of Object.entries(pinned))if(files[name].sha256!==sha256)throw new Error('Pinned source mismatch: '+name);
const src=readFileSync(resolve(fixedRoot,'X2GUEL.cpp')),text=src.toString('latin1'),clean=text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,m=>m.replace(/[^\r\n]/g,' '));
const methods={};
for(const m of clean.matchAll(/\b(?:void|bool|int|float)\s+CX2GUEL::(\w+)\s*\([^)]*\)\s*\{/g)){
 const tail=clean.slice(m.index+m[0].length),next=/\n[ \t]*(?:void|bool|int|float|DWORD|LRESULT|double|HRESULT|UINT)\s+\w+::\w+\s*\([^;{}]*\)\s*\{/g.exec(tail);
 const boundary=next?m.index+m[0].length+next.index:clean.length,end=clean.lastIndexOf('}',boundary)+1,body=clean.slice(m.index,end);
 methods[m[1]]={method:m[1],line:text.slice(0,m.index).split('\n').length,lastLine:text.slice(0,end).split('\n').length,sha256:hash(src.subarray(m.index,end)),contains2026:text.slice(m.index,end).includes('2026'),
  macros:[...body.matchAll(/\b(?:SKILL_CANCEL_AFTER(?:_FLY)?|BWALK_CANCEL_AFTER|WALK_CANCEL_AFTER|DASH_CANCEL_AFTER|ZX_CANCEL_AFTER(?:_EX)?)\s*\(\s*(\w+)\s*\)/g)].map(m=>m[0].replace(/\s+/g,' ')),
  literalEffectSets:[...new Set([...body.matchAll(/L"(EffectSet_[^"]+)"/g)].map(m=>m[1]))]};
}
const registrations={};
for(const m of clean.matchAll(/MakeTableReference\(\s*"([^"]+)"\s*,\s*(\w+)\.stateID\s*\);/g)){
 const after=clean.slice(m.index+m[0].length),next=after.search(/(?:MakeTableReference\(|\.Init\(\))/),body=after.slice(0,next<0?after.length:next);
 const callback=new RegExp(m[2]+'\\.OnEventProcess\\s*=\\s*SET_CB_FUNC\\(\\s*CX2GUEL\\s*,\\s*(\\w+)').exec(body)?.[1];
 if(callback)(registrations[m[1]]??=[]).push(callback);
}
const profiles=Object.fromEntries(['GM','BH','CA'].map(id=>[id,json(`packages/combat-core/${id.toLowerCase()}-profile.json`)]));
const inventory=[],observations=[],map={lines:[{lineId:0,start:[-20000,0,0],end:[20000,0,0]}]};
for(const [id,p] of Object.entries(profiles)){
 const sim=createSimulation({profile:p,map,preset:{passives:[],guildPassives:[],loadout:Array(8).fill(null)},actors:[{id:'el',professionId:id,team:0,x:0,y:0}]}),baseline=sim.snapshot();
 const seen=new Set();
 for(const [state,d]of Object.entries(p.states)){
  const name=d.sourceState??state;if(seen.has(name))continue;seen.add(name);
  const fields=Object.fromEntries(Object.entries(d.raw).filter(([k])=>/CANCEL|ALLOW_SKILL|KEY_INPUT|EVENT_PROCESS_TIME/.test(k)));
  const callbacks=[...new Set(registrations[name]??[name+'_EventProcess'])].filter(n=>methods[n]);
  if(!Object.keys(fields).length)continue;
  const command=elesisCommands.handlesEvent({state,professionId:id});
  const skill=p.skillCatalog.filter(s=>s.state).find(s=>s.states?.includes(state)||state.startsWith(s.state));
  const row={profession:id,state,sourceState:name,kind:command?'command':skill?'skill':'movement-or-reaction',targetFields:fields,sourcePc:d.sourcePc,rawSha256:hash(Buffer.from(JSON.stringify(d.raw))),callbacks:callbacks.map(n=>methods[n])};inventory.push(row);
  if(!command&&!skill)continue;
  const air=command?elesisCommands.isAirState({state,professionId:id}):/FLY|_JUMP(?:_|$)/.test(name)&&!name.includes('LANDING');
  const follow=p.skillCatalog.find(s=>s.supported&&s.selectable&&s.state&&s.skillId!==skill?.skillId&&s.type!==6&&(air?[2,4]:[1,2,5]).includes(s.useCondition));
  for(const [field,at]of Object.entries(fields)){
   if(!/^(?:SKILL|DASH|WALK|BWALK|ATTACK)_CANCEL_AFTER(?:_EX|_FLY)?$/.test(field)||!Number.isFinite(at)||at<0)continue;
   const end=d.clip.durationSeconds-Math.max(d.clip.durationSeconds/10,.03);
   if(at>=end){observations.push({profession:id,state,field,at,status:'animation-end-precedes-cancel'});continue;}
   for(const mode of ['normal','awakened'])for(const point of ['before','equal','after']){
    sim.restore(baseline);const a=sim.actor('el');sim.configureLoadout([follow?{skillId:follow.skillId}:null,...Array(7).fill(null)],'el');
    if(skill){a.skillId=skill.skillId;a.skillContext={key:'S',level:skill.maxLevel,branchId:'none',traitPolicy:null};}
    a.awakening.remaining=mode==='awakened'?10:0;a.awakening.orbs=3;sim.enter(a,state,'isolated-cancel-audit');a.grounded=!air;a.lineId=air?null:0;a.y=air?500:0;
    a.worldStop=a.hitStop=a.inputLock=a.canNotAttackTime=a.canNotJumpTime=0;a.animationTime=Math.fround(at)+(point==='before'?-.0001:point==='after'?.0001:0);a.animationStopped=false;
    const keys={pressed:new Set(),held:new Set(),pureDoubleLeft:false,pureDoubleRight:false};
    if(field.includes('SKILL'))keys.pressed.add('A');
    else if(field.startsWith('DASH'))keys.pureDoubleRight=true;
    else if(field.startsWith('BWALK'))keys.held.add('LEFT');
    else if(field.startsWith('WALK'))keys.held.add('RIGHT');
    else {keys.held.add('Z');if(field.endsWith('_EX'))keys.pressed.add('Z');}
    const serial=a.stateSerial;sim.processInput(a,keys);
    if(a.stateSerial===serial){if(command){const result=elesisCommands.runEvent(a,keys,p);if(result.state)observations.push({profession:id,state,field,at,mode,point,status:'command-request',requestedState:result.state});else observations.push({profession:id,state,field,at,mode,point,status:'retained'});continue;}
      elesisSkillEvent(sim,a,keys);}
    observations.push({profession:id,state,field,at,mode,point,status:a.stateSerial===serial?'retained':'changed',actualState:a.state,skillId:a.skillId});
   }
  }
 }
}
const contract={schemaVersion:1,targetClientMeasured:false,evidenceClass:'original2016-declarations+qualified-fixedV5-source',fixedV5:{commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',files},
 targetProfiles:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,{profileId:p.profileId,target:p.target,sources:p.sources,wayOfSword:p.referenceSemantics.wayOfSword}])),
 ownerMissingFrame:{macro:{file:'Always.h',line:2126,symbol:'MODIFY_GET_BONE_POS',enabled:true},caller:{file:'X2GUUser.cpp',line:37787,arguments:'PlayEffectSet(name,this,NULL,...)'},consumer:{file:'X2EffectSet.cpp',line:2843,policy:'owner GetBonePos false -> GetHeadBonePos; trace target and set target mesh are separate'},position:'original Bip01_Head world position + worldY70 + original effect offsets',scope:['EffectSet_HA_SCA_FATE_SMASHER_Attack1..4 forced Dummy01..03','EffectSet_SA_SBH_ANCIENT_FIRE Bop01'],rawDeclarationModified:false,targetClientMeasured:false},
 sourceBoundary:['The pinned repository includes explicit2026 reconstructions; contains2026 is not target-client execution evidence.','Original2016 ACTIVE has no separate RAGE state. Chivalry maps the original ACTIVE animation with target factor248; ordinary Endurance uses143/335.','CA/renewal commands absent from old callback registrations use explicit target declaration adapters; no guessed legacy windows.','No target2016 executable trajectory has been measured.'],
 chivalry:{thresholds:[-4800,4800],annihilationCharge:{max:2000,rate:3000,mpCost:0},pvpBurstPointCost:2250,galeSkillMp:.8,galeSkillCooldown:.6,annihilationNormalDamage:1.25,annihilationSkillDamage:1,annihilationCritical:true,galeReceivedPointConsumption:0,galeComboInterval:1.3},inventory};
const output={schemaVersion:1,evidenceClass:'current-web-simulation-isolated-callback-matrix',targetClientMeasured:false,summary:{inventory:inventory.length,observations:observations.length,professions:Object.keys(profiles),fieldNames:[...new Set(inventory.flatMap(r=>Object.keys(r.targetFields)))].sort()},observations};
mkdirSync(resolve(root,'reports'),{recursive:true});writeFileSync(resolve(root,'contracts/elesis-core-source-v1.json'),JSON.stringify(contract,null,2)+'\n');writeFileSync(resolve(root,'reports/elesis-cancel-matrix-v1.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output.summary));
