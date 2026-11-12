/** Source-referenced player ownership, not a native packet implementation.
 * Configuration, room rules, identity and effect definitions are never supplied
 * by a player. Mutable unit/effect clocks belong to that unit's browser. */
import {damageStartParticleEntries} from '../combat-core/damage-start-particles.mjs';
import {synchronizeBuffStats} from '../combat-core/passive-attributes-v20.mjs';
import {MANA_BREAK_HOLD_SECONDS} from '../combat-core/mana-break-intent-v62.mjs';
import {buffControls} from '../combat-core/buffs.mjs';
import {validateSourceStatusClock,decodeOwnerStatusClock} from './owner-status-clock.mjs';
import {projectRemoteBuffResources} from '../combat-core/buff-network-view.mjs';
import {retireIonBlackHole} from '../combat-core/black-hole.mjs';
import {validInvulnerabilityDisplay} from '../combat-core/invulnerability-display.mjs';
import {WIND_SLICER_SET,WIND_SLICER_CARRIER,hasSetTarget} from '../combat-core/lk-wind-slicer.mjs';
import {LK_BONE_TARGETS,ELESIS_BONE_TARGETS,ADD_BONE_TARGETS,ADD_ANALYSIS_BONE_TARGETS,hasSetMeshBoneTarget} from '../combat-core/lk-effect-set-targets.mjs';
import {validateAddNativeState,STARFALL_CARRIER,CHASER_ATTACKER} from '../combat-core/add-analysis-skills.mjs';
import {lordKnightCharacterAttackStage} from '../combat-core/lk-skills.mjs';
import {runeSlayerInstanceDefinition,runeSlayerEffectHitMemory} from '../combat-core/rs-skills.mjs';
import {elesisInstanceDefinition,restoreElesisEffectControls,validateElesisShadowLink} from '../combat-core/elesis-skills.mjs';
import {validateBloodCutterCarrier,validateBloodCutterRequests,restoreBloodCutterControls} from '../combat-core/elesis-blood-cutter.mjs';
import {validateElesisFirewalls} from '../combat-core/elesis-firewall-v45.mjs';
import {validateLegacyFireStores} from '../combat-core/legacy-fire-stores-v53.mjs';
import {validateSourcePendingState} from '../combat-core/source-state-requests-v53.mjs';
import {validateGMSpawnRotation} from '../combat-core/gm-sword-spawn-instance.mjs';
import {validateAddStardustMesh,restoreAddStardustMesh,stardustMeshMain} from '../combat-core/add-stardust-mesh-v56.mjs';
import {validateAddMovement} from '../combat-core/add-movement.mjs';
import {validateLPZxCapture,validateLPZxCaptureReferences} from '../combat-core/add-lp-zx-tier-v61.mjs';
import {retireElesisShadowLink} from '../combat-core/elesis-shadow-edge.mjs';
import {retireReflectedSource,retireReflectionReceipts} from '../combat-core/projectile-reflection.mjs';
import {veteranAttachmentDefinition,veteranInstanceDefinition} from '../combat-core/vc-effect-bindings.mjs';
import {veteranTargetSets,hasVeteranTarget} from '../combat-core/vc-target-mesh.mjs';
import {validStandupAttackChoice,validStandupAttackNoDown} from '../combat-core/standup-policy.mjs';
import {phantomSwordEffectControls,phantomSwordDamageData} from '../combat-core/is-phantom-sword.mjs';
import {isElesisProfile} from '../professions/identity.mjs';
import {BLAZE_WING_LOCK_ON_DAMAGE} from '../combat-core/bh-blaze-wing-lock-on.mjs';
import {validateAddLockOn} from '../combat-core/add-lock-on.mjs';
import {validateMaximumStrikeActor,validateMaximumStrikeEffect} from '../combat-core/add-maximum-strike.mjs';
import {validateAddMarkedDrone} from '../combat-core/add-drone-lock.mjs';
import {receiveBlazeWingHistory} from '../combat-core/bh-blaze-wing-history.mjs';
import {timeRingSavedMpLimit} from './time-ring-resource-bounds.mjs';
import {validateAddState,validateAddTimeRingState,validateAddTimeRingNotice,applyAddTimeRingToActor,ADD_FORMATION_SENTINEL} from '../combat-core/add-systems.mjs';
import {addInstanceDefinition,validateAddStormEffectState} from '../combat-core/add-effect-state.mjs';
import {addLinkedDefinition,validateAddFuryEffectState} from '../combat-core/add-linked-effect-state.mjs';
import {addDynamoInstanceDefinition,validateAddFissionSplit} from '../combat-core/add-dynamo-effect-state.mjs';
import {validateAddSummonState,validateAddSummonEffectState} from '../combat-core/add-summons.mjs';
import {validateAddSummonProjectileState} from '../combat-core/add-summon-projectiles.mjs';
import {validateAddTargetNotice,receiveAddTargetNotice} from '../combat-core/add-target-notices.mjs';
import {validateAddDroneMarkState,validateAddDroneMarkEffect} from '../combat-core/add-drone-mark.mjs';
import {validateAddPrismAnimation,restoreAddPrismAnimation} from '../combat-core/add-prism-animation-v45.mjs';
import {validateAddPanzerState,PANZER_PREFIX} from '../combat-core/add-panzer-v57.mjs';
import {ADD_COMMON_BONE_TARGETS} from '../combat-core/add-prism-v45.mjs';
import {addPrismProjectDefinition} from '../combat-core/add-prism-project-rules-v57.mjs';
import {validateAddStigmaState,validateAddStigmaNotice,receiveAddStigmaNotice} from '../combat-core/add-stigma.mjs';
import {validateAddFantasyTracerState} from '../combat-core/add-fantasy-tracer.mjs';
import {validateAddQuicksilverLinkState} from '../combat-core/add-quicksilver-link.mjs';
import {validateAddMoonlightState} from '../combat-core/add-moonlight-v45.mjs';
import {validateAddSpaceCrack} from '../combat-core/add-space-crack-2016.mjs';
import {validateAddCountdownShake} from '../combat-core/add-countdown-shake-2016.mjs';
import {validateAddPrismEndpoints} from '../combat-core/add-prism-endpoints-2016.mjs';
import {validateAddDePhysicalRequest} from '../combat-core/add-de-prediction-2016.mjs';
import {validateElesisFireAbsorbNotice,receiveElesisFireAbsorbNotice,receiveElesisAvatarScan} from '../combat-core/elesis-fire-absorb-v45.mjs';
import {validateAddMoonlightNotice,receiveAddMoonlightNotice} from '../combat-core/add-moonlight-receipts-v45.mjs';
import {validateContinuousAuraMarker,acceptContinuousAuraState,isManagedContinuousAura,retainNewerContinuousAura,hasNewerContinuousAuraPhase,observeContinuousAuraAbsence} from '../combat-core/continuous-aura.mjs';
import {validateForceFingerResourceNumbers,encodeForceFingerResourceNumbers,receiveForceFingerResourceNumbers} from './force-finger-resource-numbers-v49.mjs';
export const OWNERSHIP_PROTOCOL='local-owner-v1';
export const MAX_OWNER_BYTES=96*1024;
export const MAX_OWNER_EFFECTS=96;
// Frozen twelve-profession declarations currently contain stages 0..3; only
// CA Dread Weapon declares NEXT3. References below still require the exact
// effect's local DAMAGE_DATA_NEXT table for every nonzero stage.
export const MAX_OWNER_EFFECT_STAGE=3;
export const OWNER_ACTION_HISTORY_FRAMES=60;
// One valid report can touch at most one parent for each of its live effects.
// Keep the complete supported source-history window plus the current frame.
export const MAX_RECENT_OWNER_EFFECT_LINKS=2*MAX_OWNER_EFFECTS*(OWNER_ACTION_HISTORY_FRAMES+1);
const actorFields=new Set(('x y z vx vy vz passiveSpeed facing state stateTime stateSerial animationTime animationName animationLoop animationBeforeTime animationOneshotTimer animationPlaybackSpeed animationTransitionSerial animationStopped animationSpeedRamp presentationTransition applyMotionOffset consumeRootTranslation rootMotionEnabled motionMoveNow canNotJumpTime jumpAttackDown sourceCommandFlags canNotAttackTime reAttackZ1Time reAttackZ1Right sourceDashJumpEffectHandle grounded lineId lastTouchLineId landPosition hp mp awakening core cooldowns skillId skillContext hitStop worldStop effectiveBlackHoleIds blackHoleDisplacement sourceBlackHoleCanPass fired hits hitGaps buffered tapTimes doubleHeldDirections ignoreLineId dropRemaining death invincible showInvincible superArmor superArmorNotRed limitCrusherCharging skillScale soundSet pendingPlatformJump pendingPressed tapReleased downForce jumpOnLanding knockdown manaBreak flyCount lastAttackerFront deathPresentation deathAlpha hidden deathComplete downSuccessor buffs buffControls sourceArcEnemy sourceMegaDrill sourceMegaDrillNowSupported sourceWildCharge sourceXCrash sourceWildChargeEffectGroup sourceAwakeningAuraEffectGroup sourceCustomStateEffectGroup sourceDashJumpEffectGroup sourceCommandDirection sourceCommandHandPosition skillDisableGravity skillDownAccel skillSuperArmorNotRed animationSpeedOverride animationTargetSpeed platformAttackInput additionalDamageEffect').split(' '));
actorFields.add('sourceStatusClock');actorFields.add('forceInvincible');
actorFields.add('wayOfSword');
actorFields.add('destructionRageRemaining');actorFields.add('sourceWayOfSwordEffectGroup');
actorFields.add('sourceLordKnight');
actorFields.add('sourceRuneSlayer');
actorFields.add('sourceRuneSlayerHitReceipts');
actorFields.add('sourceReflectionNotice');
actorFields.add('sourceVeteranCommander');
actorFields.add('sourceInfinitySword');
actorFields.add('sourceBladeMaster');
actorFields.add('sourceHitCountByte');
actorFields.add('sourceLegacyFireStores');
for(const key of ['sourcePendingState','sourceStateRequestByte','sourceAppliedStateByte'])actorFields.add(key);
const elesisOwnerFields=['sourceElesisSkills','sourceElesisCommand','sourceElesisBreakCharge','sourceElesisGaleHits','sourceElesisComboRemaining','sourceElesisEndurance','sourceElesisBurst','sourceElesisBloodCutterRequests','sourceElesisFirewallRequests'];
actorFields.add('sourceElesisFireAbsorbNotice');
actorFields.add('sourceAddMoonlightNotice');
actorFields.add('sourceForceFingerResourceNumbers');
actorFields.add('sourceFacingHistory');
actorFields.add('sourceAddPrismEndpoints');
for(const key of elesisOwnerFields)actorFields.add(key);
for(const field of ['sourceAdd','sourceAddNative','sourceAddMovement','sourceAddCombat','sourceAddSummon','sourceTimeRing','sourceTimeSickness','sourceTimeRingNotice','sourceAddTargetNotice','sourceAddDroneMark','sourceAddStigma','sourceAddStigmaNotice','sourceAddFantasyTracer'])actorFields.add(field);
actorFields.add('downAttackChoice');actorFields.add('standupAttackNoDown');
actorFields.add('mapMechanics');actorFields.add('sourceShadowStep');
const effectStatic=new Set(['definition','damage','templateFields','initialSize','initialVelocity','initialDirSpeed','initialAnimationName','initialAnimationPlayback','velocityEvidence','traitPolicy']);
effectStatic.add('sourceSetTargetMesh');
const criticalFields=new Set(('x y z vx vy passiveSpeed facing state stateSerial stateTime animationTime animationName animationLoop animationPlaybackSpeed animationBeforeTime grounded lineId lastTouchLineId landPosition hp mp skillId skillContext skillScale fired soundSet buffs awakening core sourceMegaDrill sourceMegaDrillNowSupported sourceArcEnemy sourceWildCharge sourceXCrash').split(' '));
criticalFields.add('animationTransitionSerial');
criticalFields.add('manaBreak');
// Each reliable action must retain its own reaction intent even when an HTTP
// relay or an unsent RTC batch replaces the envelope with a newer pose. All
// of these fields already use the strict full-actor schema below. Deploy this
// action extension with the matching server/client build; old receivers
// intentionally reject unknown critical fields.
for(const key of ['hitStop','worldStop','vz','lastAttackerFront','downForce','flyCount','animationSpeedRamp','presentationTransition'])criticalFields.add(key);
const statusCriticalFields=new Set(['sourceStatusClock','forceInvincible','invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed']);
for(const key of statusCriticalFields)criticalFields.add(key);
criticalFields.add('wayOfSword');criticalFields.add('destructionRageRemaining');
const forbidden=new Set(['__proto__','prototype','constructor']);
criticalFields.add('sourceLordKnight');
criticalFields.add('sourceRuneSlayer');
criticalFields.add('sourceRuneSlayerHitReceipts');
criticalFields.add('sourceReflectionNotice');
criticalFields.add('sourceVeteranCommander');
criticalFields.add('sourceInfinitySword');
criticalFields.add('sourceBladeMaster');
criticalFields.add('sourceHitCountByte');
criticalFields.add('sourceLegacyFireStores');
for(const key of ['sourcePendingState','sourceStateRequestByte','sourceAppliedStateByte'])criticalFields.add(key);
criticalFields.add('sourceElesisFireAbsorbNotice');
criticalFields.add('sourceAddMoonlightNotice');
criticalFields.add('sourceForceFingerResourceNumbers');
criticalFields.add('sourceFacingHistory');
criticalFields.add('sourceAddPrismEndpoints');
for(const key of elesisOwnerFields)criticalFields.add(key);
for(const field of ['sourceAdd','sourceAddNative','sourceAddMovement','sourceAddCombat','sourceAddSummon','sourceTimeRing','sourceTimeSickness','sourceTimeRingNotice','sourceAddTargetNotice','sourceAddDroneMark','sourceAddStigma','sourceAddStigmaNotice','sourceAddFantasyTracer'])criticalFields.add(field);
criticalFields.add('standupAttackNoDown');
// These owner fields have explicit delete lifecycles in enter/landing,
// Shadow Step, platform input and stopSkillEffectGroup. Absence in a full
// owner report means ended; frozen configuration and room fields are separate.
const deletedLifecycleFields=['sourceStopQueues','sourceShadowStep','sourceMegaDrill','sourceMegaDrillNowSupported','sourceAddPrismEndpoints',
  'sourceStatusClock','sourceElesisFireAbsorbNotice','sourceAddMoonlightNotice','sourceForceFingerResourceNumbers','sourceLegacyFireStores','sourcePendingState',
  'skillSuperArmorNotRed','skillDownAccel','platformAttackInput','sourceReflectionNotice',
  'sourceCustomStateEffectGroup','sourceWildChargeEffectGroup','sourceAwakeningAuraEffectGroup','sourceWayOfSwordEffectGroup',
  'sourceElesisEndurance','sourceElesisBurst','sourceElesisBloodCutterRequests','sourceElesisFirewallRequests','sourceAddNative','sourceAddMovement','sourceAddCombat','sourceAddSummon','sourceTimeRing','sourceTimeSickness','sourceTimeRingNotice','sourceAddTargetNotice','sourceAddDroneMark','sourceAddStigma','sourceAddStigmaNotice','sourceAddFantasyTracer'];
export function clearAbsentOwnedLifecycleFields(actor,source){
  for(const key of deletedLifecycleFields)if(!Object.hasOwn(source,key))delete actor[key];
  return actor;
}
export function mergeOwnedActionActor(current,captured){
  // A critical sample cannot inherit a later skill's transient lifecycle.
  // Fields carried by the sample still retain their captured source clock.
  return clearAbsentOwnedLifecycleFields({...current,...captured},captured);
}
export function ownedAttackKey(profile,actor){
  const raw=profile.states?.[actor.state]?.raw;
  const stage=[106,107,115].includes(profile.target?.unitClass)&&actor.state==='RSI_DASH_COMBO_X'&&raw?.DAMAGEDATA_CHANGE_TIME!=null?(actor.animationTime>=raw.DAMAGEDATA_CHANGE_TIME?1:0)
    :actor.state==='RSI_A_RF_MEGADRILL_BREAK'?actor.sourceMegaDrill?.damageStage??0:lordKnightCharacterAttackStage(profile,actor);
  return actor.state+':'+actor.stateSerial+':'+stage;
}
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function jsonValue(value,depth=0){
  if(depth>18)throw new TypeError('owner-state-too-deep');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('invalid-owner-number');return;}
  if(typeof value==='string'){if(value.length>512)throw new TypeError('owner-string-too-long');return;}
  if(Array.isArray(value)){if(value.length>512)throw new TypeError('owner-array-too-long');for(const item of value)jsonValue(item,depth+1);return;}
  if(!plain(value)||Object.keys(value).length>512)throw new TypeError('invalid-owner-object');
  for(const [key,item] of Object.entries(value)){if(forbidden.has(key)||key.length>128)throw new TypeError('invalid-owner-key');jsonValue(item,depth+1);}
}
const copy=value=>{
  const kind=typeof value;
  return value===null||kind!=='object'&&kind!=='function'&&kind!=='symbol'?value:structuredClone(value);
};
// These keys document source provenance in local simulation/evidence only.
// No combat or renderer branch consumes them from actor/effect instances.
// In particular, repeated historical action/effect anchors need no copies of
// the same long reference strings in every reliable hit sample.
const localProvenance=new Set(['evidence','evidenceClass','targetClientMeasured','targetBindingVerified','sourceCommit','validation']);
function wireClone(value){return JSON.parse(JSON.stringify(value,(key,item)=>localProvenance.has(key)?undefined:item));}
const number=Number.isFinite;
const bool=value=>typeof value==='boolean';
const text=value=>typeof value==='string';
const integer=value=>Number.isSafeInteger(value);
const nullable=check=>value=>value===null||check(value);
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(number);
const list=check=>value=>Array.isArray(value)&&value.every(check);
const playbackKeys=new Set(['LEFT','RIGHT','UP','DOWN','Z','X','AWAKEN','Q','W','E','R','A','S','D','C','SPECIAL']);
/** Negotiated local playback is distinct from historical collision samples.
 * Held keys are state, not a replayable pressed-edge history. */
export function validateCombatPlayback(value){
  if(!plain(value)||Object.keys(value).some(key=>!['version','start','held'].includes(key))||value.version!==1||typeof value.start!=='boolean'||
    value.held!==undefined&&(!Array.isArray(value.held)||value.held.length>playbackKeys.size||new Set(value.held).size!==value.held.length||
      value.held.some(key=>typeof key!=='string'||!playbackKeys.has(key))))throw new TypeError('invalid-owner-combat-playback');
  return copy(value);
}
const dictionary=check=>value=>plain(value)&&Object.values(value).every(check);
/** Confirmed observed contact anchors. Optional position samples name the
 * bounded source poses used by rendering; no arbitrary historical search. */
export function validateOwnedTargetViews(value){
  if(!Array.isArray(value)||value.length>5)throw new TypeError('invalid-owner-target-views');
  const ids=new Set();for(const view of value){
    if(!plain(view)||Object.keys(view).some(key=>!['playerId','epoch','frameSeq','position','positionSamples','bodyPushFrames'].includes(key))||
      !text(view.playerId)||!view.playerId||view.playerId.length>128||ids.has(view.playerId)||
      !integer(view.epoch)||view.epoch<0||!integer(view.frameSeq)||view.frameSeq<0||!vector(view.position))
      throw new TypeError('invalid-owner-target-views');
    if(view.positionSamples!==undefined){
      const samples=view.positionSamples;
      if(!Array.isArray(samples)||samples.length<2||samples.length>4||samples.some((sample,index)=>
        !plain(sample)||Object.keys(sample).some(key=>!['frameSeq','weight'].includes(key))||
        !integer(sample.frameSeq)||sample.frameSeq<0||!number(sample.weight)||sample.weight<=0||sample.weight>1||
        index>0&&sample.frameSeq<=samples[index-1].frameSeq)||
        !samples.some(sample=>sample.frameSeq===view.frameSeq)||
        samples.at(-1).frameSeq-samples[0].frameSeq>30||
        Math.abs(samples.reduce((sum,sample)=>sum+sample.weight,0)-1)>1e-7)
        throw new TypeError('invalid-owner-target-views');
    }
    if(view.bodyPushFrames!==undefined){
      const frames=view.positionSamples?.map(sample=>sample.frameSeq)??[view.frameSeq];
      if(!Array.isArray(view.bodyPushFrames)||view.bodyPushFrames.length<1||view.bodyPushFrames.length>4||
        view.bodyPushFrames.some((frame,index)=>!integer(frame)||frame<0||index>0&&frame<=view.bodyPushFrames[index-1]||!frames.includes(frame)))
        throw new TypeError('invalid-owner-body-push-witness');
    }
    ids.add(view.playerId);
  }
  return copy(value);
}
function fields(value,required,optional={}){
  return plain(value)&&Object.entries(required).every(([key,check])=>Object.hasOwn(value,key)&&check(value[key]))
    &&Object.entries(optional).every(([key,check])=>!Object.hasOwn(value,key)||check(value[key]));
}
const checked=validate=>value=>{try{return validate(value)===true;}catch{return false;}};
const addPhaseShape=value=>value===null||fields(value,{position:vector,remaining:n=>number(n)&&n>0&&n<=8.8,
  group:n=>integer(n)&&n>=0,skillId:n=>[29201,29216].includes(n)})&&Object.keys(value).every(k=>['position','remaining','group','skillId'].includes(k));
const addStasisShape=value=>value===null||fields(value,{remaining:n=>number(n)&&n>=0&&n<=15,
  hitValue:nonnegative,damageValue:nonnegative,group:n=>integer(n)&&n>=0,skillId:n=>n===29007,powerMultiplier:nonnegative})&&
  Object.keys(value).every(k=>['remaining','hitValue','damageValue','group','skillId','powerMultiplier'].includes(k));
const addCombatShape=value=>fields(value,{pulseCount:n=>integer(n)&&n>=0&&n<=8,
  pulseOrder:n=>Array.isArray(n)&&(n.length===0||n.length===6&&new Set(n).size===6&&n.every(i=>integer(i)&&i>=1&&i<=6)),
  stormDuration:n=>number(n)&&n>=.8&&n<=2.8},{nasodTargetId:nullable(n=>text(n)&&n.length>0&&n.length<=128),nasodFlag:bool,
  stormSize:n=>number(n)&&n>=1&&n<=1.9300001,xxzzLoops:n=>integer(n)&&n>=0&&n<=9,commandChargeTime:n=>number(n)&&n>=0&&n<=3,commandTargetId:nullable(n=>text(n)&&n.length>0&&n.length<=128),predictionRequest:checked(validateAddDePhysicalRequest),voidMaintenanceFailed:bool,spaceCrack:checked(validateAddSpaceCrack),magnetron:v=>fields(v,{power:nonnegative,ready:n=>number(n)&&n>=0&&n<=.3000001}),maximumStrike:validateMaximumStrikeActor,moonlight:checked(validateAddMoonlightState),phase:addPhaseShape,stasis:addStasisShape,outputExchangeFactor:n=>[356,357].includes(n)})
  &&Object.keys(value).every(key=>['pulseCount','pulseOrder','stormDuration','stormSize','xxzzLoops','commandChargeTime','commandTargetId','predictionRequest','voidMaintenanceFailed','spaceCrack','magnetron','maximumStrike','moonlight','nasodTargetId','nasodFlag','phase','stasis','outputExchangeFactor','panzer','lpZxTarget'].includes(key))
  &&(value.panzer===undefined||checked(validateAddPanzerState)(value.panzer))
  &&(value.lpZxTarget===undefined||checked(validateLPZxCapture)(value.lpZxTarget));
const objectOrNull=nullable(plain);
const idOrNull=nullable(value=>integer(value)&&value>=0);
const stringOrNull=nullable(text);
const effectGroups=list(value=>fields(value,{id:integer,name:text},{setName:stringOrNull}));
const tuple=(length)=>value=>Array.isArray(value)&&value.length===length&&value.every(number);
const coreHelper=value=>fields(value,{}, {scale:number,guardAnimation:bool,offset:vector,outlineColor:tuple(4),attackTime:tuple(2)});
const binary32=value=>number(value)&&Number.isFinite(Math.fround(value));
const vector32=value=>vector(value)&&value.every(binary32);
const arcHandle=value=>integer(value)&&value>0&&value<=0xffffffff;
const arcShape=value=>fields(value,{cooldown:binary32,nextHandle:n=>arcHandle(n)&&n<=0xfffffffb,effectIds:dictionary(arcHandle),
  data:list(row=>fields(row,{handle:arcHandle,offsetPosition:vector32,offsetRotation:vector32})),
  effects:list(row=>fields(row,{handle:arcHandle,name:n=>arcDamageNames.has(n),alive:bool,hasMesh:bool,position:vector32,rotation:vector32,
    moveAxis:vector32,power:binary32,landY:binary32,animationResetTime:binary32,lockOnUnitUID:n=>integer(n)&&n>=0&&n<=0xffffffff,
    lockOnNPCUID:n=>integer(n)&&n>=-1&&n<=0x7fffffff,dirSpeed:binary32,nowLifeTime:binary32,maxLifeTime:binary32,
    attackTime:n=>tuple(2)(n)&&n.every(binary32)}))})&&value.data.length<=4&&value.effects.length<=8
  &&new Set(value.effects.map(row=>row.handle)).size===value.effects.length
  &&new Set(value.data.map(row=>row.handle)).size===value.data.length
  &&value.effects.every(row=>row.handle<value.nextHandle)
  &&value.data.every(row=>value.effects.some(effect=>effect.handle===row.handle));
// ChangeAnim retains a controller pose object when an interrupted incoming
// track still has zero weight. It is not a list of weighted display tracks.
// Match resolveControllerPose's bounded recursion before any host consumer can
// sample a malformed or cyclic retained controller supplied over the wire.
const MAX_RETAINED_POSE_DEPTH=8;
const nonnegative=value=>number(value)&&value>=0;
const phantomAnchor=value=>fields(value,{position:vector,rotation:vector,facing:v=>v===1||v===-1,matrix:tuple(16)});
const phantomAttack=value=>fields(value,{state:text,serial:v=>integer(v)&&v>=0,facing:v=>v===1||v===-1,
  speed:v=>number(v)&&v>0,start:nonnegative,end:nonnegative});
const phantomState=value=>fields(value,{effectId:v=>integer(v)&&v>0,centerId:v=>integer(v)&&v>0,time:nonnegative,
  matrixQueue:list(v=>fields(v,{time:nonnegative,anchor:phantomAnchor})),attacks:list(phantomAttack),currentAttack:nullable(phantomAttack)});
const serial=value=>integer(value)&&value>=0;
const ownerBoneTargets={...LK_BONE_TARGETS,...ELESIS_BONE_TARGETS,...ADD_BONE_TARGETS,...ADD_ANALYSIS_BONE_TARGETS,...ADD_COMMON_BONE_TARGETS};
function transitionShape(value,depth=0){
  if(depth>MAX_RETAINED_POSE_DEPTH)return false;
  return fields(value,{serial:integer,fromName:text,fromTime:nonnegative,fromLoop:bool,
    fromSpeed:nonnegative,fromWeight:v=>number(v)&&v>=0&&v<=1,fromApplyMotionOffset:bool,
    durationSeconds:v=>number(v)&&v>0,elapsedSeconds:nonnegative,enabled:bool},
    {retainedPose:nullable(pose=>retainedPoseShape(pose,depth+1))});
}
function retainedPoseShape(value,depth){
  if(depth>MAX_RETAINED_POSE_DEPTH)return false;
  return fields(value,{animationName:text,animationTime:nonnegative,animationLoop:bool,
    presentationTransition:nullable(transition=>transitionShape(transition,depth))});
}
function buffShape(value){
  if(!fields(value,{schemaVersion:v=>v===1,templateId:integer,skillLevel:integer,accumulationLimit:integer,
    resistance:number,durationMultiplier:number,behaviors:Array.isArray,finalizers:Array.isArray,displayer:plain},
    {sourceActorId:stringOrNull,targetActorId:stringOrNull,factorId:idOrNull,accumulationCount:v=>integer(v)&&v>=1&&v<=value.accumulationLimit}))return false;
  if(!value.behaviors.every(row=>fields(row,{type:integer,kind:text})))return false;
  const immediateMp=value.templateId===20&&value.accumulationLimit===0&&value.behaviors.length===1&&
    value.finalizers.length===1&&value.finalizers[0]?.kind==='immediate';
  for(const row of value.behaviors){
    if(!['empty','dashBlock','manaBreakBlock','stun','superArmor','stat','hpInterval','mpInterval','onHitBuffFactor','absorbMagicProjectile','finishOtherBuffs','elementAttackRate','normalHpDrain','normalHitBuff','skillCooldown','phantomSword','ignoreDefence','elesisDoubleAttack','elesisUnsupported','elesisImmediateKnockdown','attackByType','addDpGain','sourceCallback','attackBlock','neverMove'].includes(row.kind))return false;
    if(row.kind==='attackBlock'&&!fields(row,{}))return false;
    if(row.kind==='neverMove'&&!fields(row,{position:vector,gravity:v=>v===false}))return false;
    if(row.kind==='sourceCallback'&&!fields(row,{sourceBehavior:v=>['BBT_CUSTOM_FUNCTION','BBT_EFFECT_SET_WITH_DAMAGE'].includes(v)}))return false;
    if(row.kind==='attackByType'&&!fields(row,{attackTypes:list(v=>[0,1,2].includes(v)),multiplier:v=>number(v)&&v>0}))return false;
    if(row.kind==='elesisDoubleAttack'&&!fields(row,{chance:nonnegative}))return false;
    if(row.kind==='elesisUnsupported'&&!fields(row,{sourceBehavior:text,reason:text}))return false;
    if(row.kind==='elesisImmediateKnockdown'&&!fields(row,{value:number}))return false;
    if(row.kind==='addDpGain'&&!fields(row,{value:n=>number(n)&&n>=1&&n<=1.4,changeType:n=>n===3}))return false;
    if(row.kind==='onHitBuffFactor'&&!fields(row,{factorId:integer,skillId:integer}))return false;
    if(row.kind==='absorbMagicProjectile'&&!fields(row,{mp:nonnegative}))return false;
    if(row.kind==='finishOtherBuffs'&&!fields(row,{templateIds:list(integer)}))return false;
    if(row.kind==='elementAttackRate'&&!fields(row,{element:text,value:number}))return false;
    if(row.kind==='stat'&&!fields(row,{value:number,changeType:v=>[0,1,3].includes(v),stat:v=>['mpMax','physicalAttack','magicAttack','criticalRate','criticalAttack','finalDefenceMultiplier','finalDamageMultiplierMelee','finalDamageMultiplierRange','physicalDefence','magicDefence','moveSpeedMultiplier','jumpSpeedMultiplier','animationSpeedMultiplier','accuracy','avoidance','enchantAttackRate','everyAttributeDefence','hitMeleeMpMultiplier','hitRangeMpMultiplier','receivedMpMultiplier','additionalAttackPercent','forceDownMultiplierMelee','forceDownMultiplierRange'].includes(v)}))return false;
    if(['hpInterval','mpInterval'].includes(row.kind)&&!fields(row,{value:number,changeType:v=>[1,2,3].includes(v),interval:v=>number(v)&&(v>0||v===0&&row.kind==='mpInterval'&&(immediateMp||[97,98].includes(value.templateId)&&value.accumulationLimit===0&&value.finalizers.some(f=>f.kind==='immediate'))),sum:number}))return false;
    if(row.kind==='normalHpDrain'&&!fields(row,{value:number}))return false;
    if(row.kind==='normalHitBuff'&&!fields(row,{factorId:integer,sourceSkillId:integer}))return false;
    if(row.kind==='skillCooldown'&&!fields(row,{skillType:integer,value:number}))return false;
    if(Object.hasOwn(row,'identityCleared')&&!bool(row.identityCleared))return false;
  }
  return value.finalizers.every(row=>fields(row,{kind:v=>['time','immediate','hit','received','state','hp','hyper'].includes(v),remaining:number},
    {sourceDuration:number,stateSerial:v=>integer(v)&&v>=0,criterion:nonnegative,passUp:bool,forceEnd:bool,
      sourceByteEnd:v=>integer(v)&&v>=0&&v<=510,sourceByteBaseline:v=>integer(v)&&v>=0&&v<=255})&&
    (row.sourceByteEnd===undefined&&row.sourceByteBaseline===undefined||value.templateId===408&&row.kind==='hit'&&integer(row.sourceByteEnd)&&integer(row.sourceByteBaseline))&&
    (row.kind!=='time'||number(row.sourceDuration))&&(row.kind!=='state'||integer(row.stateSerial)&&row.stateSerial>=0)&&(row.kind!=='hp'||number(row.criterion)&&row.criterion<=1&&bool(row.passUp))&&
    (row.forceEnd===undefined||row.kind==='hyper')&&
    (row.kind!=='hyper'||value.templateId===530&&value.factorId===619&&[0,1].includes(row.remaining)&&bool(row.forceEnd)));
}
/** Share the full owner Buff/container contract with the independent status
 * domain. Status never carries pose, commands or combat resource results. */
export function validateOwnedStatusActor(value,frameSeq,{clock=true}={}){
  const allowed=new Set(['buffs','invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed','forceInvincible',...(clock?['sourceStatusClock']:[])]);
  if(!plain(value)||Object.keys(value).some(key=>!allowed.has(key))||!fields(value,
    {buffs:list(buffShape),invincible:bool,superArmor:bool,superArmorNotRed:bool},
    {showInvincible:validInvulnerabilityDisplay,skillSuperArmorNotRed:bool,forceInvincible:n=>number(n)&&n>=0}))
    throw new TypeError('invalid-owner-status-actor');
  if(clock){if(!Object.hasOwn(value,'sourceStatusClock'))throw new TypeError('missing-owner-status-clock');validateSourceStatusClock(value.sourceStatusClock,frameSeq);}
  jsonValue(value);return true;
}
/** Exact container types are part of this Web wire contract. Generic JSON
 * validity does not make a value safe for native/host consumers. Signed clocks
 * stay finite but are not clamped: native float subtraction may cross zero. */
function validateStopProjections(state){
  for(const key of ['hitStop','worldStop'])if(Object.hasOwn(state,key)&&
    (!number(state[key])||state[key]<0||state[key]>3600))throw new TypeError('invalid-owner-stop-projection:'+key);
}
function actorShape(state){
  const required={
    landPosition:vector,motionMoveNow:v=>fields(v,{x:number,z:number}),
    awakening:v=>fields(v,{orbs:n=>integer(n)&&n>=0&&n<=3,gauge:number,remaining:number,full:bool,
      pendingOrbs:n=>integer(n)&&n>=0&&n<=3,pendingAvailableOrbs:n=>integer(n)&&n>=0&&n<=3},{reawakening:bool}),
    core:v=>fields(v,{phase:n=>['absent','idle','prepare','attack','guard'].includes(n),gauge:number,level:number,
      phaseTime:number,targetId:stringOrNull,x:number,y:number,z:number,hit:bool,attackLevel:number,
      guardRemaining:number,parrying:bool,canParry:bool,helperLive:bool,animationName:text,animationTime:number},
      {hits:dictionary(number),hitGaps:dictionary(number),helper:coreHelper,rotation:vector,attackElapsed:number,delayElapsed:number,
        dirSpeed:number,useManualDir:bool,unlockRemaining:number,manualDirDegree:vector}),
    cooldowns:dictionary(number),hits:dictionary(number),tapTimes:dictionary(number),tapReleased:dictionary(bool),
    fired:list(v=>text(v)||integer(v)),pendingPressed:list(text),doubleHeldDirections:list(v=>['LEFT','RIGHT'].includes(v)),
    effectiveBlackHoleIds:list(integer),blackHoleDisplacement:vector,
    knockdown:v=>fields(v,{now:number,max:number,pending:nullable(number),addedThisState:bool,lastDamageSeconds:number,activated:bool}),
    manaBreak:v=>fields(v,{charge:number,maxCharge:number,minimumCharge:number,availableMax:number,pendingCost:number,
      active:bool,canCharge:bool,noDetonation:bool,damageReactPending:bool},
      {holdIntent:v=>fields(v,{z:n=>number(n)&&n>=0&&n<=MANA_BREAK_HOLD_SECONDS,x:n=>number(n)&&n>=0&&n<=MANA_BREAK_HOLD_SECONDS}),
       pendingDown:v=>fields(v,{state:n=>['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE'].includes(n),vy:number})}),
    buffs:list(buffShape),buffControls:v=>fields(v,{inputBlock:bool,dashBlock:bool}),
  };
  const optional={passiveSpeed:v=>fields(v,{x:number,y:number}),hitGaps:dictionary(number),lineId:idOrNull,lastTouchLineId:idOrNull,ignoreLineId:idOrNull,
    sourceAdd:checked(validateAddState),sourceAddNative:checked(validateAddNativeState),sourceAddMovement:validateAddMovement,sourceAddCombat:addCombatShape,sourceAddSummon:checked(validateAddSummonState),
    sourceTimeRing:checked(value=>validateAddTimeRingState({sourceTimeRing:value})),
    sourceTimeSickness:v=>number(v)&&v>=0&&v<=120,
    sourceTimeRingNotice:checked(validateAddTimeRingNotice),
    sourceAddTargetNotice:checked(validateAddTargetNotice),
    sourceElesisFireAbsorbNotice:checked(validateElesisFireAbsorbNotice),
    sourceAddMoonlightNotice:checked(validateAddMoonlightNotice),
    sourceAddDroneMark:checked(validateAddDroneMarkState),
    sourceAddStigma:checked(validateAddStigmaState),
    sourceAddStigmaNotice:checked(validateAddStigmaNotice),
    sourceAddFantasyTracer:checked(validateAddFantasyTracerState),
    downAttackChoice:validStandupAttackChoice,standupAttackNoDown:validStandupAttackNoDown,
    destructionRageRemaining:v=>number(v)&&v>=0&&v<=6,
    sourceWayOfSwordEffectGroup:effectGroups,
    wayOfSword:v=>fields(v,{point:number,state:n=>integer(n)&&n>=-2&&n<=2}),
    skillId:idOrNull,skillContext:objectOrNull,buffered:stringOrNull,soundSet:nullable(value=>text(value)||plain(value)),
    sourceBlackHoleCanPass:nullable(bool),death:nullable(bool),deathPresentation:objectOrNull,
    presentationTransition:nullable(transitionShape),
    showInvincible:validInvulnerabilityDisplay,
    sourceStatusClock:checked(validateSourceStatusClock),forceInvincible:n=>number(n)&&n>=0,
    animationSpeedRamp:nullable(v=>fields(v,{elapsedSeconds:number,durationSeconds:number},{initialSpeed:number})),
    pendingPlatformJump:nullable(v=>fields(v,{lineId:integer,x:number,y:number},{absolute:bool})),
    mapMechanics:v=>fields(v,{portalLineId:idOrNull,portalElapsed:nonnegative,portalReady:bool,bungeeLineId:idOrNull,bungeeElapsed:nonnegative,
      returnSerial:serial,portalSerial:serial,lockRemaining:nonnegative,
      portalNotice:nullable(v=>fields(v,{serial,lineId:serial,position:vector,age:nonnegative})),
      lastReturn:nullable(v=>fields(v,{serial,fromLineId:serial,toLineId:serial,hpBefore:nonnegative,hpAfter:nonnegative}))}),
    sourceShadowStep:v=>fields(v,{range:nonnegative,remaining:nonnegative,lastX:number,
      key:key=>text(key)||key===null&&state.skillId===24217&&state.skillContext?.key===null&&state.sourceBladeMaster?.escapeCooldown>0,
      skillId:integer,enhanced:bool,returnUsed:bool,stage:text,stageElapsed:nonnegative},{lastZ:number,evidenceClass:text})
      &&(v.key!==null||v.skillId===24217&&v.enhanced),
    sourceArcEnemy:nullable(arcShape),
    sourceForceFingerResourceNumbers:checked(validateForceFingerResourceNumbers),
    sourceFacingHistory:v=>fields(v,{previous:n=>n===1||n===-1,current:n=>n===1||n===-1})&&Object.keys(v).length===2,
    sourceAddPrismEndpoints:checked(validateAddPrismEndpoints),
    sourceMegaDrill:nullable(v=>fields(v,{nowSpeedX:number,dashSpeed:number,damageChangeTime:number,hitGap:number,backSpeedX:number,
      reAttack:bool,lhandEnabled:bool,swordEnabled:bool,luaTableOpen:bool,particleExists:bool,meshExists:bool,
      particleHandle:integer,meshHandle:integer,createdParticleHandle:integer,createdMeshHandle:integer,
      hitListSize:integer,damageStage:integer,handPosition:vector})),
    sourceWildCharge:nullable(v=>fields(v,{afterFull:number,sourceChargeEquivalent:number,previousHp:number})),
    sourceXCrash:nullable(v=>fields(v,{savedPosition:vector})),
    sourceHitCountByte:v=>integer(v)&&v>=0&&v<=255,
    sourceStateRequestByte:v=>integer(v)&&v>=0&&v<=255,
    sourceAppliedStateByte:v=>integer(v)&&v>=0&&v<=255,
    sourcePendingState:checked(validateSourcePendingState),
    sourceLegacyFireStores:checked(validateLegacyFireStores),
    sourceLordKnight:v=>fields(v,{autoGuardCooldown:nonnegative},{charge:nonnegative,rollingDuration:nonnegative,
      revengePower:nonnegative,counterLaunch:bool,megaEffects:list(v=>integer(v)&&v>0),windmillEffects:list(v=>integer(v)&&v>0),windmillDelta:nonnegative}),
    sourceElesisBreakCharge:v=>number(v)&&v>=0&&v<=2000,
    sourceElesisGaleHits:serial,
    sourceElesisComboRemaining:v=>number(v)&&v>=0&&v<=Math.fround(1.3),
    sourceElesisCommand:v=>fields(v,{loops:n=>integer(n)&&n>=0&&n<=5,requestedLoops:n=>integer(n)&&n>=0&&n<=5}),
    sourceElesisEndurance:v=>fields(v,{upgraded:bool,skillId:n=>[28201,28218].includes(n),level:n=>integer(n)&&n>=1}),
    sourceElesisBurst:v=>fields(v,{chivalry:bool}),
    sourceElesisBloodCutterRequests:v=>validateBloodCutterRequests({sourceElesisBloodCutterRequests:v}),
    sourceElesisFirewallRequests:v=>Array.isArray(v)&&v.length>0&&v.length<=4&&v.every(plain),
    sourceElesisSkills:v=>fields(v,{charge:nonnegative,loopTime:nonnegative,loops:serial,hit:bool,dodges:serial,rushes:serial,
      mpPaid:nonnegative,stigmaCooldown:nonnegative,chivalryTime:nonnegative},
      {bloodDrain:nonnegative,angle:n=>number(n)&&n>=-45&&n<=0,danceTargets:list(text),danceTargetId:stringOrNull,
        dodgeRefunded:bool,blossomCooldown:nonnegative,overflowCleanseCooldown:nonnegative,overflowRefresh:nonnegative,
        judgmentCharge:n=>number(n)&&n>=0&&n<=2,leapFromDash:bool,dashAccumulator:nonnegative,
        drasticEffects:list(n=>integer(n)&&n>0),dreadEffects:list(n=>integer(n)&&n>0),extinctionEffects:list(n=>integer(n)&&n>0),
        juggernautEffects:list(n=>integer(n)&&n>0),stigmaEffects:list(n=>integer(n)&&n>0),roseId:n=>integer(n)&&n>0}),
    sourceInfinitySword:v=>fields(v,{comboLoops:v=>integer(v)&&v>=0,cruelHits:v=>integer(v)&&v>=0,
      cruelCooldown:nonnegative,suddenCooldown:nonnegative,brutalCooldown:nonnegative,lightningTime:nonnegative},
      {shieldEffectIds:list(v=>integer(v)&&v>0),swordFallEffectIds:list(nullable(v=>integer(v)&&v>0)),
        blastingEffectIds:list(v=>integer(v)&&v>0),harshEffectId:v=>integer(v)&&v>0,phantomSheathId:v=>integer(v)&&v>0,finalStrikeEffectId:v=>integer(v)&&v>0,
        swordFallAnchor:v=>fields(v,{position:vector,rotation:vector,facing:v=>v===1||v===-1}),
        finalStrikeAnchor:v=>fields(v,{position:vector,rotation:vector,facing:v=>v===1||v===-1}),phantomSword:phantomState,pendingDoubleX:bool}),
    sourceRuneSlayer:v=>fields(v,{groundRuneCreated:bool,airRuneCreated:bool,groundEffects:list(v=>integer(v)&&v>0),airEffects:list(v=>integer(v)&&v>0),enchantCooldown:nonnegative}),
    sourceRuneSlayerHitReceipts:dictionary(v=>fields(v,{epoch:v=>integer(v)&&v>=0,serial:v=>integer(v)&&v>=0},
      {targetEpoch:v=>integer(v)&&v>=0,casts:dictionary(row=>fields(row,{hp:bool,mp:bool})&&(row.hp||row.mp))})&&
      (v.casts===undefined?v.targetEpoch===undefined:v.targetEpoch!==undefined&&Object.keys(v.casts).every(key=>
        /^(0|[1-9][0-9]*)$/.test(key)&&Number.isSafeInteger(Number(key))&&Number(key)<=v.serial))),
    sourceReflectionNotice:v=>fields(v,{serial:v=>integer(v)&&v>0,position:vector,landY:number,particles:bool,remaining:v=>number(v)&&v>=0&&v<=.5}),
    sourceBladeMaster:v=>fields(v,{loops:v=>integer(v)&&v>=0,commandPresses:v=>integer(v)&&v>=0,
      blackHoleCount:v=>integer(v)&&v>=0,blackHoleRemaining:nonnegative,winHits:v=>integer(v)&&v>=0,
      winCooldown:number,escapeCooldown:nonnegative,extremeElapsed:nonnegative,
      extremeLifted:bool,extremeHidden:bool,missRefunded:bool},{blackHoleEffectIds:list(v=>integer(v)&&v>0)}),
    sourceVeteranCommander:v=>fields(v,{loop:nonnegative,maxLoop:nonnegative,presses:nonnegative,overheated:bool,previousHp:nonnegative,
      heatEffects:list(v=>integer(v)&&v>0),spotsLeft:list(v=>[150,375,600].includes(v)),spotsRight:list(v=>[150,375,600].includes(v))},{flameEffect:v=>integer(v)&&v>0,
      overheatCostBudget:v=>fields(v,{castStep:nonnegative,skillId:nonnegative,layerKey:text,spent:nonnegative}),
      airFollowupNoLift:bool,
      overheatIconSize:v=>integer(v)&&v>=-1&&v<=3,
      overheatNotice:v=>fields(v,{serial:v=>integer(v)&&v>0,size:v=>integer(v)&&v>=0&&v<=3,position:vector,direction:vector,remaining:v=>number(v)&&v>=0&&v<=.5})}),
    sourceWildChargeEffectGroup:effectGroups,sourceAwakeningAuraEffectGroup:effectGroups,
    sourceCustomStateEffectGroup:effectGroups,sourceDashJumpEffectGroup:effectGroups,
    additionalDamageEffect:objectOrNull,sourceCommandHandPosition:nullable(vector),sourceCommandDirection:nullable(vector),
  };
  if(!fields(state,required,optional)){
    const field=Object.entries(required).find(([key,check])=>!Object.hasOwn(state,key)||!check(state[key]))?.[0]
      ??Object.entries(optional).find(([key,check])=>Object.hasOwn(state,key)&&!check(state[key]))?.[0];
    throw new TypeError('invalid-owner-actor-shape:'+field);
  }
  if(state.buffs?.some(buff=>buff.finalizers?.some(row=>row.sourceByteEnd!==undefined))&&
    (!integer(state.sourceHitCountByte)||state.sourceHitCountByte<0||state.sourceHitCountByte>255))
    throw new TypeError('invalid-owner-hit-counter-byte');
  for(const key of ['animationLoop','animationStopped','applyMotionOffset','consumeRootTranslation','rootMotionEnabled',
    'jumpAttackDown','reAttackZ1Right','grounded','invincible','superArmor','superArmorNotRed','limitCrusherCharging',
    'downForce','jumpOnLanding','lastAttackerFront','hidden','deathComplete','sourceMegaDrillNowSupported',
    'skillDisableGravity','skillSuperArmorNotRed'])if(Object.hasOwn(state,key)&&!bool(state[key]))throw new TypeError('invalid-owner-actor-shape');
  for(const key of ['vz','stateSerial','animationBeforeTime','animationOneshotTimer','animationPlaybackSpeed',
    'animationTransitionSerial','canNotJumpTime','sourceCommandFlags','canNotAttackTime','reAttackZ1Time',
    'sourceDashJumpEffectHandle','hitStop','worldStop','dropRemaining','skillScale','flyCount','deathAlpha',
    'skillDownAccel','animationSpeedOverride','animationTargetSpeed'])
    if(Object.hasOwn(state,key)&&!number(state[key]))throw new TypeError('invalid-owner-actor-shape:'+key);
  validateStopProjections(state);
}
// Keep every schema, JSON-tree and byte bound on recursive action samples.
// Their return values were discarded; cloning each nested report only added
// work. The public boundary detaches the complete validated packet once.
function inspectOwnedState(value){
  if(!plain(value)||Object.keys(value).some(key=>!['protocol','epoch','frameSeq','actor','effects','hits','actions','actionFrontierComplete'].includes(key))
    ||value.protocol!==OWNERSHIP_PROTOCOL||!Number.isSafeInteger(value.epoch)||value.epoch<0
    ||!Number.isSafeInteger(value.frameSeq)||value.frameSeq<0||!plain(value.actor)
    ||Object.keys(value.actor).some(key=>!actorFields.has(key))||!Array.isArray(value.effects)||value.effects.length>MAX_OWNER_EFFECTS
    ||!Array.isArray(value.hits)||value.hits.length>128
    ||value.actionFrontierComplete!==undefined&&typeof value.actionFrontierComplete!=='boolean')throw new TypeError('invalid-owner-state');
  for(const field of ['x','y','z','vx','vy','hp','mp','stateTime','animationTime'])if(!Number.isFinite(value.actor[field]))throw new TypeError('invalid-owner-actor');
  if(typeof value.actor.state!=='string'||value.actor.state.length>100||![1,-1].includes(value.actor.facing))throw new TypeError('invalid-owner-actor');
  actorShape(value.actor);
  if(value.actor.sourceStatusClock!==undefined)validateSourceStatusClock(value.actor.sourceStatusClock,value.frameSeq);
  if(value.actions!==undefined){
    if(!Array.isArray(value.actions)||value.actions.length>16)throw new TypeError('invalid-owner-actions');
    let previous=-1;for(const action of value.actions){
      if(!plain(action)||Object.keys(action).some(key=>!['id','frameSeq','actor','effects','targetViews','playback'].includes(key))
        ||!Number.isSafeInteger(action.id)||action.id<0||action.id<=previous||!Number.isSafeInteger(action.frameSeq)||action.frameSeq<0||action.frameSeq>value.frameSeq
        ||!plain(action.actor)||Object.keys(action.actor).some(key=>!criticalFields.has(key))||!Array.isArray(action.effects))throw new TypeError('invalid-owner-actions');
      previous=action.id;
      if(action.playback!==undefined){validateCombatPlayback(action.playback);if(action.targetViews!==undefined)throw new TypeError('playback-cannot-carry-history-witness');}
      if(action.targetViews!==undefined)validateOwnedTargetViews(action.targetViews);
      inspectOwnedState({protocol:value.protocol,epoch:value.epoch,frameSeq:action.frameSeq,actor:mergeOwnedActionActor(value.actor,action.actor),effects:action.effects,hits:[]});
    }
  }
  const ids=new Set();
  const maximumOrbs=new Set();
  const shadowTargets=new Set();
  for(const effect of value.effects){
    validateAddCountdownShake(effect);
    validateAddStormEffectState(effect);
    if(!plain(effect)||!Number.isSafeInteger(effect.id)||effect.id<0||ids.has(effect.id)
      ||typeof effect.name!=='string'||effect.name.length>256||Object.keys(effect).some(key=>effectStatic.has(key)||forbidden.has(key)||key==='ownerId'||key==='sourceHitMemory2016'))throw new TypeError('invalid-owner-effect');
    ids.add(effect.id);
    validateContinuousAuraMarker(effect);
    validateAddFuryEffectState(effect,'MM');
    validateAddLockOn(effect);
    validateMaximumStrikeEffect(effect);
    validateAddFissionSplit(effect);
    validateAddMarkedDrone(effect);
    if(effect.sourceAddMaximumStrike){const key=effect.sourceAddMaximumStrike.group+':'+effect.sourceAddMaximumStrike.index;
      if(maximumOrbs.has(key))throw new TypeError('duplicate-owner-maximum-strike-orb');maximumOrbs.add(key);}
    validateElesisShadowLink(effect,'CA');
    validateBloodCutterCarrier(effect);
    if(effect.sourceElesisCommandCharge!==undefined&&(!number(effect.sourceElesisCommandCharge)||effect.sourceElesisCommandCharge<0||effect.sourceElesisCommandCharge>3))throw new TypeError('invalid-owner-elesis-command-charge');
    validateGMSpawnRotation(effect);
    validateAddStardustMesh(effect);
    if(effect.sourceElesisShadowLink){const target=effect.sourceElesisShadowLink.targetId;
      if(shadowTargets.has(target)||shadowTargets.size>=3)throw new TypeError('invalid-owner-shadow-edge-target-count');shadowTargets.add(target);}
    validateAddSummonEffectState(effect);
    validateAddSummonProjectileState(effect);
    validateAddDroneMarkEffect(effect);
    validateAddQuicksilverLinkState(effect,'LP');
    if(effect.sourceAddSummonPose!==undefined&&(effect.sourceAddSummonPose!==true||
      effect.setName!=='EffectSet_SI_HA_AMM_Apocalypse_Always'||effect.sourceAddSummonSerial===undefined||
      !plain(effect.birthAnchor)||effect.birthAnchor.customPosition!==true||!vector(effect.birthAnchor.rotation)||
      !Array.isArray(effect.birthAnchor.matrix)||effect.birthAnchor.matrix.length!==16||!effect.birthAnchor.matrix.every(Number.isFinite)||
      ['currentAnchor','sourcePosedAnchor','x','y','z'].some(key=>Object.hasOwn(effect,key))))
      throw new TypeError('invalid-owner-add-summon-pose');
    if(effect.sourceInfinityLockOn!==undefined&&!vector(effect.sourceInfinityLockOn))throw new TypeError('invalid-owner-infinity-lock-on');
    if(effect.sourceInfinityManualDirDegree!==undefined&&!vector(effect.sourceInfinityManualDirDegree))throw new TypeError('invalid-owner-infinity-lock-on');
    if(effect.sourceBlazeWingLockOn!==undefined&&!fields(effect.sourceBlazeWingLockOn,
      {targetId:nullable(text),previousHitCount:serial,unlockRemaining:number,manualDirDegree:vector,useManualDir:bool,
        historySnapshot:v=>list(text)(v)&&v.length<=6&&new Set(v).size===v.length,selectionSerial:serial}))
      throw new TypeError('invalid-owner-blaze-wing-lock-on');
    if(effect.sourceBuffFactor!==undefined&&(!integer(effect.sourceBuffFactor)||effect.sourceBuffFactor<=0))throw new TypeError('invalid-owner-infinity-buff-factor');
    if(effect.sourcePhantomSword!==undefined&&(effect.sourcePhantomSword!==true||
      !integer(effect.sourcePhantomAttackSerial)||effect.sourcePhantomAttackSerial<0||!phantomAnchor(effect.sourcePosedAnchor)))
      throw new TypeError('invalid-owner-phantom-sword');
    if(effect.sourcePhantomAttackSerial!==undefined&&effect.sourcePhantomSword!==true)throw new TypeError('invalid-owner-phantom-sword');
    if(effect.sourceISSheath!==undefined&&(effect.sourceISSheath!==true||!bool(effect.sourceISSheathFollowing)||
      !phantomAnchor(effect.sourcePosedAnchor)||!phantomAnchor(effect.currentAnchor)))throw new TypeError('invalid-owner-is-sheath');
    if(effect.sourceISSheathFollowing!==undefined&&effect.sourceISSheath!==true)throw new TypeError('invalid-owner-is-sheath');
    if(effect.sourceProfessionId!==undefined&&(!text(effect.sourceProfessionId)||!fields(effect.sourceReflection,
      {remaining:v=>integer(v)&&v>=0&&v<2,sourceActorId:text,sourceEffectId:v=>integer(v)&&v>=0,sourceEpoch:v=>integer(v)&&v>=0})||effect.sourceReflected!==true))
      throw new TypeError('invalid-owner-reflection');
    if(effect.sourceProfessionId===undefined&&(effect.sourceReflection!==undefined||effect.sourceReflected!==undefined))throw new TypeError('invalid-owner-reflection');
    if(effect.sourceDirSpeedSign!=null&&![-1,1].includes(effect.sourceDirSpeedSign))throw new TypeError('invalid-owner-effect-direction-speed');
    if(effect.sourceRuneLevel!==undefined&&(!Number.isInteger(effect.sourceRuneLevel)||effect.sourceRuneLevel<0||effect.sourceRuneLevel>3))throw new TypeError('invalid-owner-rune-level');
    if(effect.sourceVeteranAttachment!=null&&!veteranAttachmentDefinition(effect.name,effect.sourceVeteranAttachment))throw new TypeError('invalid-owner-veteran-attachment');
    if(hasVeteranTarget(effect)&&(!nullable(v=>integer(v)&&v>0)(effect.sourceVeteranTargetId)||
      !Object.hasOwn(veteranTargetSets,effect.setName)||!['SA_RVC_IGNITION_CROW_INCINERATION_P01','SA_RVC_IGNITION_CROW_INCINERATION_P02'].includes(effect.name)))
      throw new TypeError('invalid-owner-veteran-target');
    if(effect.sourceShadowMesh!=null){const m=effect.sourceShadowMesh;
      if(!fields(m,{name:text,position:vector,velocity:vector,velocityAccum:vector,gravity:vector,landY:number,
        facing:v=>v===1||v===-1,globalTime:nonnegative,nowLifeTime:nonnegative,maxLifeTime:v=>number(v)&&v>0,
        animationTime:nonnegative,animationSpeed:nonnegative,notCheckLandTime:nonnegative,elastic:number,elasticX:number,crashLand:bool},
        {literalMotion:bool,useLand:bool,rotation:vector,basis:v=>Array.isArray(v)&&v.length===3&&v.every(vector),dirSpeed:number,
          landPosition:vector,followBeforePosition:vector,followEndPending:bool,followFacing:v=>v===1||v===-1,followToggle:bool})||
        m.literalMotion&&(!m.rotation||!m.basis||typeof m.useLand!=='boolean'||!number(m.dirSpeed)))throw new TypeError('invalid-owner-mesh-motion');}
    if(effect.sourceFollowLine!=null&&!fields(effect.sourceFollowLine,
      {position:vector,facing:v=>v===1||v===-1,elasticX:number,velocity:vector,dirSpeed:number},
      {rotation:vector,basis:v=>Array.isArray(v)&&v.length===3&&v.every(vector),followBeforePosition:vector,followEndPending:bool,
        followFacing:v=>v===1||v===-1,followToggle:bool}))
      throw new TypeError('invalid-owner-follow-line');
    if(effect.traceActorId!=null&&(!text(effect.traceActorId)||effect.traceActorId.length>128||typeof effect.traceUnitDieDelete!=='boolean'))throw new TypeError('invalid-owner-effect-trace');
    for(const field of ['hits','hitGaps','childCounts'])if(Object.hasOwn(effect,field)&&!dictionary(number)(effect[field]))throw new TypeError('invalid-owner-effect-shape');
    for(const field of ['position','rotation','moveAxis','sourceArcMeshPosition'])if(Object.hasOwn(effect,field)&&effect[field]!==null&&!vector(effect[field]))throw new TypeError('invalid-owner-effect-shape:'+field);
    for(const field of ['birthAnchor','currentAnchor','sourcePosedAnchor'])if(Object.hasOwn(effect,field)&&effect[field]!==null){
      if(!fields(effect[field],{}, {position:vector,customPosition:bool,matrix:tuple(16)}))throw new TypeError('invalid-owner-effect-shape:'+field);
    }
    for(const field of ['sourceEffectSetId','sourceTargetMeshId'])if(Object.hasOwn(effect,field)&&!nullable(v=>integer(v)&&v>0)(effect[field]))throw new TypeError('invalid-owner-effect-set-target');
    for(const field of ['sourceBoneEffectSetId','sourceBoneTargetMeshId'])if(Object.hasOwn(effect,field)&&!nullable(v=>integer(v)&&v>0)(effect[field]))throw new TypeError('invalid-owner-effect-bone-target');
    if(Object.hasOwn(effect,'sourceBoneEffectSetId')||hasSetMeshBoneTarget(effect)){
      if(!Object.hasOwn(ownerBoneTargets,effect.setName)||!Object.hasOwn(effect,'sourceBoneEffectSetId')||
        hasSetMeshBoneTarget(effect)&&effect.sourceBoneTargetMeshId!==effect.sourceBoneEffectSetId||
        effect.name===ownerBoneTargets[effect.setName]&&effect.sourceBoneEffectSetId!==effect.id)
        throw new TypeError('invalid-owner-effect-bone-target');
      if(effect.active&&hasSetMeshBoneTarget(effect)&&(!effect.birthAnchor||!effect.currentAnchor))
        throw new TypeError('invalid-owner-effect-bone-anchor');
    }
    if(effect.setName===WIND_SLICER_SET&&effect.name===WIND_SLICER_CARRIER&&!Object.hasOwn(effect,'sourceEffectSetId'))throw new TypeError('invalid-owner-effect-set-target');
    if(Object.hasOwn(effect,'sourceEffectSetId')||hasSetTarget(effect)){
      if(effect.setName!==WIND_SLICER_SET||!Object.hasOwn(effect,'sourceEffectSetId')||
        hasSetTarget(effect)&&effect.sourceEffectSetId!==effect.sourceTargetMeshId||
        !hasSetTarget(effect)&&(effect.name!==WIND_SLICER_CARRIER||effect.sourceEffectSetId!==effect.id))
        throw new TypeError('invalid-owner-effect-set-target');
      for(const field of ['birthAnchor','currentAnchor','sourcePosedAnchor'])if(effect[field]!=null&&
        !fields(effect[field],{position:vector,facing:v=>v===1||v===-1},{rotation:vector}))throw new TypeError('invalid-owner-effect-set-anchor');
      if(effect.active&&(!effect.birthAnchor||!effect.currentAnchor))throw new TypeError('invalid-owner-effect-set-anchor');
      if(effect.name===WIND_SLICER_CARRIER&&effect.active&&
        (!nonnegative(effect.elapsed)||!nonnegative(effect.meshLifetimeElapsed)||!nonnegative(effect.animationTime)||
          effect.lifeTimeSeconds!==.55||effect.currentAnchor.rotation?.some((v,i)=>i===1?![0,180].includes(v):v!==0)))
        throw new TypeError('invalid-owner-effect-set-clock');
    }
    for(const field of ['soundFired','deleteConditions'])if(Object.hasOwn(effect,field)&&!list(v=>text(v)||integer(v))(effect[field]))throw new TypeError('invalid-owner-effect-shape:'+field);
    for(const field of ['x','y','z','elapsed','animationTime','start','setElapsed','setStartAnimation','setStartState','powerMultiplier','stage','hitCount'])
      if(Object.hasOwn(effect,field)&&!number(effect[field]))throw new TypeError('invalid-owner-effect-shape');
    for(const field of ['active','dead','hyperMode','deleteOnStateEnd'])if(Object.hasOwn(effect,field)&&!bool(effect[field]))throw new TypeError('invalid-owner-effect-shape');
    if(Object.hasOwn(effect,'ownerStateSerial')&&!integer(effect.ownerStateSerial)
      ||Object.hasOwn(effect,'clock')&&!['custom','animation'].includes(effect.clock))throw new TypeError('invalid-owner-effect-shape');
    if(Object.hasOwn(effect,'stage')&&(!integer(effect.stage)||effect.stage<0||effect.stage>MAX_OWNER_EFFECT_STAGE))throw new TypeError('invalid-owner-effect-stage');
  }
  const hits=new Set();for(const hit of value.hits){
    if(!plain(hit)||Object.keys(hit).some(key=>!['id','attackerId','damage'].includes(key))
      ||!Number.isSafeInteger(hit.id)||hit.id<0||hits.has(hit.id)||typeof hit.attackerId!=='string'||hit.attackerId.length>128
      ||!Number.isFinite(hit.damage)||hit.damage<=0||hit.damage>1e9)throw new TypeError('invalid-owner-hit');hits.add(hit.id);
  }
  jsonValue(value);
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_OWNER_BYTES)throw new TypeError('owner-state-too-large');
}
export function validateOwnedState(value){inspectOwnedState(value);return copy(value);}
/** Resource intervals and MP gain modifiers belong to the affected player.
 * Observers need the identity/lifetime and attack, defence and control effects,
 * but never compute another player's HP/MP results. Retain a typed empty row
 * so active-identity/stun semantics are unchanged; only the owning actor's HUD
 * consumes the full rate/description. This is a network projection, not a
 * simulation snapshot or a mutation of the owning player's Buff. */
export const projectOwnedBuff=projectRemoteBuffResources;
export function encodeOwnedStatusSource(actor,{projectResources=true}={}){
  const value={};for(const key of ['buffs','invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed','forceInvincible'])
    if(actor[key]!==undefined)value[key]=key==='buffs'&&projectResources?actor.buffs.map(projectOwnedBuff):actor[key];
  const source=wireClone(value);validateOwnedStatusActor(source,undefined,{clock:false});return source;
}
export function encodeOwnedState(simulation,playerId,{epoch=0,frameSeq=0,events=[]}={}){
  const actor=simulation.state.actors.find(actor=>actor.id===playerId);if(!actor)throw new TypeError('missing-owner-actor');
  const state={};for(const key of actorFields)if(key!=='forceInvincible'&&actor[key]!==undefined)state[key]=actor[key];
  const resourceNumbers=encodeForceFingerResourceNumbers(actor,{epoch,frameSeq});
  if(resourceNumbers)state.sourceForceFingerResourceNumbers=resourceNumbers;else delete state.sourceForceFingerResourceNumbers;
  // Damage contact receipts belong to the receiving victim's simulation.
  // applyOwnedState already preserves those local ledgers; sending the source
  // actor/core dictionaries to every peer adds no usable combat information.
  state.hits={};delete state.hitGaps;
  if(simulation.networkOwnerId===playerId)state.buffs=actor.buffs.map(projectOwnedBuff);
  if(state.core){state.core={...state.core};delete state.core.hits;delete state.core.hitGaps;}
  const profile=simulation.profileFor?.(actor)??simulation.profile;
  const effects=simulation.state.effects.filter(effect=>effect.ownerId===playerId&&!effect.dead).map(effect=>encodeEffectState(effect,simulation.effectProfileFor?.(effect)??profile,actor));
  const hits=events.filter(event=>event.type==='hit'&&event.targetId===playerId&&event.amount>0).map(event=>({id:event.eventId,attackerId:event.actorId,damage:event.amount}));
  // wireClone already made a detached JSON packet from the live simulation.
  const report=wireClone({protocol:OWNERSHIP_PROTOCOL,epoch,frameSeq,actor:state,effects,hits});
  inspectOwnedState(report);return report;
}
function addSummonPoseDefinition(effect,profile){
  if(effect.setName!=='EffectSet_SI_HA_AMM_Apocalypse_Always'||profile?.target?.unitClass!==123)return null;
  const definition=profile.effectSets?.[effect.setName]?.raw?.[effect.definitionMember];
  if(!definition?.BONE_NAME||definition.NAME!==effect.name||definition.TRACE_MATRIX!==1||definition.TRACE_MORE!==1||
    profile.damageEffects?.[effect.name]||profile.effectTemplates?.[effect.name]?.kind!=='particle')return null;
  return definition;
}
export function encodeEffectState(effect,profile,actor){
  // birthActorPose is a local diagnostic snapshot; all actual geometry reads
  // birth/current anchors. effectName duplicates name; emitted audio uses name.
  const result={};for(const [key,value] of Object.entries(effect))if(!['ownerId','hits','hitGaps','sourceHitMemory2016','birthActorPose','effectName'].includes(key)&&!key.startsWith('network')&&!effectStatic.has(key)&&value!==undefined)result[key]=value;
  if(effect.sourceAddPrismAnimation){delete result.sourceArcController;delete result.sourceArcPose;delete result.sourceArcLoopSelections;}
  const set=profile?.effectSets?.[effect.setName]?.raw;
  const member=Object.entries(set??{}).find(([key,definition])=>/^EFFECT\d+$/.test(key)&&JSON.stringify(definition)===JSON.stringify(effect.definition));
  if(member)result.definitionMember=member[0];
  delete result.sourceAddSummonPose;
  // The 37 matrix-bearing members of the 38-layer Always set are pure NPC
  // emitters (the remaining Core member retains its complete anchors). Their
  // live matrices are derived from the source NPC clock and original bone
  // table. Keep the historical birth matrix; never replace it with live pose.
  if(actor?.sourceAddSummon?.serial===effect.sourceAddSummonSerial&&addSummonPoseDefinition(result,profile)){
    for(const key of ['currentAnchor','sourcePosedAnchor','x','y','z'])delete result[key];
    result.sourceAddSummonPose=true;
  }
  // VC projectile histories repeat these fixed diagnostic strings in body,
  // critical samples and each copied anchor. Geometry/control stays byte-for-
  // byte equivalent; source proof remains in local profiles/reports. Copy only
  // the affected level so encoding never mutates a live simulation object.
  if(profile?.target?.unitClass===115)for(const key of ['birthAnchor','currentAnchor','sourceDamageAnchor','sourcePosedAnchor','sourceShadowMesh']){
    const value=result[key];if(!value||typeof value!=='object'||Array.isArray(value))continue;
    if(!Object.hasOwn(value,'evidence')&&!Object.hasOwn(value,'evidenceClass'))continue;
    result[key]={...value};delete result[key].evidence;delete result[key].evidenceClass;
  }
  return wireClone(result);
}
export function encodeCriticalAction(report,{id,frameSeq=report.frameSeq,effectIds=null,targetViews}={}){
  const actor={};for(const key of criticalFields)if(report.actor[key]!==undefined&&
    (report.actor.sourceStatusClock!==undefined||!statusCriticalFields.has(key)))actor[key]=copy(report.actor[key]);
  const phantom=actor.sourceInfinitySword?.phantomSword;
  const analysisIds=new Set((actor.sourceAddNative??[]).flatMap(row=>row.handles));
  // A historical collision uses the transmitted delayed pose. It never runs
  // the unit forward, so copying its future pose queue into every sample adds
  // no collision evidence. Keep both linked handles to restore the controls.
  if(phantom)phantom.matrixQueue=[];
  return {id,frameSeq,actor,effects:report.effects.filter(effect=>effectIds?.has(effect.id)||
    analysisIds.has(effect.id)||phantom&&[phantom.effectId,phantom.centerId].includes(effect.id)).map(copy),
    ...(targetViews?.length?{targetViews:validateOwnedTargetViews(targetViews)}:{})};
}
function effectDefinition(profile,effect){
  if(effect.sourceReflected&&Object.hasOwn(profile.damageEffects??{},effect.name))return {NAME:effect.name};
  const finish=definition=>definition&&addPrismProjectDefinition(profile,effect,
    addDynamoInstanceDefinition(profile,effect,addLinkedDefinition(profile,effect,addInstanceDefinition(profile,effect,
    elesisInstanceDefinition(profile,effect,runeSlayerInstanceDefinition(profile,effect,veteranInstanceDefinition(profile,effect,definition)))))));
  // Fixed SwordMan Phantom Sword callback creates this traced sheath directly,
  // outside an EffectSet; its bone routing must survive remote reconstruction.
  if(profile.target?.unitClass===112&&effect.name==='ElswordPhantomSwordSheath01'&&!effect.setName)
    return {NAME:'ElswordPhantomSwordSheath01',BONE_NAME:'Dummy1_Rhand',TRACE_MATRIX:1};
  const set=profile.effectSets?.[effect.setName]?.raw;
  if(effect.definitionMember!==undefined){
    const definition=/^EFFECT\d+$/.test(effect.definitionMember)&&set?.[effect.definitionMember];
    return definition&&(definition.NAME===effect.name||effect.hyperMode&&definition.HYPER_NAME===effect.name)?finish(definition):null;
  }
  for(const [key,definition] of Object.entries(set??{}))if(/^EFFECT\d+$/.test(key)&&
    (definition.NAME===effect.name||effect.hyperMode&&definition.HYPER_NAME===effect.name))return finish(definition);
  // Direct commands, additional hit meshes and Nasod effects do not always
  // belong to an EffectSet. Their NAME is still in the frozen profile catalog.
  if(Object.hasOwn(profile.damageEffects??{},effect.name)||Object.hasOwn(profile.effectTemplates??{},effect.name))return finish({NAME:effect.name});
  return null;
}
const arcDamageNames=new Set(['RAVEN_OVER_TAKER_ARC_ENEMY','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO',
  'RAVEN_OVER_TAKER_FLYING_IMPACT','RAVEN_OVER_TAKER_ARC_ENEMY_HYPER','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO_HYPER',
  'RAVEN_OVER_TAKER_FLYING_IMPACT_HYPER']);
function restoreArcControls(effect,actor){
  // Arc native callbacks mutate the frozen effect's attack WINDOW and mesh
  // speed. They are instance controls, while the damage tables remain local.
  // A first report can arrive after the last held spear was released, when
  // there is no further follow callback to reconstruct these controls.
  const arc=actor.sourceArcEnemy,handle=effect.sourceArcHandle;
  if(effect.skillId!==24008||!handle||!arcDamageNames.has(effect.name)||!effect.damage
    ||arc?.effectIds?.[handle]!==effect.networkId)return;
  const row=arc.effects.find(row=>row.handle===handle&&row.name===effect.name&&row.alive&&row.hasMesh);
  if(!row)return;
  const held=arc.data.some(row=>row.handle===handle),end=held?0:9999,speed=held?0:3000;
  // Raven.cpp:525–528 pins the released constants. Never copy a sender's
  // damage object or arbitrary attackTime array into the frozen damage data.
  effect.damage.ATTACK_TIME_START=0;effect.damage.ATTACK_TIME_END=end;
  effect.initialDirSpeed=speed;
  if(!held)effect.lifeTimeSeconds=Math.fround(.35);
  row.attackTime=[0,end];row.dirSpeed=speed;
  if(!held)row.maxLifeTime=Math.fround(.35);
}
function validateAddOwnedReferences(state,actor,profile,context,map){
  if(/^ANSI_SA_APT_PULSE_CANNON_(?:READY|LOOP|FINISH)$/.test(profile.states[state.state]?.sourceState)&&state.sourceAddCombat?.pulseOrder?.length!==6)throw new TypeError('invalid-owner-pulse-bone-order');
  if(profile.states[state.state]?.sourceState?.startsWith(PANZER_PREFIX)&&!state.sourceAddCombat?.panzer)throw new TypeError('missing-add-panzer-controller');
  if(state.sourceAddCombat?.predictionRequest){const request=state.sourceAddCombat.predictionRequest;if(profile?.target?.unitClass!==126||!profile.states[request.state]||request.fromStateSerial!==state.stateSerial||profile.states[state.state]?.sourceState!=='ANSI_ATT_DASH_JUMP_COMBO_ZX')throw new TypeError('invalid-owner-de-physical-request');}
  if(state.sourceAddPrismEndpoints!==undefined){
    if(![122,123,126].includes(profile?.target?.unitClass))throw new TypeError('invalid-owner-prism-endpoints-profession');
    if(state.sourceAddPrismEndpoints.length&&!actor.loadout?.some(slot=>[29003,29029].includes(slot?.skillId)))throw new TypeError('unconfigured-owner-prism-endpoints');
    validateAddPrismEndpoints(state.sourceAddPrismEndpoints,{owner:actor});
  }
  const unitClass=profile?.target?.unitClass,isAdd=[122,123,126].includes(unitClass),s=state.sourceAdd;
  if(state.sourceAddSummon!==undefined){
    if(unitClass!==123)throw new TypeError('invalid-owner-add-summon-profession');
    validateAddSummonState(state.sourceAddSummon,{owner:actor,profile,actors:context.actors});
  }
  if(state.sourceTimeRingNotice&&(unitClass!==126||!actor.loadout?.some(slot=>slot?.skillId===29213)))
    throw new TypeError('invalid-add-time-ring-notice-source');
  if(state.sourceAddTargetNotice)validateAddTargetNotice(state.sourceAddTargetNotice,{owner:actor,profile,actors:context.actors});
  if(state.sourceAddDroneMark!==undefined)validateAddDroneMarkState(state.sourceAddDroneMark,{owner:actor,profile,actors:context.actors});
  if(state.sourceAddStigma!==undefined)validateAddStigmaState(state.sourceAddStigma,{owner:actor,profile,actors:context.actors,map});
  if(state.sourceAddStigmaNotice!==undefined)validateAddStigmaNotice(state.sourceAddStigmaNotice,{owner:actor,profile,actors:context.actors,map});
  if(state.sourceAddFantasyTracer!==undefined)validateAddFantasyTracerState(state.sourceAddFantasyTracer,{owner:actor,profile,actors:context.actors});
  if(state.sourceAddNative!==undefined){
    validateAddNativeState(state.sourceAddNative,{owner:actor,profile,actors:context.actors});
    for(const row of state.sourceAddNative)if(row.group>state.stateSerial||!actor.loadout?.some(slot=>slot?.skillId===row.skillId)||
      !profile.skillCatalog?.some(skill=>skill.skillId===row.skillId&&skill.supported!==false))throw new TypeError('invalid-add-analysis-source');
  }
  if(!isAdd){
    if(s!==undefined||state.sourceAddNative!==undefined||state.sourceAddMovement!==undefined||state.sourceAddCombat!==undefined)throw new TypeError('invalid-add-profession-state');
  }else{
    if(!s)throw new TypeError('missing-add-state');
    const awake=state.awakening;
    if(awake.remaining!==(s.formation||s.formationPending?ADD_FORMATION_SENTINEL:0)||
      awake.orbs!==0||awake.gauge!==0||awake.full||awake.pendingOrbs!==0||awake.pendingAvailableOrbs!==0||awake.reawakening)
      throw new TypeError('invalid-add-awakening-mirror');
    if(state.core?.phase!=='absent'||state.core?.gauge!==0||state.core?.level!==0||state.core?.parrying||state.core?.canParry)
      throw new TypeError('invalid-add-nasod-core');
    if(!Number.isFinite(profile.components?.CHANGE_FORMATION_MODE_COOL_TIME)||s.switchCooldown>profile.components.CHANGE_FORMATION_MODE_COOL_TIME||
      (s.formation||s.formationPending)&&s.dp<=0)throw new TypeError('invalid-add-formation-state');
    if(s.generator){
      const skill=profile.skillCatalog?.find(row=>row.skillId===s.generator.skillId);
      if(unitClass!==123||!skill||!actor.loadout?.some(slot=>slot?.skillId===skill.skillId)||
        s.generator.remaining>(skill.skillId===29035?45:30))throw new TypeError('invalid-add-generator-state');
    }
    if(state.sourceAddCombat){
      const panzer=state.sourceAddCombat.panzer;
      if(panzer&&(unitClass!==123||state.skillId!==panzer.skillId||!actor.loadout?.some(sk=>sk?.skillId===panzer.skillId)||
        !profile.states[state.state]?.sourceState?.startsWith(PANZER_PREFIX)))throw new TypeError('invalid-add-panzer-source');
      const duration=state.sourceAddCombat.stormDuration;
      const choices=[{duration:.8,size:1}];
      for(const skill of profile.skillCatalog?.filter(row=>row.executor==='PsychicStorm')??[]){
        for(const [level,hyper]of Object.entries(skill.raw?.SA_EFFECTIVE_TIME_HYPER??{})){
          const time=skill.raw?.SA_EFFECTIVE_TIME?.[level],size=skill.raw?.SA_PROJECTILE_SIZE?.[level];
          if(Number.isFinite(hyper))choices.push({duration:.8+hyper,size:1});
          if([time,hyper,size].every(Number.isFinite))for(let count=1;count<=3;count++)
            choices.push({duration:.8+hyper+count*time,size:1+(size-1)*count});
        }
      }
      if(!choices.some(row=>Math.abs(duration-row.duration)<1e-7&&
        (state.sourceAddCombat.stormSize===undefined||Math.abs(state.sourceAddCombat.stormSize-row.size)<1e-7)))
        throw new TypeError('invalid-add-storm-duration');
      const targetId=state.sourceAddCombat.nasodTargetId;
      if(targetId!=null&&(targetId===actor.id||!context.actors?.some(target=>target.id===targetId&&target.team!==actor.team)))
        throw new TypeError('invalid-add-nasod-target');
      const phase=state.sourceAddCombat.phase;
      if(phase){const skill=profile.skillCatalog?.find(sk=>sk.skillId===phase.skillId);
        if(!actor.loadout?.some(sk=>sk?.skillId===phase.skillId)||!Object.values(skill?.raw?.SA_EFFECTIVE_TIME??{}).some(n=>number(n)&&phase.remaining<=n))
          throw new TypeError('invalid-add-phase-source');}
      if(state.sourceAddCombat.stasis&&(profile.target.unitClass!==122||!actor.loadout?.some(sk=>sk?.skillId===29007)))
        throw new TypeError('invalid-add-stasis-source');
      const maximum=state.sourceAddCombat.maximumStrike;
      if(maximum&&(profile.target.unitClass!==126||!actor.loadout?.some(sk=>sk?.skillId===29022)||maximum.targetId!==null&&
        !context.actors?.some(target=>target.id===maximum.targetId&&target.team!==actor.team)))throw new TypeError('invalid-add-maximum-strike-source');
      if(state.sourceAddCombat.outputExchangeFactor!==undefined&&(unitClass!==122||!actor.passivePolicy?.skillLevels?.[29403]))
        throw new TypeError('invalid-add-output-exchange-source');
    }
  }
  const ring=state.sourceTimeRing;
  if(!ring)return;
  const savedMpLimit=timeRingSavedMpLimit(actor,profile,context);
  if(!number(savedMpLimit)||ring.hp>actor.hpMax||ring.mp>savedMpLimit||isAdd!==(ring.dp!==null)||isAdd!==(ring.mutation!==null)||
    Boolean(state.wayOfSword)!==(ring.wayOfSword!==null))throw new TypeError('invalid-add-time-ring-resources');
  if(ring.wayOfSword!==null){
    const limits=profile.referenceSemantics?.wayOfSword?.targetFields;
    if(!limits||ring.wayOfSword<limits.Const_DestStateThreshold||ring.wayOfSword>limits.Const_VigorStateThreshold)
      throw new TypeError('invalid-add-time-ring-sword');
  }
  const source=ring.sourceActorId===actor.id?actor:context.actors?.find(row=>row.id===ring.sourceActorId);
  const sourceProfile=source===actor?profile:source&&context.profiles?.[source.professionId];
  // The caster may have died after applying the seal. Team, frozen class and
  // equipped source skill remain verifiable; current life/position do not.
  if(!source||source.team!==actor.team||sourceProfile?.target?.unitClass!==126||
    source.profileId&&source.profileId!==sourceProfile.profileId||!source.loadout?.some(slot=>slot?.skillId===29213))
    throw new TypeError('invalid-add-time-ring-source');
}
function validateAddNativeReferences(report,profile){
 const rows=report.actor.sourceAddNative??[];
 const claimed=new Set();
 for(const row of rows){
  const roles=row.kind==='starfall'?new Map(row.rows.map(q=>[q.carrierId,new Set([STARFALL_CARRIER])])):
    row.kind==='chaser'?new Map([[row.attackerId,new Set([CHASER_ATTACKER])]]):new Map([
      [row.ruptureId,new Set(['DamageEffect_ATT_Stardust_Shower_Rupture'])],
      ...(row.carrierId===null?[]:[[row.carrierId,new Set(['Mesh_ATT_Stardust_Shower_Drop'])]]),
      ...row.attackIds.map(id=>[id,new Set(Object.values(profile.effectSets?.EffectSet_ATT_Stardust_Shower_Attack?.raw??{})
        .filter(v=>typeof v?.NAME==='string').map(v=>v.NAME))])]);
  if(row.handles.length!==roles.size||row.handles.some(id=>!roles.has(id)||claimed.has(id)))throw new TypeError('invalid-owner-add-analysis-handle');
  for(const id of row.handles){
   claimed.add(id);
   const e=report.effects.find(e=>e.id===id);
   // A native main handle can finish before the owner-side retention callback
   // (e.g. four Chaser contacts). Missing handles never become new local IDs;
   // the receiver retires the corresponding controller below.
   if(!e)continue;
   if(!roles.get(id).has(e.name)||e.skillId!==row.skillId||e.ownerStateSerial!==row.group||
     !number(e.powerMultiplier)||Math.abs(e.powerMultiplier-row.power)>1e-6)
     throw new TypeError('invalid-owner-add-analysis-handle-source');
  }
 }
}
export function validateOwnedBuffReferences(buffs,actor,profile,context={}){
  if(profile)for(const buff of buffs){
    let sourceProfile=profile;
    if(buff.sourceActorId!=null&&context.actors){
      const source=context.actors.find(row=>row.id===buff.sourceActorId);
      sourceProfile=source&&context.profiles?.[source.professionId];
      if(!sourceProfile||source.profileId&&source.profileId!==sourceProfile.profileId)throw new TypeError('invalid-owner-buff-source');
    }
    if(!Object.hasOwn(sourceProfile.buffTemplates??{},buff.templateId)
      ||buff.factorId!=null&&!Object.hasOwn(sourceProfile.buffFactors??{},buff.factorId))throw new TypeError('unknown-owner-buff');
    if(buff.factorId!=null&&sourceProfile.buffFactors[buff.factorId].raw?.BUFF_TEMPLET_ID!==buff.templateId)throw new TypeError('invalid-owner-buff-factor-template');
    if(buff.targetActorId!=null&&buff.targetActorId!==actor.id)throw new TypeError('invalid-owner-buff-target');
    for(const row of buff.behaviors.filter(row=>['attackBlock','neverMove'].includes(row.kind))){
      const name=row.kind==='attackBlock'?'BBT_ATTACK_IMPOSSIBLE':'BBT_NEVER_MOVE';
      if(sourceProfile.target?.unitClass!==126||buff.templateId!==437||buff.factorId!==475||
        row.type!==sourceProfile.enums?.BUFF_BEHAVIOR_TYPE?.[name]||
        !sourceProfile.buffFactors[475].raw.BEHAVIOR?.[name]||
        row.kind==='neverMove'&&(row.gravity!==false||sourceProfile.buffTemplates[437].raw.BEHAVIOR?.BBT_NEVER_MOVE?.IS_GRAVITY!==0))
        throw new TypeError('invalid-owner-add-void-binding');
    }
    if(buff.finalizers.some(row=>row.kind==='hyper')&&(sourceProfile.target?.unitClass!==122||profile.target?.unitClass!==122||
      buff.sourceActorId!==actor.id||buff.targetActorId!==actor.id||buff.factorId!==619||buff.templateId!==530||
      sourceProfile.buffTemplates[530].raw.FINALIZER?.COMBINATION?.['1']!==11))throw new TypeError('invalid-owner-add-hyper-finalizer');
    for(const row of buff.behaviors.filter(row=>row.kind==='sourceCallback')){
      const source433=sourceProfile.target?.unitClass===125&&buff.templateId===433&&buff.factorId===470&&row.sourceBehavior==='BBT_EFFECT_SET_WITH_DAMAGE';
      const sourceMoonlight=[122,123,126].includes(sourceProfile.target?.unitClass)&&[438,439].includes(buff.templateId)
        &&buff.factorId===(buff.templateId===438?476:477)&&row.sourceBehavior==='BBT_CUSTOM_FUNCTION';
      if(!(source433||sourceMoonlight)||row.type!==sourceProfile.enums?.BUFF_BEHAVIOR_TYPE?.[row.sourceBehavior])
        throw new TypeError('invalid-owner-source-callback-buff');
    }
    if(buff.behaviors.some(row=>['mpInterval','hpInterval'].includes(row.kind)&&row.interval===0)){
      // Template20 is an immediate source MP operation. Confirm its actual
      // factor/template pair, instead of admitting arbitrary zero intervals.
      const template=sourceProfile.buffTemplates[buff.templateId].raw,factor=sourceProfile.buffFactors?.[buff.factorId]?.raw;
      if(buff.templateId!==20||template.ACCUMULATION_LIMIT!==0||template.BEHAVIOR?.BBT_CHANGE_NOW_MP_PER_SECOND?.TIME_INTERVAL!==0||
        factor?.BEHAVIOR?.BBT_CHANGE_NOW_MP_PER_SECOND?.BUFF_CHANGE_TYPE!==1||!factor.FINALIZER?.BFT_IMMEDIATE||
        buff.behaviors[0].type!==sourceProfile.enums.BUFF_BEHAVIOR_TYPE.BBT_CHANGE_NOW_MP_PER_SECOND)
        throw new TypeError('invalid-owner-immediate-mp-buff');
    }
    if(buff.behaviors.some(row=>['phantomSword','ignoreDefence'].includes(row.kind)||row.stat==='additionalAttackPercent'&&!(isElesisProfile(sourceProfile)&&buff.templateId===428))
      &&sourceProfile.target?.unitClass!==112)throw new TypeError('invalid-owner-infinity-buff');
    for(const row of buff.behaviors.filter(row=>row.kind==='addDpGain')){
      const raw=sourceProfile.buffFactors?.[357]?.raw?.BEHAVIOR?.BBT_CHANGE_HYPER_CHARGE_SPEED;
      // Buff creation's value() consumes source percentages as binary32.
      // Match that exact value rather than the JSON declaration's double.
      if(sourceProfile.target?.unitClass!==122||buff.factorId!==357||buff.templateId!==335||
        raw?.BUFF_CHANGE_TYPE!==3||row.value!==Math.fround(raw.PERCENT?.[String(buff.skillLevel)]))throw new TypeError('invalid-owner-add-dp-buff');
    }
  }
  return true;
}
export function validateOwnedReferences(report,actor,profile,map,context={}){
  const state=report.actor;
  validateStopProjections(state);
  if(state.manaBreak.pendingDown&&(!state.manaBreak.active||state.manaBreak.pendingCost<state.manaBreak.minimumCharge||
     !profile.states[state.manaBreak.pendingDown.state]))throw new TypeError('invalid-owner-mana-pending-down');
  if(actor.profileId&&profile?.profileId!==actor.profileId)throw new TypeError('owner-profession-profile-mismatch');
  if(state.sourceForceFingerResourceNumbers)validateForceFingerResourceNumbers(state.sourceForceFingerResourceNumbers,
    {owner:actor,profile,actors:context.actors,profiles:context.profiles,epoch:report.epoch,frameSeq:report.frameSeq});
  if(state.sourceArcEnemy!=null&&profile.target?.unitClass!==107)throw new TypeError('invalid-owner-arc-profession');
  validateAddOwnedReferences(state,actor,profile,context,map);
  if(state.sourceAddCombat?.lpZxTarget){
    validateLPZxCaptureReferences(state.sourceAddCombat.lpZxTarget,state,actor,profile,context.actors);
    if(state.sourceAddCombat.lpZxTarget.ownerEpoch!==report.epoch)throw new TypeError('invalid-lp-zx-capture-owner-life');
  }
  if(state.sourceElesisFireAbsorbNotice)validateElesisFireAbsorbNotice(state.sourceElesisFireAbsorbNotice,
    {owner:actor,actors:context.actors,profiles:context.profiles});
  if(state.sourceAddMoonlightNotice)validateAddMoonlightNotice(state.sourceAddMoonlightNotice,{owner:actor,actors:context.actors});
  if(state.sourceAddCombat?.moonlight)validateAddMoonlightState(state.sourceAddCombat.moonlight,{owner:{...actor,...state},profile});
  validateAddNativeReferences(report,profile);
  const elesis=isElesisProfile(profile);
  if(state.sourceElesisFirewallRequests)validateElesisFirewalls(state,profile,map);
  if(elesis&&profile.target.unitClass!==121&&state.sourceElesisCommand&&
    (state.sourceElesisCommand.loops>4||state.sourceElesisCommand.requestedLoops>4))throw new TypeError('invalid-owner-elesis-loop-budget');
  if([100,101,112].includes(profile?.target?.unitClass)||elesis){
    if(state.core?.phase!=='absent'||state.core?.gauge!==0||state.core?.level!==0||state.core?.parrying||state.core?.canParry)throw new TypeError('invalid-lk-nasod-core');
    if(state.wayOfSword){const fields=profile.referenceSemantics?.wayOfSword?.targetFields,{point,state:mode}=state.wayOfSword;
      // Hysteresis permits active state2/-2 below its full threshold only
      // while the gauge remains on that side. Opposite signs are impossible.
      // ReInit may retain even a full gauge while explicitly returning its
      // mode to charging. Range/sign validation remains exact; full points do
      // not, by themselves, prove that its active mode has already restarted.
      if(!fields||point<fields.Const_DestStateThreshold||point>fields.Const_VigorStateThreshold
        ||Math.sign(point)!==Math.sign(mode))throw new TypeError('invalid-lk-way-of-sword');}
  }else if(state.wayOfSword!==undefined||state.destructionRageRemaining!==undefined||state.sourceWayOfSwordEffectGroup!==undefined)throw new TypeError('invalid-rf-way-of-sword');
  if(!elesis&&elesisOwnerFields.some(key=>state[key]!==undefined))throw new TypeError('invalid-elesis-state');
  if(elesis){
    validateBloodCutterRequests(state,profile,map);
    if((state.destructionRageRemaining??0)!==0)throw new TypeError('invalid-elesis-elsword-rage');
    if(state.sourceElesisBreakCharge>0&&state.wayOfSword?.state!==-2)throw new TypeError('invalid-elesis-break-charge');
    const endurance=state.sourceElesisEndurance;
    if(endurance){const skill=profile.skillCatalog?.find(s=>s.skillId===endurance.skillId);
      if(!skill||endurance.level>skill.maxLevel||endurance.upgraded!==(endurance.skillId===28218))throw new TypeError('invalid-elesis-endurance');}
    const dance=state.sourceElesisSkills;
    if(context.actors&&[...(dance?.danceTargets??[]),dance?.danceTargetId].filter(id=>id!=null).some(id=>!context.actors.some(a=>a.id===id)))throw new TypeError('invalid-elesis-dance-target');
  }
  if(![100,101,112].includes(profile?.target?.unitClass)&&state.sourceLordKnight!==undefined)throw new TypeError('invalid-rf-lord-knight-state');
  if(profile?.target?.unitClass!==101&&state.sourceRuneSlayer!==undefined)throw new TypeError('invalid-rune-slayer-state');
  if(profile?.target?.unitClass!==101&&state.sourceReflectionNotice!==undefined)throw new TypeError('invalid-rune-slayer-reflection-notice');
  if(profile?.target?.unitClass!==115&&state.sourceVeteranCommander!==undefined)throw new TypeError('invalid-veteran-commander-state');
  if(profile?.target?.unitClass!==106&&state.sourceBladeMaster!==undefined)throw new TypeError('invalid-blade-master-state');
  if(state.sourcePendingState){const pending=state.sourcePendingState;
    if(![100,101,106,107,112,115].includes(profile.target?.unitClass)||!profile.states[pending.state]||pending.requestByte!==state.sourceStateRequestByte||
      pending.requestedAtStateSerial>state.stateSerial)throw new TypeError('invalid-source-pending-reference');
    const skill=pending.skill;
    if(pending.productPressed&&(profile.target.unitClass!==115||!['RSI_WAIT','RSI_DASH','RSI_DASH_JUMP'].includes(pending.state)||skill.skillId!==null))throw new TypeError('invalid-source-product-command-input');
    if(skill.skillId===null){if(skill.skillContext!==null||skill.skillScale!==1)throw new TypeError('invalid-source-pending-command');}
    else{const row=profile.skillCatalog.find(s=>s.skillId===skill.skillId),c=skill.skillContext,
      slot=c?['A','S','D','C','Q','W','E','R'].indexOf(c.key):-1,equipped=actor.loadout?.[slot];
      if(!row||row.passive||!c||!equipped||pending.slot!==null&&pending.slot!==slot||equipped.skillId!==skill.skillId||equipped.branchId!==c.branchId||c.level>row.maxLevel||
        ![row.state,...(row.states??[]),row.state+'_HYPER'].includes(pending.state))throw new TypeError('invalid-source-pending-skill');
    }
  }
  if(profile?.target?.unitClass!==112&&state.sourceInfinitySword!==undefined)throw new TypeError('invalid-infinity-sword-state');
  const phantom=state.sourceInfinitySword?.phantomSword;
  if(phantom){
    const blade=report.effects.find(e=>e.id===phantom.effectId),center=report.effects.find(e=>e.id===phantom.centerId);
    if(!state.buffs.some(b=>b.templateId===29&&b.behaviors.some(row=>row.kind==='phantomSword'))||
      blade?.name!=='THIRD_BLADE'||center?.name!=='ThirdBladeCenter'||!blade.sourcePhantomSword||!center.sourcePhantomSword||
      [...phantom.attacks,...(phantom.currentAttack?[phantom.currentAttack]:[])].some(row=>!phantomSwordDamageData(profile,row)))
      throw new TypeError('invalid-owner-phantom-sword');
  }
  if(state.hp<0||state.hp>actor.hpMax||state.mp<0||Math.abs(state.x)>1e7||Math.abs(state.y)>1e7||Math.abs(state.z)>1e7
    ||Math.abs(state.vx)>1e6||Math.abs(state.vy)>1e6||state.passiveSpeed&&Object.values(state.passiveSpeed).some(value=>Math.abs(value)>1e6)
    ||state.stateTime<0||state.animationTime<0)throw new TypeError('owner-state-out-of-range');
  if(profile?.states&&!Object.hasOwn(profile.states,state.state))throw new TypeError('unknown-owner-action');
  for(const id of [state.lineId,state.lastTouchLineId,state.ignoreLineId,state.pendingPlatformJump?.lineId,
    state.mapMechanics?.portalLineId,state.mapMechanics?.bungeeLineId,state.mapMechanics?.portalNotice?.lineId,
    state.mapMechanics?.lastReturn?.fromLineId,state.mapMechanics?.lastReturn?.toLineId])
    if(id!=null&&map?.lines&&!map.lines.some(line=>line.lineId===id))throw new TypeError('unknown-owner-line');
  // Emergency Escape is an equipped BM passive that runs the shared Shadow
  // Step lifecycle without requiring Shadow Step in one of the eight slots.
  const passiveEscape=profile?.target?.unitClass===106&&state.skillId===24217
    &&actor.passivePolicy?.bladeMaster?.escapeChance>0&&state.sourceBladeMaster?.escapeCooldown>0
    &&profile.skillCatalog?.find(skill=>skill.skillId===24217)?.states?.includes(state.state);
  if(state.skillId!=null&&!actor.loadout?.some(slot=>slot?.skillId===state.skillId)&&!passiveEscape)throw new TypeError('unconfigured-owner-skill');
  if((state.sourceShadowStep?.key===null||state.skillId===24217&&state.skillContext?.key===null)&&!passiveEscape)throw new TypeError('unconfigured-owner-passive-shadow-step');
  validateOwnedBuffReferences(state.buffs,actor,profile,context);
  // Grant and expiry can arrive in the same report as the new MP. Derive its
  // ceiling from the candidate buff set and the frozen, passive-adjusted base;
  // reading the receiver's previous mpMax rejects a legitimate War Prelude.
  let mpMax=actor.buffBaseStats?.mpMax??actor.mpMax;
  for(const row of state.buffs.flatMap(buff=>buff.behaviors).filter(row=>row.kind==='stat'&&row.stat==='mpMax')){
    if(row.changeType===0)mpMax=row.value;
    else if(row.changeType===1)mpMax=Math.fround(mpMax+row.value);
    else mpMax=Math.fround(mpMax*row.value);
  }
  if(!number(mpMax)||mpMax<0||state.mp>mpMax)throw new TypeError('owner-state-out-of-range');
  if(profile)for(const effect of report.effects){
    validateGMSpawnRotation(effect,effect.sourceProfessionId?context.profiles?.[effect.sourceProfessionId]:profile);
    validateAddStardustMesh(effect,effect.sourceProfessionId?context.profiles?.[effect.sourceProfessionId]:profile,{required:effect.active});
    validateContinuousAuraMarker(effect,profile);
    if(effect.sourceContinuousAura?.phase==='active'&&(!state.awakening?.full||!(state.awakening.remaining>0)||state.hp<=0))
      throw new TypeError('invalid-owner-continuous-aura-phase');
    validateAddStormEffectState(effect,profile);
    validateAddLockOn(effect,profile,actor,context.actors);
    validateMaximumStrikeEffect(effect,{...actor,...state},profile);
    validateAddFissionSplit(effect,profile);
    validateAddMarkedDrone(effect,profile);
    validateAddFuryEffectState({...effect,ownerId:actor.id},profile.target?.unitClass===123?'MM':'other',context.actors??[]);
    validateElesisShadowLink({...effect,ownerId:actor.id},profile.target?.unitClass===125?'CA':'other',context.actors??[]);
    validateBloodCutterCarrier(effect,profile);
    validateAddSummonEffectState(effect,profile);
    validateAddSummonProjectileState(effect,{profile,owner:actor,actors:context.actors});
    validateAddDroneMarkEffect(effect,{profile,owner:actor,actors:context.actors});
    validateAddPrismAnimation(effect.sourceAddPrismAnimation,{effect,profile});
    validateAddQuicksilverLinkState({...effect,ownerId:actor.id},profile.target?.unitClass===122?'LP':'other',
      context.actors?.map(row=>row.id===actor.id?{...row,...state}:row)??[]);
    if(effect.sourceAddSummonPose&&(!addSummonPoseDefinition(effect,profile)||
      state.sourceAddSummon?.serial!==effect.sourceAddSummonSerial))throw new TypeError('invalid-owner-add-summon-pose-source');
    if(effect.sourceISSheath&&(profile.target?.unitClass!==112||effect.name!=='ElswordSheath02'||
      !profile.effectTemplates?.ElswordSheath02||profile.damageEffects?.ElswordSheath02))throw new TypeError('invalid-owner-is-sheath');
    if((effect.sourceInfinityLockOn!==undefined||effect.sourceInfinityManualDirDegree!==undefined)&&(profile.target?.unitClass!==112||effect.name!=='ELSWORD_EIS_SWORDBLASTING_PHANTOMSWORD'))throw new TypeError('invalid-owner-infinity-lock-on');
    if(effect.sourceBuffFactor!==undefined&&(profile.target?.unitClass!==112||!['ELSWORD_SA_RAGECUTTER_HIT_M01','ELSWORD_SA_RAGECUTTER_HIT_M02'].includes(effect.name)
      ||effect.sourceBuffFactor!==profile.skillCatalog.find(skill=>skill.skillId===21023)?.raw.BUFF_FACTOR?.['1']))throw new TypeError('invalid-owner-infinity-buff-factor');
    if(effect.sourcePhantomSword&&(profile.target?.unitClass!==112||effect.buffTemplateId!==29||
      ![phantom?.effectId,phantom?.centerId].includes(effect.id)||!['THIRD_BLADE','ThirdBladeCenter'].includes(effect.name)||
      effect.sourcePhantomAttackSerial!==(effect.name==='THIRD_BLADE'?phantom?.currentAttack?.serial??0:0)))throw new TypeError('invalid-owner-phantom-sword');
    const effectProfile=effect.sourceProfessionId?context.profiles?.[effect.sourceProfessionId]:profile;
    if(effect.sourceProfessionId){
      const raw=effectProfile?.damageEffects?.[effect.name]?.raw;
      if(!raw||!(raw.REFLECT===1||raw.REFLECT===true)||!(raw.DAMAGE_DATA?.CAN_REFLEX===1||raw.DAMAGE_DATA?.CAN_REFLEX===true)||
        profile.target?.unitClass!==101||effect.sourceReflection.sourceActorId===actor.id||
        context.actors&&!context.actors.some(a=>a.id===effect.sourceReflection.sourceActorId)||effect.setName!=null||effect.skillId!=null)
        throw new TypeError('invalid-owner-reflection-source');
    }
    if(effect.sourceVeteranAttachment!=null&&profile.target?.unitClass!==115)throw new TypeError('invalid-owner-veteran-attachment');
    if(effect.sourceRuneLevel!==undefined&&profile.target?.unitClass!==101)throw new TypeError('invalid-owner-rune-level');
    if(effect.sourceElesisExtinctionAngle!==undefined&&(!number(effect.sourceElesisExtinctionAngle)||effect.sourceElesisExtinctionAngle< -45||effect.sourceElesisExtinctionAngle>0||
      profile.target?.unitClass!==120||effect.skillId!==28033||effect.name!=='EXTINCTION_ATTACK_DUMMY'||effect.setName!=='EffectSet_SA_SSK_EXTINCTION_DAMAGE'))throw new TypeError('invalid-owner-elesis-extinction-angle');
    if(effect.sourceElesisCommandCharge!==undefined&&(profile.target?.unitClass!==125||effect.name!=='DamageEffect_SCA_Dash_Combo_XZ'))throw new TypeError('invalid-owner-elesis-command-charge-source');
    if(effect.sourceBlazeWingLockOn!==undefined){
      const control=effect.sourceBlazeWingLockOn,raw=effectProfile.damageEffects?.[effect.name]?.raw?.LOCK_ON_DATA;
      if(effectProfile.target?.unitClass!==121||effect.name!==BLAZE_WING_LOCK_ON_DAMAGE||raw?.LOCK_ON_TYPE!==6||
        control.unlockRemaining< -1||control.unlockRemaining>Math.fround(raw.TIME_UNLOCK_FROM_START)||
        control.previousHitCount>effect.hitCount||control.targetId===actor.id||context.actors&&
        (control.targetId!==null&&!context.actors.some(a=>a.id===control.targetId&&a.team!==actor.team)||
          control.historySnapshot.some(id=>!context.actors.some(a=>a.id===id))))
        throw new TypeError('invalid-owner-blaze-wing-lock-on');
    }
    if(effect.sourceDirSpeedSign!=null&&(profile.target?.unitClass!==115||
      !['RAVEN_GIGA_PROMINENCE_FINISH_STONE','RAVEN_GIGA_PROMINENCE_FINISH','RAVEN_GIGA_PROMINENCE_FINISH_OVERHEAT'].includes(effect.name)))
      throw new TypeError('invalid-owner-effect-direction-speed');
    const definition=effectDefinition(effectProfile,effect);if(!definition)throw new TypeError('unknown-owner-effect');
    if(['birthAnchor','currentAnchor','sourcePosedAnchor'].some(key=>effect[key]?.matrix!==undefined)&&
      definition.TRACE_MATRIX!==1&&!effect.sourcePhantomSword&&!effect.sourceISSheath&&effect.sourceAddSummonSerial===undefined)
      throw new TypeError('invalid-owner-effect-matrix-source');
    if(effect.stage>0&&!effectProfile.damageEffects?.[effect.name]?.raw?.[effect.stage===1?'DAMAGE_DATA_NEXT':`DAMAGE_DATA_NEXT${effect.stage}`])
      throw new TypeError('invalid-owner-effect-stage');
    if(Object.hasOwn(effect,'sourceBoneEffectSetId')){
      if(Object.hasOwn(ELESIS_BONE_TARGETS,effect.setName)&&!isElesisProfile(effectProfile))throw new TypeError('invalid-owner-elesis-bone-target');
      if(Object.hasOwn(ADD_BONE_TARGETS,effect.setName)&&effectProfile.target?.unitClass!==122)throw new TypeError('invalid-owner-add-bone-target');
      if(Object.hasOwn(ADD_ANALYSIS_BONE_TARGETS,effect.setName)&&effectProfile.target?.unitClass!==123)throw new TypeError('invalid-owner-add-analysis-bone-target');
      if(Object.hasOwn(ADD_COMMON_BONE_TARGETS,effect.setName)&&![122,123,126].includes(effectProfile.target?.unitClass))throw new TypeError('invalid-owner-add-common-bone-target');
      const sword=report.effects.find(e=>e.id===effect.sourceBoneEffectSetId);
      if(sword&&(![ownerBoneTargets[effect.setName]].flat().includes(sword.name)||sword.setName!==effect.setName||sword.sourceBoneEffectSetId!==sword.id||
          sword.ownerStateSerial!==effect.ownerStateSerial||sword.setStartAnimation!==effect.setStartAnimation||sword.setStartState!==effect.setStartState)||
        hasSetMeshBoneTarget(effect)&&(definition.TRACE_USER_TARGET_FORCE===1||definition.BONE_TRACE_TARGET_MESH===1)||
        !hasSetMeshBoneTarget(effect)&&definition.TRACE_USER_TARGET_FORCE!==1&&definition.BONE_TRACE_TARGET_MESH!==1)
        throw new TypeError('invalid-owner-effect-bone-target');
    }
    if(hasVeteranTarget(effect)){
      const carrier=report.effects.find(e=>e.id===effect.sourceVeteranTargetId);
      if(profile.target?.unitClass!==115||definition.TRACE!==1||definition.TRACE_USER_TARGET_FORCE===1||
        carrier&&(carrier.setName!==effect.setName||carrier.name!==veteranTargetSets[effect.setName])||
        !carrier&&effect.active&&!effect.currentAnchor&&!effect.birthAnchor)throw new TypeError('invalid-owner-veteran-target');
    }
    if(effect.sourceShadowMesh){
      // Sword Fall's original four preparation meshes move before becoming
      // damage effects. Admit only their exact IS source identities; a pure
      // visual cannot claim an arbitrary projectile collision controller.
      const boundCarrier=ownerBoneTargets[effect.setName]===effect.name&&definition.BONE_TRACE_TARGET_MESH===1&&
        effectProfile.effectTemplates?.[effect.name]?.fields.MeshType==='X_SKIN_MESH';
      const main=effectProfile.damageEffects?.[effect.name]?.raw?.MAIN_EFFECT_NAME??
        (boundCarrier||stardustMeshMain(effect,effectProfile)===effect.name||effectProfile.target?.unitClass===112&&/^elsword_A_swordFall_M0[2-5]$/.test(effect.name)?effect.name:null);
      if(effect.sourceShadowMesh.name!==main)throw new TypeError('invalid-owner-mesh-template');
    }
    if(effect.sourceFollowLine!=null&&effectProfile.damageEffects?.[effect.name]?.raw?.FOLLOW_LINE!==1)
      throw new TypeError('invalid-owner-follow-line-template');
    if(effect.traceActorId!=null&&context.actors&&!context.actors.some(a=>a.id===effect.traceActorId))throw new TypeError('unknown-owner-effect-trace');
    if(Object.hasOwn(effect,'sourceEffectSetId')){
      const carrier=report.effects.find(e=>e.id===effect.sourceEffectSetId);
      if(carrier&&(carrier.name!==WIND_SLICER_CARRIER||carrier.setName!==WIND_SLICER_SET||carrier.sourceEffectSetId!==carrier.id)||
        hasSetTarget(effect)&&(definition.TRACE_MORE!==1||definition.TRACE_USER_TARGET_FORCE===1)||
        !carrier&&effect.active&&!effect.currentAnchor&&!effect.birthAnchor)throw new TypeError('invalid-owner-effect-set-target');
      // Critical history intentionally carries damage-only identities. Its
      // saved posed anchor remains valid without reintroducing an owner trace.
    }
  }
  for(const action of report.actions??[]){
    if(action.targetViews&&context.actors)for(const view of action.targetViews)if(view.playerId===actor.id||
      !context.actors.some(target=>target.id===view.playerId&&target.team!==actor.team))throw new TypeError('invalid-owner-target-view-player');
    validateOwnedReferences({...report,actor:mergeOwnedActionActor(report.actor,action.actor),effects:action.effects,actions:undefined},actor,profile,map,context);
  }
}
/** Apply only a sender's mutable actor. Effect static data comes from the frozen
 * profile; each receiving victim retains its own collision hit history. */
const receivedOverheatNotices=new WeakMap();
const receivedReflectionNotices=new WeakMap();
// A damage child may outlive the mesh that created it. Keep only the bounded
// source/local identity link after that parent leaves the combat list; without
// it a later owner packet replaces an already-hit predicted child with a new
// damage origin and births its particles a second time. Temporary collision
// histories may consult this table, but must not replace live identity links.
const receivedEffectLinks=new WeakMap();
function effectLinkIndex(state){
  let players=receivedEffectLinks.get(state);if(players)return players;
  players=new Map();const metadata=state.localOwnerEffectLinks,owners=[];
  // The adapter ledger follows a complete combat snapshot, including retired
  // parents. It contains no meshes and is not projected onto owner packets.
  // JSON round trips retain the plain records; the Map is only a local index.
  if(metadata?.version===1&&Array.isArray(metadata.owners))for(const record of metadata.owners){
    if(!state.actors.some(actor=>actor.id===record.playerId)||!Number.isSafeInteger(record.epoch)||record.epoch<0||
      !Number.isSafeInteger(record.frameSeq)||record.frameSeq<0||!plain(record.ids))continue;
    if(players.has(record.playerId))continue;
    const ids=new Map(),savedIds={};for(const [key,link]of Object.entries(record.ids)){
      const id=Number(key);if(!Number.isSafeInteger(id)||id<0||!plain(link)||!Number.isSafeInteger(link.localId)||link.localId<0||
        !Number.isSafeInteger(link.lastFrame)||link.lastFrame<0||typeof link.started!=='boolean')continue;
      ids.set(id,link);savedIds[id]=link;if(ids.size>=MAX_RECENT_OWNER_EFFECT_LINKS)break;
    }
    const saved={playerId:record.playerId,epoch:record.epoch,frameSeq:record.frameSeq,ids:savedIds};owners.push(saved);
    players.set(record.playerId,{epoch:saved.epoch,frameSeq:saved.frameSeq,ids,record:saved});
  }
  if(metadata!==undefined)state.localOwnerEffectLinks={version:1,owners};
  receivedEffectLinks.set(state,players);return players;
}
function effectLinks(simulation,playerId,epoch,remember,frameSeq){
  const players=effectLinkIndex(simulation.state);
  // Simulation.restore replaces the complete state. Historical collisions
  // replace only arrays on that state and therefore retain their live links.
  // A clean snapshot has no ledger; an in-flight snapshot reindexes its own
  // saved ledger. A weak key cannot retain the pre-restore combat snapshot.
  const previous=players.get(playerId);
  if(previous?.epoch===epoch){if(remember)previous.record.frameSeq=previous.frameSeq=Math.max(previous.frameSeq,frameSeq);return previous;}
  const row={epoch,ids:new Map(),frameSeq};
  if(remember&&(!previous||epoch>previous.epoch)){
    const metadata=simulation.state.localOwnerEffectLinks??={version:1,owners:[]};
    const record={playerId,epoch,frameSeq,ids:{}};row.record=record;
    const index=metadata.owners.findIndex(owner=>owner.playerId===playerId);
    if(index<0)metadata.owners.push(record);else metadata.owners[index]=record;
    players.set(playerId,row);
  }
  return row;
}
function rememberEffectLink(row,sourceId,localId,started,frameSeq){
  const prior=row.ids.get(sourceId),link={localId,started:prior?.started===true||started===true,lastFrame:Math.max(prior?.lastFrame??frameSeq,frameSeq)};
  row.ids.delete(sourceId);row.ids.set(sourceId,link);if(row.record)row.record.ids[sourceId]=link;
}
function deleteEffectLink(row,id){
  row.ids.delete(id);if(row.record)delete row.record.ids[id];
}
function retireEffectLinks(row,report){
  const live=new Set();for(const effect of report.effects){live.add(effect.id);if(effect.parentEffectId!=null)live.add(effect.parentEffectId);}
  for(const [id,link]of row.ids)if(!live.has(id)&&link.lastFrame<row.frameSeq-OWNER_ACTION_HISTORY_FRAMES)deleteEffectLink(row,id);
  // Public receive paths accept one strictly increasing report per source
  // frame. This ceiling also bounds direct helpers with repeated frame IDs;
  // live identities and their parents are never selected for eviction.
  if(row.ids.size>MAX_RECENT_OWNER_EFFECT_LINKS)for(const id of row.ids.keys()){
    if(!live.has(id))deleteEffectLink(row,id);if(row.ids.size<=MAX_RECENT_OWNER_EFFECT_LINKS)break;
  }
}
export function ownedEffectLinkDiagnostics(simulation){
  const players=effectLinkIndex(simulation.state);let identities=0,owners=0,maxOwnerIdentities=0;
  if(players)for(const row of players.values()){owners++;identities+=row.ids.size;maxOwnerIdentities=Math.max(maxOwnerIdentities,row.ids.size);}
  return {owners,identities,maxOwnerIdentities,historyFrames:OWNER_ACTION_HISTORY_FRAMES,maxPerOwner:MAX_RECENT_OWNER_EFFECT_LINKS};
}
function receiveReflectionNotice(simulation,playerId,epoch,notice,age,alive){
  if(!notice)return;
  let players=receivedReflectionNotices.get(simulation);
  if(!players){players=new Map();receivedReflectionNotices.set(simulation,players);}
  const previous=players.get(playerId);
  if(previous&&(epoch<previous.epoch||epoch===previous.epoch&&notice.serial<=previous.serial))return;
  players.set(playerId,{epoch,serial:notice.serial});
  if(alive&&notice.remaining>age)simulation.emit?.('projectileReflectionFeedback',playerId,
    {...copy(notice),remaining:notice.remaining-age,sourceProfessionId:simulation.actor(playerId).professionId,networkArrival:true});
}
export function receiveOverheatNotice(simulation,playerId,epoch,notice,age,alive){
  if(!notice)return;
  let players=receivedOverheatNotices.get(simulation);
  if(!players){players=new Map();receivedOverheatNotices.set(simulation,players);}
  const previous=players.get(playerId);
  if(previous&&(epoch<previous.epoch||epoch===previous.epoch&&notice.serial<=previous.serial))return;
  // This receipt belongs to the receiver, outside temporarily restored actors.
  // Keep one latest-life identity per player; stale critical history cannot
  // restart a notice or extend it beyond the sender's remaining lifetime.
  players.set(playerId,{epoch,serial:notice.serial});
  if(alive&&notice.remaining>age)simulation.emit?.('overheatIcon',playerId,{size:notice.size,
    position:copy(notice.position),direction:copy(notice.direction),remaining:notice.remaining-age,networkArrival:true});
}
function receiveTimeRingNotice(simulation,caster,epoch,notice,age){
  const localId=simulation.networkOwnerId;
  if(!notice||localId==null||localId===caster.id)return;
  if(simulation.networkCombatPlaybackVersion===1)return;
  if(simulation.deferAddTimeRingNotices){
    (simulation.pendingAddTimeRingNotices??=[]).push({playerId:caster.id,epoch,notice:copy(notice),age});return;
  }
  const target=simulation.state.actors.find(actor=>actor.id===localId);if(!target)return;
  // This receipt is receiver-local, outside any temporary historical actor
  // substitution. Persist it in trusted snapshots to prevent replay renewals.
  const ledger=simulation.state.localOwnerTimeRingReceipts??={version:1,owners:[]};
  const previous=ledger.owners.find(row=>row.playerId===caster.id);
  if(previous&&(epoch<previous.epoch||epoch===previous.epoch&&notice.serial<=previous.serial))return;
  if(previous)Object.assign(previous,{epoch,serial:notice.serial});
  else ledger.owners.push({playerId:caster.id,epoch,serial:notice.serial});
  applyAddTimeRingToActor(simulation,caster,target,{position:notice.position,remaining:notice.remaining-age});
}
/** A room baseline can replace the recipient after its caster in roster
 * order. Flush only after all actor life epochs have been installed. */
export function flushAddTimeRingNotices(simulation,{discard=false}={}){
  const pending=simulation.pendingAddTimeRingNotices??[];delete simulation.pendingAddTimeRingNotices;
  if(discard)return;
  for(const item of pending){const caster=simulation.state.actors.find(actor=>actor.id===item.playerId);
    if(caster)receiveTimeRingNotice(simulation,caster,item.epoch,item.notice,item.age);
  }
}
export function applyOwnedState(simulation,playerId,report,{effects=true,endMissing=true,presentationAge=0}={}){
  const actor=simulation.state.actors.find(actor=>actor.id===playerId);if(!actor)throw new TypeError('missing-owner-actor');
  const profile=simulation.profileFor?.(actor)??simulation.profile;
  const sameAction=ownedAttackKey(profile,actor)===ownedAttackKey(profile,report.actor);
  const localHits=sameAction?actor.hits:{},localGaps=sameAction?actor.hitGaps:{};
  const blackHoleIds=actor.effectiveBlackHoleIds??[];
  const sameCore=actor.core?.phase===report.actor.core?.phase&&actor.core?.targetId===report.actor.core?.targetId&&actor.core?.attackLevel===report.actor.core?.attackLevel;
  const coreHit=sameCore?actor.core?.hit:false,coreHits=sameCore?actor.core?.hits:{},coreGaps=sameCore?actor.core?.hitGaps:{};
  const currentAwakening=hasNewerContinuousAuraPhase(simulation,playerId,report.epoch,report.frameSeq??0)?copy(actor.awakening):null;
  const currentAuraGroup=currentAwakening&&actor.sourceAwakeningAuraEffectGroup?.map(entry=>({...copy(entry),
    id:simulation.state.effects.find(effect=>effect.ownerId===playerId&&effect.id===entry.id)?.networkId??entry.id}));
  // Clock decode already detaches the actor. Legacy reports need the same
  // isolation: local handle remapping/hit ledgers must never mutate wire input.
  const decodedActor=report.actor.sourceStatusClock?decodeOwnerStatusClock(report.actor,report.frameSeq):copy(report.actor);
  Object.assign(actor,decodedActor,{hits:localHits??{},hitGaps:localGaps??{},effectiveBlackHoleIds:blackHoleIds});
  // The live simulation contains already advanced timers. Keep the marker
  // only on wire reports, so a room snapshot never decodes that base twice.
  delete actor.sourceStatusClock;
  if(currentAwakening)actor.awakening=currentAwakening;
  if(endMissing&&Number.isSafeInteger(report.frameSeq))Object.assign(actor,{networkFrameSeq:report.frameSeq,networkFrameEpoch:report.epoch});
  clearAbsentOwnedLifecycleFields(actor,decodedActor);
  if(currentAuraGroup)actor.sourceAwakeningAuraEffectGroup=currentAuraGroup;
  // The full owner buff list is authoritative, including an empty replacement.
  // Derived locks must not outlive it because of a stale cached control field.
  const controls=buffControls(actor.buffs);
  actor.buffControls={inputBlock:controls.inputBlock,dashBlock:controls.dashBlock};
  const notice=actor.sourceVeteranCommander?.overheatNotice;
  if(profile.target?.unitClass===115)receiveOverheatNotice(simulation,playerId,report.epoch,notice,
    Math.max(0,Number.isFinite(presentationAge)?presentationAge:0),actor.hp>0);
  if(profile.target?.unitClass===101)receiveReflectionNotice(simulation,playerId,report.epoch,actor.sourceReflectionNotice,
    Math.max(0,Number.isFinite(presentationAge)?presentationAge:0),actor.hp>0);
  if(endMissing&&profile.target?.unitClass===126)receiveTimeRingNotice(simulation,actor,report.epoch,actor.sourceTimeRingNotice,
    Math.max(0,Number.isFinite(presentationAge)?presentationAge:0));
  if(endMissing)receiveAddTargetNotice(simulation,actor,report.epoch,actor.sourceAddTargetNotice,
    {presentationAge:Math.max(0,Number.isFinite(presentationAge)?presentationAge:0)});
  if(endMissing)receiveAddStigmaNotice(simulation,actor,report.epoch,actor.sourceAddStigmaNotice,
    Math.max(0,Number.isFinite(presentationAge)?presentationAge:0));
  if(endMissing)receiveElesisFireAbsorbNotice(simulation,actor,report.epoch,actor.sourceElesisFireAbsorbNotice);
  if(endMissing)receiveElesisAvatarScan(simulation,actor);
  if(endMissing)receiveForceFingerResourceNumbers(simulation,actor,report.epoch,actor.sourceForceFingerResourceNumbers,
    {frameSeq:report.frameSeq,presentationAge:Math.max(0,Number.isFinite(presentationAge)?presentationAge:0)});
  if(endMissing)receiveAddMoonlightNotice(simulation,actor,report.epoch,actor.sourceAddMoonlightNotice,
    {powerFor:(a,r)=>simulation.addMoonlightPowerFor(a,r)});
  if(actor.core)Object.assign(actor.core,{hit:coreHit??false,hits:coreHits??{},hitGaps:coreGaps??{}});
  if(actor.stats&&actor.buffBaseStats&&Array.isArray(actor.buffs))synchronizeBuffStats(actor);
  if(!effects)return actor;
  const previous=simulation.state.effects.filter(effect=>effect.ownerId===playerId);
  const linkRow=effectLinks(simulation,playerId,report.epoch,endMissing,report.frameSeq??0),links=linkRow.ids;
  if(endMissing)for(const effect of previous)if(effect.networkEpoch===report.epoch&&effect.networkId!==undefined)
    rememberEffectLink(linkRow,effect.networkId,effect.id,effect.active,links.get(effect.networkId)?.lastFrame??linkRow.frameSeq);
  const retained=simulation.state.effects.filter(effect=>effect.ownerId!==playerId),next=[],claimedSetIds=new Map();
  for(const state of report.effects){
    if(state.sourceContinuousAura&&simulation.continuousAuraVersion>0){
      if(!acceptContinuousAuraState(simulation,playerId,report.epoch,report.frameSeq??0,state)||state.sourceContinuousAura.phase==='ended')continue;
    }
    const effectProfile=state.sourceProfessionId?simulation.profiles[state.sourceProfessionId]:profile;
    const definition=effectProfile&&effectDefinition(effectProfile,state);if(!definition)continue;
    const localParent=state.parentEffectId==null?null:(next.find(effect=>effect.networkId===state.parentEffectId)
      ??previous.find(effect=>effect.networkId===state.parentEffectId&&effect.networkEpoch===report.epoch))?.id??links.get(state.parentEffectId)?.localId;
    // A remote state can advance far enough to create this canonical effect
    // before its next report arrives. Claim its exact source member, retaining
    // victim-local hit receipts rather than creating a second damage origin.
    const old=previous.find(effect=>effect.networkId===state.id&&effect.networkEpoch===report.epoch)
      ??previous.find(effect=>effect.networkId===undefined&&!next.includes(effect)
        &&effect.ownerStateSerial===state.ownerStateSerial&&effect.name===state.name&&effect.setName===state.setName
        &&effect.clock===state.clock&&effect.start===state.start&&(state.parentEffectId==null||localParent!=null)&&effect.parentEffectId===(localParent??null)
        &&JSON.stringify(effect.definition)===JSON.stringify(definition)
        &&(!Object.hasOwn(state,'sourceBoneEffectSetId')||effect.setStartAnimation===state.setStartAnimation&&effect.setStartState===state.setStartState)
        &&(!Object.hasOwn(state,'sourceEffectSetId')||effect.setStartAnimation===state.setStartAnimation&&effect.setStartState===state.setStartState&&
          (!claimedSetIds.has(state.sourceEffectSetId)||claimedSetIds.get(state.sourceEffectSetId)===effect.sourceEffectSetId)&&
          ![...claimedSetIds].some(([remote,local])=>remote!==state.sourceEffectSetId&&local===effect.sourceEffectSetId)));
    if(old&&state.sourceEffectSetId!=null)claimedSetIds.set(state.sourceEffectSetId,old.sourceEffectSetId);
    let effect=old;const remembered=links.get(state.id),wasActive=effect?.active===true||remembered?.started===true;
    if(!effect){
      const before=simulation.state.effects.length;
      effect=simulation.createEffect(actor,copy(definition),{setName:state.setName,clock:state.clock,start:state.start,hyperMode:state.hyperMode??false,sourceDirSpeedSign:state.sourceDirSpeedSign??1,sourceProfessionId:state.sourceProfessionId});
      simulation.state.effects.length=before;
      // Reconstruct collision controls at the transmitted source phase without
      // issuing a second visual birth. A delayed active packet can follow this
      // receiver's original main-mesh end during a network stall.
      if(remembered)effect.id=remembered.localId;
    }
    // Keep the victim's local receipt expiration ahead of a remote Phoenix
    // stage switch, exactly as the local CEffect update does. Repeated stage1
    // reports retain the returning phase's one-shot receipt.
    if(effect.stage!==state.stage)runeSlayerEffectHitMemory(effectProfile,effect,simulation.state.time);
    const stageChanged=effect.stage!==state.stage&&effect.damage?.CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE||
      effect.sourcePhantomSword&&effect.sourcePhantomAttackSerial!==state.sourcePhantomAttackSerial;
    const identity=effect.id,hits=stageChanged?{}:effect.hits??{},gaps=stageChanged?{}:effect.hitGaps??{};
    const sourceMemory=stageChanged?[]:effect.sourceHitMemory2016??[];
    Object.assign(effect,copy(state),{id:identity,ownerId:playerId,networkId:state.id,networkEpoch:report.epoch,
      networkFrameSeq:report.frameSeq??effect.networkFrameSeq,hits,hitGaps:gaps,sourceHitMemory2016:sourceMemory});
    if(state.sourceAddSummonPose){
      if(typeof simulation.summonPoseSampler!=='function')throw new TypeError('add-summon-pose-sampler-required');
      const npc=actor.sourceAddSummon;
      const sample=pose=>{
        const anchor=simulation.summonPoseSampler(pose,effect.definition,actor);
        if(!anchor||!vector(anchor.position)||!vector(anchor.rotation)||!Array.isArray(anchor.matrix)||
          anchor.matrix.length!==16||!anchor.matrix.every(Number.isFinite))throw new TypeError('add-summon-pose-bone-required');
        return {...copy(anchor),customPosition:true};
      };
      // Keep the packet's immutable historical birth; reconstruct only its
      // current independent NPC pose. Null/missing bones never use caster data.
      effect.currentAnchor=sample(npc);effect.sourcePosedAnchor=copy(effect.currentAnchor);
      [effect.x,effect.y,effect.z]=effect.currentAnchor.position;effect.facing=npc.facing;
    }
    if(endMissing){rememberEffectLink(linkRow,state.id,identity,wasActive||effect.active,report.frameSeq??0);
      const parent=links.get(state.parentEffectId);if(parent)parent.lastFrame=Math.max(parent.lastFrame,report.frameSeq??0);}
    if(profile.target?.unitClass===115)effect.initialDirSpeed=(profile.effectTemplates[effect.mainEffectName]?.initialDirSpeed??0)*(state.sourceDirSpeedSign??1);
    restoreArcControls(effect,actor);
    restoreAddPrismAnimation(effect);
    restoreElesisEffectControls(effectProfile,actor,effect);
    restoreBloodCutterControls(effectProfile,effect);
    restoreAddStardustMesh(effect,effectProfile);
    phantomSwordEffectControls(profile,actor,effect);
    if(effect.active&&!wasActive&&simulation.emit){
      simulation.emit('effectStarted',playerId,{effectId:effect.id,name:effect.name,setName:effect.setName,skillId:effect.skillId,
        definition:copy(effect.definition),birthAnchor:copy(effect.birthAnchor),ownerStateSerial:effect.ownerStateSerial,deleteConditions:copy(effect.deleteConditions),
        sourceShadowMesh:!!effect.sourceShadowMesh,sourceArcMesh:!!effect.sourceArcHandle,sourceArcStartMesh:!!effect.sourceArcStartMesh,sourceXCrashMeshClock:!!effect.sourceXCrashMeshClock,
        sourcePhantomSword:!!effect.sourcePhantomSword,sourceISSheath:!!effect.sourceISSheath,
        sourceSetTargetMesh:effect.sourceSetTargetMesh,sourceTargetMeshBound:hasSetTarget(effect)||hasVeteranTarget(effect),
        sourceBoneTargetMeshBound:hasSetMeshBoneTarget(effect),...(effect.sourceProfessionId?{sourceProfessionId:effect.sourceProfessionId}:{}),
        ...(effect.buffTemplateId!=null?{buffTemplateId:effect.buffTemplateId}:{}),networkArrival:true});
      const entries=damageStartParticleEntries(effect.damage);if(entries.length)simulation.emit('effectStartParticles',playerId,{effectId:effect.id,name:effect.name,entries,
        mainAnchor:copy(effect.currentAnchor??effect.birthAnchor),impactPoint:[...(effect.lastImpactPoint??[0,0,0])],networkArrival:true});
    }
    next.push(effect);
  }
  // A newer reliable birth/phase may precede an older full body. Keep its
  // collider before remapping the actor's authored effect group to local IDs.
  if(endMissing)for(const old of previous)if(!next.includes(old)&&isManagedContinuousAura(old)&&
    retainNewerContinuousAura(simulation,playerId,report.epoch,old,report.frameSeq??0))next.push(old);
  // Network effect IDs are scoped to one browser. Rewrite links to this
  // receiver's unique effect IDs, including custom command effect handles.
  const ids=new Map(next.map(effect=>[effect.networkId,effect.id]));
  for(const effect of next)if(effect.parentEffectId!=null)effect.parentEffectId=ids.get(effect.parentEffectId)??links.get(effect.parentEffectId)?.localId??null;
  for(const effect of next)for(const key of ['sourceEffectSetId','sourceTargetMeshId','sourceBoneEffectSetId','sourceBoneTargetMeshId','sourceVeteranTargetId'])if(Object.hasOwn(effect,key))effect[key]=ids.get(effect[key])??null;
  if(actor.sourceAddNative){
    actor.sourceAddNative=actor.sourceAddNative.filter(row=>{
      if(row.kind==='starfall'){
        row.rows=row.rows.filter(q=>ids.has(q.carrierId)).map(q=>({...q,carrierId:ids.get(q.carrierId)}));
        row.handles=row.rows.map(q=>q.carrierId);return row.rows.length>0;
      }
      if(row.kind==='chaser'){
        const id=ids.get(row.attackerId);if(id===undefined)return false;
        row.attackerId=id;row.handles=[id];return true;
      }
      const rupture=ids.get(row.ruptureId);if(rupture===undefined)return false;
      const carrier=row.carrierId===null?null:ids.get(row.carrierId);
      if(row.active&&carrier===undefined)return false;
      row.ruptureId=rupture;row.carrierId=carrier??null;row.attackIds=row.attackIds.filter(id=>ids.has(id)).map(id=>ids.get(id));
      row.handles=[rupture,...(row.carrierId===null?[]:[row.carrierId]),...row.attackIds];return true;
    });
  }
  for(const key of ['sourceWayOfSwordEffectGroup','sourceWildChargeEffectGroup','sourceAwakeningAuraEffectGroup','sourceCustomStateEffectGroup','sourceDashJumpEffectGroup'])
    if(Array.isArray(actor[key]))actor[key]=actor[key].filter(entry=>ids.has(entry.id)).map(entry=>({...entry,id:ids.get(entry.id)}));
  if(actor.sourceArcEnemy?.effectIds)actor.sourceArcEnemy.effectIds=Object.fromEntries(Object.entries(actor.sourceArcEnemy.effectIds)
    .filter(([,id])=>ids.has(id)).map(([handle,id])=>[handle,ids.get(id)]));
  for(const key of ['megaEffects','windmillEffects'])if(Array.isArray(actor.sourceLordKnight?.[key]))
    actor.sourceLordKnight[key]=actor.sourceLordKnight[key].filter(id=>ids.has(id)).map(id=>ids.get(id));
  for(const key of ['groundEffects','airEffects'])if(Array.isArray(actor.sourceRuneSlayer?.[key]))
    actor.sourceRuneSlayer[key]=actor.sourceRuneSlayer[key].filter(id=>ids.has(id)).map(id=>ids.get(id));
  if(actor.sourceElesisSkills){
    const skill=actor.sourceElesisSkills;
    for(const key of ['drasticEffects','dreadEffects','extinctionEffects','juggernautEffects','stigmaEffects'])
      if(Array.isArray(skill[key]))skill[key]=skill[key].filter(id=>ids.has(id)).map(id=>ids.get(id));
    if(skill.roseId!=null){const id=ids.get(skill.roseId);if(id)skill.roseId=id;else delete skill.roseId;}
  }
  if(Array.isArray(actor.sourceBladeMaster?.blackHoleEffectIds))
    actor.sourceBladeMaster.blackHoleEffectIds=actor.sourceBladeMaster.blackHoleEffectIds.filter(id=>ids.has(id)).map(id=>ids.get(id));
  if(actor.sourceVeteranCommander){
    actor.sourceVeteranCommander.heatEffects=actor.sourceVeteranCommander.heatEffects.filter(id=>ids.has(id)).map(id=>ids.get(id));
    if(actor.sourceVeteranCommander.flameEffect){const id=ids.get(actor.sourceVeteranCommander.flameEffect);if(id)actor.sourceVeteranCommander.flameEffect=id;else delete actor.sourceVeteranCommander.flameEffect;}
  }
  if(actor.sourceInfinitySword){
    const sword=actor.sourceInfinitySword;
    for(const key of ['shieldEffectIds','blastingEffectIds'])if(Array.isArray(sword[key]))sword[key]=sword[key].filter(id=>ids.has(id)).map(id=>ids.get(id));
    // Falling swords release by their authored slot; removing an expired first
    // blade must not shift every still-live later blade into the wrong slot.
    if(Array.isArray(sword.swordFallEffectIds))sword.swordFallEffectIds=sword.swordFallEffectIds.map(id=>ids.get(id)??null);
    for(const key of ['harshEffectId','phantomSheathId','finalStrikeEffectId'])if(sword[key]!=null){const id=ids.get(sword[key]);if(id)sword[key]=id;else delete sword[key];}
    if(sword.phantomSword){sword.phantomSword.effectId=ids.get(sword.phantomSword.effectId);sword.phantomSword.centerId=ids.get(sword.phantomSword.centerId);}
  }
  if(endMissing)for(const old of previous)if(!next.includes(old)){
    if(simulation.continuousAuraVersion>0&&isManagedContinuousAura(old))acceptContinuousAuraState(simulation,playerId,report.epoch,report.frameSeq??0,
      {id:old.networkId??old.id,sourceContinuousAura:{version:simulation.continuousAuraVersion,revision:old.sourceContinuousAura.revision+1,phase:'ended'}});
    retireIonBlackHole(old,simulation.state.actors);
    retireElesisShadowLink(simulation,old);
    if(old.active&&simulation.emit)simulation.emit('effectEnded',playerId,{effectId:old.id,name:old.name,setName:old.setName,reason:'network-owner-effect-ended'});
  }
  simulation.state.effects=[...retained,...next];
  if(endMissing&&!next.some(effect=>isManagedContinuousAura(effect)&&effect.active&&!effect.dead))
    observeContinuousAuraAbsence(simulation,playerId,report.epoch,report.frameSeq??0);
  for(const effect of simulation.state.effects)if(!effect.dead)retireReflectedSource(simulation,effect);
  retireReflectionReceipts(simulation);
  if(endMissing)retireEffectLinks(linkRow,report);
  if(profile.target?.unitClass===121)receiveBlazeWingHistory(simulation,playerId,report,{endMissing});
  return actor;
}
