/** 2016 Moonlight Rhapsody declarations + explicitly qualified fixed Add
 * 16123..16208 cast/pulse consumer. This source recovers the persistent zone
 * and original stacking debuff; target-client timing remains unmeasured. */
const f=Math.fround;
const SET='EffectSet_MOONLIGHT_RHAPSODY_DEBUFF';
const memo=a=>(a.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1});
const own=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const playable=(sim,a)=>own(sim,a)||sim.networkCombatPlaybackVersion===1;
const activeBuff=a=>(a.buffs??[]).find(b=>b.templateId===438&&b.factorId===476&&
 !b.finalizers.some(row=>row.remaining<=0));
function retireWave(sim,a){
 const displays=sim.state.localAddMoonlightWaves??[];
 for(const row of displays.filter(r=>r.ownerId===a.id))for(const id of row.ids){
  const effect=sim.state.effects.find(e=>e.id===id&&e.ownerId===a.id);
  if(effect){effect.dead=true;effect.endReason='moonlight-next-pulse';effect.suppressSecondaryDamage=true;}
  sim.emit('effectEnded',a.id,{effectId:id,reason:'moonlight-next-pulse'});
 }
 sim.state.localAddMoonlightWaves=displays.filter(r=>r.ownerId!==a.id);
}
export function validateAddMoonlightState(value,{owner,profile}={}){
 if(value==null)return true;
 const keys=['period','accumulator','power','group','skillId'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||
  ![1,f(.66)].includes(value.period)||!Number.isFinite(value.accumulator)||value.accumulator<0||value.accumulator>value.period+1e-6||
  !Number.isFinite(value.power)||value.power<0||value.power>100||!Number.isSafeInteger(value.group)||value.group<0||value.skillId!==29024||
  owner&&owner.professionId!=='DE'||profile&&(profile.target?.unitClass!==126||!profile.skillCatalog.some(s=>s.skillId===29024)))
  throw new TypeError('Invalid Add Moonlight controller');
 return true;
}
export function startAddMoonlight(sim,a,{consumeMutation}={}){
 if(a.professionId!=='DE'||!playable(sim,a))return false;
 // A received post-event controller is already authoritative. Replaying the
 // cast animation must not reset its partial period or shorten the variant.
 if(!own(sim,a)&&a.sourceAddCombat?.moonlight?.group===a.stateSerial)return true;
 const skill=sim.profileFor(a).skillCatalog.find(s=>s.skillId===29024);
 if(!skill||!sim.profileFor(a).effectSets[SET])return false;
 const buff=sim.grantBuff(a,a,476,skill.maxLevel,null);if(!buff)return false;
 let spent=0;
 if(own(sim,a)&&a.sourceAdd?.formation&&a.sourceAdd.mutation>0&&consumeMutation)
  spent=consumeMutation(a,1,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args)});
 else if(!own(sim,a)&&a.sourceAdd?.formation){
  const declared=a.skillContext?.addMutationSpent;
  spent=declared===0||declared===1?declared:a.sourceAdd.mutation>0?1:0;
 }
 if(own(sim,a)&&a.skillContext)a.skillContext.addMutationSpent=spent;
 retireWave(sim,a);
 memo(a).moonlight={period:spent?f(.66):1,accumulator:0,power:1,group:a.stateSerial,skillId:29024};
 sim.emit('addMoonlightStarted',a.id,{period:memo(a).moonlight.period,mutationSpent:spent,
  evidence:'2016 buff476/438 and skill29024; fixed-V5 reconstructed Add cast/pulse callback, not client measurement'});
 return true;
}
export function tickAddMoonlight(sim,a,dt){
 const state=a.sourceAddCombat?.moonlight;
 if(!state||a.professionId!=='DE'||!playable(sim,a)||!(dt>0))return;
 if(a.hp<=0||a.pvpDead||a.pvpDisconnected||!activeBuff(a)){
  // The recovered callback disarms without destroying the last wave, whose
  // authored mesh/particle lifetime is independent of the self buff.
  delete a.sourceAddCombat.moonlight;return;
 }
 state.accumulator=f(state.accumulator+f(dt));
 if(state.accumulator<=state.period)return;
 state.accumulator=0;retireWave(sim,a);
 const first=sim.state.nextEffectId;
 sim.spawnSet({...a,skillId:29024,skillScale:state.power,skillContext:null},SET,undefined,[],false);
 const ids=sim.state.effects.filter(e=>e.id>=first&&e.ownerId===a.id).map(e=>e.id);
 (sim.state.localAddMoonlightWaves??=[]).push({ownerId:a.id,ids});
 sim.emit('addMoonlightPulse',a.id,{period:state.period,effectIds:ids,evidence:'qualified fixed Add strict period check and timer reset; original zone declaration'});
}

/** Original RTTI Moonlight custom callback3229a330 selects the exact stack
 * set, attributes it to the current accepted-hit attacker and consumes439.
 * The caller owns its native damage/guard-field mapping. No broad assumed
 * on-hit hook is enabled while those source guards remain unqualified. */
export function consumeAddMoonlightExplosion(sim,attacker,recipient,{sourceGuardsPassed=false,position,power,hyperMode=false}={}){
 if(sourceGuardsPassed!==true||sim.observationOnly||sim.networkOwnerId!=null&&sim.networkOwnerId!==recipient.id)return false;
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(power)||power<0||typeof hyperMode!=='boolean')
  throw new TypeError('Original Moonlight explosion arguments required');
 const buff=recipient.buffs?.find(row=>row.templateId===439&&row.factorId===477&&row.accumulationCount>=1&&row.accumulationCount<=3&&
  row.behaviors.some(b=>b.kind==='sourceCallback'&&b.type===43)&&!row.finalizers.some(f=>f.remaining<=0));
 if(!buff)return false;
 const stack=buff.accumulationCount;
 // This callback is attached to the recipient. The actor who originally
 // applied its buff is not substituted for the attacker of this contact.
 const e=spawnAddMoonlightExplosion(sim,attacker,{stack,position,power,hyperMode});
 if(!e)return false;
 recipient.buffs=recipient.buffs.filter(b=>b.templateId!==439);
 for(const display of sim.state.effects)if(display.ownerId===recipient.id&&display.buffTemplateId===439){display.dead=true;display.endReason='moonlight-stack-consumed';}
 sim.emit('buffFinished',recipient.id,{templateId:439});
 sim.emit('addMoonlightExplosion',attacker.id,{targetId:recipient.id,stack,effectId:e.id,power,position:[...position],
  evidence:'original2016 native RTTI callback3229a330 stack branch and439 consumption; original declarations; target client unmeasured'});
 return true;
}

/** Spawn only on the current attacker's owner after a typed defender receipt.
 * The receiver computes power locally; a peer never supplies it. */
export function spawnAddMoonlightExplosion(sim,attacker,{stack,position,power,hyperMode=false}={}){
 if(sim.observationOnly||sim.networkOwnerId!=null&&sim.networkOwnerId!==attacker.id)return null;
 if(![1,2,3].includes(stack)||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||
  !Number.isFinite(power)||power<0||typeof hyperMode!=='boolean')throw new TypeError('Original Moonlight explosion arguments required');
 const setName='EffectSet_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_'+stack,profile=sim.profileFor(attacker),row=profile.effectSets[setName]?.raw.EFFECT0;
 if(!row||!profile.damageEffects[row.NAME]){sim.note('add-moonlight-explosion-closure:'+stack,'Exact original stack explosion set and damage closure required',attacker);return null;}
 const e=sim.createEffect({...attacker,skillId:29024,skillScale:power,skillContext:null},row,
  {setName,clock:'custom',start:row.START_TIME??0,hyperMode,birthAnchor:{position:[...position],rotation:[0,0,0],facing:attacker.facing,customPosition:true}});
 if(e)e.definitionMember='EFFECT0';return e;
}
