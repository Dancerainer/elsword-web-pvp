import {isAddProfile,isElswordProfile,isElesisProfile,professionIdForProfile} from '../professions/identity.mjs';
import elesisDensity from '../../contracts/elesis-effect-density-v1.json' with {type:'json'};
import addBudget from '../../contracts/add-particle-budget-v1.json' with {type:'json'};
import {RS_COMMAND_EFFECT_SETS,RS_COMMAND_DAMAGE_EFFECTS} from '../combat-core/rs-effect-bindings.mjs';
import commandBindings from '../../contracts/command-presentation-bindings-v29.json' with {type:'json'};
import structuralMeshClocks from '../../contracts/structural-mesh-source-clocks-v29.json' with {type:'json'};
// The display-level gate follows fixed-V5 X2GameOption / DamageEffect.
// Density is a separate user-authorized web performance tradeoff, not a
// claimed original-client medium particle count. Combat never reads this.
export const FULL_EFFECT_QUALITY=Object.freeze({level:'high',particleDivisor:1});
export const DEFAULT_EFFECT_QUALITY=Object.freeze({level:'medium',particleDivisor:8});
export const ACTIVE_ARMOR_CAST_EFFECT_SET='EffectSet_ELSWORD_ENDURANCE';
// The five measured V4 flame owners keep their bounded fan-out while all
// authored SHOW_LEVEL layers remain visible. Full high/1 stays unmodified.
export const RS_DENSE_COMMAND_EFFECT_SETS=Object.freeze([
  'EffectSet_EMK_DashJumpComboZX','EffectSet_EMK_DashJumpComboZXX',
  'EffectSet_ERS_ZZZ','EffectSet_EMK_ComboZZZZ','EffectSet_EMK_DashComboZZZ',
]);
// CA 668ZX can repeat the same hit shower on two targets. Keep all high
// SHOW_LEVEL layers and the original projectile/singleton impact cues, but
// retain the pre-v40 density for this exact owner and its inherited children.
// Promoting its 25-fragment showers to high/1 added 1,078 mesh pool slots.
export const CA_DENSE_COMMAND_EFFECT_SETS=Object.freeze(['EffectSet_SDK_Dash_Jump_Combo_ZX']);
export const ELESIS_SOURCE_CLOCK_CUES=new Set(elesisDensity.cues.map(row=>row.name));
export const ADD_SOURCE_CLOCK_CUES=new Set(addBudget.sourceClocks);
export const STRUCTURAL_MESH_SOURCE_CLOCK_CUES=new Set(structuralMeshClocks.cues.map(row=>row.name));
// Sparse LK sword bodies, trails and one-packet cast cues are structural
// presentation. Rate/8 delays them beyond the original cast (5/s -> 1.6s)
// or removes the entire 10/s, .1-second wake burst. Keep their source clock
// under the medium SHOW_LEVEL gate; dense ambient/explosion parents retain
// the existing display-density budget. RF template names are unaffected.
export const LK_SOURCE_CLOCK_CUES=new Set([
  'UnlimitedBlade_HyperP09','UnlimitedBlade_HyperM','UnlimitedBlade_HyperP04','UnlimitedBlade_HyperP02',
  'SwordStorm_M02S','SwordStorm_M02','SwordStorm_M01S','SwordStorm_M01',
  'SpinLiner_Fire_ES_Windmill02','SonicBlade_M04','SandStorm_SwordWY01','RollingSmash_SwordWY01','GiganticSlash_SwordWY01',
  'SA_EL_UNLIMITED_BLADE_P04','SA_EL_UNLIMITED_BLADE_P06','EffectSet_ELK_Grand_Slash_Cast_P17','EffectSet_ELK_Grand_Slash_Cast_P16',
  'EffectSet_ELK_Grand_Slash_Cast_P07A','EffectSet_ELK_Grand_Slash_Cast_P06','EffectSet_ELK_Grand_Slash_Cast_P04','EffectSet_ELK_Grand_Slash_Cast_P03','EffectSet_ELK_Grand_Slash_Cast_P02',
  'ELSWORD_FlameGeyserP03_1','ELK_ArmagedonBladeB01','DoubleSlash_SwordWY01',
  'Light_Knight_ArmageddonBlade01','Light_Knight_ArmageddonBlade02','Flare_MagicKnight_WindBlade01',
  'Elsword_RollingSmash_M01','Elsword_RollingSmash_M01D','Elsword_RollingSmash_M02',
  'Elsword_RollingSmash_LM01','Elsword_RollingSmash_LM01D','RollingSmash_SwordWY02',
]);
// Original IS Maelstrom has three persistent sword emitters with capacity 2
// and 10 births/s; /8 postpones the first sword from .1s to .8s. Harsh Chaser's
// two tether strips likewise have capacity 3 at 10/s. These sparse structures
// retain their authored clocks; the 100-particle Blade Rain shower, sparks,
// dust and explosion fields keep the existing density budget.
export const IS_SOURCE_CLOCK_CUES=new Set([
  'elsword_A_maelstromRage_03','elsword_A_maelstromRage_04','elsword_A_maelstromRage_05',
  'elsword_active_harshChaser_02','elsword_active_harshChaser_03',
]);
// RS's pillars, fire bodies and short rune packets are structural cues. Their
// original birth clocks must fit their parent's .28/.5-second life or .1-second
// TriggerTime. The dense Big Burst smoke/flares and HA sparks remain budgeted.
export const RS_SOURCE_CLOCK_CUES=new Set([
  'ERS_SplashExplosionSL01','ERS_SplashExplosionSL02','ERS_SplashExplosionS01','ERS_SplashExplosionS02',
  'ERS_SplashExplosionE01','ERS_SplashExplosionE02',
  'EMK_RisingSlashP01','EMK_RisingSlashP03','EMK_RisingSlashP04','EMK_RisingSlashP05','EMK_RisingSlashP06',
  'SwordFire_P01','SwordFire_ReadyP01','SwordFire_FM01',
  'Elsword_ReadyS_P01','Elsword_ReadyS_P02','UnlimitedBladeP04','DoubleSlash_P02','SwordFire_ComboXZZ',
  'ERS_Luna_Buster00_P01','EffectSet_ERS_Luna_Buster_P02','EffectSet_ERS_Luna_Buster_P03',
  'EffectSet_ERS_Luna_Buster_P04','EffectSet_ERS_Luna_Buster_P12','EffectSet_ERS_Luna_Buster_P12A','EffectSet_ERS_Luna_Buster_P13',
]);
// BM's .6-second shockwave owner needs all three authored mesh layers. At
// rate/8 the 10/s dark layer never starts, while the 15/20/s layers appear
// only near retirement. HA has the same problem with its .5-second 8/s mesh
// and .2-second 30/s burst. Retain these structural cues using the LK policy;
// ambient sparks, smoke and the dense shockwave trail keep their density cap.
export const BM_SOURCE_CLOCK_CUES=new Set([
  'RST_ShockWave_Pro01','RST_ShockWave_Pro01D','RST_ShockWave_Pro02',
  'SA_RBM_Extrem_Blade_Dubble_Glow_P01','EffectSet_RBM_HYPER_STEP_EXPLO_P08',
  'Ring_Raven_ShockWave01',
  'Condenselight_Raven_RSM_ComboZ4a_BlackHole01','Light_Raven_RSM_ComboZ4a_BlackHole01',
]);
// VC Crow's 15/s flame and wing packets last only .5/.4 seconds. Rate/8
// delays their first particle until .533 seconds, losing the complete cue.
// Keep these authored short clocks and a bounded /4 ground flame budget.
// The smoke/sparks retain the existing /8 density; no damage reads this.
export const VC_SOURCE_CLOCK_CUES=new Set([
  'RVC_SA_ignitionCrow_crow_P02','RVC_SA_ignitionCrow_crowWing_P01',
]);
// Shared Raven Cannon Blade: these short-lived flame bodies overlap at the
// authored 10/12/30 births/s. Applying /8 makes the first body appear only
// .27-.8s into the one-second projectile and leaves gaps longer than its
// .15-.28s lifetime. Preserve this sparse silhouette and the two-packet hand
// flashes; the smoke, spark shower and Trace-child carriers keep their budget.
export const RAVEN_CANNON_BLADE_SOURCE_CLOCK_CUES=new Set([
  'CannonBlade_P01','CannonBlade_P02','CannonBlade_P03','CannonBlade_P05',
  'Raven_ReadyS_P01','Raven_ReadyS_P06',
]);
// Psychic Storm's start/loop rings live .2s at 10/s. The Add /4 budget made
// them disappear between .4s packets. Retain the overlapping ring clock;
// the dense lightning and skin-mesh layers keep their existing /4 budget.
export const ADD_STORM_SOURCE_CLOCK_CUES=new Set([
  'ADD_PSYCHIC_STORM_11','ADD_PSYCHIC_STORM_L05',
]);
// XCrash's overlapping fire tails still exceed the medium web frame budget.
// This is a measured web density tradeoff, not a native medium option value.
// Singleton flashes, meshes and the short scratch cue remain source-complete.
const XCRASH_MEDIUM_QUALITY=Object.freeze({level:'medium',particleDivisor:16});
const levels=Object.freeze({high:0,medium:1,low:2});
// Web display budgets. The invisible sword-fire carriers fan out into three
// independent Trace sequences per particle; thinning only the children leaves
// hundreds of sequence clocks and draw slots alive. Keep a timely first source
// packet, then bound the carrier cadence/cap. High/1 preserves original data.
const boundedFire=new Map([
  ['SwordFire_ReadyP01L',{divisor:4,max:8}],
  ['SwordFire_ReadyP01',{divisor:4,max:8,limit:8}],
  ['SwordFire_ComboXZZ',{divisor:4,max:8,limit:8}],
  ['SwordFire_FM02',{divisor:4,max:8,limit:8}],
  ['SwordFireTip',{divisor:2,max:8}],
  // The travelling flame is the readable body of VC's held dash-Z attack.
  // Smoke and sparks retain their lower budget; do not reduce the body to
  // one widely separated packet per .1 seconds at 1200–1700 units/second.
  ['C_RVC_DashComboZZZZ_P02',{divisor:2,max:24}],
  ['C_RVC_DashComboZZZZ_P05',{divisor:2,max:6}],
  ['C_RVC_DashComboZZZZ_P06',{divisor:2,max:4}],
  ['RWT_SA_REVOLVER_CANNON_FireSpark',{divisor:2,max:6}],
  // CA Brandish's looping skin wave is a visible structural body, separate
  // from its 25-fragment PE04_S shower. Preserve the first source packet and
  // overlapping .2-second body with half density rather than delaying /8.
  ['SDK_BR_BR_PE03_S',{divisor:2,max:13,limit:13}],
]);
const firstPacketCues=new Set([
  ...boundedFire.keys(),'SwordFire_ReadyP01D','SwordFire_F01','SwordFire_F04',
  'SA_RVC_DeadlyRaid_P01','SA_RVC_DeadlyRaid_P03','SA_RVC_DeadlyRaid_P04','SA_RVC_DeadlyRaid_P05','SA_RVC_DeadlyRaid_P07',
  'SA_RVC_DeadlyRaid_big_P01','SA_RVC_DeadlyRaid_big_P05','SA_RVC_DeadlyRaid_big_P07',
  'RWT_SA_REVOLVER_CANNON_Fire_Spark','RWT_SA_REVOLVER_CANNON_Fire_Smoke','RWT_SA_REVOLVER_CANNON_Fire_Smog',
  'RWT_SA_REVOLVER_CANNON_OverHit_Fire_Spark','RWT_SA_REVOLVER_CANNON_OverHit_Fire_Smoke','RWT_SA_REVOLVER_CANNON_OverHit_Fire_Smog',
  'RWT_SA_REVOLVER_CANNON_Hand_Spack00','RWT_SA_REVOLVER_CANNON_Hand_Spack02',
  'DamageImpact','DamageImpactCore','DamageImpactSlash','DamageImpactRed',
]);
export function normalizeEffectQuality(quality=FULL_EFFECT_QUALITY){
  const {level='high',particleDivisor=1}=quality;
  if(!Object.hasOwn(levels,level)||![1,4,8,16].includes(particleDivisor))throw new TypeError('Unsupported effect presentation quality');
  if(quality.sourceFamily!==undefined&&quality.sourceFamily!=='add')throw new TypeError('Unknown presentation source family');
  return Object.freeze({level,particleDivisor,...(quality.sourceFamily?{sourceFamily:quality.sourceFamily}:{})});
}
export function showsDamageParticle(entry,quality){
  // LoadParticleTable's default is OL_LOW, and the consumer keeps >= option.
  const declared=entry.SHOW_LEVEL??2;
  const value=typeof declared==='string'?({OL_HIGH:0,OL_MEDIUM:1,OL_LOW:2})[declared]:declared;
  return !Number.isFinite(value)||value>=levels[quality.level];
}
export function showsCharacterHit(event,localActorId,quality){
  return quality.level==='high'||event.actorId===localActorId||event.targetId===localActorId;
}
/** LK Mortal Blow's decorative rock trail repeats a 12-mesh model every
 * .05 seconds. Medium/low retain alternating source fragments; all original
 * animation nodes and combat helpers continue to run. This is a web display
 * budget, not a source declaration or a native medium option value. */
export function effectMeshPresentationIndices(template,meshCount,quality=FULL_EFFECT_QUALITY){
  if(!Number.isSafeInteger(meshCount)||meshCount<0)throw new TypeError('Invalid effect mesh count');
  const thin=quality.level!=='high'&&template.name==='ESK_Mortal_Blow_MOVE_Stone'&&
    template.glb==='fx/meshes/ESK_MORTAL_BLOW_Rock2.glb';
  return Array.from({length:meshCount},(_,i)=>i).filter(i=>!thin||i%2===0);
}
/** Presentation categories are selected from actual frozen state/set bindings.
 * The two custom combo sets are the audited DashJumpX/XXX consumers, rather
 * than a name-based rule that would also promote active-skill explosions. */
export function createEffectPresentationPolicy(profile,quality){
  if(isAddProfile(profile))quality=normalizeEffectQuality({...quality,sourceFamily:'add'});
  // Both characters' no-state active skill uses this finite2+2+1 ring cue.
  // Only its cast set is promoted: armor duration, counters, sword-mode bursts
  // and other users of the same ring textures retain their own presentation.
  const fullQualityEffectSets=new Set(isElswordProfile(profile)||isElesisProfile(profile)?[ACTIVE_ARMOR_CAST_EFFECT_SET]:[]);
  const skillStates=new Set((profile.skillCatalog??[]).flatMap(skill=>skill.states??[]));
  const skillSources=new Set([...skillStates].map(name=>profile.states?.[name]?.sourceState??name));
  const professionId=professionIdForProfile(profile)??profile.professionId,bindings=commandBindings.professions[professionId];
  const registeredStates=new Set(bindings?.states??[]),standupRoles=new Set(bindings?.standupRoles??[]);
  // A gameplay command controller may also process defensive recovery/cancel
  // states. Keep those system states at the selected skill/system quality,
  // including aliases or buffer declarations that share the same consumer.
  const systemStates=new Set(bindings?.systemStates??[]);
  const systemSources=new Set([...systemStates].map(name=>profile.states?.[name]?.sourceState??profile.stateAliases?.[name]??name));
  const standupSources=new Set([...standupRoles].map(name=>profile.stateAliases?.[name]??profile.states?.[name]?.sourceState??name));
  const comboStates=new Set(),comboSets=new Set(),comboEffects=new Set(),seenRoots=new Set();
  const collect=value=>{if(typeof value==='string'){
      const set=profile.effectSets?.[value]?.raw,damage=profile.damageEffects?.[value]?.raw;
      if(set)comboSets.add(value);if(damage)comboEffects.add(value);
      if((set||damage)&&!seenRoots.has(value)){seenRoots.add(value);collect(set??damage);}
    }else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child);};
  const buffered=new Set(Object.keys(profile.referenceSemantics?.comboBuffers??{}));
  for(const row of Object.values(profile.referenceSemantics?.comboBuffers??{}))
    for(const key of ['Z','X'])if(typeof row[key]==='string')buffered.add(row[key]);
  for(const [name,state]of Object.entries(profile.states??{})){
    const source=state.sourceState??name;
    if(skillStates.has(name)||skillSources.has(source)||systemStates.has(name)||systemSources.has(source))continue;
    const registered=registeredStates.has(name)||registeredStates.has(source);
    if(registered||buffered.has(name)||buffered.has(source)||standupRoles.has(name)||standupSources.has(source)){comboStates.add(name);collect(state.raw);}
  }
  collect([...(bindings?.dynamicRoots??[]),...(profile.targetCommandEffectSets??[])]);
  if(profile.target?.unitClass===101)collect([...RS_COMMAND_EFFECT_SETS,...RS_COMMAND_DAMAGE_EFFECTS]);
  const skillQuality=skillId=>Number(skillId)===24010&&quality.level==='medium'&&quality.particleDivisor>1?
    XCRASH_MEDIUM_QUALITY:quality;
  const rsCommandEffect=effect=>profile.target?.unitClass===101&&RS_COMMAND_DAMAGE_EFFECTS.includes(effect?.name);
  const commandQuality=isAddProfile(profile)?normalizeEffectQuality({...quality,level:'high'}):FULL_EFFECT_QUALITY;
  const denseCommandQuality=quality.particleDivisor>1?normalizeEffectQuality({...quality,level:'high'}):commandQuality;
  const denseSets=new Set(profile.target?.unitClass===101?RS_DENSE_COMMAND_EFFECT_SETS:
    profile.target?.unitClass===125?CA_DENSE_COMMAND_EFFECT_SETS:[]),denseEffects=new Set();
  const collectDense=value=>{if(typeof value==='string'&&profile.damageEffects?.[value]){if(denseEffects.has(value))return;denseEffects.add(value);collectDense(profile.damageEffects[value].raw);}
    else if(value&&typeof value==='object')for(const child of Object.values(value))collectDense(child);};
  for(const name of denseSets)collectDense(profile.effectSets?.[name]?.raw);
  return {
    actor(actor){return actor?.skillId==null&&(comboStates.has(actor?.state)||standupRoles.has(actor?.state))?commandQuality:skillQuality(actor?.skillId);},
    effect(effect){
      if(fullQualityEffectSets.has(effect?.setName))return FULL_EFFECT_QUALITY;
      if(effect?.skillId!=null)return skillQuality(effect.skillId);
      if(denseSets.has(effect?.setName)||denseEffects.has(effect?.name))return denseCommandQuality;
      return effect?.skillId==null&&(comboSets.has(effect?.setName)||comboEffects.has(effect?.name)||rsCommandEffect(effect)||
      // Pinned XXdownX callback requests these pure sequences directly.
      ['Raven_attackX3Front_Particle01','Smoke_Raven_ComboX03','Smoke_Raven_ComboX01','Flare_Raven_ComboX02'].includes(effect?.name))?commandQuality:skillQuality(effect?.skillId);},
    characterHit(event){return event.origin?.skillId==null?commandQuality:skillQuality(event.origin.skillId);},
    comboSets,comboStates,comboEffects,commandQuality,denseCommandSets:denseSets,fullQualityEffectSets,
  };
}
export function particlePresentationBudget(template,max,limit,quality){
  // Mesh skill bodies, singleton flashes and singleton Trace children retain
  // their complete source presentation. Thin the dense parent once so its
  // three child sequences do not each apply another divisor.
  // Original XCrash scratch is a short 10/s, .35s cue. At 1/8 its first birth
  // is postponed to ~.8s, after much of the first-stage claw has passed. This
  // specific source cue is preserved, without promoting its dense fire tail.
  // EnchantHand_PM is likewise only born while its .25s attack box is live;
  // its source 8/s must not be deferred beyond the owning parent's deletion.
  let divisor=template.kind==='particle'&&max>1&&limit!==1&&
    !['XCrash_ScrachP01','EnchantHand_PM'].includes(template.name)&&!LK_SOURCE_CLOCK_CUES.has(template.name)&&!IS_SOURCE_CLOCK_CUES.has(template.name)&&!RS_SOURCE_CLOCK_CUES.has(template.name)&&!BM_SOURCE_CLOCK_CUES.has(template.name)&&!VC_SOURCE_CLOCK_CUES.has(template.name)&&!RAVEN_CANNON_BLADE_SOURCE_CLOCK_CUES.has(template.name)&&!ELESIS_SOURCE_CLOCK_CUES.has(template.name)&&!STRUCTURAL_MESH_SOURCE_CLOCK_CUES.has(template.name)&&
    !/^elswrod_(?:vitality|demolition)_/.test(template.name)?quality.particleDivisor:1;
  if(template.name==='RVC_C_dashJumpX_hitGround_P07')divisor=Math.min(divisor,4);
  // Audited target Add sparse/short-window sequences retain the original
  // birth clock. Dense decorative sequences use a moderate web /4 budget,
  // with the first source packet retained. No raw resource or hit is edited.
  if(quality.sourceFamily==='add')divisor=ADD_SOURCE_CLOCK_CUES.has(template.name)||ADD_STORM_SOURCE_CLOCK_CUES.has(template.name)?1:Math.min(divisor,addBudget.denseDivisor);
  // Sword Fire has eighteen overlapping attack owners, each creating a 40/s
  // flame parent with four Trace children. Preserve its first source packet
  // and cue clock, while bounding simultaneous parents at reduced web density.
  // This capacity is a display budget; source fields and combat are untouched.
  const budgeted=template.kind==='particle'&&max>1&&limit!==1&&quality.particleDivisor>1;
  const swordFireParent=budgeted&&template.name==='SwordFire_FM01';
  const bounded=budgeted?boundedFire.get(template.name):null;
  if(bounded)divisor=Math.max(bounded.divisor,quality.level==='low'?4:bounded.divisor);
  const budget={divisor,max:swordFireParent?Math.max(1,Math.ceil(max/16)):divisor===1?max:Math.max(1,Math.ceil(max/divisor)),
    limit:divisor===1||limit<=0?limit:Math.max(1,Math.ceil(limit/divisor))};
  if(bounded){budget.max=Math.min(budget.max,bounded.max);if(bounded.limit!=null&&limit>=0)budget.limit=Math.min(budget.limit,bounded.limit);}
  if(divisor>1&&(firstPacketCues.has(template.name)||quality.sourceFamily==='add'))budget.firstSourcePacket=true;
  return budget;
}
