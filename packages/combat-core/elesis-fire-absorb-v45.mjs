/** Defender-authoritative Avatar absorption/refund receipt. This bounded
 * envelope is a Web ownership adapter; peers never supply an MP magnitude. */
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {absorbLegacyFireRecords} from './legacy-fire-stores-v53.mjs';
export const ELESIS_AVATAR_ABSORB_EFFECT='DamageEffect_SPK_Avatar_of_the_Fire_Damage2';
const templates=new Set([37,293]),scanTemplates=templates,limit=4,f=Math.fround;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const id=n=>typeof n==='string'&&n.length>0&&n.length<=128;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const epoch=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);
const alive=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
function source(profile){
 const skill=profile?.skillCatalog?.find(s=>s.skillId===28208);
 if(profile?.target?.unitClass!==121||!skill||!profile.damageEffects?.[ELESIS_AVATAR_ABSORB_EFFECT]||
  profile.damageEffects[ELESIS_AVATAR_ABSORB_EFFECT].raw.DAMAGE_DATA.APPLIED_SKILL_ID!==28208||
  !/Recover 10 per Debuff/.test(skill.raw.m_EffectiveDesc?.[1]??''))
  throw new TypeError('Missing original Avatar absorption source');
 return 10;
}
export function validateElesisFireAbsorbNotice(notice,{owner,actors,profiles}={}){
 if(!exact(notice,['serial','receipts'])||!integer(notice.serial)||notice.serial<1||!Array.isArray(notice.receipts)||
  notice.receipts.length<1||notice.receipts.length>limit)throw new TypeError('Invalid Elesis fire absorption notice');
 let previous=0;
 for(const r of notice.receipts){
  const receiptKeys=['serial','skillId','casterId','casterEpoch','effectId','stateSerial','templateIds'];
  const optional=[...(Object.hasOwn(r??{},'stackCounts')?['stackCounts']:[]),...(Object.hasOwn(r??{},'legacyTypes')?['legacyTypes']:[])];
  if(!exact(r,[...receiptKeys,...optional])||!integer(r.serial)||r.serial<=previous||
   r.serial>notice.serial||r.skillId!==28208||!id(r.casterId)||!integer(r.casterEpoch)||!integer(r.effectId)||
   !integer(r.stateSerial)||r.stateSerial<1||!Array.isArray(r.templateIds)||r.templateIds.length>2||
   r.templateIds.length+(r.legacyTypes?.length??0)<1||
   r.legacyTypes!==undefined&&(!Array.isArray(r.legacyTypes)||r.legacyTypes.length>2||new Set(r.legacyTypes).size!==r.legacyTypes.length||r.legacyTypes.some((n,i)=>![3,100].includes(n)||i>0&&n<=r.legacyTypes[i-1]))||
   new Set(r.templateIds).size!==r.templateIds.length||r.templateIds.some((n,i)=>!templates.has(n)||i>0&&n<=r.templateIds[i-1])||
   r.stackCounts!==undefined&&(!Array.isArray(r.stackCounts)||r.stackCounts.length!==r.templateIds.length||
    r.stackCounts.some((n,i)=>!Number.isSafeInteger(n)||n<1||n>(r.templateIds[i]===293?10:1))))
   throw new TypeError('Invalid Elesis fire absorption receipt');
  previous=r.serial;
  if(owner&&r.casterId===owner.id)throw new TypeError('Self-targeted Avatar absorption receipt');
  if(actors&&owner){const caster=actors.find(a=>a.id===r.casterId);
   if(!caster||caster.professionId!=='BH'||!caster.loadout?.some(s=>s?.skillId===28208))
    throw new TypeError('Invalid Avatar absorption caster reference');
   if(profiles?.[caster.professionId])source(profiles[caster.professionId]);
  }
 }
 if(previous!==notice.serial)throw new TypeError('Invalid Avatar absorption notice serial');
 return true;
}
function recover(sim,caster,ids,targetId,networkArrival=false,counts=ids.map(()=>1),legacyTypes=[]){
 const count=counts.reduce((sum,n)=>sum+n,0)+legacyTypes.length,requested=Math.min(caster.mpMax,source(sim.profileFor(caster))*count),before=caster.mp;
 caster.mp=Math.min(caster.mpMax,f(caster.mp+requested));
 sim.emit?.('elesisFireAbsorbed',caster.id,{targetId,count,mp:requested,actualMp:caster.mp-before,
  removedTemplateIds:[...ids],removedLegacyTypes:[...legacyTypes],networkArrival,evidence:'original327e73d0 four stores, MP10/count and request maxMP limit; bounded Web ownership receipt'});
}
/** Remember locally issued source cast entries, independently of remote
 * rewinds. Damage2 handles are not separate refund identities. */
export function rememberElesisAvatarEffects(sim,caster){
 if(sim.networkOwnerId==null||sim.networkOwnerId!==caster.id||caster.professionId!=='BH')return;
 const life=epoch(sim,caster);if(!integer(life))return;
 const history=sim.state.localOwnerElesisAvatarEffects??=[];
 if(caster.state==='ESI_SI_A_SPK_AVATAR_OF_THE_FIRE'&&caster.skillId===28208&&
  !history.some(r=>r.effectId===0&&r.stateSerial===caster.stateSerial&&r.casterEpoch===life))
  history.push({effectId:0,stateSerial:caster.stateSerial,casterEpoch:life,refundedTargets:[]});
 if(history.length>8)history.splice(0,history.length-8);
}
/** Shared hit-finalization hook: absorption belongs to the source scan. */
export function finalizeElesisFireAbsorb(sim,caster,target,data,origin={}){
 // The recovered registered Frame callback scans at .01, independently of
 // Damage2. Its later Burn contact is not a second absorption opportunity.
 return false;
}
/** Original327e73d0: .01 one-shot, every valid live unit within1000; no
 * self/team or attack-contact gate. Only each target owner removes its fire.
 * The two legacy effective records and Buff37/293 are separate stores;
 * legacy producer/expiry algorithms are never invented from a visual. */
export function scanElesisAvatarFire(sim,caster){
 if(sim.observationOnly||caster.professionId!=='BH'||caster.skillId!==28208||
  caster.state!=='ESI_SI_A_SPK_AVATAR_OF_THE_FIRE'||!alive(caster))return false;
 const casterEpoch=epoch(sim,caster);if(!integer(casterEpoch))return false;
 rememberElesisAvatarEffects(sim,caster);
 const ledger=sim.state.localOwnerElesisAvatarScans??=[];
 if(ledger.some(r=>r.casterId===caster.id&&r.casterEpoch===casterEpoch&&r.stateSerial===caster.stateSerial))return false;
 ledger.push({casterId:caster.id,casterEpoch,stateSerial:caster.stateSerial});if(ledger.length>32)ledger.splice(0,ledger.length-32);
 source(sim.profileFor(caster));let changed=false;
 for(const target of sim.state.actors){
  if(!alive(target)||sim.networkOwnerId!=null&&sim.networkOwnerId!==target.id||Math.hypot(target.x-caster.x,target.y-caster.y,target.z-caster.z)>1000)continue;
  const legacyTypes=absorbLegacyFireRecords(target),rows=target.buffs.filter(b=>scanTemplates.has(b.templateId));
  const ids=[...new Set(rows.map(b=>b.templateId))].sort((a,b)=>a-b);if(!ids.length&&!legacyTypes.length)continue;
  const counts=ids.map(id=>id===293?Math.max(1,...rows.filter(b=>b.templateId===id).map(b=>Math.min(10,Math.trunc(b.accumulationCount??1)))):1);
  target.buffs=target.buffs.filter(b=>!scanTemplates.has(b.templateId));synchronizeBuffStats(target);sim.advanceActorBuffs(target,0);
  if(sim.networkOwnerId==null||target.id===caster.id){recover(sim,caster,ids,target.id,false,counts,legacyTypes);changed=true;continue;}
  const previous=target.sourceElesisFireAbsorbNotice,serial=(previous?.serial??0)+1;
  const receipt={serial,skillId:28208,casterId:caster.id,casterEpoch,effectId:0,stateSerial:caster.stateSerial,templateIds:ids,stackCounts:counts,
   ...(legacyTypes.length?{legacyTypes}:{})};
  const notice={serial,receipts:[...(previous?.receipts??[]),receipt].slice(-limit)};
  validateElesisFireAbsorbNotice(notice,{owner:target,actors:sim.state.actors,profiles:sim.profiles});target.sourceElesisFireAbsorbNotice=notice;
  sim.emit?.('elesisFireAbsorbReceipt',target.id,{casterId:caster.id,serial,templateIds:ids,stackCounts:counts});changed=true;
 }
 return changed;
}
/** Current owner reports may arrive after the source .01 scan threshold.
 * Historical critical-action restoration must never call this entry. */
export function receiveElesisAvatarScan(sim,caster){
 if(sim.networkOwnerId==null||sim.networkOwnerId===caster.id||caster.animationTime<Math.fround(.01))return false;
 if(sim.deferAddTimeRingNotices){
  const pending=sim.pendingElesisAvatarScans??=[];if(!pending.includes(caster.id))pending.push(caster.id);return false;
 }
 return scanElesisAvatarFire(sim,caster);
}

/** Invoke only for current owned reports, after life epochs are installed.
 * Receipts live outside temporary remote-actor rewinds and survive snapshots. */
export function receiveElesisFireAbsorbNotice(sim,sender,senderEpoch,notice){
 if(!notice||sim.networkOwnerId==null||sim.networkOwnerId===sender.id||sim.observationOnly)return false;
 if(!integer(senderEpoch))throw new TypeError('Invalid fire absorption sender epoch');
 validateElesisFireAbsorbNotice(notice,{owner:sender,actors:sim.state.actors,profiles:sim.profiles});
 if(sim.deferAddTimeRingNotices){
  (sim.pendingElesisFireAbsorbNotices??=[]).push({senderId:sender.id,senderEpoch,notice:structuredClone(notice)});return false;
 }
 const caster=sim.state.actors.find(a=>a.id===sim.networkOwnerId);
 if(!caster)return false;
 const ledger=sim.state.localOwnerElesisFireAbsorbReceipts??={version:1,owners:[]};
 const previous=ledger.owners.find(r=>r.playerId===sender.id);
 if(previous&&senderEpoch<previous.epoch)return false;
 let delivered=false,seen=previous&&previous.epoch===senderEpoch?previous.serial:0;
 for(const r of notice.receipts){
  if(r.serial<=seen)continue;
  if(r.casterId===caster.id&&r.casterEpoch===epoch(sim,caster)&&alive(caster)){
   const cast=sim.state.localOwnerElesisAvatarEffects?.find(c=>c.effectId===r.effectId&&c.stateSerial===r.stateSerial&&c.casterEpoch===r.casterEpoch);
   if(cast&&!cast.refundedTargets.includes(sender.id)){
    cast.refundedTargets.push(sender.id);recover(sim,caster,r.templateIds,sender.id,true,r.stackCounts??r.templateIds.map(()=>1),r.legacyTypes??[]);delivered=true;
   }
  }
  seen=r.serial;
 }
 if(previous)Object.assign(previous,{epoch:senderEpoch,serial:Math.max(seen,previous.epoch===senderEpoch?previous.serial:0)});
 else ledger.owners.push({playerId:sender.id,epoch:senderEpoch,serial:seen});
 return delivered;
}
/** The common roster-baseline transaction installs every epoch first. */
export function flushElesisFireAbsorbNotices(sim,{discard=false}={}){
 const pending=sim.pendingElesisFireAbsorbNotices??[];delete sim.pendingElesisFireAbsorbNotices;
 const scans=sim.pendingElesisAvatarScans??[];delete sim.pendingElesisAvatarScans;
 if(discard)return;
 for(const id of scans){const caster=sim.state.actors.find(a=>a.id===id);if(caster)receiveElesisAvatarScan(sim,caster);}
 for(const p of pending){const sender=sim.state.actors.find(a=>a.id===p.senderId);
  if(sender)receiveElesisFireAbsorbNotice(sim,sender,p.senderEpoch,p.notice);
 }
}
