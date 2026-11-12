/** Defender-authoritative Moonlight consumption, followed by attacker-owned
 * original explosion creation. Receipts carry no power, damage or resources. */
import {consumeAddMoonlightExplosion,spawnAddMoonlightExplosion} from './add-moonlight-v45.mjs';
import {sourceSkillPowerDelta} from './skill-socket-power-2016.mjs';
const limit=4,historyLimit=64,historyFrames=240;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const epoch=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);
const own=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const alive=a=>a&&a.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
function buff(target){return target.buffs?.find(b=>b.templateId===439&&b.factorId===477&&[1,2,3].includes(b.accumulationCount)&&
 b.behaviors.some(r=>r.kind==='sourceCallback'&&r.type===43)&&!b.finalizers.some(r=>r.remaining<=0));}
function inMap(sim,position,recipient){
 if(!vector(position))return false;
 const {min,max}=sim.map?.bounds??{};
 for(let i=0;i<3;i++){
  // Line maps have a zero-width depth bound. Their original posed body
  // spheres still occupy3D space; a genuine native contact need not havez0.
  if(i===2&&vector(min)&&vector(max)&&min[i]===max[i]){
   const spheres=sim.defenderSampler?.(recipient)?.filter(s=>s.kind==='sphere'&&vector(s.center)&&Number.isFinite(s.radius)&&s.radius>=0)??[];
   if(!spheres.length){if(position[i]!==min[i])return false;}
   else if(position[i]<Math.min(...spheres.map(s=>s.center[i]-s.radius))||position[i]>Math.max(...spheres.map(s=>s.center[i]+s.radius)))return false;
  }else if(vector(min)&&position[i]<min[i]||vector(max)&&position[i]>max[i])return false;
 }
 return true;
}
/** Original3229a330: BF477 base scalar times(1+exact skill29024 socket delta).
 * Its type15 excludes the extra type13 Hyper branch. This product's immutable
 * equipment currently has no per-ID sockets, so its actual missing key is0. */
export function addMoonlightPowerFor(sim,a,_receipt){
 if(!a)return null;
 return {power:Math.fround(1+sourceSkillPowerDelta(a,sim.profileFor(a),29024)),hyperMode:a.sourceAdd?!!a.sourceAdd.formation:(a.awakening?.remaining??0)>0};
}
function sourceGuardData(data,result){
 if(!data||typeof data!=='object')return false;
 const reaction=data.REACT_TYPE??0;result??=reaction;
 const triggers=data.ATTACK_TRIGGER_TYPE;
 const triggerList=triggers==null?[]:typeof triggers==='number'?[triggers]:
  Array.isArray(triggers)?triggers:typeof triggers==='object'?Object.values(triggers):null;
 return Number.isInteger(reaction)&&Number.isInteger(result)&&Number.isInteger(data.HIT_TYPE??0)&&triggerList&&triggerList.every(Number.isInteger)&&
  Number.isFinite(data.HP_PERCENT_UP??0)&&(data.HP_PERCENT_UP??0)<=0&&[undefined,null,0,false].includes(data.NO_DAMAGE)&&
  !([0,11,12].includes(reaction)||[7,10].includes(result)||data.HIT_TYPE===26||triggerList.includes(7));
}
function sourceEligible(raw){
 const rows=[raw?.DAMAGE_DATA,raw?.DAMAGE_DATA_NEXT].filter(Boolean);
 // A mixed/unknown branch does not grant a peer authority to pick whichever
 // source guard it prefers. Known ordinary branches can be proved separately.
 return rows.length>0&&rows.every(row=>sourceGuardData(row));
}
/** Invoke only after the shared accepted-hit path. The independent original
 * GUUser HP+ / Heal / Nasod_Healer consumer proves+490=HP_PERCENT_UP; its
 * Raven guard group identifies+46c=NO_DAMAGE, not a guessed packed layout.
 * Shared ordinary reactions retain their declared result; RT11/12 return
 * earlier. A caller with an explicit transformed result may supply it. */
export function addMoonlightHitParameters(sim,a,target,data,origin={}){
 if(!a||!target||!buff(target)||!data||sim.observationOnly)return null;
 if(!sourceGuardData(data,origin.reactResult))return null;
 const power=addMoonlightPowerFor(sim,a,null);
 return power?{sourceGuardsPassed:true,...power}:null;
}
export function validateAddMoonlightNotice(notice,{owner,actors}={}){
 if(!exact(notice,['serial','receipts'])||!integer(notice.serial)||notice.serial<1||!Array.isArray(notice.receipts)||notice.receipts.length<1||notice.receipts.length>limit)
  throw new TypeError('Invalid Add Moonlight notice');
 let previous=0;
 for(const r of notice.receipts){
  if(!exact(r,['serial','attackerId','attackerEpoch','kind','effectId','stateSerial','state','stack','position'])||!integer(r.serial)||r.serial<=previous||r.serial>notice.serial||
   !id(r.attackerId)||!integer(r.attackerEpoch)||!['effect','character'].includes(r.kind)||!integer(r.effectId)||!integer(r.stateSerial)||r.stateSerial<1||
   ![1,2,3].includes(r.stack)||!vector(r.position)||
   (r.kind==='effect'?(r.effectId<1||r.state!==null):(r.effectId!==0||!id(r.state))))throw new TypeError('Invalid Add Moonlight receipt');
  previous=r.serial;
  if(owner&&r.attackerId===owner.id)throw new TypeError('Self-targeted Add Moonlight receipt');
  if(actors&&owner){const a=actors.find(a=>a.id===r.attackerId);if(!a||a.team===owner.team)throw new TypeError('Invalid Add Moonlight attacker');}
 }
 if(previous!==notice.serial)throw new TypeError('Invalid Add Moonlight serial');return true;
}
/** Call after local casts/effect creation, and before admitting remote receipts.
 * Keep this independent of temporary remote-actor rewinds and store in snapshots. */
export function rememberAddMoonlightOrigins(sim,a){
 if(sim.networkOwnerId==null||!own(sim,a)||sim.observationOnly)return;
 const life=epoch(sim,a);if(!integer(life))return;
 const step=sim.state.step??0,history=sim.state.localOwnerAddMoonlightOrigins??=[];
 const remember=row=>{
  const existing=history.find(r=>r.attackerId===a.id&&r.epoch===life&&r.kind===row.kind&&r.effectId===row.effectId&&r.stateSerial===row.stateSerial);
  if(existing){existing.lastSeenStep=step;existing.sourceEligible=row.sourceEligible;}
  else history.push({attackerId:a.id,epoch:life,...row,lastSeenStep:step});
 };
 const raw=sim.profileFor(a).states[a.state]?.raw;
 if(raw?.DAMAGE_DATA||raw?.DAMAGE_DATA_NEXT)remember({kind:'character',effectId:0,stateSerial:a.stateSerial,state:a.state,sourceEligible:sourceEligible(raw)});
 for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&e.damage&&e.ownerStateSerial>0)
  remember({kind:'effect',effectId:e.networkId??e.id,stateSerial:e.ownerStateSerial,state:null,sourceEligible:sourceEligible(e.damage)});
 const recent=history.filter(r=>step-r.lastSeenStep<=historyFrames);
 sim.state.localOwnerAddMoonlightOrigins=recent.slice(-historyLimit);
}
function contactOrigin(sim,a,origin){
 if(origin.kind==='effect'){
  const e=sim.state.effects.find(e=>e.id===origin.id&&e.ownerId===a.id&&e.damage);
  return e?{kind:'effect',effectId:e.networkId??e.id,stateSerial:e.ownerStateSerial,state:null}:null;
 }
 if(origin.kind==='character'){
  const match=/^state-(\d+)$/.exec(String(origin.id));
  return match&&origin.state===a.state&&Number(match[1])===a.stateSerial?
   {kind:'character',effectId:0,stateSerial:a.stateSerial,state:a.state}:null;
 }
 return null;
}
/** Root's accepted-hit hook supplies the independently verified native guard.
 * Online recipients consume their own439 and issue a bounded source receipt;
 * they never create a foreign attacker's offensive effect. */
export function finalizeAddMoonlightContact(sim,a,target,data,origin={},options={}){
 if(options.sourceGuardsPassed!==true||sim.observationOnly||!own(sim,target)||target.team===a.team||!buff(target)||!inMap(sim,origin.impactPoint,target))return false;
 const proof=contactOrigin(sim,a,origin);if(!proof)return false;
 if(sim.networkOwnerId==null)return consumeAddMoonlightExplosion(sim,a,target,{...options,position:origin.impactPoint});
 const life=epoch(sim,a);if(!integer(life)){sim.note?.('add-moonlight-attacker-epoch','Original attacker life identity required for Moonlight receipt',target);return false;}
 const stack=buff(target).accumulationCount,previous=target.sourceAddMoonlightNotice,serial=(previous?.serial??0)+1;
 const receipt={serial,attackerId:a.id,attackerEpoch:life,...proof,stack,position:[...origin.impactPoint]},notice={serial,receipts:[...(previous?.receipts??[]),receipt].slice(-limit)};
 validateAddMoonlightNotice(notice,{owner:target,actors:sim.state.actors});
 target.buffs=target.buffs.filter(b=>b.templateId!==439);
 for(const e of sim.state.effects)if(e.ownerId===target.id&&e.buffTemplateId===439){e.dead=true;e.endReason='moonlight-stack-consumed';}
 target.sourceAddMoonlightNotice=notice;sim.emit?.('buffFinished',target.id,{templateId:439});
 sim.emit?.('addMoonlightReceipt',target.id,{attackerId:a.id,serial,stack});return true;
}
/** Must be called only for current owned recipient reports after life epochs
 * are installed. powerFor is local source-derived computation, never a peer value. */
export function receiveAddMoonlightNotice(sim,sender,senderEpoch,notice,{powerFor}={}){
 if(!notice||sim.networkOwnerId==null||own(sim,sender)||sim.observationOnly)return false;
 if(!integer(senderEpoch))throw new TypeError('Invalid Add Moonlight sender epoch');
 validateAddMoonlightNotice(notice,{owner:sender,actors:sim.state.actors});
 if(sim.deferAddTimeRingNotices){(sim.pendingAddMoonlightNotices??=[]).push({senderId:sender.id,senderEpoch,notice:structuredClone(notice)});return false;}
 const a=sim.state.actors.find(a=>own(sim,a));if(!a)return false;
 const ledger=sim.state.localOwnerAddMoonlightReceipts??={version:1,owners:[]},prior=ledger.owners.find(r=>r.playerId===sender.id);
 if(prior&&senderEpoch<prior.epoch)return false;
 let seen=prior?.epoch===senderEpoch?prior.serial:0,delivered=false;
 for(const r of notice.receipts){
  if(r.serial<=seen)continue;
  if(r.attackerId===a.id&&r.attackerEpoch===epoch(sim,a)&&alive(a)&&inMap(sim,r.position,sender)){
   const proof=sim.state.localOwnerAddMoonlightOrigins?.find(p=>p.attackerId===a.id&&p.epoch===r.attackerEpoch&&p.kind===r.kind&&p.effectId===r.effectId&&p.stateSerial===r.stateSerial&&p.state===r.state&&
    (sim.state.step??0)-p.lastSeenStep<=historyFrames);
   if(proof?.sourceEligible===true&&typeof powerFor==='function'){
    const resolved=powerFor(a,r),power=typeof resolved==='number'?resolved:resolved?.power,hyperMode=typeof resolved==='object'?resolved.hyperMode:!!a.sourceAdd?.formation;
    if(Number.isFinite(power)&&power>=0&&typeof hyperMode==='boolean'){
     const e=spawnAddMoonlightExplosion(sim,a,{stack:r.stack,position:r.position,power,hyperMode});
     if(e){delivered=true;sim.emit?.('addMoonlightExplosion',a.id,{targetId:sender.id,stack:r.stack,effectId:e.id,power,position:[...r.position],networkArrival:true});}
    }
   }
  }
  seen=r.serial;
 }
 if(prior)Object.assign(prior,{epoch:senderEpoch,serial:Math.max(seen,prior.epoch===senderEpoch?prior.serial:0)});
 else ledger.owners.push({playerId:sender.id,epoch:senderEpoch,serial:seen});
 return delivered;
}
export function flushAddMoonlightNotices(sim,{discard=false,powerFor}={}){
 const pending=sim.pendingAddMoonlightNotices??[];delete sim.pendingAddMoonlightNotices;if(discard)return;
 for(const p of pending){const sender=sim.state.actors.find(a=>a.id===p.senderId);if(sender)receiveAddMoonlightNotice(sim,sender,p.senderEpoch,p.notice,{powerFor});}
}
