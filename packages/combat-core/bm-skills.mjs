/** Original2016 BM tables, shared effect/buff execution, qualified fixedV5
 * lifecycle callbacks. Missing original-client evidence remains explicit. */
import {bladeMasterState} from './bm-commands.mjs';
const f=Math.fround;
export const isBladeMaster=(sim,a)=>sim.profileFor(a).target.unitClass===106;
const current=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
const ended=(sim,a)=>{const d=sim.profileFor(a).states[a.state].clip.durationSeconds;return a.animationStopped||f(a.animationTime)>f(d-Math.max(d/10,.03));};
const leave=(sim,a)=>sim.enter(a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','bm-reference-skill-end');
const H='RSI_HA_RBM_EXTREM_BLADE_',W='SI_SA_RBM_WOLF_FANG_',S='RSI_A_RBM_SONIC_SLASH_';
const divider='RSI_SA_RST_SHOCKWAVE',cutter=divider+'_FRONT';
const shockwaves=new Set(['DamageEffect_RST_ShockWave','DamageEffect_RST_ShockWave_Ultimate','DamageEffect_RBM_ShockWave_Cutter']);
const ownExecutors=new Set(['FinishingSlash','ShockwaveDivider','BerserkerBlade','FatalWound','ArmorCrash','HypersonicStab','BloodyAccel','SonicSlash','GigaDriveLimiter','ShockwaveCutter','CutTendon','WolfFang','ExtremeBlade']);
function stopBlackHole(sim,a){
  const s=bladeMasterState(a);
  for(const effect of sim.state.effects)if(s.blackHoleEffectIds?.includes(effect.id)){
    effect.dead=true;effect.endReason='original-stop-effect-set';
  }
  s.blackHoleEffectIds=[];
}
function cancelBlackHole(a){
  const s=bladeMasterState(a);s.blackHoleCount=0;s.blackHoleRemaining=0;
}
export function bladeMasterCastState(sim,a,skill){
  if(!isBladeMaster(sim,a))return skill.state;
  const s=bladeMasterState(a);s.loops=0;s.missRefunded=false;
  if(skill.executor==='FatalWound')return skill.state+(a.grounded?'_GROUND':'_FLY');
  const hyper=skill.state+'_HYPER';
  return a.awakening.remaining>0&&sim.profileFor(a).states[hyper]?hyper:skill.state;
}
export function bladeMasterCast(sim,a,skill,mpCost){
  if(!isBladeMaster(sim,a))return;
  // Fixed V5 Raven5975..5982 clears the retained black-hole timer only after
  // SpecialAttack succeeds. Failed availability/payment never calls here.
  // Raven5490..5509 then stops all members through the saved set handle.
  cancelBlackHole(a);
  const policy=a.skillContext.traitPolicy;
  if(policy.mpRefundChance>0&&sim.rng()<policy.mpRefundChance){const amount=f(mpCost*policy.mpRefundFraction);a.mp=Math.min(a.mpMax,a.mp+amount);sim.emit('traitMpRefund',a.id,{skillId:skill.skillId,amount,branchId:policy.branchId});}
}
export function bladeMasterStart(sim,a){
  if(!isBladeMaster(sim,a))return;
  const n=current(sim,a),s=bladeMasterState(a);
  // The set has no DELETE_STATE member flag. Cancellation belongs to Raven's
  // WAIT/WALK/DASH_END callbacks (6116..6123 / 6180..6187 / 6490..6497),
  // rather than to arbitrary state changes or the ZZZXZ continuation.
  if(['RSI_WAIT','RSI_WALK','RSI_DASH_END'].includes(n))cancelBlackHole(a);
  if(n===divider||n===cutter){a.skillDisableGravity=true;a.vx=a.vy=0;a.passiveSpeed={x:-1,y:-1};}
  if(n==='RBM_DASH_JUMP_COMBO_XZ')sim.spawnSet(a,'EffectSet_RST_DashJump_XZ');
  if(n===H+'ATTACK'){s.extremeElapsed=0;s.extremeLifted=false;s.extremeHidden=false;}
  if(n===H+'ATTACK_FINISH'&&s.extremeLifted){a.y-=350;s.extremeLifted=false;}
  // Raven16128/16157/16190 resets the retained set's timer on every path to
  // the finishing state; its .4 animation callback stops the original handle.
  if(n==='RBM_COMBO_ZZZX_EXPLOSION'){s.blackHoleCount=0;s.blackHoleRemaining=1;}
}
export function bladeMasterEnd(sim,a,next){
  if(!isBladeMaster(sim,a))return;
  const n=current(sim,a),s=bladeMasterState(a);
  if(n===divider||n===cutter)a.skillDisableGravity=false;
  if(n===H+'READY'&&next===H+'ATTACK'){
    // The source processes due set events before committing Future's next
    // state. Retain already-due READY births before that state's clock resets.
    for(const effect of sim.state.effects)if(effect.ownerId===a.id&&effect.ownerStateSerial===a.stateSerial
      &&effect.setName==='EffectSet_SA_RBM_Extrem_Blade_Start'&&!effect.active&&effect.clock==='animation'
      &&a.animationTime-effect.setStartAnimation>=effect.start){
      effect.setElapsed=a.animationTime-effect.setStartAnimation;effect.clock='custom';
      const anchor=sim.effectAnchorSampler?.(effect,a,{profile:sim.profileFor(a)});
      if(anchor)effect.birthAnchor=structuredClone(anchor);
    }
  }
  if(n===H+'ATTACK'){
    a.hidden=false;s.extremeHidden=false;
    if(next!==H+'ATTACK_FINISH'&&s.extremeLifted){a.y-=350;s.extremeLifted=false;}
  }
  // The common back-rise consumer owns its own FLIP_DIR_END. Only BM's
  // alternating black-hole command turns here; applying both turns cancels it.
  if(n==='RBM_COMBO_ZZZXZ'&&sim.profileFor(a).states[a.state].raw.FLIP_DIR_END===1)a.facing*=-1;
  if(next.startsWith('RSI_DAMAGE_')||next.startsWith('RSI_DIE_')){s.blackHoleCount=0;s.blackHoleRemaining=0;}
  if(next.startsWith('RSI_DIE_')){s.winHits=0;s.winCooldown=0;s.escapeCooldown=0;}
}
/** FINAL_ULTIMATE and its weighted random branch are target2016 declarations.
 * Select exactly one random row; never spawn both normal/ultimate shockwaves. */
function finalSets(sim,a,before,after){
  const raw=sim.profileFor(a).states[a.state].raw,sk=sim.skill(a.skillId,a);
  const sets=sk?.replacesSkillId&&raw.EFFECT_SET_LIST_FINAL_ULTIMATE?raw.EFFECT_SET_LIST_FINAL_ULTIMATE:raw.EFFECT_SET_LIST_FINAL;
  if(!sets)return;
  const random=Object.entries(sets).filter(([key,row])=>key.startsWith('EFFECT_SET_RANDOM')&&row.EFFECT_NAME);
  if(random.length){
    const at=Math.min(...random.map(([,row])=>row.START_TIME??0));
    sim.fire(a,'bm-final-random',at,before,after,()=>{let roll=sim.rng()*Object.values(sets.RATE).reduce((s,n)=>s+n,0),chosen=random.at(-1)[1];
      for(let i=0;i<random.length;i++){roll-=sets.RATE[String(i+1)]??0;if(roll<0){chosen=random[i][1];break;}}
      sim.spawnSet(a,chosen.EFFECT_NAME,undefined,Object.values(chosen.DELETE_CONDITION??{}));});
  }
  for(const [key,row]of Object.entries(sets))if(!key.startsWith('EFFECT_SET_RANDOM')&&row.EFFECT_NAME)
    sim.fire(a,'bm-final:'+key,row.START_TIME??0,before,after,()=>sim.spawnSet(a,row.EFFECT_NAME,undefined,Object.values(row.DELETE_CONDITION??{})));
}
export function bladeMasterEvents(sim,a,before,after){
  if(!isBladeMaster(sim,a))return;
  const n=current(sim,a),s=bladeMasterState(a);finalSets(sim,a,before,after);
  const at=(id,time,fn)=>sim.fire(a,'bm:'+id,time,before,after,fn);
  if(n==='RSI_A_RST_BLOODY_ACCEL'||n==='RSI_SA_RBM_GIGA_DRIVE')at('self-buff',n==='RSI_A_RST_BLOODY_ACCEL'?1:1.1,()=>{
    const sk=sim.skill(a.skillId,a);for(const id of Object.values(sk.raw.BUFF_FACTOR??{}))sim.grantBuff(a,a,id,a.skillContext.level,a.skillContext.traitPolicy);
  });
  if(n==='RBM_COMBO_ZZZX')at('black-hole',.24,()=>{
    stopBlackHole(sim,a);s.blackHoleCount=1;s.blackHoleRemaining=sim.profileFor(a).states[a.state].clip.durationSeconds-.24+1;
    const first=sim.state.nextEffectId;sim.spawnSet(a,'EffectSet_RBM_BLACKHOLE');
    s.blackHoleEffectIds=sim.state.effects.filter(effect=>effect.id>=first).map(effect=>effect.id);
  });
  if(n==='RBM_COMBO_ZZZX_EXPLOSION')at('black-hole-stop',.4,()=>{s.blackHoleCount=0;s.blackHoleRemaining=0;stopBlackHole(sim,a);});
  if(n==='RBM_DASH_JUMP_COMBO_X')at('bm-air-x',.2,()=>{
    if(a.mp<5)return;
    a.mp-=5;
    const first=sim.state.nextEffectId;sim.spawnSet(a,'EffectSet_RST_DashJump_X');
    // The target set's .2 is relative to command entry, not another .2 delay
    // after this shared 5 MP callback. Preserve its original hand and offsets.
    for(const effect of sim.state.effects)if(effect.id>=first)effect.setStartAnimation=0;
  });
  if(n===H+'ATTACK')at('extreme-middle',.01,()=>{
    const first=sim.state.nextEffectId;
    sim.spawnSet(a,'EffectSet_SA_RBM_Extrem_Blade_Middle');
    // Raven23388..23411 creates the middle set at the current pose, then
    // raises only the future actor by350. The shared delayed-birth phase runs
    // after actor movement; retain the original anchors before that lift.
    for(const effect of sim.state.effects)if(effect.id>=first){
      const anchor=sim.effectAnchorSampler?.(effect,a,{profile:sim.profileFor(a)});
      if(anchor)effect.birthAnchor=structuredClone(anchor);
      else sim.note('bm-extreme-middle-birth-anchor','Original pre-lift attachment unavailable; no guessed effect position',a);
    }
    a.hidden=true;s.extremeHidden=true;a.y+=350;s.extremeLifted=true;a.grounded=false;a.lineId=null;
  });
}
/** User-confirmed Shockwave follow-ups retain the airborne big-hit path even
 * below V5's near-floor pickup threshold. Preserve target2016 damage, stage,
 * direction and back speeds; do not reinterpret every FORCE_FLY hit globally.
 */
export function bladeMasterReaction(sim,a,b,data,origin,reaction){
  if(!isBladeMaster(sim,a)||origin.kind!=='effect'||data.REACT_TYPE!==2||data.FORCE_FLY!==1
    ||!['RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK','RSI_DAMAGE_AIR_SMALL'].includes(reaction.state))return reaction;
  const effect=sim.state.effects.find(row=>row.id===origin.id);
  if(!shockwaves.has(effect?.name))return reaction;
  return {...reaction,state:b.lastAttackerFront?'RSI_DAMAGE_AIR_FLY_FRONT':'RSI_DAMAGE_AIR_FLY_BACK',vy:data.BACK_SPEED_Y,grounded:false};
}
export function bladeMasterFrame(sim,a,dt){
  if(!isBladeMaster(sim,a))return;
  const s=bladeMasterState(a);
  // Original6fb4 only subtracts while >=0, retaining a negative ready value.
  if(s.winCooldown>=0)s.winCooldown=f(s.winCooldown-f(dt));
  s.escapeCooldown=Math.max(0,s.escapeCooldown-dt);s.blackHoleRemaining=Math.max(0,s.blackHoleRemaining-dt);
  // Raven5490..5509 uses real elapsed time, independent of animation speed.
  if(s.blackHoleRemaining<=0||a.hp<=0)stopBlackHole(sim,a);
  if(current(sim,a)===H+'ATTACK')s.extremeElapsed+=dt;
}
export function bladeMasterFuture(sim,a){
  if(!isBladeMaster(sim,a))return;
  if(current(sim,a).startsWith('RSI_SI3_SOUL_TAKER_HYPERSONIC_STAB')){
    if(f(a.animationTime)>=f(.7)&&f(a.animationTime)<1)a.passiveSpeed.x=1000;
    else if(f(a.animationTime)>=1)a.passiveSpeed.x=0;
  }
}
export function bladeMasterSkillEvent(sim,a,input){
  if(!isBladeMaster(sim,a)||!a.skillId||!ownExecutors.has(sim.skill(a.skillId,a)?.executor))return false;
  const n=current(sim,a),s=bladeMasterState(a),done=ended(sim,a),go=state=>sim.enter(a,state,'bm-reference-skill-event');
  if(n===S+'LOOP'){
    if(!a.grounded){leave(sim,a);return true;}
    if(a.animationTime>=sim.profileFor(a).states[a.state].clip.durationSeconds){s.loops++;go(s.loops>=7?S+'FINISH':S+'LOOP');}return true;
  }
  if(n===W+'START'||n===W+'STARTLANDING'){
    if(Object.keys(a.hits??{}).length){go(W+'HIT');return true;}
    if(done&&a.grounded){
      if(n===W+'START')go(W+'STARTLANDING');
      // Target24017 text explicitly returns40 MP; older V5's half-cost rule
      // would incorrectly return50 and would vary with the Light trait.
      else {if(!s.missRefunded){a.mp=Math.min(a.mpMax,a.mp+40);s.missRefunded=true;sim.emit('bmWolfFangRefund',a.id,{amount:40});}go('RSI_DASH');}
    }else if(done)a.animationStopped=true;return true;
  }
  if(n===W+'HIT'){if(done){if(a.grounded)go(W+'HITLANDING');else a.animationStopped=true;}return true;}
  if(n===H+'READY'){if(done)go(H+'ATTACK');return true;}
  if(n===H+'ATTACK'){if(s.extremeElapsed>1)go(H+'ATTACK_FINISH');return true;}
  if(n==='SI_A_RBM_ONE_FLASH'&&a.animationTime>1&&['Z','X','UP','DOWN','LEFT','RIGHT','A','S','D','C','Q','W','E','R'].some(k=>input.held.has(k))){leave(sim,a);return true;}
  if(n==='RSI_A_RST_CUT_TENDON'&&a.animationTime>.66&&['UP','DOWN','LEFT','RIGHT'].some(k=>input.held.has(k))){leave(sim,a);return true;}
  if(done)leave(sim,a);return true;
}
/** Current simulation callback projection of the recovered owner5658 observer.
 * Its original a64 component is represented by accepted character feedback;
 * effect feedback must come from a successful child factory, never a key tap. */
export function bladeMasterAcceptedHit(sim,a,b,data,amount,origin,fromFront){
  if(amount>0&&data.ATTACK_TYPE!==1){
    for(const buff of a.buffs)for(const behavior of buff.behaviors){
      if(behavior.kind==='normalHpDrain'){const healed=Math.min(a.hpMax-a.hp,amount*behavior.value);a.hp+=healed;sim.emit('buffHpDrained',a.id,{templateId:buff.templateId,amount:healed,targetId:b.id});}
      if(behavior.kind==='normalHitBuff'&&b.hp>0)sim.grantBuff(a,b,behavior.factorId,buff.skillLevel,origin.traitPolicy);
    }
  }
  if(isBladeMaster(sim,a)&&amount>0){
    const s=bladeMasterState(a),p=a.passivePolicy?.bladeMaster;
    const feedback=origin.kind==='character'||origin.effectFeedbackDispatched===true;
    if(p?.winningFactor&&feedback){s.winHits++;
      if(s.winHits>=5&&s.winCooldown<0){
        sim.grantBuff(a,a,p.winningFactor,a.passivePolicy.skillLevels[24409]);
        s.winCooldown=f(p.winningCooldown);s.winHits=0;
      }
    }
  }
  if(isBladeMaster(sim,b)&&b.hp>0&&!fromFront&&['RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_BACK'].includes(b.state)){
    const p=b.passivePolicy?.bladeMaster,s=bladeMasterState(b);
    if(p?.escapeChance>0&&s.escapeCooldown<=0&&b.mp>=p.escapeMp&&sim.rng()<p.escapeChance){
      const skill=sim.skill(24217,b);
      b.skillId=24217;b.skillScale=skill.powerMultiplier;b.skillContext={key:null,level:skill.maxLevel,branchId:'none',castStep:sim.state.step,traitPolicy:null,hyperState:b.awakening.remaining>0};
      sim.enter(b,skill.state,'bm-evacuation-source-back-reaction');
      // The original182 request precedes payment/timer reset and does not
      // inspect its acceptance result. Keep that phase ordering in this host.
      b.mp=f(Math.max(0,b.mp-p.escapeMp));s.escapeCooldown=p.escapeCooldown;
      sim.emit('bmEvacuation',b.id,{mpCost:p.escapeMp,cooldown:p.escapeCooldown});
    }
  }
}
