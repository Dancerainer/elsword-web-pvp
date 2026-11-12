/** VC target2016 declarations + explicitly qualified Raven reference consumers.
 * No renderer/network dependency. All clocks, edge presses and random choices
 * belong to the common deterministic simulation. See vc-reference-consumers-v1.
 */
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {vcHeldAirSkill,vcAirSkillEnded} from './vc-air-skills.mjs';
import {arcLineBasis} from './archenemy-mesh.mjs';
const f=Math.fround;
const hpFloat=new Float32Array(1),hpBits=new Uint32Array(hpFloat.buffer);
// HP remains binary32. Round upward so a cap/floor cannot be overshot by
// float conversion, including noninteger21% and15% thresholds.
const ceilHp=v=>{hpFloat[0]=v;if(hpFloat[0]<v)hpBits[0]++;return hpFloat[0];};
export const isVeteran=(sim,a)=>sim.profileFor(a).target.unitClass===115;
export const veteranState=a=>(a.sourceVeteranCommander??={loop:0,maxLoop:1,presses:0,overheated:false,previousHp:a.hp,heatEffects:[],spotsLeft:[],spotsRight:[]});
const source=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
const end=(sim,a)=>{const d=sim.profileFor(a).states[a.state].clip.durationSeconds;return a.animationStopped||f(a.animationTime)>f(d-Math.max(d/10,.03));};
const leave=(sim,a)=>sim.enter(a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN','vc-reference-end');
const go=(sim,a,state)=>sim.enter(a,state,'vc-reference-transition');
const skillKey=(sim,a,input)=>a.skillContext?.castStep!==sim.state.step&&input.pressed.has(a.skillContext?.key);
export const canVeteranOverheat=a=>a.hp>0&&f(a.hp/a.hpMax)>f(a.passivePolicy.veteran.hpLimit);
/** Original239 received-enter multiplies the Effect factory scalar. Its
 * body DD already declares10.215 versus ground6.81 and must not scale twice. */
export function veteranEffectFactoryPower(sim,a){
 return a.skillScale*(isVeteran(sim,a)&&source(sim,a)==='RSI_A_RWT_FLAME_SWORD_FLY'?1.5:1);
}
const one=(sim,a,id,time,before,after,fn)=>sim.fire(a,'vc:'+id,time,before,after,fn);
function stop(sim,a,ids,reason){for(const id of ids){const e=sim.state.effects.find(e=>e.id===id);if(e){e.dead=true;e.endEmitted=true;}sim.emit('effectEnded',a.id,{effectId:id,reason});}}
function effect(sim,a,name,{bone,dx=0,dy=0,angle=0,position,facing=a.facing,deleteConditions=[],sourceDirSpeedSign=1}={}){
  const basis=arcLineBasis({...a,facing},sim.map.lines),rotation=basis.rotation;rotation[2]+=angle;
  const definition={NAME:name,...(bone?{BONE_NAME:bone}:{}),...(dx?{POSITION_OFFSET_X:dx}:{}),...(dy?{POSITION_OFFSET_Y:dy}:{})};
  const anchor=position?{position,facing,rotation:[0,facing<0?180:0,angle],evidence:'vc-map-source-adapter'}:
    sim.effectAnchorSampler?.({definition:bone?{BONE_NAME:bone}:{}},a,{profile:sim.profileFor(a)});
  if(bone&&!anchor?.position){sim.note('vc-bone:'+bone,'Original VC bone unavailable; emission omitted instead of a guessed hand position',a);return null;}
  const birthPosition=anchor?.position??[a.x,a.y,a.z];
  const birthAnchor={...anchor,position:position??birthPosition.map((n,i)=>n+basis.direction[i]*dx*facing+(i===1?dy:0)),facing,rotation};
  return sim.createEffect(a,definition,{birthAnchor,deleteConditions,sourceDirSpeedSign});
}
function showOverheatIcon(sim,a,size=0){
  const s=veteranState(a);if((s.overheatIconSize??-1)>=size)return;
  s.overheatIconSize=size;
  const head=sim.effectAnchorSampler?.({definition:{BONE_NAME:'_HEAD_BONE'}},a)?.position;
  if(!head){sim.note('vc-overheat-icon-head','Original head bone unavailable; overheat icon omitted',a);return;}
  const direction=arcLineBasis(a,sim.map.lines).direction;
  const position=head.map((n,i)=>n+direction[i]*(a.facing>0?140:-140)+(i===1?60:0));
  s.overheatNotice={serial:(s.overheatNotice?.serial??0)+1,size,position,direction,remaining:.5};
  sim.emit('overheatIcon',a.id,{size,position,direction});
}
// X2EffectSet::GetEffectPosition: an explicitly supplied world origin takes
// priority over a declaration's BONE_NAME/TRACE, then adds each declared offset.
function fixedSet(sim,a,name,position){
  const first=sim.state.nextEffectId;sim.spawnSet(a,name);
  const basis=arcLineBasis(a,sim.map.lines),horizontal=Math.hypot(basis.direction[0],basis.direction[2]);
  for(const e of sim.state.effects)if(e.id>=first){
    // Fixed V5 X2EffectSet.cpp:139..166 compares the owner's current animation
    // directly with START_TIME, not time since PlayEffectSet. Giga creates
    // another set at .24 in a looping .3 clip; subtracting .24 strands its
    // .1/.18 entries forever as the owner changes/restarts animation.
    if(e.clock==='animation')e.setStartAnimation=0;
    const d=e.definition;e.birthAnchor={position:position.map((n,i)=>n+
      (i===1?d.POSITION_OFFSET_Y??0:basis.direction[i]/horizontal*a.facing*(d.POSITION_OFFSET_X??0))+
      basis.zDirection[i]*(d.POSITION_OFFSET_Z??0)),facing:a.facing,
      rotation:basis.rotation.map((n,i)=>(d.APPLY_UNIT_ROTATION===0?0:n)+(d[['ROTATE_X','ROTATE_Y','ROTATE_Z'][i]]??0)),
      customPosition:true,evidence:'fixedV5 GetEffectPosition custom origin precedes bone; target offsets'};
  }
}
export function burnVeteranOverheat(sim,a,name,{rate=.2,extra=1,power=a.skillScale,kind='skill',layerKey}={}){
  const p=a.passivePolicy.veteran,raw=sim.profileFor(a).damageEffects[name]?.raw.DAMAGE_DATA;
  if(!raw){sim.note('vc-overheat-damage:'+name,'Original overheat penalty data missing',a);return 0;}
  const preset=sim.presetFor?.(a)??{},hardProtection=preset.overheatHardProtection===true&&p.noDamageBelow>0;
  const protectedHp=hardProtection?ceilHp(a.hpMax*p.noDamageBelow):0;
  if(a.hp<=0||(hardProtection?a.hp<=protectedHp:a.hp/a.hpMax<p.noDamageBelow))return 0;
  const type=raw.DAMAGE_TYPE??0,physical=a.stats.physicalAttack*(raw.DAMAGE?.PHYSIC??0),magic=a.stats.magicAttack*(raw.DAMAGE?.MAGIC??0);
  let amount=(type===0?physical:type===1?magic:(physical+magic)*.5)*(raw.PVP_RATE??1)*power*rate*extra*p.hpCostMultiplier;
  if(a.awakening.remaining>0)amount*=sim.profileFor(a).referenceSemantics.awakening.powerMultiplier;
  // Raven::_BurnOverheatHP calls GetFinalDamage directly, bypassing the
  // equipment socket reduction in GUUser::DamageReact (9382). Its own
  // additional-defence block at 17523 is explicitly commented out.
  amount*=a.stats.finalDefenceMultiplier??1;
  // Explicit local gameplay tuning, frozen in the profession preset. Apply
  // before the survival cap; each invocation still checks low-HP immunity.
  const hpCostMultiplier=preset.overheatHpCostMultipliers?.[kind]??preset.overheatHpCostMultiplier??1;
  amount*=hpCostMultiplier;
  let budget;
  if(kind==='skill'&&preset.overheatSkillLayerHpCap!=null){
    const s=veteranState(a),castStep=a.skillContext?.castStep??0,skillId=a.skillId??0;
    // Revolver's two extra shells / Gatling's extension form one accepted
    // heat tier, despite many loop states. Deadly Raid has three separate
    // heat tiers, each with its own state and one penalty callback.
    const key=layerKey??(a.state.startsWith('RVC_SI_SA_DEADLY_RAID')?String(a.stateSerial):'single');
    if(!s.overheatCostBudget||s.overheatCostBudget.castStep!==castStep||s.overheatCostBudget.skillId!==skillId||s.overheatCostBudget.layerKey!==key)
      s.overheatCostBudget={castStep,skillId,layerKey:key,spent:0};
    budget=s.overheatCostBudget;
    amount=Math.min(amount,Math.max(0,a.hpMax*preset.overheatSkillLayerHpCap-budget.spent));
  }
  if(hardProtection)amount=Math.min(amount,Math.max(0,a.hp-protectedHp));
  if(p.surviveOverheat)amount=Math.min(amount,Math.max(0,a.hp-1));
  amount=Math.min(a.hp,Math.max(0,amount));if(amount<=0)return 0;
  const before=a.hp;a.hp=Math.min(before,ceilHp(Math.max(protectedHp,before-amount)));amount=before-a.hp;
  if(amount<=0)return 0; // a sub-ULP budget remainder cannot change binary32 HP
  if(budget)budget.spent+=amount;
  sim.emit('overheatHpChanged',a.id,{name,amount,hp:a.hp,rate,extra,kind,hpCostMultiplier,layerKey:budget?.layerKey,layerSpent:budget?.spent,protectedHp,skillId:a.skillId,evidence:'target damage + fixedV5 self-damage candidate + explicit preset tuning; no critical/hit rewards'});
  return amount;
}
export function activateVeteranOverheat(sim,a){
  const s=veteranState(a),p=a.passivePolicy.veteran;s.overheated=true;
  sim.grantBuff(a,a,p.overheatFactor,p.overheatLevel);
  if(!s.heatEffects.length){
    for(const [name,bone]of [['RVC_OverHeat_Object_Start','Bip01_L_Forearm'],['DAMAGE_EFFECT_OVERHEAT_EFFECT','Bip01_L_Forearm'],['DAMAGE_EFFECT_OVERHEAT_EFFECT','Bip01_L_Hand']]){
      const e=sim.createEffect(a,{NAME:name,BONE_NAME:bone,TRACE:1,...(name==='RVC_OverHeat_Object_Start'?{TRACE_MATRIX:1}:{})});
      e.buffTemplateId=p.overheatFactor===217?250:103;s.heatEffects.push(e.id);
    }
    sim.emit('sound',a.id,{name:'WT_XXXXX_3.ogg',field:'vc-overheat-open'});
  }
  const buff=a.buffs.find(b=>b.templateId===(p.overheatFactor===217?250:103));
  sim.emit('overheatActivated',a.id,{stacks:buff?.accumulationCount??1,remaining:buff?.finalizers.find(x=>x.kind==='time')?.remaining??0});
}
export function veteranPassives(sim,a,dt=0){
  if(!isVeteran(sim,a))return;
  const s=veteranState(a),levels=a.passivePolicy.skillLevels;
  if(s.overheatNotice)s.overheatNotice.remaining=Math.max(0,s.overheatNotice.remaining-dt);
  if(a.hp>0){
    if(s.previousHp/a.hpMax>.5&&a.hp/a.hpMax<.5){
      if(levels[24413])sim.grantBuff(a,a,21,levels[24413]);
      if(levels[24414])sim.grantBuff(a,a,85,levels[24414]);
    }
  }
  s.previousHp=a.hp;
  if(s.heatEffects.length&&(a.hp<=0||!a.buffs.some(b=>b.templateId===103||b.templateId===250))){
    stop(sim,a,s.heatEffects,'vc-overheat-expired');s.heatEffects=[];s.overheated=false;
    if(a.hp>0){sim.createEffect(a,{NAME:'RVC_OverHeat_Object_End',BONE_NAME:'Bip01_L_Forearm',TRACE:1,TRACE_MATRIX:1});sim.emit('sound',a.id,{name:'WT_ZZZXX_2.ogg',field:'vc-overheat-close'});}
  }
}
export function veteranCastState(sim,a,skill){
  if(!isVeteran(sim,a))return skill.state;
  const s=veteranState(a);s.loop=0;s.maxLoop=1;s.presses=0;s.overheated=false;s.overheatIconSize=-1;
  delete s.overheatCostBudget;
  const trait=a.skillContext.traitPolicy;
  if(trait.mpRefundChance>0&&sim.rng()<trait.mpRefundChance){const amount=f(skill.mpCost*trait.mpMultiplier*trait.mpRefundFraction);a.mp=Math.min(a.mpMax,a.mp+amount);sim.emit('traitMpRefund',a.id,{skillId:skill.skillId,amount,branchId:trait.branchId});}
  if(skill.skillId===24221||skill.skillId===24218){
    if(!a.grounded&&skill.skillId===24221)a.skillScale*=a.passivePolicy.veteran.airSkillMultiplier;
    return skill.skillId===24221?'RSI_A_RWT_BARRAGE_ATTACK_'+(a.grounded?'STAND':'AIR'):'RSI_A_RWT_FLAME_SWORD_'+(a.grounded?'GROUND':'FLY');
  }
  return skill.state;
}
const R='RSI_SA_RWT_REVOLVER_CANNON',H='RSI_SA_RWT_HELLFIRE_GATLING',G='RSI_SA_RWT_GIGA_PROMINENCE',P='RSI_SA_RWT_HARPOON_SPEAR',D='RVC_SI_SA_DEADLY_RAID',I='RVC_SI_SA_IGNITION_CROW',C=I+'_INCINERATION';
// Repeated presses belong to the running source callback, not a second cast.
export function veteranAcceptsOverheatInput(sim,a,key){
  if(!isVeteran(sim,a)||!a.skillId||a.skillContext?.key!==key)return false;
  const n=source(sim,a);
  return [R,R+'_LOOP',R+'_FINISH',H,H+'_LOOP',G,G+'_LOOP',P,I,C,D,D+'_LOOP',D+'_LOOP_OVERHEAT'].includes(n);
}
export function veteranStart(sim,a){
  if(!isVeteran(sim,a))return;
  const s=veteranState(a),n=source(sim,a);
  if(n==='RSI_WEAPON_TAKER_COMBO_XXX'){s.loop=0;s.maxLoop=1;s.overheated=false;}
  if(n==='RSI_WEAPON_TAKER_COMBO_XXX_LOOP'){s.loop++;s.overheated=s.loop>1;if(s.overheated)activateVeteranOverheat(sim,a);}
  // Target24034 explicitly describes 3 normal / 5 overheat shots. The older
  // reference's 4/6 constants are not inherited into this 2016 skill.
  if(n===R){s.loop=0;s.presses=0;s.maxLoop=3;}
  if(n===R+'_LOOP'||n===R+'_FINISH'){s.loop++;s.overheated=s.loop>3;if(s.overheated)activateVeteranOverheat(sim,a);}
  if(n===H){s.loop=0;s.presses=0;s.maxLoop=17;}
  if(n===H+'_LOOP'){
    s.loop++;s.overheated=s.loop>17;if(s.overheated)activateVeteranOverheat(sim,a);
    // Target2016 uses the ranged eight-explosion chain, not the old V5
    // muzzle/bullet callback. START_TIME .01 remains the source set's clock.
    // 17/27 loops and the five-press gate remain V5 adapter assumptions.
    sim.spawnSet(a,'EffectSet_SA_RWT_HellFire_Loop'+(s.overheated?'_OverHit':''));
  }
  if(n===G){s.loop=0;s.presses=0;s.spotsLeft=[];s.spotsRight=[];}
  if(n===G+'_LOOP')s.loop++;
  if(n===G+'_FINISH'&&s.presses>=5&&canVeteranOverheat(a)){showOverheatIcon(sim,a);activateVeteranOverheat(sim,a);}
  if(n===P){s.presses=1;a.skillDisableGravity=true;a.vx=a.vy=0;a.passiveSpeed={x:-1,y:-1};}
  if(n===P+'_FIRE'||n===P+'_FIRE_OVERHEAT')a.skillDisableGravity=false;
  if(n===P+'_FIRE_OVERHEAT'||n===I+'_FIRE_OVERHEAT'||n===C+'_FIRE_OVERHEAT')activateVeteranOverheat(sim,a);
  if(n===I||n===C)s.presses=0;
  if(n===D){s.loop=1;s.presses=1;}
  if(n.startsWith(D+'_')&&n!==D+'_END')s.loop++;
  if(n.startsWith(D+'_')&&n.endsWith('_OVERHEAT'))activateVeteranOverheat(sim,a);
  if(n==='RVC_DASH_JUMP_COMBO_X')s.loop=1;
  if(n==='RVC_DASH_JUMP_COMBO_XX_LOOP'||n==='RVC_DASH_JUMP_COMBO_XX_FINISH')s.loop++;
  if(n==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX')a.skillDisableGravity=true;
  if(n==='RVC_DASH_COMBO_ZZZPushZ'){s.loop=0;s.overheated=false;if(canVeteranOverheat(a))activateVeteranOverheat(sim,a);}
}
export function veteranEnd(sim,a,next){
  if(!isVeteran(sim,a))return;
  if(source(sim,a)==='RVC_DASH_JUMP_COMBO_XX_FINISH')veteranState(a).loop=0;
  if(['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX',P].includes(source(sim,a)))a.skillDisableGravity=false;
  if(source(sim,a)==='RVC_DASH_COMBO_ZZZPushZ'){
    const s=veteranState(a);if(s.flameEffect){stop(sim,a,[s.flameEffect],'vc-flamethrower-end');delete s.flameEffect;}
  }
  if(next.startsWith('RSI_DIE_')){const s=veteranState(a);stop(sim,a,s.heatEffects,'vc-death');s.heatEffects=[];s.overheated=false;}
}
function finalSets(sim,a,before,after){
  const raw=sim.profileFor(a).states[a.state].raw,sk=sim.skill(a.skillId,a);
  const sets=sk?.replacesSkillId&&raw.EFFECT_SET_LIST_FINAL_ULTIMATE?raw.EFFECT_SET_LIST_FINAL_ULTIMATE:raw.EFFECT_SET_LIST_FINAL;
  for(const [key,row]of Object.entries(sets??{}))if(row.EFFECT_NAME)one(sim,a,'final:'+key,row.START_TIME??0,before,after,()=>sim.spawnSet(a,row.EFFECT_NAME,undefined,Object.values(row.DELETE_CONDITION??{})));
}
function fireShell(sim,a,name,options,penalty=null,extra=1,kind='skill'){const e=effect(sim,a,name,options);if(e&&penalty)burnVeteranOverheat(sim,a,penalty,{extra,kind});return e;}
function gigaFlame(sim,a){
  const s=veteranState(a);if(!s.spotsRight.length){s.spotsLeft=[150,375,600];s.spotsRight=[150,375,600];}
  const right=s.spotsLeft.length<s.spotsRight.length,spots=right?s.spotsRight:s.spotsLeft;
  const distance=spots.splice(Math.floor(sim.rng()*spots.length),1)[0],x=a.x+(right?distance:-distance);
  // This adapter queries the actual map's authored collision segments. It
  // does not flatten a scene into the training straight or invent a floor.
  const candidates=sim.map.lines.filter(l=>x>=Math.min(l.start[0],l.end[0])&&x<=Math.max(l.start[0],l.end[0])&&Math.abs(l.end[0]-l.start[0])>1e-8)
    .map(l=>{const t=(x-l.start[0])/(l.end[0]-l.start[0]);return {l,y:l.start[1]+(l.end[1]-l.start[1])*t,z:l.start[2]+(l.end[2]-l.start[2])*t};})
    .filter(p=>Math.abs(p.z-a.z)<sim.profileFor(a).referenceSemantics.lineRadius&&p.y<=a.y+sim.profileFor(a).referenceSemantics.lineRadius).sort((a,b)=>b.y-a.y);
  if(!candidates.length)return;
  const p=candidates[0];fixedSet(sim,a,'EffectSet_Raven_Giga_Prominence_Flame',[x,p.y,p.z]);
}
export function veteranEvents(sim,a,before,after){
  if(!isVeteran(sim,a))return;
  const s=veteranState(a),n=source(sim,a),raw=sim.profileFor(a).states[a.state].raw;
  finalSets(sim,a,before,after);
  const at=(id,time,fn)=>one(sim,a,id,time,before,after,fn),hand={bone:'Bip01_L_Hand'};
  const commandShot=(time,name,bone,dx)=>at(name,time,()=>{if(a.mp<2)return;a.mp-=2;effect(sim,a,name,{bone,dx});});
  if(n==='RWT_COMBO_X')commandShot(.321,'RWT_COMBO_X_SHELL','Bip01_L_Hand',-50);
  if(n==='RSI_WEAPON_TAKER_COMBO_ZZZdownX')commandShot(.335,'RWT_COMBO_X_SHELL','Dummy2_Lhand',0);
  if(n==='RSI_WEAPON_TAKER_COMBO_ZZZdownXX')commandShot(.225,'RWT_COMBO_ZZZ_DOWN_XX_SHELL','Dummy2_Lhand',0);
  if(n==='RSI_WEAPON_TAKER_COMBO_XXX_LOOP')at('command-heat',.11,()=>{const name='RWT_COMBO_XXX_LOOP'+(s.overheated?'_OVERHEAT':'');fireShell(sim,a,name,hand,s.overheated?name:null,.5,'command');});
  if(n==='RVC_DASH_JUMP_COMBO_X')at('air-x',.26,()=>{if(a.mp<10)return;a.mp-=10;sim.spawnSet(a,'EffectSet_Raven_Dash_Jump_Fire');effect(sim,a,'DAMAGE_EFFECT_DASH_JUMP_X_BULLET',{...hand,angle:-45});});
  if(n==='RVC_DASH_JUMP_COMBO_XX_LOOP')at('air-heat',.006,()=>{effect(sim,a,'DAMAGE_EFFECT_DASH_JUMP_X_BULLET_LOOP',{...hand,angle:-42.5+(.7-sim.rng()*1.5)*10});burnVeteranOverheat(sim,a,'DAMAGE_EFFECT_DASH_JUMP_Xloop_BULLET_HIT',{extra:.5,kind:'command'});activateVeteranOverheat(sim,a);});
  if(n==='RVC_DASH_JUMP_COMBO_XX_FINISH'){
    at('air-finish',.025,()=>effect(sim,a,'DAMAGE_EFFECT_DASH_JUMP_X_BULLET',{...hand,angle:-45}));
  }
  if(n==='RVC_DASH_COMBO_ZZZPushZ'&&s.overheated){
    if(!s.flameEffect){const e=effect(sim,a,'DAMAGE_EFFECT_RVC_FRAME_THROW',{...hand,dx:30,deleteConditions:[2]});if(e)s.flameEffect=e.id;}
    while(s.loop<=Math.floor(after/.2)&&s.loop<=20){burnVeteranOverheat(sim,a,'DAMAGE_EFFECT_RVC_FRAME_THROW_OVERHEAT_PENALTY',{extra:.5,kind:'command'});activateVeteranOverheat(sim,a);s.loop++;}
  }
  if(n===R+'_LOOP'||n===R+'_FINISH')at('revolver',.01,()=>{const name='RAVEN_REVOLVER_CANNON_'+(n.endsWith('_FINISH')?'FINAL_':'')+'SHELL'+(s.overheated?'_OVERHEAT':'');fireShell(sim,a,name,{...hand,dx:-50},s.overheated?name:null);});
  if(n===H+'_LOOP'&&s.overheated)at('gatling-heat',.01,()=>burnVeteranOverheat(sim,a,'DamageEffect_SA_RWT_HellFire_Explosion_OverHit'));
  if(n===P+'_FIRE_OVERHEAT')at('harpoon-penalty',.01,()=>burnVeteranOverheat(sim,a,'RAVEN_HARPOON_SPEAR_SHELL_OVERHEAT_PENALTY'));
  if(n===G+'_LOOP')for(const time of [.01,.24])at('giga:'+time,time,()=>gigaFlame(sim,a));
  if(n===G+'_FINISH'){
    if(s.overheated)at('giga-smoke',.01,()=>fireShell(sim,a,'RAVEN_GIGA_PROMINENCE_FINISH_SMOKE',hand,'RAVEN_GIGA_PROMINENCE_FINISH_SMOKE'));
    at('giga-stones',.3,()=>{for(const sourceDirSpeedSign of [-1,1])effect(sim,a,'RAVEN_GIGA_PROMINENCE_FINISH_STONE',{position:[a.x,a.y,a.z],sourceDirSpeedSign});});
    at('giga-finish',.4,()=>{for(const sourceDirSpeedSign of [-1,1])effect(sim,a,'RAVEN_GIGA_PROMINENCE_FINISH'+(s.overheated?'_OVERHEAT':''),{position:[a.x,a.y,a.z],sourceDirSpeedSign});});
  }
  if(n===I+'_FIRE'||n===I+'_FIRE_OVERHEAT')at('crow',.01,()=>{effect(sim,a,'DAMAGE_EFFECT_IGNITION_CROW'+(n.endsWith('_OVERHEAT')?'_OVERHEAT':''));if(n.endsWith('_OVERHEAT'))burnVeteranOverheat(sim,a,'DAMAGE_EFFECT_IGNITION_CROW_OVERHEAT_PENALTY');});
  if(n===C+'_FIRE_OVERHEAT')at('incineration-penalty',.01,()=>burnVeteranOverheat(sim,a,'DAMAGE_EFFECT_IGNITION_CROW_INCINERATION_OVERHEAT_PENALTY'));
  if(n.startsWith(D)&&Number.isFinite(raw.DAMAGEDATA_CHANGE_TIME))at('deadly',raw.DAMAGEDATA_CHANGE_TIME,()=>{
    const heat=n.endsWith('_OVERHEAT'),finish=n.includes('_FINISH'),ready=n.includes('_LOOP_END');
    const name=ready?'DAMAGE_EFFECT_DEADLY_FINISH_READY':finish?'DAMAGE_EFFECT_DEADLY_RAID_FINISH':'DAMAGE_EFFECT_DEADLY_RAID';
    const e=fireShell(sim,a,name+(heat?'_LARGE':''),{...hand,dx:100},heat?name+'_LARGE':null);
    if(e?.birthAnchor?.position)fixedSet(sim,a,finish?'EffectSet_Raven_Deadly_Raid_Big':'EffectSet_Raven_Deadly_Raid',e.birthAnchor.position);
  });
  if(n==='RSI_A_RWT_BARRAGE_ATTACK_STAND'||n==='RSI_A_RWT_BARRAGE_ATTACK_AIR')at('haze',n.endsWith('_AIR')?.1:.4,()=>{
    const air=n.endsWith('_AIR'),e=effect(sim,a,'RAVEN_BARRAGE_ATTACK_STAND',{...hand,dx:air?75:25,dy:air?-75:25});
    if(e?.damage){const factor=sim.skill(a.skillId,a).raw.BUFF_FACTOR?.['1'];if(factor)e.damage.DAMAGE_DATA={...e.damage.DAMAGE_DATA,BUFF_FACTOR_ID:{'1':factor}};}
  });
  if(n==='SI_A_RRF_GROUND_IMPACT')at('ground-impact',.466,()=>{
    const first=sim.state.nextEffectId;sim.spawnSet(a,'EffectSet_RAVEN_GROUND_IMPACT');
    const scale=sim.skill(a.skillId,a)?.raw.SA_PROJECTILE_SIZE?.['1']??1;
    // GetEffectScale excludes DAMAGE_EFFECT and explicit APPLY_INSTANCE_SCALE=0.
    for(const e of sim.state.effects)if(e.id>=first&&e.definition.EFFECT_TYPE!==1&&e.definition.APPLY_INSTANCE_SCALE!==0)
      for(const axis of ['SCALE_X','SCALE_Y','SCALE_Z'])e.definition[axis]=(e.definition[axis]??1)*scale;
  });
  if(n==='RSI_A_RVC_NAPALM_GRENADE')at('grenade',.6,()=>{for(let i=1;i<=3;i++)effect(sim,a,'DAMAGE_EFFECT_NAPALM_GRENADE_BULLET_'+i);});
}
export function veteranSkillEvent(sim,a,input){
  if(!isVeteran(sim,a)||!a.skillId)return false;
  const n=source(sim,a),s=veteranState(a),done=end(sim,a),press=skillKey(sim,a,input),can=canVeteranOverheat(a);
  if(vcHeldAirSkill(sim.profileFor(a).states[a.state])){
    if(done){
      if(a.grounded)go(sim,a,'RSI_JUMP_LANDING');
      else a.animationStopped=true;
    }
    return true;
  }
  if(n===R||n===R+'_LOOP'||n===R+'_FINISH'){
    if(press&&can){s.presses++;if(n===R+'_LOOP'&&s.presses>=5){s.maxLoop=5;showOverheatIcon(sim,a);}}
    if(done)go(sim,a,n===R?R+'_LOOP':n===R+'_FINISH'?R+(s.overheated?'_OVER_END':'_END'):s.loop+1>=s.maxLoop?R+'_FINISH':R+'_LOOP');return true;
  }
  if(n===H||n===H+'_LOOP'){
    if(press&&can){s.presses++;if(n===H+'_LOOP'&&s.presses>=5){s.maxLoop=27;showOverheatIcon(sim,a);}}
    if(done)go(sim,a,n===H?H+'_LOOP':s.loop>=s.maxLoop?H+(s.overheated?'_OVER_END':'_END'):H+'_LOOP');return true;
  }
  if(n===P){if(press&&can){s.presses++;if(s.presses>=4)showOverheatIcon(sim,a);}if(done)go(sim,a,P+(s.presses>=4&&can?'_FIRE_OVERHEAT':'_FIRE'));return true;}
  if(n===G||n===G+'_LOOP'){
    if(press&&can)s.presses++;if(done)go(sim,a,n===G?G+'_LOOP':s.loop>=8?G+'_FINISH':G+'_LOOP');return true;
  }
  if(n===G+'_FINISH'){if(done)go(sim,a,G+(s.overheated?'_OVER_END':'_END'));return true;}
  if(n===I||n===C){if(press&&a.animationTime<2.01){s.presses++;if(s.presses>=5&&can)showOverheatIcon(sim,a);}if(done)go(sim,a,n+((s.overheatIconSize??-1)>=0?'_FIRE_OVERHEAT':'_FIRE'));return true;}
  if(n===I+'_FIRE_OVERHEAT'||n===C+'_FIRE_OVERHEAT'){if(done)go(sim,a,(n.startsWith(C)?C:I)+'_OVERHEAT_END');return true;}
  if(n===D||n===D+'_LOOP'||n===D+'_LOOP_OVERHEAT'){
    if(press&&(n===D||a.animationTime<.21)){
      s.presses++;
      // PossibleDeadlyRaidLoop checks all three tiers in order. Even the
      // first animation may accept seven presses and display all three tiers.
      if(can)for(const size of [1,2,3])if(s.loop<=size&&s.presses>=size*2+1&&(s.overheatIconSize??-1)<size){showOverheatIcon(sim,a,size);break;}
    }
    if(done){const next=s.loop===1?s.presses>=3&&can:s.loop===2?s.presses>=5&&can:s.loop===3?s.presses>=7&&can:false;
      go(sim,a,D+(s.loop>=3?(next?'_LOOP_OVERHEAT':'_LOOP_END_OVERHEAT'):(next?'_LOOP':'_LOOP_END')));}
    return true;
  }
  if(n===D+'_LOOP_END'||n===D+'_LOOP_END_OVERHEAT'){if(done)go(sim,a,D+(s.loop>2?'_FINISH_OVERHEAT':'_FINISH'));return true;}
  if(n===D+'_FINISH_OVERHEAT'){if(done)go(sim,a,D+'_END');return true;}
  if([R,H,G,P,D,I,C].some(prefix=>n.startsWith(prefix))||['RSI_A_RWT_BARRAGE_ATTACK_AIR','RSI_A_RWT_BARRAGE_ATTACK_STAND','RSI_A_RVC_NAPALM_GRENADE','RSI_A_RWT_MENTAL_BREAK','SI_A_RRF_GROUND_IMPACT','RSI_A_RF_BREAKING_FIST','RSI_HA_RVC_BURNING_BUSTER'].includes(n)){
    if(done){if(n.endsWith('_AIR')&&!a.grounded)a.animationStopped=true;else leave(sim,a);}return true;
  }
  return false;
}
/** Raven18212/22705: after animation end, preserve the pose while moving
 * with raw walk speed / optional Down acceleration until the landing event. */
export function veteranAirSkillFuture(sim,a,input,dt){
  if(!isVeteran(sim,a))return;
  const p=sim.profileFor(a),def=p.states[a.state];
  if(!vcHeldAirSkill(def)||!vcAirSkillEnded(a,def))return;
  if(input.held.has(a.facing>0?'RIGHT':'LEFT'))a.vx=p.physics.WALK_SPEED*a.facing;
  if(input.held.has('DOWN'))a.vy=f(f(a.vy)-f(f(p.physics.G_ACCEL)*f(dt)));
}
