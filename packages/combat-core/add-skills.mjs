import {addTargetSkillEvents} from './add-target-skills.mjs';
import {arcLineBasis} from './archenemy-mesh.mjs';
import {startAddMoonlight} from './add-moonlight-v45.mjs';
import {startAddPrism} from './add-prism-v45.mjs';
import {fireAddDeAerialZx,fireAddDeDashXxx} from './add-de-command-v45.mjs';
import {bindLKSetMeshTargets} from './lk-effect-set-targets.mjs';
import {tickAddFactory,addFactoryModeBuff,ADD_FACTORY_DRONES} from './add-factory.mjs';
import {startAddFury} from './add-fury.mjs';
import {addInstallationFactoryActor2016} from './add-installation-power-2016.mjs';
import {applyAddEnergyBoomMutation} from './add-mutation-2016.mjs';
import {addPulseOrder2016,bindAddPulseFront2016} from './add-pulse-cannon-2016.mjs';
import {payAddPulseHeldMaintenance} from './add-pulse-project-policy-v58.mjs';
import {fireAddConqueror} from './add-conqueror-2016.mjs';
import {startAddCommandFury} from './add-command-fury-2016.mjs';
import {addXxzzFrame} from './add-xxzz-2016.mjs';
import {startAddSpaceCrack,ADD_SPACE_CRACK_DP_COST} from './add-space-crack-2016.mjs';
import {fireAddAwakeningAttack} from './add-awakening-2016.mjs';
import {addRecastEvents} from './add-recasts.mjs';
import {addDynamoEvents,applyAddDynamoDuration,ADD_DYNAMO_RESOURCE_ROOTS} from './add-dynamo-skills.mjs';
import {addNasodRequest} from './add-nasod.mjs';
import {addQuicksilverLinkEvents} from './add-quicksilver-link.mjs';
import {startAddMagnetron,MAGNETRON_ORBIT,MAGNETRON_PROJECTILE,MAGNETRON_EXPLOSION} from './add-magnetron.mjs';
import {startMaximumStrike,MAXIMUM_STRIKE_ORB,MAXIMUM_STRIKE_SHOT} from './add-maximum-strike.mjs';
import {clearAddPersistentSkill} from './add-persistent-skills.mjs';
import {startAddShootingChaser,startAddStarfall,ADD_ANALYSIS_RESOURCE_ROOTS} from './add-analysis-skills.mjs';
import {PANZER_RED,PANZER_BG,PANZER_FIRE,addPanzerInput,fireAddPanzer} from './add-panzer-v57.mjs';
/** Add native callback adapters. Magnitudes remain target2016; literals below
 * have hash/line provenance in add-reference-consumers-v1. Reconstructed V5
 * callbacks are version references, never target-client measurements. */
const f=Math.fround;
const isAdd=(sim,a)=>sim.profileFor(a).target.unitType===9;
const state=(sim,a)=>sim.profileFor(a).states[a.state].sourceState??a.state;
const saved=a=>(a.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1});
const after=(t,v)=>Number.isFinite(v)&&v>=0&&f(t)>f(v);
const ended=(sim,a)=>{const d=sim.profileFor(a).states[a.state].clip.durationSeconds;return a.animationStopped||f(a.animationTime)>f(d-Math.max(d/10,.03));};
const next=(sim,a,n)=>{if(!sim.profileFor(a).states[n]){sim.note('add-missing-state:'+n,'Original followup animation unavailable; original declaration retained separately',a);n=a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN';}sim.enter(a,n,'add-qualified-source-skill-event');return true;};
const born=(sim,a,name,bone='Bip01',extra={})=>sim.createEffect(a,{NAME:name,BONE_NAME:bone,...extra});
// Direct creation callbacks not present in EFFECT_SET_LIST(_EX). These do
// not replace the authored root set, so effects omitted by static closure run.
export const ADD_DYNAMIC_SKILL_EVENTS=Object.freeze({
 ANSI_SA_AN_ENERGY_BOOM:[[.527,'damage','DamageEffect_SI_SA_AN_Energy_Boom_Projectile','Bip01']],
 ANSI_SA_AN_VOID_BREAKER:[[.5,'damage','DamageEffect_AN_Void_Breaker_Projectile','EF01',{POSITION_OFFSET_X:30}]],
 ANSI_SA_AN_PARTICLE_ACCELERATOR:[[1.35,'damage','DamageEffect_SA_AN_Particle_Accelerator_Attack','Bip01_Spine1']],
 ANSI_SA_AN_NEUTRON_BOMB:[[1.1,'set','EffectSet_SI_SA_AN_Neutron_Bomb_Attack']],
 ANSI_A_AN_PULSE_BULLET:[[.26,'damage','DamageEffect_AN_Pulse_Bullet_Ball','EF01']],
 ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_FIRE:[[.01,'damage','DamageEffect_AN_Pulse_Bullet_Ball','EF01']],
 ANSI_SA_APT_QUAKE_BUSTER:[[.6,'set','EffectSet_Quake_Buster']],ANSI_SA_APT_QUAKE_BUSTER_HYPER:[[1,'set','EffectSet_Quake_Buster_Hyper']],
 ANSI_A_APT_PYLON_DYNAMO:[[.1,'damage','DamageEffect_APT_Pylon_Dynamo',null],[.1,'damage','DamageEffect_Pylon_Buff',null]],
 ANSI_SA_AAT_PSIONIC_GENERATOR:[[.2,'set','EffectSet_SI_SA_AAT_Psionic_Generator_Start']],
 ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR:[[.5,'damage','DamageEffect_AAT_Dynamo_Factory_Projectile','Bip01_L_Hand']],
 ANSI_SA_ADE_GRAVITY_BURSTER:[[1.1,'set','EffectSet_SA_ADE_GRAVITY_BURSTER_Damage']],
 ANSI_SA_ATT_VOID_FIELD:[[.01,'damage','DamageEffect_ATT_Void_Field',null],[.01,'set','EffectSet_ATT_Void_Field']],
});
export const ADD_COMMAND_SHOTS=Object.freeze({ANSI_COMBO_X:[.333,'EffectSet_AN_Combo_X_Projectile'],ANSI_COMBO_XX:[.47,'EffectSet_AN_Combo_XX_Projectile'],ANSI_COMBO_XXX:[.41,'EffectSet_AN_Combo_XXX_Projectile'],ANSI_COMBO_ZZX:[.2,'EffectSet_AN_Combo_ZZX_Attack'],ANSI_COMBO_ZZXX:[.3,'EffectSet_AN_Combo_ZZXX_Projectile']});
/** The qualified 2026 reconstruction accidentally made basic dissolution
 * commands require pre-existing DP. With the authored zero-DP start that
 * prevents the very first projectile from ever earning DP. Keep its literal
 * two-native-unit spend, saturating at zero outside formation; the formed
 * version still needs those units. This is the requested Web correction,
 * not a newly recovered target2016 resource consumer. */
export function spendAddCommandProjectileResource(actor){
 if(!actor.sourceAdd||actor.sourceAdd.formation&&actor.sourceAdd.dp<2)return false;
 actor.sourceAdd.dp=f(Math.max(0,actor.sourceAdd.dp-2));return true;
}
const apocalypsePrewarmStates=Object.freeze(['APOCALYPSE_START','APOCALYPSE_WAIT','APOCALYPSE_ATTACK_A',
 'APOCALYPSE_ATTACK_B','APOCALYPSE_ATTACK_C','APOCALYPSE_ATTACK_A_EMERGENCY','APOCALYPSE_FINISH_ATTACK','APOCALYPSE_DIE_ATTACK']);
// Exact producers consumed by add-summons.mjs. They are Lua callbacks, not
// EFFECT_SET_LIST_EX entries in the character's Apocalypse casting state.
const apocalypsePrewarmCallbacks=Object.freeze({
 APOCALYPSE_ATTACK_A:'EffectSet_SI_HA_AMM_Apocalypse_Attack_A_Projectile_PVP',
 APOCALYPSE_ATTACK_A_EMERGENCY:'EffectSet_SI_HA_AMM_Apocalypse_Attack_A_Projectile_PVP',
 APOCALYPSE_ATTACK_B:'EffectSet_SI_HA_AMM_Apocalypse_Attack_B_Projectile_PVP',
 APOCALYPSE_ATTACK_C:'EffectSet_SI_HA_AMM_Apocalypse_Attack_C_PVP',
});
/** A finite NPC state burst, including its emitted tails and the independently
 * alive Always displayer/caster set. Alternatives remain separate groups.
 * This is an allocation bound, never a new producer or a 60-second summon
 * lifetime budget; arbitrary repeated interruptions are outside its scope. */
export function getAddApocalypsePrewarmGroups(skill,profile){
 if(skill?.executor!=='Apocalypse'||![29601,29604].includes(skill.skillId)||profile?.target?.unitClass!==123)return [];
 const globals=profile.summonDeclarations?.apocalypse?.globals;if(!globals)return [];
 const names=raw=>Object.values(raw?.EFFECT_SET_LIST_EX??{}).map(row=>row?.['1']).filter(name=>typeof name==='string');
 const persistent=profile.buffFactors?.[443]?.raw?.BUFF_TEMPLET_ID===414?
  Object.values(profile.buffTemplates?.[414]?.raw?.DISPLAYER?.BDT_EFFECT_SET??{}).filter(name=>typeof name==='string'):[];
 const cast=(skill.states??[]).flatMap(state=>names(profile.states?.[state]?.raw));
 return apocalypsePrewarmStates.filter(state=>globals[state]).map(state=>{
  const counts=new Map();
  for(const name of [...persistent,...cast,...names(globals[state]),apocalypsePrewarmCallbacks[state]].filter(Boolean))
   counts.set(name,(counts.get(name)??0)+1);
  return [...counts];
 });
}

/** Runtime reachable roots for loadout prewarming; source-only audit roots
 * must not allocate thousands of inactive burst instances on every match. */
export function getAddSkillResourceRoots(skill,profile){
 const roots=(skill.states??[]).flatMap(n=>(ADD_DYNAMIC_SKILL_EVENTS[n]??[]).map(row=>row[2]));
 roots.push(...getAddApocalypsePrewarmGroups(skill,profile).flatMap(group=>group.map(([name])=>name)));
 const special={PhaseShift:['DamageEffect_Add_Phase_Shift'],QuicksilverAccel:['DamageEffect_ALP_Quicksilver_Accel_Impact','DamageEffect_ALP_Quicksilver_Accel_Impact_Stun'],PulseCannon:['DamageEffect_SA_APT_Pulse_Cannon_Projectile'],PsychicStorm:['EffectSet_SI_SA_ALP_Psychic_Storm_Loop','DamageEffect_ALP_Psychic_Storm_Loop'],MindBreak:['DamageEffect_SI_A_AN_MIND_BREAK'],ForceFinger:['DamageEffect_A_ADE_FORCE_FINGER_Explosion'],ReverseStigma:['DamageEffect_ADE_REVERSE_STIGMA_Attack','DamageEffect_ADE_REVERSE_STIGMA_Return','EffectSetI_SA_ADE_REVERSE_STIGMA_Debuff'],UltimateFury:['Mesh_ADD_Ultimate_Fury_Attack_Dron','DamageEffect_AMM_Ultimate_Fury_Dynamo']};
 roots.push(...(special[skill.executor]??[]));
 if(skill.executor==='Conqueror')roots.push('DamageEffect_SA_APT_Conqueror_Projectile','DamageEffect_SA_APT_Conqueror_Hyper');
 if(skill.executor==='MoonlightRhapsody')roots.push('EffectSet_MOONLIGHT_RHAPSODY_DEBUFF');
 if(skill.executor==='ParticlePrism')roots.push('EffectSet_SA_AN_PARTICLE_PRISM');
 if(skill.executor==='PanzerBuster')roots.push(PANZER_RED,PANZER_BG,PANZER_FIRE);
 if(skill.executor==='SpaceCrack')roots.push('EffectSet_ATT_Space_Crack','EffectSet_ATT_Space_Crack_Performing','DamageEffect_ATT_Space_Crack_Rupture_Main_Projectile','DamageEffect_ATT_Space_Crack_Rupture_Sub_Projectile');
 if(skill.skillId===29205)roots.push(MAGNETRON_ORBIT,MAGNETRON_PROJECTILE,MAGNETRON_EXPLOSION);
 if(skill.skillId===29022)roots.push(MAXIMUM_STRIKE_ORB,MAXIMUM_STRIKE_SHOT);
 if(skill.executor==='QuicksilverAccel')roots.push('DamageEffect_APT_Pylon_Additional_Shock');
 roots.push(...(ADD_DYNAMO_RESOURCE_ROOTS[skill.executor]??[]));
 roots.push(...(ADD_ANALYSIS_RESOURCE_ROOTS[skill.executor]??[]));
 if(skill.skillId===29007)roots.push('EffectSet_SA_APT_STASIS_FIELD_Loop','EffectSet_SA_APT_STASIS_FIELD_Count_Down','EffectSet_SA_APT_Stasis_Field_Activate','DamageEffect_APT_Stasis_Field_Activate');
 if(ADD_FACTORY_DRONES[skill.skillId])roots.push(ADD_FACTORY_DRONES[skill.skillId],'EffectSet_SI_SA_AAT_Installation_Drone_Activator_Generate',
  'EffectSet_A_APT_Pylon_Dynamo_Start','EffectSet_A_APT_Pylon_Dynamo_Impact',...[1,2,3].map(n=>'EffectSet_SI_SA_AAT_Installation_Drone_Change_'+n));
 return [...new Set(roots)];
}
export function addEvents(sim,a,before,afterTime,{applyTimeRing,consumeMutation}={}){
 if(!isAdd(sim,a))return;addQuicksilverLinkEvents(sim,a,before,afterTime);addTargetSkillEvents(sim,a,before,afterTime);addRecastEvents(sim,a,before,afterTime,{consumeMutation});addDynamoEvents(sim,a,before,afterTime,{consumeMutation});const n=state(sim,a),p=sim.profileFor(a),s=saved(a),fire=(id,time,fn)=>sim.fire(a,'add:'+id,time,before,afterTime,fn);
 if(n==='ANSI_SA_COMMON_CREST_OF_TIME')fire('time-ring',.342,()=>{
  if(applyTimeRing)applyTimeRing(sim,a,sim.skill(a.skillId,a));
  else sim.note('add-time-ring-hook','Dedicated Add time ring system hook is unavailable',a);
 });
 if(n==='ANSI_HYPER_MODE')fire('formation-visual',.46,()=>{sim.spawnSet(a,'EffectSet_AN_Formation_Start');born(sim,a,'ADD_STR_ToKang','Bip01');});
 if(n==='ANSI_HYPER_MODE')fireAddAwakeningAttack(sim,a,before,afterTime);
 if(n==='ANSI_AMM_COMBO_ZZXX')fire('command-small-fury',.2,()=>startAddCommandFury(sim,a));
 addXxzzFrame(sim,a,before,afterTime);
 if(n==='ANSI_A_APT_MAGNETRON_DYNAMO')fire('magnetron-orbits',.1,()=>startAddMagnetron(sim,a));
 if(n==='ANSI_SA_ATT_MAXIMUM_STRIKE')fire('maximum-strike-orbits',1.151,()=>startMaximumStrike(sim,a));
 if(n==='ANSI_SA_ADE_MOONLIGHT_RHAPSODY')fire('moonlight-start',1.3,()=>startAddMoonlight(sim,a,{consumeMutation}));
 if(n==='ANSI_SA_AN_PARTICLE_PRISM')fire('prism-start',.1,()=>startAddPrism(sim,a,{consumeMutation,bindSet:bindLKSetMeshTargets}));
 if(n==='ANSI_ATT_DASH_JUMP_COMBO_ZX')fire('de-aerial-zx',.01,()=>fireAddDeAerialZx(sim,a));
 if(n==='ANSI_ADE_DASH_COMBO_XXX')fire('de-dash-xxx',.01,()=>fireAddDeDashXxx(sim,a));
 if(n==='ANSI_A_ATT_SPACE_CRACK_START')fire('space-crack-start',.31,()=>startAddSpaceCrack(sim,a));
 if(n==='ANSI_SA_APT_CONQUEROR'||n==='ANSI_SA_APT_CONQUEROR_HYPER')fire('conqueror-projectiles',1.3,()=>fireAddConqueror(sim,a,{hyper:n.endsWith('_HYPER'),consumeMutation}));
 if(n==='ANSI_SA_ALP_PSYCHIC_STORM_FINISH')fire('storm-handle-stop',.3,()=>clearAddPersistentSkill(sim,a,'storm'));
 if(n==='ANSI_SA_ATT_VOID_FIELD_END')fire('void-handle-stop',.01,()=>clearAddPersistentSkill(sim,a,'void'));
 if(n==='ANSI_DASH_JUMP_COMBO_XX_CHARGE')s.commandChargeTime=f(Math.min(3,a.stateTime));
 if(n==='ANSI_DASH_JUMP_COMBO_XX_FINISH')fire('charged-command-shot',.01,()=>{
  const beforeDp=a.sourceAdd?.dp??0;
  if(!spendAddCommandProjectileResource(a))return;
  const charge=f(Math.min(3,s.commandChargeTime??0)),rate=charge>=3?2:f(1+f(.25*charge));
  const e=born(sim,a,'DamageEffect_AN_Dash_Jump_Combo_XX_Bullet','EF01',{SCALE_X:rate,SCALE_Y:rate,SCALE_Z:rate});
  if(e)e.powerMultiplier=f(e.powerMultiplier*rate);
  sim.emit('addCommandDpSpent',a.id,{amount:beforeDp-a.sourceAdd.dp,declaredAmount:2,dp:a.sourceAdd.dp,chargeTime:charge,chargeRate:rate,evidence:'fixed Add DashJumpComboXXFinishFrameMove .01/2raw/1+.25t maximum2; zero-DP dissolution Web correction; target client unmeasured'});
 });
 if(n==='ANSI_SA_AMM_INSTALLATION_ULTIMATE_FURY')fire('ultimate-fury',1.064,()=>startAddFury(sim,a,{consumeMutation}));
 if(n==='ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER')fire('shooting-chaser',.4,()=>startAddShootingChaser(sim,a));
 if(n==='ANSI_SA_AMM_INSTALLATION_STAR_FALL')fire('starfall',1.2,()=>startAddStarfall(sim,a,{consumeMutation}));
 if(n==='ANSI_SA_AAT_PANZER_BUSTER_FIRE')fire('panzer-fire',.444,()=>fireAddPanzer(sim,a));
 for(const [i,[time,kind,name,bone,extra]]of (ADD_DYNAMIC_SKILL_EVENTS[n]??[]).entries())fire('native:'+i,time,()=>{
  // No duplicate root when a target update already moved a literal callback
  // into data. Record a missing root instead of fabricating a visual/damage.
  if(kind==='set'){if(!p.effectSets[name]){sim.note('add-dynamic-root:'+name,'Original dynamic set missing from target closure',a);return;}sim.spawnSet(a,name);}
  else{if(!p.damageEffects[name]){sim.note('add-dynamic-root:'+name,'Original dynamic damage declaration missing from target closure',a);return;}const factoryActor=n==='ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR'?addInstallationFactoryActor2016(a):a;const e=born(sim,factoryActor,name,bone,extra);applyAddDynamoDuration(sim,a,e);if(n==='ANSI_SA_AN_ENERGY_BOOM')applyAddEnergyBoomMutation(sim,a,e,{consumeMutation});}
 });
 const shot=ADD_COMMAND_SHOTS[n];if(shot)fire('command-projectile',shot[0],()=>{
  // Literal SetDPValue(GetDPValue()-2), distinct from option-aware DP spend.
  // Never reinterpret 2 as two displayed points (40 native units).
  const beforeDp=a.sourceAdd?.dp??0;if(!spendAddCommandProjectileResource(a))return;
  const name=n==='ANSI_COMBO_XXX'&&a.professionId==='DE'?'EffectSet_ADE_Combo_XXX_Projectile':shot[1];sim.spawnSet(a,name);
  sim.emit('addCommandDpSpent',a.id,{amount:beforeDp-a.sourceAdd.dp,declaredAmount:2,dp:a.sourceAdd.dp,evidence:'fixedV5 literal2raw; zero-DP dissolution Web correction; target2016 consumer unmeasured'});
 });
 if(n==='ANSI_SA_APT_PULSE_CANNON_LOOP')fire('pulse-shot',.1,()=>{
  const index=s.pulseOrder[s.pulseCount%6];if(!Number.isInteger(index)||index<1||index>6)throw new TypeError('Pulse bone order requires the original constructor vector');const e=born(sim,a,'DamageEffect_SA_APT_Pulse_Cannon_Projectile','Weapon0'+index);bindAddPulseFront2016(e,a,sim.map);
 });
 if(n==='ANSI_SA_ALP_PSYCHIC_STORM_LOOP'){
  fire('storm-layer',0,()=>{const first=sim.state.nextEffectId;sim.spawnSet(a,'EffectSet_SI_SA_ALP_Psychic_Storm_Loop',undefined,[2]);
   for(const e of sim.state.effects)if(e.ownerId===a.id&&e.id>=first){e.sourceAddStormSize=s.stormSize??1;for(const axis of ['X','Y','Z'])e.definition['SCALE_'+axis]=(e.definition['SCALE_'+axis]??1)*e.sourceAddStormSize;}
  });
  // Original2016 3273b180 loads Bip01_Footsteps and forwards returned XYZ
  // unchanged into3273b243. FixedV5 Bip01+150 lifts the helper above ground.
  for(let i=0;i*.105<=s.stormDuration;i++)fire('storm-hit:'+i,i*.105,()=>{const e=born(sim,a,'DamageEffect_ALP_Psychic_Storm_Loop','Bip01_Footsteps',{SCALE_X:s.stormSize??1,SCALE_Y:s.stormSize??1,SCALE_Z:s.stormSize??1});if(e)e.sourceAddStormSize=s.stormSize??1;});
 }
}
export function addCastState(sim,a,skill,plan){
 if(plan?.recastState)return plan.recastState;
 if(!isAdd(sim,a))return skill.state;
 // Target memo41: 25% chance to refund 33% of the MP actually spent.
 // This is the same target-description adapter used by LK/BM, not a
 // recovered V6 consumer. Selecting/switching a Dynamo spends no MP.
 if(a.professionId==='MM'&&[29013,29035].includes(skill.skillId)&&plan?.mpCost>0&&!plan.ignoreCooldown&&
   !['generator-select','generator-switch'].includes(plan.mode)){
  const policy=a.skillContext?.traitPolicy;
  if(policy?.mpRefundChance>0&&sim.rng()<policy.mpRefundChance){const amount=f(plan.mpCost*policy.mpRefundFraction);
   a.mp=Math.min(a.mpMax,a.mp+amount);sim.emit('traitMpRefund',a.id,{skillId:skill.skillId,amount,branchId:policy.branchId});}
 }
 if(plan?.mode==='generator-select')return 'ANSI_AAT_CREATE_DYNAMO_FACTORY';
 if(plan?.mode==='generator-switch'){
  addFactoryModeBuff(sim,a);
  const variant=[29013,29035].includes(skill.skillId)?1:[29016,29017].includes(skill.skillId)?3:2;
  sim.spawnSet(a,'EffectSet_SI_SA_AAT_Installation_Drone_Change_'+variant);tickAddFactory(sim,a);
  // Original32771560 only invokes3275cec0 when a prior marked skill differs.
  // That exact helper additionally plays both sets below, with literal1
  // power and ordinary origin; the2026 reconstruction omitted these calls.
  const source={...a,skillId:skill.skillId,skillScale:1,skillContext:null};
  sim.spawnSet(source,'EffectSet_A_APT_Pylon_Dynamo_Start');
  sim.spawnSet(source,'EffectSet_A_APT_Pylon_Dynamo_Impact');
  // The qualified callback changes the selected drone without StateChange.
  // Core must commit resource plan then return without starting a cast.
  return null;
 }
 const s=saved(a);s.pulseCount=0;
 if(skill.executor==='PulseCannon')s.pulseOrder=addPulseOrder2016(()=>Math.floor(sim.rng()*32768));
 if(skill.executor==='PsychicStorm'){
  s.stormDuration=.8;s.stormSize=1;
  if(a.sourceAdd?.formation){const level=skill.maxLevel,spent=a.skillContext?.addMutationSpent??0;
   s.stormDuration+=skill.raw.SA_EFFECTIVE_TIME_HYPER[level]+spent*skill.raw.SA_EFFECTIVE_TIME[level];
   s.stormSize+=(skill.raw.SA_PROJECTILE_SIZE[level]-1)*spent;
  }
 }
 return a.sourceAdd?.formation&&sim.profileFor(a).states[skill.state+'_HYPER']?skill.state+'_HYPER':skill.state;
}
export function addSkillCancelAllowed(a,definition){
 const n=definition?.sourceState??a.state;if(!['LP','MM','DE'].includes(a.professionId)||!/^ANSI_(?:A_|SA_|HA_|AAT_CREATE_DYNAMO_FACTORY$)/.test(n))return null;
 // Named fields are strict and never default to another state's old value.
 return after(a.animationTime,definition.raw.SKILL_CANCEL_AFTER_FLY??definition.raw.SKILL_CANCEL_AFTER);
}
export function addSkillEvent(sim,a,keys){
 if(!isAdd(sim,a)||!a.skillId)return false;const n=state(sim,a);if(!/^ANSI_(?:A_|SA_|HA_|AAT_CREATE_DYNAMO_FACTORY$)/.test(n))return false;
 const raw=sim.profileFor(a).states[a.state].raw,s=saved(a),held=keys.held,done=ended(sim,a),skill=sim.skill(a.skillId,a),pressedKey=held.has(a.skillContext?.key);
 if(n==='ANSI_SA_APT_PULSE_CANNON_READY'&&done)return next(sim,a,'ANSI_SA_APT_PULSE_CANNON_LOOP');
 if(n==='ANSI_SA_APT_PULSE_CANNON_LOOP'){
  if(done){s.pulseCount++;if(s.pulseCount<4)return next(sim,a,n);if(s.pulseCount<8&&pressedKey&&payAddPulseHeldMaintenance(sim,a))return next(sim,a,n);return next(sim,a,'ANSI_SA_APT_PULSE_CANNON_FINISH');}return true;
 }
 if(n==='ANSI_SA_ALP_PSYCHIC_STORM'&&done)return next(sim,a,'ANSI_SA_ALP_PSYCHIC_STORM_LOOP');
 if(n==='ANSI_SA_ALP_PSYCHIC_STORM_LOOP'){if(a.stateTime>=s.stormDuration)return next(sim,a,'ANSI_SA_ALP_PSYCHIC_STORM_FINISH');return true;}
 if(n==='ANSI_SA_AAT_PANZER_BUSTER_START'&&done)return next(sim,a,'ANSI_SA_AAT_PANZER_BUSTER_AIMING');
 const panzer=addPanzerInput(sim,a,keys);if(panzer!==null)return panzer?next(sim,a,panzer):true;
 if(n==='ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_READY'&&done)return next(sim,a,'ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_CHARGE');
 if(n==='ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_CHARGE'){if(a.stateTime>=5||!pressedKey)return next(sim,a,'ANSI_A_AN_PULSE_BULLET_CHARGED_IMPULSAR_FIRE');return true;}
 if(n==='ANSI_A_ATT_SPACE_CRACK_START'&&done)return next(sim,a,'ANSI_A_ATT_SPACE_CRACK_WAIT');
 if(n==='ANSI_A_ATT_SPACE_CRACK_WAIT'||n==='ANSI_A_ATT_SPACE_CRACK_MOVE'){
  const hasResource=a.sourceAdd?.formation?a.sourceAdd.dp>=ADD_SPACE_CRACK_DP_COST:a.mp>=3;
  if(!pressedKey||!hasResource||a.sourceAddCombat?.spaceCrack?.holdEnabled===false)return next(sim,a,'ANSI_A_ATT_SPACE_CRACK_END');
  const desired=held.has(a.facing===1?'RIGHT':'LEFT')?'ANSI_A_ATT_SPACE_CRACK_MOVE':'ANSI_A_ATT_SPACE_CRACK_WAIT';
  if(n!==desired)return next(sim,a,desired);
  return true;
 }
 if(n==='ANSI_SA_ATT_VOID_FIELD'&&done)return next(sim,a,'ANSI_SA_ATT_VOID_FIELD_LOOP');
 if(n==='ANSI_SA_ATT_VOID_FIELD_LOOP'){
  if(a.stateTime>=1&&(a.stateTime>=5||!pressedKey||s.voidMaintenanceFailed))return next(sim,a,'ANSI_SA_ATT_VOID_FIELD_END');return true;
 }
 if(done){if(skill.missingAnimationStates?.length)sim.note('add-skill-incomplete:'+skill.skillId,'Target followup clip unavailable: '+skill.missingAnimationStates.join(','),a);return next(sim,a,a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN');}
 const nasod=addNasodRequest(a,sim.profileFor(a).states[a.state],sim.profileFor(a),keys);if(nasod)return next(sim,a,nasod);
 if(after(a.animationTime,raw.SKILL_CANCEL_AFTER)&&keys.pressed.has('AWAKEN')){sim.tryAwakening(a);return true;}
 if(a.grounded&&after(a.animationTime,raw.WALK_CANCEL_AFTER)&&(held.has('LEFT')||held.has('RIGHT')))return next(sim,a,'RSI_WAIT');
 if(a.grounded&&after(a.animationTime,raw.DASH_CANCEL_AFTER)&&(keys.pureDoubleLeft||keys.pureDoubleRight||keys.pressed.has('DASH')))return next(sim,a,'RSI_DASH');
 return true;
}

// Final enhanced Pulse Cannon's target cast-speed modifier applies throughout
// its ready/loop/finish chain and resets automatically when skillId clears.
export function addSkillAnimationMultiplier(a,profile,definition=profile.states[a.state]){
 if(a.professionId!=='LP'||!definition?.sourceState?.startsWith('ANSI_SA_APT_PULSE_CANNON_'))return 1;
 const skill=profile.skillCatalog.find(s=>s.skillId===a.skillId);
 return skill?.raw.SA_ANI_SPEED?.[skill.maxLevel]??1;
}
