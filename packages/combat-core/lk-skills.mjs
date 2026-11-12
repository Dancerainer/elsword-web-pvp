import {requestActorStop} from './source-stop-queues-v53.mjs';
/** LK skill host consumers. Target2016 declarations supply all magnitudes;
 * fixed SwordMan callbacks supply qualified state/lifecycle references.
 * Descriptor adapters are identified in reports/lk-skills-v2.md, never client gold.
 */
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {evaluateStateProtection} from './state-protection.mjs';
import {stateProtectionOptions} from './user-state-protection.mjs';
import {ARMAGEDDON_SET} from './lk-effect-set-targets.mjs';
import {arcLineBasis} from './archenemy-mesh.mjs';
import {windmillExtraMp,windmillEndReason} from './profession-source-v53.mjs';
const f=Math.fround;
// Both promotions inherit the same source Elsword common skill callbacks.
// Promotion-only hooks below remain gated by their source state/passive IDs.
const lk=(sim,a)=>[100,101,112].includes(sim.profileFor(a).target.unitClass);
const saved=a=>(a.sourceLordKnight??={autoGuardCooldown:0});
const level=(skill,a,key)=>{const n=skill?.raw?.[key]?.[String(a.skillContext?.level??skill.maxLevel)];
  if(!Number.isFinite(n))throw new TypeError('Missing target LK '+key);return n;};
const ended=(sim,a)=>{const p=sim.profileFor(a).states[a.state].clip.durationSeconds;return a.animationTime>p-Math.max(p/10,.03);};
const leave=(sim,a)=>sim.enter(a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','lk-original-skill-end');
const skipKeys=['Z','X','UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'];
export function lordKnightCastDisplayClock(sim,a,set,effects){
  if(!lk(sim,a)||set!==ARMAGEDDON_SET||a.state!=='ESSI_SI3_ES_ARMAGEDDON_BLADE')return;
  // The target display schedules its sword at 1.1, before cast damage at
  // 1.68. Starting a second zero clock at the buff callback delays the sword
  // until after the cast. This scoped target-timeline adapter catches up the
  // newly registered display; the persistent custom clock then continues.
  // V5's buff callback is a version reference, not a matching V6 consumer.
  for(const e of effects)e.setElapsed=a.animationTime;
}
export function lordKnightPendingCastSword(sim,a,e){
  return lk(sim,a)&&a.state==='ESSI_SI3_ES_ARMAGEDDON_BLADE'&&e.setName===ARMAGEDDON_SET&&
    e.buffTemplateId===322&&e.clock==='custom'&&e.setElapsed>=e.start;
}
const stopGroup=(sim,a,key)=>{for(const id of saved(a)[key]??[]){const e=sim.state.effects.find(e=>e.id===id);
  if(e){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,name:e.name,setName:e.setName,reason:'lk-source-skill-end'});}}
  delete saved(a)[key];};
function spawnGroup(sim,a,names,key){const first=sim.state.nextEffectId;for(const name of names)sim.spawnSet(a,name);
  saved(a)[key]=sim.state.effects.filter(e=>e.id>=first).map(e=>e.id);}

export function lordKnightCharacterAttackStage(profile,actor){
  if(![100,101,112].includes(profile.target?.unitClass)||!/^ESSI_SI3_ES_UNLIMITED_BLADE(?:_HYPER)?$/.test(actor.state))return 0;
  const raw=profile.states[actor.state].raw;
  // The sixth normal callback in fixed V5 says 1.566, outside the target's
  // 1.5..1.566 damage window. Bind to the reviewed target2016 attack starts,
  // preserving the original per-swing reset consumer rather than that drift.
  return Array.from({length:6},(_,i)=>raw['ATTACK_TIME'+i]['1'])
    .filter(time=>f(actor.animationTime)>=f(time)).length;
}
export function lordKnightCharacterAttackTimers(sim,a,before,after){
  if(!lk(sim,a)||!/^ESSI_SI3_ES_UNLIMITED_BLADE(?:_HYPER)?$/.test(a.state))return;
  const raw=sim.profileFor(a).states[a.state].raw;
  for(let stage=0;stage<6;stage++)sim.fire(a,'lk-unlimited-swing:'+stage,raw['ATTACK_TIME'+stage]['1'],before,after,()=>{
    a.hits={};a.hitGaps={};
    sim.emit('characterDamageDataChanged',a.id,{state:a.state,dataStage:stage+1,animationTime:after,
      eventTime:raw['ATTACK_TIME'+stage]['1'],clearHitUnits:true,
      evidence:'target2016 six ATTACK_TIME starts + fixed-V5 SwordMan10193/10534 per-swing hitUnitList reset; target-client-unmeasured'});
  });
}

export function lordKnightCastState(sim,a,skill){
  if(!lk(sim,a))return skill.state;
  const hyper=skill.state+'_HYPER';
  return a.awakening.remaining>0&&sim.profileFor(a).states[hyper]?hyper:skill.state;
}
export function lordKnightCast(sim,a,skill,{mpCost,priorSkill}){
  if(!lk(sim,a))return false;
  const policy=a.skillContext.traitPolicy;
  if(policy.mpRefundChance>0&&sim.rng()<policy.mpRefundChance){const amount=f(mpCost*policy.mpRefundFraction);
    a.mp=Math.min(a.mpMax,a.mp+amount);sim.emit('traitMpRefund',a.id,{skillId:skill.skillId,amount,branchId:policy.branchId});}
  if(skill.executor!=='IronBody')return false;
  // SwordMan SpecialAttackNoStageChange/ProcessEnduranceSkill. The upgraded
  // target has exactly one factor714: do not select the obsolete memo factor1.
  const ids=Object.values(skill.raw.BUFF_FACTOR??{});
  for(const id of ids)sim.grantBuff(a,a,id,a.skillContext.level,policy);
  const removed=a.buffs.filter(buff=>{
    const source=sim.state.actors.find(actor=>actor.id===buff.sourceActorId)??a;
    return sim.profileFor(source).buffTemplates[buff.templateId]?.raw.IS_DEBUF;
  });
  a.buffs=a.buffs.filter(buff=>!removed.includes(buff));
  for(const buff of removed){
    for(const effect of sim.state.effects)if(effect.ownerId===a.id&&effect.buffTemplateId===buff.templateId){effect.dead=true;effect.endReason='lk-iron-body-cleanse';}
    sim.emit('buffFinished',a.id,{templateId:buff.templateId,reason:'lk-iron-body-cleanse'});
  }
  // This skill does not enter a state. Recompose immediately so a later hit
  // in the same packet observes armor, and cleared debuffs leave no stat or
  // input restriction even when they were the final negative identity.
  synchronizeBuffStats(a);
  a.buffControls={inputBlock:a.buffs.some(b=>b.behaviors.some(v=>v.kind==='stun'&&!v.identityCleared)),
    dashBlock:a.buffs.some(b=>b.behaviors.some(v=>v.kind==='dashBlock'))};
  Object.assign(a,evaluateStateProtection(sim.profileFor(a).states[a.state].raw,a.animationTime,
    stateProtectionOptions(sim.presetFor(a),a,{forceInvincible:a.forceInvincible})));
  sim.spawnSet(a,'EffectSet_ELSWORD_ENDURANCE');sim.emit('sound',a.id,{name:'Elsword_Endurance.ogg',field:'lk-no-state-skill'});
  Object.assign(a,priorSkill);return true;
}
export function lordKnightStateStart(sim,a){
  if(!lk(sim,a))return;
  const s=saved(a),profile=sim.profileFor(a),raw=profile.states[a.state].raw;
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_READY')s.charge=0;
  if(a.state==='ESSI_SI_A_ES_ROLLING')a.vx=level(sim.skill(a.skillId,a),a,'SA_TELEPORT_SPEED_REL')*1200*a.facing;
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_FIRE'&&s.charge>=1)a.skillScale*=1.5;
  if(a.state==='ESSI_A_ELK_ROLLING_SMASH'){
    const skill=sim.skill(a.skillId,a);s.rollingDuration=f(f(2*a.vy)/profile.physics.G_ACCEL);
    a.passiveSpeed.x=f(level(skill,a,'SA_TELEPORT_RANGE_ABS')*100/s.rollingDuration);
    a.grounded=false;a.lineId=null;
  }
  if(a.state==='ESSI_SA_ESK_WINDMILL_START'){a.skillDisableGravity=true;a.vx=0;a.vy=0;}
  if(a.state==='ESSI_SA_ESK_WINDMILL'){
    a.skillDisableGravity=false;
    sim.grantBuff(a,a,sim.skill(a.skillId,a).raw.BUFF_FACTOR['1'],a.skillContext.level);
  }
  if(a.state==='ESSI_REVENGE_WAIT')a.vx=0;
  if(a.state==='ESSI_REVENGE_ATTACK'){
    s.counterLaunch=sim.rng()<level(sim.skill(21206,a),a,'SA_EFFECTIVE_RATE');
  }
}
export function lordKnightStateEnd(sim,a,next){
  if(!lk(sim,a))return;
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_FIRE')stopGroup(sim,a,'megaEffects');
  if(a.state==='ESSI_SA_ESK_WINDMILL_START'&&next!=='ESSI_SA_ESK_WINDMILL'||a.state==='ESSI_SA_ESK_WINDMILL'){
    stopGroup(sim,a,'windmillEffects');a.skillDisableGravity=false;
    if(a.state==='ESSI_SA_ESK_WINDMILL'){
      sim.spawnSet(a,'EffectSet_ELSWORD_WINDMILL_LAND_END');
      sim.emit('soundStopped',a.id,{name:'Elsword_WindmillSpin.ogg',field:'target2016-windmill-loop-exit'});
    }
  }
  if(a.state==='ESSI_SA_ESK_WINDMILL_START'&&next==='ESSI_SA_ESK_WINDMILL')
    sim.emit('sound',a.id,{name:'Elsword_WindmillSpin.ogg',loop:true,field:'target2016-windmill-start-exit'});
}
export function lordKnightFrame(sim,a,input,dt){
  if(!lk(sim,a))return;
  const s=saved(a);s.autoGuardCooldown=Math.max(0,s.autoGuardCooldown-dt);
  if(['ESSI_SA_ESK_WINDMILL','ESSI_SA_ESK_WINDMILL_END'].includes(a.state)){
    s.windmillDelta=f(dt);
    const base=level(sim.skill(21010,a),a,'SA_EFFECTIVE_TIME'),q=windmillExtraMp(dt);
    if(a.stateTime>base&&q<=a.mp){a.mp=f(Math.max(0,f(a.mp)-q));
      sim.emit('windmillExtraMpPaid',a.id,{amount:q,elapsed:a.stateTime,base,evidence:'target2016 32948570 local frame'});}
  }
  if(a.state==='ESSI_REVENGE_WAIT')a.vx=0;
  if(a.state==='ESSI_SA_ESK_WINDMILL'){
    const profile=sim.profileFor(a),direction=input.held.has('RIGHT')?1:input.held.has('LEFT')?-1:0;
    if(direction)a.facing=direction;
    a.vx=direction*profile.physics.RUN_SPEED*a.stats.moveSpeedMultiplier;
    if(a.grounded&&input.held.has('UP')){a.vy=profile.physics.JUMP_SPEED*a.stats.jumpSpeedMultiplier;a.y+=profile.referenceSemantics.lineRadius;a.grounded=false;a.lineId=null;}
    if(a.grounded&&input.pressed.has('DOWN')){
      const down=sim.nativeGeometry?.down({position:[a.x,a.y,a.z],radius:profile.referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId,downRadius:true,onLine:true});
      if(down?.found){a.y-=profile.referenceSemantics.lineRadius*1.5;a.grounded=false;a.lineId=null;a.ignoreLineId=a.lastTouchLineId;}
    }
  }
}
export function lordKnightEvents(sim,a,before,after){
  if(!lk(sim,a))return;
  const profile=sim.profileFor(a),raw=profile.states[a.state].raw;
  if(a.state==='ESSI_REVENGE_WAIT')sim.fire(a,'lk-counter-minor-visual',f(.09),before,after,()=>{
    let basis;try{basis=arcLineBasis(a,sim.map.lines);}catch{sim.note('lk-counter-line-basis','Original Counter Attack line basis unavailable; visual omitted',a);return;}
    const position=[a.x,a.y+70,a.z].map((v,i)=>v+basis.direction[i]*a.facing*100);
    sim.emit('counterWaitVisual',a.id,{ownerStateSerial:a.stateSerial,position,rotation:[0,basis.rotation[1]+70,0],
      source:'target2016 Frame329516c0/.09 GameMinor RevengeWait; contracts/lk-counter-native-v49.json'});
  });
  const skill=sim.skill(a.skillId,a),upgraded=Boolean(skill?.replacesSkillId);
  const finalSets=upgraded&&raw.EFFECT_SET_LIST_FINAL_ULTIMATE?raw.EFFECT_SET_LIST_FINAL_ULTIMATE:raw.EFFECT_SET_LIST_FINAL;
  for(const [key,entry]of Object.entries(finalSets??{}))if(entry.EFFECT_NAME)
    sim.fire(a,'lk-final-set:'+key,entry.START_TIME??0,before,after,()=>sim.spawnSet(a,entry.EFFECT_NAME,undefined,Object.values(entry.DELETE_CONDITION??{})));
  if(a.state==='ESSI_SI_A_ES_ROLLING_END')sim.fire(a,'lk-rolling-dust',.03333,before,after,()=>sim.spawnSet(a,'EffectSet_ES_ROLLING'));
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_FIRE'){
    sim.fire(a,'lk-mega-damage',raw.ATTACK_TIME0['1'],before,after,()=>{
      const e=sim.createEffect(a,{NAME:'DamageEffect_SA_Elsword_MegaSlash_Damage',BONE_NAME:'Bip01',TRACE:1},{deleteConditions:[2]});
      saved(a).megaEffects=[e.id];
    });
    sim.fire(a,'lk-mega-end',raw.ATTACK_TIME0['2'],before,after,()=>stopGroup(sim,a,'megaEffects'));
  }
  if(a.state==='ESSI_SA_ESK_WINDMILL_START')sim.fire(a,'lk-windmill-create',.1,before,after,()=>
    spawnGroup(sim,a,['EffectSet_ELSWORD_WINDMILL','EffectSet_ELSWORD_WINDMILL_LAND'],'windmillEffects'));
  if(a.state==='ESSI_SI3_ES_ARMAGEDDON_BLADE'){
    sim.fire(a,'lk-armageddon-buff',1.68,before,after,()=>sim.grantBuff(a,a,sim.skill(21008,a).raw.BUFF_FACTOR['1'],a.skillContext.level));
    sim.fire(a,'lk-armageddon-light',.9,before,after,()=>{
      for(const name of ['Light_Knight_ArmageddonBlade01','Light_Knight_ArmageddonBlade02'])
        if(profile.effectTemplates[name])sim.createEffect(a,{NAME:name,BONE_NAME:'Dummy1_Rhand'});
    });
    sim.fire(a,'lk-armageddon-flare',1.7,before,after,()=>{
      const name='Flare_MagicKnight_WindBlade01';
      if(!profile.effectTemplates[name])return;
      const hand=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy1_Rhand'}},a);
      if(!hand)return;
      sim.createEffect(a,{NAME:name},{birthAnchor:{...hand,position:[hand.position[0]+a.facing*305,hand.position[1]+70,hand.position[2]],
        evidence:'fixed-V5 SwordMan12559 hand + facing305/worldY70; target2016 particle declaration, client-unmeasured'}});
    });
  }
  // Target CREATE_EFFECT_SET is a probabilistic passive animation callback,
  // distinct from the unconditional EFFECT_SET_LIST. It runs once per state.
  const wind=raw.CREATE_EFFECT_SET,passive=sim.skill(21402,a),passiveLevel=a.passivePolicy?.skillLevels?.[21402];
  if(wind?.['1']==='EffectSet_SI_P_ELK_WIND_SLICER'&&passiveLevel)
    sim.fire(a,'lk-wind-slicer',wind['2'],before,after,()=>{
      if(sim.rng()>=passive.raw.SA_EFFECTIVE_RATE[String(passiveLevel)])return;
      const first=sim.state.nextEffectId;sim.spawnSet(a,wind['1']);
      for(const e of sim.state.effects)if(e.id>=first){e.skillId=21402;e.powerMultiplier=passive.levelPowerRate??1;e.traitPolicy=null;}
      sim.emit('lkWindSlicer',a.id,{skillId:21402,level:passiveLevel});
    });
}
export function lordKnightSkillEvent(sim,a,input){
  if(!lk(sim,a))return false;
  const s=saved(a);
  if(a.state==='ESSI_SA_ELK_SONIC_BLADE'){
    // SwordMan14930/14978: animation end wins, otherwise the pure-key macro
    // releases to Wait strictly AFTER animation time 1.0 (not wall time).
    if(ended(sim,a)){leave(sim,a);return true;}
    if(f(a.animationTime)>f(1)&&skipKeys.some(k=>input.held.has(k)||input.pressed.has(k))){
      sim.enter(a,'RSI_WAIT','lk-sonic-source-skip');return true;
    }
    return true;
  }
  if(a.state==='ESSI_SI_A_ES_ROLLING'){
    if(ended(sim,a)&&a.grounded)sim.enter(a,'ESSI_SI_A_ES_ROLLING_END','lk-roll-land');
    else if(ended(sim,a))a.animationStopped=true;
    return true;
  }
  if(a.state==='ESSI_SI_A_ES_ROLLING_END'){
    // SwordMan16478: animation end wins; otherwise WALK_CANCEL_AFTER
    // releases to Wait on either pure horizontal direction, strictly after
    // the target2016 row's .266 animation seconds. All Elsword promotions
    // share this callback. Common input can move/attack on the next step.
    if(ended(sim,a)){leave(sim,a);return true;}
    const cancelAt=sim.profileFor(a).states[a.state].raw.WALK_CANCEL_AFTER;
    if(Number.isFinite(cancelAt)&&cancelAt>=0&&f(a.animationTime)>f(cancelAt)&&
      ['LEFT','RIGHT'].some(k=>input.held.has(k)||input.pressed.has(k)))
      sim.enter(a,'RSI_WAIT','elsword-roll-source-walk-cancel');
    return true;
  }
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_READY'){
    if(ended(sim,a))sim.enter(a,'ESSI_SI_A_MEGASLASH_MEMO_CHARGE','lk-charge-ready-end');return true;
  }
  if(a.state==='ESSI_SI_A_MEGASLASH_MEMO_CHARGE'){
    s.charge=a.stateTime;
    if(!input.held.has(a.skillContext?.key))sim.enter(a,'ESSI_SI_A_MEGASLASH_MEMO_FIRE','lk-charge-key-release');
    // Web lifecycle bound, not a measured target2016 auto-release consumer:
    // use the authored CHARGE clip's 1.7s duration as the maximum held time.
    // State time keeps advancing when the one-shot animation has stopped.
    else if(a.stateTime>=sim.profileFor(a).states[a.state].clip.durationSeconds)
      sim.enter(a,'ESSI_SI_A_MEGASLASH_MEMO_FIRE','lk-charge-duration-limit');
    else if(ended(sim,a))a.animationStopped=true;
    return true;
  }
  if(a.state==='ESSI_A_ELK_ROLLING_SMASH_READY'){
    if(ended(sim,a))sim.enter(a,'ESSI_A_ELK_ROLLING_SMASH','lk-rolling-ready-end');return true;
  }
  if(a.state==='ESSI_A_ELK_ROLLING_SMASH'&&a.stateTime>s.rollingDuration&&a.grounded){sim.enter(a,'ESSI_A_ELK_ROLLING_SMASH_LANDING','lk-rolling-land');return true;}
  if(a.state==='ESSI_SA_ESK_WINDMILL_START'){
    if(ended(sim,a))sim.enter(a,'ESSI_SA_ESK_WINDMILL','lk-windmill-start-end');return true;
  }
  if(a.state==='ESSI_SA_ESK_WINDMILL'){
    const key=a.skillContext?.slotKey??a.skillContext?.key,
      reason=windmillEndReason({elapsed:a.stateTime,base:level(sim.skill(21010,a),a,'SA_EFFECTIVE_TIME'),mp:a.mp,
        delta:s.windmillDelta??0,held:typeof key==='string'&&input.held.has(key)});
    if(reason){sim.enter(a,'ESSI_SA_ESK_WINDMILL_END',reason);return true;}
    return false;
  }
  if(/^ESSI_SI_P_ESK_AUTO_GUARD/.test(a.state)){
    if(ended(sim,a)){
      if(!a.state.includes('_END'))sim.enter(a,a.state.endsWith('_SMALL')?'ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL':'ESSI_SI_P_ESK_AUTO_GUARD_END','lk-auto-guard-end');
      else leave(sim,a);
    }return true;
  }
  if(a.state==='ESSI_REVENGE_WAIT'&&a.animationTime>.6&&['LEFT','RIGHT','UP','DOWN','A','S','D','C','Q','W','E','R'].some(k=>input.held.has(k))){leave(sim,a);return true;}
  return false;
}
export function lordKnightCharacterDamage(sim,a,data){
  if(!lk(sim,a)||!data)return data;
  if(/^ESSI_SI3_ES_UNLIMITED_BLADE(?:_HYPER)?$/.test(a.state)&&lordKnightCharacterAttackStage(sim.profileFor(a),a)>=4)
    data={...data,REACT_TYPE:2};
  if(a.state==='ESSI_REVENGE_ATTACK'){
    const s=saved(a);data={...data,DAMAGE:{...data.DAMAGE,PHYSIC:data.DAMAGE.PHYSIC+(s.revengePower??0)}};
    if(s.counterLaunch)data={...data,REACT_TYPE:4,BACK_SPEED_X:1100,BACK_SPEED_Y:1900};
  }
  return data;
}
export function lordKnightCounter(sim,a,b,data,origin,fromFront){
  if(!lk(sim,b)||b.state!=='ESSI_REVENGE_WAIT'||!fromFront)return false;
  const window=sim.profileFor(b).states[b.state].raw.REVENGE;
  if(!(b.animationTime>window['1']&&b.animationTime<window['2'])||data.CAN_REVENGE===0||data.CAN_REVENGE===false)return false;
  // DamageManager LoadDamageData multiplies the source damage ratio by its
  // power before GUUser stores GetAllDamage (not the attacker's attack stat).
  saved(b).revengePower=((data.DAMAGE?.PHYSIC??0)+(data.DAMAGE?.MAGIC??0))*(origin.powerMultiplier??1);
  sim.enter(b,'ESSI_REVENGE_ATTACK','lk-front-counter');
  // GUUser AttackResultPlayEffect12904–12917 handles RT_REVENGE by
  // direct-changing the melee attacker to its own USI_DAMAGE_REVENGE.
  // CEffect's reflect consumer is separate: do not stun a projectile owner.
  if(origin.kind!=='effect'&&a.hp>0){
    a.vx=0;a.vy=0;
    requestActorStop(a,'hit',data.STOP_TIME_ATT??data.STOP_TIME_ATK??0,null);
    sim.enter(a,'RSI_DAMAGE_REVENGE','counter-received-surprise',{directChange:true});
  }
  sim.emit('lkCounter',b.id,{attackerId:a.id,sourceEffectId:origin.kind==='effect'?origin.id:null});
  return true;
}
export function lordKnightAutoGuard(sim,b,data,fromFront){
  if(!lk(sim,b)||!b.passivePolicy?.skillLevels?.[21401]||!fromFront||!b.grounded||b.superArmor||saved(b).autoGuardCooldown>0||
    (data.ATTACK_TYPE??0)!==sim.profileFor(b).enums.ATTACK_TYPE.AT_NORMAL||data.NO_DAMAGE||[0,7,10].includes(data.REACT_TYPE)||data.HIT_TYPE===26)return false;
  const skill=sim.skill(21401,b),level=b.passivePolicy.skillLevels[21401];
  if(sim.rng()>=skill.raw.SA_EFFECTIVE_RATE[String(level)])return false;
  saved(b).autoGuardCooldown=skill.raw.SA_COOLTIME_1[String(level)];return true;
}
export function lordKnightDebuffApplied(sim,source,target,buff){
  if(!lk(sim,target)||!target.passivePolicy?.skillLevels?.[21404])return;
  const template=sim.profileFor(source).buffTemplates[buff.templateId]?.raw;
  if(!template?.IS_DEBUF||template.IS_WORLD_BUFF)return;
  const skill=sim.skill(21404,target);
  sim.grantBuff(target,target,skill.raw.BUFF_FACTOR['1'],target.passivePolicy.skillLevels[21404],null);
}
