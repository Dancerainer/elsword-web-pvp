/** Freeze reviewed 2016 declarations, never import the implementation as gold. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(readFileSync(p)),sha=b=>createHash('sha256').update(b).digest('hex');
const unit=read('.cache/lk/elsword-declarations.json'),skills=read('.cache/lk/skill-declarations.json'),notes=read('.cache/lk/skill-note-declarations.json');
const bindings=[
 [21026,'ESSI_SI_A_MEGASLASH_MEMO_READY','ESSI_SI_A_MEGASLASH_MEMO_CHARGE','ESSI_SI_A_MEGASLASH_MEMO_FIRE'],
 [21217,'ESSI_SI_A_ES_ROLLING','ESSI_SI_A_ES_ROLLING_END'],[21027,'ESSI_SI2_ES_FLAME_GEYSER'],
 [21028,'ESSI_SI3_ES_UNLIMITED_BLADE','ESSI_SI3_ES_UNLIMITED_BLADE_HYPER'],[21029,'ESSI_SI1_ES_ASSAULT_SLASH'],
 [21219,'ESSI_SI_A_ES_KICK','ESSI_SI_A_ES_FULL_CHARGE_KICK'],[21031,'ESSI_SI2_ES_SPIRAL_BLAST'],[21030,'ESSI_SI3_ES_TRIPLE_GEYSER'],
 [21218,'ESSI_SI_A_ES_ENDURANCE','ESSI_SI_A_ES_ENDURANCE_HYPER'],[21034,'ESSI_SA_ESK_MORTAL_BLOW'],
 [21203,'ESSI_A_ELK_IMPACT_SMASH'],[21204,'ESSI_A_ESK_ARMOR_BREAK'],[21007,'ESSI_SA_ESK_DOUBLE_SLASH'],
 [21008,'ESSI_SI3_ES_ARMAGEDDON_BLADE'],[21205,'ESSI_A_ELK_ROLLING_SMASH_READY','ESSI_A_ELK_ROLLING_SMASH','ESSI_A_ELK_ROLLING_SMASH_LANDING'],
 [21009,'ESSI_SA_ELK_SAND_STORM'],[21010,'ESSI_SA_ESK_WINDMILL_START','ESSI_SA_ESK_WINDMILL','ESSI_SA_ESK_WINDMILL_END'],
 [21206,'ESSI_REVENGE_WAIT','ESSI_REVENGE_ATTACK'],[21011,'ESSI_SA_ELK_SONIC_BLADE'],[21603,'ESSI_HA_ELK_GIGANTIC_SLASH'],
];
const templates=new Map(skills.nativeCalls.filter(c=>c.target.endsWith('AddSkillTemplet_LUA')).map(c=>[c.args.at(-1).m_eID,c.args.at(-1)]));
const multipliers=[.5,1,1.4,1.5];
const rows=bindings.map(([skillId,...states])=>{
 const template=templates.get(skillId),family=new Set([skillId]);let old=template.m_DeleteSkillIDByUpgrade;
 while(old){family.add(old);old=templates.get(old)?.m_DeleteSkillIDByUpgrade;}
 const branches=notes.nativeCalls.filter(c=>c.target.endsWith('AddNewSkillNoteTemplet')).flatMap(c=>Object.values(c.args.at(-1).MEMO_LIST??{}))
  .filter(b=>family.has(b['2'])).map(b=>({id:'memo-'+b['3'],memoType:b['1'],rawPositions:b}));
 return {skillId,name:template.m_wstrName,noStateChange:skillId===21218,branches,states:states.map(state=>{
  const raw=unit.globals[state];if(!raw)throw Error('Missing original LK state '+state);
  const authoredSpeed=raw.ANIM_SPEED??1,originalItemAbility=raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY!==0&&raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY!==false;
  const userCorrection=[21031,21205].includes(skillId),webItemAbility=userCorrection?false:originalItemAbility;
  return {state,animationName:raw.ANIM_NAME,sourcePc:unit.locations[state],raw:Object.fromEntries(['ANIM_SPEED','APPLY_ANIM_SPEED_BY_ITEM_ABILITY','TRANSITION'].filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]])),
   authoredSpeed,originalItemAbility,webItemAbility,userCorrection,expectedSpeeds:multipliers.map(m=>authoredSpeed*(webItemAbility?m:1))};})};
});
const inputs=['elsword','skill','skill-note'].map(name=>{
 const path='.cache/lk/'+name+'-declarations.json',cache=read(path);
 if(sha(readFileSync(cache.source.path))!==cache.source.sha256)throw Error('Read-only target hash differs '+name);
 return {path,sha256:sha(readFileSync(path)),targetSource:cache.source};});
const cpp=readFileSync('.cache/native-reference/X2Lib/X2GUUser.cpp');
if(sha(cpp)!=='ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38')throw Error('Pinned common speed consumer differs');
const lines=cpp.toString('latin1').split('\n');
const fixture={schemaVersion:1,evidenceClass:'target2016-static and fixedV5-default-gate with explicit-user-corrections',targetClientMeasured:false,multipliers,rows};
const fixturePath='tests/fixtures/lk-skill-animation-speed-v3.json';writeFileSync(fixturePath,JSON.stringify(fixture,null,2)+'\n');
const contract={schemaVersion:1,targetClientMeasured:false,inputs,referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
 referenceSpans:[[13625,13654],[14182,14197],[26853,26880]].map(([startLine,endLine])=>({path:'X2Lib/X2GUUser.cpp',fileSha256:sha(cpp),startLine,endLine,
  fragmentSha256:sha(Buffer.from(lines.slice(startLine-1,endLine).join('\n')+'\n','latin1'))})),
 activeCount:rows.length,branchCount:rows.reduce((n,r)=>n+r.branches.length,0),stateCount:rows.reduce((n,r)=>n+r.states.length,0),
 targetExplicitFalseCount:rows.flatMap(r=>r.states).filter(s=>!s.originalItemAbility).length,
 userCorrections:[{skillId:21031,name:'[Enhanced] Spiral Blast',fixedSpeed:1},{skillId:21205,name:'Rolling Smash',fixedSpeeds:[5,1.5,1]}].map(r=>({...r,
  evidenceClass:'user-confirmed-web-correction',targetConflict:'Original target tables omit the gate and fixed V5 defaults true; preserve raw declarations and record the user correction separately.'})),
 fixture:fixturePath,fixtureSha256:sha(readFileSync(fixturePath)),boundaries:['No generic fixed-speed rule by skill category',
  'Iron Body casts without changing animation, so the prior command clock remains authoritative',
  'Fixed skill speed still respects hitstop/worldstop; source effect clocks stay independent',
  'No measured 2016 client action-speed trajectory']};
writeFileSync('contracts/lk-skill-animation-speed-source-v3.json',JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({actives:contract.activeCount,branches:contract.branchCount,states:contract.stateCount,fixedTarget:contract.targetExplicitFalseCount}));
