/** Read-only browser evidence adapters. The event ring is authoritative for
 * this checkpoint; retained RAF observations preserve older ring entries. */
export function mergeWorkbenchEvents(retained=[],current=[]){
 const byId=new Map();
 for(const event of [...retained,...current])byId.set(Number.isFinite(event.eventId)?'id:'+event.eventId:'row:'+JSON.stringify(event),event);
 return [...byId.values()].sort((a,b)=>Number.isFinite(a.eventId)&&Number.isFinite(b.eventId)?a.eventId-b.eventId:0);
}

/** Original Add Combo_Z declares EffectSet_AN_Combo_Z_Attack at .1. Its
 * DamageEffect_AN_Combo_Z hit therefore has origin.kind=effect. Bind it to
 * the newly sampled real command serial, caster and recipient; an unrelated
 * skill/carrier hit cannot stand in for the requested normal Z charge. */
export function findAddZChargeHit({events,samples},{actorId,targetId,afterEventId,afterStateSerial}){
 const states=new Set(['RSI_COMBO_Z','ANSI_COMBO_Z']);
 const commands=events.filter(e=>e.type==='stateChanged'&&e.actorId===actorId&&states.has(e.state)&&e.eventId>=afterEventId);
 for(const carrier of events){
  if(carrier.type!=='effectStarted'||carrier.actorId!==actorId||carrier.name!=='DamageEffect_AN_Combo_Z'||
   carrier.setName!=='EffectSet_AN_Combo_Z_Attack'||!Number.isInteger(carrier.ownerStateSerial)||carrier.ownerStateSerial<=afterStateSerial||carrier.eventId<afterEventId)continue;
  const command=commands.find(e=>e.eventId<carrier.eventId&&e.time<=carrier.time);if(!command)continue;
  const sampled=samples.some(s=>s.time>=command.time&&s.actors.some(a=>a.id===actorId&&states.has(a.state)&&a.stateSerial===carrier.ownerStateSerial));
  if(!sampled)continue;
  const hit=events.find(e=>e.type==='hit'&&e.actorId===actorId&&e.targetId===targetId&&e.amount>0&&e.eventId>carrier.eventId&&e.time>=carrier.time&&e.origin?.kind==='effect'&&e.origin.id===carrier.effectId);
  if(hit)return {commandEventId:command.eventId,commandStateSerial:carrier.ownerStateSerial,carrierEventId:carrier.eventId,effectId:carrier.effectId,
   hitEventId:hit.eventId,hitTime:hit.time,amount:hit.amount,targetId};
 }
 return null;
}

/** Original GameMajorXMeshPlayer ATT_Void_Field_M01 is LT_TIME7.75
 * (declaration SHA6c7a043054bc72ef2ad30a3ef4f8d563083817bbe51c049ef98d96128edffbcb).
 * That existing mesh lifetime can win before the independent .001 collapse
 * threshold. Validate the exact source carrier and sufficient observed clock;
 * arbitrary cancellation or early natural-expiry reports remain failures. */
export function classifyVoidRetirement({events,carrierClock,remainingEffects}){
 const c=carrierClock;
 if(!c||c.name!=='DamageEffect_ATT_Void_Field'||c.mainEffectName!=='ATT_Void_Field_M01'||
  !Number.isFinite(c.observedAt)||!Number.isFinite(c.meshLifetimeElapsed)||c.meshLifetimeElapsed<0||remainingEffects.some(e=>e.id===c.id))return null;
 for(const e of events){
  if(e.type!=='effectEnded'||e.effectId!==c.id||e.actorId!==c.ownerId||e.name!==c.name||!Number.isFinite(e.time)||e.time<c.observedAt)continue;
  if(e.reason==='original-void-field-collapse-ended')return {eventId:e.eventId,effectId:e.effectId,time:e.time,reason:e.reason,route:'original-collapse-threshold'};
  if(e.reason==='template-life-time'&&c.templateFields?.LifeType==='LT_TIME'&&c.templateFields.LifeTime===7.75&&c.lifeTimeSeconds===7.75){
   // Owner stops can only reduce elapsed mesh time. This upper bound rejects
   // an expiry reported before the captured original7.75 could be reached;
   // the exact terminal reason separately identifies the real executor gate.
   const clockUpperBound=c.meshLifetimeElapsed+(e.time-c.observedAt);
   if(clockUpperBound>=c.lifeTimeSeconds)return {eventId:e.eventId,effectId:e.effectId,time:e.time,reason:e.reason,
    route:'original-template-lifetime',lifeTimeSeconds:c.lifeTimeSeconds,clockUpperBound};
  }
 }
 return null;
}
