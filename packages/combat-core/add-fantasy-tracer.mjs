/** Target2016 passive29404 and qualified fixed Add hit-record/recast consumer.
 * Constants and target ownership follow the fixed reference; no original
 * client execution is claimed. Ordinary Nasod distance/CAN flags do not gate
 * this separate producer. Source USED_SKILL_ID owns the two skill families.
 */
const f=Math.fround;
const families=new Map([[29201,29201],[29216,29201],[29202,29202],[29217,29202]]);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>plain(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const learned=a=>a.professionId==='LP'&&(a.passivePolicy?.skillLevels?.[29404]??0)>0;
const epoch=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);
const memo=a=>(a.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1});
const rowFor=(a,family)=>a.sourceAddFantasyTracer?.targets.find(row=>row.skillId===family);

export function validateAddFantasyTracerState(s,{owner,profile,actors}={}){
 if(s===undefined)return true;
 if(!keys(s,['targets','activeSkillId'])||!Array.isArray(s.targets)||s.targets.length>2||
    !(s.activeSkillId===null||[29201,29202].includes(s.activeSkillId)))throw new TypeError('Invalid Fantasy Tracer state');
 const seen=new Set();
 for(const row of s.targets){
  if(!keys(row,['skillId','targetId','targetEpoch','remaining','used'])||![29201,29202].includes(row.skillId)||seen.has(row.skillId)||
     !id(row.targetId)||!integer(row.targetEpoch)||!Number.isFinite(row.remaining)||row.remaining<0||row.remaining>3||
     typeof row.used!=='boolean'||row.remaining<1&&!row.used)throw new TypeError('Invalid Fantasy Tracer target row');
  seen.add(row.skillId);
  if(owner&&!owner.loadout?.some(slot=>families.get(slot?.skillId)===row.skillId))throw new TypeError('Invalid Fantasy Tracer equipped family');
  if(owner&&actors&&!actors.some(a=>a.id===row.targetId&&a.id!==owner.id&&a.team!==owner.team))throw new TypeError('Invalid Fantasy Tracer target reference');
 }
 if(s.activeSkillId!==null&&!seen.has(s.activeSkillId))throw new TypeError('Missing active Fantasy Tracer target');
 if(owner&&!learned(owner))throw new TypeError('Invalid Fantasy Tracer owner');
 if(profile&&(profile.target?.unitClass!==122||!profile.skillCatalog?.some(skill=>skill.skillId===29404&&skill.passive)))throw new TypeError('Invalid Fantasy Tracer source profile');
 return true;
}

/** Invoke after a real accepted ordinary hit or successful RT11 contact,
 * before the ordinary Nasod CAN_ACTIVATE/range/height early returns. */
export function addFantasyTracerAcceptedHit(sim,a,target,data,origin={}){
 const family=data?.USED_SKILL_ID;
 if(!learned(a)||!a.sourceAdd?.formation||sim.observationOnly||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id&&sim.networkCombatPlaybackVersion!==1||
    origin.sourceAddSummonSerial!==undefined||![29201,29202].includes(family)||(data.HP_PERCENT_UP??0)>0||
    !target||target.id===a.id||target.team===a.team||!a.loadout?.some(slot=>families.get(slot?.skillId)===family))return false;
 const targetEpoch=epoch(sim,target);
 if(!integer(targetEpoch)){sim.note?.('add-fantasy-tracer-target-epoch','Target life epoch unavailable; pursuit record omitted',a);return false;}
 const s=a.sourceAddFantasyTracer??={targets:[],activeSkillId:null};
 s.targets=s.targets.filter(row=>row.skillId!==family);
 s.targets.push({skillId:family,targetId:target.id,targetEpoch,remaining:3,used:false});
 sim.emit?.('addFantasyTracerTarget',a.id,{targetId:target.id,skillId:family,eligibleSeconds:2,retentionSeconds:1});return true;
}

/** Pure availability query. It must run after the ordinary Phase return plan:
 * Fantasy chooses the action, while a live dummy still wins the5MP price
 * check in fixed GetActualMPConsume. It never resets the existing cooldown. */
export function addFantasyTracerPlan(actor,skill,plan,{profile}={}){
 if(!learned(actor)||!actor.sourceAdd?.formation)return plan;
 const family=families.get(skill.skillId),row=rowFor(actor,family);
 if(!row||row.used||row.remaining<1)return plan;
 let mp=0;
 if(family===29201&&actor.sourceAddCombat?.phase?.remaining>0){
  mp=skill.raw?.SA_MP_BURN_ABS?.[skill.maxLevel];
  if(!Number.isFinite(mp))return plan;
 }
 const down=['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK'].includes(actor.state);
 return {...plan,mode:'fantasy-tracer',recastState:'ANSI_COMBO_NASOD_ARMOR_READY',fantasySkillId:family,
  fantasyTargetId:row.targetId,mpCost:mp,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,
  allowStateCancel:down,allowAir:down,resourceMpInsufficient:actor.mp<mp,resourceDpInsufficient:false,resourceMutationInsufficient:false};
}

/** Commit only after the shared availability/resource gates succeed. The
 * caller spends exactly plan.mpCost once and bypasses ordinary initial-cast
 * DP gain/passives. The retained row remains available for the attack phase. */
export function commitAddFantasyTracer(actor,plan){
 if(plan?.mode!=='fantasy-tracer'||!learned(actor)||!actor.sourceAdd?.formation)return false;
 const row=rowFor(actor,plan.fantasySkillId);
 if(!row||row.used||row.remaining<1||row.targetId!==plan.fantasyTargetId)return false;
 row.used=true;actor.sourceAddFantasyTracer.activeSkillId=row.skillId;memo(actor).nasodTargetId=row.targetId;memo(actor).nasodFlag=false;return true;
}

/** Call on Nasod attack entry before its existing geometry/HP/line gates.
 * Re-read the family row as the source does: a subsequent hit can replace
 * that family's target between READY and ATTACK. Missing/expired/later-life
 * targets never leave a stale ordinary pursuit target behind. */
export function restoreAddFantasyTracerTarget(sim,a){
 const active=a.sourceAddFantasyTracer?.activeSkillId;if(active==null)return null;
 const row=rowFor(a,active),target=row&&sim.state.actors.find(b=>b.id===row.targetId&&b.team!==a.team&&epoch(sim,b)===row.targetEpoch);
 memo(a).nasodTargetId=target?.id??null;return target??false;
}

/** Original LandingEnd clears only the active skill selector. */
export function finishAddFantasyTracer(a){if(a.sourceAddFantasyTracer)a.sourceAddFantasyTracer.activeSkillId=null;}

/** Run with the actor's effective elapsed time. At2s the row is ineligible,
 * but survives another1s so the selected Nasod action can still find it. */
export function tickAddFantasyTracer(a,dt){
 const s=a.sourceAddFantasyTracer;if(!s||!(dt>0))return;
 for(const row of s.targets){row.remaining=f(row.remaining-f(dt));if(row.remaining<1)row.used=true;}
 const active=s.activeSkillId;s.targets=s.targets.filter(row=>row.remaining>=0);
 if(active!==null&&!s.targets.some(row=>row.skillId===active)){
  s.activeSkillId=null;if(a.sourceAddCombat)a.sourceAddCombat.nasodTargetId=null;
 }
}
