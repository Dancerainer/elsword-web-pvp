/** Rune Slayer source adapters, independent of rendering and network. */
import {lkBufferedWindow} from './lk-commands.mjs';
const f=Math.fround;
const stormNames=new Set(['DamageEffect_SA_EMK_StromBlade','DamageEffect_SA_EMK_StromBladeCenter']);
const rs=(sim,a)=>sim.profileFor(a).target.unitClass===101;
const saved=a=>(a.sourceRuneSlayer??={groundRuneCreated:false,airRuneCreated:false,groundEffects:[],airEffects:[],enchantCooldown:0});
const name=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
const ended=(sim,a)=>{const d=sim.profileFor(a).states[a.state].clip.durationSeconds;return a.animationStopped||a.animationTime>d-Math.max(d/10,.03);};
/** Sword Fire's original EventProcess owns its grounded successor. The
 * generic air-state landing adapter must leave it in place until that call. */
export function runeSlayerOwnsLanding(sim,a){return rs(sim,a)&&name(sim,a)==='ESSI_SA_EMK_SWORD_FIRE';}
/** Target enhanced Explosive Fist keeps the same effect identity and supplies
 * its extra explosion frequency as DAMAGE_DATA_ULTIMATE. */
export function runeSlayerEffectDamage(profile,e,data){
  if(!data||profile.target.unitClass!==101)return data;
  if(!e.stage&&e.skillId===21220&&e.damage.DAMAGE_DATA_ULTIMATE)data=e.damage.DAMAGE_DATA_ULTIMATE;
  // User feedback overrides stay separate from the frozen original rows.
  // Phoenix launches without adding juggle count; Wind's opening hit staggers.
  if(e.name==='DamageEffect_SA_ERS_PhoenixTalon'&&data.REACT_TYPE===16)data={...data,FORCE_FLY:1};
  if(e.name==='DamageEffect_SA_EMK_WindBlade_Attack')data={...data,REACT_TYPE:2};
  // User-confirmed continuous launch, including the opening stagger rows.
  // Target next-stage gaps and back speeds remain the timing/value evidence.
  if(stormNames.has(e.name)&&!e.stage)data={...data,REACT_TYPE:16,RE_ATTACK:1,HIT_GAP:e.damage.DAMAGE_DATA_NEXT.HIT_GAP};
  // V62 replaces the old V56 zero-HP explosion rule. Both original17.84
  // rows reach the per-cast/target consumer in rs-luna-project-v62.mjs.
  return data;
}
/** User's continuous vortex policy. Only a recently hit body overlapping the
 * original effect helpers receives attraction and the true-foot landing gate.
 * No extra collision, damage, MP, hit counter or guessed radius is generated. */
export function runeSlayerVortex(sim,b,dt){
  if(!b.state.startsWith('RSI_DAMAGE_AIR_FLY_')||b.hp<=0)return null;
  for(const e of sim.state.effects){
    if(!stormNames.has(e.name)||!e.active||e.dead||e.hits?.[b.id]==null||e.elapsed>=(e.damage.ATTACK_TIME_END??Infinity))continue;
    const gap=e.damage.DAMAGE_DATA_NEXT.HIT_GAP;
    if(sim.state.time-e.hits[b.id]>gap+dt)continue;
    const a=sim.actor(e.ownerId),shapes=sim.effectSampler?.(e,a,{profile:sim.profileFor(a)})??[],defenders=sim.defenderSampler?.(b)??[];
    if(!shapes.some(s=>defenders.some(d=>sim.hitPoint(s,d))))continue;
    const center=(e.currentAnchor??e.birthAnchor)?.position;if(!center)continue;
    const outer=sim.profileFor(a).damageEffects.DamageEffect_SA_EMK_StromBlade.raw.DAMAGE_DATA_NEXT;
    const delta=center[0]-b.x,speed=Math.abs(outer.BACK_SPEED_X);
    return {vx:Math.sign(delta)*Math.min(speed,Math.abs(delta)/dt),footRadius:1};
  }
  return null;
}
/** CEffect FrameMove expires repeat-hit entries BEFORE SetDamageDataNext.
 * Phoenix changes from repeating launch to one-shot stagger at1.35; retaining
 * already-expired entries forever made its returning phase unable to hit. */
export function runeSlayerEffectHitMemory(profile,e,time){
  if(profile.target.unitClass!==101||e.name!=='DamageEffect_SA_ERS_PhoenixTalon'||e.stage||!e.damage.DAMAGE_DATA.RE_ATTACK)return;
  for(const [id,last] of Object.entries(e.hits??{}))if(time-last>=(e.hitGaps?.[id]??e.damage.DAMAGE_DATA.HIT_GAP??0)-1e-9){
    delete e.hits[id];if(e.hitGaps)delete e.hitGaps[id];
  }
}
function spend(sim,a,amount){if(a.mp<amount){sim.emit('rsMagicFail',a.id,{amount,mp:a.mp});return false;}
  a.mp=f(a.mp-amount);sim.emit('rsCommandMp',a.id,{amount});return true;}
function stop(sim,a,key){for(const id of saved(a)[key]){const e=sim.state.effects.find(e=>e.id===id);if(e){e.dead=true;e.endReason='rs-rune-replaced';}}saved(a)[key]=[];}
/** Size affects the actual native helper and display through one definition. */
export function runeSlayerInstanceDefinition(profile,e,definition){
  if(profile.target?.unitClass!==101)return definition;
  let d=definition;
  if(e.name==='ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ'||e.name==='ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ')
    d={...d,BONE_NAME:'Bip01',POSITION_OFFSET_X:160,POSITION_OFFSET_Y:-90,ROTATE_Z:e.name.endsWith('_XZZ')?-30:0};
  if(e.name==='ELSWORD_RUNE_SLAYER_DASH_ZZX'||e.name==='FIREBALL_SMALL_DOWN_ELSWORD')
    d={...d,BONE_NAME:'Dummy2_Lhand',ROTATE_Z:e.name==='FIREBALL_SMALL_DOWN_ELSWORD'?-30:0};
  if(['DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST','Flare_Elsword_SI_A_Big_Burst04','Flare_Elsword_SI_A_Big_Burst05','Smoke_Elsword_SI_A_Big_Burst06'].includes(e.name))
    d={...d,BONE_NAME:'Dummy2_Lhand'};
  if(e.sourceRuneLevel!==undefined){
    const level=e.sourceRuneLevel,skill=profile.skillCatalog.find(s=>s.skillId===21408);
    if(!Number.isInteger(level)||level<0||level>skill.maxLevel)return null;
    const scale=level?f(skill.raw.SA_PROJECTILE_SIZE?.[String(level)]):1;
    if(!Number.isFinite(scale))return null;
    d={...d,SCALE_X:(d.SCALE_X??1)*scale,SCALE_Y:(d.SCALE_Y??1)*scale,SCALE_Z:(d.SCALE_Z??1)*scale};
  }
  return d;
}
function enhance(a,e,{damage=true,range=true}={}){
  const p=a.passivePolicy?.runeSlayer,scale=p?.runeSizeMultiplier??1;
  e.sourceRuneLevel=a.passivePolicy?.skillLevels?.[21408]??0;
  e.definition={...e.definition,SCALE_X:(e.definition.SCALE_X??1)*scale,SCALE_Y:(e.definition.SCALE_Y??1)*scale,SCALE_Z:(e.definition.SCALE_Z??1)*scale};
  if(damage)e.powerMultiplier=f(e.powerMultiplier*(p?.runeDamageMultiplier??1));
  if(range&&Number.isFinite(e.lifeTimeSeconds))e.lifeTimeSeconds=f(e.lifeTimeSeconds*(p?.runeRangeMultiplier??1));
}
function runeSet(sim,a,set,key,{damage=true,range=true,animationTiming=false}={}){
  const first=sim.state.nextEffectId;
  sim.spawnSet(a,set,animationTiming?undefined:sim.profileFor(a).enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM,[]);
  const effects=sim.state.effects.filter(e=>e.id>=first);for(const e of effects)enhance(a,e,{damage,range});
  if(key)saved(a)[key]=effects.map(e=>e.id);return effects;
}
function airRune(sim,a,follow){
  const n=follow?'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ':'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ';
  const first=sim.state.nextEffectId;
  // Pinned SwordMan14700/14857 use Bip01+(facing160,-90); independent from
  // the left-hand magic-fail particle. Original geometry sampler owns scale.
  const e=sim.createEffect(a,{NAME:n,BONE_NAME:'Bip01',POSITION_OFFSET_X:160,POSITION_OFFSET_Y:-90,ROTATE_Z:follow?-30:0});
  enhance(a,e);saved(a).airEffects=[e.id];
  if(!follow)runeSet(sim,a,'EffectSet_ELSWORD_DASH_JUMP_XZ',null,{damage:false});
  sim.emit('rsRuneCreated',a.id,{name:n,effectIds:sim.state.effects.filter(e=>e.id>=first).map(e=>e.id)});
}
export function runeSlayerStateStart(sim,a){
  if(!rs(sim,a))return;const s=saved(a),n=name(sim,a);
  if(n==='ESSI_ERS_XZ'||n==='ESSI_ERS_DASH_COMBO_XZ'){s.groundRuneCreated=false;stop(sim,a,'groundEffects');}
  // Original214 Start32949430 writes actor+7026=1 after the common start.
  // The actual66X branch enters214 directly, bypassing the older XZ mesh.
  // Keep its release eligibility even when that older mesh was never born.
  if(n==='ESSI_ERS_XZ_CHARGE')s.groundRuneCreated=true;
  if(n==='ESSI_ERS_DASH_JUMP_XZ'){s.airRuneCreated=false;a.vy=0;a.skillDisableGravity=true;}
  if(n==='ESSI_SA_EMK_SWORD_FIRE'){a.vx=a.vy=0;a.passiveSpeed={x:-1,y:-1};a.skillDisableGravity=true;}
  // SwordMan15027 directly creates this set: EffectSet2218/2660 retain the
  // default animation timer. Its .36 birth follows the cast animation, while
  // the authored .8s main-mesh lifetime independently owns explosion timing.
  // SwordMan15029 scales the set lifetime, not that spawned attack mesh.
  if(n==='ESSI_SA_ERS_SPLASH_EXPLOSION')runeSet(sim,a,'EffectSet_ELSWORD_SPLASH_EXPLOSION',null,{damage:false,range:false,animationTiming:true});
  if(n==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3'){a.vx=sim.profileFor(a).physics.RUN_SPEED*a.stats.moveSpeedMultiplier*a.facing;}
}
export function runeSlayerStateEnd(sim,a,next){
  if(!rs(sim,a))return;const n=name(sim,a);
  if(n==='ESSI_ERS_DASH_JUMP_XZ'||n==='ESSI_SA_EMK_SWORD_FIRE')a.skillDisableGravity=false;
  if(n==='ESSI_SA_EMK_SWORD_FIRE')delete a.skillDownAccel;
  if(n==='ESSI_SA_EMK_SWORD_FIRE_LANDING'&&next==='RSI_WAIT')sim.grantBuff(a,a,44,a.skillContext?.level??1);
}
export function runeSlayerFrame(sim,a,input,dt){
  if(!rs(sim,a))return;saved(a).enchantCooldown=Math.max(0,saved(a).enchantCooldown-dt);
  if(name(sim,a)==='ESSI_SA_EMK_SWORD_FIRE'&&f(a.animationTime)>f(1.3)){
    a.skillDisableGravity=false;a.skillDownAccel=sim.profileFor(a).physics.G_ACCEL*2;
  }
  if(name(sim,a)==='ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a'&&a.animationTime<.39){a.vx=0;a.vy=0;}
}
export function runeSlayerEvents(sim,a,before,after){
  if(!rs(sim,a))return;const n=name(sim,a),s=saved(a),fire=(key,time,fn)=>sim.fire(a,'rs:'+key,time,before,after,fn);
  if(n==='ESSI_ERS_XZ'||n==='ESSI_ERS_DASH_COMBO_XZ')fire('ground-rune',.3,()=>{
    s.groundRuneCreated=spend(sim,a,4);if(s.groundRuneCreated)runeSet(sim,a,'EffectSet_ERS_COMBO_XZ','groundEffects');
  });
  if(n==='ESSI_ERS_XZZ'||n==='ESSI_ERS_FULL_CHARGE_XZZ'){
    fire('ground-release',.01,()=>{if(s.groundRuneCreated){
      runeSet(sim,a,n==='ESSI_ERS_FULL_CHARGE_XZZ'?'EffectSet_ERS_COMBO_FULL_CHARGE_XZZ':'EffectSet_ERS_COMBO_XZZ',null);
      // Original215 Frame329633c0 consumes7026 after its .01 producer.
      if(n==='ESSI_ERS_FULL_CHARGE_XZZ')s.groundRuneCreated=false;
    }});
    fire('ground-stop',.38,()=>stop(sim,a,'groundEffects'));
  }
  if(n==='ESSI_ERS_DASH_JUMP_XZ')fire('air-rune',.26,()=>{s.airRuneCreated=spend(sim,a,4);if(s.airRuneCreated)airRune(sim,a,false);});
  if(n==='ESSI_ERS_DASH_JUMP_XZZ')fire('air-release',.01,()=>{
    // The pinned WOS consumer charges3.5 in vigor and0 normally. This is a
    // qualified version reference, not a recovered target2016 MP field.
    if(spend(sim,a,a.wayOfSword?.state===2?3.5:0)&&s.airRuneCreated){stop(sim,a,'airEffects');airRune(sim,a,true);}
  });
  if(n==='ESSI_SI_A_ERS_CRITICAL_SWORD')fire('critical-buff',.333,()=>sim.grantBuff(a,a,236,a.skillContext.level,a.skillContext.traitPolicy));
  if(n==='ESSI_SA_EMK_PHOENIX_TALON')fire('phoenix-buff',1.75,()=>sim.grantBuff(a,a,46,a.skillContext.level,a.skillContext.traitPolicy));
  if(n==='ESSI_SI_A_ERS_RUNE_OF_FIRE')fire('fire-rune',.6,()=>runeSet(sim,a,'EffectSet_RunSlayer_RUNE_GUARD_FIRE',null,{damage:false}));
  if(n==='ESSI_SA_EMK_BIG_BURST')fire('big-burst',.65,()=>{
    // Fixed SwordMan14314: these four independent instances share the
    // actual left-hand bone; the old memo12 branch is not a target2016 trait.
    for(const name of ['DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST','Flare_Elsword_SI_A_Big_Burst04','Flare_Elsword_SI_A_Big_Burst05','Smoke_Elsword_SI_A_Big_Burst06'])
      sim.createEffect(a,{NAME:name,BONE_NAME:'Dummy2_Lhand'});
  });
  if(n==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a'||n==='ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a')
    fire('fireball',n==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a'?.515:.35,()=>{
      if(!spend(sim,a,6))return;
      const ground=n==='ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a',e=sim.createEffect(a,{NAME:ground?'ELSWORD_RUNE_SLAYER_DASH_ZZX':'FIREBALL_SMALL_DOWN_ELSWORD',BONE_NAME:'Dummy2_Lhand',ROTATE_Z:ground?0:-30});
      if(ground)enhance(a,e);else e.powerMultiplier=f(e.powerMultiplier*(a.passivePolicy?.runeSlayer?.runeDamageMultiplier??1));
    });
}
export function runeSlayerSkillEvent(sim,a,input){
  if(!rs(sim,a))return false;const n=name(sim,a),raw=sim.profileFor(a).states[a.state].raw;
  if(n==='ESSI_SA_ERS_SPLASH_EXPLOSION'){
    // Target SKIP_TIME1.4 + fixed GenericActiveSkillEventProcess26371.
    // Animation end precedes the strict held-key boundary; airborne exits
    // enter JUMP_DOWN, without inventing a direct dash/skill successor.
    if(ended(sim,a)||raw.SKIP_TIME>=0&&f(a.animationTime)>f(raw.SKIP_TIME)&&
      ['UP','DOWN','LEFT','RIGHT','Z','X','A','S','D','C','Q','W','E','R'].some(k=>input.held.has(k))){
      a.skillId=null;a.skillContext=null;sim.enter(a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','rs-splash-source-recovery');
    }
    return true;
  }
  if(n==='ESSI_SA_EMK_SWORD_FIRE'){
    // The original callback waits for the floor. XAP_ONE_WAIT holds its last
    // pose while Future physics descends; its controller must not advance past
    // the end and restart-looking samples on an airborne cast.
    if(ended(sim,a)&&!a.grounded)a.animationStopped=true;
    if(ended(sim,a)&&a.grounded)sim.enter(a,'ESSI_SA_EMK_SWORD_FIRE_LANDING','rs-sword-fire-land');
    return true;
  }
  if(n==='ESSI_SI1_ES_WIND_BLADE'){
    const out=lkBufferedWindow(a.sourceCommandFlags??0,0,a.animationTime,input.pressed.has(a.skillContext?.key),raw.EVENT_PROCESS_TIME0);
    a.sourceCommandFlags=out.flags;
    if(out.changed){const sk=sim.skill(21035,a),cost=sk.mpCost*sk.raw.SA_MP_CONSUME_REL[String(a.skillContext.level)];
      if(spend(sim,a,cost)){sim.enter(a,'ESSI_SI1_ES_WIND_BLADE_ULTIMATE','rs-target-enhanced-wind');return true;}}
  }
  if(n==='ESSI_ERS_COUNTER_GUARD_READY'){
    if(ended(sim,a))sim.enter(a,'ESSI_ERS_COUNTER_GUARD','rs-counter-ready');return true;
  }
  if(n==='ESSI_ERS_COUNTER_GUARD'){
    if(!input.held.has(a.skillContext?.key)||Math.fround(a.stateTime)>Math.fround(raw.REFLEX_MAGIC['2']))sim.enter(a,'ESSI_ERS_COUNTER_GUARD_END','rs-counter-release');
    return true;
  }
  return false;
}
export function runeSlayerAcceptedHit(sim,a,b,data,origin){
  if(!rs(sim,a))return;
  const effect=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null;
  if(effect?.skillId===21220&&effect.name==='DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST'&&data.EXTRA_DAMAGE?.EXTRA_DAMAGE_TYPE===16){
    // Target EDT_MANA_DAMAGE=16, fixed GUUser10524: fixed loss, after hit gain.
    const before=b.mp;b.mp=Math.max(0,f(b.mp-data.EXTRA_DAMAGE.DAMAGE));
    sim.emit('rsExtraManaDamage',a.id,{targetId:b.id,effectId:effect.id,amount:before-b.mp,declaredAmount:data.EXTRA_DAMAGE.DAMAGE});
  }
  // Only Luna's target2016 explosion DD declares factor117. V62's explicit
  // project consumer owns its per-cast application for either stage; this
  // callback must never inject an additional burn.
  const p=a.passivePolicy?.runeSlayer;if(!p)return;
  const skill=sim.skill(origin.skillId??a.skillId,a),ordinary=data.ATTACK_TYPE!==1&&![7,13,14,15,16].includes(skill?.type);
  // The target factor itself holds RATE=.05; never roll the same chance twice.
  // Target21406 explicitly excludes special/hyper; fixed DamageManager3442
  // also gates temporary weapon factors to its normal-attack channel.
  if(ordinary&&p.magicChainChance>0)sim.grantBuff(a,b,p.magicChainFactorId,a.passivePolicy.skillLevels[21406]);
  if(ordinary)for(const buff of [...a.buffs])for(const behavior of buff.behaviors)if(behavior.kind==='onHitBuffFactor')
    sim.grantBuff(a,b,behavior.factorId,a.passivePolicy.skillLevels[behavior.skillId]??buff.skillLevel,null);
  if(saved(a).enchantCooldown===0&&p.swordEnchantChance>0&&sim.rng()<p.swordEnchantChance){
    const factor=p.swordEnchantFactorIds[Math.min(2,Math.floor(sim.rng()*3))];
    sim.grantBuff(a,a,factor,a.passivePolicy.skillLevels[21407]);saved(a).enchantCooldown=p.swordEnchantCooldown;
    sim.emit('rsSwordEnchant',a.id,{factor});
  }
}
/** Fixed X2GameUnit12206 returns dummy/no-damage after summing absorption
 * values. Eligibility is the original CAN_REFLEX bit, not damage color. */
export function runeSlayerAbsorbProjectile(sim,a,b,data,origin){
  if(origin.kind!=='effect'||data.CAN_REFLEX!==1&&data.CAN_REFLEX!==true)return false;
  const rows=b.buffs.flatMap(buff=>buff.behaviors).filter(row=>row.kind==='absorbMagicProjectile'&&!row.identityCleared);
  if(!rows.length)return false;
  const value=rows.reduce((sum,row)=>f(sum+row.mp),0),before=b.mp;b.mp=Math.min(b.mpMax,f(b.mp+value));
  sim.emit('projectileAbsorbed',b.id,{attackerId:a.id,effectId:origin.id,mp:b.mp-before});return true;
}
