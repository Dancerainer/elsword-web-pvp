/** Elesis skill hosts. Magnitudes and damage are target2016 declarations.
 * X2GUEL callback timing is a qualified fixed-V5/2026 reference, never client gold.
 * The actor owns every counter and effect identity for deterministic replay. */
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {createSkillTraitPolicy} from './skill-traits.mjs';
import {finalizeElesisFireAbsorb,rememberElesisAvatarEffects,scanElesisAvatarFire} from './elesis-fire-absorb-v45.mjs';
import {elesisBrandishTickCost} from './elesis-brandish-cost-v45.mjs';
import {requestBloodCutterCarrier} from './elesis-blood-cutter.mjs';
import {requestElesisFirewall,firewallInstanceDefinition,restoreFirewallEffect} from './elesis-firewall-v45.mjs';
import {castElesisShadowEdge,elesisShadowEdgeHit,elesisShadowLinkDefinition} from './elesis-shadow-edge.mjs';
import {CA_SHADE_SCRATCH_FOLLOWUP,CA_EJECTION_ATTACK_END} from './ca-cancel-data-v35.mjs';
import {advanceElesisDashAccumulator,caDashWaveLifetime} from './profession-source-v53.mjs';
export {tickElesisShadowLinks,validateElesisShadowLink} from './elesis-shadow-edge.mjs';
const f=Math.fround;
export const isElesis=(sim,a)=>[120,121,125].includes(sim.profileFor(a).target.unitClass);
const saved=a=>(a.sourceElesisSkills??={charge:0,loopTime:0,loops:0,hit:false,dodges:0,rushes:0,mpPaid:0,stigmaCooldown:0,chivalryTime:0,dashAccumulator:0});
const raw=(sim,a)=>sim.profileFor(a).states[a.state].raw;
const skill=(sim,a)=>sim.skill(a.skillId,a);
const value=(sim,a,id,key,neutral)=>{
  const row=sim.skill(id,a),level=a.passivePolicy?.skillLevels?.[id]??row?.maxLevel;
  const v=row?.raw?.[key]?.[level];
  if(Number.isFinite(v))return v;
  if(neutral!==undefined)return neutral;
  throw new TypeError('Missing target Elesis '+id+'.'+key);
};
const ended=(sim,a)=>{const d=sim.profileFor(a).states[a.state].clip.durationSeconds;return f(a.animationTime)>f(d-Math.max(d/10,.03));};
const enter=(sim,a,state,reason='elesis-source-skill-chain')=>sim.enter(a,state,reason);
const leave=(sim,a)=>enter(sim,a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','elesis-source-skill-end');
const held=(a,keys)=>keys.held.has(a.skillContext?.slotKey??a.skillContext?.key??['A','S','D','C','Q','W','E','R'][a.loadout.findIndex(x=>x?.skillId===a.skillId)]);
const pressed=(a,keys)=>keys.pressed.has(a.skillContext?.slotKey??a.skillContext?.key??['A','S','D','C','Q','W','E','R'][a.loadout.findIndex(x=>x?.skillId===a.skillId)]);
const position=(a,x=0,y=0)=>({position:[a.x+a.facing*x,a.y+y,a.z],rotation:[0,a.facing<0?180:0,0],facing:a.facing});
const born=(sim,a,name,x=0,y=0,extra={})=>sim.createEffect(a,{NAME:name},{birthAnchor:position(a,x,y),...extra});
const stop=(sim,a,ids)=>{
  for(const id of ids??[]){
    if(!Number.isInteger(id)||id<=0)continue;
    const e=sim.state.effects.find(e=>e.id===id);
    // A visual member can retire from combat as soon as it has no pending
    // damage. Its renderer still owns the source particle lifetime; the
    // original StopEffectSet handle must therefore survive that retirement.
    if(e){e.dead=true;e.endEmitted=true;e.endReason='elesis-source-owner-end';}
    sim.emit('effectEnded',a.id,{effectId:id,...(e?{name:e.name,setName:e.setName}:{}),reason:'elesis-source-owner-end'});
  }
  if(ids)ids.length=0;
};
function group(sim,a,name,key,conditions=[]){const first=sim.state.nextEffectId;sim.spawnSet(a,name,undefined,conditions);const ids=sim.state.effects.filter(e=>e.id>=first).map(e=>e.id);if(key)saved(a)[key]=ids;return ids;}
function heal(sim,a,amount,reason){const old=a.hp;a.hp=Math.min(a.hpMax,f(a.hp+Math.max(0,amount)));if(a.hp>old)sim.emit('elesisHpRecovered',a.id,{amount:a.hp-old,reason});}
function spendHp(sim,a,amount,reason){const cost=Math.min(Math.max(0,amount),Math.max(0,a.hp-1));a.hp=f(a.hp-cost);sim.emit('elesisHpSpent',a.id,{amount:cost,reason,evidence:'target2016 description adapter; nonlethal host safety floor'});return cost;}
const CHAIN=Object.freeze({
  ESI_SI_A_EL_LEAP_CRASH:'ESI_SI_A_EL_LEAP_CRASH_JUMP',
  ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_READY:'ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_CHARGE',
  ESI_SI_SA_SSK_EXTINCTION_START:'ESI_SI_SA_SSK_EXTINCTION_CHARGE',
  ESI_A_SGM_DRASTIC_CHARGE_START:'ESI_A_SGM_DRASTIC_CHARGE_LOOP',
  ESI_SA_SGM_JUGGERNAUT_BUSTER_START:'ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP',
  ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP_LAST:'ESI_SA_SGM_JUGGERNAUT_BUSTER_END',
  ESI_SI_SA_SBH_BLAZING_DANCE_START:'ESI_SI_SA_SBH_BLAZING_DANCE_1ST',
  SI_SA_SDK_BURNING_PHANTOM_READY:'SI_SA_SDK_BURNING_PHANTOM_START',
  SI_SA_SDK_BURNING_PHANTOM_START:'SI_SA_SDK_BURNING_PHANTOM_LOOP',
  SI_SA_SCA_DREAD_WEAPON_START:'SI_SA_SCA_DREAD_WEAPON_LOOP',
});
export function elesisCastState(sim,a,row){
  if(!isElesis(sim,a))return row.state;
  if(row.skillId===28034)return a.grounded?'ESI_SI_SA_SPK_SWORDFIRE_GROUND':'ESI_SI_SA_SPK_SWORDFIRE_FLY';
  if(row.skillId===28218)return 'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE_MEMO';
  return row.state;
}
export function elesisCast(sim,a,row,{mpCost=0}={}){
  if(!isElesis(sim,a))return false;
  const s=saved(a);Object.assign(s,{charge:0,loopTime:0,loops:0,hit:false,dodges:0,rushes:0,mpPaid:mpCost,danceTargets:[],bloodDrain:0,dodgeRefunded:false,judgmentCharge:0,leapFromDash:a.state==='RSI_DASH'});
  const p=a.skillContext?.traitPolicy;
  if(p?.mpRefundChance>0&&sim.rng()<p.mpRefundChance){const amount=f(mpCost*p.mpRefundFraction);a.mp=Math.min(a.mpMax,a.mp+amount);sim.emit('traitMpRefund',a.id,{skillId:row.skillId,amount,branchId:p.branchId});}
  if(p?.cooldownResetChance>0&&sim.rng()<p.cooldownResetChance)a.cooldowns[row.skillId]*=p.cooldownResetMultiplier;
  // These six target descriptions explicitly say 20% own HP. Injection and
  // Assault Strike instead refer to skill damage; their unknown basis is not guessed.
  if(a.professionId==='CA'&&[28038,28023,28024,28025,28221].includes(row.skillId)&&a.hp>a.hpMax*.2){
    spendHp(sim,a,a.hpMax*.2*(a.passivePolicy?.skillLevels?.[28414]&&a.hp/a.hpMax<.5?.66:1),'target-description-blood-hit');a.skillScale=f(a.skillScale*1.4);
  }
  if(row.skillId===28213)spendHp(sim,a,a.stats.physicalAttack*value(sim,a,28213,'SA_ATK_PHYSIC_REL'),'injection-stigma-cast');
  return false;
}
export function elesisStart(sim,a){
  if(!isElesis(sim,a))return;const s=saved(a),n=a.state;
  if(a.professionId==='CA'&&a.passivePolicy?.skillLevels?.[28413]&&!a.sourceElesisBurst?.chivalry&&/^ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE(?:_MEMO)?$/.test(n)){
    const endurance=a.sourceElesisEndurance?.skillId??28218,level=a.sourceElesisEndurance?.level??sim.skill(endurance,a)?.maxLevel;
    if(level>0)sim.grantBuff(a,a,sim.presetFor(a).gameMode==='NPC'?479:480,level,null);
  }
  if(a.passivePolicy?.skillLevels?.[28402]&&/^ESI_SI_A_EL_(?:DODGE_AND_SLASH(?:_BACK)?|RUSHING_SWORD(?:_2nd|_3rd)?)$/.test(n))sim.grantBuff(a,a,656,a.passivePolicy.skillLevels[28402]);
  if(n==='ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_FIRE')a.skillScale=f(a.skillScale*(1+Math.min(s.charge,1)));
  if(n==='ESI_SI_SA_SSK_JUDGEMENT_DRIVE_FINAL')a.skillScale=f(a.skillScale*(1+.25*s.judgmentCharge));
  if(n==='ESI_SI_SA_SSK_EXTINCTION_START')s.angle=-30;
  if(n==='ESI_SI_A_EL_LEAP_CRASH_JUMP'){
    // Original2016 registered local-enter32800e70 ->327ee790 supplies
    // type1 x2200/y1000 (x2700 after positive dash accumulator). This is an
    // active launch, not permanent WALK/RUN control or full JUMP_SPEED1500.
    a.vx=f(((s.dashAccumulator??0)>0?2700:2200)*a.facing);a.vy=1000;
    a.grounded=false;a.lineId=null;
    sim.emit('elesisLeapLaunched',a.id,{vx:a.vx,vy:a.vy,
      evidence:'original2016 327ee790 launch;327f93d0 four-state dash accumulator7194'});
  }
  if(n==='ESI_SI_SA_SBH_BLAZING_DANCE_1ST'||/ESI_SI_SA_SBH_BLAZING_DANCE_ATTACK_/.test(n)){
    const targets=sim.state.actors.filter(b=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<700&&Math.abs(b.z-a.z)<=value(sim,a,28016,'SA_SCOPE_ABS_Z'));
    const b=targets.find(b=>!s.danceTargets.includes(b.id))??targets[0];
    s.danceTargetId=b?.id??null;if(b){if(!s.danceTargets.includes(b.id))s.danceTargets.push(b.id);a.x=b.x;a.y=b.y;a.z=b.z;a.lineId=b.lineId;a.grounded=b.grounded;}s.loops++;
  }
  if(n==='SI_SA_SCA_DREAD_WEAPON_LOOP')s.loops++;
  if(n==='SI_SA_SDK_BRANDISH_BREAKER_LOOP'){s.loopTime=0;s.loops=0;}
  if(n==='ESI_DASH_COMBO_SCA_XZ_CHARGE')s.charge=0;
  if(n==='SI_SA_SCA_DREAD_WEAPON_END')stop(sim,a,s.dreadEffects);
  if(n==='ESI_SA_SGM_JUGGERNAUT_BUSTER_END')stop(sim,a,s.juggernautEffects);
}
export function elesisEnd(sim,a,next){
  if(!isElesis(sim,a))return;const s=saved(a);
  if(a.state==='ESI_DASH_COMBO_SCA_ZX_START'&&raw(sim,a).FLIP_DIR_END===1)a.facing*=-1;
  if(!next.includes('DRASTIC_CHARGE'))stop(sim,a,s.drasticEffects);
  if(!next.includes('DREAD_WEAPON'))stop(sim,a,s.dreadEffects);
  // Extinction's original local handle is a detached projectile, not the
  // charge-arrow member. Its own source lifetime survives cast recovery.
  if(!next.includes('SCALET_ROSE'))stop(sim,a,[s.roseId]);
  if(!next.includes('JUGGERNAUT_BUSTER'))stop(sim,a,s.juggernautEffects);
}
export function elesisFrame(sim,a,keys,dt){
  if(!isElesis(sim,a))return;const s=saved(a),n=a.state;
  advanceElesisDashAccumulator(a,dt);
  rememberElesisAvatarEffects(sim,a);
  // Registered327c8150 caps the charge accumulator at3; its event callback
  // releases at3.1 seconds or the key-up gate independently of animation end.
  if(n==='ESI_DASH_COMBO_SCA_XZ_CHARGE')s.charge=f(Math.min(3,f(s.charge+f(dt))));
  s.stigmaCooldown=Math.max(0,s.stigmaCooldown-dt);s.chivalryTime+=dt;
  if(a.professionId==='BH')for(const e of sim.state.effects)if(e.ownerId===a.id&&e.skillId===28018)restoreElesisEffectControls(sim.profileFor(a),a,e);
  s.blossomCooldown=Math.max(0,(s.blossomCooldown??0)-dt);
  s.overflowCleanseCooldown=Math.max(0,(s.overflowCleanseCooldown??0)-dt);
  s.overflowRefresh=(s.overflowRefresh??0)+dt;
  if(a.passivePolicy?.skillLevels?.[28414]){
    if(a.hp>0&&a.hp/a.hpMax<.5&&s.overflowRefresh>=.25){s.overflowRefresh=0;sim.grantBuff(a,a,666,a.passivePolicy.skillLevels[28414],null);}
    if(s.overflowCleanseCooldown<=0){
      const bad=a.buffs.find(b=>sim.profileFor(a).buffTemplates[b.templateId]?.raw.IS_DEBUF&&!sim.profileFor(a).buffTemplates[b.templateId]?.raw.IS_WORLD_BUFF);
      if(bad){a.buffs=a.buffs.filter(b=>b!==bad);synchronizeBuffStats(a);sim.advanceActorBuffs(a,0);s.overflowCleanseCooldown=value(sim,a,28414,'SA_COOLTIME_1');sim.emit('elesisDebuffRemoved',a.id,{templateId:bad.templateId,skillId:28414});}
    }
  }
  if(a.passivePolicy?.skillLevels?.[28400]&&s.chivalryTime>=1){
    s.chivalryTime=0;const level=a.passivePolicy.skillLevels[28400];
    if(sim.state.actors.some(b=>b.id!==a.id&&b.team===a.team&&b.hp>0&&b.hp/b.hpMax<=.5))sim.grantBuff(a,a,221,level,null);
    if(a.hp>0&&a.hp/a.hpMax<=.5)sim.grantBuff(a,a,222,level,null);
  }
  if(n==='ESI_SI_SA_SSK_JUDGEMENT_DRIVE'&&a.animationStopped)s.judgmentCharge=Math.min(2,s.judgmentCharge+dt);
  if(n==='ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_CHARGE'){
    const prior=s.charge,increment=Math.min(dt,Math.max(0,1-s.charge),a.mp/50);s.charge=f(s.charge+increment);a.mp=f(a.mp-increment*50);s.loopTime+=dt;
    if(prior<1&&s.charge>=1)sim.spawnSet(a,'EffectSet_SA_EL_SONIC_ASSAULT_CHARGE');
  }
  if(n==='ESI_SI_SA_SSK_EXTINCTION_CHARGE'||n==='ESI_SI_SA_SSK_EXTINCTION_DEGREE'){
    s.charge+=dt;s.angle=Math.max(-45,Math.min(0,s.angle+(keys.held.has('UP')?100:keys.held.has('DOWN')?-100:0)*dt));
  }
  if(n==='ESI_A_SGM_DRASTIC_CHARGE_LOOP')a.mp=Math.max(0,f(a.mp-10*dt));
  if(/DRASTIC_CHARGE_LOOP|JUGGERNAUT_BUSTER_LOOP|BURNING_PHANTOM_LOOP|BRANDISH_BREAKER_LOOP/.test(n))s.loopTime+=dt;
  if(n.includes('JUGGERNAUT_BUSTER')&&!n.endsWith('_END'))a.vx=(keys.held.has('RIGHT')?1:keys.held.has('LEFT')?-1:0)*sim.profileFor(a).physics.RUN_SPEED*a.stats.moveSpeedMultiplier*(n.endsWith('_START')?.5:.7);
  if(s.stigmaEffects?.length&&!a.buffs.some(b=>b.templateId===433))stop(sim,a,s.stigmaEffects);
  if(n==='SI_SA_SDK_BRANDISH_BREAKER_LOOP'){
    const count=Math.trunc(f(s.loopTime)/.15000000596046448)&65535;
    // Original received callback returns immediately when old counter>6.
    // A long frame attempts one dummy, never a catch-up while loop.
    if(s.loops<=6&&count>s.loops){
      s.loops=count;
      const payment=elesisBrandishTickCost(sim,a);
      if(!payment.supported)sim.note('elesis-brandish-payment',payment.reason,a);
      else{
        if(payment.cost>0){const before=a.hp;a.hp=f(Math.max(0,Math.min(a.hpMax,f(a.hp-payment.cost))));
          sim.emit('elesisHpSpent',a.id,{amount:before-a.hp,reason:'brandish-original-loop-self-damage',evidence:payment.evidence});}
        sim.emit('elesisBrandishExtended',a.id,{tick:s.loops,hpCost:payment.cost,exempt:payment.exempt,evidence:payment.evidence});
      }
    }
  }
  if(a.hp<=0){stop(sim,a,s.dreadEffects);stop(sim,a,s.drasticEffects);stop(sim,a,s.stigmaEffects);}
}
// Explicit callback roots. The raw state EffectSet lists run in the shared host.
export const ELESIS_CALLBACK_EVENTS=Object.freeze({
  ESI_SI_SA_SSK_JUDGEMENT_DRIVE_FINAL:[[.01,'set','EffectSet_SA_SSK_JUDGEMENT_DAMAGE']],
  ESI_SI_SA_SSK_VICTORIOUS_SWORD:[[.01,'set','EffectSet_SA_SGM_VICTORIOUS_SWORD_NEW']],
  ESI_A_SGM_DRASTIC_CHARGE_START:[[.01,'set','EffectSet_A_SGM_DRASTIC_CHARGE_GroundFire'],[.01,'set','EffectSet_A_SGM_DRASTIC_CHARGE_LOOP']],
  SI_A_SDK_DARK_WAVE:[[.3,'effect','DamageEffect_A_SDK_DARK_WAVE_DUMMY'],[.3,'set','EffectSet_A_SDK_DARK_WAVE_HIT_Pushing'],[.8,'set','EffectSet_A_SDK_DARK_WAVE_HIT_Impact']],
  SI_A_SDK_INJECTION_STIGMA:[[.2,'effect','DamageEffect_SI_A_SDK_INJECTION_STIGMA_DUMMY'],[.2,'set','EffectSet_SI_A_SDK_INJECTION_STIGMA']],
  SI_SA_SCA_SHADE_THE_ILLUSION:[[.4,'effect','DamageEffect_SI_SA_SCA_SHADE_THE_ILLUSION_DUMMY'],[.4,'set','EffectSet_SI_SA_SCA_SHADE_THE_ILLUSION_Attack']],
  // Target attack set is separate from its FX set; .19 is the target impact
  // sound timing. This binding is a static host adapter, not a native trace.
  SI_A_SCA_ASSAULT_STRIKE:[[.19,'set','EffectSet_SI_A_SCA_ASSAULT_STRIKE_Attack']],
  SI_SA_SDK_EJECTION_BUSTER_CHARGE:[[.01,'set','EffectSet_SI_SA_SDK_EJECTION_BUSTER_Charge_1']],
  SI_SA_SDK_EJECTION_BUSTER_ATTACK:[[.01,'set','EffectSet_SI_SA_SDK_EJECTION_BUSTER_Attack_1000']],
  SI_SA_SCA_DREAD_WEAPON_START:[[.3,'effect','DamageEffect_SI_SA_SCA_DREAD_WEAPON_Loop_DUMMY'],[.3,'set','EffectSet_SI_SA_SCA_DREAD_WEAPON_Loop']],
});
export function elesisEvents(sim,a,before,after){
  if(a.professionId==='BH'&&a.state==='ESI_SI_A_SPK_AVATAR_OF_THE_FIRE')
    sim.fire(a,'elesis-avatar-original-scan',.01,before,after,()=>scanElesisAvatarFire(sim,a));
  if(!isElesis(sim,a))return;const s=saved(a),n=a.state;
  const fire=(key,time,fn)=>sim.fire(a,'elesis:'+key,time,before,after,fn);
  if(n==='SI_SA_SCA_BLOOD_CUTTER')fire('blood-cutter-npc',.01,()=>requestBloodCutterCarrier(sim,a));
  if(n==='SI_A_SCA_SHADOW_EDGE')fire('shadow-edge-original-query',.31,()=>castElesisShadowEdge(sim,a));
  for(const [i,[time,kind,name]]of (ELESIS_CALLBACK_EVENTS[n]??[]).entries())fire('callback:'+i,time,()=>{
    const first=sim.state.nextEffectId;if(kind==='set')sim.spawnSet(a,name);else born(sim,a,name);
    const ids=sim.state.effects.filter(e=>e.id>=first).map(e=>e.id);
    if(n.includes('DRASTIC'))s.drasticEffects=[...(s.drasticEffects??[]),...ids];
    if(n.includes('DREAD_WEAPON'))s.dreadEffects=[...(s.dreadEffects??[]),...ids];

  });
  if(n==='SI_A_SDK_INJECTION_STIGMA')fire('injection-persistent-shield',.2,()=>{
    // Original327fc627 removes433 then appliesBF470 (11sec). Its damage
    // EffectSet belongs to that buff and uses elapsed time across actions.
    stop(sim,a,s.stigmaEffects);a.buffs=a.buffs.filter(b=>b.templateId!==433);
    const buff=sim.grantBuff(a,a,470,a.skillContext.level);
    if(buff){const first=sim.state.nextEffectId;sim.spawnSet(a,'EffectSet_SI_A_SDK_INJECTION_STIGMA_BUFF',sim.profileFor(a).enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
      const effects=sim.state.effects.filter(e=>e.id>=first);for(const e of effects)e.buffTemplateId=433;
      s.stigmaEffects=effects.map(e=>e.id);}
  });
  if(n==='ESI_SI_SA_SSK_VICTORIOUS_SWORD')fire('victory-buff',.533,()=>sim.grantBuff(a,a,345,a.skillContext.level));
  // Original2016 skill28027 registration assigns FrameMove32800ad0 ->
  //327e8aa0. That body gates both damage sets with float32 .55, then selects
  // the MEMO pair for sword state-2. Primary visual-set .93 is a separate cue,
  // not the callback's creation clock (elesis-native-consumers-v37 contract).
  if(n==='ESI_SI_SA_EL_WILD_SHOCK')fire('wild-shock-damage',.55,()=>{
    const suffix=a.wayOfSword?.state===-2?'_MEMO':'';
    sim.spawnSet(a,'EffectSet_SA_EL_WILD_SHOCK_DAMAGE'+suffix);
    sim.spawnSet(a,'EffectSet_SA_EL_WILD_SHOCK_DAMAGE_Sub'+suffix);
  });
  if(n==='ESI_SA_SGM_JUGGERNAUT_BUSTER_START')fire('juggernaut-damage',1.3,()=>
    group(sim,a,'EffectSet_SGM_JuggernautBuster_BLACKHOLE'+(a.buffs.some(b=>b.templateId===326)?'_WithVictoriousSword':''),'juggernautEffects'));
  if(n==='ESI_SA_SGM_JUGGERNAUT_BUSTER_END')fire('juggernaut-finish',.3,()=>
    sim.spawnSet(a,'EffectSet_SGM_JuggernautBuster_Finish'+(a.buffs.some(b=>b.templateId===326)?'_WithVictoriousSword':'')));
  if(n==='ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_FIRE'){
    const scale=1+.5*Math.min(s.charge,1);
    fire('sonic-initial-speed',.01,()=>{a.vx*=scale;});
    fire('sonic-charged-speed',.11,()=>{a.vx=raw(sim,a).SPEED_TIME0['1']*a.facing*scale;a.vy=0;});
  }
  if(n==='ESI_SI_SA_SSK_EXTINCTION_ATTACK')fire('extinction',.001,()=>{
    const ids=group(sim,a,'EffectSet_SA_SSK_EXTINCTION_DAMAGE','extinctionEffects');
    for(const e of sim.state.effects.filter(e=>ids.includes(e.id))){e.sourceElesisExtinctionAngle=s.angle;e.definition=elesisInstanceDefinition(sim.profileFor(a),e,e.definition);restoreElesisEffectControls(sim.profileFor(a),a,e);}
  });
  if(n==='ESI_SI_A_SBH_SCALET_ROSE'){
    fire('rose',.25,()=>{s.roseId=born(sim,a,'DamageEffect_Elesis_A_SBH_SCALET_ROSE_Start',30,90).id;});
    fire('rose-stop',.465,()=>stop(sim,a,[s.roseId]));
  }
  if(n==='ESI_SI_HA_SBH_ANCIENT_FIRE')fire('ancient-fire-opening',.887,()=>{
    const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a);
    if(anchor)sim.createEffect(a,{NAME:'DAMAGE_EFFECT_SA_SBH_ANCIENT_FIRE_Attack01_'+(sim.presetFor(a).gameMode==='NPC'?'Dungeon':'Pvp')},{birthAnchor:anchor});
    else sim.note('ancient-fire-opening-anchor','Original Bip01 required',a);
  });
  if(n==='ESI_SI_SA_SBH_WALL_OF_PROMINENCE')fire('wall',.01,()=>requestElesisFirewall(sim,a));
  if(n==='SI_SA_SDK_BRUTAL_CUTTER')fire('brutal-buff',.01,()=>{
    const id=skill(sim,a).raw.BUFF_FACTOR?.['1'];
    if(Number.isInteger(id))sim.grantBuff(a,a,id,a.skillContext.level);
    else{
      // Preserve the missing enum in the source profile. The known predecessor
      // and the explicit +50% duration upgrade independently determine this
      // candidate, rather than assuming the unresolved enum means factor466.
      const prior=sim.skill(skill(sim,a).replacesSkillId,a),base=prior?.raw.BUFF_FACTOR?.['1'];
      if(!Number.isInteger(base)){sim.note('elesis-brutal-upgrade-factor','Target upgraded factor and predecessor mapping unresolved',a);return;}
      const factor=structuredClone(sim.profileFor(a).buffFactors[base].raw);
      for(const k of Object.keys(factor.FINALIZER.BFT_TIME.NORMAL_TIME))factor.FINALIZER.BFT_TIME.NORMAL_TIME[k]*=value(sim,a,28038,'SA_EFFECTIVE_TIME');
      sim.grantBuff(a,a,factor,a.skillContext.level);
      sim.note('elesis-brutal-upgrade-factor','Target missing enum retained; explicit predecessor plus 1.5-duration description adapter, not native enum recovery',a);
    }
  });
  if(n==='SI_SA_SCA_SHADE_THE_ILLUSION')fire('shade-buff',.4,()=>sim.grantBuff(a,a,467,a.skillContext.level));
  // Target 28021 describes five base ticks, then five optional ticks at 10 MP.
  // Its original loop carrier owns HIT_GAP=.15; spawning the reconstructed
  // source's missing LOOP_DUMMY would duplicate or fabricate damage.
  if(n==='SI_SA_SDK_BURNING_PHANTOM_LOOP')for(let i=5;i<10;i++)fire('phantom-mp'+i,i*.15,()=>{if(a.mp>=10){a.mp-=10;s.loops=i+1;}});
}
export function elesisSkillEvent(sim,a,keys){
  if(!isElesis(sim,a)||!a.skillId)return false;const s=saved(a),n=a.state,r=raw(sim,a),end=ended(sim,a);
  if(n==='ESI_SI_SA_SSK_JUDGEMENT_DRIVE'&&a.animationTime>=1.8){
    if(held(a,keys)&&s.judgmentCharge<2){a.animationStopped=true;a.vx=0;}else enter(sim,a,'ESI_SI_SA_SSK_JUDGEMENT_DRIVE_FINAL');return true;
  }
  if(n==='ESI_SA_SGM_CRITICAL_DIVE'&&a.animationTime>.425&&s.hit){enter(sim,a,'ESI_SA_SGM_CRITICAL_DIVE_HIT');return true;}
  if(n==='ESI_SI_A_SBH_FLAME_SWORD'&&a.animationTime>.235&&s.hit){enter(sim,a,'ESI_SI_A_SBH_FLAME_SWORD_FINISH');return true;}
  if(n==='ESI_SI_A_SBH_SCALET_ROSE'&&a.animationTime>.33&&a.animationTime<.465&&s.hit){enter(sim,a,'ESI_SI_A_SBH_SCALET_ROSE_SUCCESS');return true;}
  if(n==='ESI_SI_A_EL_LEAP_CRASH_JUMP'){
    if(a.grounded)enter(sim,a,'ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING');else if(end)a.animationStopped=true;return true;
  }
  if(n==='ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_CHARGE'){
    if(!held(a,keys)||s.loopTime>=2||a.mp<=0)enter(sim,a,'ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_FIRE');return true;
  }
  if(n==='ESI_SI_SA_SSK_EXTINCTION_CHARGE'||n==='ESI_SI_SA_SSK_EXTINCTION_DEGREE'){
    if(!held(a,keys)||s.charge>=1)enter(sim,a,'ESI_SI_SA_SSK_EXTINCTION_ATTACK');return true;
  }
  if(n==='SI_SA_SDK_EJECTION_BUSTER_CHARGE'){if(end||!held(a,keys))enter(sim,a,'SI_SA_SDK_EJECTION_BUSTER_ATTACK');return true;}
  if(n==='ESI_A_SGM_DRASTIC_CHARGE_LOOP'){
    if(s.loopTime>=2||a.mp<=0||s.loopTime>=.5&&!held(a,keys))enter(sim,a,'ESI_A_SGM_DRASTIC_CHARGE_END');else if(end)enter(sim,a,n);return true;
  }
  if(n==='ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP'){
    if(s.loopTime>1)enter(sim,a,'ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP_LAST');else if(end)enter(sim,a,n);return true;
  }
  if(n==='SI_SA_SDK_BRANDISH_BREAKER_START'&&end){
    enter(sim,a,held(a,keys)?'SI_SA_SDK_BRANDISH_BREAKER_LOOP':'SI_SA_SDK_BRANDISH_BREAKER_FINISH');return true;
  }
  if(n==='SI_SA_SDK_BRANDISH_BREAKER_LOOP'){
    if(s.loops>=6||!held(a,keys))enter(sim,a,'SI_SA_SDK_BRANDISH_BREAKER_FINISH');return true;
  }
  if(n==='SI_SA_SDK_BURNING_PHANTOM_LOOP'){if(s.loopTime>=1.5||s.loopTime>=.75&&(!held(a,keys)||a.mp<10))enter(sim,a,'SI_SA_SDK_BURNING_PHANTOM_END');return true;}
  if(n==='SI_SA_SCA_DREAD_WEAPON_LOOP'){if(end)enter(sim,a,s.loops>=4?'SI_SA_SCA_DREAD_WEAPON_END':n);return true;}
  if(/ESI_SI_SA_SBH_BLAZING_DANCE_(?:1ST|ATTACK_)/.test(n)){
    if(!s.danceTargetId||end){
      const endless=elesisEndlessDance(a),freeLoops=endless?7:6;
      // The target replacement says eight flame dashes, then20MP per
      // additional dash. Reserve the original FINISH dash as the eighth.
      const availableTarget=sim.state.actors.some(b=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<700&&Math.abs(b.z-a.z)<=value(sim,a,28016,'SA_SCOPE_ABS_Z'));
      const canContinue=endless&&availableTarget&&(s.loops<freeLoops||a.mp>=20);
      if(!s.danceTargetId||s.loops>=freeLoops&&!canContinue){if(!s.danceTargetId)a.mp=Math.min(a.mpMax,a.mp+Math.max(0,freeLoops-s.loops)*20);enter(sim,a,'ESI_SI_SA_SBH_BLAZING_DANCE_FINISH');}
      else{if(endless&&s.loops>=freeLoops){a.mp=f(a.mp-20);sim.emit('elesisDanceExtended',a.id,{mpCost:20,completedDashes:s.loops});}
        enter(sim,a,s.loops%2?'ESI_SI_SA_SBH_BLAZING_DANCE_ATTACK_BACK':'ESI_SI_SA_SBH_BLAZING_DANCE_ATTACK_FRONT');}
    }return true;
  }
  if(end){
    if(n===CA_EJECTION_ATTACK_END.state){if(!a.grounded)a.y-=sim.profileFor(a).referenceSemantics.lineRadius*CA_EJECTION_ATTACK_END.fallScale;enter(sim,a,a.grounded?CA_EJECTION_ATTACK_END.ground:CA_EJECTION_ATTACK_END.air);return true;}
    if(n==='ESI_SA_SGM_CRITICAL_DIVE'&&!s.hit)a.mp=Math.min(a.mpMax,a.mp+s.mpPaid/2);
    if(CHAIN[n])enter(sim,a,CHAIN[n]);else leave(sim,a);return true;
  }
  if(/^ESI_SI_A_EL_DODGE_AND_SLASH(?:_BACK)?$/.test(n)){
    const max=value(sim,a,28217,'SA_EFFECTIVE_COUNT')+(a.passivePolicy?.skillLevels?.[28403]?value(sim,a,28403,'SA_EFFECTIVE_COUNT'):0);
    if(pressed(a,keys)&&s.dodges<max){s.dodges++;const back=keys.held.has(a.facing>0?'LEFT':'RIGHT');enter(sim,a,back?'ESI_SI_A_EL_DODGE_AND_SLASH_BACK':'ESI_SI_A_EL_DODGE_AND_SLASH');}
    else if(keys.pressed.has('Z')||keys.pressed.has('X'))enter(sim,a,'ESI_SI_A_EL_DODGE_AND_SLASH_ATTACK_Z');return true;
  }
  if(/^ESI_SI_A_EL_RUSHING_SWORD(?:_2nd|_3rd)?$/.test(n)&&pressed(a,keys)&&f(a.animationTime)>f(r.SKILL_CANCEL_AFTER)){
    const max=4+(a.passivePolicy?.skillLevels?.[28403]?value(sim,a,28403,'SA_EFFECTIVE_COUNT'):0),cost=s.mpPaid;
    if(s.rushes<max-1&&a.mp>=cost){a.mp-=cost;s.rushes++;if(keys.held.has('RIGHT'))a.facing=1;else if(keys.held.has('LEFT'))a.facing=-1;enter(sim,a,s.rushes===max-1?'ESI_SI_A_EL_RUSHING_SWORD_3rd':'ESI_SI_A_EL_RUSHING_SWORD_2nd');}return true;
  }
  if(n==='ESI_A_SGM_PROVOKE'&&pressed(a,keys)&&a.mp>=10){a.mp-=10;enter(sim,a,'ESI_A_SGM_PROVOKE_REVENGE');return true;}
  if(n===CA_SHADE_SCRATCH_FOLLOWUP.state&&(keys.pressed.has('X')||keys.held.has('X'))){const w=r[CA_SHADE_SCRATCH_FOLLOWUP.windowField];if(w&&f(a.animationTime)>=f(w['1'])&&f(a.animationTime)<f(w['2'])){enter(sim,a,CA_SHADE_SCRATCH_FOLLOWUP.next);return true;}}
  // These macros are explicitly present in the fixed callbacks. Unknown
  // source fields stay closed; strict '>' and fresh attack edges are retained.
  const after=v=>Number.isFinite(v)&&v>=0&&f(a.animationTime)>f(v);
  if(after(r.WALK_CANCEL_AFTER)&&(keys.held.has('LEFT')||keys.held.has('RIGHT'))){leave(sim,a);return true;}
  if(after(r.BWALK_CANCEL_AFTER)&&keys.held.has(a.facing>0?'LEFT':'RIGHT')){leave(sim,a);return true;}
  if(!a.buffControls?.dashBlock&&after(r.DASH_CANCEL_AFTER)&&(keys.pureDoubleRight||keys.pureDoubleLeft||keys.pressed.has('DASH'))){a.facing=keys.pureDoubleRight?1:keys.pureDoubleLeft?-1:keys.held.has('RIGHT')?1:keys.held.has('LEFT')?-1:a.facing;enter(sim,a,a.grounded?'RSI_DASH':'RSI_DASH_JUMP','elesis-source-dash-cancel');return true;}
  const normal=after(r.ATTACK_CANCEL_AFTER),extended=after(r.ATTACK_CANCEL_AFTER_EX);
  if(!(a.canNotAttackTime>0)&&(normal&&(keys.held.has('Z')||keys.held.has('X'))||extended&&(keys.pressed.has('Z')||keys.pressed.has('X')))){
    const chosen=normal?keys.held:keys.pressed,key=chosen.has('Z')?'Z':'X';a.skillId=null;a.skillScale=1;enter(sim,a,a.grounded?'RSI_COMBO_'+key:'RSI_JUMP_COMBO_'+key,'elesis-source-attack-cancel');return true;
  }
  return true;
}

/** Shared slot dispatch must wait for the source skill callback's earlier
 * end/own-follow-up branches. This query only reads the current owner state;
 * the callback alone commits costs, loops, effects and state changes. */
export function elesisSkillExternalSkillAllowed(sim,a,keys){
 if(!isElesis(sim,a)||!a.skillId)return null;
 const n=a.state,r=raw(sim,a),s=a.sourceElesisSkills??{};
 if(ended(sim,a))return false;
 if(n==='ESI_SA_SGM_CRITICAL_DIVE'&&a.animationTime>.425&&s.hit)return false;
 if(n==='ESI_SI_A_SBH_FLAME_SWORD'&&a.animationTime>.235&&s.hit)return false;
 if(n==='ESI_SI_A_SBH_SCALET_ROSE'&&a.animationTime>.33&&a.animationTime<.465&&s.hit)return false;
 if(/^ESI_SI_A_EL_DODGE_AND_SLASH(?:_BACK)?$/.test(n)&&
    (pressed(a,keys)||keys.pressed.has('Z')||keys.pressed.has('X')))return false;
 if(/^ESI_SI_A_EL_RUSHING_SWORD(?:_2nd|_3rd)?$/.test(n)&&pressed(a,keys)&&
    Number.isFinite(r.SKILL_CANCEL_AFTER)&&f(a.animationTime)>f(r.SKILL_CANCEL_AFTER))return false;
 if(n==='ESI_A_SGM_PROVOKE'&&pressed(a,keys)&&a.mp>=10)return false;
 if(n===CA_SHADE_SCRATCH_FOLLOWUP.state&&(keys.pressed.has('X')||keys.held.has('X'))){
  const w=r[CA_SHADE_SCRATCH_FOLLOWUP.windowField];
  if(w&&f(a.animationTime)>=f(w['1'])&&f(a.animationTime)<f(w['2']))return false;
 }
 return true;
}
export function elesisAttackTimers(sim,a,before,after){
  if(!isElesis(sim,a))return;const r=raw(sim,a);
  for(const [key,value]of Object.entries(r).filter(([k])=>/^(?:DAMAGEDATA|DAMAGE_DATA)_CHANGE_TIME\d*$/.test(k)))
    for(const [i,time]of (Number.isFinite(value)?[value]:Object.values(value??{}).filter(Number.isFinite)).entries())
      sim.fire(a,'elesis:'+key+':'+i,time,before,after,()=>{a.hits={};a.hitGaps={};});
}
export function elesisDamageData(sim,a,data){
  if(!isElesis(sim,a)||!data)return data;const r=raw(sim,a),s=saved(a);
  const change=Number.isFinite(r.DAMAGE_DATA_CHANGE_TIME)?r.DAMAGE_DATA_CHANGE_TIME:r.DAMAGE_DATA_CHANGE_TIME?.['1'];
  let result=Number.isFinite(change)&&a.animationTime>=change?r.DAMAGE_DATA_NEXT??data:data;
  if(Number.isFinite(r.DAMAGEDATA_CHANGE_TIME2)&&a.animationTime>=r.DAMAGEDATA_CHANGE_TIME2)result=r.DAMAGE_DATA_LAST??result;
  if(['ESI_COMBO_SBH_XZ','ESI_COMBO_SBH_XZZZ'].includes(sim.profileFor(a).states[a.state].sourceState)&&result.DAMAGE?.MAGIC)
    result={...result,DAMAGE:{...result.DAMAGE,MAGIC:result.DAMAGE.MAGIC*(a.passivePolicy?.elesis?.commandFireDamageMultiplier??1)}};
  if(a.passivePolicy?.skillLevels?.[28401]&&/^RSI_(?:COMBO_[ZX]|JUMP_COMBO_[ZX]|DASH_COMBO_[ZX]|DASH_JUMP_COMBO_[ZX])$/.test(a.state))
    result={...result,STOP_TIME_DEF:(result.STOP_TIME_DEF??0)+value(sim,a,28401,'SA_DAMAGE_TIME'),HIT_ADD_MP:(result.HIT_ADD_MP??0)*value(sim,a,28401,'SA_MP_REGENERATION_ABS'),DAMAGE:Object.fromEntries(Object.entries(result.DAMAGE??{}).map(([k,v])=>[k,typeof v==='number'?v*value(sim,a,28401,'SA_DAMAGE_REL'):v]))};
  return result;
}
export function elesisOnHit(sim,a,b,data,amount=0,origin={}){
  if(!isElesis(sim,a))return;const s=saved(a);
  elesisShadowEdgeHit(sim,a,b,data,origin);
  if(data.NO_DAMAGE||data.REACT_TYPE===7)return;s.hit=true;
  const levels=a.passivePolicy?.skillLevels??{};
  if(levels[28410]&&(origin.elesisSwordState??a.wayOfSword?.state)===2&&[1,2,3].includes(data.WAY_OF_SWORD_TYPE)&&amount>0)heal(sim,a,amount*value(sim,a,28410,'SA_HP_INTAKE_REL_DAMAGE'),'dark-force-target-gale');
  if(levels[28403]&&a.skillId===28217&&a.state==='ESI_SI_A_EL_DODGE_AND_SLASH_ATTACK_Z'&&!s.dodgeRefunded){s.dodgeRefunded=true;a.mp=Math.min(a.mpMax,a.mp+s.mpPaid);}
  const ordinary=[sim.profileFor(a).enums.ATTACK_TYPE.AT_NORMAL,sim.profileFor(a).enums.ATTACK_TYPE.AT_COMMAND].includes(data.ATTACK_TYPE);
  if(levels[28411]&&ordinary&&amount>0){
    sim.grantBuff(a,b,465,levels[28411],null);
    if(b.buffs.some(v=>v.templateId===99)&&sim.rng()<value(sim,a,28411,'SA_EFFECTIVE_RATE'))heal(sim,a,amount*.2,'judgment-target-description');
  }
  if(levels[28414]&&ordinary&&amount>0){
    sim.grantBuff(a,a,462,levels[28414],null);
    if(a.buffs.some(v=>v.templateId===426&&v.accumulationCount>=5)){
      a.buffs=a.buffs.filter(v=>v.templateId!==426);sim.grantBuff(a,a,659,levels[28414],null);
    }
  }
  if(levels[28408]&&ordinary&&s.stigmaCooldown<=0){
    sim.grantBuff(a,b,291,levels[28408],null);s.stigmaCooldown=.5;
    if(b.buffs.some(v=>v.templateId===290&&v.accumulationCount>=5)){sim.grantBuff(a,b,292,levels[28408],null);sim.grantBuff(a,b,307,levels[28408],null);const e=sim.createEffect(a,{NAME:'DamageEffect_SBH_Judgement_Fire'},{birthAnchor:position(b)});e.powerMultiplier=value(sim,a,28408,'SA_DAMAGE_REL');}
  }
  if(a.skillId===28214&&a.state==='SI_A_SCA_SHADE_SCRATCH_ATTACK')heal(sim,a,amount*value(sim,a,28214,'SA_HP_GAIN_REL_MAX_HP'),'shade-scratch');
  if(a.skillId===28021&&amount>0){const amount=Math.min(a.stats.physicalAttack*value(sim,a,28021,'SA_ATK_PHYSIC_REL'),Math.max(0,a.stats.physicalAttack*2.5-s.bloodDrain));s.bloodDrain+=amount;heal(sim,a,amount,'burning-phantom-target-description');}
}
/** The second original Avatar carrier applies Burn first. Consume only the
 * three declared fire identities after the shared hit's buff grants, so the
 * removed flame is not immediately installed again in the same callback. */
export function elesisHitFinalized(sim,a,b,data,origin={}){
 return finalizeElesisFireAbsorb(sim,a,b,data,origin);
}
export function elesisNoDownHit(sim,a,data,origin={}){
 return a.professionId==='CA'&&(origin.skillId??data.APPLIED_SKILL_ID)===28021&&origin.kind==='effect'&&
  sim.state.effects.find(e=>e.id===origin.id)?.name==='DamageEffect_SA_SDK_BURNING_PHANTOM_END';
}
export function elesisPrepareHit(sim,a,data,origin={}){
  if(!isElesis(sim,a)||data.NO_DAMAGE||data.REACT_TYPE===7)return data;
  // User feedback19 requests a standing finish. Raw target REACT_TYPE5 is
  // preserved; the requested no-down adaptation is limited to this last hit.
  if(elesisNoDownHit(sim,a,data,origin))
    data={...data,REACT_TYPE:2,FORCE_DOWN:0};
  const ordinary=[0,2].includes(data.ATTACK_TYPE),id=origin.skillId??data.APPLIED_SKILL_ID;
  if(a.passivePolicy?.skillLevels?.[28410]&&a.wayOfSword?.state===-2&&[4,5,6].includes(data.WAY_OF_SWORD_TYPE))
    data={...data,DAMAGE:Object.fromEntries(Object.entries(data.DAMAGE??{}).map(([k,v])=>[k,typeof v==='number'?f(v*value(sim,a,28410,'SA_DAMAGE_REL')):v]))};
  const double=a.buffs.flatMap(b=>b.behaviors).find(b=>b.kind==='elesisDoubleAttack');
  const multiplier=a.buffs.some(b=>b.templateId===430)&&[28020,28038,28025].includes(id)?2:
    ordinary&&double&&sim.rng()<double.chance?2:1;
  if(multiplier===1)return data;
  sim.emit('elesisDoubleAttack',a.id,{skillId:id??null,source:ordinary?'brutal-cutter':'shade-illusion'});
  return {...data,DAMAGE:Object.fromEntries(Object.entries(data.DAMAGE??{}).map(([k,v])=>[k,typeof v==='number'?v*multiplier:v]))};
}
export function elesisAutoGuard(sim,b,data,fromFront){
  if(!isElesis(sim,b)||!b.passivePolicy?.skillLevels?.[28404]||!fromFront||!b.grounded||b.superArmor||
    ![0,2].includes(data.ATTACK_TYPE)||data.NO_DAMAGE||[0,7,10].includes(data.REACT_TYPE)||data.HIT_TYPE===26)return false;
  return sim.rng()<value(sim,b,28404,'SA_EFFECTIVE_RATE');
}
export function elesisReceived(sim,a,b,data,amount){
  if(!isElesis(sim,b)||b.hp<=0||!b.passivePolicy?.skillLevels?.[28412]||!(amount>0))return;
  const level=b.passivePolicy.skillLevels[28412];
  if(sim.rng()<value(sim,b,28412,'SA_EFFECTIVE_RATE')){
    heal(sim,b,amount*value(sim,b,28412,'SA_DAMAGE_ABSORB_REL_MAX_HP'),'blood-revenge-target-description');
    sim.grantBuff(b,b,464,level,null);
  }
}
export function elesisDebuffApplied(sim,source,target,buff){
  if(source.professionId==='BH'&&buff.templateId===296&&buff.factorId===297){
    if(sim.networkOwnerId===null||sim.networkOwnerId===undefined||sim.networkOwnerId===target.id){
      for(const id of Object.keys(target.cooldowns))target.cooldowns[id]=Math.max(0,target.cooldowns[id]-2);
      sim.emit('elesisBlossomCooldownReduced',target.id,{seconds:2});
    }
  }
  if(!isElesis(sim,target)||!target.passivePolicy?.skillLevels?.[28406])return;
  const template=sim.profileFor(source).buffTemplates[buff.templateId]?.raw;
  if(!template?.IS_DEBUF||template.IS_WORLD_BUFF||saved(target).blossomCooldown>0)return;
  // 2016 says absorption does not remove the original debuff. The older V5
  // routine does remove it, so that incompatible operation is not imported.
  saved(target).blossomCooldown=value(sim,target,28406,'SA_EFFECTIVE_TIME');
  sim.grantBuff(target,target,295,target.passivePolicy.skillLevels[28406],null);
  sim.note('elesis-flame-blossom-npc','Target five-second seed identity supported; spawned collectible NPC and party pickup consumer unavailable',target);
}


/** Narrow per-instance source rotation; reconstructed identically from wire. */
export function elesisInstanceDefinition(profile,effect,definition){
  definition=firewallInstanceDefinition(profile,effect,definition);
  definition=elesisShadowLinkDefinition(profile,effect,definition);
  // BH XZ applies SetLocalRotateDegree(0,0,-55) to the whole source set.
  // Pending owner effects have no birthAnchor yet; reconstruct that callback
  // from the frozen member rather than letting a receiving peer launch at
  // the raw member's +10-degree angle. Recomposition remains idempotent.
  if(profile.target?.unitClass===121&&['EffectSet_A_EL_DashJump_Combo_XZ','EffectSet_A_SBH_DashJump_Combo_XZ'].includes(effect.setName)){
    const raw=profile.effectSets[effect.setName]?.raw;
    const member=raw?.[effect.definitionMember]??Object.values(raw??{}).find(row=>row?.NAME===effect.name);
    if(!member)throw new TypeError('Missing original BH XZ set member');
    definition={...definition,ROTATE_Z:f((member.ROTATE_Z??0)-55)};
  }
  if(effect.sourceElesisCommandCharge!==undefined){
    const charge=effect.sourceElesisCommandCharge;
    if(profile.target?.unitClass!==125||effect.name!=='DamageEffect_SCA_Dash_Combo_XZ'||
      !Number.isFinite(charge)||charge<0||charge>3)throw new TypeError('Invalid original CA command charge');
    const size=f(1+charge*.13300000131130219);definition={...definition,SCALE_X:size,SCALE_Y:size,SCALE_Z:size};
  }
  if(effect.sourceElesisExtinctionAngle===undefined)return definition;
  const angle=effect.sourceElesisExtinctionAngle;
  if(profile.target?.unitClass!==120||effect.skillId!==28033||effect.name!=='EXTINCTION_ATTACK_DUMMY'||
    effect.setName!=='EffectSet_SA_SSK_EXTINCTION_DAMAGE'||!Number.isFinite(angle)||angle< -45||angle>0)
    throw new TypeError('Invalid target Elesis Extinction rotation');
  return {...definition,ROTATE_Z:angle};
}

/** Derived static controls must be recomposed, never repeatedly multiplied. */
export function restoreElesisEffectControls(profile,actor,effect){
  restoreFirewallEffect(profile,effect);
  if(effect.sourceElesisCommandCharge!==undefined){
    elesisInstanceDefinition(profile,effect,effect.definition);
    const duration=caDashWaveLifetime(effect.sourceElesisCommandCharge);
    effect.lifeTimeSeconds=duration;effect.templateFields={...effect.templateFields,LifeTime:duration};
  }
  if(effect.sourceElesisBloodCutter!==undefined)effect.sourceSkillMeshControl=true;
  if(effect.sourceElesisShadowLink!==undefined){effect.definition=elesisShadowLinkDefinition(profile,effect,effect.definition);effect.sourceSkillMeshControl=true;}
  if(![120,121].includes(profile.target?.unitClass))return effect;
  const row=profile.skillCatalog?.find(s=>s.skillId===effect.skillId);
  if(profile.target?.unitClass===120&&effect.skillId===28033&&effect.name==='EXTINCTION_ATTACK_DUMMY'&&effect.setName==='EffectSet_SA_SSK_EXTINCTION_DAMAGE'){
    if(!row)throw new TypeError('Missing original Extinction skill');
    const slot=actor.loadout?.find(x=>x?.skillId===28033),branchId=slot?.branchId??effect.traitPolicy?.branchId??'none';
    const level=actor.skillId===28033?actor.skillContext?.level??row.maxLevel:row.maxLevel;
    const scale=row.raw.SA_PROJECTILE_SIZE[level];if(!(scale>0))throw new TypeError('Missing original Extinction projectile size');
    effect.traitPolicy=createSkillTraitPolicy(row,branchId);effect.traitPolicy.rangeMultiplier*=scale;
  }
  if(profile.target?.unitClass===121&&effect.skillId===28018&&/^DamageEffect_Wall_of_Prominence_Attack_(?:Main|Sub)$/.test(effect.name)){
    if(!row)throw new TypeError('Missing original Fire Wall skill');
    const level=actor.skillId===28018?actor.skillContext?.level??row.maxLevel:row.maxLevel;
    const duration=row.raw.SA_EFFECTIVE_TIME[level];if(!(duration>0))throw new TypeError('Missing original Fire Wall duration');
    effect.lifeTimeSeconds=duration;effect.templateFields={...effect.templateFields,LifeTime:duration};
  }
  return effect;
}

const elesisEndlessDance=a=>a.professionId==='BH'&&a.skillId===28016&&a.skillContext?.traitPolicy?.memoTypeName==='MI_TRANSCENDENCE_1'&&a.skillContext.traitPolicy.rawParameters?.[0]===28032;
export function elesisTransformationEffectList(actor,raw){
  if(actor.professionId!=='BH')return {};
  return (elesisEndlessDance(actor)?raw.EFFECT_SET_LIST_EX_TRANS_1:raw.EFFECT_SET_LIST_EX_NO_TRANS)??{};
}

/** Prewarm only executable callbacks plus selected skills' source links.
 * Raw state/effect dependencies are walked by the shared asset planner. */
export function elesisEffectRoots(profile,loadout=[]){
  const unit=profile.target?.unitClass;if(![120,121,125].includes(unit))return [];
  const ids=new Set(loadout.filter(Boolean).map(s=>typeof s==='number'?s:s.skillId)),roots=new Set();
  const add=(...names)=>{for(const n of names)if(profile.effectSets?.[n]||profile.damageEffects?.[n]||profile.effectTemplates?.[n])roots.add(n);};
  for(const row of profile.skillCatalog??[])if(ids.has(row.skillId))for(const state of row.states??[])
    for(const [, ,name]of ELESIS_CALLBACK_EVENTS[state]??[])add(name);
  const callbacks={
    28027:['EffectSet_SA_EL_WILD_SHOCK_DAMAGE','EffectSet_SA_EL_WILD_SHOCK_DAMAGE_Sub','EffectSet_SA_EL_WILD_SHOCK_DAMAGE_MEMO','EffectSet_SA_EL_WILD_SHOCK_DAMAGE_Sub_MEMO'],
    28029:['EffectSet_SA_EL_SONIC_ASSAULT_CHARGE'],28033:['EffectSet_SA_SSK_EXTINCTION_DAMAGE'],
    28010:['EffectSet_SGM_JuggernautBuster_BLACKHOLE','EffectSet_SGM_JuggernautBuster_BLACKHOLE_WithVictoriousSword','EffectSet_SGM_JuggernautBuster_Finish','EffectSet_SGM_JuggernautBuster_Finish_WithVictoriousSword'],
    28211:['DamageEffect_Elesis_A_SBH_SCALET_ROSE_Start'],28018:['EffectSet_Wall_of_Prominence_Attack'],
    28604:['DAMAGE_EFFECT_SA_SBH_ANCIENT_FIRE_Attack01_Pvp','DAMAGE_EFFECT_SA_SBH_ANCIENT_FIRE_Attack01_Dungeon'],
    28215:['DAMAGE_EFFECT_SCA_SHADOW_EDGE_Link','DamageEffect_SCA_SHADOW_EDGE_Projectile_EXPLOSION'],28213:['EffectSet_SI_A_SDK_INJECTION_STIGMA_BUFF'],
    28023:['EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile'],
  };
  for(const id of ids)add(...(callbacks[id]??[]));
  // Counter and Chivalry can trigger outside an equipped active skill.
  add('EffectSet_EL_ENDURANCE_POWER','EffectSet_ELSWORD_ENDURANCE');
  if(unit===125)add('EffectSet_EL_ENDURANCE_POWER_PUNISH','EffectSet_P_SDK_DARK_FORCE_J_End','EffectSet_P_SDK_DARK_FORCE_S_End');
  else add('EffectSet_VigorEnd','EffectSet_DestructionEnd');
  if(unit===120)add('EffectSet_SGM_XXX_Start');
  if(unit===121)add('DamageEffect_SBH_Judgement_Fire','EffectSet_A_EL_Dash_Combo_ZX','EffectSet_A_EL_Dash_Combo_ZX_FAIL',
    'EffectSet_A_EL_Dash_Combo_ZZZ','EffectSet_A_EL_Dash_Combo_ZZZ_FAIL','EffectSet_A_EL_DashJump_Combo_XZ','EffectSet_A_EL_DashJump_Combo_XZ_FAIL',
    'EffectSet_A_SBH_DashJump_Combo_XZ','EffectSet_Elesis_SBH_Dash_Combo_X','EffectSet_Elesis_SBH_Dash_Combo_XX','EffectSet_Elesis_SBH_Dash_Combo_XXX',
    'EffectSet_Elesis_SBH_Combo_XZZ_FAIL','EffectSet_Elesis_SBH_Combo_XXXZ','EffectSet_SBH_Combo_XZZ_Fire_NEW','EffectSet_SBH_Combo_XZZZ_Fire_NEW','EffectSet_Elesis_SBH_Combo_XZZ');
  if(unit===125)add('EffectSet_SDK_Dash_Jump_Combo_ZX');
  return [...roots].sort();
}
