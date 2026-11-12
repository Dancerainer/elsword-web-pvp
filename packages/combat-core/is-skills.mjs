/** IS target2016 data with pinned SwordMan callback timing/ownership.
 * Reference consumers are version-qualified in is-reference-consumers-v1.json. */
const f=Math.fround;
export const isInfinitySword=(sim,a)=>sim.profileFor(a).target.unitClass===112;
const saved=a=>(a.sourceInfinitySword??={comboLoops:0,cruelHits:0,cruelCooldown:0,suddenCooldown:0,brutalCooldown:0,lightningTime:0});
const value=(sim,a,id,key)=>{const skill=sim.skill(id,a),n=skill?.raw[key]?.[String(a.passivePolicy?.skillLevels?.[id]??skill.maxLevel)];
  if(!Number.isFinite(n))throw new TypeError('Missing target IS '+id+'.'+key);return n;};
const position=(a,x=0,y=0)=>({position:[a.x+a.facing*x,a.y+y,a.z],rotation:[0,a.facing<0?180:0,0],facing:a.facing});
const born=(sim,a,name,x=0,y=0,extra={})=>sim.createEffect(a,{NAME:name},{birthAnchor:position(a,x,y),...extra});
const stop=(sim,a,ids)=>{for(const id of ids??[]){const e=sim.state.effects.find(e=>e.id===id);if(e){e.dead=true;e.endReason='is-source-owner-end';}}};
function timedSet(sim,a,name,duration){
  const first=sim.state.nextEffectId;sim.spawnSet(a,name,sim.profileFor(a).enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
  const rows=sim.state.effects.filter(e=>e.id>=first);for(const e of rows)e.lifeTimeSeconds=duration;return rows.map(e=>e.id);
}
export function infinitySwordStart(sim,a){
  if(!isInfinitySword(sim,a))return;const s=saved(a),source=sim.profileFor(a).states[a.state].sourceState;
  if(source==='ESSI_ETK_COMBO_XX')s.comboLoops=0;
  if(source==='ESSI_ETK_COMBO_XXX_LOOP'){
    s.comboLoops++;
    // SwordMan16073–16077: the loop explicitly enables the red armor tint.
    a.skillSuperArmorNotRed=false;
  }
  if(a.state==='ESSI_SI_SA_ETK_MAELSTORM_RAGE'){a.skillDisableGravity=true;a.vx=0;a.vy=0;a.passiveSpeed={x:-1,y:-1};}
  if(a.state==='ESSI_A_ETK_SWORD_SHIELD'){stop(sim,a,s.shieldEffectIds);s.shieldEffectIds=[];}
}
export function infinitySwordEnd(sim,a,next){
  if(!isInfinitySword(sim,a))return;const s=saved(a);
  if(a.state==='ESSI_ETK_COMBO_XXX_LOOP')a.superArmorNotRed=true;
  if(a.state==='ESSI_SI_SA_ETK_MAELSTORM_RAGE')a.skillDisableGravity=false;
  if(a.state==='ESSI_SI_SA_ETK_HARSH_CHASER'){stop(sim,a,[s.harshEffectId]);delete s.harshEffectId;}
  if(a.state==='ESSI_SI_SA_ETK_SWORD_FALL'){stop(sim,a,s.swordFallEffectIds);delete s.swordFallEffectIds;delete s.swordFallAnchor;}
  if(a.state==='ESSI_SI_SA_ETK_PHANTOM_SWORD'){stop(sim,a,[s.phantomSheathId]);delete s.phantomSheathId;}
  if(a.state==='ESSI_SI_SA_ETK_FINAL_STRIKE'){stop(sim,a,[s.finalStrikeEffectId]);delete s.finalStrikeEffectId;delete s.finalStrikeAnchor;}
}
export function infinitySwordFrame(sim,a,keys,dt){
  if(!isInfinitySword(sim,a))return;const s=saved(a);
  for(const k of ['cruelCooldown','suddenCooldown','brutalCooldown'])s[k]=Math.max(0,s[k]-dt);
  if(a.passivePolicy?.skillLevels?.[21414]&&['RSI_DASH','RSI_DASH_END','RSI_DASH_JUMP','RSI_DASH_JUMP_LANDING'].includes(a.state)){
    s.lightningTime=f(s.lightningTime+dt);if(s.lightningTime>1){sim.grantBuff(a,a,81,a.passivePolicy.skillLevels[21414],null);s.lightningTime=0;}
  }else s.lightningTime=0;
  if(a.hp<=0){stop(sim,a,s.shieldEffectIds);s.shieldEffectIds=[];}
}
export function infinitySwordEvents(sim,a,before,after){
  if(!isInfinitySword(sim,a))return;const s=saved(a),raw=sim.profileFor(a).states[a.state].raw;
  const fire=(id,time,fn)=>sim.fire(a,'is:'+id,time,before,after,fn);
  if(sim.profileFor(a).states[a.state].sourceState==='ESSI_EIS_DASH_COMBO_XX')
    fire('dash-xx-blades',.28,()=>sim.spawnSet(a,'EffectSet_EIS_DASH_XX'));
  if(sim.profileFor(a).states[a.state].sourceState==='ESSI_ETK_DASH_JUMP_ZZZ')
    fire('dash-jump-zzz-blades',0,()=>{
      if(a.mp<10)return;
      a.mp-=10;sim.emit('commandMpSpent',a.id,{amount:10,state:a.state,adapter:'user-is-feedback-v2'});
      sim.spawnSet(a,'EffectSet_ETK_DASH_JUMP_ZZZ');
    });
  if(a.state==='ESSI_A_ETK_SWORD_SHIELD')fire('shield',.68,()=>{s.shieldEffectIds=timedSet(sim,a,'Effectset_A_ETK_SWORD_SHIELD_ULTIMATE',value(sim,a,21221,'SA_EFFECTIVE_TIME'));});
  if(a.state==='ESSI_SI_SA_ETK_MAELSTORM_RAGE')fire('maelstrom',.1333,()=>timedSet(sim,a,'EffectSet_ETK_MAELSTORM_RAGE',value(sim,a,21024,'SA_EFFECTIVE_TIME')));
  if(a.state==='ESSI_SI_SA_ETK_FINAL_STRIKE'){
    fire('final-strike-visual',.633,()=>{s.finalStrikeAnchor=position(a,330,130);sim.createEffect(a,{NAME:'ELSWORD_FINALSTRIKE_BLACKHOLE_EFFECT'},{birthAnchor:s.finalStrikeAnchor});});
    fire('final-strike-pull',.83333,()=>{s.finalStrikeEffectId=sim.createEffect(a,{NAME:'ELSWORD_FINALSTRIKE_BLACKHOLE'},{birthAnchor:s.finalStrikeAnchor}).id;});
    fire('final-strike-hit',2.4,()=>sim.createEffect(a,{NAME:'ELSWORD_FINALSTRIKE'},{birthAnchor:s.finalStrikeAnchor}));
    fire('final-strike-stop',2.53333,()=>stop(sim,a,[s.finalStrikeEffectId]));
  }
  if(a.state==='ESSI_SI_SA_ETK_CRESCENT_CUT')for(const [i,time]of [.4,.9,1.48].entries())fire('crescent'+i,time,()=>{
    const suffix=['ONE','TWO','THREE'][i];sim.spawnSet(a,'EffectSet_CRESCENT_'+suffix);born(sim,a,'ELSWORD_CRESCENT_'+suffix,130,80);
  });
  if(a.state==='ESSI_SI_SA_ETK_HARSH_CHASER'){
    fire('harsh',.3,()=>{s.harshEffectId=born(sim,a,'ELSWORD_HASHCHASER_BLADE',30,130).id;});
    fire('harsh-end',(raw.SKILL_CANCEL_AFTER-.3)*value(sim,a,21215,'SA_PROJECTILE_RANGE_REL')+.3,()=>{stop(sim,a,[s.harshEffectId]);delete s.harshEffectId;});
  }
  if(a.state==='ESSI_SI_SA_EIS_RAGE_CUTTER')fire('rage',.9,()=>{
    const e=born(sim,a,'ELSWORD_SA_RAGECUTTER_HIT_M01',0,10);
    e.sourceBuffFactor=sim.skill(21023,a).raw.BUFF_FACTOR['1'];
  });
  if(a.state==='ESSI_SI_SA_ETK_PHANTOM_SWORD'){
    fire('phantom-sheath',.01,()=>{const e=sim.createEffect(a,{NAME:'ElswordPhantomSwordSheath01',BONE_NAME:'Dummy1_Rhand',TRACE_MATRIX:1});e.lifeTimeSeconds=.89;s.phantomSheathId=e.id;});
    fire('phantom-buff',.0333,()=>sim.grantBuff(a,a,30,a.skillContext.level));
    fire('phantom-second',.06,()=>sim.spawnSet(a,'EffectSet_SECOND_BLADE'));
    fire('phantom-sheath-end',.9,()=>stop(sim,a,[s.phantomSheathId]));
  }
  if(a.state==='ESSI_SI_SA_ETK_SWORD_FALL'){
    fire('sword-fall-sheath',.01,()=>{
      sim.spawnSet(a,'EffectSet_SECOND_BLADE');
      const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01',POSITION_OFFSET_Y:60}},a);
      if(!anchor){sim.note('is-sword-fall-bone','Original Bip01+60 anchor unavailable; no invented origin',a);return;}
      s.swordFallAnchor=anchor;s.swordFallEffectIds=[];
      sim.createEffect(a,{NAME:'elsword_A_swordFall_M01'},{birthAnchor:anchor});
    });
    // Restore the qualified SwordMan callback sequence. The target2016
    // templates supply the displayed preparation meshes, movement, hit
    // helpers and passive sword model; a synthetic simultaneous rain cannot
    // substitute for these four separately released projectiles.
    // Target21033 explicitly adds two swords. The target executable callback
    // is unavailable: retain the four reference releases and reuse the first
    // two original sword paths at the first two V5 interleaved memo timers.
    // This is a target-description adapter, not the old four-sword memo buff.
    const enhanced=sim.skill(a.skillId,a)?.replacesSkillId===21019;
    const prepareTimes=enhanced?[.03333,.06666,.1,.15,.05,.08]:[.03333,.06666,.1,.15];
    const releaseTimes=enhanced?[1,1.16666,1.33333,1.5,.917,1.083]:[1,1.16666,1.33333,1.5];
    for(const [i,time]of prepareTimes.entries())fire('sword-fall-mesh'+i,time,()=>{
      if(!s.swordFallAnchor)return;
      const path=i<4?i:i-4;
      const e=sim.createEffect(a,{NAME:'elsword_A_swordFall_M0'+(path+2)},{birthAnchor:s.swordFallAnchor});
      s.swordFallEffectIds[i]=e.id;
    });
    for(const [i,time]of releaseTimes.entries())fire('sword-fall-release'+i,time,()=>{
      const e=sim.state.effects.find(e=>e.id===s.swordFallEffectIds?.[i]&&!e.dead);
      const bone=e&&sim.effectBoneSampler?.(e,a,'Dummy01');
      if(!bone){sim.note('is-sword-fall-dummy'+i,'Original sword mesh Dummy01 required for release',a);return;}
      const path=i<4?i:i-4;
      sim.createEffect(a,{NAME:'ELSWORD_SWORDFALL_BLADE'+(path+1)},{birthAnchor:{...position(a),position:[bone[0]-59*a.facing,bone[1]+42,bone[2]]}});
      stop(sim,a,[e.id]);
    });
  }
  if(a.state==='ESSI_SI_SA_EIS_SWORD_BLASTING'){
    fire('sword-blasting',.03,()=>{
      s.blastingEffectIds=[];
      for(let i=0;i<3;i++){
        const e=born(sim,a,'ELSWORD_EIS_SWORDBLASTING_PHANTOMSWORD',-150,(i+1)*100,{start:[0,.1,.05][i]});
        e.sourceInfinityLockOn=[a.x+a.facing*1000,a.y,a.z];s.blastingEffectIds.push(e.id);
      }
    });
    fire('sword-blasting-return',.95,()=>{for(const e of sim.state.effects)if(s.blastingEffectIds?.includes(e.id))e.sourceInfinityLockOn=[a.x+a.facing*100,a.y+100,a.z];});
  }
}
export function infinitySwordSkillEvent(sim,a){
  if(!isInfinitySword(sim,a)||a.state!=='ESSI_SI_SA_ETK_HARSH_CHASER')return false;
  const s=saved(a),raw=sim.profileFor(a).states[a.state].raw;
  const until=(raw.SKILL_CANCEL_AFTER-.3)*value(sim,a,21215,'SA_PROJECTILE_RANGE_REL')+.3;
  if(a.animationTime>.4&&a.animationTime<until&&s.harshEffectId&&!sim.state.effects.some(e=>e.id===s.harshEffectId&&!e.dead)){
    sim.enter(a,'ESSI_SI_SA_ETK_HARSH_CHASER_PULL','is-harsh-chaser-contact');return true;
  }return false;
}
export function infinitySwordAttackTimers(sim,a,before,after){
  if(!isInfinitySword(sim,a))return;const raw=sim.profileFor(a).states[a.state].raw;
  for(const [index,key]of ['DAMAGEDATA_CHANGE_TIME','DAMAGEDATA_CHANGE_TIME2'].entries())if(Number.isFinite(raw[key]))
    sim.fire(a,'is-damage-next'+index,raw[key],before,after,()=>{a.hits={};a.hitGaps={};});
}
export function infinitySwordDamageData(sim,a,data){
  if(!isInfinitySword(sim,a))return data;const raw=sim.profileFor(a).states[a.state].raw;
  return Number.isFinite(raw.DAMAGEDATA_CHANGE_TIME2)&&a.animationTime>=raw.DAMAGEDATA_CHANGE_TIME2?raw.DAMAGE_DATA_LAST:data;
}
export function infinitySwordCounter(sim,a,b,data,origin,front){
  if(!isInfinitySword(sim,b)||b.state!=='ESSI_SI_A_ETK_COMPACT_COUNTER_ATTACK'||!front||data.CAN_REVENGE===0||data.CAN_REVENGE===false)return false;
  const w=sim.profileFor(b).states[b.state].raw.REVENGE;if(!(b.animationTime>w['1']&&b.animationTime<w['2']))return false;
  sim.enter(b,'ESSI_SI_A_ETK_COMPACT_COUNTER_GUARD_ATTACK','is-compact-counter');
  if(origin.kind!=='effect'&&a.hp>0){a.vx=0;a.vy=0;sim.enter(a,'RSI_DAMAGE_REVENGE','counter-received-surprise',{directChange:true});}
  sim.emit('isCounter',b.id,{attackerId:a.id});return true;
}
export function infinitySwordOnHit(sim,a,b,data){
  if(!isInfinitySword(sim,a)||!a.passivePolicy||data.REACT_TYPE===7||data.NO_DAMAGE)return;
  const p=a.passivePolicy,s=saved(a),levels=p.skillLevels;
  if(levels[21410]&&++s.cruelHits%5===0&&s.cruelCooldown<=0){sim.grantBuff(a,a,20,levels[21410],null);s.cruelCooldown=p.infinity.cruelCooldown;}
  if(levels[21411]&&s.suddenCooldown<=0&&sim.rng()<p.infinity.suddenChance){sim.grantBuff(a,a,629,levels[21411],null);s.suddenCooldown=p.infinity.suddenCooldown;}
  if(levels[21412]&&[sim.profileFor(a).enums.ATTACK_TYPE.AT_NORMAL,sim.profileFor(a).enums.ATTACK_TYPE.AT_COMMAND].includes(data.ATTACK_TYPE)&&s.brutalCooldown<=0&&sim.rng()<p.infinity.brutalChance){
    sim.grantBuff(a,b,238,levels[21412],null);s.brutalCooldown=p.infinity.brutalCooldown;
    // Target2016 splits ST_SPECIAL_ACTIVE into three grades14–16; the
    // original factor's active/special scope excludes hyper and relationship.
    for(const [id,remaining]of Object.entries(a.cooldowns))if([6,7,14,15,16].includes(sim.skill(Number(id),a)?.type))a.cooldowns[id]=Math.max(0,remaining-1);
  }
  if(levels[21413]&&data.ATTACK_TYPE!==sim.profileFor(a).enums.ATTACK_TYPE.AT_SPECIAL){
    sim.grantBuff(a,b,228,levels[21413],null);sim.grantBuff(a,a,630,levels[21413],null);
  }
}
