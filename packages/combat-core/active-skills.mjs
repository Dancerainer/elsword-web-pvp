/** State bindings only. Decisions are returned by unchanged compiled callbacks.
 * A V5 binding remains a reference candidate until compared with target 2016. */
export const ORIGINAL_SKILL_EVENTS=Object.freeze({
  RSI_SA_RRF_WILD_CHARGE_READY:1,
  RSI_SA_RRF_WILD_CHARGING:67,
  RSI_SA_RRF_WILD_CHARGE_DASH:3,
  RSI_SI2_OVER_TAKER_ARC_ENEMY:18,
  RSI_SA_ROT_VALKYRIESJAVELIN:21,
  RSI_SA_ROT_VALKYRIESJAVELIN_LANDING:22,
  RSI_A_RRF_LIMIT_CRUSHER_CHARGE:4,
  RSI_A_RWT_FLAME_SWORD:5,
  RSI_A_RWT_FLAME_SWORD_GROUND:6,
  RSI_A_RWT_FLAME_SWORD_FLY:7,
  RSI_SI1_MAXIMUM_CANNON:8,
  RSI_SI2_CANNON_BLADE:9,
  RSI_SI3_SEVEN_BURST:10,
  RSI_SI1_OVER_TAKER_CHARGED_BOLT:11,
  RSI_A_RF_MEGADRILL_BREAK:12,
  RSI_A_ROT_WEAPON_BREAK:13,
  RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE:14,
  RSI_A_ROT_NUCLEAR:15,
  RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK:16,
  RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK:17,
  SI_SA_RRF_X_CRASH:19,
  RSI_HA_RRF_INFERNAL_ARM:20,
  RSI_SI2_POWER_ASSAULT:23,
});
const successors={1:'RSI_SA_RRF_WILD_CHARGING',2:'RSI_SA_RRF_WILD_CHARGE_DASH',3:'RSI_WAIT',4:'RSI_JUMP_DOWN',5:'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK',
  6:'RSI_A_RWT_FLAME_SWORD_FLY',7:'RSI_A_RWT_FLAME_SWORD_GROUND',8:'RSI_JUMP_LANDING',9:'RSI_SA_ROT_VALKYRIESJAVELIN_LANDING'};
const inputKeys=['UP','DOWN','RIGHT','LEFT','Z','X','A','S','D','C','Q','W','E','R','AWAKEN'];
const invalidHandle=0xffffffff;
function extra(native,actor,profile,dt,kind){
  return native.evaluate({kind,time:actor.animationTime,before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,
    dt,hp:actor.hp,hpMax:actor.hpMax,power:actor.skillScale,awakening:actor.awakening.remaining,
    grounded:actor.grounded,position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,
    skillExtra:{nowSpeedX:actor.vx*actor.facing,nowSpeedY:actor.vy,passiveSpeedX:actor.passiveSpeed?.x??-1,
      passiveSpeedY:actor.passiveSpeed?.y??-1,disableGravity:actor.skillDisableGravity??false,
      downAccel:actor.skillDownAccel??0,gravityAccel:profile.physics.G_ACCEL,
      damageReducePercent:actor.skillDamageReducePercent??0}});
}
export function originalSkillStart(native,actor,profile){
  if(!native)return null;
  const kind=actor.state==='RSI_SA_ROT_VALKYRIESJAVELIN'?61:actor.state==='RSI_SA_RRF_WILD_CHARGING'?65:null;
  return kind?extra(native,actor,profile,0,kind):null;
}
function originalDrill(native,actor,profile,dt,kind,sourceInputs){
  const raw=profile.states[actor.state].raw;
  const saved=actor.sourceMegaDrill??{};
  // Frame phases intentionally share the original Now/Future oneshot fields.
  // Dash getter and hand bone are explicit inputs: neither is guessed here.
  const megaDrill={nowSpeedX:actor.vx*actor.facing,dashSpeed:sourceInputs.dashSpeed,
    damageChangeTime:raw.DAMAGEDATA_CHANGE_TIME,hitListSize:Object.keys(actor.hits??{}).length,
    reAttack:saved.reAttack??raw.DAMAGE_DATA?.RE_ATTACK===1,
    hitGap:saved.hitGap??raw.DAMAGE_DATA?.HIT_GAP??0,backSpeedX:saved.backSpeedX??raw.DAMAGE_DATA?.BACK_SPEED_X??0,
    lhandEnabled:saved.lhandEnabled??false,swordEnabled:saved.swordEnabled??true,luaTableOpen:true,
    particleHandle:saved.particleHandle??invalidHandle,meshHandle:saved.meshHandle??invalidHandle,
    particleExists:sourceInputs.particleExists??false,meshExists:sourceInputs.meshExists??false,
    handPosition:kind===57?sourceInputs.handPosition:[0,0,0],
    createdParticleHandle:sourceInputs.createdParticleHandle??invalidHandle,
    createdMeshHandle:sourceInputs.createdMeshHandle??invalidHandle,damageStage:saved.damageStage??0};
  return native.evaluate({kind,time:actor.animationTime,before:actor.animationBeforeTime??0,
    oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,power:actor.skillScale,
    awakening:actor.awakening.remaining,grounded:actor.grounded,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,megaDrill});
}
export function originalSkillFuture(native,actor,profile,dt,sourceInputs={}){
  if(!native)return null;
  if(actor.state==='RSI_A_RF_MEGADRILL_BREAK')return originalDrill(native,actor,profile,dt,56,sourceInputs);
  const kind=actor.state==='RSI_SI2_POWER_ASSAULT'?59:actor.state==='RSI_SI3_SEVEN_BURST'?60:null;
  if(!kind)return null;
  return native.evaluate({kind,time:actor.animationTime,before:actor.animationBeforeTime??0,
    oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,power:actor.skillScale,
    awakening:actor.awakening.remaining,grounded:actor.grounded,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,
    skillMotion:{nowSpeedX:actor.vx*actor.facing,passiveSpeedX:actor.passiveSpeed?.x??0}});
}
export function originalSkillEnd(native,actor,profile,sourceInputs={}){
  const kind=actor.state==='RSI_SA_ROT_VALKYRIESJAVELIN'?63:actor.state==='RSI_SA_RRF_WILD_CHARGING'?66:null;
  if(kind&&native)return extra(native,actor,profile,0,kind);
  if(actor.state!=='RSI_A_RF_MEGADRILL_BREAK'||!native)return null;
  return originalDrill(native,actor,profile,0,58,sourceInputs);
}
export function originalSkillFrame(native,actor,profile,dt,sourceInputs={}){
  if(!native)return null;
  if(actor.state==='SI_SA_RRF_X_CRASH')return native.evaluate({kind:69,time:actor.animationTime,
    before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,
    power:actor.skillScale,awakening:actor.awakening.remaining,grounded:actor.grounded,
    position:[actor.x,actor.y,actor.z],rotation:[0,actor.facing<0?180:0,0],direction:[actor.facing,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,
    xCrash:{bonePosition:sourceInputs.xCrashBonePosition,savedPosition:actor.sourceXCrash?.savedPosition??[0,0,0],
      hyperState:actor.skillContext?.hyperState===true}});
  if(actor.state==='RSI_SA_ROT_VALKYRIESJAVELIN')return extra(native,actor,profile,dt,62);
  if(actor.state==='RSI_SA_RRF_WILD_CHARGE_READY')return extra(native,actor,profile,dt,64);
  if(actor.state==='RSI_SA_RRF_WILD_CHARGING'){
    const declaration=profile.skillCatalog.find(s=>s.skillId===actor.skillId)?.raw;
    const duration=declaration?.SA_EFFECTIVE_TIME?.[String(actor.skillContext?.level??1)];
    if(!(duration>0))throw new TypeError('Wild Charge target charge duration missing');
    const elapsed=(actor.sourceWildCharge.elapsed??0)+dt;
    // 2016 SA_EFFECTIVE_TIME=.75, SA_ATK_REL=1.5. The old C++ counter's
    // full threshold is 10; bind target seconds to that threshold, retaining
    // its one-shot feedback and three-second maximum hold after full charge.
    const equivalent=elapsed>=duration?10:Math.min(9.9,elapsed/duration*10);
    const result=native.evaluate({kind:68,time:actor.animationTime,
    before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,
    charge:equivalent,afterFull:actor.sourceWildCharge.afterFull,
    previousHp:actor.hp,power:actor.skillScale,awakening:actor.awakening.remaining,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false});
    return {...result,charge:equivalent,targetChargeElapsed:elapsed,targetChargeDuration:duration};
  }
  if(actor.state==='RSI_SA_RRF_WILD_CHARGE_DASH'){
    const result=native.evaluate({kind:3,time:actor.animationTime,
    before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,
    charge:actor.sourceWildCharge?.sourceChargeEquivalent??0,power:actor.skillScale,awakening:actor.awakening.remaining});
    const raw=profile.skillCatalog.find(s=>s.skillId===actor.skillId)?.raw;
    const duration=raw?.SA_EFFECTIVE_TIME?.['1'],bonus=raw?.SA_ATK_REL?.['1'];
    if(!(duration>0)||!(bonus>=1))throw new TypeError('Wild Charge target strength missing');
    const fraction=Math.min(1,(actor.sourceWildCharge?.elapsed??0)/duration);
    const power=actor.skillScale*(1+(bonus-1)*fraction);
    return {...result,effectPower:power,commands:result.commands.map(c=>c.name==='EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK'?{...c,power}:c)};
  }
  if(actor.state==='RSI_A_RF_MEGADRILL_BREAK')return originalDrill(native,actor,profile,dt,57,sourceInputs);
  if(actor.state!=='RSI_SI1_OVER_TAKER_CHARGED_BOLT')return null;
  return native.evaluate({kind:24,time:actor.animationTime,before:actor.animationBeforeTime??0,
    oneshot:actor.animationOneshotTimer??0,dt,hp:actor.hp,hpMax:actor.hpMax,power:actor.skillScale,
    awakening:actor.awakening.remaining,grounded:actor.grounded,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false});
}
export function originalSkillEvent(native,actor,profile,input,dt,before){
  const kind=ORIGINAL_SKILL_EVENTS[actor.state];
  if(!kind||!native)return null;
  const d=profile.states[actor.state],raw=d.raw,period=d.clip?.durationSeconds;
  const ended=Boolean(actor.animationStopped || period>0&&actor.animationTime>period-Math.max(period/10,.03));
  const inputMask=inputKeys.reduce((mask,key,i)=>mask|(input.held.has(key)?1<<i:0),0);
  const result=native.evaluate({kind,time:actor.animationTime,before,dt,hp:actor.hp,hpMax:actor.hpMax,
    held:input.held.has(actor.skillContext?.key),ended,grounded:actor.grounded,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,
    power:actor.skillScale,awakening:actor.awakening.remaining,inputMask,
    charge:actor.sourceWildCharge?.sourceChargeEquivalent??0,afterFull:actor.sourceWildCharge?.afterFull??0,
    walkCancel:raw.WALK_CANCEL_AFTER??0,dashCancel:raw.DASH_CANCEL_AFTER??0,skillCancel:raw.SKILL_CANCEL_AFTER??0});
  const state=successors[result.stateChange];
  if(result.stateChange&&!state)throw new RangeError('Original skill successor has no confirmed target binding');
  return {...result,state,ended};
}
