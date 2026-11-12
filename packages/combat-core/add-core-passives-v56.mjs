/** Target2016 bounded core consumers. Instance clocks/slots are current Web
 * objects; the shared sample policy is explicitly distinct from a captured
 * original seed producer. Opaque native inputs stay unsupported. */
import source from '../../contracts/add-core-passives-source-v56.json' with {type:'json'};
import {installCommonBuffs} from './buffs.mjs';
import {addPassiveSample2016} from './add-passive-sample-2016.mjs';
const f=Math.fround;
export const addCorePassiveValue2016=(a,profile,id,key,neutral=0)=>{
 const level=a.passivePolicy?.skillLevels?.[id];if(!level)return neutral;
 const value=profile.skillCatalog.find(row=>row.skillId===id)?.raw?.[key]?.[level];
 if(!Number.isFinite(value))throw TypeError(`Missing original Add passive ${id}.${key}`);
 return f(value);
};
export function installAddCorePassiveSource2016(profile){
 return profile.target?.unitType===9?installCommonBuffs(profile,source.buffCatalog,false):profile;
}
export function addCoreAwakeningMutation2016(actor,profile,sample){
 const chance=addCorePassiveValue2016(actor,profile,29400,'SA_EFFECTIVE_RATE');
 if(!(chance>0))return {supported:true,count:0};
 if(!sample?.supported)return {supported:false,reason:'awakening-mutation-sample-unavailable'};
 return {supported:true,count:sample.value<=chance?1:0,chance,sample:sample.value};
}
export function addCoreFormationBuffs2016(sim,actor){
 if(!actor.sourceAdd?.formation||sim.networkOwnerId!==null&&sim.networkOwnerId!==actor.id)return;
 const levels=actor.passivePolicy?.skillLevels??{};
 if(levels[29402])sim.grantBuff(actor,actor,619,levels[29402],null);
 const id={LP:29401,MM:29406,DE:29411}[actor.professionId];
 if(levels[id])sim.grantBuff(actor,actor,669,levels[id],null);
}
const state=(actor,profile)=>actor.sourceAddCorePassives??={
 armorMutationElapsed:addCorePassiveValue2016(actor,profile,29402,'SA_COOLTIME_1'),dustCooldown:0};
export function advanceAddCorePassives2016(sim,actor,dt){
 if(!actor.sourceAdd||!(dt>0))return;
 const profile=sim.profileFor(actor),s=state(actor,profile),delay=addCorePassiveValue2016(actor,profile,29402,'SA_COOLTIME_1');
 // 32767c80 permits overshoot; unlike the DustStorm timer it never clamps.
 if(delay>0&&s.armorMutationElapsed<delay)s.armorMutationElapsed=f(s.armorMutationElapsed+f(dt));
 s.dustCooldown=Math.max(0,f(s.dustCooldown-f(dt)));
}
export function addCoreArmorFeedback2016(sim,actor,data,gainMutation){
 if(sim.networkOwnerId!==null&&sim.networkOwnerId!==actor.id)return {supported:true,applied:false};
 const profile=sim.profileFor(actor),chance=addCorePassiveValue2016(actor,profile,29402,'SA_FORCE_DOWN_REL_DAMAGE_RATE_BASE');
 if(!(chance>0)||data.DYNAMO_PARTICLE_RATE_TYPE!==3)return {supported:true,applied:false};
 const s=state(actor,profile),delay=addCorePassiveValue2016(actor,profile,29402,'SA_COOLTIME_1');
 if(!(s.armorMutationElapsed>=delay))return {supported:true,applied:false};
 const sample=addPassiveSample2016(sim,actor);if(!sample.supported)return sample;
 if(!(sample.value<chance))return {supported:true,applied:false};
 const added=gainMutation(actor,1,{profile,emit:(...args)=>sim.emit(...args)});s.armorMutationElapsed=0;
 sim.emit('addArmorMutationProc',actor.id,{added,delay,sample:sample.value,chance});
 return {supported:true,applied:true,added};
}
/** 31c181c0 is a separate original producer. Do not silently replace that
 * external draw with actor+1a4 or guess what the two anonymous DD bytes do. */
export function addBodyDamageBytes2016({dynamoType,chance,sample}={}){
 if(dynamoType!==3)return {supported:true,changed:false};
 if(!Number.isFinite(chance)||!Number.isFinite(sample))return {supported:false,reason:'original-31c181c0-instance-sample-required'};
 return sample<=f(chance)?{supported:true,changed:true,bytes:{'0x4b4':1,'0x4c1':1}}:{supported:true,changed:false};
}
/** Exact slot walker, independent of the caller's still separate special-ID
 * gates. All eight actual learned slots are supplied, never synthesized. */
export function reduceAddTimeControlSlots2016({slots,cooldowns,catalog,factor,ignore=[]}={}){
 if(!Array.isArray(slots)||slots.length!==8||!cooldowns||!Array.isArray(catalog)||!Number.isFinite(factor)||!Array.isArray(ignore))
  return {supported:false,reason:'original-two-four-slot-instance-input-required'};
 const changed=[];
 for(const slot of slots){
  if(!slot||!(slot.level>0))continue;
  const skill=catalog.find(row=>row.skillId===slot.skillId);if(!skill||[12,13].includes(skill.type)||ignore.includes(skill.skillId))continue;
  const before=cooldowns[skill.skillId];if(!(before>0))continue;
  const after=f(f(before)*f(factor));cooldowns[skill.skillId]=after;changed.push({skillId:skill.skillId,before,after});
 }
 ignore.length=0;return {supported:true,changed};
}
/** Original32771560: only a changed nonzero mode consults actual local342
 * records. The last matching TIME wins, including a nonpositive last value.
 * A generator's separate timer is never substituted for the Buff container. */
export function addInstallationExtensionPlan2016(actor,profile,{oldMode,newMode,records=actor.buffs}={}){
 const level=actor.passivePolicy?.skillLevels?.[29407];
 if(actor.professionId!=='MM'||!level||!oldMode||oldMode===newMode)return {supported:true,apply:false};
 if(!Array.isArray(records))return {supported:false,reason:'actual-local-buff342-records-required'};
 let remaining=0;
 for(const buff of records){
  if(buff?.templateId!==342||!Array.isArray(buff.finalizers)||!buff.finalizers.length)continue;
  // The source only takes a float when the finalizer/float vector exists.
  const time=buff.finalizers.find(row=>row.kind==='time');
  if(time&&Number.isFinite(time.remaining))remaining=time.remaining;
 }
 if(!(remaining>0))return {supported:true,apply:false,remaining};
 const extra=addCorePassiveValue2016(actor,profile,29407,'SA_CHARGING_TIME'),duration=f(remaining+extra);
 const original=profile.buffFactors?.[366]?.raw;
 if(!original?.FINALIZER?.BFT_TIME?.NORMAL_TIME)return {supported:false,reason:'original-bf366-time-factor-required'};
 const factor=structuredClone(original);
 factor.FINALIZER.BFT_TIME.NORMAL_TIME={...factor.FINALIZER.BFT_TIME.NORMAL_TIME,[level]:duration};
 return {supported:true,apply:true,factorId:366,level,remaining,extra,duration,factor};
}
export function applyAddInstallationExtension2016(sim,actor,transition){
 if(sim.networkOwnerId!==null&&sim.networkOwnerId!==actor.id)return {supported:true,apply:false};
 const plan=addInstallationExtensionPlan2016(actor,sim.profileFor(actor),transition);if(!plan.supported||!plan.apply)return plan;
 const buff=sim.grantBuff(actor,actor,plan.factor,plan.level,null);
 if(!buff){
  // The declared BFT_X2STATE_CHANGE13 is deliberately still unsupported.
  // Do not turn it into ordinary stateSerial or mutate an old timer instead.
  sim.note('add-installation-extension-finalizer13','Original BF366 TIME request is prepared, but X2STATE_CHANGE13 remains unsupported; existing Buffs stay unchanged',actor);
  return {...plan,supported:false,applied:false,reason:'original-bf366-finalizer13-unavailable'};
 }
 return {...plan,applied:true};
}
