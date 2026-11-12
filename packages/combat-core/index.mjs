import {captureContactObservation,contactObservation,ownedContactGeometry} from './contact-observation.mjs';
import {observeRemoteDamage} from './observed-damage.mjs';
import {isContinuousRavenAura,isManagedContinuousAura} from './continuous-aura.mjs';
import {stateWindows as windows} from './state-windows.mjs';
/**
 * Shared target-data executor. No renderer, browser, timer, networking or global RNG.
 * This is a research simulation, not a passed target-client fidelity baseline.
 * All time is seconds; position is native LineMap units, Y up, left-handed XYZ.
 */
import { collisionPoint } from './collision.mjs';
import {isElswordProfile,isElesisProfession,isElesisProfile,professionIdForProfile} from '../professions/identity.mjs';
import {isAddActor,initializeAddSystems,advanceAddSystems,addFormationAvailability,beginAddFormation,activateAddFormation,stopAddFormation,addHitResources,commitAddSkillResources,applyAddTimeRing,tryAddTimeRingRevive,addHitMpMultiplier,addNaturalMpRecoveryRate,applyAddCooldownProc,consumeAddMutation,gainAddMutation,changeAddDp} from './add-systems.mjs';
import {addMotionDefinition} from './add-motion.mjs';
import {applyAddFormationSourceClock} from './add-awakening-v45.mjs';
import {advanceAddMovement,addMovementInput,endAddMovement,releaseAddAirAttack} from './add-movement.mjs';
import {addCommands} from './add-commands.mjs';
import {addEvents,addCastState,addSkillEvent,addSkillAnimationMultiplier} from './add-skills.mjs';
import {addAcceptedHit,addStateStart,addDamageModifiers} from './add-nasod.mjs';
import {tickLPZxTier} from './add-lp-zx-tier-v61.mjs';
import {ADD_BARRIER_STATE,addBarrierEligible} from './add-barrier.mjs';
import {addDroneMarkContact,tickAddDroneMark} from './add-drone-mark.mjs';
import {addMarkedDroneMotionData,initializeAddMarkedDroneMesh} from './add-drone-lock.mjs';
import {commitAddFantasyTracer,tickAddFantasyTracer,addFantasyTracerAcceptedHit,finishAddFantasyTracer} from './add-fantasy-tracer.mjs';
import {endAddQuicksilverLink,updateAddQuicksilverLink} from './add-quicksilver-link.mjs';
import {tickAddFactory} from './add-factory.mjs';
import {tickAddPanzer} from './add-panzer-v57.mjs';
import {tickAddFury} from './add-fury.mjs';
import {endAddSpaceCrack} from './add-space-crack-2016.mjs';
import {addMmLot6Contact} from './add-mm-lot6-2016.mjs';
import {bindAddCountdownShake,tickAddCountdownShake} from './add-countdown-shake-2016.mjs';
import {addAwakeningAttackShapes} from './add-awakening-2016.mjs';
import {prismHitTargets,applyPrismTargetDamage,blockAddPrismUnits} from './add-prism-endpoints-2016.mjs';
import {createAddDePredictionPhysics,queueAddDePhysicalState,flushAddDePhysicalState} from './add-de-prediction-2016.mjs';
import {createDePhysicalObjects2016} from './de-physical-objects-2016.mjs';
import {ADD_FURY_DRONE} from './add-linked-effect-state.mjs';
import {tickAddNativeSkills,advanceAddChaserProjectile,addShootingChaserContact,isAddNativeOwnedEffect,CHASER_ATTACKER,endAddStardust} from './add-analysis-skills.mjs';
import {isMagnetronOrbit,tickAddMagnetron,addMagnetronAcceptedHit} from './add-magnetron.mjs';
import {advanceAddLockOn,ADD_UID_LOCK_ON_EFFECTS} from './add-lock-on.mjs';
import {tickMaximumStrike,fireMaximumStrike,maximumStrikeAcceptedHit,endMaximumStrike,updateMaximumStrikeOrb} from './add-maximum-strike.mjs';
import {isMaximumStrikeShot,maximumStrikeNextStage,maximumStrikeHitCompleted} from './add-maximum-strike-native-v53.mjs';
import {endAddPersistentSkill,isAddPersistentEffect} from './add-persistent-skills.mjs';
import {filterAddVoidAttackInput,restoreAddVoidBoundPosition} from './add-void-binding-v57.mjs';
import {tickAddRecasts,addStasisDamageObserved} from './add-recasts.mjs';
import {tickAddPassiveBuffs,applyAddMindControlRefund} from './add-passives.mjs';
import {installAddCorePassiveSource2016,addCoreFormationBuffs2016,advanceAddCorePassives2016,addCoreArmorFeedback2016,applyAddInstallationExtension2016} from './add-core-passives-v56.mjs';
import {addPassiveSample2016} from './add-passive-sample-2016.mjs';
import {addDynamoInstanceDefinition,isOriginalFissionSplit,inheritAddFissionDroneLock} from './add-dynamo-effect-state.mjs';
import {startAddApocalypse,finishAddApocalypse,triggerAddApocalypseEmergency,tickAddSummons,updateAddSummonEffectAnchor,npcHitTargets,applyAddSummonDamage,inheritAddSummonEffectState} from './add-summons.mjs';
import {moveAddSummonProjectile,isAddSummonProjectile} from './add-summon-projectiles.mjs';
import {addSummonCombatActor,computeAddSummonHitDamage} from './add-summon-damage.mjs';
import {effectSourceProfile,tryReflectProjectile,reflectedDisplacement,retireReflectedSource,retireReflectionReceipts} from './projectile-reflection.mjs';
import {rfGroundPickupOwner} from './reaction-owner-policy.mjs';
import {downSupportReaction} from './down-support.mjs';
import {captureCancelInput,releaseCancelInput,cancelInputStateChange} from './direction-buffer.mjs';
import {targetZzxBackwardCancel,targetZzzBackwardCancel,RF_BACKWARD_CANCEL_VERSION} from './direction-cancel-candidates.mjs';
import {freeAirInputDirection,prioritizeHorizontalInput} from './air-direction.mjs';
import {orderedPlatformAttack,releasePlatformAttack} from './platform-attack-input.mjs';
import {XXX_CANDIDATE,beginXxxCandidate,resolveXxxCandidate,endXxxCandidate} from './xxx-candidate.mjs';
import {originalSkillEvent,originalSkillFrame,originalSkillFuture,originalSkillEnd,originalSkillStart} from './active-skills.mjs';
import {skillTraitDamageData,scaleSkillAttackShapes,skillTraitBuffFactor,applySkillTraitMeshLifetime,appliedSkillTraitPolicy,appliedSkillTraitPower} from './skill-traits.mjs';
import {SKILL_SLOT_KEYS,SKILL_FREE_STATES,evaluateSkillAvailability,skillInputBlockReason} from './skill-availability.mjs';
import {arcNativeInput} from './skill-candidates.mjs';
import {arcLineBasis,advanceArcMesh,nearestLockOnPoint,initializeArcStartMesh,advanceArcStartMesh,advanceArcController} from './archenemy-mesh.mjs';
import {isAddPrismTemplate,advanceAddPrismAnimation} from './add-prism-animation-v45.mjs';
import {isAddC4Display,updateAddC4Display} from './add-c4-display-v45.mjs';
import {ADD_COMMON_BONE_TARGETS,addPrismSetExpired} from './add-prism-v45.mjs';
import {addPrismProjectDefinition} from './add-prism-project-rules-v57.mjs';
import {initializeShadowStepCandidate,shadowStepCandidateInput,advanceShadowStepCandidate,shadowStepCandidateFrame,shadowStepCandidateEvent,shadowStepCandidateEnd} from './shadow-step.mjs';
import {initializeActorPassives,applyStatPassives,modifyOutgoingHit,modifyReceivedHit,modifyHitMpGain,onHit as passiveOnHit,awakeningDurationPlan,awakeningCoreReturnPlan} from './passives.mjs';
import {applyTargetPassiveAttributes,applyEquipmentDamageReduction,awakeningChargeMultiplier,receivedMpGain,explodingHandSelfBuff,passiveBuffHitCount,synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {initializeGuildSkills,installGuildBuffs,applyGuildStatPassives,guildGainModifiers,guildCriticalCounterRequest,startGuildRecovery,stepGuildRecovery,guildOnDeath,processGuildHeroSacrifice} from './guild-skills.mjs';
import {advanceTraceMeshPose,usesSourceTracePosition} from './trace-mesh-phase.mjs';
import {WIND_SLICER_SET,isWindSlicerCarrier,bindWindSlicerSet,hasSetTarget,initializeWindCarrier,windSlicerBirthAnchor,advanceWindSlicerSets,windSlicerVisualLifetime} from './lk-wind-slicer.mjs';
import {LK_BONE_TARGETS,ELESIS_BONE_TARGETS,ADD_BONE_TARGETS,ADD_ANALYSIS_BONE_TARGETS,bindLKSetMeshTargets,hasSetMeshBoneTarget,sampleSetMeshBoneAnchor} from './lk-effect-set-targets.mjs';
import {damageStartParticleEntries,damageTimedParticleEntries} from './damage-start-particles.mjs';
import {resolveHitSound,damageEffectSoundEntries} from './hit-audio.mjs';
import {veteranResidualHitAudioMuted,allowVeteranResidualChild} from './vc-effect-policy-v8.mjs';
import {stateProtectionOptions} from './user-state-protection.mjs';
import {lordKnightCastState,lordKnightCast,lordKnightStateStart,lordKnightStateEnd,lordKnightFrame,lordKnightEvents,lordKnightSkillEvent,lordKnightCharacterDamage,lordKnightCharacterAttackTimers,lordKnightCharacterAttackStage,lordKnightCounter,lordKnightAutoGuard,lordKnightDebuffApplied,lordKnightCastDisplayClock,lordKnightPendingCastSword} from './lk-skills.mjs';
import {STANDUP_ATTACK_STATES,STANDUP_INPUT_STATES,installStandupStates,queueStandupAttack,queueStandupRolling,standupRollingEvent,standupStateStart,standupStateEnd,standupHitPolicy} from './standup-policy.mjs';
import {bindVeteranTargetSet,hasVeteranTarget,updateVeteranTarget,veteranTargetLifetime} from './vc-target-mesh.mjs';
import {createVeteranCommands,vcCommandSkillCancelAllowed,vcCommandAirDashCancelDirection,vcRememberAirFollowup,vcCommandAirFollowupFuture} from './vc-commands.mjs';
import {isVeteran,veteranCastState,veteranStart,veteranEnd,veteranEvents,veteranSkillEvent,veteranPassives,veteranAcceptsOverheatInput,veteranAirSkillFuture,veteranEffectFactoryPower} from './vc-skills.mjs';
import {vcAirSkillCancelAllowed,vcSkillCommandCancel} from './vc-air-skills.mjs';
import {skillCommandCancel,skillMacroAwakeningAllowed,afterCancel,SKILL_COMMAND_CANCEL_VERSION} from './skill-command-cancels.mjs';
import {ravenCommandCancel,RAVEN_COMMAND_CANCEL_VERSION} from './raven-command-cancels.mjs';
import {runRavenLocalCommandPost} from './raven-local-command-v56.mjs';
import {advanceRavenSocketMp} from './raven-socket-mp-v56.mjs';
import {veteranAttachmentKey} from './vc-effect-bindings.mjs';
import {createBladeMasterCommands} from './bm-commands.mjs';
import {resolveEffectTemplateKey} from '../combat-assets/effect-template-key.mjs';
import {isBladeMaster,bladeMasterCastState,bladeMasterCast,bladeMasterStart,bladeMasterEnd,bladeMasterEvents,bladeMasterFrame,bladeMasterFuture,bladeMasterSkillEvent,bladeMasterAcceptedHit,bladeMasterReaction} from './bm-skills.mjs';
import {advanceLiteralMeshClock,nextEffectDamageStage,effectStageDamageData,singlePlayMeshPeriod,prepareSinglePlayMeshEnd} from './literal-mesh-clock.mjs';
import {isFiniteVisualBirth} from './finite-visual-birth.mjs';
import {COMBO_STOP_INPUT_VERSION,captureComboStopInput,replayComboStopInput} from './combo-stop-input.mjs';
import {RF_COMMAND_FALLBACK_VERSION,rfCommandFallbackEvent} from './rf-command-fallback.mjs';
import {hasEffectiveBlackHole,updateIonBlackHole,retireIonBlackHole,consumeBlackHoleDisplacement,correctBlackHoleWall} from './black-hole.mjs';
import {createBuffFromFactor,mergeBuffs,tickBuffs,consumeBuffHit,installCommonBuffs,clearReceivedHitStun,buffControls,isBuffActive,buffDisplaySets,buffAttackTypeMultiplier} from './buffs.mjs';
import {presentationRandom} from './presentation-random.mjs';
import {projectRemoteBuffResources} from './buff-network-view.mjs';
import {synchronizeStunState} from './stun.mjs';
import {REACTION_REFERENCE,createKnockdownGauge,reserveKnockdown,forceDownContribution,knockdownStateStarted,
  commitKnockdown,advanceKnockdown,requestKnockdown,consumeKnockdown,resetAttackerKnockdown,nextFlyCount,
  attackerIsFront,reactionLocalBackSpeed,selectHitReaction,airSmallStartFuture,groundHitReactionNext,knockdownThresholdReaction,airborneReactionNext,deathState,
  createDeathPresentation,advanceDeathPresentation,nativeBodyPassBlocked,nativeBodyPushCandidate,isDamagedReaction,defenderHitStopOverride,attackerHitStopOverride,attackerHitStopExcluded} from './reaction-policy.mjs';
import {evaluateStateProtection,shouldDeleteDamageReactEffects} from './state-protection.mjs';
import {createInvulnerabilityDisplay,advanceInvulnerabilityDisplay} from './invulnerability-display.mjs';
import {resolveSpeedAttributes,sourceScaledSpeed} from './speed-attributes.mjs';
import {equipmentAttributeContext,composeEquipmentCombatStats,usesPvpEquipmentFormulas} from './equipment-attributes.mjs';
import {applySourcePvpStatPassives} from './source-equipment-base.mjs';
import {composeEquipmentSpeedAttributes} from './equipment-speed-formulas.mjs';
import {computePvpBaseDamage,applyPvpFinalDamageStage,applyPvpEquipmentReduction} from './pvp-damage-formulas.mjs';
import {consumePvpResourceFrame,pvpMpGain,pvpAwakeningGain,pvpAwakeningEligible,naturalMpGain} from './pvp-resource-formulas.mjs';
import {actionAnimationSpeed,isHurtAnimation} from './action-animation-speed.mjs';
import {resolveDamageValues} from './damage-values.mjs';
import {addKnownDamageData} from './add-damage-values.mjs';
import {evaluateHitCritical} from './critical-hit.mjs';
import {createManaBreak,advanceManaBreak,manaBreakEvent,reserveManaBreak,manaBreakStateStart,manaBreakDamageReact,clearRegisteredStunIdentities,holdManaBreakDown,resumeManaBreakDown,MANA_BREAK_SOURCE} from './mana-break.mjs';
import {sampleManaBreakIntent,MANA_BREAK_HOLD_INTENT_VERSION} from './mana-break-intent-v62.mjs';
import {prepareRuneLunaContact,settleRuneLunaContact,RS_LUNA_PROJECT_VERSION} from './rs-luna-project-v62.mjs';
import nasodTarget from '../../contracts/rf-nasod-target-v11.json' with {type:'json'};
import {SHADOW_MESH_NAMES,LITERAL_MESH_NAMES,createShadowMesh,createLiteralMesh,stepShadowMesh,refreshShadowMeshLand,followLiteralMeshLine,allowDieDamageChild} from './shadow-mesh.mjs';
import {NASOD_GUARD_SOURCE,parryStates,nasodSnapshot,evaluateNasod,applyNasodResult,restoreNasodHelper} from './nasod-guard.mjs';
import {usesElesisLiteralMesh,elesisLiteralMotionRotation} from './elesis-literal-meshes.mjs';
import {usesAddLiteralMesh,addLiteralMotionRotation,addLiteralMotionEvents} from './add-literal-meshes.mjs';
import {addEspDamageMultiplier2016} from './add-mind-passives-2016.mjs';
import {stardustMeshMain,initializeAddStardustMesh,resolvedAddStardustTemplate} from './add-stardust-mesh-v56.mjs';
import {updateBloodCutterAnchor,tickBloodCutterRequests} from './elesis-blood-cutter.mjs';
import {tickElesisFirewalls} from './elesis-firewall-v45.mjs';
import {NASOD_ATTACK_SOURCE,prepareNasodAttack,launchNasodAttack,advanceNasodMesh,advanceNasodUnlock,canTriggerArchenemy,positionNasodIdle} from './nasod-attack.mjs';
import {canRepeatHit,rememberHit,appendSourceHitMemory2016,sourceHitMemoryContains2016,tickSourceHitMemory2016} from './hit-gap-memory.mjs';
import {claimEffectGroupHit,retireEffectGroupHits,initializeSourceGroupMemory2016,tickEffectGroupHits2016,retireRemovedGroupTargets2016} from './effect-group-damage.mjs';
import {currentSourceMiss2016,SOURCE_MISS_SEED_POLICY} from './source-miss-host-v53.mjs';
import {xCrashMeshTransform} from './xcrash-mesh-transform.mjs';
import {initializeGMSpawnRotation} from './gm-sword-spawn-instance.mjs';
import {createWayOfSword,wayOfSwordFields,advanceWayOfSword,wayOfSwordHitDelta,wayOfSwordReceivedDelta,lordKnightDamageData} from './lord-knight.mjs';
import {lordKnightCommands} from './lk-commands.mjs';
import {elesisCommands,elesisCommandExternalSkillAllowed,elesisCommandEvents,elesisDownInput} from './elesis-commands.mjs';
import {elesisCastState,elesisCast,elesisStart,elesisEnd,elesisFrame,elesisEvents,elesisSkillEvent,elesisSkillExternalSkillAllowed,elesisAttackTimers,elesisDamageData,elesisOnHit,elesisAutoGuard,elesisReceived,elesisDebuffApplied,elesisPrepareHit,elesisTransformationEffectList,tickElesisShadowLinks,elesisNoDownHit,elesisHitFinalized} from './elesis-skills.mjs';
import {installElesisFeedbackSource} from './elesis-feedback-source-v45.mjs';
import {installAddMoonlightSource} from './add-moonlight-source-v45.mjs';
import {installAddDeCommandSource} from './add-de-command-v45.mjs';
import {installRavenCommandSource,ravenCommandDamageData,ravenSourceCommandResult} from './rf-command-source-v53.mjs';
import {withSourcePostRequests,requestSourceState,applySourceStateRequest,applyRequestedSkillContext} from './source-state-requests-v53.mjs';
import {runSourceCommonPost} from './common-cancel-post-v53.mjs';
import {sourcePostSkillDispatch} from './common-cancel-post-v53.mjs';
import {historicalSourcePostRow,sourceCancelProfile} from './source-cancel-fields-v53.mjs';
import {runHistoricalExplicitPost} from './historical-cancel-post-v53.mjs';
import {sourceStopDuration,sourceStopRadii,SOURCE_STOP_DISTANCE_VERSION} from './source-stop-distance-v45.mjs';
import {requestActorStop,advanceActorStops,resetActorStopCache} from './source-stop-queues-v53.mjs';
import {sourceSoundEventMetadata,sourceEffectSoundEventMetadata,sourceSoundPositionMetadata} from './source-sound-event-v45.mjs';
import {getSourceExtendedSoundEntries} from './source-extended-sound-v61.mjs';
import {rememberAddMoonlightOrigins,finalizeAddMoonlightContact,addMoonlightHitParameters,addMoonlightPowerFor} from './add-moonlight-receipts-v45.mjs';
import {isBlazeWingLockOn,advanceBlazeWingLockOn} from './bh-blaze-wing-lock-on.mjs';
import {elesisWaitDefinition,elesisSwordHitPolicy,elesisSwordDamage,elesisSwordAttackDelta,elesisSwordReceivedDelta,synchronizeElesisSword,advanceElesisBreakCharge,elesisBreakEligible,elesisEnduranceEligible,elesisEnduranceCast,startElesisBurst,elesisSwordOnHit,elesisSwordEvent} from './elesis-way-of-sword.mjs';
import {infinitySwordCommands} from './is-commands.mjs';
import {isInfinitySword,infinitySwordStart,infinitySwordEnd,infinitySwordFrame,infinitySwordEvents,infinitySwordSkillEvent,infinitySwordAttackTimers,infinitySwordDamageData,infinitySwordCounter,infinitySwordOnHit} from './is-skills.mjs';
import {infinitySwordSheathStart,infinitySwordSheathEvents} from './is-sheath.mjs';
import {phantomSwordSync,phantomSwordStateStart,phantomSwordStateEnd,phantomSwordFrame,phantomSwordEffectControls} from './is-phantom-sword.mjs';
import {isAdditionalAttackDamage} from './is-additional-attack.mjs';
import {lordKnightWaitDefinition,wayOfSwordHitPolicy,wayOfSwordReceivedMpMultiplier,wayOfSwordRageEligible,advanceDestructionRage,preserveDestructionArmor,synchronizeWayOfSwordPresentation,startDestructionRage,ownsWayOfSwordBodyEffect} from './lk-way-of-sword.mjs';
import {runeSlayerCommands} from './rs-commands.mjs';
import {runeSlayerStateStart,runeSlayerStateEnd,runeSlayerEvents,runeSlayerFrame,runeSlayerSkillEvent,runeSlayerAcceptedHit,runeSlayerAbsorbProjectile,runeSlayerEffectDamage,runeSlayerEffectHitMemory,runeSlayerOwnsLanding,runeSlayerVortex} from './rs-skills.mjs';
import {translateAlongLine,translateMotionOffset,groundedBodyPushPoint,advanceMapMechanics,createMapMechanics,jumpPlatformRequest} from './map-mechanics.mjs';
export const CORE_VERSION='profession-executor-twelve-target2016-v56-analysis-skills-feedback';
const deathStates=new Set(['RSI_DIE_FRONT','RSI_DIE_BACK']);
const damageAirStates=new Set(['RSI_DAMAGE_AIR_SMALL','RSI_DAMAGE_AIR_UP','RSI_DAMAGE_AIR_FALL','RSI_DAMAGE_AIR_DOWN','RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_FLY_FRONT','RSI_DAMAGE_AIR_FLY_BACK']);
const S = Object.freeze({
  wait: 'RSI_WAIT', swordWait:'ESSI_SWORD_WAIT', walk: 'RSI_WALK', dash: 'RSI_DASH', dashEnd: 'RSI_DASH_END',
  jumpReady: 'RSI_JUMP_READY', jumpUp: 'RSI_JUMP_UP', jumpDown: 'RSI_JUMP_DOWN',
  land: 'RSI_JUMP_LANDING', dashJump: 'RSI_DASH_JUMP', dashLand: 'RSI_DASH_JUMP_LANDING',
  powerLand: 'RSI_DASH_JUMP_POWER_LANDING',
  awaken: 'RSI_HYPER_MODE', parry: 'RSI_PARRYING', down: 'RSI_DAMAGE_DOWN_FRONT',
  stand: 'RSI_DAMAGE_STANDUP_FRONT', fly: 'RSI_DAMAGE_AIR_FLY_FRONT',
  airDown: 'RSI_DAMAGE_AIR_DOWN', airLand: 'RSI_DAMAGE_AIR_DOWN_LANDING',
  small: 'RSI_DAMAGE_SMALL_FRONT', big: 'RSI_DAMAGE_BIG_FRONT',
});
const free = new Set(SKILL_FREE_STATES);
const air = new Set([S.jumpUp, S.jumpDown, S.dashJump, S.fly, S.airDown, 'RSI_DAMAGE_AIR_FLY_BACK','RSI_DAMAGE_AIR_SMALL', 'RSI_JUMP_COMBO_Z', 'RSI_JUMP_COMBO_X', 'RSI_DASH_JUMP_COMBO_Z', 'RSI_DASH_JUMP_COMBO_ZZ', 'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX', 'RRF_DASH_JUMP_COMBO_X', 'RRF_DASH_JUMP_COMBO_XX']);
const holdAirAnimation = new Set(['RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X','RSI_DASH_JUMP_COMBO_Z','RSI_DASH_JUMP_COMBO_ZZ','RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX','RRF_DASH_JUMP_COMBO_XX']);
const slotKeys = SKILL_SLOT_KEYS;
const clone = x => structuredClone(x);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (n, name) => { if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`); return n; };
const array = v => Array.isArray(v) ? v : Object.keys(v ?? {}).filter(k => /^\d+$/.test(k)).sort((a,b) => +a - +b).map(k => v[k]);
const crossed = (before, after, t) => before <= t && after >= t && after > before;
const inWindow = (time, w) => w && time >= w['1'] && time < w['2'];
const normalizedInput = v => {
  const norm = x => new Set(Array.from(x ?? [], k => String(k).toUpperCase()));
  const out = { held: norm(v?.held), pressed: norm(v?.pressed), released: norm(v?.released) };
  // Aliases are adapter conveniences, not an original key binding assertion.
  for (const set of Object.values(out)) {
    if (set.has('ARROWLEFT')) set.add('LEFT'); if (set.has('ARROWRIGHT')) set.add('RIGHT');
    if (set.has('ARROWUP')) set.add('UP'); if (set.has('ARROWDOWN')) set.add('DOWN');
    if (set.has('CONTROL') || set.has('CTRL')) set.add('AWAKEN');
  }
  out.sampledDevice=v?.sampledDevice===true;
  const doubles=norm(v?.pureDouble);
  out.pureDoubleRight=doubles.has('RIGHT');out.pureDoubleLeft=doubles.has('LEFT');
  out.oneDoubleX=norm(v?.oneDouble).has('X');
  return prioritizeHorizontalInput(out);
};

function sampleMotion(state, t) {
  const m = state?.rootMotion;
  if (!m?.timesSeconds?.length) return [0, 0, 0];
  const times = m.timesSeconds, p = m.positionsGltf;
  if (t <= times[0]) return [p[0][0], p[0][1], -p[0][2]];
  if (t >= times.at(-1)) return [p.at(-1)[0], p.at(-1)[1], -p.at(-1)[2]];
  let hi = 1; while (times[hi] < t) hi++;
  const alpha = (t - times[hi-1]) / (times[hi] - times[hi-1]);
  return [0,1,2].map(i => (p[hi-1][i] + (p[hi][i]-p[hi-1][i])*alpha) * (i === 2 ? -1 : 1));
}

function lineY(line, x) {
  const [ax,ay] = line.start, [bx,by] = line.end;
  return ax === bx ? Math.max(ay, by) : ay + (by-ay) * (x-ax)/(bx-ax);
}
function withinLine(line, x) {
  return x >= Math.min(line.start[0], line.end[0]) && x <= Math.max(line.start[0], line.end[0]);
}
function usableUnitLine(line){
  const enabled=Object.hasOwn(line.nativeFields??{},'ENABLE')?line.nativeFields.ENABLE:line.ENABLE;
  const type=line.type??line.nativeFields?.LINE_TYPE?.symbol;
  return enabled!==false&&enabled!==0&&enabled?.symbol!=='FALSE'&&enabled?.$symbol!=='FALSE'&&
    type!==1&&type!==7&&!/(?:LT_WALL|LT_MONSTER_ROAD)$/.test(type??'');
}
function lineZ(line,x){
  const span=line.end[0]-line.start[0];return span?line.start[2]+(line.end[2]-line.start[2])*(x-line.start[0])/span:line.start[2];
}
function validLandCache(line,land,x,z,radius){
  return line&&land&&usableUnitLine(line)&&withinLine(line,land[0])&&
    Math.hypot(land[1]-lineY(line,land[0]),land[2]-lineZ(line,land[0]))<1&&
    Math.hypot(x-land[0],z-land[2])<radius;
}
function nearestLineSupport(lines,position,radius,lastLineId){
  // LineMap.h:1711-1865 GetNearestWithBound: project onto the authored 3D
  // segment (start inclusive, end exclusive), select strict distance<radius.
  // Neither an above-floor test nor a drop-specific ignore line is present.
  const offset=Math.max(0,lines.findIndex(l=>l.lineId===lastLineId));
  let best=null,bound=radius;
  for(let j=0;j<lines.length;j++){
    const line=lines[(j+offset)%lines.length];
    if(!usableUnitLine(line))continue;
    const delta=line.end.map((n,i)=>n-line.start[i]),length=Math.hypot(...delta);
    if(!length)continue;
    const dir=delta.map(n=>n/length),projection=dir.reduce((n,d,i)=>n+d*(position[i]-line.start[i]),0);
    if(projection<0||projection>=length)continue;
    const point=dir.map((n,i)=>line.start[i]+projection*n),distance=Math.hypot(...position.map((n,i)=>n-point[i]));
    if(distance<bound){best={line,point,distance};bound=distance;if(distance===0)break;}
  }
  return best;
}

export function createSimulation(options = {}) { return new Simulation(options); }
export class Simulation {
  constructor({ profile, profiles = {}, commonBuffs = null, map, preset = {}, presets = {}, actors, seed = 1, versions = {}, networkOwnerId = null, observeRemoteDamage:observeDamage = false, collisionSampler, defenderSampler, effectSampler, effectAnchorSampler, effectBoneSampler, effectBoneMatrixSampler, motionOffsetSampler, nasodAttackSampler, summonPoseSampler, summonAnimationDuration, summonDefenderSampler, nativeGeometry, nativeCommands, nativeCommandsByProfession = {}, nativeSkills, nativeSkillsByProfession = {}, nativeSkillValues, nativeNasod, nativeCritical, nativeManaBreak, receiverHitMemory = null } = {}) {
    if (!profile?.states || !professionIdForProfile(profile)) throw new TypeError('Supported profession target profile required');
    const defaultProfession=professionIdForProfile(profile);
    this.profiles={...profiles,[defaultProfession]:profiles[defaultProfession]??profile};
    for(const [id,rawProfile]of Object.entries(this.profiles)){
      if(!rawProfile?.states||!rawProfile.profileId||professionIdForProfile(rawProfile)!==id)throw new TypeError('Profession/profile class mismatch: '+id);
      for(const [name,effect]of Object.entries(rawProfile.damageEffects??{})){
        const main=effect.raw?.MAIN_EFFECT_NAME;
        if(main&&!rawProfile.effectTemplates?.[main]&&effect.unsupportedMainEffect?.name!==main)throw new TypeError(`Incomplete effect dependency: ${name} -> ${main}`);
      }
      const copy=installRavenCommandSource(installAddDeCommandSource(installAddMoonlightSource(installElesisFeedbackSource(installStandupStates(installCommonBuffs(installGuildBuffs(clone(rawProfile)),commonBuffs))))));
      installAddCorePassiveSource2016(copy);
      // Every Nasod-capable class uses the same sourced small-parry state and
      // shield set. Keep initialization aligned with hasNasod, including BM.
      if([106,107,115].includes(copy.target.unitClass)){
        copy.states.RSI_PARRYING_SMALL??={...clone(copy.states.RSI_PARRYING),raw:clone(nasodTarget.smallState.raw)};
        copy.effectSets.EffectSet_RAVEN_PARRING??=clone(nasodTarget.effectSet);
      }
      this.profiles[id]=copy;
    }
    this.defaultProfession=defaultProfession;
    this.presets=clone(presets);
    if (!map?.lines?.length) throw new TypeError('Native map lines required; no substitute floor is generated');
    this.profile = this.profiles[defaultProfession]; this.map = clone(map); this.preset = clone(preset);
    if(networkOwnerId!==null&&(typeof networkOwnerId!=='string'||!actors?.some(a=>a.id===networkOwnerId)))throw new TypeError('Network owner must be a local roster player');
    this.networkOwnerId=networkOwnerId;
    this.observeRemoteDamage=observeDamage===true;
    // Derived armor can lag a Buff mutation until CommonFrameMove. Keep its
    // local provenance outside snapshots; it never comes from a peer report.
    this.ownedBuffArmor=new WeakMap();
    // Optional Web receiver receipt adapter. Offline/source collision policy
    // stays unchanged; identity is resolved after canonical damage-stage resets.
    this.receiverHitMemory=receiverHitMemory;
    this.collisionSampler = collisionSampler; this.defenderSampler = defenderSampler; this.effectSampler = effectSampler;
    Object.assign(this,{summonPoseSampler,summonAnimationDuration,summonDefenderSampler});
    this.effectAnchorSampler = effectAnchorSampler&&((e,a,options)=>effectAnchorSampler(e,e.traceActorId?this.actor(e.traceActorId):a,options));
    this.effectBoneSampler = effectBoneSampler;
    this.effectBoneMatrixSampler = effectBoneMatrixSampler;
    this.motionOffsetSampler = motionOffsetSampler;
    this.nativeGeometry=nativeGeometry;
    this.dePhysicalObjects=createDePhysicalObjects2016(this);
    this.addPredictionPhysics=createAddDePredictionPhysics(this);
    this.nativeCommands=nativeCommands;this.nativeCommandsByProfession=nativeCommandsByProfession;
    this.veteranCommands=createVeteranCommands(this,nativeCommands);
    this.bladeMasterCommands=createBladeMasterCommands(this,nativeCommands);
    this.nativeSkills=nativeSkills;this.nativeSkillsByProfession=nativeSkillsByProfession; this.nativeSkillValues=nativeSkillValues;
    this.nativeCritical=nativeCritical;
    this.nativeManaBreak=nativeManaBreak;
    if(nativeManaBreak&&typeof nativeManaBreak.evaluate!=='function')throw new TypeError('Native Mana Break callback bridge required');
    if(nativeCritical&&(typeof nativeCritical.evaluate!=='function'||typeof nativeCritical.reduceDamage!=='function'))throw new TypeError('Native critical/state reduction callbacks required');
    this.nativeNasod=nativeNasod;
    this.nasodAttackSampler=nasodAttackSampler;
    if(nativeNasod&&typeof nativeNasod.evaluate!=='function')throw new TypeError('Native Nasod callback bridge required');
    if(nativeSkills&&typeof nativeSkills.evaluate!=='function')throw new TypeError('Native skill callbacks required');
    if(nativeCommands)for(const method of ['handlesFuture','handlesEvent','runFuture','runEvent','runStart'])
      if(typeof nativeCommands[method]!=='function')throw new TypeError(`Native commands method ${method} required`);
    if(nativeGeometry){
      for(const method of ['reset','support','down','land','canPassUp','collisionPoint'])
        if(typeof nativeGeometry[method]!=='function')throw new TypeError(`Native geometry method ${method} required`);
      nativeGeometry.reset(this.map);
    }
    this.versions = Object.freeze({ baseline: profile.target.build, preset: preset.presetVersion ?? preset.version ?? 'research-preset-v1',
      program: CORE_VERSION, ...versions, geometryRuntime:nativeGeometry?'original-cpp-wasm':'js-reference-candidate',
      commandRuntime:nativeCommands?'original-cpp-wasm':'js-reference-candidate',
      // Build/default-preset diagnostic only. Mixed actor enablement comes
      // from each frozen profession preset in tickActor, not this label.
      comboStopInputAdapter:preset.sampledComboStopLatch===false?'disabled':COMBO_STOP_INPUT_VERSION,
      rfCommandFallbackAdapter:RF_COMMAND_FALLBACK_VERSION,
      rfBackwardCancelAdapter:RF_BACKWARD_CANCEL_VERSION,
      skillCommandCancelAdapter:SKILL_COMMAND_CANCEL_VERSION,
      ravenCommandCancelAdapter:RAVEN_COMMAND_CANCEL_VERSION,
      skillRuntime:nativeSkills?'original-cpp-wasm':'js-reference-candidate',
      nasodRuntime:nativeNasod?'original-cpp-wasm':'js-reference-candidate',
      missSeedPolicy:SOURCE_MISS_SEED_POLICY,
      criticalRuntime:nativeCritical?'original-cpp-wasm':'unavailable',manaBreakRuntime:nativeManaBreak?'original-cpp-wasm':'unavailable',
      manaBreakHoldIntent:MANA_BREAK_HOLD_INTENT_VERSION,rsLunaRule:RS_LUNA_PROJECT_VERSION });
    this.state = { schemaVersion: 1, versions: this.versions, profileId: profile.profileId,
      profileIds:Object.fromEntries(Object.entries(this.profiles).map(([id,p])=>[id,p.profileId])),commonBuffVersion:commonBuffs?.targetVersion??null,
      sceneId: map.sceneId ?? map.id, seed: seed >>> 0 || 1,
      sourceHitSeedPolicy:SOURCE_MISS_SEED_POLICY,sourceHitSeedBase:seed>>>0||1,
      presentationRandom:{version:1,seed:seed>>>0||1,actors:{}},time: 0, step: 0,
      nextEventId: 1, nextEffectId: 1, actors: [], effects: [], events: [], unsupported: [] };
    initializeSourceGroupMemory2016(this.state);
    const spawns = map.spawns ?? map.starts ?? [];
    const init = actors ?? [0,1].map(i => ({ id: `player-${i+1}`, team: i, ...(spawns[i] ? { position: spawns[i].position, facing: spawns[i].facingRight ? 1 : -1 } : {}) }));
    for (const [i, source] of init.entries()) {
      const professionId=source.professionId??defaultProfession;
      const actorProfile=this.profiles[professionId];
      if(!actorProfile)throw new TypeError('Unknown actor profession '+professionId);
      if(source.profileId&&source.profileId!==actorProfile.profileId)throw new TypeError('Actor profile identity mismatch');
      const actorPreset={...preset,...this.presets[professionId]};
      const p = source.position ?? [source.x ?? spawns[i]?.position?.[0], source.y ?? spawns[i]?.position?.[1], source.z ?? spawns[i]?.position?.[2] ?? 0];
      if (!p || p[0] == null || p[1] == null) throw new TypeError(`Native spawn or explicit position required for ${source.id}`);
      if (this.state.actors.some(a => a.id === source.id)) throw new TypeError('Duplicate actor ID');
      const passiveIds=source.passives??actorPreset.passives??actorProfile.defaultPassiveSkillIds;
      const passivePolicy=nativeSkillValues?initializeActorPassives(actorProfile,{nativeValues:nativeSkillValues,passiveIds}):null;
      const equipmentContext=equipmentAttributeContext(actorPreset,source.attributes);
      let stats = { hpMax: 50000, mpMax: 300, physicalAttack: 1000, magicAttack: 1000,
        criticalRate:0,criticalAttack:1.5,criticalDefence:1,antiCriticalRate:0,accuracy:1,avoidance:1,
        animationSpeedMultiplier: 1, moveSpeedMultiplier: 1, jumpSpeedMultiplier: 1,
        ...(equipmentContext?{physicalDefence:0,magicDefence:0}:{}),
        ...actorPreset.attributes, ...source.attributes };
      if(equipmentContext)stats={...stats,...composeEquipmentCombatStats(equipmentContext.equipmentAttributes,equipmentContext.formulaRules)};
      const speedAttributes=equipmentContext?{stats:{...stats,...composeEquipmentSpeedAttributes(equipmentContext.equipmentAttributes,{passives:passivePolicy?.speedPassives??{}})},
        options:Object.fromEntries(['animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'].map(key=>[key,equipmentContext.equipmentAttributes[key]]))}:
        resolveSpeedAttributes(stats,actorPreset.speedAttributeSemantics);
      stats=speedAttributes.stats;
      const guildHolder={};initializeGuildSkills(guildHolder,{passiveIds:source.guildPassives??actorPreset.guildPassives});
      if(equipmentContext?.formulaRules.sourceEquipmentBaseline){
        stats=applySourcePvpStatPassives(stats,equipmentContext.formulaRules.sourceEquipmentBaseline,passivePolicy,applyGuildStatPassives({},guildHolder));
      }else{
        if(passivePolicy)stats=applyStatPassives(stats,passivePolicy);
        stats=applyGuildStatPassives(stats,guildHolder);
      }
      stats=applyTargetPassiveAttributes(stats,passivePolicy,{equipmentPercent:!!equipmentContext});
      if(actorProfile.target?.unitType===9&&passivePolicy?.stats?.mpMaxAdd)stats.mpMax+=passivePolicy.stats.mpMaxAdd;
      for (const k of Object.keys(stats)) finite(stats[k], k);
      const a = { id: source.id, professionId, profileId:actorProfile.profileId, actorVersions:{baseline:actorProfile.target.build,preset:actorPreset.presetVersion??actorPreset.version??this.versions.preset,program:this.versions.program}, team: source.team ?? i, speedAttributeOptions:speedAttributes.options,
        ...(equipmentContext??{}),
        x: finite(p[0], 'x'), y: finite(p[1], 'y'), z: finite(p[2], 'z'),
        vx: 0, vy: 0, facing: source.facing === -1 ? -1 : 1, state: S.wait, stateTime: 0, animationTime: 0,
        animationName: 'Wait', animationLoop: true, applyMotionOffset: true, consumeRootTranslation:true, rootMotionEnabled: true,
        motionMoveNow:{x:0,z:0}, canNotJumpTime:0, jumpAttackDown:false,
        animationBeforeTime:0,animationOneshotTimer:0,sourceCommandFlags:0,canNotAttackTime:0,reAttackZ1Time:0,reAttackZ1Right:false,sourceDashJumpEffectHandle:0,
        stateSerial: 0, grounded: false, lineId: source.lineId ?? null, lastTouchLineId: source.lineId ?? null, landPosition:[...p], hpMax: stats.hpMax, mpMax: stats.mpMax,
        hp: clamp(source.hp ?? stats.hpMax, 0, stats.hpMax), mp: clamp(source.mp ?? stats.mpMax, 0, stats.mpMax), stats,
        passivePolicy,passives:passivePolicy?Object.keys(passivePolicy.skillLevels).map(Number):[],buffs:[],guild:guildHolder.guild,
        buffResistances:clone(source.buffResistances??actorPreset.buffResistances??{}),
        debuffDurationMultiplier:source.debuffDurationMultiplier??actorPreset.debuffDurationMultiplier,
        buffControls:{inputBlock:false,dashBlock:false},buffBaseStats:clone(stats),
        awakening: { orbs: clamp(source.awakening?.orbs ?? 0, 0, 3), gauge: clamp(source.awakening?.gauge ?? actorPreset.initialAwakeningGauge ?? 0,0,99.999), remaining: 0, full: false, pendingOrbs: 0, pendingAvailableOrbs: 0 },
        ...(['LK','RS','IS','GM','BH','CA'].includes(professionId)?{wayOfSword:createWayOfSword(actorProfile),...(['LK','RS','IS'].includes(professionId)?{destructionRageRemaining:0}:{}),wayOfSwordLimits:{vigor:wayOfSwordFields(actorProfile).Const_VigorStateThreshold,destruction:wayOfSwordFields(actorProfile).Const_DestStateThreshold}}:{}),
        ...(isElesisProfession(professionId)?{sourceElesisBreakCharge:0,sourceElesisGaleHits:0,sourceElesisComboRemaining:0,sourceElesisCommand:{loops:0,requestedLoops:0}}:{}),
        core: { phase: 'absent', gauge: 0, level: 0, phaseTime: 0, targetId: null, x: p[0], y: p[1], z: p[2], hit: false, attackLevel: 0, guardRemaining: 0, parrying:false,canParry:false,helperLive:false, animationName: 'Wait', animationTime: 0 },
        cooldowns: {}, loadout: Array(8).fill(null), skillId: null, skillContext:null, hitStop: 0, worldStop: 0,
        sourceHitCountByte:0,
        effectiveBlackHoleIds:[],blackHoleDisplacement:[0,0,0],sourceBlackHoleCanPass:null,
        fired: [], hits: {}, buffered: null, tapTimes: {}, doubleHeldDirections:[], ignoreLineId: null, dropRemaining: 0, death: false,
        invincible: false, superArmor: false, limitCrusherCharging: false, unsupported: [], skillScale: 1, soundSet: null,
        inputLock: 0, pendingPlatformJump: null, mapMechanics:createMapMechanics(), pendingPressed: [], comboStopInput:null, tapReleased:{}, downForce:false, jumpOnLanding:false,
        presentationTransition:null, animationSpeedRamp:null, animationPlaybackSpeed:1, animationTransitionSerial:0, animationStopped:false,
        knockdown:createKnockdownGauge(),manaBreak:createManaBreak(),flyCount:0,lastAttackerFront:true,forceInvincible:0,
        showInvincible:createInvulnerabilityDisplay(),
        deathPresentation:null,deathAlpha:1,hidden:false,deathComplete:false,downSuccessor:null,downAttackChoice:null,standupAttackNoDown:false,
        uiAbilities:{showOpponentMp:source.uiAbilities?.showOpponentMp===true} };
      initializeAddSystems(a,{source:source.sourceAdd,preset:actorPreset});
      if(source.sourceHitSeed!==undefined){if(!Number.isInteger(source.sourceHitSeed)||source.sourceHitSeed<0||source.sourceHitSeed>65535)throw TypeError('Explicit source hit seed must be u16');a.sourceHitSeed=source.sourceHitSeed;}
      this.state.actors.push(a);
      if(this.nativeGeometry){
        const q=this.nativeGeometry.support({position:[a.x,a.y,a.z],radius:actorProfile.referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId});
        if(q.found){a.landPosition=q.point;a.lastTouchLineId=q.lineId;
          if(Math.abs(a.y-q.point[1])<1){a.grounded=true;a.lineId=q.lineId;[a.x,a.y,a.z]=q.point;}}
      }else{
        const l = map.lines.find(l => withinLine(l, a.x) && Math.abs(lineY(l,a.x)-a.y) < .01);
        if (l) { a.grounded = true; a.lineId = l.lineId; a.lastTouchLineId=l.lineId; }
        const floor=map.lines.filter(l=>usableUnitLine(l)&&withinLine(l,a.x)&&Math.abs(lineZ(l,a.x)-a.z)<actorProfile.referenceSemantics.lineRadius&&lineY(l,a.x)<=a.y+.01)
          .sort((l,r)=>lineY(r,a.x)-lineY(l,a.x))[0];
        if(floor)a.landPosition=[a.x,lineY(floor,a.x),lineZ(floor,a.x)];
      }
      this.configureLoadout(source.loadout ?? actorPreset.loadout ?? (professionId==='RF'?[ { skillId: 24027 }, { skillId: 24203 }, { skillId: 24217 }, { skillId: 24219 }, null, null, null, null ]:Array(8).fill(null)), a.id);
      this.enter(a, S.wait, 'initial');
      if(passivePolicy)for(const field of passivePolicy.unresolved)this.note('passive-gap:'+field,field,a);
    }
    this.note('fidelity-unverified', 'No target-client trace: this simulation is not an original 1:1 acceptance result');
    if (!collisionSampler) this.note('native-helper-adapter-missing', 'Direct character attacks require the original pose/helper sampler; they emit windows but cannot hit without it');
    if (!effectSampler) this.note('native-effect-adapter-missing', 'Damage effects require the original mesh/template helper sampler; no guessed attack width is used');
    if (!defenderSampler) this.note('native-defender-adapter-missing', 'Defender uses explicit prototype INIT_BODY rectangle; original COLLISION_SPHERE sampler must be supplied for native shapes');
  }

  actor(id) { const a = this.state.actors.find(a => a.id === id); if (!a) throw new RangeError(`Unknown actor ${id}`); return a; }
  setContactObservations(actors=[]){
    if(!Array.isArray(actors)||actors.length>this.state.actors.length)throw new TypeError('Invalid contact observations');
    if(this.networkOwnerId===null||!actors.length){delete this.state.contactObservations;return;}
    const rows={};
    for(const actor of actors){
      if(actor.id===this.networkOwnerId||!this.state.actors.some(a=>a.id===actor.id)||Object.hasOwn(rows,actor.id))throw new TypeError('Invalid contact owner');
      rows[actor.id]=captureContactObservation(actor);
    }
    this.state.contactObservations=rows;
  }
  contactActor(actor,attacker){return contactObservation(actor,this.state.contactObservations,attacker?.id,this.networkOwnerId);}
  contactGeometry(actor,attacker){return ownedContactGeometry(actor,this.receiverContactGeometry,attacker?.id,this.networkOwnerId);}
  profileFor(actor) { return this.sourcePostContext?.actor===actor&&this.sourcePostContext.profile||this.profiles[actor.professionId??this.defaultProfession]; }
  effectProfileFor(effect) { return effectSourceProfile(this,effect); }
  presetFor(actor) { return {...this.preset,...this.presets[actor.professionId??this.defaultProfession]}; }
  commandsFor(actor) { return this.nativeCommandsByProfession[actor.professionId]??(isAddActor(actor)?addCommands:this.profileFor(actor).target.unitClass===107?this.nativeCommands:this.profileFor(actor).target.unitClass===115?this.veteranCommands:this.profileFor(actor).target.unitClass===106?this.bladeMasterCommands:this.profileFor(actor).target.unitClass===100?lordKnightCommands:this.profileFor(actor).target.unitClass===101?runeSlayerCommands:this.profileFor(actor).target.unitClass===112?infinitySwordCommands:isElesisProfile(this.profileFor(actor))?elesisCommands:null); }
  skillsFor(actor) { return this.nativeSkillsByProfession[actor.professionId]??(this.hasNasod(actor)?this.nativeSkills:null); }
  hasNasod(actor) { return [106,107,115].includes(this.profileFor(actor).target.unitClass); }
  isAirState(actor) { return air.has(actor.state)||this.commandsFor(actor)?.isAirState?.(actor)||(this.profileFor(actor).referenceSemantics.airStates??[]).includes(actor.state); }
  skillAvailability(actorId,slot,{sourceMode=null}={}) { const actor=this.actor(actorId);
    const mode=sourceMode??(this.sourcePostContext?.actor===actor?this.sourcePostContext.mode:null);
    return evaluateSkillAvailability({actor,profile:this.profileFor(actor),preset:this.presetFor(actor),slot,sourceMode:mode}); }
  rng() { let x = this.state.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.state.seed = x >>> 0; return this.state.seed / 4294967296; }
  visualRng(actor) { return presentationRandom(this.state,actor.id); }
  emit(type, actorId, data = {}) { const effectId=data.effectId??(data.origin?.kind==='effect'?data.origin.id:null);
    const sourceProfessionId=effectId==null?null:this.state.effects.find(e=>e.id===effectId)?.sourceProfessionId;
    const e = { eventId: this.state.nextEventId++, time: this.state.time, type, actorId, ...(sourceProfessionId?{sourceProfessionId}:{}), ...data }; this.state.events.push(e); return e; }
  note(id, reason, actor) {
    const list = actor?.unsupported ?? this.state.unsupported;
    if (!list.some(v => v.id === id)) { list.push({ id, reason }); this.emit('unsupported', actor?.id ?? null, { id, reason }); }
  }
  configureLoadout(slots, actorId = this.state.actors[0]?.id) {
    const a = this.actor(actorId);
    if (!Array.isArray(slots) || slots.length !== 8) throw new RangeError('Exactly 8 slots required; null is an empty slot');
    const seen = new Set(); const result = [];
    for (const s of slots) {
      if (s === null) { result.push(null); continue; }
      let sk = this.profileFor(a).skillCatalog.find(v => v.skillId === Number(s.skillId));
      if (!sk || sk.unitClass !== this.profileFor(a).target.unitClass || sk.passive) throw new RangeError(`Skill ${s.skillId} is not an ${a.professionId} active skill`);
      // Max level includes the final enhanced replacement node, when present.
      while (this.profileFor(a).skillCatalog.some(v => v.replacesSkillId === sk.skillId)) sk = this.profileFor(a).skillCatalog.find(v => v.replacesSkillId === sk.skillId);
      if (!sk.supported) throw new RangeError(`Skill ${sk.skillId} executor is unimplemented`);
      const branchId = s.branchId ?? 'none';
      if (branchId !== 'none' && !sk.branches?.some(b => (b.id??b.branchId) === branchId && b.selectable!==false)) throw new RangeError(`Unknown trait ${branchId}`);
      if (seen.has(sk.skillId)) throw new RangeError(`Duplicate skill ${sk.skillId}`);
      const family=new Set([sk.skillId]);
      let ancestor=sk;
      while(ancestor.replacesSkillId!=null){
        if(family.has(ancestor.replacesSkillId))throw new RangeError('Invalid skill replacement cycle');
        family.add(ancestor.replacesSkillId);
        ancestor=this.profileFor(a).skillCatalog.find(v=>v.skillId===ancestor.replacesSkillId);
        if(!ancestor)break;
      }
      if(this.presetFor(a).bannedSkillIds?.some(id=>family.has(Number(id))))throw new RangeError(`Banned skill ${sk.skillId}`);
      seen.add(sk.skillId); result.push({ skillId: sk.skillId, requestedSkillId: Number(s.skillId), branchId, level: sk.maxLevel });
    }
    a.loadout = result; this.emit('loadoutConfigured', a.id, { slots: clone(result), evidence: 'target-2016 tree master level + upgrade replacement' });
    return clone(result);
  }
  snapshot() { return clone(this.state); }
  /** Renderer observes this view without cloning; mutation remains inside the core. */
  view() { return this.state; }
  restore(snapshot) {
    // A room snapshot is shared by browsers whose local default profile may
    // differ. Accept only registered room profiles; actor identities below
    // remain exact and cannot switch professions through a restore.
    if (JSON.stringify(snapshot?.versions) !== JSON.stringify(this.versions) || !Object.values(this.profiles).some(profile=>profile.profileId===snapshot.profileId) || snapshot.sceneId !== this.state.sceneId) throw new RangeError('Snapshot version/map/profile mismatch');
    if (!Number.isFinite(snapshot.time) || !Array.isArray(snapshot.actors) || !Array.isArray(snapshot.effects)) throw new TypeError('Malformed snapshot');
    if(snapshot.commonBuffVersion!==this.state.commonBuffVersion||JSON.stringify(snapshot.profileIds)!==JSON.stringify(this.state.profileIds)||snapshot.actors.length!==this.state.actors.length||snapshot.actors.some((actor,i)=>{
      const frozen=this.state.actors[i];return actor.id!==frozen.id||actor.professionId!==frozen.professionId||actor.profileId!==frozen.profileId||JSON.stringify(actor.actorVersions)!==JSON.stringify(frozen.actorVersions)||JSON.stringify(actor.wayOfSwordLimits)!==JSON.stringify(frozen.wayOfSwordLimits)||JSON.stringify(actor.formulaRules)!==JSON.stringify(frozen.formulaRules)||JSON.stringify(actor.equipmentAttributes)!==JSON.stringify(frozen.equipmentAttributes);
    }))throw new RangeError('Snapshot actor profession/profile/version mismatch');
    this.state = clone(snapshot); return this.snapshot();
  }
  drainEvents() { const events = this.state.events; this.state.events = []; return events; }

  animationSpeed(a, def = this.profileFor(a).states[a.state]) {
    return actionAnimationSpeed(a,def)*addSkillAnimationMultiplier(a,this.profileFor(a),def);
  }
  startAnimationTransition(a, nextDef, {initial = false, loop = false, directChange = false,targetState=a.state} = {}) {
    const previous = addMotionDefinition(this.profileFor(a),a,elesisWaitDefinition(this.profileFor(a),a,lordKnightWaitDefinition(this.profileFor(a),a,this.profileFor(a).states[a.state])));
    const enabled = !initial && !directChange && Boolean(a.animationName) &&
      (loop || (previous?.raw.TRANSITION !== 0 && nextDef.raw.TRANSITION !== 0));
    let oldSpeed = a.animationPlaybackSpeed ?? this.animationSpeed(a, previous);
    const oldTargetSpeed=a.animationTargetSpeed??this.animationSpeed(a,previous);
    const newSpeed = actionAnimationSpeed(a,nextDef,targetState);
    if(isHurtAnimation(nextDef,targetState))oldSpeed=Math.min(oldSpeed,newSpeed);
    const oldTransition = Math.max((previous?.clip?.durationSeconds ?? 0) / 10, .03);
    const newTransition = Math.max((nextDef.clip?.durationSeconds ?? 0) / 10, .03);
    // The original two-track controller retains the CURRENT raw track weight
    // when ChangeAnim interrupts a blend. It does not restart the old track
    // at weight 1 or freeze the previously mixed skeleton. Independently
    // measured with the target client's d3dx9_43.dll (partial .25 -> .1875).
    const oldBlend=a.presentationTransition;
    const fromWeight=oldBlend?.enabled
      ? Math.min(1,oldBlend.elapsedSeconds/oldBlend.durationSeconds) : 1;
    const retainedPose=fromWeight===0 ? clone(oldBlend?.retainedPose ?? {
      animationName:a.animationName,animationTime:a.animationTime,animationLoop:a.animationLoop,
      presentationTransition:oldBlend,
    }) : null;
    a.animationTransitionSerial = (a.animationTransitionSerial ?? 0) + 1;
    // ChangeAnim (including a same-name loop) clears BOTH native root caches.
    // SkinAnim consumes root XZ independently of the unit APPLY_ANIM_MOVE gate.
    a.motionMoveNow={x:0,z:0};
    a.presentationTransition = {serial:a.animationTransitionSerial, fromName:a.animationName,
      fromTime:a.animationTime, fromLoop:a.animationLoop, fromSpeed:oldSpeed, fromWeight, retainedPose,
      fromApplyMotionOffset:a.applyMotionOffset, durationSeconds:oldTransition / Math.max(oldTargetSpeed,1e-9),
      elapsedSeconds:0, enabled, evidence:'reference-v5 SkinAnim ChangeAnim / XET transition overrides unavailable'};
    // UpdateAnimationFrameStructure (SkinAnim.h:381-419) reads the D3DX track
    // position as animationTime. SetPlaySpeed keys the incoming speed separately
    // using the NEW period. This clock must drive events as well as rendering.
    // Direct DamageReact uses ChangeAnim(false), retaining the same track's
    // current speed. SetPlaySpeed still keys that speed toward the new target;
    // it does not start the track at zero (User13611/14176, SkinAnim.h155-160).
    const initialSpeed=directChange?oldSpeed:0;
    a.animationSpeedRamp = enabled || directChange && initialSpeed!==newSpeed
      ? {elapsedSeconds:0, durationSeconds:newTransition / Math.max(newSpeed,1e-9),initialSpeed} : null;
    a.animationPlaybackSpeed = directChange ? initialSpeed : enabled ? 0 : newSpeed;
    a.animationTargetSpeed=newSpeed;
  }
  advanceAnimation(a, def, elapsed) {
    if(a.animationStopped)return; // Native XAS_WAIT advances controller time by zero.
    const speed = this.animationSpeed(a,def), ramp = a.animationSpeedRamp;
    a.animationTargetSpeed=speed;
    if(ramp&&isHurtAnimation(def,a.state))ramp.initialSpeed=Math.min(ramp.initialSpeed??0,speed);
    if (ramp) {
      const integral = t => t < ramp.durationSeconds ? t*t/(2*ramp.durationSeconds) : t-ramp.durationSeconds/2;
      const before = ramp.elapsedSeconds; ramp.elapsedSeconds += elapsed;
      const initialSpeed=ramp.initialSpeed??0;
      a.animationTime += initialSpeed*elapsed+(speed-initialSpeed)*(integral(ramp.elapsedSeconds)-integral(before));
      a.animationPlaybackSpeed = initialSpeed+(speed-initialSpeed)*Math.min(1,ramp.elapsedSeconds/ramp.durationSeconds);
      if (ramp.elapsedSeconds >= ramp.durationSeconds) a.animationSpeedRamp = null;
    } else { a.animationTime += elapsed*speed; a.animationPlaybackSpeed = speed; }
    if(a.presentationTransition)a.presentationTransition.elapsedSeconds += elapsed;
  }

  enter(a, state, reason = 'transition', {directChange = false,commandInput = null,sourceApply=false} = {}) {
    if(queueAddDePhysicalState(this,a,state,reason))return;
    if(!sourceApply&&!directChange&&(this.sourcePostContext?.actor===a||this.sourceApplyingActor===a))
      return requestSourceState(this,a,state,reason);
    if(!sourceApply&&a.sourcePendingState){delete a.sourcePendingState;a.sourceAppliedStateByte=a.sourceStateRequestByte;}
    a.sourceFacingHistory={previous:a.sourceFacingHistory?.current??a.facing,current:a.facing};
    const deferredCancel=Boolean(sourceApply&&a.sourcePendingState);
    const normalize=(next,{cancel=true}={})=>{
      if(next===S.wait&&Math.abs(a.wayOfSword?.state)===2&&this.profileFor(a).states[S.swordWait])next=S.swordWait;
      if(cancel)cancelInputStateChange(a,next);
      const fatal=deathState({hp:a.hp,grounded:a.grounded,fromFront:a.lastAttackerFront});
      if(fatal&&!deathStates.has(next))next=fatal;
      if(deathStates.has(next)){
        a.animationSpeedOverride=REACTION_REFERENCE.deathAnimationSpeed;
        if(!a.deathPresentation&&Math.abs(a.wayOfSword?.state)===2)
          (isElesisProfession(a.professionId)?synchronizeElesisSword:synchronizeWayOfSwordPresentation)(this,a,{before:a.wayOfSword,after:{state:0}},{updateWait:false});
        if(!a.deathPresentation){a.deathPresentation=createDeathPresentation();a.death=true;guildOnDeath(a);this.emit('deathAnimationStarted',a.id,{state:next,evidence:REACTION_REFERENCE.evidence});}
        a.core.phase='absent';a.core.gauge=0;a.core.level=0;a.core.targetId=null;a.core.guardRemaining=0;a.core.canParry=false;a.core.parrying=false;a.core.helperLive=false;
        a.skillId=null;a.skillContext=null;a.skillScale=1;a.pendingPlatformJump=null;
      }
      if(!this.profileFor(a).states[next]){this.note(`state:${next}`,`No target declaration for ${next}`,a);next=S.wait;}
      return next;
    };
    // Exit can replace the source request. Do not destroy a buffered command
    // against a provisional destination that never becomes the active state.
    state=normalize(state,{cancel:!deferredCancel});
    let d = addMotionDefinition(this.profileFor(a),a,elesisWaitDefinition(this.profileFor(a),a,lordKnightWaitDefinition(this.profileFor(a),a,this.profileFor(a).states[state]))), r = d.raw;
    // CommonStateStart resets the mutable pass flag from this state's raw base;
    // black-hole identity belongs to the live effect, not to the action state.
    a.sourceBlackHoleCanPass=null;
    const oldRaw=this.profileFor(a).states[a.state]?.raw;
    endAddStardust(this,a);
    endAddSpaceCrack(this,a,state);
    endAddMovement(a,state);
    endAddQuicksilverLink(this,a);
    endAddPersistentSkill(this,a,state);
    if(this.profileFor(a).states[a.state]?.sourceState==='ANSI_COMBO_NASOD_ARMOR_LANDING')finishAddFantasyTracer(a);
    if(a.sourceAdd?.formationPending&&a.state===S.awaken&&state!==S.awaken)
      stopAddFormation(a,{profile:this.profileFor(a),reason:'formation-interrupted',force:true,emit:(...args)=>this.emit(...args)});
    standupStateEnd(a,oldRaw);
    lordKnightStateEnd(this,a,state);
    elesisEnd(this,a,state);
    if(isElesisProfession(a.professionId)&&!/^ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE/.test(state))delete a.sourceElesisBurst;
    phantomSwordStateEnd(this,a);
    infinitySwordEnd(this,a,state);
    runeSlayerStateEnd(this,a,state);
    veteranEnd(this,a,state);
    bladeMasterEnd(this,a,state);
    endXxxCandidate(this,a);
    if(oldRaw?.CUSTOM_STATE_DELETE_EFFECT_SET_ON_STATE_END===1||r.CUSTOM_STATE_DELETE_EFFECT_SET===1)
      this.stopSkillEffectGroup(a,'sourceCustomStateEffectGroup','original-custom-state-delete');
    const skillEnd=originalSkillEnd(this.skillsFor(a),a,this.profileFor(a),this.skillSourceInputs(a));
    if(skillEnd)this.applySkillPhase(a,skillEnd);
    if(a.state==='RSI_A_RRF_LIMIT_CRUSHER_CHARGE')a.limitCrusherCharging=this.nativeCritical?.limitPhase?.('end',a.limitCrusherCharging===true)??false;
    delete a.skillSuperArmorNotRed;
    shadowStepCandidateEnd(a,state);
    if(this.commandsFor(a)?.runEnd){const result=this.commandsFor(a).runEnd(a,this.profileFor(a));if(result.handled)this.applyCommandResult(a,result);}
    if(sourceApply&&a.sourcePendingState){
      // Claiming the serial happened before exit. Exit may replace pending;
      // read its final state/context only now, then execute the new enter.
      const pending=a.sourcePendingState;state=pending.state;reason=pending.reason;
      applyRequestedSkillContext(a,pending,this.profileFor(a));
      state=normalize(state);
      d=addMotionDefinition(this.profileFor(a),a,elesisWaitDefinition(this.profileFor(a),a,lordKnightWaitDefinition(this.profileFor(a),a,this.profileFor(a).states[state])));r=d.raw;
    }else if(deferredCancel)cancelInputStateChange(a,state);
    // Fatal redirection owns the existing dedicated death-speed presentation;
    // ordinary received-hit directChange must not replace that separate clock.
    this.startAnimationTransition(a,d,{initial:reason==='initial',directChange:directChange&&!deathStates.has(state),targetState:state});
    if (parryStates.has(a.state)) {
      const result=evaluateNasod(this.nativeNasod,'end',nasodSnapshot(a));applyNasodResult(a,result);
      this.updateCoreLevel(a);restoreNasodHelper(a);
      this.emit('coreGuardEnded',a.id,{level:a.core.level,gauge:a.core.gauge,restored:result.restored,source:NASOD_GUARD_SOURCE.end});
    }
    a.state = state; a.stateTime = 0; a.animationTime = r.ANIM_START_TIME ?? 0; a.animationName = d.animationName; a.animationStopped=false;
    standupStateStart(a);
    delete a.sourceMegaDrill;delete a.sourceMegaDrillNowSupported;
    a.animationBeforeTime=a.animationTime;a.animationOneshotTimer=0;a.sourceCommandFlags=0;a.comboStopInput=null;
    a.animationLoop = r.PLAY_TYPE === 0; a.applyMotionOffset = r.APPLY_ANIM_MOVE !== 0;
    a.consumeRootTranslation=true;
    a.jumpAttackDown=false;
    a.passiveSpeed={x:r.PASSIVE_SPEED_X??-1,y:r.PASSIVE_SPEED_Y??-1};
    a.rootMotionEnabled = a.applyMotionOffset; a.stateSerial++; a.fired = []; a.hits = {};a.hitGaps={}; a.buffered = null;
    a.knockdown=knockdownStateStarted(a.knockdown);a.downSuccessor=null;
    if (r.SPEED_X !== undefined) a.vx = r.SPEED_X * a.facing;
    if (r.SPEED_Y !== undefined) a.vy = r.SPEED_Y;
    if (state === S.wait||state===S.swordWait) a.vx = 0;
    if (state === S.dashEnd) a.vx = sourceScaledSpeed(this.profileFor(a).physics.RUN_SPEED,a.stats.moveSpeedMultiplier)*a.facing;
    if (state === S.dashLand || state === S.powerLand || state === 'RSI_DASH_JUMP_COMBO_ZZ_Landing' && !this.commandsFor(a)) a.vx *= .5;
    if(state === 'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING') {a.vx=0;a.vy=0;a.passiveSpeed={x:0,y:0};}
    const commandStart=this.commandsFor(a)?.runStart(a,this.profileFor(a),commandInput);
    if(commandStart?.handled)this.applyCommandResult(a,commandStart);
    const skillStart=originalSkillStart(this.skillsFor(a),a,this.profileFor(a));
    if(skillStart)this.applySkillPhase(a,skillStart);
    lordKnightStateStart(this,a);
    elesisStart(this,a);
    infinitySwordStart(this,a);
    infinitySwordSheathStart(this,a);
    phantomSwordStateStart(this,a);
    runeSlayerStateStart(this,a);
    veteranStart(this,a);
    bladeMasterStart(this,a);
    addStateStart(this,a);
    if(state==='RSI_A_RRF_LIMIT_CRUSHER_CHARGE')a.limitCrusherCharging=this.nativeCritical?.limitPhase?.('start',false)??true;
    if(state==='RSI_SI_A_RF_SHADOW_STEP')initializeShadowStepCandidate(a,this.skill(a.skillId,a));
    if(state==='RSI_SA_RRF_WILD_CHARGING')a.sourceWildCharge={afterFull:0,sourceChargeEquivalent:0,previousHp:a.hp,elapsed:0,
      evidenceClass:'target2016 .75 second charge bound to original full-charge feedback and bounded hold'};
    if(state==='RSI_DAMAGE_AIR_SMALL'&&!commandStart?.handled){
      const start=airSmallStartFuture({localVx:a.vx*a.facing,vy:a.vy,fromFront:a.lastAttackerFront,
        walkSpeed:this.profileFor(a).physics.WALK_SPEED*a.stats.moveSpeedMultiplier});
      a.vx=start.localVx*a.facing;a.vy=start.vy;
    }
    if (state === S.stand) a.vx = 0;
    if (free.has(state) || state.startsWith('RSI_DAMAGE_')) {a.skillId = null;a.skillContext=null;}
    Object.assign(a,evaluateStateProtection(r,a.animationTime,stateProtectionOptions(this.presetFor(a),a,{forceInvincible:a.forceInvincible,initial:true})));
    if(a.skillSuperArmorNotRed!==undefined)a.superArmorNotRed=a.skillSuperArmorNotRed;
    preserveDestructionArmor(a);
    a.soundSet = null;
    if (r.SOUND_SET0 || r.SOUND_SET1 || r.SOUND_SET2) {
      const roll = Math.floor(this.visualRng(a)*100)+1;
      const rates = [0,1,2].map(i=>r[`SOUND_SET${i}_RATE`]??0);
      const selected = roll<rates[0]?0:roll<rates[0]+rates[1]?1:roll<rates[0]+rates[1]+rates[2]?2:0;
      const bank=r[`SOUND_SET${selected}`],awakened=isAddActor(a)?a.sourceAdd?.formation===true:a.awakening.remaining>0;
      const mode = a.awakening.full && awakened && (bank?.USE_BERSERK_SOUND??r.USE_BERSERK_SOUND) ? 'BERSERK' : awakened && (bank?.USE_HYPER_SOUND??r.USE_HYPER_SOUND) ? 'HYPER' : 'NORMAL';
      a.soundSet = { selected, mode, roll, rateEvidence:'V5 native integer1..100 with strict < threshold; isolated Web actor presentation RNG' };
    }
    this.emit('stateChanged', a.id, { state,stateSerial:a.stateSerial,audioPresentationSerial:this.beginSourceAudioState(a,{force:true}), animationName: a.animationName, reason, sourcePc: d.sourcePc });
    // CommonStateStart14798 consumes an activated mana cost only in these
    // down states. It does not activate/flush the independent force-down gauge.
    if(manaBreakStateStart(this.nativeManaBreak,a,r))this.emit('manaBreakConsumed',a.id,{mp:a.mp,knockdown:a.knockdown.now,source:MANA_BREAK_SOURCE});
    this.processStateEvents(a, -.000000001, 0);
    beginXxxCandidate(this,a);
  }

  fire(a, id, time, before, after, fn) {
    if (!a.fired.includes(id) && crossed(before, after, time)) { a.fired.push(id); fn(); }
  }
  processSpeedFactors(a){
    // GUUser.cpp:14892-14924 consumes due speed factors in CommonFuture,
    // after the state's Future callback and before animation/physics advance.
    let verticalLaunch=false;
    for(const [field,v] of Object.entries(this.profileFor(a).states[a.state].raw)){
      if(!/^SPEED_TIME\d+$/.test(field)||a.fired.includes(field)||!(v['3']>=0&&v['3']<=a.animationTime))continue;
      a.fired.push(field);
      if(v['4']===1){a.vx+=v['1']*a.facing;a.vy+=v['2'];}
      else if(v['4']===2){a.vx=v['1']*a.facing;a.vy=v['2'];}
      else if(v['4']===3)a.passiveSpeed={x:v['1'],y:v['2']};
      else this.note(`speedFlag:${v['4']}`,'Unimplemented speed-time flag',a);
      if((v['4']===1||v['4']===2)&&v['2']>0&&a.vy>0)verticalLaunch=true;
      this.emit('velocityEvent',a.id,{field,values:clone(v),phase:'CommonFuture-before-controller'});
    }
    return verticalLaunch;
  }
  processStateEvents(a, before, after) {
    const raw = this.profileFor(a).states[a.state].raw;
    lordKnightEvents(this,a,before,after);
    elesisEvents(this,a,before,after);
    elesisCommandEvents(this,a,before,after);
    addEvents(this,a,before,after,{applyTimeRing:applyAddTimeRing,consumeMutation:consumeAddMutation});
    if(a.professionId==='MM'&&this.profileFor(a).states[a.state]?.sourceState==='ANSI_HA_AMM_APOCALYPSE')
      this.fire(a,'add-apocalypse-summon',.01,before,after,()=>startAddApocalypse(this,a));
    infinitySwordEvents(this,a,before,after);
    infinitySwordSheathEvents(this,a,before,after);
    runeSlayerEvents(this,a,before,after);
    veteranEvents(this,a,before,after);
    bladeMasterEvents(this,a,before,after);
    for(const [i,entry] of array(raw.BUFF_FACTOR_ID_AND_APPLY_TIME).entries()){
      const relative=raw.BUFF_FACTOR_RELATIVE_SKILL_ID,relativeRow=relative>0?this.skill(relative,a):null;
      const level=isElesisProfession(a.professionId)&&relative>0?(a.passivePolicy?.skillLevels?.[relative]??(a.skillId===relative?a.skillContext?.level:!relativeRow?.passive?relativeRow?.maxLevel:0)):(a.skillContext?.level??1);
      if(level>0&&!(isElesisProfession(a.professionId)&&a.sourceElesisBurst?.chivalry&&/^ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE/.test(a.state)))this.fire(a,`selfBuff:${i}`,entry['2']??0,before,after,()=>this.grantBuff(a,a,entry['1'],level));
    }
    const extendedSounds=getSourceExtendedSoundEntries(raw,a.soundSet);
    for (const [k,v] of Object.entries(raw)) {
      if (/^SOUND_PLAY\d+$/.test(k) && !a.soundSet) this.fire(a,k,v['1'],before,after,() => this.soundEvent(a,k,v));
      if (/^STOP_OTHER_UNIT\d+$/.test(k)) this.fire(a,k,v['1'],before,after,() => {
        for (const b of this.state.actors) if (b.id !== a.id) {
          const duration = sourceStopDuration(a,b,v['2']);
          if(duration>0)requestActorStop(b,'world',duration,a.id);
        }
        this.emit('worldStop',a.id,{duration:v['2'],...sourceStopRadii(),distancePolicy:SOURCE_STOP_DISTANCE_VERSION,
          aggregation:'target2016-user-last-record',source:'original2016 recipient XYZ strict radii and User STOP queues'});
      });
    }
    for(const entry of extendedSounds)if(entry.kind==='extended')
      this.fire(a,entry.field,entry.time,before,after,()=>this.sourceExtendedSoundEvent(a,entry));
    if (a.soundSet) {
      const set = raw[`SOUND_SET${a.soundSet.selected}`]?.[a.soundSet.mode];
      for (const [k,v] of Object.entries(set??{})) if (/^SOUND_PLAY\d+$/.test(k)) this.fire(a,`set${a.soundSet.selected}:${k}`,v['1'],before,after,()=>this.soundEvent(a,k,v));
    }
    for(const entry of extendedSounds)if(entry.kind==='state')
      this.fire(a,entry.field,entry.time,before,after,()=>this.sourceExtendedSoundEvent(a,entry));
    // EFFECT_SET_LIST_EX entries 3..n are DELETE_CONDITION_EFFECT_SET,
    // not a clock enum. Target Enum declares STATE_END=2, DAMAGE_REACT=1.
    const spawn = (entry,index,extended) => {
      if (!entry || typeof entry['1'] !== 'string') return;
      const at = entry['2'] ?? 0;
      const conditions = extended ? array(entry).slice(2) : [];
      // GUUser37757/37804 registers this common flag independently of the
      // regular/extended entry. State-end ownership also keeps visual mesh
      // helpers in the combat executor instead of retiring their identity.
      if((raw.DELETE_EFFECT_SET_ON_STATE_END===1||raw.DELETE_EFFECT_SET_ON_STATE_END===true)&&
        !conditions.includes(this.profileFor(a).enums.DELETE_CONDITION_EFFECT_SET.DCES_STATE_END))
        conditions.push(this.profileFor(a).enums.DELETE_CONDITION_EFFECT_SET.DCES_STATE_END);
      this.fire(a,`effectSet:${index}`,at,before,after,() => {
        const mode=raw.HYPER_EFFECT_SET;
        if(mode!==undefined&&mode!==false&&mode!==true&&mode!==0&&mode!==1)
          this.note('effect-set-hyper-mode:'+a.state,'Raw HYPER_EFFECT_SET value unsupported; no inferred Hyper mode',a);
        this.spawnSet(a,entry['1'],undefined,conditions,mode===true||mode===1);
      });
    };
    if (raw.EFFECT_SET_LIST) {
      const pairs=array(raw.EFFECT_SET_LIST);
      for(let i=0;i<pairs.length;i+=2)spawn({'1':pairs[i],'2':pairs[i+1]},'regular'+i,false);
    }
    for (const [i,e] of (typeof raw.EFFECT_SET_LIST_EX?.['1']==='string'?[raw.EFFECT_SET_LIST_EX]:array(raw.EFFECT_SET_LIST_EX)).entries()) spawn(e,i,true);
    // Target BH has ordinary/transform alternatives. No target transformation
    // producer is established; Avatar of Fire is a burn-absorb skill, not it.
    for(const [i,e]of array(elesisTransformationEffectList(a,raw)).entries())spawn(e,'elesis-trans'+i,true);
    const binding=this.profileFor(a).referenceSemantics.mechanicBindings?.[a.state];
    if(binding?.supported&&Number.isFinite(binding.animationTime))this.fire(a,'nativeMechanicEffect',binding.animationTime,before,after,()=>this.spawnSet(a,binding.effectSet));
    if (a.state === S.awaken) this.fire(a,'activateAwakening',this.profileFor(a).referenceSemantics.awakening.applyAnimationTime,before,after,() => this.activateAwakening(a));
    if (a.skillId) {
      const sk = this.skill(a.skillId,a);
      if (sk.executor === 'HellDive') this.note('hell-dive-last-punch', 'V5 native last-punch name does not resolve in target declarations; available first/second effect+blade are executed', a);
    }
  }
  skillSourceInputs(a){
    // MegaDrill uses m_OrgPhysicParam.GetDashSpeed(), whose PhysicParam
    // getter returns the original Lua fRunSpeed; it is not the unit getter.
    return {dashSpeed:Math.fround(this.profileFor(a).physics.RUN_SPEED)};
  }
  applySkillPhase(a,result){
    if(result.xCrash)a.sourceXCrash=clone(result.xCrash);
    if(a.state==='RSI_SA_RRF_WILD_CHARGING'&&result.callbackGroup===68){
      Object.assign(a.sourceWildCharge,{sourceChargeEquivalent:result.charge,afterFull:result.afterFull,previousHp:result.previousHp,elapsed:result.targetChargeElapsed});
      a.skillSuperArmorNotRed=false;
      if(result.sounds)this.emit('sound',a.id,{name:'Raven_WildCharge_ChargeFull.ogg',field:'unchanged-V5-wild-charge-full',...sourceSoundEventMetadata(a)});
    }
    if(result.effectMask&32)this.stopSkillEffectGroup(a,'sourceWildChargeEffectGroup','original-stop-effect-set');
    if(result.skillExtra){
      const v=result.skillExtra;a.vx=v.nowSpeedX*a.facing;a.vy=v.nowSpeedY;
      a.passiveSpeed={x:v.passiveSpeedX,y:v.passiveSpeedY};a.skillDisableGravity=v.disableGravity;
      a.skillDownAccel=v.downAccel;a.skillDamageReducePercent=v.damageReducePercent;
    }
    if(result.skillMotion){
      a.vx=result.skillMotion.nowSpeedX*a.facing;
      a.passiveSpeed.x=result.skillMotion.passiveSpeedX;
    }
    if(!result.megaDrill)return;
    const mutation=result.drillMutation,raw=this.profileFor(a).states[a.state].raw;
    a.sourceMegaDrill=clone(result.megaDrill);
    if(mutation.phase==='OnFrameMoveFuture')a.vx=result.megaDrill.nowSpeedX*a.facing;
    if(mutation.clearHitHistory)a.hits={};
    if(mutation.damageOverridden){
      // SimpleInit's temporary defaults are immediately replaced by the full
      // target table, exactly as SetDamageData follows it in Raven.cpp.
      const data=raw[mutation.damageOverridden];
      if(!data){this.note('mega-drill-next-data','Target next DamageData is unavailable',a);return;}
      Object.assign(a.sourceMegaDrill,{reAttack:data.RE_ATTACK===1,hitGap:data.HIT_GAP??0,backSpeedX:data.BACK_SPEED_X??0});
      this.emit('characterDamageDataChanged',a.id,{state:a.state,dataStage:a.sourceMegaDrill.damageStage,
        animationTime:a.animationTime,clearHitUnits:mutation.clearHitHistory,
        evidence:'compiled V5 MegaDrill Now callback + complete target2016 DAMAGE_DATA_NEXT; original-client trace pending'});
    }
    if(mutation.attackBoxMask)this.emit('characterAttackBoxesChanged',a.id,{state:a.state,enabledBoxes:mutation.enabledBoxes,
      animationTime:a.animationTime,evidence:'compiled V5 MegaDrill callback; target runtime pending'});
    for(const request of mutation.helperRequests){
      this.note('mega-drill-helper-factory','Original helper creation/follow requests preserved; host factory lifetime is not verified',a);
      this.emit('originalSkillHelperRequest',a.id,request);
    }
  }
  applyCommandResult(a,result){
    a.vx=result.vx;a.vy=result.vy;a.passiveSpeed=result.passiveSpeed;
    if(result.facing===1||result.facing===-1)a.facing=result.facing;
    a.sourceCommandFlags=result.flags;a.y=result.y;a.canNotJumpTime=result.canNotJumpTime;
    for(const key of ['canNotAttackTime','reAttackZ1Time','mp','sourceDashJumpEffectHandle'])if(Number.isFinite(result[key]))a[key]=result[key];
    if(result.reAttackZ1Right!==undefined)a.reAttackZ1Right=result.reAttackZ1Right;
    if(['RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X'].includes(a.state))a.jumpAttackDown=!!(result.flags&1);
  }
  commandFuture(a,keys,elapsed){
    if(this.commandsFor(a)){
      const oldPassive=a.passiveSpeed;
      const result=this.commandsFor(a).runFuture(a,keys,this.profileFor(a),elapsed);
      if(result.handled)this.applyCommandResult(a,result);
      if(a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX'&&result.passiveSpeed.x===2200&&oldPassive.x!==2200)
        this.emit('velocityEvent',a.id,{field:'nativeZXDiagonal',values:[2200,-2640],evidence:'unchanged reference-v5 Raven.cpp:11603 compiled WASM'});
      a.animationBeforeTime=result.animationBeforeTime;a.animationOneshotTimer=result.animationOneshotTimer;
      return result.handled;
    }
    if(!this.hasNasod(a)){
      a.animationBeforeTime=a.animationTime;a.animationOneshotTimer=Math.max(a.animationOneshotTimer??0,a.animationTime);
      return false;
    }
    // Source-informed fallback preserves the same phase boundary. Future uses
    // the preceding animation interval, BEFORE CommonFrameMove advances it.
    const timer=t=>(a.animationOneshotTimer??0)<t&&(a.animationBeforeTime??0)<t&&a.animationTime>=t;
    if(a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX'&&timer(.267)){
      a.vx=0;a.vy=0;a.passiveSpeed={x:2200,y:-2640};
      this.emit('velocityEvent',a.id,{field:'nativeZXDiagonal',values:[2200,-2640],evidence:'reference-v5 Raven.cpp:11603; JS candidate fallback'});
    }
    if(a.state==='RSI_DASH_JUMP_COMBO_ZZ'&&timer(.23))a.vy=this.profileFor(a).physics.MAX_G_SPEED/2;
    if(a.state==='RSI_COMBO_ZZXX'&&timer(.35))a.vx=this.profileFor(a).physics.WALK_SPEED*a.stats.moveSpeedMultiplier*a.facing;
    a.animationBeforeTime=a.animationTime;a.animationOneshotTimer=Math.max(a.animationOneshotTimer??0,a.animationTime);
    return false;
  }
  skill(id,actor=this.state.actors[0]) { return this.profileFor(actor).skillCatalog.find(v => v.skillId === id); }
  // This presentation counter survives local rollback snapshots, but is not
  // an owner wire field. A validated remote controller can rebase stateSerial
  // backwards without rewinding the receiver's distinct audio generation.
  beginSourceAudioState(a,{force=false}={}) {
    const identity=a.state+':'+a.stateSerial;
    if(!force&&a.sourceAudioPresentationIdentity===identity)return a.sourceAudioPresentationSerial;
    a.sourceAudioPresentationIdentity=identity;
    a.sourceAudioPresentationSerial=(a.sourceAudioPresentationSerial??0)+1;
    return a.sourceAudioPresentationSerial;
  }
  sourceExtendedSoundEvent(a,entry,presentationSerial=a.sourceAudioPresentationSerial) {
    this.soundEvent(a,entry.field,entry.value,{sourceNativeSound:{handleGroup:entry.nativeHandleGroup,
      deleteConditions:[...entry.deleteConditions],stateSerial:a.stateSerial,presentationSerial,field:entry.field,loop:false}});
  }
  soundEvent(a,field,v,extra={}) {
    const rate = v['3']??100;
    if (Math.floor(this.visualRng(a)*100)<rate) this.emit('sound',a.id,{name:v['2'],field,
      ...sourceSoundEventMetadata(a,v['4']===1||v['4']===true),soundSet:clone(a.soundSet),...extra});
  }
  spawnSet(a, name, timingOverride, deleteConditions = [], hyperMode = false) {
    if(typeof hyperMode!=='boolean')throw new TypeError('EffectSet Hyper mode must be an explicit boolean');
    const def = this.profileFor(a).effectSets[name];
    const timing = timingOverride ?? def?.raw.EVENT_TIMER_TYPE ?? this.profileFor(a).enums.EFFECT_SET_TIMER_TYPE.ESTT_ANIM;
    this.emit('effectSet',a.id,{name,timing,deleteConditions,hyperMode});
    if (!def) return; // Visual-only declarations do not imply damage.
    const clock = timing === this.profileFor(a).enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM ? 'custom' : 'animation';
    const first=this.state.nextEffectId;
    for (const [k,v] of Object.entries(def.raw)) if (/^EFFECT\d+$/.test(k)) {
      const effect=this.createEffect(a,v,{setName:name,clock,start:v.START_TIME??0,deleteConditions,hyperMode});
      if(effect)effect.definitionMember=k;
    }
    if(name===WIND_SLICER_SET)bindWindSlicerSet(this.state.effects.filter(e=>e.id>=first),this.profileFor(a));
    if(isElswordProfile(this.profileFor(a))&&Object.hasOwn(LK_BONE_TARGETS,name))bindLKSetMeshTargets(this.state.effects.filter(e=>e.id>=first));
    if(isElesisProfession(a.professionId)&&Object.hasOwn(ELESIS_BONE_TARGETS,name))bindLKSetMeshTargets(this.state.effects.filter(e=>e.id>=first));
    if(this.profileFor(a).target.unitClass===122&&Object.hasOwn(ADD_BONE_TARGETS,name))bindLKSetMeshTargets(this.state.effects.filter(e=>e.id>=first));
    if(this.profileFor(a).target.unitClass===123&&Object.hasOwn(ADD_ANALYSIS_BONE_TARGETS,name))bindLKSetMeshTargets(this.state.effects.filter(e=>e.id>=first));
    if([122,123,126].includes(this.profileFor(a).target.unitClass)&&Object.hasOwn(ADD_COMMON_BONE_TARGETS,name))bindLKSetMeshTargets(this.state.effects.filter(e=>e.id>=first));
    if(isVeteran(this,a))bindVeteranTargetSet(this.state.effects.filter(e=>e.id>=first),this.profileFor(a));
    if(deleteConditions.includes(this.profileFor(a).enums.DELETE_CONDITION_EFFECT_SET.DCES_CUSTOM_STATE))
      a.sourceCustomStateEffectGroup=[...(a.sourceCustomStateEffectGroup??[]),...this.state.effects.filter(e=>e.id>=first).map(e=>({id:e.id,name:e.name,setName:e.setName}))];
  }
  createEffect(a,definition,{setName=null,clock='custom',start=0,deleteConditions=[],birthAnchor=null,parentEffectId=null,sourceLandY=null,hyperMode=false,sourceDirSpeedSign=1,sourceProfessionId=null}={}) {
      if(typeof hyperMode!=='boolean')throw new TypeError('Effect Hyper mode must be an explicit boolean');
      if(sourceDirSpeedSign!==1&&sourceDirSpeedSign!==-1)throw new TypeError('Effect direction speed sign must be +1 or -1');
      const effectProfile=sourceProfessionId?this.profiles[sourceProfessionId]:this.profileFor(a);
      if(!effectProfile)throw new RangeError('Unknown source profession: '+sourceProfessionId);
      const v=addPrismProjectDefinition(effectProfile,{setName,skillId:a.skillId},definition);
      const name=hyperMode&&typeof v.HYPER_NAME==='string'&&v.HYPER_NAME.length>0?v.HYPER_NAME:v.NAME;
      const templateKey=resolveEffectTemplateKey(effectProfile.effectTemplates,name,v.EFFECT_TYPE);
      if(templateKey===null){this.note('effect-template-type:'+name,'EffectSet type has no matching source template registry; wrong-kind substitute rejected',a);return null;}
      const effect = { id: this.state.nextEffectId++, ownerId: a.id, ownerStateSerial: a.stateSerial, name,
        setName,parentEffectId,hyperMode,
        definition: clone(v), clock, setStartAnimation: a.animationTime, setStartState: a.stateTime,
        start, elapsed: 0, animationTime: 0, active: false, stage: 0, hits:{},hitGaps:{},sourceHitMemory2016:[], hitCount:0, childCounts:{}, soundFired:[],
        setElapsed:0, deleteConditions:clone(deleteConditions), deleteOnStateEnd: deleteConditions.includes(2), x:a.x,y:a.y,z:a.z, facing:a.facing,
        powerMultiplier:veteranEffectFactoryPower(this,a), skillId:a.skillId,traitPolicy:clone(a.skillContext?.traitPolicy??null), damage: effectProfile.damageEffects[name] ? clone(effectProfile.damageEffects[name].raw) : null };
      applyAddFormationSourceClock(effect,a,effectProfile);
      // User's final-Z dive cue: the raw set starts ReadyPM at .01, before
      // the authored .3 dive. Delay only that display to the speed boundary;
      // preserve the original damage member and all frozen declarations.
      if(effectProfile.target.unitClass===106&&setName==='EFFECTSET_Dash_Jump_ZZZ'&&name==='RST_ReadyPM')
        effect.start=effectProfile.states.RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ.raw.SPEED_TIME0['3'];
      if(sourceProfessionId)effect.sourceProfessionId=sourceProfessionId;
      effect.effectName = effect.name;
      if(isVeteran(this,a)){const attachment=veteranAttachmentKey(v);if(attachment)effect.sourceVeteranAttachment=attachment;}
      effect.sourceSkillMeshControl=[24029,24007,900].includes(effect.skillId);
      effect.sourceMeshLandY=a.landPosition?.[1]??a.y;
      effect.sourceSetTargetMesh=isWindSlicerCarrier(effect);
      effect.mainEffectName = effect.damage?.MAIN_EFFECT_NAME ?? (templateKey!==name?templateKey:effect.sourceSetTargetMesh||effectProfile.target.unitClass===123&&name===ADD_FURY_DRONE||effectProfile.target.unitClass===112&&(/^elsword_A_swordFall_M0[1-5]$/.test(effect.name)||['ElswordSheath02','SecondBlade'].includes(effect.name))||([101,120,121,125].includes(effectProfile.target.unitClass)||(effectProfile.target.unitClass===122&&Object.hasOwn(ADD_BONE_TARGETS,setName)||effectProfile.target.unitClass===123&&Object.hasOwn(ADD_ANALYSIS_BONE_TARGETS,setName)))&&v.BONE_TRACE_TARGET_MESH===1?effect.name:null);
      effect.mainEffectName??=stardustMeshMain(effect,effectProfile);
      if(SHADOW_MESH_NAMES.has(effect.mainEffectName)||[101,115].includes(effectProfile.target.unitClass)&&LITERAL_MESH_NAMES.has(effect.mainEffectName)||effectProfile.target.unitClass===106&&['RST_DashJump_XZ_ProDummy','RST_ShockWave_ProDummy'].includes(effect.mainEffectName)||effectProfile.target.unitClass===112&&(/^(?:SwordFallBlade[1-4]|elsword_A_swordFall_M0[2-5])$/.test(effect.mainEffectName))||usesElesisLiteralMesh(effectProfile,effect)||usesAddLiteralMesh(effectProfile,effect)){
        effect.sourceSkillMeshControl=true;effect.sourceShadowMeshPending=true;
        effect.sourceLiteralMotion=[101,106,112,115,120,121,125,122,123,126].includes(effectProfile.target.unitClass);
        effect.sourceMeshInheritedLandY=sourceLandY;
      }
      const template = effectProfile.effectTemplates?.[effect.mainEffectName];
      initializeGMSpawnRotation(effect,effectProfile,()=>this.rng());
      effect.initialAnimationName = template?.initialAnimation?.name ?? null;
      effect.initialAnimationPlayback = template?.initialAnimation?.playback ?? null;
      effect.initialSize = template?.initialSize ?? null;
      effect.initialVelocity = template?.initialVelocity ?? [0,0,0];
      effect.initialDirSpeed = template?.initialDirSpeed ?? 0;
      if(sourceDirSpeedSign!==1){effect.sourceDirSpeedSign=sourceDirSpeedSign;effect.initialDirSpeed*=sourceDirSpeedSign;}
      effect.templateFields=clone(template?.fields??{});
      effect.sourceLiteralMeshClock=effect.skillId===24007&&template?.fields?.MeshType==='X_SKIN_MESH';
      effect.sourceXCrashMeshClock=effect.mainEffectName==='Raven_RRF_SI_SA_X_Crash_Mesh03';
      if(effect.sourceXCrashMeshClock){
        effect.sourceXCrashCreatedStep=this.state.step;
        // MeshPlayer CreateInstance initializes its new mesh with .0001f.
        effect.elapsed=effect.animationTime=Math.fround(.0001);
      }
      const literalLife=Number(template?.lifeTimeLiteral);
      effect.lifeTimeSeconds=template?.fields?.LifeType==='LT_TIME'?template.fields.LifeTime:
        Number.isFinite(literalLife)&&literalLife>0?literalLife:null;
      if(template?.fields?.LifeType==='LT_TIME')effect.meshLifetimeElapsed=0;
      applySkillTraitMeshLifetime(effect);
      effect.velocityEvidence = template?.initialVelocity ? 'target-2016 template' : 'reference-v5 default zero KTDGXMeshPlayer.cpp:1317';
      effect.birthAnchor = birthAnchor; effect.birthActorPose = null; effect.currentAnchor=null;
      if(effect.damage)for(const key of Object.keys(effect.damage)){
        // SwordMan14319 never assigns a target UID to Big Burst. Original
        // LockOnData defaults both UIDs to-1 (DamageEffect.h527), so LOT_UID_VECTOR
        // is dormant; its original stationary .5s mesh must not chase victims.
        if(key==='LOCK_ON_DATA'&&!ADD_UID_LOCK_ON_EFFECTS.has(name)&&!isAddSummonProjectile(effect)&&effect.skillId!==24008&&!isBlazeWingLockOn(effect,effectProfile)&&!(effectProfile.target.unitClass===112&&name==='ELSWORD_EIS_SWORDBLASTING_PHANTOMSWORD')&&!(effectProfile.target.unitClass===101&&name==='DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST'))
          this.note('damage-lock-on:'+name,'General lock-on type unsupported outside the compiled ArcEnemy VectorLockOn path',a);
      }
      effect.definition=addDynamoInstanceDefinition(effectProfile,effect,effect.definition);
      this.state.effects.push(effect);
      return effect;
  }

  step(dt, input = {}, {snapshot = true} = {}) {
    finite(dt,'dt'); if (dt <= 0 || dt > .25) throw new RangeError('step dt must be >0 and <=.25 seconds; caller owns fixed timestep');
    this.state.time += dt; this.state.step++;
    retireEffectGroupHits(this.state);
    // Remote units are locally extrapolated for pose/collision, but HP and MP
    // are observations of that unit's owner. Prediction cannot spend/recover
    // their resources. Standalone and practice instances keep normal ownership.
    const remoteVitals=this.networkOwnerId===null?[]:this.state.actors.filter(a=>a.id!==this.networkOwnerId).map(a=>({a,hp:a.hp,mp:a.mp}));
    // Reproduce Data.cpp's mesh -> EffectSet pending-position buffer boundary
    // separately from current unit updates. TRACE SetPos cannot update XSkinAnim.
    // Full native Main/Now-Future scheduling is still an unmeasured candidate.
    advanceWindSlicerSets(this.state.effects,dt);
    for(const e of this.state.effects)if(e.sourceAddSummonSerial===undefined)advanceTraceMeshPose(e,this.actor(e.ownerId),this.effectAnchorSampler);
    for(const e of this.state.effects)if(e.sourceArcHandle&&!e.dead)advanceArcMesh(e,dt,this.profileFor(this.actor(e.ownerId)).effectTemplates[e.mainEffectName]);
    for(const e of this.state.effects)if(e.sourceArcStartMesh&&!e.dead)advanceArcStartMesh(e,dt,this.profileFor(this.actor(e.ownerId)).effectTemplates[e.mainEffectName]);
    for(const a of this.state.actors)a.stepPositionBackup={x:a.x,y:a.y,z:a.z};
    for (const a of this.state.actors) {
      // Confirmed disconnected seats keep only an identity tombstone. No
      // Buff tick, input, death callback or per-actor effect may execute here.
      if(a.pvpDisconnected)continue;
      const v = input.held || input.pressed || input.released ? (input.actorId && input.actorId !== a.id ? {} : a.id === (input.actorId ?? this.state.actors[0].id) ? input : {}) : input[a.id] ?? {};
      const keys = normalizedInput(v);
      const manaHeld={heldZ:keys.held.has('Z'),heldX:keys.held.has('X')};
      const ownsManaInput=this.networkOwnerId===null||a.id===this.networkOwnerId;
      a.manaBreakEventDue=false;
      keys.edges = v.edges??[];
      if(ownsManaInput)sampleManaBreakIntent(a,keys,dt);
      this.tickActor(a,dt,keys);
      // Original later received61c has no recheck of the local STOP gate.
      // Its socket integer recovery is distinct from Gage's unfrozen tick.
      advanceRavenSocketMp(this,a,dt);
      if(ownsManaInput&&this.nativeManaBreak&&a.manaBreakEventDue&&a.hp>0)manaBreakEvent(this.nativeManaBreak,a,manaHeld);
      const prior=a.knockdown.now,pending=a.knockdown.pending;a.knockdown=commitKnockdown(a.knockdown);
      if(pending!==null)this.emit('knockdownCommitted',a.id,{before:prior,contribution:pending,now:a.knockdown.now,evidence:REACTION_REFERENCE.evidence});
    }
    for(const a of this.state.actors)if(!a.pvpDisconnected)tickAddSummons(this,a,dt);
    for(const target of [...npcHitTargets(this),...prismHitTargets(this)])tickEffectGroupHits2016(this.state,target.actor.id,dt,{targetEpoch:this.networkEpochFor?.(target.owner.id)??0});
    // Only a normal host step retires absent target containers. Historical
    // tickEffects(0) and temporary ownership samples cannot perform this sweep.
    const groupTargets=new Set(this.state.actors.map(a=>a.id));
    for(const a of this.state.actors){
      if(a.sourceAddSummon)groupTargets.add(a.id+':apocalypse:'+a.sourceAddSummon.serial);
      for(const npc of a.sourceAddPrismEndpoints??[])groupTargets.add(a.id+':prism:'+npc.id);
    }
    retireRemovedGroupTargets2016(this.state,groupTargets);
    for(const a of this.state.actors)if(!a.pvpDisconnected)tickBloodCutterRequests(this,a,dt);
    for(const a of this.state.actors)if(!a.pvpDisconnected)tickElesisFirewalls(this,a,dt);
    for(const a of this.state.actors)if(!a.pvpDisconnected)rememberAddMoonlightOrigins(this,a);
    tickAddCountdownShake(this);
    this.tickEffects(dt);
    for (const a of this.state.actors) if(!a.pvpDisconnected)this.tickCore(a,dt);
    for(const {a,hp,mp}of remoteVitals){a.hp=hp;a.mp=mp;}
    for(const a of this.state.actors)if(a.sourceFacingHistory)a.sourceFacingHistory.current=a.facing;
    // Native unit OnFrameMove commits before DamageEffect OnFrameMove. Effects
    // reserve values for the victim's next update rather than committing early.
    return snapshot ? this.snapshot() : undefined;
  }

  addMoonlightPowerFor(actor,receipt){return addMoonlightPowerFor(this,actor,receipt);}

  tickActor(a, dt, keys) {
    tickEffectGroupHits2016(this.state,a.id,dt,{targetEpoch:this.networkEpochFor?.(a.id)??0});
    if(a.sourceReflectionNotice)a.sourceReflectionNotice.remaining=Math.max(0,a.sourceReflectionNotice.remaining-dt);
    // GameUnit::OnFrameMoveBuff runs before the User Future frame-stop gate.
    // Timed effects/finalizers use the fixed simulation dt, including hit-stop
    // and world-stop; animation/physics still use only unfrozen elapsed below.
    this.advanceActorBuffs(a,dt);
    filterAddVoidAttackInput(a,keys);
    phantomSwordSync(this,a);
    // Stun rejects input before stop buffering too: an edge pressed while
    // stunned must not escape as a queued attack when both timers finish.
    if(a.buffControls?.inputBlock){keys=normalizedInput({});keys.edges=[];}
    const consumed=consumeKnockdown(a.knockdown,a.state);a.knockdown=consumed.gauge;
    if(consumed.consumed){clearRegisteredStunIdentities(a);this.emit('knockdownConsumed',a.id,{state:a.state});}
    for (const id of Object.keys(a.cooldowns)) a.cooldowns[id] = Math.max(0,a.cooldowns[id]-dt);
    advanceAddSystems(a,dt,{profile:this.profileFor(a),emit:(...args)=>this.emit(...args)});
    // The tracking mark shares its source timed-buff lifetime. It must expire
    // while the caster's animation is stopped, and after owner death too.
    tickAddDroneMark(this,a,dt);
    if (!isAddActor(a) && a.hp>0 && a.awakening.remaining > 0) {
      a.awakening.remaining = Math.max(0,a.awakening.remaining-dt);
      if (!a.awakening.remaining) this.expireAwakening(a);
    }
    if(a.deathComplete)return;
    if(a.hp<=0){a.death=true;keys=normalizedInput({});keys.edges=[];
      const fatal=deathState({hp:a.hp,grounded:a.grounded,fromFront:a.lastAttackerFront});
      if(fatal&&!deathStates.has(a.state))this.enter(a,fatal,'fatal-grounded');
    }
    // GUUser SetInputData:28786-28901 filters the received packet using the
    // lock value BEFORE CommonFuture:14954-14966 decrements its timer. This
    // also precedes our explicitly nonnative hit-stop/directional adapters.
    const attackLockBefore=a.canNotAttackTime??0,jumpLockBefore=a.canNotJumpTime??0;
    releaseAddAirAttack(a,keys);
    if(attackLockBefore>0)for(const key of ['Z','X']){keys.pressed.delete(key);keys.held.delete(key);}
    if(jumpLockBefore>0){keys.pressed.delete('UP');keys.held.delete('UP');}
    // Device double-key clock/release processing continues during world stops.
    // Preserve the timestamped gesture before buffering its action edge.
    a.tapReleased??={};a.doubleHeldDirections??=[];
    if(!keys.sampledDevice)for (const d of ['LEFT','RIGHT']) {
      if(keys.released.has(d)){a.doubleHeldDirections=a.doubleHeldDirections.filter(v=>v!==d);if(a.tapTimes[d]!=null)a.tapReleased[d]=true;}
      if(!keys.pressed.has(d))continue;
      const edge=keys.edges.find(e=>e.key===d&&e.down),now=Number.isFinite(edge?.time)?edge.time:this.state.time;
      const last=a.tapTimes[d];a.tapTimes[d]=now;
      if(this.presetFor(a).doubleTapWindowSeconds!=null&&last!=null&&a.tapReleased[d]&&now-last<=this.presetFor(a).doubleTapWindowSeconds+1e-9&&now>=last){keys.pressed.add('DASH');if(!a.doubleHeldDirections.includes(d))a.doubleHeldDirections.push(d);delete a.tapTimes[d];}
      a.tapReleased[d]=keys.released.has(d);
    }
    // Persistent pureDouble is a held level. Do not retain it after a
    // down+up tap which completed entirely between ticks (before edge intent
    // is added to held for the one-frame browser action adapter).
    a.doubleHeldDirections=a.doubleHeldDirections.filter(d=>keys.held.has(d));
    const stopAtPacketStart=Math.max(0,a.worldStop,a.hitStop);
    if(this.profileFor(a).target.unitClass===107&&this.presetFor(a).sampledComboStopLatch!==false){
      const latch=captureComboStopInput(a,keys,this.commandsFor(a),this.profileFor(a));
      if(latch)this.emit('comboStopInputLatched',a.id,{...latch,adapter:COMBO_STOP_INPUT_VERSION});
    }
    captureCancelInput(a,keys);
    const elapsed=advanceActorStops(a,dt);
    this.addPredictionPhysics.recordFrame?.(a,elapsed);
    // ShowInvincible is independent of protection. Its white swap clock keeps
    // moving during frame stop; the display lifetime uses the host's existing
    // unfrozen elapsed boundary (fixed V5 GUUser:18095-18113).
    a.showInvincible??=createInvulnerabilityDisplay();
    advanceInvulnerabilityDisplay(a.showInvincible,dt,elapsed);
    // Hit-stop consumes time, not input edges. Native combo flags survive stops.
    if (elapsed <= 0) {
      a.pendingPressed ??= [];
      // SetInputData replaces the source device packet during a stop; a stale
      // released direction must not be resurrected as a new one/pure press.
      if(keys.sampledDevice&&![100,101,112,120,121,125].includes(this.profileFor(a).target.unitClass))a.pendingPressed=[];
      else if(keys.sampledDevice){
        // Browser edges can occur wholly inside the freeze. Keep LK attack
        // intent until its command callback resumes; directions stay live.
        a.pendingPressed=a.pendingPressed.filter(k=>k==='Z'||k==='X');
        if(isInfinitySword(this,a)&&keys.oneDoubleX)a.sourceInfinitySword.pendingDoubleX=true;
        for(const key of ['Z','X'])if(keys.pressed.has(key)&&!a.pendingPressed.includes(key))a.pendingPressed.push(key);
      }
      else for(const key of keys.pressed)if(!a.pendingPressed.includes(key))a.pendingPressed.push(key);
      return;
    }
    resumeManaBreakDown(this,a);
    flushAddDePhysicalState(this,a);
    const sourceApplied=applySourceStateRequest(this,a);
    if(usesPvpEquipmentFormulas(a)&&(this.networkOwnerId===null||a.id===this.networkOwnerId)){
      // Equipment's separate CommonFrameMove recovery clock is not yet wired.
      // Do not silently consume that optional field on the character clock.
      if(a.equipmentAttributes.mpRecoveryPerSecond&&!this.hasNasod(a))this.note('equipment-mp-clock-unsupported','Equipment MP recovery needs its independent source clock',a);
      const recovery=naturalMpGain({baseRate:this.profileFor(a).components.MP_CHANGE_RATE,elapsed,channel:'normal'});
      if(recovery===null)this.note('natural-mp-source-missing','Source MP_CHANGE_RATE is unavailable; no substitute rate',a);
      else a.mp=clamp(a.mp+recovery,0,a.mpMax);
      const addRecovery=addNaturalMpRecoveryRate(a,this.profileFor(a));
      if(addRecovery!==null)a.mp=clamp(a.mp+addRecovery*elapsed,0,a.mpMax);
    }
    veteranPassives(this,a,dt);
    const guildRecovery=stepGuildRecovery(a,elapsed);
    if(guildRecovery)this.emit('guildHpRecovered',a.id,guildRecovery);
    if(this.nativeManaBreak&&elapsed>0){
      // Gauge CommonFuture precedes CommonEvent: consume last event's latch,
      // then the raw held-key latch is set after this actor's update completes.
      if(!advanceElesisBreakCharge(a,elapsed))advanceManaBreak(this.nativeManaBreak,a,elapsed,this.profileFor(a).components.MP_CHARGE_RATE);
      a.manaBreakEventDue=a.hp>0;
    }
    if(this.hasNasod(a)&&a.awakening.remaining>0){
      const result=evaluateNasod(this.nativeNasod,'timer',nasodSnapshot(a,{elapsed}));applyNasodResult(a,result);
    }
    if(a.buffControls?.inputBlock){keys=normalizedInput({});keys.edges=[];a.pendingPressed=[];a.buffered=null;a.cancelInput=null;}
    if(this.profileFor(a).target.unitClass===107&&this.presetFor(a).sampledComboStopLatch!==false){
      const replay=replayComboStopInput(a,keys,this.commandsFor(a),this.profileFor(a));
      if(replay)this.emit('comboStopInputReplayed',a.id,{...replay,adapter:COMBO_STOP_INPUT_VERSION});
    }
    if(a.buffControls?.dashBlock){keys.pressed.delete('DASH');
      if(a.state===S.dash)this.enter(a,S.dashEnd,'buff-dash-impossible');}
    a.knockdown=advanceKnockdown(a.knockdown,elapsed);
    const forceInvincibleBefore=a.forceInvincible;
    a.forceInvincible=Math.max(0,a.forceInvincible-elapsed);
    if(!keys.sampledDevice||this.profileFor(a).target.unitClass!==107)for(const key of a.pendingPressed??[])if(a.hp>0)keys.pressed.add(key);
    a.pendingPressed=[];
    if(isInfinitySword(this,a)&&a.sourceInfinitySword?.pendingDoubleX){keys.oneDoubleX=true;delete a.sourceInfinitySword.pendingDoubleX;}
    releasePlatformAttack(a,keys);
    // One DOM tap can start and end between fixed ticks. Its edge still carries
    // directional intent; it must not disappear because held is empty by tick.
    if(!keys.sampledDevice){
      const canonical=key=>String(key).toUpperCase().replace(/^ARROW/,'');
      const intent=[...keys.edges.filter(e=>e.down).map(e=>canonical(e.key)),...[...keys.pressed].map(canonical)];
      for(const d of intent)if(['LEFT','RIGHT','UP','DOWN'].includes(d)&&keys.pressed.has(d))keys.held.add(d);
      prioritizeHorizontalInput(keys);
    }
    if(a.mapMechanics)a.mapMechanics.lockRemaining=Math.max(0,a.mapMechanics.lockRemaining-elapsed);
    a.inputLock = Math.max(0,a.inputLock-elapsed,a.mapMechanics?.lockRemaining??0);
    a.canNotJumpTime=Math.max(0,(a.canNotJumpTime??0)-elapsed);
    a.canNotAttackTime=Math.max(0,(a.canNotAttackTime??0)-elapsed);
    a.reAttackZ1Time=Math.max(0,(a.reAttackZ1Time??0)-elapsed);
    if(attackLockBefore>0){keys.pressed.delete('Z');keys.pressed.delete('X');keys.held.delete('Z');keys.held.delete('X');}
    if(!keys.sampledDevice){
      keys.pureDoubleRight=a.doubleHeldDirections.includes('RIGHT')&&keys.held.has('RIGHT');
      keys.pureDoubleLeft=a.doubleHeldDirections.includes('LEFT')&&keys.held.has('LEFT');
    }
    if(jumpLockBefore>0){keys.held.delete('UP');keys.pressed.delete('UP');}
    if(!a.inputLock&&!a.buffControls?.inputBlock&&a.cancelInput?.stage!=='pending')releaseCancelInput(a,keys,this.profileFor(a).states[a.state].raw,{attackBlocked:attackLockBefore>0});
    if(deathStates.has(a.state))a.pendingPlatformJump=null;
    if (a.pendingPlatformJump) {
      const launch = a.pendingPlatformJump; a.pendingPlatformJump = null;
      a.grounded = false; a.lineId = null; a.y += this.profileFor(a).referenceSemantics.lineRadius;
      this.enter(a,S.jumpUp,'native-jump-platform');
      a.vx += launch.absolute?launch.x:launch.x*a.facing; a.vy = launch.y;
      this.emit('jumpPlatformLaunched',a.id,{lineId:launch.lineId,speedX:launch.x,speedY:launch.y});
    }
    tickAddRecasts(this,a,elapsed);
    tickMaximumStrike(this,a,elapsed);
    tickAddFantasyTracer(a,elapsed);
    tickAddPassiveBuffs(this,a);
    advanceAddCorePassives2016(this,a,elapsed);
    const effectiveKeys = a.inputLock ? normalizedInput({}) : keys;
    const inputSerial=a.stateSerial;
    const before = a.animationTime, serial = a.stateSerial;
    const def = addMotionDefinition(this.profileFor(a),a,elesisWaitDefinition(this.profileFor(a),a,lordKnightWaitDefinition(this.profileFor(a),a,this.profileFor(a).states[a.state]))), raw = def.raw;
    if(isAddActor(a)&&a.state===S.wait&&a.animationName!==def.animationName){this.enter(a,S.wait,'add-formation-wait-motion-change');return;}
    a.stateTime += elapsed;
    this.advanceSkillCandidates(a,effectiveKeys,elapsed);
    lordKnightFrame(this,a,effectiveKeys,elapsed);
    elesisFrame(this,a,effectiveKeys,elapsed);
    infinitySwordFrame(this,a,effectiveKeys,elapsed);
    runeSlayerFrame(this,a,effectiveKeys,elapsed);
    bladeMasterFrame(this,a,elapsed);
    const skillInputs=this.skillSourceInputs(a);
    if(a.state==='SI_SA_RRF_X_CRASH'){
      const anchor=this.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:this.profileFor(a)});
      if(anchor?.position?.length===3&&anchor.position.every(Number.isFinite))skillInputs.xCrashBonePosition=anchor.position;
      else this.note('x-crash-bip01-bone','Original XCrash Now callback requires an actual Bip01 bone; omitted without it',a);
    }
    if(a.state==='RSI_A_RF_MEGADRILL_BREAK'){
      const anchor=this.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01_L_Hand'}},a,{profile:this.profileFor(a)});
      if(anchor?.position?.length===3&&anchor.position.every(Number.isFinite))skillInputs.handPosition=anchor.position;
      else this.note('mega-drill-hand-bone','Original MegaDrill Now needs Bip01_L_Hand; callback omitted without an actual bone sample',a);
    }
    const skillFrame=(a.state==='RSI_A_RF_MEGADRILL_BREAK'&&!skillInputs.handPosition||a.state==='SI_SA_RRF_X_CRASH'&&!skillInputs.xCrashBonePosition)?null:
      originalSkillFrame(this.skillsFor(a),a,this.profileFor(a),elapsed,skillInputs);
    if(skillFrame){this.applySkillPhase(a,skillFrame);if(skillFrame.megaDrill)a.sourceMegaDrillNowSupported=true;}
    if(skillFrame)this.executeSkillCommands(a,skillFrame);
    if(this.commandsFor(a)?.runNow){
      const sourceLine=this.map.lines.find(line=>line.lineId===a.lastTouchLineId);
      if(sourceLine){const d=sourceLine.end.map((n,i)=>n-sourceLine.start[i]),length=Math.hypot(...d);if(length>0)a.sourceCommandDirection=d.map(n=>n/length);}
      if(a.state==='RSI_COMBO_XXX'&&!isVeteran(this,a)){
        const hand=this.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy2_Lhand'}},a,{profile:this.profileFor(a)});
        a.sourceCommandHandPosition=hand?.position;
        if(!a.sourceCommandHandPosition)this.note('xxx-original-hand-bone','Pinned XXX callback needs original Dummy2_Lhand bone; omitted without a real sample',a);
      }
      const result=a.state==='RSI_COMBO_XXX'&&!isVeteran(this,a)&&!a.sourceCommandHandPosition?{handled:false}:this.commandsFor(a).runNow(a,this.profileFor(a));
      if(result.handled){
        this.applyCommandResult(a,result);
        resolveXxxCandidate(this,a,result);
        if(result.unsupportedManualDamageCalls&&a.state!==XXX_CANDIDATE.state)this.note('xxx-manual-damage-consumer',
          'Pinned XXX callback requests manual DamageCheck; target2016 personal damage data/callback are unavailable, so no resource-only set is guessed',a);
        for(const command of result.damageCommands??[]){
          for(let i=0;i<command.count;i++){
            const effect=this.createEffect(a,{NAME:command.name},{clock:'custom',birthAnchor:{position:command.position,
              facing:a.facing,evidence:command.evidenceClass,sourceCommit:command.sourceCommit}});
            this.emit('originalRecoveredCommand',a.id,{state:a.state,name:command.name,effectId:effect.id,position:command.position,
              sourceCommit:command.sourceCommit,evidenceClass:command.evidenceClass});
          }
        }
        for(const command of a.state===XXX_CANDIDATE.state?[]:result.particleCommands??[]){
          for(let i=0;i<command.count;i++){
            if(this.profileFor(a).effectTemplates[command.name])this.createEffect(a,{NAME:command.name},{clock:'custom',
              birthAnchor:{position:command.position,facing:a.facing,evidence:command.evidenceClass,sourceCommit:command.sourceCommit}});
            else this.note('native-command-particle-'+command.name,
              'Original command particle lacks an indexed source definition; kept unsupported',a);
            this.emit('originalRecoveredParticle',a.id,{state:a.state,name:command.name,position:command.position,
              supported:!!this.profileFor(a).effectTemplates[command.name],sourceCommit:command.sourceCommit,evidenceClass:command.evidenceClass});
          }
        }
        if(result.effectSetCalls){
          // Raven15788: the next successful shot stops its previous set handle.
          // Visual records may already be retired from combat while their
          // original particles remain alive in the presentation executor.
          for(const prior of a.sourceDashJumpEffectGroup??[]){
            const live=this.state.effects.find(e=>e.id===prior.id);
            if(live){live.dead=true;live.endEmitted=true;}
            this.emit('effectEnded',a.id,{effectId:prior.id,name:prior.name,setName:'EffectSet_RRF_DashJumpX',reason:'original-stop-effect-set'});
          }
          const first=this.state.nextEffectId;this.spawnSet(a,'EffectSet_RRF_DashJumpX',undefined,[1]);
          a.sourceDashJumpEffectGroup=this.state.effects.filter(e=>e.id>=first).map(e=>({id:e.id,name:e.name}));
        }
        if(result.magicFailCalls)this.emit('nativeCommandMagicFail',a.id,{source:'Raven.cpp:15806-15811',visualBinding:'unavailable'});
        if(result.effectSetCalls||result.magicFailCalls)this.emit('originalCommandNow',a.id,{state:a.state,mp:a.mp,spawned:result.effectSetCalls,disabledCameraCalls:result.disabledCameraCalls});
      }
    }
    // Now and Future consume the same preceding animation interval. Only the
    // common command Future below advances the shared before/oneshot clocks.
    const skillFuture=originalSkillFuture(this.skillsFor(a),a,this.profileFor(a),elapsed,skillInputs);
    if(skillFuture)this.applySkillPhase(a,skillFuture);
    const sourceFuture=this.commandFuture(a,effectiveKeys,elapsed);
    veteranAirSkillFuture(this,a,effectiveKeys,elapsed);
    bladeMasterFuture(this,a);
    const sourceVerticalLaunch=this.processSpeedFactors(a);
    if(isVeteran(this,a))vcCommandAirFollowupFuture(a,this.profileFor(a).states[a.state]);
    this.advanceAnimation(a,def,elapsed);
    // EventProcess checks this frame's advanced animation time. Follow-up
    // Down/attack packets remain before physics on their later frames.
    if(!a.inputLock&&!a.buffControls?.inputBlock&&a.cancelInput?.stage==='pending')releaseCancelInput(a,effectiveKeys,raw);
    this.processStateEvents(a,before,a.animationTime);
    phantomSwordFrame(this,a,elapsed);
    Object.assign(a,evaluateStateProtection(this.profileFor(a).states[a.state].raw,a.animationTime,
      stateProtectionOptions(this.presetFor(a),a,{forceInvincible:Math.max(forceInvincibleBefore,a.forceInvincible)})));
    advanceDestructionRage(a,elapsed);
    if(a.skillSuperArmorNotRed!==undefined)a.superArmorNotRed=a.skillSuperArmorNotRed;
    if(a.skillContext?.traitPolicy?.superArmor)a.superArmor=true;
    this.integrate(a,elapsed,effectiveKeys,def,before,{sourceFuture,sourceVerticalLaunch});
    tickLPZxTier(this,a);
    advanceAddMovement(a,elapsed);
    updateAddQuicksilverLink(this,a);
    tickAddFactory(this,a);
    tickAddPanzer(this,a,elapsed);
    tickAddFury(this,a,elapsed);
    tickAddNativeSkills(this,a,elapsed);
    tickAddMagnetron(this,a,elapsed);
    if(a.invincible||a.superArmor)a.flyCount=0;
    if(deathStates.has(a.state)){
      const sacrifice=processGuildHeroSacrifice(a,this.state.actors,{previousAnimationTime:before,animationTime:a.animationTime});
      if(sacrifice){
        this.emit('guildHeroSacrifice',a.id,sacrifice);
        this.emit('sound',a.id,{name:sacrifice.soundName,field:'guild-hero-sacrifice',...sourceSoundEventMetadata(a)});
        for(const heal of sacrifice.heals)this.emit('guildHpRecovered',heal.targetId,{...heal,skillId:510,sourceId:a.id});
      }
      const duration=this.profileFor(a).states[a.state].clip?.durationSeconds,endAt=duration-Math.max(duration/10,.03);
      const ended=a.animationStopped||a.animationTime>endAt;
      if(ended){
        a.animationStopped=true;
        // User::DieFrameMove clears remaining time at the animation end.
        // Run the buff-end host cleanup once so an active aura is also stopped.
        if(a.awakening.remaining>0||a.awakening.full||a.sourceAwakeningAuraEffectGroup?.length)this.expireAwakening(a,'death-animation-end');
      }
      a.deathPresentation=advanceDeathPresentation(a.deathPresentation,elapsed,{animationEnded:ended});
      a.deathAlpha=Math.max(0,a.deathPresentation.alpha);a.hidden=!a.deathPresentation.visible;
      if(a.hidden){a.deathComplete=true;this.emit('deathCompleted',a.id,{state:a.state});}
      return;
    }
    // GUUser CommonFrameMoveFuture:15180 restores passive speed AFTER physics.
    // It is neither an added velocity nor another arbitrary movement multiplier.
    if(a.stateSerial===serial){
      if(a.passiveSpeed.x!==-1)a.vx=a.passiveSpeed.x*a.facing;
      if(a.passiveSpeed.y!==-1)a.vy=a.passiveSpeed.y;
    }
    if (a.hp>0 && a.stateSerial === serial) this.checkCharacterAttack(a,before,a.animationTime);
    // Raven:11655-11663 checks Future foot support BEFORE every landing input
    // or animation-time window. Only execute that branch of the pinned V5
    // callback; binding its grounded .1/.3 windows would replace target2016.
    if(a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING'&&!a.grounded){
      const result=this.commandsFor(a)?.probeLandingEvent?.(a,{},this.profileFor(a));
      if(result?.handled){this.applyCommandResult(a,result);this.enter(a,result.state,'original-zx-landing-off-line');}
      else {
        this.enter(a,S.jumpDown,'reference-zx-landing-off-line');
        a.y-=this.profileFor(a).referenceSemantics.lineRadius*1.5;
      }
      return;
    }
    // State EventProcess receives input after CommonFuture physics. A launch
    // requested here must not receive an extra physics integration this tick.
    // Remote held levels feed the native running/charging controller. Reliable
    // source start events own action selection; delayed Z cannot invent a new
    // command when the currently playing remote animation naturally finishes.
    const remotePlayback=this.networkCombatPlaybackVersion===1&&this.networkOwnerId!==null&&a.id!==this.networkOwnerId;
    if(a.hp>0&&!a.inputLock&&!remotePlayback&&runSourceCommonPost(this,a,effectiveKeys))return;
    if(a.hp>0&&!a.inputLock&&!remotePlayback&&runRavenLocalCommandPost(this,a,effectiveKeys))return;
    if(!remotePlayback&&historicalSourcePostRow(a,this.profileFor(a))){
      const postProfile=sourceCancelProfile(a,this.profileFor(a));
      withSourcePostRequests(this,a,()=>{
        if(!runHistoricalExplicitPost(this,a,effectiveKeys))this.runActorPost(a,effectiveKeys,{before,serial,inputSerial,def:postProfile.states[a.state],elapsed,remotePlayback});
        if(a.hp>0&&!a.inputLock&&!this.sourcePostContext.skipBaseTail)sourcePostSkillDispatch(this,a,effectiveKeys,3);
      },{profile:postProfile});
      // The pending/post host returns before runActorPost's ordinary command
      // animation-end tail. Preserve that same XAP_WAIT stop here as well:
      // native D3DX LOOP clips such as Elsword JumpAttackX otherwise keep
      // wrapping visually while their own post waits for foot support.
      if(this.commandsFor(a)?.ownsAnimationEnd?.(a)&&!a.animationLoop){
        const duration=postProfile.states[a.state].clip?.durationSeconds;
        if(duration&&a.animationTime>duration-Math.max(duration/10,.03))a.animationStopped=true;
      }
      return;
    }
    if(sourceApplied&&!remotePlayback){
      // Applying a source request cannot gain an extra immediate apply through
      // the new record's legacy post. Its request stays pending as well.
      withSourcePostRequests(this,a,()=>this.runActorPost(a,effectiveKeys,{before,serial,inputSerial,def,elapsed,remotePlayback}));return;
    }
    this.runActorPost(a,effectiveKeys,{before,serial,inputSerial,def,elapsed,remotePlayback});
  }

  runActorPost(a,effectiveKeys,{before,serial,inputSerial,def,elapsed,remotePlayback}){
    const requestByte=a.sourceStateRequestByte;
    if(a.hp>0&&!a.inputLock&&!remotePlayback)this.processInput(a,effectiveKeys,{animationBeforeTime:before});
    if(a.stateSerial!==serial||this.sourcePostContext?.actor===a&&a.sourceStateRequestByte!==requestByte)return;
    if(lordKnightSkillEvent(this,a,effectiveKeys))return;
    if(elesisSwordEvent(this,a))return;
    if(elesisSkillEvent(this,a,effectiveKeys))return;
    if(infinitySwordSkillEvent(this,a,effectiveKeys))return;
    if(runeSlayerSkillEvent(this,a,effectiveKeys))return;
    if(veteranSkillEvent(this,a,effectiveKeys))return;
    if(bladeMasterSkillEvent(this,a,effectiveKeys))return;
    if(addSkillEvent(this,a,effectiveKeys))return;
    const shadowNext=advanceShadowStepCandidate(a,this.skillsFor(a),{dt:elapsed,profile:this.profileFor(a)});
    if(shadowNext){this.enter(a,shadowNext,'target-shadow-step-candidate-end');return;}
    if(a.skillId&&this.skillsFor(a)){
      const result=shadowStepCandidateEvent(a,this.skillsFor(a),{profile:this.profileFor(a),dt:elapsed,input:effectiveKeys})??
        originalSkillEvent(this.skillsFor(a),a,this.profileFor(a),effectiveKeys,elapsed,before);
      if(result){
        if(result.offsetY)a.y+=result.offsetY;
        if(result.state){this.enter(a,result.state,'original-cpp-skill-event');return;}
        // Its original callback owns the end; the generic movement end must
        // not silently override a held charge or a source-defined successor.
        if(result.ended)return;
      }
    }
    if(standupRollingEvent(this,a,effectiveKeys))return;
    if(this.commandsFor(a)?.handlesEvent(a)){
      // The old state's EventProcess consumes a command-start edge. It must
      // not become a second combo press in the newly entered state's callback.
      const eventKeys=inputSerial===serial?effectiveKeys:{...effectiveKeys,pressed:new Set()};
      const lower=eventKeys.pressed.has('DOWN')&&a.grounded&&this.nativeGeometry?.down({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId,downRadius:true,onLine:true});
      const result=ravenSourceCommandResult(this.profileFor(a),a,eventKeys,
        this.commandsFor(a).runEvent(a,eventKeys,this.profileFor(a),{canDown:!!lower?.found,animationBeforeTime:before}),a.sourceCommandFlags??0);
      if(result.handled){
        if(result.canNotJumpTime>a.canNotJumpTime)this.emit('jumpOnlyLock',a.id,{duration:result.canNotJumpTime,
          evidence:'unchanged reference-v5 Raven.cpp:8992/9044 compiled WASM; filters Up only'});
        this.applyCommandResult(a,result);
        if(result.boundaryCalls.down&&lower?.found){a.landPosition=lower.point;a.lastTouchLineId=lower.lineId;a.grounded=false;a.lineId=null;}
        if(result.state==='UNSUPPORTED_ZZZX'&&this.profileFor(a).target.unitClass===107){
          this.enter(a,'RRF_COMBO_ZZZX','target2016-rf-ZZZX171',{commandInput:eventKeys});return;
        }
        else if(result.state==='AWAKEN_REQUEST'){
          this.tryAwakening(a);
          return;
        }
        else if(result.state==='DASH_REQUEST'){
          // StateChangeDashIfPossible changes the state only. DashStartFuture
          // also leaves bIsRight intact; opposite held input is consumed by the
          // following Dash/DashEnd callbacks, rather than turning the cancel.
          if(!a.buffControls?.dashBlock){this.enter(a,a.grounded?S.dash:S.dashJump,'original-command-dash-request');return;}
        }
        else if(result.state){this.enter(a,result.state,this.commandsFor(a)===lordKnightCommands?'target-lk-command-event':'original-cpp-command-event',{commandInput:eventKeys});return;}
      }
    }
    if(!this.commandsFor(a)?.handlesEvent(a)){
      const period=def.clip?.durationSeconds;
      const next=groundHitReactionNext(a.state,{heightAboveLand:this.reactionHeightAboveLand(a),grounded:a.grounded,
        animationEnded:a.animationStopped||Number.isFinite(period)&&a.animationTime>period-Math.max(period/10,.03),
        animationTime:a.animationTime,skipPressed:['UP','DOWN','RIGHT','LEFT','Z','X','A','S','D','C','F','Q','W','E','R'].some(k=>effectiveKeys.held.has(k))});
      if(next){a.y+=next.offsetY;this.enter(a,next.state,'reference-ground-hit-event');return;}
    }
    const chain = this.profileFor(a).referenceSemantics.comboBuffers[a.state];
    const commandWindow=chain?.keyWindows?.[a.buffered]??chain;
    if (!this.commandsFor(a)?.handlesEvent(a) && chain && a.buffered && (commandWindow.inclusiveAfter?a.animationTime>=commandWindow.after:a.animationTime>commandWindow.after) &&
      (commandWindow.grounded == null || a.grounded === commandWindow.grounded)) {
      let next = chain[a.buffered];
      const direction=(effectiveKeys.held.has('RIGHT')?1:0)-(effectiveKeys.held.has('LEFT')?1:0);
      if(this.profileFor(a).target.unitClass===107&&a.state==='RSI_COMBO_XX'&&a.buffered==='X') next=effectiveKeys.held.has('DOWN')?'RSI_OVER_TAKER_COMBO_XXdownX':direction===a.facing?'RSI_OVER_TAKER_COMBO_XXfrontX':next;
      if(this.profileFor(a).target.unitClass===107&&a.state==='RSI_COMBO_ZZX'&&a.buffered==='X'&&direction===a.facing) next='RRF_COMBO_ZZXFRONTX';
      if (next) {
        const bindingEvidence=commandWindow.bindingEvidence??chain.bindingEvidence;
        if(bindingEvidence)this.note(`combo-binding:${a.state}`,bindingEvidence+'; target-native binding remains unverified',a);
        this.enter(a,next,'buffered-command'); return;
      }
    }
    if(this.hasNasod(a)&&!this.commandsFor(a)?.handlesEvent(a)){
      const fallback=rfCommandFallbackEvent(a,effectiveKeys,def);
      if(fallback){this.enter(a,fallback.state,fallback.reason);return;}
    }
    if(a.skillId&&this.skill(a.skillId,a).executor==='ShadowStep'&&['RSI_SI_A_RF_SHADOW_STEP','RSI_SHADOW_BACK_SLIDE_UPGRADE'].includes(a.state))return;
    const duration = def.clip?.durationSeconds;
    // V5 XSkinAnim OnFrameMove: end is period-transitionTime, not the last key.
    // No per-clip XET was supplied; retain the reference default explicitly.
    const endAt=this.commandsFor(a)?.animationEndAt?.(a,def)??duration-Math.max(duration/10,.03);
    // BM whirlwind counts complete source periods; the generic transition
    // threshold must not reset its clock before the class callback sees one.
    if(this.commandsFor(a)?.ownsAnimationLoop?.(a))return;
    // LK airborne callbacks own their successor even after the pose has
    // stopped. X1/ZZ must keep accepting a buffered follow-up until landing.
    if(this.commandsFor(a)?.ownsAnimationEnd?.(a)&&!a.animationLoop){
      if(duration&&a.animationTime>endAt)a.animationStopped=true;
      return;
    }
    if (duration && a.animationTime > endAt) {
      if((holdAirAnimation.has(a.state)||damageAirStates.has(a.state)||(this.profileFor(a).referenceSemantics.holdAirAnimationStates??[]).includes(a.state))&&!a.grounded)a.animationStopped=true;
      else if (a.animationLoop) {
        // Native XAP_LOOP calls ChangeAnim(currentName), resetting to zero and
        // retaining the outgoing track for the blend. A modulo cannot represent
        // this transition and made Dash/Jump visibly snap at every loop.
        this.startAnimationTransition(a,def,{loop:true}); a.animationTime=0;a.animationBeforeTime=0;a.animationOneshotTimer=0;
      }
      else this.endState(a,effectiveKeys);
    }
  }

  tryAwakening(a){
    // ELSE_IF_CAN_HYPER_MODE_THEN_STATE_CHANGE, GUUser.h11–24.
    if(hasEffectiveBlackHole(a))return false;
    if(isAddActor(a)){
      const gate=addFormationAvailability(a,this.profileFor(a));if(!gate.available)return false;
      if(gate.mode==='release')return stopAddFormation(a,{profile:this.profileFor(a),emit:(...args)=>this.emit(...args)});
      if(!beginAddFormation(a,{profile:this.profileFor(a),emit:(...args)=>this.emit(...args),passiveSample:addPassiveSample2016(this,a)}))return false;
      this.enter(a,S.awaken,'add-dp-formation-input');return true;
    }
    if(a.awakening.remaining>0&&a.awakening.orbs>0&&(a.passivePolicy?.awakening.canReawaken??(this.hasNasod(a)&&this.presetFor(a).passives?.includes(24405)))){
      // HyperModeStart saves the PRE-consumption count separately from the
      // single bead spent by Subliminal Rage. A three-bead reawakening can
      // therefore enable the electric field even though only one bead is paid.
      a.awakening.pendingAvailableOrbs=a.awakening.orbs;
      a.awakening.orbs--;a.awakening.pendingOrbs=1;a.awakening.reawakening=true;
      this.enter(a,S.awaken,'reawakening-input');return true;
    }
    if(!a.awakening.remaining&&a.awakening.orbs>0){
      a.awakening.pendingAvailableOrbs=a.awakening.orbs;
      a.awakening.pendingOrbs=a.awakening.orbs;a.awakening.orbs=0;a.awakening.reawakening=false;this.enter(a,S.awaken,'awakening-input');return true;
    }
    return false;
  }
  processInput(a, keys, eventContext) {
    filterAddVoidAttackInput(a,keys);
    const held = keys.held, pressed = keys.pressed;
    const elesisExternalSkillAllowed=isElesisProfession(a.professionId)&&(pressed.has('AWAKEN')||slotKeys.some(key=>pressed.has(key)))
      ? elesisCommandExternalSkillAllowed(a,keys,this.profileFor(a),eventContext)??elesisSkillExternalSkillAllowed(this,a,keys) : null;
    // Elesis' reviewed callback owns WALK/BWALK/DASH/attack ordering for both
    // ESI_* and SI_* skill phases. Common fallback must not preempt it.
    const skillCancel=eventContext?.sourceDispatch||isElesisProfession(a.professionId)&&a.skillId?null:skillCommandCancel(a,this.profileFor(a).states[a.state],keys);
    if(skillCancel){
      if(skillCancel.facing)a.facing=skillCancel.facing;
      this.enter(a,skillCancel.state,skillCancel.reason);
      // Held-key source skips request WAIT; reviewed fresh attack edges
      // continue through the normal free-state dispatcher in this packet.
      if(!skillCancel.facing&&!skillCancel.continueInput)return;
    }
    if(!eventContext?.sourceDispatch&&isVeteran(this,a)&&vcAirSkillCancelAllowed(a,this.profileFor(a).states[a.state])){
      const facing=keys.pureDoubleRight?1:keys.pureDoubleLeft?-1:
        pressed.has('DASH')?(held.has('RIGHT')?1:held.has('LEFT')?-1:0):0;
      if(facing&&!a.buffControls?.dashBlock){
        a.skillId=null;a.skillContext=null;
        a.facing=facing;this.enter(a,S.dashJump,'user-target2016-haze-air-followup');
      }else if((pressed.has('Z')||pressed.has('X'))&&!(a.canNotAttackTime>0)){
        a.skillId=null;a.skillContext=null;
        this.enter(a,S.jumpDown,'user-target2016-haze-air-followup');
      }
    }
    if(!eventContext?.sourceDispatch&&isVeteran(this,a)&&!a.buffControls?.dashBlock){
      const facing=vcCommandAirDashCancelDirection(a,this.profileFor(a).states[a.state],keys);
      if(facing){
        vcRememberAirFollowup(a,this.profileFor(a).states[a.state]);
        a.skillId=null;a.skillContext=null;
        a.facing=facing;
        this.enter(a,S.dashJump,'user-target2016-vc-air-followup');
        vcCommandAirFollowupFuture(a,this.profileFor(a).states[a.state]);
        // Continue with this packet so a simultaneous 66Z/66X edge becomes
        // the requested dash-jump attack, without a second physics step.
      }
    }
    if(!eventContext?.sourceDispatch&&isVeteran(this,a)){
      const cancel=vcSkillCommandCancel(a,this.profileFor(a).states[a.state],keys);
      if(cancel){
        a.skillId=null;a.skillContext=null;
        if(cancel.facing)a.facing=cancel.facing;
        this.enter(a,cancel.state,cancel.reason);
      }
    }
    const shadowInput=eventContext?.sourceDispatch||skillInputBlockReason(a)?null:shadowStepCandidateInput(a,keys);
    if(shadowInput){this.enter(a,shadowInput,'target-shadow-step-candidate-input');return;}
    if(addMovementInput(this,a,keys))return;
    const dashJumpEntry=a.state===S.dashJump;
    const doubleDirection=!a.buffControls?.dashBlock&&(pressed.has('DASH')||keys.pureDoubleRight||keys.pureDoubleLeft);
    // A physical66 can finish in the same packet as Z/X after a skill's
    // first direction tap already entered Walk. VC recovery still launches
    // the dash command, rather than losing the second tap to ordinaryZ/X.
    if(isVeteran(this,a)&&a.grounded&&[S.wait,S.walk,S.dashEnd].includes(a.state)&&
      !a.buffControls?.dashBlock&&(keys.pureDoubleRight||keys.pureDoubleLeft)&&(pressed.has('Z')||pressed.has('X'))){
      a.facing=keys.pureDoubleRight?1:-1;
      if(this.sourcePostContext?.actor===a&&!(a.canNotAttackTime>0)){
        a.skillId=null;a.skillContext=null;a.skillScale=1;
        this.enter(a,pressed.has('Z')?'RSI_DASH_COMBO_Z':'RSI_DASH_COMBO_X','vc-sampled-double-and-attack');return;
      }
      this.enter(a,S.dash,'vc-sampled-double-and-attack');
    }
    try {
    const direction = freeAirInputDirection(a.state,held);
    // Raven free-state EventProcess executes once after CommonFuture physics.
    // Ground/drop branches precede input in JumpDown/DashJump; JumpUp handles
    // attack/double/skill before the apex test (6282-6304,6316,6628).
    if(a.state===S.dashJump&&a.grounded){
      if(a.jumpOnLanding)this.jump(a,true);
      else if(a.downForce){a.downForce=false;this.enter(a,S.powerLand,'forced-down-land');}
      else this.enter(a,direction?S.dash:S.dashLand,'dash-jump-land');
      return;
    }
    if(a.state===S.jumpDown&&a.grounded){this.enter(a,S.land,'land');return;}
    if(!a.grounded&&[S.wait,S.swordWait,S.walk,S.dash,S.dashEnd,S.jumpReady,S.land,S.dashLand,S.powerLand].includes(a.state)){
      const dash=a.state===S.dash;a.y-=this.profileFor(a).referenceSemantics.lineRadius*1.5;
      this.enter(a,dash?S.dashJump:S.jumpDown,'source-free-walk-off');return;
    }
    const platformAttack=orderedPlatformAttack(a,keys);
    if(platformAttack&&this.dropPlatform(a)){
      a.platformAttackInput={key:platformAttack.key,stateSerial:a.stateSerial};
      this.emit('orderedPlatformAttackBuffered',a.id,{key:platformAttack.key,
        evidenceClass:'web-device-clock-adapter-target2016-callback-unavailable'});
      return;
    }

    if(STANDUP_INPUT_STATES.has(a.state)){
      const lostSupport=downSupportReaction(a.state,{grounded:a.grounded,lineRadius:this.profileFor(a).referenceSemantics.lineRadius});
      if(lostSupport){
        this.enter(a,lostSupport.state,'source-down-lost-support');
        a.y=Math.fround(Math.fround(a.y)+lostSupport.offsetY);
        return;
      }
      const fantasyInput=a.professionId==='LP'&&slotKeys.some((key,index)=>{
        if(!pressed.has(key))return false;const query=this.skillAvailability(a.id,index);
        return query.available&&query.mode==='fantasy-tracer';
      });
      if(!fantasyInput){
        if(elesisDownInput(this,a,keys))return;
        if(a.animationTime>REACTION_REFERENCE.downInputAfterAnimationSeconds){
          if(pressed.has('X')||held.has('X'))queueStandupAttack(a,'X');
          else if(pressed.has('Z'))queueStandupAttack(a,'Z');
          else if(direction)queueStandupRolling(a,direction,this.profileFor(a));
        }
        return;
      }
    }
    if(a.state===S.powerLand) {
      // Raven power landing permits a fresh horizontal press immediately, while
      // held movement/up/attack must wait until one sixth of the source period.
      if(direction && (pressed.has('LEFT')||pressed.has('RIGHT'))) {a.facing=direction;this.enter(a,S.walk,'power-land-fresh-direction');return;}
      if(a.animationTime <= this.profileFor(a).states[a.state].clip.durationSeconds/6)return;
    }
    if(direction && [S.wait,S.swordWait,S.walk,S.jumpUp,S.jumpDown,S.land].includes(a.state))a.facing=direction;
    if(!isAddActor(a)&&[S.jumpUp,S.jumpDown].includes(a.state)&&doubleDirection&&direction){a.facing=direction;this.enter(a,S.dashJump,'source-air-double');return;}
    const zBlocked=[S.wait,S.swordWait,S.walk,S.land,S.dashEnd].includes(a.state)&&a.reAttackZ1Right===(a.facing===1)&&a.reAttackZ1Time>0;
    if (free.has(a.state)&&!(a.canNotAttackTime>0)&&((pressed.has('Z')&&!zBlocked)||pressed.has('X'))) {
      const key = pressed.has('Z')&&!zBlocked ? 'Z' : 'X';
      const dashAttack=a.state===S.dash || a.state===S.dashEnd && a.animationTime <= this.profileFor(a).states[a.state].clip.durationSeconds/8;
      // JumpUp EventProcess6282..6304 has no IsOnSomethingFuture guard:
      // it requests the jump attack even when this Future packet has touched
      // the floor. JumpDown/DashJump own their earlier landing branches.
      const airCommand=[S.jumpReady,S.jumpUp,S.jumpDown,S.dashJump,'ANSI_AIR_DASH','ANSI_LEVITATION_WAIT'].includes(a.state);
      const role=!airCommand?(dashAttack?'dash':'ground')+key:[S.dashJump,'ANSI_AIR_DASH'].includes(a.state)?'dashJump'+key:'jump'+key;
      const state = this.profileFor(a).referenceSemantics.commandStates?.[role]??(!airCommand ? (dashAttack ? `RSI_DASH_COMBO_${key}` : `RSI_COMBO_${key}`)
        : a.state === S.dashJump ? (key === 'X' ? 'RRF_DASH_JUMP_COMBO_X' : 'RSI_DASH_JUMP_COMBO_Z') : `RSI_JUMP_COMBO_${key}`);
      const jumpReady=a.state===S.jumpReady;
      a.skillId = null; a.skillScale = 1; this.enter(a,state,'command-input',{commandInput:keys});
      if(jumpReady){a.grounded=false;a.lineId=null;a.vy=sourceScaledSpeed(this.profileFor(a).physics.JUMP_SPEED,a.stats.jumpSpeedMultiplier);a.y+=this.profileFor(a).referenceSemantics.lineRadius;}
      return;
    }
    const selectedSourceSlot=this.sourcePostContext?.actor===a?slotKeys.findIndex(key=>pressed.has(key)):null;
    for (const [i,k] of slotKeys.entries()) if (pressed.has(k)&&(selectedSourceSlot===null||i===selectedSourceSlot)) {
      // CommonEventProcess has an independent ASUT_ANYTIME entrance for
      // Endurance; preserve the already-reviewed original two skill IDs.
      if(elesisExternalSkillAllowed===false&&![28201,28218].includes(a.loadout[i]?.skillId))continue;
      // VC airborne callbacks give their combo/end branches priority over
      // the skill macro. Keep this same-packet ordering in the shared host.
      if(!eventContext?.sourceDispatch&&isVeteran(this,a)&&vcCommandSkillCancelAllowed(a,this.profileFor(a).states[a.state],keys)===false)continue;
      if(veteranAcceptsOverheatInput(this,a,k))continue;
      const availability=this.skillAvailability(a.id,i);
      if(!availability.available){this.emit('skillRejected',a.id,{...(availability.skillId==null?{slot:i}:{skillId:availability.skillId}),reason:availability.reason});continue;}
      if(availability.mode==='apocalypse-finish'){
        if(!finishAddApocalypse(this,a,'recast'))this.emit('skillRejected',a.id,{skillId:availability.skillId,reason:'add-summon-finish-unavailable'});
        return;
      }
      if(availability.mode==='maximum-strike-release'){
        if(!fireMaximumStrike(this,a))this.emit('skillRejected',a.id,{skillId:29022,reason:'maximum-strike-release-unavailable'});
        return;
      }
      const s=a.loadout[i],sk=this.skill(s.skillId,a);
      const {traitPolicy,mpCost,cooldown}=availability;
      const priorSkill={skillId:a.skillId,skillContext:a.skillContext,skillScale:a.skillScale};
      a.mp -= mpCost;
      a.skillId = sk.skillId;
      const table=this.profileFor(a).skillBranches?.powerRateTables?.[String(sk.raw.m_ePowerRate)]?.values;
      const levelPower=this.nativeSkillValues&&table?this.nativeSkillValues.powerRateValue(table,s.level):sk.levelPowerRate??1;
      a.skillScale = sk.powerMultiplier*levelPower*traitPolicy.damageMultiplier;
      a.skillContext={key:k,level:s.level,branchId:s.branchId,castStep:this.state.step,traitPolicy,hyperState:a.awakening.remaining>0};
      if(isAddActor(a)){
        const previousGeneratorMode=a.sourceAdd?.generator?.skillId??null;
        commitAddSkillResources(a,sk,availability.addResourcePlan,{profile:this.profileFor(a),emit:(...args)=>this.emit(...args)});
        if(availability.addResourcePlan.mode==='generator-switch')applyAddInstallationExtension2016(this,a,{oldMode:previousGeneratorMode,newMode:a.sourceAdd.generator?.skillId});
        if(availability.mode==='fantasy-tracer'&&!commitAddFantasyTracer(a,availability.addResourcePlan))throw new TypeError('Stale Fantasy Tracer plan');
        applyAddMindControlRefund(this,a,sk,availability.addResourcePlan,{changeDp:changeAddDp});
      }
      // Original+650 refunds ordinary costs before the cooldown setter and
      // the Time Control observer. Recasts retain their independent bypass.
      if(!availability.addResourcePlan?.ignoreCooldown)a.cooldowns[sk.skillId]=cooldown;
      if(isAddActor(a)&&!availability.addResourcePlan?.ignoreCooldown)applyAddCooldownProc(a,sk,{profile:this.profileFor(a),sample:addPassiveSample2016(this,a),gameMode:this.presetFor(a).gameMode,emit:(...args)=>this.emit(...args)});
      for(const reason of traitPolicy.unsupported)this.note('skill-trait-consumer:'+s.branchId+':'+reason,reason,a);
      if (this.hasNasod(a)&&a.awakening.remaining > 0 && [14,15,16].includes(sk.type)) {
        a.core.gauge = clamp(a.core.gauge + mpCost / this.profileFor(a).referenceSemantics.core.specialMpGainDivisor,0,100); this.updateCoreLevel(a);
      }
      bladeMasterCast(this,a,sk,mpCost);
      if(isAddActor(a)){
        const next=addCastState(this,a,sk,availability.addResourcePlan);
        if(next!==null)this.enter(a,next,'add-skill-input');
        else{a.skillId=priorSkill.skillId;a.skillContext=priorSkill.skillContext;a.skillScale=priorSkill.skillScale;}
      }else if(!elesisCast(this,a,sk,{mpCost,priorSkill})&&!elesisEnduranceCast(this,a,sk,{mpCost,priorSkill})&&!lordKnightCast(this,a,sk,{mpCost,priorSkill}))this.enter(a,isElesisProfession(a.professionId)?elesisCastState(this,a,sk):isBladeMaster(this,a)?bladeMasterCastState(this,a,sk):isVeteran(this,a)?veteranCastState(this,a,sk):lordKnightCastState(this,a,sk),'skill-input');
      if(this.sourcePostContext?.actor===a)this.sourcePostContext.skillDispatched=true;
      this.emit('skillStarted',a.id,{skillId:sk.skillId,level:s.level,branchId:s.branchId,mpCost,cooldown,traitPolicy}); return;
    }
    if(elesisExternalSkillAllowed!==false&&pressed.has('AWAKEN')&&!skillInputBlockReason(a)&&(skillMacroAwakeningAllowed(a,this.profileFor(a).states[a.state])||isElesisProfession(a.professionId)&&a.skillId&&afterCancel(a.animationTime,this.profileFor(a).states[a.state]?.raw.SKILL_CANCEL_AFTER))&&this.tryAwakening(a))return;
    if(a.state===S.jumpUp&&a.vy<=0){this.enter(a,S.jumpDown,'jump-apex');return;}
    if(a.state===S.jumpDown&&a.vy>=0){this.enter(a,S.jumpUp,'jump-rising');return;}
    if(a.state===S.jumpReady){if(direction)this.jump(a,false);return;}
    const chain = this.profileFor(a).referenceSemantics.comboBuffers[a.state];
    if (!this.commandsFor(a)?.handlesEvent(a) && chain) {
      for (const key of ['Z','X']) if (pressed.has(key)) {
        const window=chain.keyWindows?.[key]??chain;
        if(a.animationTime<(window.from??0)||(window.strictUntil?a.animationTime>=window.until:a.animationTime>window.until))continue;
        if (chain[key]) a.buffered = key;
        else this.note(`combo-branch:${a.state}:${key}`, 'This command branch requires native callback/target mapping still under research', a);
      }
    }
    if (!free.has(a.state)) {
      if(isElesisProfession(a.professionId)&&a.skillId)return;
      const raw = this.profileFor(a).states[a.state].raw;
      if(direction && direction!==a.facing)a.buffered=null;
      if(!(isElesisProfession(a.professionId)&&a.skillId)&&!this.commandsFor(a)?.handlesEvent(a)&&doubleDirection&&direction&&afterCancel(a.animationTime,raw.DASH_CANCEL_AFTER)) {
        a.facing=direction;this.enter(a,a.grounded?S.dash:S.dashJump,'dash-cancel');return;
      }
      if(a.state!=='RRF_COMBO_ZZZX'&&a.grounded&&a.animationTime>=(raw.UPDOWN_CANCEL_AFTER??Infinity)){
        // This target-2016 field is absent from the older C++ reader. Keep its
        // mapping explicit as a candidate; do not label the callback verified.
        if(held.has('UP')){
          this.note('updown-cancel-target-binding','2016 UPDOWN_CANCEL_AFTER field + user-reported ZZXX82 cancel; target native callback unverified',a);
          this.jump(a,false);return;
        }
        if(pressed.has('DOWN')){
          this.note('updown-cancel-target-binding','2016 UPDOWN_CANCEL_AFTER field + user-reported downward cancel; target native callback unverified',a);
          if(this.dropPlatform(a))return;
        }
      }
      if(this.profileFor(a).target.unitClass===107&&targetZzxBackwardCancel(a,keys,raw)){
        this.note('zzx-bwalk-cancel-target-binding','Target2016 ZZX BWALK_CANCEL_AFTER + unchanged fixed-V5 backward-cancel macro; matching target EventProcess/insertion order unavailable',a);
        this.enter(a,S.wait,'target-zzx-backward-cancel-candidate');return;
      }
      if([106,107,115].includes(this.profileFor(a).target.unitClass)&&targetZzzBackwardCancel(a,keys,raw)){
        this.note('zzz-bwalk-cancel-target-binding','Target2016 ZZZ BWALK_CANCEL_AFTER .45 + fixed-V5 backward-cancel macro; matching target EventProcess/insertion order unavailable',a);
        this.enter(a,S.wait,'target-zzz-backward-cancel-candidate');return;
      }
      if([106,107,115].includes(this.profileFor(a).target.unitClass)){
        const cancel=ravenCommandCancel(a,this.profileFor(a).states[a.state],keys);
        if(cancel?.state==='AWAKEN_REQUEST'){if(!skillInputBlockReason(a)&&this.tryAwakening(a))return;}
        else if(cancel?.state==='DASH_REQUEST'){if(!a.buffControls?.dashBlock){this.enter(a,S.dash,'target-raven-command-dash-cancel');return;}}
        else if(cancel){this.enter(a,cancel.state,'target-raven-command-walk-cancel');return;}
      }
      if(this.commandsFor(a)?.handlesEvent(a))return;
      const cancelAt=direction===a.facing?raw.WALK_CANCEL_AFTER:raw.BWALK_CANCEL_AFTER;
      // The skill WALK macro accepts either held direction and requests WAIT,
      // retaining facing. Free-state movement starts on the following packet.
      const skillWalk=!!a.skillId,walkReady=skillWalk?
        afterCancel(a.animationTime,raw.WALK_CANCEL_AFTER)||direction!==a.facing&&afterCancel(a.animationTime,raw.BWALK_CANCEL_AFTER):
        afterCancel(a.animationTime,cancelAt);
      // The original custom landing callback gives its X branch precedence over
      // held movement. Target2016's different window remains a candidate binding.
      const pendingLandingX=a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING'&&a.buffered==='X'&&
        chain&&a.animationTime<(chain.until??Infinity);
      // Roll landing's shared SwordMan callback owns both directions and its
      // strict boundary; the generic combo path must not preempt it only in
      // the current facing direction.
      const sourceRollLanding=isElswordProfile(this.profileFor(a))&&a.state==='ESSI_SI_A_ES_ROLLING_END';
      if (direction && a.grounded && !pendingLandingX && !sourceRollLanding && walkReady) {
        if(skillWalk)this.enter(a,S.wait,'target-skill-walk-cancel');
        else {a.facing = direction; this.enter(a,S.walk,'walk-cancel');}
      }
      return;
    }
    if(a.state===S.dashEnd&&doubleDirection){this.enter(a,S.dash,'dash-input');return;}
    if([S.wait,S.swordWait,S.walk,S.land,S.dashLand,S.powerLand].includes(a.state)&&doubleDirection&&direction){a.facing=direction;this.enter(a,a.grounded?S.dash:S.dashJump,'dash-input');return;}
    if([S.wait,S.swordWait,S.land].includes(a.state)&&direction){a.facing=direction;this.enter(a,S.walk,'source-held-direction');return;}
    if(a.state===S.walk&&!held.has('RIGHT')&&!held.has('LEFT')){this.enter(a,S.wait,'walk-release');return;}
    // Raven DashEnd's fresh same-facing oneRight/oneLeft branches precede its
    // pure-direction branch and do not require a nonzero net direction. Rapid
    // 6646 can overlap both held keys while the final fresh6 is still valid.
    if(a.state===S.dashEnd&&pressed.has(a.facing===1?'RIGHT':'LEFT')){
      if(!a.buffControls?.dashBlock)this.enter(a,S.dash,'source-fresh-facing-direction');
      else this.enter(a,S.walk,'source-dash-blocked-walk');
      return;
    }
    if(a.state===S.dashEnd&&(held.has('RIGHT')||held.has('LEFT'))){this.enter(a,S.walk,'source-held-direction');return;}
    if(a.state===S.dashLand&&direction){
      if(a.facing===direction&&pressed.has(direction===1?'RIGHT':'LEFT')){this.enter(a,S.dash,'source-fresh-facing-direction');return;}
      a.facing=direction;this.enter(a,S.walk,'source-held-direction');return;
    }
    // DashEnd differs from WAIT/LAND: oneDown precedes oneUp.
    if(a.state===S.dashEnd&&pressed.has('DOWN')&&this.dropPlatform(a))return;
    if(a.grounded&&a.state===S.powerLand&&direction){a.facing=direction;this.enter(a,S.dash,'power-land-held-direction');return;}
    if (a.grounded && (pressed.has('UP')||[S.wait,S.swordWait,S.walk,S.land,S.dashLand,S.powerLand].includes(a.state)&&held.has('UP'))) {
      if([S.dashEnd,S.dashLand,S.powerLand].includes(a.state))this.enter(a,S.jumpReady,'jump-input');
      else this.jump(a,a.state===S.dash);return;
    }
    if([S.wait,S.swordWait,S.walk,S.land,S.dash,S.dashEnd].includes(a.state)&&pressed.has('AWAKEN')&&this.tryAwakening(a))return;
    // Raven6435..6470 requests DashEnd without changing Future.bIsRight.
    // DashEnd has no directional FrameMoveFuture; its fresh same-facing
    // oneRight/oneLeft branch (6550..6558) must see that retained facing.
    if(a.state===S.dash&&(!direction||direction!==a.facing)){this.enter(a,S.dashEnd,'source-dash-release-or-turn');return;}
    if (a.grounded && pressed.has('DOWN')) {
      if(this.dropPlatform(a))return;
    }
    if(a.state===S.dashJump) {
      // Raven DashJump Event only requests JumpUp/Down; it does not write
      // Future.bIsRight. The next JumpFrameMoveFuture consumes the direction.
      if(direction&&direction!==a.facing){a.vy=Math.min(a.vy,sourceScaledSpeed(this.profileFor(a).physics.JUMP_SPEED,a.stats.jumpSpeedMultiplier));this.enter(a,a.vy>0?S.jumpUp:S.jumpDown,'air-turn');}
    }
    if (a.grounded && [S.wait,S.swordWait,S.walk,S.dash,S.dashEnd,S.land,S.dashLand].includes(a.state)) {
      if (direction) {
        if (a.state === S.dash && direction !== a.facing) { this.enter(a,S.dashEnd,'dash-turn'); }
        else { a.facing = direction; if (![S.walk,S.dash].includes(a.state)) this.enter(a,S.walk,'walk-input'); }
      } else if (a.state === S.dash) this.enter(a,S.dashEnd,'dash-release');
      else if (a.state === S.walk&&!held.has('RIGHT')&&!held.has('LEFT')) this.enter(a,S.wait,'walk-release');
    }
    } finally {
      // Raven.cpp:6710-6722: these are independent post-branch modifiers,
      // including when Z/X/turn/landing has already requested a new state.
      if(dashJumpEntry&&!isAddActor(a)){
        if(pressed.has('UP')&&a.vy<=0){a.jumpOnLanding=true;a.sourceCommandFlags|=1;}
        if(pressed.has('DOWN')){a.vy=this.profileFor(a).physics.MAX_G_SPEED;a.downForce=true;a.jumpOnLanding=false;a.sourceCommandFlags&=~1;
          this.emit('dashJumpForcedDown',a.id,{speedY:a.vy});}
      }
      if(isVeteran(this,a))vcCommandAirFollowupFuture(a,this.profileFor(a).states[a.state]);
    }
  }

  dropPlatform(a) {
    if(this.nativeGeometry){
      // Execute the original CanDown, including neighbor traversal, authored
      // Z depth, and the remembered line index. The Raven callback then lowers
      // the actor by 1.5*LINE_RADIUS; it does not teleport to the lower floor.
      const lower=this.nativeGeometry.down({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,
        lastLineId:a.lastTouchLineId,downRadius:true,onLine:a.grounded});
      if(!lower.found){this.emit('dropRejected',a.id,{lineId:a.lineId,reason:'original-CanDown-false'});return false;}
      a.landPosition=lower.point;a.lastTouchLineId=lower.lineId;
      const dash=a.state===S.dash;
      a.ignoreLineId=a.lineId;a.grounded=false;a.vy=0;a.y-=this.profileFor(a).referenceSemantics.lineRadius*1.5;
      this.enter(a,dash?S.dashJump:S.jumpDown,'platform-drop');return true;
    }
    const line=this.map.lines.find(l=>l.lineId===a.lineId);
    let canDown=line?.nativeFields?.CAN_DOWN ?? this.profileFor(a).referenceSemantics.lineCanDownDefault;
    const symbol=canDown?.symbol ?? canDown?.$symbol;
    if(symbol==='FALSE')canDown=false;if(symbol==='TRUE')canDown=true;
    if(canDown===false||canDown===0){this.emit('dropRejected',a.id,{lineId:a.lineId,reason:'source-CAN_DOWN-false'});return false;}
    if(canDown!==true&&canDown!==1){this.note('CAN_DOWN-unknown','Unresolved CAN_DOWN literal is not assumed true',a);return false;}
    // CanDown first casts down from pos.y-radius-1 and returns false when no
    // enabled unit-traversable lower line was hit (LineMap.cpp:1106-1348).
    const maxY=a.y-this.profileFor(a).referenceSemantics.lineRadius-1;
    const below=this.map.lines.filter(l=>l.lineId!==a.lineId&&withinLine(l,a.x)&&lineY(l,a.x)<=maxY&&
      lineY(l,a.x)>=0&&usableUnitLine(l)&&Math.abs(a.z-lineZ(l,a.x))<this.profileFor(a).referenceSemantics.lineRadius);
    if(!below.length){this.emit('dropRejected',a.id,{lineId:a.lineId,reason:'no-source-line-below'});return false;}
    const dash=a.state===S.dash;
    a.ignoreLineId=a.lineId;a.grounded=false;a.vy=0;a.y-=this.profileFor(a).referenceSemantics.lineRadius*1.5;
    this.enter(a,dash?S.dashJump:S.jumpDown,'platform-drop');return true;
  }

  jump(a,dash) {
    a.grounded = false; a.lineId = null;
    a.vy = sourceScaledSpeed(dash ? this.profileFor(a).physics.DASH_JUMP_SPEED : this.profileFor(a).physics.JUMP_SPEED,a.stats.jumpSpeedMultiplier);
    // Raven JUMP_READY / JUMP_LANDING add the original line radius;
    // the separate DASH jump callback does not apply this offset.
    if (!dash) a.y += this.profileFor(a).referenceSemantics.lineRadius;
    a.downForce=false;a.jumpOnLanding=false;
    this.enter(a,dash?S.dashJump:S.jumpUp,'takeoff'); this.emit('jump',a.id,{dash,verticalSpeed:a.vy});
  }
  endState(a, keys) {
    if(parryStates.has(a.state)){
      if(!a.grounded){a.y-=this.profileFor(a).referenceSemantics.lineRadius*1.5;this.enter(a,S.jumpDown,'source-parry-end-air');}
      else this.enter(a,S.wait,'source-parry-end');
    }
    else if (a.state === S.jumpReady) this.jump(a,false);
    else if (a.state === S.down || a.state==='RSI_DAMAGE_DOWN_BACK') this.enter(a,a.downSuccessor??(a.state.endsWith('_BACK')?'RSI_DAMAGE_STANDUP_BACK':S.stand),'down-animation-end');
    else if(a.state===S.airLand)this.enter(a,a.downSuccessor??S.stand,'air-down-landing-end');
    else if (damageAirStates.has(a.state)) return;
    else if(a.state===S.stand||a.state==='RSI_DAMAGE_STANDUP_BACK'){
      a.forceInvincible=REACTION_REFERENCE.standupInvincibleSeconds;
      a.showInvincible??=createInvulnerabilityDisplay();
      a.showInvincible.remaining=REACTION_REFERENCE.standupInvincibleSeconds;
      this.enter(a,S.wait,'standup-animation-end');
    }
    else if(STANDUP_ATTACK_STATES.has(a.state)){
      a.forceInvincible=REACTION_REFERENCE.standupInvincibleSeconds;
      a.showInvincible??=createInvulnerabilityDisplay();a.showInvincible.remaining=REACTION_REFERENCE.standupInvincibleSeconds;
      this.enter(a,S.wait,'standup-attack-animation-end');
    }
    else if (!a.grounded) this.enter(a,a.vy>0?S.jumpUp:S.jumpDown,'animation-end-air');
    else this.enter(a,keys.held.has('LEFT')||keys.held.has('RIGHT')?S.walk:S.wait,'animation-end');
  }

  integrate(a, dt, keys, def, before, {sourceFuture=false,sourceVerticalLaunch=false}={}) {
    let restoredVoidBinding=false;
    const vortex=runeSlayerVortex(this,a,dt);
    if(vortex)a.vx=vortex.vx;
    const direction = freeAirInputDirection(a.state,keys.held);
    const p = this.profileFor(a).physics;
    if (a.state === S.walk) {
      // Unchanged WalkFrameMoveFuture tests pureRight before pureLeft. A pair
      // of overlapping directional levels is not neutral in this consumer.
      const walkDirection=keys.held.has('RIGHT')?1:keys.held.has('LEFT')?-1:0;
      if(walkDirection)a.facing=walkDirection;
      a.vx=walkDirection*sourceScaledSpeed(p.WALK_SPEED,a.stats.moveSpeedMultiplier);
    }
    if (a.state === S.dash) a.vx = a.facing * sourceScaledSpeed(p.RUN_SPEED,a.stats.moveSpeedMultiplier);
    // Raven DashJump Future tests each pure key together with Now facing;
    // overlapping left/right still moves along that facing in this packet.
    if (a.state === S.dashJump && (keys.held.has('RIGHT')&&a.facing===1||keys.held.has('LEFT')&&a.facing===-1))
      a.vx = a.facing*sourceScaledSpeed(sourceScaledSpeed(p.RUN_SPEED,a.stats.moveSpeedMultiplier),this.profileFor(a).referenceSemantics.dashJumpHorizontalMultiplier);
    if(!sourceFuture&&['RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X'].includes(a.state)&&direction===a.facing)a.vx=a.facing*p.WALK_SPEED*a.stats.moveSpeedMultiplier;
    if(!sourceFuture&&a.state==='RRF_DASH_JUMP_COMBO_XX' && a.animationTime<=.54 && a.vy<0)a.vy=0;
    if ([S.jumpUp,S.jumpDown].includes(a.state) && direction) { a.vx = direction*sourceScaledSpeed(p.WALK_SPEED,a.stats.moveSpeedMultiplier); a.facing = direction; }
    // V5 PhysicProcess 19965..19979 decays active velocity before translation.
    a.vx = Math.sign(a.vx)*Math.max(0,Math.abs(a.vx)-p.RELOAD_ACCEL*dt);
    const oldX = a.x, oldY = a.y, oldZ=a.z, wasGrounded=a.grounded;
    translateAlongLine(a,this.map,a.vx*dt);
    const carrier=this.map.lines.find(l=>l.lineId===a.lineId);
    if(wasGrounded&&Number.isFinite(carrier?.nativeFields?.SPEED))
      translateAlongLine(a,this.map,carrier.nativeFields.SPEED*dt);
    // The explicit full-period BM recovery can cross D3DX's LOOP period in
    // its final packet. Hold the preceding root for that packet; EventProcess
    // still sees the completed clock and leaves the state immediately below.
    const completeBmOneShot=a.state==='RSI_RBM_COMBO_ZZZupZ'&&!a.animationLoop&&a.animationTime>def.clip.durationSeconds;
    const mixedRoot=completeBmOneShot?a.motionMoveNow:this.motionOffsetSampler?.(a);
    if(mixedRoot&&Number.isFinite(mixedRoot.x)&&Number.isFinite(mixedRoot.z)){
      const previous=a.motionMoveNow??{x:0,z:0};
      if(a.applyMotionOffset)translateMotionOffset(a,this.map,mixedRoot.x-previous.x,mixedRoot.z-previous.z);
      // JSON snapshots encode -0 as0; canonical root-cache zero preserves replay identity.
      a.motionMoveNow={x:mixedRoot.x||0,z:mixedRoot.z||0};
    } else if (a.applyMotionOffset && def.rootMotion) {
      const dur = def.clip?.durationSeconds ?? Infinity;
      const prev = sampleMotion(def,Math.min(before,dur)), next = sampleMotion(def,Math.min(a.animationTime,dur));
      translateMotionOffset(a,this.map,next[0]-prev[0],next[2]-prev[2]);
      if(a.presentationTransition?.enabled)this.note('mixed-root-sampler-missing','Native root offset uses mixed controller pose; unblended fallback is not fidelity verified',a);
    }
    // Grounded slope translation has a Y component before native push/pass;
    // ordinary airborne gravity displacement remains after that phase.
    const groundLine=a.grounded?this.map.lines.find(l=>l.lineId===a.lineId&&withinLine(l,a.x)):null;
    if(groundLine)a.y=lineY(groundLine,a.x);
    this.blockUnits(a,oldX,oldY,oldZ);
    const blackHole=consumeBlackHoleDisplacement(a,def.raw);
    if(this.dePredictionActive===a&&blackHole.apply)this.dePhysicalObjects.resetSupport(a);
    if(blackHole.apply){a.x=Math.fround(Math.fround(a.x)+blackHole.vector[0]);a.z=Math.fround(Math.fround(a.z)+blackHole.vector[2]);}
    // Consume an actual positive-Y SPEED_TIME launch in this physics packet
    // (GUUser20366–20384). A stale velocity in a grounded JumpReady must not
    // replace its still-supported post-physics EventProcess (Raven6248–6280).
    if(a.grounded&&sourceVerticalLaunch&&a.vy>0){a.grounded=false;a.lineId=null;}
    if (a.grounded) {
      // Original2016 31f70660 restores the final saved Buff position after
      // displacement and before the near-line/final position queries. The
      // airborne branch performs this same phase after its gravity step.
      restoreAddVoidBoundPosition(a);restoredVoidBinding=true;
      const current = this.map.lines.find(l => l.lineId === a.lineId);
      // Source endpoint -2 walls belong to this current line; never clamp to
      // a rectangular whole-map envelope, and -1 remains an open edge.
      if (!this.nativeGeometry&&current && !withinLine(current,a.x)) {
        const startOutside = current.start[0] <= current.end[0] ? a.x < current.start[0] : a.x > current.start[0];
        const endpoint = startOutside ? current.start : current.end;
        const boundary = startOutside ? current.beforeLine : current.nextLine;
        if (boundary === -2) { a.x=endpoint[0]; a.y=Math.max(a.y,endpoint[1]); a.z=endpoint[2]; this.emit('lineBoundaryBlocked',a.id,{lineId:current.lineId,endpoint:startOutside?'start':'end'}); }
      }
      let l,adjacent;
      if(this.nativeGeometry){
        const q=this.nativeGeometry.support({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId});
        if(q.found){l=this.map.lines.find(line=>line.lineId===q.lineId);[a.x,a.y,a.z]=q.point;a.landPosition=q.point;}
      }else{
        l=this.map.lines.find(line => line.lineId === a.lineId && withinLine(line,a.x));
        adjacent=this.map.lines.find(line => withinLine(line,a.x) && Math.abs(lineY(line,a.x)-a.y) < .01);
      }
      if (l || adjacent) { const line = l ?? adjacent; if(!this.nativeGeometry)a.y = lineY(line,a.x); a.lineId = line.lineId; a.lastTouchLineId=line.lineId; a.landPosition=[a.x,a.y,a.z]; }
      else { a.grounded = false; a.lineId = null; a.vy = Math.min(0,a.vy); }
      const touched=this.map.lines.find(line=>line.lineId===a.lineId);
      const launch=!a.pendingPlatformJump&&jumpPlatformRequest(a,touched);
      if(launch){a.pendingPlatformJump=launch;a.inputLock=touched.nativeFields.JUMP_REL_UP_KEYSTOP_TIME??0;
        if(a.mapMechanics)a.mapMechanics.lockRemaining=a.inputLock;this.emit('sound',a.id,{name:'HighJump.ogg',...sourceSoundEventMetadata(a)});}
    }
    if (!a.grounded) {
      const previousLine=this.map.lines.find(l=>l.lineId===a.lastTouchLineId);
      if (!this.nativeGeometry&&previousLine && !withinLine(previousLine,a.x)) {
        const startOutside=previousLine.start[0]<=previousLine.end[0]?a.x<previousLine.start[0]:a.x>previousLine.start[0];
        const endpoint=startOutside?previousLine.start:previousLine.end;
        if ((startOutside?previousLine.beforeLine:previousLine.nextLine)===-2) {
          a.x=endpoint[0];a.y=Math.max(a.y,endpoint[1]);a.z=endpoint[2];
          this.emit('lineBoundaryBlocked',a.id,{lineId:previousLine.lineId,endpoint:startOutside?'start':'end',airborne:true});
        }
      }
      const jumpAttackDown=!sourceFuture&&keys.held.has('DOWN')&&(a.state==='RSI_JUMP_COMBO_X'||a.state==='RSI_JUMP_COMBO_Z'&&!keys.held.has('UP'));
      if(jumpAttackDown)a.jumpAttackDown=true;
      const downG = a.state === S.dashJump ? p.G_ACCEL*this.profileFor(a).referenceSemantics.dashJumpAdditionalGravityMultiplier
        : jumpAttackDown||[S.jumpUp,S.jumpDown].includes(a.state)&&keys.held.has('DOWN')&&!keys.held.has('UP') ? p.G_ACCEL : 0;
      const gravityDisabled = a.skillDisableGravity || (def.raw.DISABLE_GRAVITY_TIME_END??0)>0 && a.animationTime >= def.raw.DISABLE_GRAVITY_TIME_START && a.animationTime < def.raw.DISABLE_GRAVITY_TIME_END;
      if (!gravityDisabled&&blackHole.pending&&def.raw.LAND_CONNECT!==0&&def.raw.LAND_CONNECT!==false) {
        // Source gravity phase precedes ResetOnSomethingFuture; its land-connect
        // flag is independent of the support reset. Do not invent a fall speed.
        a.vy=0;
      } else if (!gravityDisabled) {
        const maxG=def.raw.SET_LIMIT_MAX_G_SPEED ?? p.MAX_G_SPEED;
        a.vy = Math.max(maxG,a.vy-p.G_ACCEL*dt);
        a.vy = Math.max(maxG,a.vy-(a.skillDownAccel??downG)*dt);
      }
      if(a.vy>0&&this.nativeGeometry&&!this.nativeGeometry.canPassUp({position:[oldX,oldY,oldZ]})){
        a.vy=0;a.y=oldY;
      }else if(!blackHole.pending)a.y += a.vy*dt; // Native velocity precedes Euler displacement.
      if(blackHole.apply){
        a.y=Math.fround(Math.fround(a.y)+blackHole.vector[1]);
        const wall=correctBlackHoleWall(a,[oldX,oldY,oldZ],this.map,this.nativeGeometry);
        if(!wall.supported)this.note('black-hole-wall-consumer','Original CrossedWall requires native LineToLine; no guessed wall applied',a);
      }
      if(!restoredVoidBinding)restoreAddVoidBoundPosition(a);
      if(a.ignoreLineId!=null){const ignored=this.map.lines.find(l=>l.lineId===a.ignoreLineId);if(!ignored||a.y<lineY(ignored,a.x)-this.profileFor(a).referenceSemantics.lineRadius*1.5)a.ignoreLineId=null;}
      let support;
      if(this.nativeGeometry){
        const q=this.nativeGeometry.support({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId});
        if(q.found){
          a.landPosition=q.point;
          // User-confirmed Storm Blade sustains low launches between its
          // .15/.25s hits. Do not snap those victims down from LINE_RADIUS.
          if(!vortex||Math.abs(a.y-q.point[1])<vortex.footRadius)
            support={point:q.point,line:this.map.lines.find(l=>l.lineId===q.lineId)};
        }
        else{
          // GUUser.cpp:20541..20590 uses the remembered floor's distance to
          // its authored -2 endpoints. GetLandPosition runs before CanDown in
          // this branch, so an exclusive right endpoint cannot select a lower
          // platform and turn the wall into a hole.
          const line=this.map.lines.find(l=>l.lineId===a.lastTouchLineId),land=a.landPosition;
          // Validate the cache BEFORE advancing/correcting the position. Native
          // sources assume a valid prior frame; an externally depth-mutated
          // host snapshot must not acquire a floor from the endpoint fallback.
          const blockedEnd=validLandCache(line,land,oldX,oldZ,this.profileFor(a).referenceSemantics.lineRadius)&&
            (((line.beforeLine??line.nativeFields?.BEFORE_LINE)===-2&&Math.hypot(...land.map((n,i)=>n-line.start[i]))<this.profileFor(a).referenceSemantics.lineRadius)||
             ((line.nextLine??line.nativeFields?.NEXT_LINE)===-2&&Math.hypot(...land.map((n,i)=>n-line.end[i]))<this.profileFor(a).referenceSemantics.lineRadius));
          if(blockedEnd){
            a.y=Math.max(a.y,land[1]);
            const floor=this.nativeGeometry.land({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId});
            if(floor.found){a.x=floor.point[0];a.z=floor.point[2];a.landPosition=floor.point;a.lastTouchLineId=floor.lineId;}
          }else{
            // GUUser.cpp:20599: the no-touch query uses false downRadius and
            // onLine, preserving its 3D lower-line correction instead of a swept
            // 2D floor guessed by the JS adapter.
            const lower=this.nativeGeometry.down({position:[a.x,a.y,a.z],radius:this.profileFor(a).referenceSemantics.lineRadius,
              lastLineId:a.lastTouchLineId,downRadius:false,onLine:false});
            if(lower.found){
              a.x=lower.point[0];a.z=lower.point[2];a.y=Math.max(a.y,lower.point[1]);
              a.landPosition=lower.point;a.lastTouchLineId=lower.lineId;
              if(Math.abs(a.y-lower.point[1])<1&&a.vy<=0)support={point:lower.point,line:this.map.lines.find(l=>l.lineId===lower.lineId)};
            }else{
              a.x=oldX;a.z=oldZ;
              if(a.landPosition)a.y=Math.max(a.y,a.landPosition[1]);
            }
          }
        }
      }else support=nearestLineSupport(this.map.lines,[a.x,a.y,a.z],this.profileFor(a).referenceSemantics.lineRadius,a.lastTouchLineId);
      // IsOnLine is a half-open nearest-segment query, whereas the original
      // final bFootOnLine test also runs after CanDown/rollback correction.
      // At an exact segment end IsOnLine can be false while position is resting
      // on the remembered landPosition. GUUser.cpp:20742..20747 still considers
      // that grounded; omitting this left diagonal ZX permanently diving.
      if(!support&&this.nativeGeometry&&a.landPosition&&a.vy<=0&&Math.abs(a.y-a.landPosition[1])<1){
        const remembered=this.map.lines.find(l=>l.lineId===a.lastTouchLineId);
        // Native PhysicProcess derives this cache from a real enabled line.
        // Reject unvalidated spawn/depth-mutated host caches rather than let
        // their coincident Y create a floor absent from the authored 3D map.
        const validLand=validLandCache(remembered,a.landPosition,a.x,a.z,this.profileFor(a).referenceSemantics.lineRadius);
        if(validLand)support={point:[a.x,a.y,a.z],line:remembered,footOnly:true};
      }
      if(support&&!support.footOnly){a.x=support.point[0];a.z=support.point[2];a.lastTouchLineId=support.line.lineId;}
      // Preserve the earlier swept fallback for the non-native candidate path.
      // Moving lines and the remaining PhysicProcess branches are not ported.
      const candidates = support?[support.line]:this.nativeGeometry?[]:this.map.lines.filter(l => l.lineId !== a.ignoreLineId && usableUnitLine(l)&&withinLine(l,a.x) &&
        Math.abs(a.z-lineZ(l,a.x))<this.profileFor(a).referenceSemantics.lineRadius&&oldY >= lineY(l,oldX)-.001 && a.y <= lineY(l,a.x)+.001);
      if (a.vy <= 0 && candidates.length) {
        candidates.sort((l,r) => lineY(r,a.x)-lineY(l,a.x));
        const l = candidates[0]; a.y = this.nativeGeometry?support.point[1]:lineY(l,a.x); a.vy = 0; a.grounded = true; a.lineId = l.lineId; a.lastTouchLineId=l.lineId;delete a.skillDownAccel;
        if(!support?.footOnly)a.landPosition=[a.x,a.y,a.z];
        if(!wasGrounded)this.emit('landed',a.id,{lineId:l.lineId});
        const launch=!wasGrounded&&!a.pendingPlatformJump&&jumpPlatformRequest(a,l);
        if(launch){a.pendingPlatformJump=launch;a.inputLock=l.nativeFields.JUMP_REL_UP_KEYSTOP_TIME??0;
          if(a.mapMechanics)a.mapMechanics.lockRemaining=a.inputLock;this.emit('sound',a.id,{name:'HighJump.ogg',...sourceSoundEventMetadata(a)});}
        const fatal=deathState({hp:a.hp,grounded:true,fromFront:a.lastAttackerFront});
        const reactNext=airborneReactionNext(a.state,{grounded:true,vy:a.vy});
        if(fatal){if(!deathStates.has(a.state))this.enter(a,fatal,'fatal-landed');}
        else if(reactNext)this.enter(a,reactNext,'hit-ground');
        else if(this.commandsFor(a)?.handlesEvent(a)){/* Original EventProcess follows CommonFrameMoveFuture physics. */}
        else if(runeSlayerOwnsLanding(this,a)){/* Sword Fire waits for its original grounded LANDING successor. */}
        else if(a.state==='RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX')this.enter(a,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING','command-land');
        else if(a.state==='RSI_DASH_JUMP_COMBO_ZZ')this.enter(a,'RSI_DASH_JUMP_COMBO_ZZ_Landing','command-land');
        else if(a.state==='RRF_DASH_JUMP_COMBO_XX')this.enter(a,'RRF_DASH_JUMP_COMBO_XX_LANDING','command-land');
        else if(a.state==='RSI_DASH_JUMP_COMBO_Z')this.enter(a,S.dashLand,'command-land');
        else if (free.has(a.state)) {/* Free EventProcess owns landing priority after physics. */}
        else if (this.isAirState(a)) {
          if(['RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X'].includes(a.state)&&a.jumpAttackDown){
            a.canNotJumpTime=.2;this.emit('jumpOnlyLock',a.id,{duration:.2,evidence:'reference-v5 Raven.cpp:8996/9056 + User.cpp:28896'});
          }
          this.enter(a,S.land,'land');
        }
      }
      else {const next=airborneReactionNext(a.state,{grounded:false,vy:a.vy});if(next)this.enter(a,next,'air-reaction-apex');}
    }
    // A failed nearest query alone cannot request walk-off: native rollback
    // may still restore the feet to their remembered floor at a segment end.

    advanceMapMechanics(this,a,dt);
    if (this.map.bounds?.min && a.y < this.map.bounds.min[1] - 3000) this.note('fall-out-of-map', 'No substituted floor outside authored bungee lines', a);
  }

  blockUnits(a,oldX,oldY,oldZ) {
    // Target UNIT_WIDTH/HEIGHT and CAN_PASS/PUSH; V5 PhysicProcess +
    // ProcessCanPushUnit/CheckPassUnit reference, not render-mesh physics.
    const flag=(b,name,defaultValue)=>{
      if(name==='CAN_PASS_UNIT'&&b.sourceBlackHoleCanPass!=null)return b.sourceBlackHoleCanPass;
      const raw=this.profileFor(b).states[b.state].raw;let value=raw[name]??defaultValue;
      for(const v of windows(raw,name+'_TIME'))if(b.animationTime>=v['1'])value=v['2'];
      return value===1||value===true;
    };
    if(flag(a,'CAN_PASS_UNIT',0))return;
    const beforePush=[a.x,a.y,a.z];
    const h=this.profileFor(a).body.UNIT_HEIGHT,w=this.profileFor(a).body.UNIT_WIDTH;
    for(const target of this.state.actors){
      const b=this.contactActor(target,a);
      if(a.id===b.id||a.team===b.team||b.deathComplete||flag(b,'CAN_PASS_UNIT',0))continue;
      if(this.dePredictionActive===a)this.dePhysicalObjects.collider(target,{position:[b.x,b.y,b.z],width:this.profileFor(b).body.UNIT_WIDTH,height:this.profileFor(b).body.UNIT_HEIGHT});
      // CAN_PUSH=false skips push displacement, but NOT CheckPassUnit, which
      // still forbids a full crossing (GUUser.cpp:20263-20338).
      const canPush=flag(a,'CAN_PUSH_UNIT',1)||!flag(b,'CAN_PUSH_UNIT',1);
      if(canPush){
        const pushed=nativeBodyPushCandidate({position:[oldX,oldY,oldZ],height:h,width:w},{position:[b.x,b.y,b.z],height:this.profileFor(b).body.UNIT_HEIGHT,width:this.profileFor(b).body.UNIT_WIDTH},
          {position:[a.x,a.y,a.z],direction:[a.facing,0,0]});
        [a.x,a.y,a.z]=pushed;
      }
      const passBlocked=nativeBodyPassBlocked({position:[oldX,oldY,oldZ],height:h},{position:[b.x,b.y,b.z],height:this.profileFor(b).body.UNIT_HEIGHT},
        {position:[a.x,a.y,a.z],backupPosition:b!==target?[b.x,b.y,b.z]:[b.stepPositionBackup?.x??b.x,b.stepPositionBackup?.y??b.y,b.stepPositionBackup?.z??b.z]});
      if(passBlocked){a.x=oldX;a.y=oldY;a.z=oldZ;a.vx=0;}
    }
    blockAddPrismUnits(this,a,[oldX,oldY,oldZ],{canPush:flag(a,'CAN_PUSH_UNIT',1)});
    if(a.grounded&&beforePush.some((n,i)=>n!==[a.x,a.y,a.z][i])){
      const supported=groundedBodyPushPoint(a,this.map);
      if(supported)[a.x,a.y,a.z]=supported;
    }
  }

  hitPoint(attack,defender){
    return this.nativeGeometry?this.nativeGeometry.collisionPoint(attack,defender):collisionPoint(attack,defender);
  }

  checkCharacterAttack(a, before, after) {
    const raw = this.profileFor(a).states[a.state].raw;
    lordKnightCharacterAttackTimers(this,a,before,after);
    elesisAttackTimers(this,a,before,after);
    infinitySwordAttackTimers(this,a,before,after);
    // Raven:8676-8720 reinitializes 66X's DamageData at the authored timer,
    // including hitUnitList. This runs in the gap between its two attack
    // windows as well. A generic data change is not evidence of this reset.
    if(this.hasNasod(a)&&a.state==='RSI_DASH_COMBO_X'&&raw.DAMAGEDATA_CHANGE_TIME!=null)
      this.fire(a,'dash-x-damage-data-next',raw.DAMAGEDATA_CHANGE_TIME,before,after,()=>{
        a.hits={};
        this.emit('characterDamageDataChanged',a.id,{state:a.state,dataStage:1,
          animationTime:after,eventTime:raw.DAMAGEDATA_CHANGE_TIME,clearHitUnits:true,
          evidence:'target2016 timer + reference-V5 Raven.cpp:8676-8720 SimpleInit/SetDamageData; target runtime pending'});
      });
    // CommonFrameMove:18156 tests the current posed animation time strictly
    // inside both bounds. Crossing an entire window does not authorize a hit
    // using bones sampled outside that window.
    const active = windows(raw,'ATTACK_TIME').some(w => after > w['1'] && after < w['2']);
    if (!active) return;
    const drill=a.state==='RSI_A_RF_MEGADRILL_BREAK'&&a.sourceMegaDrillNowSupported?a.sourceMegaDrill:null;
    const next=drill?drill.damageStage===1:raw.DAMAGEDATA_CHANGE_TIME != null && after >= raw.DAMAGEDATA_CHANGE_TIME;
    let data=next?raw.DAMAGE_DATA_NEXT:raw.DAMAGE_DATA;
    if (!data) { if(a.state!=='ESSI_SI_A_MEGASLASH_MEMO_FIRE')this.note(`damage:${a.state}`, 'No confirmed damage data for attack window',a); return; }
    rememberAddMoonlightOrigins(this,a);
    data=lordKnightCharacterDamage(this,a,data);
    data=infinitySwordDamageData(this,a,data);
    data=elesisDamageData(this,a,data);
    let attackRaw=raw;
    if(isInfinitySword(this,a))attackRaw={...raw,ENABLE_ATTACK_BOX:{...raw.ENABLE_ATTACK_BOX,...data.ENABLE_ATTACKBOX},
      DISABLE_ATTACK_BOX:{...raw.DISABLE_ATTACK_BOX,...data.DISABLE_ATTACKBOX}};
    if(drill){
      data={...data,RE_ATTACK:drill.reAttack?1:0,HIT_GAP:drill.hitGap,BACK_SPEED_X:drill.backSpeedX};
      const disabled=new Set(array(raw.DISABLE_ATTACK_BOX).map(name=>String(name).toLowerCase()));
      for(const [name,enabled] of [['Lhand1',drill.lhandEnabled],['Sword',drill.swordEnabled]]){
        if(enabled)disabled.delete(name.toLowerCase());else disabled.add(name.toLowerCase());
      }
      attackRaw={...raw,DISABLE_ATTACK_BOX:Object.fromEntries([...disabled].map((name,i)=>[String(i+1),name]))};
    }
    this.emit('attackWindow',a.id,{state:a.state,animationTime:after,dataStage:lordKnightCharacterAttackStage(this.profileFor(a),a)|| (next?1:0)});
    const traitPolicy=appliedSkillTraitPolicy(a,this.profileFor(a),data,a.skillContext?.traitPolicy);
    data=skillTraitDamageData(data,traitPolicy);
    const primaryShapes=this.collisionSampler?.(a,{profile:this.profileFor(a),raw:attackRaw,stateTime:a.stateTime,animationTime:after}) ?? [];
    // Target USE_SUB_ATTACK_LIST_SET registers the attached Armageddon mesh's
    // actual helper lines. Its lifetime is the live buff display effect.
    // The first cast hit precedes the global effect activation phase. Include
    // its already-due sword helpers in this same packet, using the same hand
    // matrix that the subsequent effectStarted presentation will receive.
    for(const effect of this.state.effects)if(effect.ownerId===a.id&&!effect.dead&&
      (effect.active||lordKnightPendingCastSword(this,a,effect))&&effect.definition.USE_SUB_ATTACK_LIST_SET===1&&
      !(isInfinitySword(this,a)&&effect.name==='SecondBlade'&&array(data.DISABLE_ATTACKBOX).some(n=>String(n).toLowerCase()==='sissword')))
      primaryShapes.push(...(this.effectSampler?.(effect,a,{profile:this.profileFor(a),time:effect.animationTime})??[]));
    const shapes = scaleSkillAttackShapes(primaryShapes,[a.x,a.y,a.z],traitPolicy);
    const origin={kind:'character',id:`state-${a.stateSerial}`,state:a.state,animationTime:after,skillId:a.skillId,powerMultiplier:appliedSkillTraitPower(a.skillScale,a.skillContext?.traitPolicy,traitPolicy),traitPolicy};
    if(shapes.length)this.checkHits(a,shapes,data,a.hits,origin);
    // DamageCheck:644 performs GroundHit AFTER UnitToUnit. Both routes own
    // the same hitUnitList, so a nearby body hit is never applied twice.
    this.checkGroundHits(a,data,a.hits,origin);
  }
  stopSkillEffectGroup(a,key,reason){
    for(const prior of a[key]??[]){
      const e=this.state.effects.find(e=>e.id===prior.id);if(e){e.dead=true;e.endEmitted=true;}
      this.emit('effectEnded',a.id,{effectId:prior.id,name:prior.name,setName:prior.setName,reason});
    }
    delete a[key];
  }
  advanceSkillCandidates(a,input,dt){
    const shadow=shadowStepCandidateFrame(a,this.skillsFor(a),{profile:this.profileFor(a),dt});
    if(shadow)this.executeSkillCommands(a,shadow);
    if(a.skillId===900&&a.state==='RSI_THROW_ITEM'){
      this.fire(a,'relationship-throw',.8,a.animationBeforeTime??0,a.animationTime,()=>{
        const name=this.skill(900,a).maxLevel===2?'RELATIONSHIP_SKILL_THROW_LV2':'RELATIONSHIP_SKILL_THROW_LV1';
        const position=[a.x+40*a.facing,a.y+130,a.z];
        const e=this.createEffect(a,{NAME:name},{birthAnchor:{position,facing:a.facing,rotation:[0,a.facing<0?180:0,0],
          evidence:'fixed-V5 Raven throwTime .8/offset40,130 + COMMON_RELATIONSHIP_SKILL_FrameMove; target-client pending'}});
        this.emit('originalSkillCommand',a.id,{name,commandType:'damage',effectId:e.id,position,threshold:.8});
      });
    }
    if(this.skillsFor(a)&&(a.state==='RSI_SI2_OVER_TAKER_ARC_ENEMY'||a.sourceArcEnemy?.data.length)){
      if(a.hp<=0){
        // Raven.cpp6036/6080: death Start clears only the owned spears.
        for(const owned of a.sourceArcEnemy?.data??[]){const e=this.state.effects.find(e=>e.id===a.sourceArcEnemy.effectIds[owned.handle]);
          if(e){e.dead=true;e.endReason='original-arc-owner-death';}}
        if(a.sourceArcEnemy){const handles=new Set(a.sourceArcEnemy.data.map(x=>x.handle));a.sourceArcEnemy.data=[];
          for(const e of a.sourceArcEnemy.effects)if(handles.has(e.handle))e.alive=false;}
        return;
      }
      // Registered skill mode is frozen at cast. The fixed reference registers
      // distinct normal/HYPER Now callbacks; remaining aura seconds do not
      // choose a different spear midway through this cast.
      const kind=a.state==='RSI_SI2_OVER_TAKER_ARC_ENEMY'?(a.skillContext?.hyperState===true?70:25):26;
      const spawning=(kind===25||kind===70)&&(a.animationBeforeTime??0)<1.5&&a.animationTime>=1.5&&(a.animationOneshotTimer??0)<1.5;
      const result=this.skillsFor(a).evaluate(arcNativeInput(a,this.state.effects,{kind,dt,
        basis:arcLineBasis(a,this.map.lines),
        randValues:spawning?Array.from({length:4},()=>Math.floor(this.rng()*32768)):[0,0,0,0]}));
      this.executeArcCommands(a,result);
    }
  }
  executeSkillCommands(a,result){
    for(const command of result.commands??[]){
      if(command.type==='effectSet'){
        const first=this.state.nextEffectId;this.spawnSet(a,command.name,undefined,[],command.hyperMode??false);
        const group=this.state.effects.filter(e=>e.id>=first);
        for(const e of group)e.powerMultiplier=command.power??a.skillScale;
        if(command.name==='EffectSet_RF_WILD_CHARGE_CHARGING')
          a.sourceWildChargeEffectGroup=group.map(e=>({id:e.id,name:e.name,setName:e.setName}));
        const {type:commandType,...payload}=command;
        this.emit('originalSkillCommand',a.id,{...payload,commandType});continue;
      }
      const effect=this.createEffect(a,{NAME:command.name},{clock:'custom',birthAnchor:{position:command.position,
        facing:command.rotation?.[1]===180?-1:1,rotation:command.rotation,
        evidence:'unchanged fixed-V5 skill callback command; target-client validation pending'}});
      effect.powerMultiplier=command.power??a.skillScale;
      const {type:commandType,...payload}=command;
      this.emit('originalSkillCommand',a.id,{...payload,commandType,effectId:effect.id});
    }
  }
  executeArcCommands(a,result){
    const ids={...(a.sourceArcEnemy?.effectIds??{})};
    for(const command of result.commands){
      if(command.type==='mesh'){
        const template=this.profileFor(a).effectTemplates[command.name];
        if(!template){this.note('arc-start-template:'+command.name,'Original Archenemy Start animation resource missing',a);continue;}
        const e=this.createEffect(a,{NAME:command.name},{birthAnchor:{position:[...command.position],facing:a.facing,rotation:[...command.rotation],
          evidence:'fixed-V5 Archenemy Start GetPos + target2016 original-DLL Normal keys; target client timing unmeasured'}});
        initializeArcStartMesh(e,template);
        const {type:commandType,...payload}=command;
        this.emit('originalSkillCommand',a.id,{...payload,commandType,effectId:e.id});continue;
      }
      if(command.type==='destroyDamageEffect'){
        const e=this.state.effects.find(e=>e.id===ids[command.handle]);if(e){e.dead=true;e.endReason='original-arc-clear';}continue;
      }
      let e=this.state.effects.find(e=>e.id===ids[command.handle]);
      if(command.type==='damage'){
        const originalTrait=clone(e?.traitPolicy??(a.skillId===24008?a.skillContext?.traitPolicy:null)??null);
        e=this.createEffect(a,{NAME:command.name},{birthAnchor:{position:command.position,facing:a.facing,rotation:command.rotation,
          evidence:'compiled original Archenemy Now/follow/hit callbacks; target UID/mesh host candidate'}});
        e.skillId=24008;e.traitPolicy=originalTrait;
        e.powerMultiplier=command.power;e.animationTime=command.animationResetTime;
        e.sourceArcPreviousMeshPosition=[...command.position];
        ids[command.handle]=e.id;
      }
      if(!e)continue;
      e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position:[...command.position],rotation:[...command.rotation]};
      [e.x,e.y,e.z]=command.position;
      e.damage.ATTACK_TIME_START=command.attackTime[0];e.damage.ATTACK_TIME_END=command.attackTime[1];
      e.initialDirSpeed=command.dirSpeed;e.lifeTimeSeconds=command.maxLifeTime;e.meshLifetimeElapsed=command.nowLifeTime;
      e.sourceArcHandle=command.handle;e.sourceArcLockOnUnitUID=command.lockOnUnitUID;
      e.sourceMeshLandY=command.landY;
      this.emit('originalSkillEffectUpdate',a.id,{effectId:e.id,position:command.position,rotation:command.rotation,
        dirSpeed:command.dirSpeed,attackTime:command.attackTime,lockOnUnitUID:command.lockOnUnitUID});
    }
    a.sourceArcEnemy={...clone(result.arcEnemy),effectIds:ids};
    if(result.sounds)this.emit('sound',a.id,{name:'Raven_OT_SP2_FlyingImpact3.ogg',field:'original-arc-release',...sourceSoundEventMetadata(a)});
  }
  acceptedSkillHit(a,b,data,origin){
    const summonEffect=origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id&&e.sourceAddSummonSerial!==undefined):null;
    if(summonEffect){summonEffect.lastImpactPoint=origin.impactPoint;this.createSecondaryDamage(summonEffect,a,'HIT_DAMAGE_EFFECT');return;}
    runeSlayerAcceptedHit(this,a,b,data,origin);
    const policy=origin.traitPolicy;
    if(policy?.targetMpBurn){const before=b.mp;b.mp=clamp(b.mp-policy.targetMpBurn,0,b.mpMax);
      this.emit('traitMpBurn',a.id,{targetId:b.id,before,after:b.mp,branchId:policy.branchId});}
    const e=origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null;
    if(e){e.lastImpactPoint=origin.impactPoint;this.createSecondaryDamage(e,a,'HIT_DAMAGE_EFFECT');}
    // In playback, the attacker owns Archenemy's release decision. The local
    // victim still settles this hit, but releasing a second spear here races
    // the already received owner transition and corrupts the held set.
    if(this.networkCombatPlaybackVersion===1&&this.networkOwnerId!==null&&a.id!==this.networkOwnerId)return;
    if(!this.skillsFor(a)||!a.sourceArcEnemy?.data.length||e?.sourceArcHandle||!canTriggerArchenemy(data,origin,e))return;
    // Preserve the unit/effect AttackResult entry route before evaluating
    // Raven's release callback; an ordinary damage category alone is insufficient.
    // The target 2016 special-active/hyper exclusions remain a separate gate.
    const skill=this.skill(origin.skillId,a),type=skill?.type;
    if([13,14,15,16].includes(type))return;
    const uid=this.state.actors.findIndex(x=>x.id===b.id)+1;
    const result=this.skillsFor(a).evaluate(arcNativeInput(a,this.state.effects,{kind:27,dt:0,defender:b,defenderUID:uid,basis:arcLineBasis(a,this.map.lines)}));
    this.executeArcCommands(a,result);
  }
  tickEffects(dt,selectedEffects=null) {
    tickElesisShadowLinks(this,dt);
    for(const effect of this.state.effects)if(!effect.dead)retireReflectedSource(this,effect);
    retireReflectionReceipts(this);
    // A child created by this update starts with global time zero; it must not
    // inherit another full dt merely because push() extends this JS iteration.
    // Historical collision can select remote records without hiding the live
    // local scene from received-hit and StateEnd cleanup hooks.
    const effectsToTick=[...(selectedEffects??this.state.effects)];
    // Original EffectSet owns its designated mesh before resolving sibling
    // bones. RS declares that invisible carrier after the damage entry; make
    // the non-damaging handle available before emitting any bound birth.
    for(const carrier of [...effectsToTick])if(carrier.sourceBoneEffectSetId===carrier.id){
      const at=effectsToTick.indexOf(carrier),first=effectsToTick.findIndex(e=>e.sourceBoneTargetMeshId===carrier.id);
      if(first>=0&&first<at){effectsToTick.splice(at,1);effectsToTick.splice(first,0,carrier);}
    }
    for (const e of effectsToTick) {
      const a = this.actor(e.ownerId);
      if ((a.hp<=0 || a.pvpDead || a.pvpDisconnected) &&
        (isManagedContinuousAura(e,a) || this.continuousAuraVersion>0 && isContinuousRavenAura(e,this.profileFor(a),this.continuousAuraVersion))) {
        e.dead=true;e.endReason='continuous-aura-owner-ended';continue;
      }
      const bornNow=!e.active;
      if(e.dead)continue;
      if(e.sourceAddSummonSerial!==undefined&&e.parentEffectId==null)updateAddSummonEffectAnchor(this,e,a);
      if(e.sourceFollowLine?.followEndPending){e.dead=true;e.endReason='follow-line-end';continue;}
      if(e.traceActorId&&e.traceUnitDieDelete&&this.actor(e.traceActorId)?.hp<=0){e.dead=true;e.endReason='trace-unit-death';continue;}
      const boneTargets=[122,123,126].includes(this.profileFor(a).target.unitClass)?{...ADD_COMMON_BONE_TARGETS,...(this.profileFor(a).target.unitClass===122?ADD_BONE_TARGETS:this.profileFor(a).target.unitClass===123?ADD_ANALYSIS_BONE_TARGETS:{})}:isElesisProfession(a.professionId)?ELESIS_BONE_TARGETS:null;
      if(boneTargets&&Object.hasOwn(boneTargets,e.setName)&&hasSetMeshBoneTarget(e)&&
        !this.state.effects.some(target=>target.id===e.sourceBoneTargetMeshId&&!target.dead)){
        e.dead=true;e.endReason=isElesisProfession(a.professionId)?'elesis-effect-set-carrier-ended':'add-effect-set-carrier-ended';continue;
      }
      if (e.sourceAddSummonSerial===undefined&&e.deleteOnStateEnd && e.ownerStateSerial !== a.stateSerial) { e.dead = true;e.endReason='delete-state-end'; continue; }
      if (e.sourceAddSummonSerial===undefined&&e.deleteConditions.includes(3) && a.hp<=0) { e.dead = true;e.endReason='delete-owner-died'; continue; }
      if (e.sourceAddSummonSerial===undefined&&e.deleteConditions.includes(5) && e.skillId && a.skillId !== e.skillId) { e.dead = true;e.endReason='delete-skill-end'; continue; }
      e.setElapsed += dt;
      if(addPrismSetExpired(this,a,e)){e.dead=true;e.endReason='original-prism-endpoint-lifetime';continue;}
      const setClock = e.clock === 'custom' ? e.setElapsed : a.animationTime-e.setStartAnimation;
      // Target XXX uses a candidate owner epoch, but never obtains a free
      // blast while its separately documented reference MP gate is unresolved.
      if(e.xxxCandidatePendingPayment)continue;
      if (!e.active && setClock >= e.start) {
        // A sibling's START_TIME may precede its designated target mesh.
        // Keep that sibling pending until the exact target supplies a real
        // bone frame; an active effect with a null anchor has no valid birth
        // for either local presentation or the strict owner wire contract.
        // This Web scheduling guard never substitutes the caster's position.
        const sourceBoneBirth=hasSetMeshBoneTarget(e)?e.birthAnchor??sampleSetMeshBoneAnchor(e,this.state.effects,a,this.effectBoneSampler,this.effectBoneMatrixSampler):null;
        if(hasSetMeshBoneTarget(e)&&!sourceBoneBirth?.position){
          const target=this.state.effects.find(t=>t.id===e.sourceBoneTargetMeshId&&t.ownerId===e.ownerId&&
            t.setName===e.setName&&t.sourceBoneEffectSetId===e.sourceBoneEffectSetId&&!t.dead);
          if(target&&!target.active){
            // Pure particles have no mesh/event producer to run without the
            // binding. Preserve their already-started game-frame age rather
            // than resetting the original schedule at the target's birth.
            if(!e.damage&&e.mainEffectName===null&&e.definition.EFFECT_TYPE===8){e.elapsed+=dt;e.animationTime+=dt;}
            else this.note('pending-effect-bone-clock:'+e.setName+':'+e.name,'Unresolved pending target mesh producer; no guessed pre-birth events',a);
            continue;
          }
          this.note('effect-bone-birth:'+e.setName+':'+e.name,'Original target mesh bone birth anchor required',a);
          e.dead=true;e.endReason='missing-original-effect-bone-anchor';continue;
        }
        e.active = true;
        // Native CEffect:1288 captures owner direction when its mesh is born,
        // after EffectSet START_TIME; queueing this delayed definition is earlier.
        if(e.damage)e.damageDirectionRight=(e.sourceAddSummonSerial!==undefined?e.facing??e.birthAnchor?.facing:a.facing)===1;
        // DamageManager427 calls SetDamageExceptionProcess when DAMAGE_DATA
        // is loaded. Retain the owner's conversion flag at this birth, not at
        // an eventual collision after the owner has entered another action.
        e.passiveDamageState={BURNING_NASOD_HAND_POSSIBLE:this.profileFor(a).states[a.state]?.raw.BURNING_NASOD_HAND_POSSIBLE??false};
        e.birthActorPose = Object.fromEntries(['x','y','z','facing','state','stateSerial','animationName','animationTime','animationLoop','applyMotionOffset'].map(k=>[k,a[k]]));
        if(hasSetTarget(e)&&!e.birthAnchor&&!this.state.effects.some(t=>t.id===e.sourceTargetMeshId&&t.ownerId===e.ownerId&&t.sourceEffectSetId===e.sourceEffectSetId&&!t.dead)){
          e.dead=true;e.endReason='missing-effect-set-target';continue;
        }
        // EFFECT0/1 precede the target EFFECT2. Their initial source position
        // is still the owner; the first EffectSet update then traces the mesh.
        // This initial-only route is guarded by the live/pending target above.
        e.birthAnchor ??= hasSetMeshBoneTarget(e)?clone(sourceBoneBirth):
          updateVeteranTarget(this,e,a)??windSlicerBirthAnchor(e,this.state.effects)??(this.effectAnchorSampler ? clone(this.effectAnchorSampler(hasSetTarget(e)?{definition:e.definition}:e,a,{profile:this.profileFor(a)})) : null);
        if(hasSetMeshBoneTarget(e))e.currentAnchor=clone(e.birthAnchor);
        if (e.birthAnchor?.position) [e.x,e.y,e.z] = e.birthAnchor.position;
        if(e.sourceSetTargetMesh)initializeWindCarrier(e);
        if(hasSetTarget(e)){e.currentAnchor=clone(e.birthAnchor);if(e.damage){
          e.elapsed=e.animationTime=e.meshLifetimeElapsed=Math.fround(.0001);
          e.sourcePosedAnchor=clone(e.birthAnchor);
          e.sourcePosedAnchor.position[0]+=e.initialVelocity[0]*.0001*e.birthAnchor.facing;
        }}
        if(usesSourceTracePosition(e))e.sourcePosedAnchor=clone(e.birthAnchor);
        if(e.sourceShadowMeshPending&&!e.birthAnchor?.position){
          this.note('literal-mesh-anchor:'+e.mainEffectName,'Original bone birth anchor required',a);
          e.dead=true;e.endReason='missing-original-mesh-anchor';continue;
        }
        if(e.sourceShadowMeshPending){
          initializeAddStardustMesh(e,this.effectProfileFor(e),()=>this.rng());
          const motionTemplate=resolvedAddStardustTemplate(this.effectProfileFor(e).effectTemplates[e.mainEffectName],e)??this.effectProfileFor(e).effectTemplates[e.mainEffectName];
          e.sourceShadowMesh=(e.sourceLiteralMotion?createLiteralMesh:createShadowMesh)({name:e.mainEffectName,position:e.birthAnchor?.position,
            velocity:e.initialVelocity,landY:e.sourceMeshInheritedLandY??a.landPosition?.[1],
            fields:e.templateFields,events:addLiteralMotionEvents(this.effectProfileFor(e),e,motionTemplate?.events??[]),
            facing:e.birthAnchor?.facing??a.facing,rotation:e.birthAnchor?.rotation,
            motionRotation:elesisLiteralMotionRotation(this.effectProfileFor(e),e)??addLiteralMotionRotation(this.effectProfileFor(e),e)});
          if(Number.isFinite(e.lifeTimeSeconds))e.sourceShadowMesh.maxLifeTime=Math.fround(e.lifeTimeSeconds);
          if(e.sourceDirSpeedSign===-1)e.sourceShadowMesh.dirSpeed=Math.fround(-e.sourceShadowMesh.dirSpeed);
          if(e.sourceAddMarkedDrone&&!e.sourceAddFissionSplit)e.sourceShadowMesh.dirSpeed=1250;
          initializeAddMarkedDroneMesh(e);
          if(e.damage?.FOLLOW_LINE===1)e.sourceShadowMesh.followFacing=a.facing;
          e.sourceShadowMesh.landPosition=e.templateFields.SetLandHeightOnStart===true?[...a.landPosition]:[0,0,0];
          const follow=followLiteralMeshLine(e.sourceShadowMesh,addMarkedDroneMotionData(e),this.nativeGeometry,this.map.lines,{initial:true});
          if(!follow.supported)this.note('literal-follow-line:'+e.mainEffectName,follow.reason,a);
          e.sourceMeshLandY=e.sourceDamageLandY=e.sourceShadowMesh.landY;
          e.sourceDamageAnchor=clone(e.birthAnchor);e.sourceShadowMeshPending=false;
        }
        if(!e.sourceShadowMesh&&e.damage?.FOLLOW_LINE===1&&e.birthAnchor){
          e.sourceFollowLine={position:[...e.birthAnchor.position],facing:a.facing,elasticX:e.templateFields.ElasticCoeff_X??0,
            velocity:[...e.initialVelocity],dirSpeed:e.initialDirSpeed};
          const follow=followLiteralMeshLine(e.sourceFollowLine,e.damage,this.nativeGeometry,this.map.lines,{initial:true});
          if(!follow.supported)this.note('effect-follow-line:'+e.mainEffectName,follow.reason,a);
          e.currentAnchor={...e.birthAnchor,position:[...e.sourceFollowLine.position],rotation:e.sourceFollowLine.rotation??e.birthAnchor.rotation};
        }
        this.emit('effectStarted',a.id,{effectId:e.id,name:e.name,setName:e.setName,skillId:e.skillId,definition:e.definition,birthAnchor:clone(e.birthAnchor),ownerStateSerial:e.ownerStateSerial,deleteConditions:e.deleteConditions,
          sourceShadowMesh:!!e.sourceShadowMesh,sourceArcMesh:!!e.sourceArcHandle,sourceArcStartMesh:!!e.sourceArcStartMesh,sourceXCrashMeshClock:!!e.sourceXCrashMeshClock,sourcePhantomSword:!!e.sourcePhantomSword,sourceISSheath:!!e.sourceISSheath,...(e.buffTemplateId!=null?{buffTemplateId:e.buffTemplateId}:{}),
          sourceSetTargetMesh:e.sourceSetTargetMesh,sourceTargetMeshBound:hasSetTarget(e)||hasVeteranTarget(e),
          sourceBoneTargetMeshBound:hasSetMeshBoneTarget(e),
          ...(e.sourceCandidate?{sourceCandidate:clone(e.sourceCandidate)}:{}),
          ...(isFiniteVisualBirth(this.profileFor(a),e)?{visualBirth:clone(e)}:{})});
      }
      if (!e.active) continue;
      if(hasVeteranTarget(e))updateVeteranTarget(this,e,a);
      if(e.sourceSetTargetMesh)continue; // Advanced by the pre-unit global mesh phase.
      // Buff displayers are owned by a live buff identity, not by the icon's
      // long particle lifetime. Manual removal and death also revoke that owner.
      if(e.buffTemplateId!=null&&(a.hp<=0||!a.buffs.some(b=>b.templateId===e.buffTemplateId&&isBuffActive(b)))){
        e.dead=true;e.endReason=a.hp<=0?'buff-owner-death':'buff-removed';continue;
      }
      if(hasSetMeshBoneTarget(e)){
        const anchor=sampleSetMeshBoneAnchor(e,this.state.effects,a,this.effectBoneSampler,this.effectBoneMatrixSampler);
        if(anchor){e.birthAnchor??=clone(anchor);e.currentAnchor=clone(anchor);[e.x,e.y,e.z]=anchor.position;}
      }
      const meshTime=e.templateFields?.LifeType==='LT_TIME'&&Number.isFinite(e.lifeTimeSeconds);
      const meshTemplate=resolvedAddStardustTemplate(this.effectProfileFor(e).effectTemplates[e.mainEffectName],e)??this.effectProfileFor(e).effectTemplates[e.mainEffectName];
      // Arc/Shadow/XCrash already own their original specialized consumers.
      const singlePlayPeriod=!e.sourceShadowMesh&&!e.sourceArcHandle&&!e.sourceArcStartMesh&&!e.sourceXCrashMeshClock
        ?singlePlayMeshPeriod(meshTemplate):null;
      if(singlePlayPeriod!==null&&e.sourceSinglePlayMeshEndPending){
        e.dead=true;e.endReason='original-mesh-play-end';continue;
      }
      const beforeMaximumGlobal=isMaximumStrikeShot(e)?e.sourceShadowMesh?.globalTime??e.elapsed:null;
      const beforeSoundAnimation=e.animationTime; // Shadow meshes advance before the remaining damage-effect consumers.
      if(e.sourceShadowMesh){
        if(e.sourceShadowMesh.followEndPending){e.dead=true;e.endReason='follow-line-end';continue;}
        // Historical ownership samples call tickEffects(0) for collision at
        // the transmitted pose; that is not another native movement packet.
        const m=dt>0?stepShadowMesh(e.sourceShadowMesh,dt,addLiteralMotionEvents(this.effectProfileFor(e),e,meshTemplate.events)):e.sourceShadowMesh;
        e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position:[...m.position],...(m.rotation?{rotation:[...m.rotation]}:{})};
        [e.x,e.y,e.z]=m.position;e.animationTime=m.animationTime;e.meshLifetimeElapsed=m.nowLifeTime;
        if(m.deathReason){e.dead=true;e.endReason=m.deathReason;continue;}
        // CEffect saves main transform before FollowLine, then retains its
        // corrected live position for the next packet and the land query.
        e.sourceDamageAnchor=clone(e.currentAnchor);
        const follow=followLiteralMeshLine(m,addMarkedDroneMotionData(e),this.nativeGeometry,this.map.lines);
        if(!follow.supported)this.note('literal-follow-line:'+e.mainEffectName,follow.reason,a);
        e.currentAnchor={...e.currentAnchor,position:[...m.position],...(m.rotation?{rotation:[...m.rotation]}:{})};
        [e.x,e.y,e.z]=m.position;
        advanceAddLockOn(this,e,a,dt);
        advanceAddChaserProjectile(this,e,a,dt);
        const refresh=refreshShadowMeshLand(m,this.nativeGeometry,{refresh:e.damage?.REFRESH_LAND_POS!==0});
        e.sourceMeshLandY=m.landY;
        if(!refresh.supported)this.note('shadow-mesh-land:'+e.mainEffectName,refresh.reason,a);
      }else if(meshTime&&!e.sourceArcHandle){
        // Fixed V5 global mesh runs before DamageEffect (Data:1534, Game:3166).
        // LT_TIME tests OLD float NowLifeTime before adding elapsed (Mesh:2132,
        // 2146). A dead main handle skips damage/events (DamageEffect:1864).
        // Preserve this clock separately from the existing damage/event clock.
        e.meshLifetimeElapsed??=Math.fround(e.elapsed??0);
        if(e.meshLifetimeElapsed>=Math.fround(e.lifeTimeSeconds)){
          e.dead=true;e.endReason='template-life-time';continue;
        }
        const p=(e.currentAnchor??e.birthAnchor)?.position;
        if(e.sourceSkillMeshControl&&e.templateFields.CrashLand===true&&p&&
          e.meshLifetimeElapsed>(e.templateFields.NOT_CHECK_LAND_TIME??0)&&p[1]<=e.sourceMeshLandY){
          e.dead=true;e.endReason='template-land-crash';continue;
        }
        e.meshLifetimeElapsed=Math.fround(e.meshLifetimeElapsed+Math.fround(hasSetTarget(e)&&bornNow?0:dt));
      }
      const before = e.elapsed,beforeAnimation=e.animationTime,beforeSourceGlobal=e.sourceMeshGlobalTime??e.elapsed;
      // Data advances existing meshes before the unit Now callback. A mesh
      // created by XCrash Now retains only its .0001f initialization here.
      const xCrashMeshDt=e.sourceXCrashMeshClock&&e.sourceXCrashCreatedStep===this.state.step||hasSetTarget(e)&&bornNow?0:dt;
      e.elapsed=e.sourceXCrashMeshClock||hasSetTarget(e)?Math.fround(e.elapsed+Math.fround(xCrashMeshDt)):e.elapsed+dt;
      if(e.sourceXCrashMeshClock&&e.sourceXCrashMeshEndPending){e.dead=true;e.endReason='original-mesh-play-end';continue;}
      if(isAddPrismTemplate(meshTemplate))advanceAddPrismAnimation(e,dt,meshTemplate);
      else if(isInfinitySword(this,a)&&(e.sourceISSheath||['HarshChaserBlade','SecondBlade'].includes(e.mainEffectName)||/^SwordFallBlade[1-4]$/.test(e.mainEffectName)))advanceArcController(e,dt,meshTemplate);
      else if(e.sourceLiteralMeshClock||singlePlayPeriod!==null){
        if(!advanceLiteralMeshClock(e,this.effectProfileFor(e).effectTemplates[e.mainEffectName],dt).supported)
          this.note('nuclear-mesh-animation-clock','Unsupported nonliteral/fade mesh AniSpeed event, not guessed',a);
      }else if(!e.sourceShadowMesh&&!e.sourceArcHandle&&!e.sourceArcStartMesh)e.animationTime=e.sourceXCrashMeshClock||hasSetTarget(e)?
        Math.fround(e.animationTime+Math.fround(xCrashMeshDt)):e.animationTime+dt;
      if(e.sourceXCrashMeshClock){
        const template=this.effectProfileFor(e).effectTemplates[e.mainEffectName];
        const period=template.animationClips.find(c=>c.name===template.initialAnimation.name).durationSeconds;
        // SkinAnim end pulse is prepared this packet; MeshPlayer consumes it
        // next packet. Same LT_PLAY_COUNT / XAP_ONE rule as the visual runtime.
        e.sourceXCrashMeshEndPending=e.animationTime>period-Math.max(period/10,.03);
      }
      if(singlePlayPeriod!==null)prepareSinglePlayMeshEnd(e,singlePlayPeriod);
      if (!e.damage) {
        updateAddC4Display(this,a,e);
        // Native cleanup groups own presentation handles even after their
        // last combat work. Keep those identities until their explicit Stop/
        // delete path so receiving browsers can translate and stop them too.
        const cleanupOwned=e.deleteOnStateEnd||e.sourceAddFury!==undefined||e.sourceAddDroneMarkVisual!==undefined||isAddC4Display(this,a,e)||isMagnetronOrbit(a,e)||isAddPersistentEffect(a,e)||isAddNativeOwnedEffect(this,a,e)||boneTargets&&Object.hasOwn(boneTargets,e.setName)&&hasSetMeshBoneTarget(e)||e.sourceAddSummonSerial!==undefined&&e.deleteConditions?.some(c=>c===2||c===3)||e.sourceISSheath||ownsWayOfSwordBodyEffect(a,e)||a.sourceInfinitySword?.swordFallEffectIds?.includes(e.id)||a.sourceInfinitySword?.phantomSheathId===e.id||['sourceWildChargeEffectGroup','sourceAwakeningAuraEffectGroup','sourceCustomStateEffectGroup','sourceDashJumpEffectGroup']
          .some(key=>a[key]?.some(entry=>entry.id===e.id))||a.sourceBladeMaster?.blackHoleEffectIds?.includes(e.id)||['megaEffects','windmillEffects'].some(key=>a.sourceLordKnight?.[key]?.includes(e.id));
        const targetLifetime=veteranTargetLifetime(this.profileFor(a),e)??windSlicerVisualLifetime(e,this.profileFor(a));
        if(targetLifetime!==null&&e.elapsed>=targetLifetime){e.dead=true;e.endReason='target-particle-tail-end';}
        e.combatRetired=!e.buffTemplateId&&!e.sourceArcStartMesh&&!cleanupOwned&&!hasSetTarget(e)&&!hasVeteranTarget(e)&&e.sourceBoneEffectSetId!==e.id;continue;
      }
      if(!e.sourceShadowMesh)this.moveEffect(e,a,dt);
      const timed=damageTimedParticleEntries(e.damage,e.timedParticlesProcessed??[],{beforeGlobal:beforeSourceGlobal,afterGlobal:e.sourceMeshGlobalTime??e.elapsed,
        // Literal meshes already advanced their animation above. TIME_PARTICLE
        // must compare against the pre-mesh clock, as SOUND does; comparing the
        // post-mesh value with itself silently hides CA command projectiles.
        beforeAnimation:beforeSoundAnimation,afterAnimation:e.animationTime});
      if(timed.length){e.timedParticlesProcessed=[...(e.timedParticlesProcessed??[]),...timed.map(x=>x.key)];
        this.emit('effectTimedParticles',a.id,{effectId:e.id,name:e.name,entries:timed,mainAnchor:clone(e.currentAnchor??e.birthAnchor),
          evidence:'target2016 TIME_PARTICLE + fixed-V5 DamageEffect1900–1946'});}
      for(const [k,v] of Object.entries(e.damage)){
        if(/^CREATE_DAMAGE_EFFECT\d+$/.test(k))this.createDamageChildren(e,a,k,v,before,e.elapsed);
        if(/^SOUND_PLAY\d+$/.test(k)&&!e.soundFired.includes(k)&&crossed(before,e.elapsed,v['1'])){
          e.soundFired.push(k);this.soundEvent(a,k,v);
        }
      }
      const sourceSounds=damageEffectSoundEntries(e.damage,e.soundFired,{afterGlobal:e.sourceMeshGlobalTime??e.elapsed,beforeAnimation:beforeSoundAnimation,afterAnimation:e.animationTime});
      for(const sound of sourceSounds){
        e.soundFired.push(sound.key);
        if(sound.rate===100)this.emit('sound',a.id,{name:sound.name,field:sound.key,effectId:e.id,...sourceEffectSoundEventMetadata(e),
          effectName:e.name,clock:sound.clock,eventTime:sound.time,evidence:'target2016 SOUND + fixed-V5 DamageEffect2534–2606'});
        else if(sound.rate!==0)this.note('effect-sound-rate:'+e.name+':'+sound.key,'Unverified non-100 RF effect sound rate; combat RNG is unchanged',a);
      }
      const clock = isMaximumStrikeShot(e)?e.sourceShadowMesh?.globalTime??e.elapsed:e.damage.USE_GLOBAL_TIME === 1 ? e.elapsed : e.animationTime;
      if(dt>0)updateMaximumStrikeOrb(this,e,a);
      runeSlayerEffectHitMemory(this.effectProfileFor(e),e,this.state.time);
      const nextStage=isMaximumStrikeShot(e)?e.stage??0:nextEffectDamageStage(e.damage,e.stage??0,{beforeGlobal:beforeSourceGlobal,afterGlobal:e.sourceMeshGlobalTime??e.elapsed,damageClock:clock});
      phantomSwordEffectControls(this.profileFor(a),a,e);
      const unmodifiedData=runeSlayerEffectDamage(this.effectProfileFor(e),e,effectStageDamageData(e.damage,e.stage));
      const traitPolicy=appliedSkillTraitPolicy(a,this.effectProfileFor(e),unmodifiedData,e.traitPolicy);
      const data = skillTraitDamageData(unmodifiedData,traitPolicy);
      if(data&&dt>0)this.collisionReceipts(a,e,{kind:'effect',id:e.id},e.hits);
      if(data&&dt>0)tickSourceHitMemory2016(e.sourceHitMemory2016??=[],dt,{repeat:data.RE_ATTACK});
      const start = e.damage.ATTACK_TIME_START ?? 0, end = e.damage.ATTACK_TIME_END ?? 100;
      // DamageManager::EffectToUnit:1780,1878 initializes reActResult from
      // reActType, then rejects RT_NO_DAMAGE without accepting/counting a hit.
      // Hidden event-producer meshes must keep moving after crossing a body.
      if (clock >= start && clock < end && data && (data.REACT_TYPE??0)!==0) {
        const rawShapes = addAwakeningAttackShapes(e,this.profileFor(a))??this.effectSampler?.(e,a,{profile:this.profileFor(a)})??[];
        const follows=e.definition.TRACE_MORE===1||e.definition.TRACE===1||e.definition.TRACE_MATRIX===1;
        const anchor=e.sourcePosedAnchor??(follows?this.effectAnchorSampler?.(e,a):e.currentAnchor??e.birthAnchor);
        const attackPosition=anchor?.position;
        const shapes=scaleSkillAttackShapes(rawShapes,attackPosition??[e.x,e.y,e.z],traitPolicy);
        const origin={kind:'effect',id:e.id,skillId:e.skillId,powerMultiplier:appliedSkillTraitPower(e.powerMultiplier,e.traitPolicy,traitPolicy),attackPosition,traitPolicy,
          damageDirectionRight:e.damageDirectionRight,damageStateRaw:e.passiveDamageState,
          ...(e.sourceBuffFactor?{sourceBuffFactor:e.sourceBuffFactor}:{}),
          ...(e.sourceCandidate?{sourceCandidate:clone(e.sourceCandidate)}:{})};
        if(data.ATTACK_OUR_TEAM===1)e.hitCount+=this.checkRecoveryHits(e,a,shapes,data);
        else e.hitCount+=this.checkHits(a,shapes,data,e.hits,{...origin,
          facingEvidence:'reference-V5 main effect position candidate; target runtime pending'});
        e.hitCount+=this.checkGroundHits(a,data,e.hits,origin);
      }
      // Original collision uses the current DD and list; NEXT/optional clear
      // commit afterwards, at most once per actual carrier update.
      if(dt>0&&!e.dead&&!isMaximumStrikeShot(e)&&nextStage!==(e.stage??0)){
        e.stage = nextStage;
        e.passiveDamageState={BURNING_NASOD_HAND_POSSIBLE:this.profileFor(a).states[a.state]?.raw.BURNING_NASOD_HAND_POSSIBLE??false};
        if (e.damage.CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE) {e.hits = {};e.hitGaps={};e.sourceHitMemory2016=[];}
      }
      if(isMaximumStrikeShot(e)&&!e.dead)e.stage=maximumStrikeNextStage(e.damage,e.stage??0,{beforeGlobal:beforeMaximumGlobal,afterGlobal:e.sourceShadowMesh?.globalTime??e.elapsed,dt});
      if(!e.startParticlesProcessed){
        e.startParticlesProcessed=true;
        const entries=damageStartParticleEntries(e.damage);
        if(entries.length)this.emit('effectStartParticles',a.id,{effectId:e.id,name:e.name,entries,
          mainAnchor:clone(e.currentAnchor??e.birthAnchor),impactPoint:[...(e.lastImpactPoint??[0,0,0])],
          evidence:'target2016 START_PARTICLE + fixed-V5 collision2367 before first live particle2425; target runtime unmeasured'});
      }
      // DAMAGE_TIME is an integer count of accepted hits (DamageEffect:4562),
      // not seconds. ATTACK_TIME_END closes damage checks, not mesh lifetime.
      // BlackHoleData runs outside that attack/REACT gate (DamageEffect2450).
      // Units have already moved; this writes the next physics packet only.
      // A selected dt0 pass tests historical damage only. Its zero vector
      // must not replace a real owner's already queued live displacement.
      if(selectedEffects===null||dt>0)updateIonBlackHole(e,a,this.state.actors,dt);
      if(!e.dead&&e.hitCount>0&&e.hitCount>=(e.damage.DAMAGE_TIME??1)){e.dead=true;e.endReason='hit-limit';}
      if(!meshTime&&e.lifeTimeSeconds!=null&&e.elapsed>=e.lifeTimeSeconds){e.dead=true;e.endReason='template-life-time';}
      if(!e.buffTemplateId&&singlePlayPeriod===null&&e.lifeTimeSeconds==null&&clock>=end&&!windows(e.damage,'CREATE_DAMAGE_EFFECT').length){
        // With no future damage/events this record may retire from the combat
        // executor. The presentation still owns its original template lifetime.
        e.combatRetired=true;
      }
    }
    // Destruction revokes identities even when an explicit stop already sent
    // its visual end event. The last queued displacement remains untouched.
    for(const e of this.state.effects)if(e.dead)retireIonBlackHole(e,this.state.actors);
    for(const e of [...this.state.effects])if(e.dead&&!e.endEmitted){
      if(!e.suppressSecondaryDamage)this.createSecondaryDamage(e,this.actor(e.ownerId),'DIE_DAMAGE_EFFECT');
      e.endEmitted=true;this.emit('effectEnded',e.ownerId,{effectId:e.id,name:e.name,setName:e.setName,reason:e.endReason??'delete-damage-react'});
    }
    this.state.effects = this.state.effects.filter(e => !e.dead&&!e.combatRetired);
  }
  moveEffect(e,a,dt){
    if(updateBloodCutterAnchor(this,e,a))return;
    if(advanceBlazeWingLockOn(this,e,a,dt))return;
    if(e.sourceAddSummonSerial!==undefined&&e.parentEffectId==null&&(e.definition.TRACE===1||e.definition.TRACE_MORE===1||e.definition.TRACE_MATRIX===1))return;
    if(moveAddSummonProjectile(this,e,a,dt))return;
    if(e.sourcePhantomSword)return;
    if(hasSetMeshBoneTarget(e))return; // Exact set mesh owns this attachment; never resample character bones.
    if(hasSetTarget(e)||hasVeteranTarget(e))return; // Set target, including a detached target, never samples owner.
    // The pre-unit mesh phase already copied and traced this effect. A second
    // trace here would bind the pending mesh to the future actor pose early.
    if(usesSourceTracePosition(e)&&e.sourcePosedAnchor)return;
    if(e.sourceInfinityLockOn){
      const previous=e.currentAnchor??e.birthAnchor;if(!previous)return;
      const p=[...previous.position],DEG=Math.PI/180;
      const speed=(this.profileFor(a).effectTemplates[e.mainEffectName]?.events??[])
        .filter(v=>v.property==='DirSpeed'&&v.start<=e.elapsed).at(-1)?.value??0;
      const direction=(e.sourceInfinityManualDirDegree??[0,0,0]).map(n=>Math.fround(n*Math.fround(DEG)));
      for(let i=0;i<3;i++)p[i]=Math.fround(p[i]+Math.fround(Math.fround(direction[i]*speed)*Math.fround(dt)));
      const length=Math.hypot(...direction),horizontal=Math.hypot(direction[0],direction[2]);
      const rotation=length>0&&horizontal>0?[0,Math.atan2(-direction[2],direction[0])/DEG,Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))/DEG]:previous.rotation;
      e.currentAnchor={...previous,position:p,rotation};[e.x,e.y,e.z]=p;
      if(e.elapsed<e.damage.LOCK_ON_DATA.TIME_UNLOCK_AFTER_START){
        const bridge=this.skillsFor(a)??this.nativeSkills;
        if(!bridge?.vectorLockOn){this.note('is-lockon-native','Original VectorLockOn bridge required',a);return;}
        e.sourceInfinityManualDirDegree=bridge.vectorLockOn({position:p,
          manualDirDegree:e.sourceInfinityManualDirDegree??[0,0,0],targetPosition:e.sourceInfinityLockOn,
          curveSpeed:e.damage.LOCK_ON_DATA.CURVE_SPEED,dt}).manualDirDegree;
      }
      return;
    }
    if(e.sourceArcHandle){
      if(e.sourceArcLockOnUnitUID!==0xffffffff&&this.skillsFor(a)?.vectorLockOn){
        const target=this.state.actors[e.sourceArcLockOnUnitUID-1];
        if(target){
          const targetPosition=nearestLockOnPoint(this.defenderSampler?.(target,{profile:this.profileFor(target),role:'defender'}),[a.x,a.y,a.z],
            [target.x,target.y+100,target.z]);
          const p=(e.currentAnchor??e.birthAnchor).position;
          const result=this.skillsFor(a).vectorLockOn({position:p,manualDirDegree:e.sourceArcManualDirDegree??[0,0,0],
            targetPosition,curveSpeed:e.damage.LOCK_ON_DATA.CURVE_SPEED,dt});
          e.sourceArcManualDirDegree=result.manualDirDegree;e.sourceArcUseManualDir=true;
        }
      }
      return;
    }
    const trace=e.definition.TRACE_MORE===1||e.definition.TRACE===1||e.definition.TRACE_MATRIX===1;
    const traced=trace?this.effectAnchorSampler?.(e,a,{profile:this.profileFor(a)}):null;
    const previous=e.currentAnchor??e.birthAnchor;
    if(!previous)return;
    const p=traced?.position?[...traced.position]:[...previous.position],facing=previous.facing;
    if(!trace){
      let v=e.initialVelocity??[0,0,0];
      if(e.sourceSkillMeshControl){
        e.sourceMeshVelocity??=[...v];e.sourceMeshVelocityEvents??=[];
        for(const [i,event] of (this.effectProfileFor(e).effectTemplates[e.mainEffectName]?.events??[]).entries()){
          if(event.property!=='Velocity'||event.start===0||e.sourceMeshVelocityEvents.includes(i))continue;
          if(!crossed(e.elapsed-dt,e.elapsed,event.start))continue;
          if(event.fade||!Array.isArray(event.value)||event.value.length!==3||!event.value.every(Number.isFinite)){
            this.note('skill-mesh-velocity-event:'+e.mainEffectName+':'+i,'Fade/random velocity consumer unsupported',a);continue;
          }
          e.sourceMeshVelocity=[...event.value];e.sourceMeshVelocityEvents.push(i);
        }
        const g=e.templateFields.Gravity??[0,0,0];
        if(Array.isArray(g)&&g.length===3&&g.every(Number.isFinite)){
          // Source mesh SIMULATION accumulates velocity*dt plus .5*g*dt^2;
          // the fixed reference enables the corrected gravity branch.
          v=e.sourceMeshVelocity.map((n,i)=>n+.5*g[i]*dt);
          e.sourceMeshVelocity=e.sourceMeshVelocity.map((n,i)=>Math.fround(n+Math.fround(g[i]*dt)));
        }else this.note('skill-mesh-gravity:'+e.mainEffectName,'Nonnumeric original gravity requires original RNG consumer',a);
      }
      if(e.sourceFollowLine?.basis){
        const local=[(v[0]+(e.initialDirSpeed??0))*dt,v[1]*dt,v[2]*dt],basis=e.sourceFollowLine.basis;
        for(let i=0;i<3;i++)p[i]+=local[0]*basis[0][i]+local[1]*basis[1][i]+local[2]*basis[2][i];
      }else{const delta=reflectedDisplacement(e,[v[0]+(e.initialDirSpeed??0),v[1],v[2]],dt);
        if(delta)for(let i=0;i<3;i++)p[i]+=delta[i];
        else {p[0]+=(v[0]+(e.initialDirSpeed??0))*dt*facing;p[1]+=v[1]*dt;p[2]+=v[2]*dt*facing;}}
    }
    let position=p,rotation=previous.rotation;
    if(e.sourceFollowLine){
      const m=e.sourceFollowLine;m.position=p;
      const follow=followLiteralMeshLine(m,e.damage,this.nativeGeometry,this.map.lines);
      if(!follow.supported)this.note('effect-follow-line:'+e.mainEffectName,follow.reason,a);
      position=m.position;rotation=m.rotation??rotation;
    }
    e.currentAnchor={...previous,position,rotation,facing:traced?.facing??facing};[e.x,e.y,e.z]=position;
  }
  createDamageChildren(e,a,key,v,before,after){
    const count=e.childCounts[key]??0,limit=v.LOOP_END_COUNT??1,interval=v.LOOP_INTERVAL??0;
    if(count>=limit||after>=(v.LOOP_END_TIME??99999))return;
    const at=(v.EVENT_TIME??-1)+interval*count;
    if(!crossed(before,after,at))return;
    const anchor=e.currentAnchor??e.birthAnchor;
    if(!anchor)return;
    if([v.ROTATE_X??0,v.ROTATE_Y??0,v.ROTATE_Z??0].some(n=>n!==0)){
      this.note('damage-child-rotation:'+e.name+':'+key,'Nonzero damage child Euler rotation is unsupported, not ignored',a);e.childCounts[key]=count+1;return;
    }
    const type=v.POSITION_TYPE??0;
    const base=type===0?this.effectBoneSampler?.(e,a,v.BONE_NAME):type===1?
      this.effectAnchorSampler?.({definition:{BONE_NAME:v.BONE_NAME}},a)?.position:type===2?e.lastImpactPoint:
      type===3?anchor.position:null;
    if(!base){this.note('damage-child-position:'+e.name+':'+key,'Original child position/bone unavailable; no owner-position substitution',a);e.childCounts[key]=count+1;return;}
    const rotateOffset=v.APPLY_ROTATED_OFFSET===1,offset=[v.OFFSET_X??0,v.OFFSET_Y??0,v.OFFSET_Z??0];
    const position=base.map((n,i)=>n+offset[i]*(rotateOffset&&i!==1?anchor.facing:1));
    const facing=v.APPLY_ROTATE_ORIGIN===1||v.APPLY_ROTATE!==0?anchor.facing:1;
    // DEPT_BONE / DEPT_POS inherit the actual main mesh rotation by default
    // (DamageEffect2077–2091,2151–2169; loader APPLY_ROTATE=true at5063).
    // Keeping only facing discarded XCrash's declared -45 roll in its children.
    const parentMesh=xCrashMeshTransform(this.effectProfileFor(e).effectTemplates[e.mainEffectName],e,e.sourcePosedAnchor??anchor);
    const rotation=[0,3].includes(type)?v.APPLY_ROTATE_ORIGIN===1?(e.birthAnchor?.rotation??anchor.rotation):
      v.APPLY_ROTATE!==0?(parentMesh?.rotation??e.sourcePosedAnchor?.rotation??anchor.rotation):[0,0,0]:null;
    const childName=v.DAMAGE_EFFECT_NAME;
    if(typeof childName!=='string'){this.note('damage-child-name:'+e.name+':'+key,'CREATE_DAMAGE_EFFECT lacks native DAMAGE_EFFECT_NAME',a);e.childCounts[key]=count+1;return;}
    const child=this.createEffect(a,{NAME:childName},{setName:e.setName,clock:'custom',parentEffectId:e.id,sourceProfessionId:e.sourceProfessionId,
      birthAnchor:{position,facing,...(rotation?{rotation:[...rotation]}:{}),evidence:'reference-v5 DamageEffect.cpp:2077/2151 default main-mesh rotation + target2016 offset fields'}});
    child.powerMultiplier=e.powerMultiplier;child.skillId=e.skillId;child.traitPolicy=clone(e.traitPolicy);
    inheritAddSummonEffectState(e,child);
    if(v.INHERIT_BUFF_FACTOR===1&&e.sourceBuffFactor)child.sourceBuffFactor=e.sourceBuffFactor;
    e.childCounts[key]=count+1;
    this.emit('damageChildCreated',a.id,{effectId:child.id,parentEffectId:e.id,name:childName,field:key,eventTime:at,position,positionType:type,
      evidence:'target2016 CREATE_DAMAGE_EFFECT + reference-v5 DamageEffect.cpp:2040-2230 + original posed bone adapter'});
  }
  createSecondaryDamage(e,a,kind){
    if(!e.damage)return;
    for(const [key,v] of Object.entries(e.damage)){
      if(!key.startsWith(kind)||!/^\d+$/.test(key.slice(kind.length)))continue;
      if(kind==='DIE_DAMAGE_EFFECT'&&!allowDieDamageChild(v,e.endReason))continue;
      if(kind==='DIE_DAMAGE_EFFECT'&&!allowVeteranResidualChild(this.profileFor(a),e,v))continue;
      const anchor=kind==='DIE_DAMAGE_EFFECT'&&e.sourceShadowMesh?e.sourceDamageAnchor:e.currentAnchor??e.birthAnchor;if(!anchor)continue;
      const type=v.POSITION_TYPE??0;
      const base=type===0?this.effectBoneSampler?.(e,a,v.BONE_NAME):type===1?
        this.effectAnchorSampler?.({definition:{BONE_NAME:v.BONE_NAME}},a)?.position:type===2?e.lastImpactPoint:
        type===3?anchor.position:type===4&&kind==='DIE_DAMAGE_EFFECT'?e.sourceShadowMesh?.landPosition:null;
      if(!base){this.note('damage-secondary-position:'+e.name+':'+key,'Original secondary bone/impact/position unavailable',a);continue;}
      if(type===4&&base[1]<0)continue; // Native DEPT_DIE_POS has no ground below the shell.
      const fissionSplit=isOriginalFissionSplit(this.effectProfileFor(e),e,key,kind);
      if(!fissionSplit&&([v.ROTATE_X??0,v.ROTATE_Y??0,v.ROTATE_Z??0].some(x=>x!==0)||v.INHERITLOCKONDATA===1)){
        this.note('damage-secondary-transform:'+e.name+':'+key,'Secondary Euler rotation/lock inheritance remains unsupported',a);continue;}
      const offset=[v.OFFSET_X??0,v.OFFSET_Y??0,v.OFFSET_Z??0];
      const position=base.map((n,i)=>n+offset[i]*(v.APPLY_ROTATED_OFFSET===1&&i!==1?anchor.facing:1));
      const parentMesh=xCrashMeshTransform(this.effectProfileFor(e).effectTemplates[e.mainEffectName],e,e.sourcePosedAnchor??anchor);
      // CEffect::SetScale also sets DieDamageScale; Splash's passive size
      // enhancement must reach the explosion's real helper and presentation.
      const rsSplashScale=kind==='DIE_DAMAGE_EFFECT'&&this.effectProfileFor(e).target.unitClass===101&&
        e.name==='DamageEffect_SA_ERS_SplashExplosion_Attack'&&v.DAMAGE_EFFECT_NAME==='DamageEffect_SA_ERS_SplashExplosion_Attack_2';
      const child=this.createEffect(a,{NAME:v.DAMAGE_EFFECT_NAME,...(rsSplashScale||fissionSplit?Object.fromEntries(
        ['SCALE_X','SCALE_Y','SCALE_Z'].map(key=>[key,fissionSplit?v[key]:e.definition[key]??1])):{})},{parentEffectId:e.id,setName:e.setName,sourceProfessionId:e.sourceProfessionId,
        // m_fLandPos is the CEffect birth plane, separate from mesh's refreshed
        // land plane (.cpp:1268/2527; .h:691). Die child gets min(birth, child.y).
        sourceLandY:Number.isFinite(e.sourceDamageLandY??e.sourceMeshLandY)?Math.min(e.sourceDamageLandY??e.sourceMeshLandY,position[1]):null,
        birthAnchor:{position,facing:v.APPLY_ROTATE===0?1:anchor.facing,rotation:fissionSplit?[v.ROTATE_X??0,v.ROTATE_Y??0,v.ROTATE_Z??0]:parentMesh?
          v.APPLY_ROTATE===0?[0,0,0]:parentMesh.rotation:anchor.rotation,
          evidence:'fixed-V5 DamageEffect CreateHit/DieDamageEffect position consumer + target2016 declarations'}});
      if(!child)continue;
      child.skillId=e.skillId;child.powerMultiplier=e.powerMultiplier;child.traitPolicy=clone(e.traitPolicy);
      if(fissionSplit){child.sourceAddFissionSplit={parentName:e.name,member:key};inheritAddFissionDroneLock(e,child);}
      inheritAddSummonEffectState(e,child);
      if(rsSplashScale&&e.sourceRuneLevel!==undefined)child.sourceRuneLevel=e.sourceRuneLevel;
      if(this.effectProfileFor(e).target.unitClass===101&&e.skillId===21017)child.ownerStateSerial=e.ownerStateSerial;
      child.sourceSkillMeshControl=e.sourceSkillMeshControl;
      this.emit('damageSecondaryCreated',a.id,{effectId:child.id,parentEffectId:e.id,name:child.name,field:key,position});
    }
  }
  checkRecoveryHits(e,a,shapes,data){
    if(data.NO_DAMAGE!==1){this.note('same-team-offensive-damage:'+e.name,'Same-team offensive damage consumer remains unsupported',a);return 0;}
    let accepted=0;
    for(const b of this.state.actors){
      if(b.team!==a.team||b.hp<=0)continue;
      if(this.networkOwnerId!==null&&b.id!==this.networkOwnerId)continue;
      if(e.damage.ONLY_RELATIONSHIP===1&&b.id!==a.id&&b.id!==a.relationshipPartnerId)continue;
      e.hitGaps??={};if(!canRepeatHit(e.hits,e.hitGaps,b.id,this.state.time,data))continue;
      if(!shapes.some(s=>this.intersects(s,b)))continue;
      rememberHit(e.hits,e.hitGaps,b.id,this.state.time,data);e.lastImpactPoint=[b.x,b.y+this.profileFor(a).body.UNIT_HEIGHT/2,b.z];
      const hpBefore=b.hp,mpBefore=b.mp;
      b.hp=clamp(b.hp+b.hpMax*(data.HP_PERCENT_UP??0),0,b.hpMax);
      b.mp=clamp(b.mp+b.mpMax*(data.MP_PERCENT_UP??0),0,b.mpMax);
      if(data.BUFF_FACTOR)this.grantBuff(a,b,data.BUFF_FACTOR,1,e.traitPolicy);
      if(data.BUFF_FACTOR_ID){const skill=this.skill(data.BUFF_FACTOR_RELATIVE_SKILL_ID??e.skillId,a),level=skill?.maxLevel??1;
        for(const factor of array(data.BUFF_FACTOR_ID))this.grantBuff(a,b,factor,level,e.traitPolicy);}
      this.createSecondaryDamage(e,a,'HIT_DAMAGE_EFFECT');
      this.emit('skillRecovery',a.id,{targetId:b.id,skillId:e.skillId,hpBefore,hp:b.hp,mpBefore,mp:b.mp,
        evidence:'fixed-V5 GUUser HP_PERCENT_UP/MP_PERCENT_UP + DamageManager ONLY_RELATIONSHIP; target-client pending'});
      accepted++;
    }
    return accepted;
  }
  intersects(shape,b) {
    // Original native sphere data supplied by both adapters. The adapters retain
    // target-vs-reference provenance for their transform/radius policy.
    const defenderShapes = this.defenderSampler?.(b,{profile:this.profileFor(b),role:'defender'});
    if (defenderShapes) return defenderShapes.some(d=>this.hitPoint(shape,d)!==null);
    // Fallback is explicitly declared prototype behavior, not a native capsule.
    const h = this.profileFor(b).body.UNIT_HEIGHT, w = this.profileFor(b).body.UNIT_WIDTH;
    if (shape.kind === 'sphere') {
      const p = shape.center; const dx = Math.max(Math.abs(p[0]-b.x)-w/2,0);
      const dy = Math.max(b.y-p[1],p[1]-(b.y+h),0); const dz = Math.abs((p[2]??0)-b.z);
      return dx*dx + dy*dy + dz*dz <= shape.radius*shape.radius;
    }
    if (shape.kind === 'bounds') {
      this.note('collision-bounds', 'AABB broadphase used by adapter; native narrowphase still pending');
      return shape.min[0] <= b.x+w/2 && shape.max[0] >= b.x-w/2 && shape.min[1] <= b.y+h && shape.max[1] >= b.y;
    }
    return false;
  }
  collisionReceipts(a,record,origin,hits){
    const current={hits,hitGaps:record.hitGaps??={},...(record.sourceHitMemory2016?{sourceHitMemory2016:record.sourceHitMemory2016}:{})};
    const receiver=this.receiverHitMemory?.({attacker:a,record,origin,...current});
    if(!receiver)return current;
    Object.assign(record,{hits:receiver.hits,hitGaps:receiver.hitGaps,...(receiver.sourceHitMemory2016?{sourceHitMemory2016:receiver.sourceHitMemory2016}:{})});return receiver;
  }
  checkHits(a, shapes, data, hits, origin) {
    const hitRecord=origin.kind==='core'?a.core:origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):a;
    const record=hitRecord??a,receipt=this.collisionReceipts(a,record,origin,hits);let hitGaps;({hits,hitGaps}=receipt);
    if(hitRecord?.dead)return 0;
    let accepted=0;
    for(const target of this.state.actors){
      const b=this.contactActor(target,a);
      const chaserContact=hitRecord?.name===CHASER_ATTACKER&&a.professionId==='MM'&&
        (this.networkOwnerId===null||this.networkOwnerId===a.id);
      if (b.id === a.id || b.team === a.team || b.hp <= 0 || !chaserContact&&(b.invincible || b.forceInvincible > 0)) continue;
      const identity=b.id+':'+(this.networkEpochFor?.(b.id)??0),sourceMemory=hitRecord?.sourceHitMemory2016;
      if(sourceMemory?sourceHitMemoryContains2016(sourceMemory,identity):!canRepeatHit(hits,hitGaps,b.id,this.state.time,data))continue;
      const posed=this.contactGeometry(b,a);
      const defenders=this.defenderSampler?.(posed,{profile:this.profileFor(a),role:'defender'});
      let impact=null;
      if(defenders){for(const shape of shapes){for(const defender of defenders){impact=this.hitPoint(shape,defender);if(impact)break;}if(impact)break;}}
      else if(shapes.some(s=>this.intersects(s,posed)))impact=[posed.x,posed.y+this.profileFor(a).body.UNIT_HEIGHT/2,posed.z];
      if(!impact)continue;
      // Original owner +328 runs on geometric contact, before ordinary
      // invulnerability clears the reaction code. It is not a HP hit count.
      if(chaserContact)addShootingChaserContact(this,a,b,hitRecord,impact);
      if(origin.kind==='effect')addMmLot6Contact(hitRecord,b);
      if(chaserContact&&(b.invincible||b.forceInvincible>0)){
        // Web contact memory uses the original HIT_GAP even when protection
        // prevents the subsequent damage reaction. Do not count every frame.
        rememberHit(hits,hitGaps,b.id,this.state.time,data);
        if(sourceMemory)appendSourceHitMemory2016(sourceMemory,identity,data.HIT_GAP??0);
        continue;
      }
      if(!claimEffectGroupHit(this.state,origin.kind==='effect'?hitRecord:null,a.id,b.id,data,{
        attackerEpoch:hitRecord?.networkEpoch??this.networkEpochFor?.(a.id)??0,targetEpoch:this.networkEpochFor?.(b.id)??0}))continue;
      rememberHit(hits,hitGaps,b.id,this.state.time,data);
      if(sourceMemory)appendSourceHitMemory2016(sourceMemory,identity,data.HIT_GAP??0);
      const result=this.applyHit(a,b,data,{...origin,impactPoint:impact});
      if(result?.accepted){accepted++;if(!result.effectTrigger){
        if(hitRecord?.sourceAddSummonSerial!==undefined){hitRecord.lastImpactPoint=impact;this.createSecondaryDamage(hitRecord,a,'HIT_DAMAGE_EFFECT');}
        else this.acceptedSkillHit(a,b,data,{...origin,impactPoint:impact});
      }if(isMaximumStrikeShot(hitRecord)){maximumStrikeHitCompleted(hitRecord);receipt.onMaximumStrikeAccepted?.();}}
      if(hitRecord?.dead)break;
    }
    if(!hitRecord?.dead)for(const target of [...npcHitTargets(this),...prismHitTargets(this)]){
      const b=target.actor;
      if(b.team===a.team||b.invincible||this.networkOwnerId!==null&&target.owner.id!==this.networkOwnerId)continue;
      const identity=b.id+':'+(this.networkEpochFor?.(target.owner.id)??0),sourceMemory=hitRecord?.sourceHitMemory2016;
      if(sourceMemory?sourceHitMemoryContains2016(sourceMemory,identity):!canRepeatHit(hits,hitGaps,b.id,this.state.time,data))continue;
      let impact=null;for(const shape of shapes){for(const sphere of target.spheres){impact=this.hitPoint(shape,sphere);if(impact)break;}if(impact)break;}
      if(!impact)continue;
      if(!claimEffectGroupHit(this.state,origin.kind==='effect'?hitRecord:null,a.id,b.id,data,{
        attackerEpoch:hitRecord?.networkEpoch??this.networkEpochFor?.(a.id)??0,targetEpoch:this.networkEpochFor?.(target.owner.id)??0}))continue;
      rememberHit(hits,hitGaps,b.id,this.state.time,data);
      if(sourceMemory)appendSourceHitMemory2016(sourceMemory,identity,data.HIT_GAP??0);
      const result=this.applySummonHit(a,b,data,{...origin,impactPoint:impact});
      if(result?.accepted){rememberHit(hits,hitGaps,b.id,this.state.time,data);accepted++;
        if(isMaximumStrikeShot(hitRecord)){maximumStrikeHitCompleted(hitRecord);receipt.onMaximumStrikeAccepted?.();}}
      if(hitRecord?.dead)break;
    }
    return accepted;
  }
  applySummonHit(a,b,raw,origin){
    const partial=addKnownDamageData(this.profileFor(a),raw);
    if(partial.gap)this.note('add-source-gap:'+partial.gap,'Unresolved Add source field stays unsupported; independently known contact fields remain active',a);
    const resolved=resolveDamageValues(partial.data,this.profileFor(a).physics);
    if(!resolved.supported)return {accepted:false};
    const data=resolved.data,source=origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null;
    const npcAttack=source?.sourceAddSummonSerial!==undefined;
    const attacker=npcAttack?{...a,...addSummonCombatActor(a)}:a;
    if(data.REACT_TYPE===12&&data.CREATE_EFFECT_SET_TRACE_UNIT===1){this.note('npc-target-buff-trace','NPC target EffectSet tracing requires its independent attachment identity',a);return {accepted:false};}
    if([11,12].includes(data.REACT_TYPE))return this.createReactionEffect(attacker,b,data,origin);
    const runeLuna=prepareRuneLunaContact(this,a,b,data,origin);
    const outgoing=attacker.passivePolicy?modifyOutgoingHit(attacker.passivePolicy,{damageData:data,stateRaw:this.profileFor(a).states[a.state]?.raw,targetHp:b.hp,targetMaxHp:b.hpMax,actorHp:a.hp,actorMaxHp:a.hpMax}):null;
    const sword=wayOfSwordHitPolicy(attacker,data),addDamage=addDamageModifiers(attacker,data,{skillId:origin.skillId});
    const awake=(isAddActor(attacker)?attacker.sourceAdd?.formation:attacker.awakening.remaining>0)?this.profileFor(a).referenceSemantics.awakening.powerMultiplier:1;
    const result=computeAddSummonHitDamage({attacker,defender:b,data:outgoing?.damageData??data,powerMultiplier:(origin.powerMultiplier??1)*sword.damage*addDamage.damageMultiplier,
      nativeCritical:this.nativeCritical,roll:this.rng(),traitPolicy:origin.traitPolicy??{},
      attackStatMultiplier:(outgoing?.attackMultiplier??1)*(this.presetFor(a).onlineMatch?attacker.pvpModifiers?.damageMultiplier??1:1),
      attackFinalMultiplier:awake*(attacker.stats[(data.MELEE_ATTACK??origin.kind!=='effect')?'finalDamageMultiplierMelee':'finalDamageMultiplierRange']??1),
      skillBonus:this.skill(origin.skillId,a)?attacker.equipmentAttributes?.skillDamageBonus??0:0});
    if(!result.supported){this.note('add-summon-damage:'+result.reason,'Unresolved original base attributes for independent NPC damage',a);return {accepted:false};}
    const amount=runeLuna&&!runeLuna.allowHp?0:result.amount;
    if(!(b.sourcePrismOwnerId?applyPrismTargetDamage(this,b,amount,data):applyAddSummonDamage(this,b,amount)))return {accepted:false};
    // NPC receiver has no MP/buff pool. Keep that existing independent domain
    // while applying the same project HP quota to its successful settlement.
    settleRuneLunaContact(this,a,b,runeLuna,{amount,mpAllowed:false});
    // NPC material comes only from its own frozen declarations. Reuse the
    // target DamageSound lookup at this Web accepted-hit boundary; the exact
    // original2016 NPC sound-producing callback is not claimed as closed.
    if(Number.isInteger(b.sourceHittedType)){
      const muted=isVeteran(this,a)&&veteranResidualHitAudioMuted(this.profileFor(a),source);
      const sound=resolveHitSound(data,{muted,hittedType:b.sourceHittedType,atStateHittedType:b.sourceHittedTypeAtState});
      if(sound){const position=[b.x,b.y,b.z];this.emit('sound',b.id,{name:sound,field:'npc-damage-hit',attackerId:a.id,
        origin:clone(origin),hitType:data.HIT_TYPE??0,position,...sourceSoundPositionMetadata(position),soundPositionSource:'npc-target',
        evidence:'target2016 NPC HITTED_TYPE + DamageSound.lua; Web accepted-hit audio adapter; original2016 NPC producer unclosed'});}
    }
    if(source){source.lastImpactPoint=origin.impactPoint;this.createSecondaryDamage(source,a,'HIT_DAMAGE_EFFECT');}
    return {accepted:true,amount};
  }
  checkGroundHits(a,data,hits,origin){
    // HT_GROUND_HIT=26 is decoded from target Enum.lua, with its independent
    // source/hash in contracts/rf-command-reactions-source-v9.json.
    if(data.HIT_TYPE!==26)return 0;
    const geometry=this.nativeGeometry;
    if(!geometry?.nearest||!geometry?.lineGroup||!geometry?.distance){
      this.note('native-ground-hit-query-missing','GroundHit requires original nearest-line/group/distance functions; no screen-space radius substitute',a);return 0;
    }
    const effect=origin.kind==='effect',position=effect?origin.attackPosition:[a.x,a.y,a.z];
    const land=effect?position:a.landPosition;
    if(!position||!land){this.note('ground-hit-position-missing','Original actor land/effect position unavailable; no owner-position fallback',a);return 0;}
    const attackLine=geometry.nearest({position:land});if(!attackLine.found)return 0;
    const attackGroup=geometry.lineGroup(attackLine.lineId);
    const hitRecord=origin.kind==='core'?a.core:origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):a;
    const record=hitRecord??a;let hitGaps;({hits,hitGaps}=this.collisionReceipts(a,record,origin,hits));
    const distance=data.DAMAGE_DISTANCE??99999;let accepted=0;
    for(const target of this.state.actors){
      const b=this.contactActor(target,a);
      if(b.id===a.id||b.team===a.team||b.hp<=0||b.invincible||b.forceInvincible>0)continue;
      if(!canRepeatHit(hits,hitGaps,b.id,this.state.time,data))continue;
      const posed=this.contactGeometry(b,a);
      if(geometry.distance(position,[posed.x,posed.y,posed.z])>distance)continue;
      // GetUnitCondition() defaults to Now (User.h:1551), whose foot flag
      // uses strict LINE_RADIUS, not Future's <1 and downward-speed gate.
      // This host shares the saved land cache; full Now/Future buffers remain
      // outside the compiled geometry module and require target traces.
      if(!posed.landPosition||Math.abs(posed.y-posed.landPosition[1])>=this.profileFor(b).referenceSemantics.lineRadius)continue;
      if(data.DAMAGE_LINEGROUP&&attackGroup){
        const defenderLine=geometry.nearest({position:posed.landPosition});
        if(!defenderLine.found)return accepted;
        const defenderGroup=geometry.lineGroup(defenderLine.lineId);if(!defenderGroup)return accepted;
        if(defenderGroup.nativeStartIndex!==attackGroup.nativeStartIndex||defenderGroup.nativeEndIndex!==attackGroup.nativeEndIndex)continue;
      }
      rememberHit(hits,hitGaps,b.id,this.state.time,data);
      const impactPoint=[posed.x,posed.y,posed.z];
      const result=this.applyHit(a,b,data,{...origin,impactPoint,groundHit:true,
        routeEvidence:'target2016 HT_GROUND_HIT + reference-V5 DamageManager.cpp:853-1074; original geometry WASM'});
      if(result?.accepted){accepted++;if(!result.effectTrigger){
        if(hitRecord?.sourceAddSummonSerial!==undefined){hitRecord.lastImpactPoint=impactPoint;this.createSecondaryDamage(hitRecord,a,'HIT_DAMAGE_EFFECT');}
        else this.acceptedSkillHit(a,b,data,{...origin,impactPoint});
      }}
    }
    return accepted;
  }
  applyHit(a,b,data,origin = {}) {
    if(origin.kind==='character')data=ravenCommandDamageData(this.profileFor(a),a,data);
    this.refreshOwnedBuffProtection(b);
    b=this.contactActor(b,a);
    const source=origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null;
    if(source?.sourceAddSummonSerial!==undefined){
      a={...clone(a),...addSummonCombatActor(a)};
      origin={...origin,sourceAddSummonSerial:source.sourceAddSummonSerial};
    }
    if(this.networkOwnerId!==null){
      if(a?.id!==this.networkOwnerId&&b?.id!==this.networkOwnerId)return this.observeRemoteDamage&&a&&b?
        observeRemoteDamage(this,a,b,data,origin):{accepted:false,reason:'remote-owners'};
      // Keep the complete attack/reaction consumer for the local participant.
      // A remote participant is a disposable observation: local damage text,
      // attack feedback and effects may be speculative, their HP/reaction is
      // committed only by their own client. This is a web ownership adapter.
      if(a&&a.id!==this.networkOwnerId)a=clone(a);
      if(b&&b.id!==this.networkOwnerId)b=clone(b);
    }
    return this.applyParticipantHit(a,b,data,origin);
  }
  applyParticipantHit(a,b,data,origin = {}) {
    if (!a || !b || b.hp <= 0 || b.invincible || b.forceInvincible > 0 || b.manaBreak?.pendingDown) return { accepted:false,reason:'dead-or-invincible' };
    if (a.team === b.team) return { accepted:false,reason:'same-team' };
    if(runeSlayerAbsorbProjectile(this,a,b,data,origin))return {accepted:true,amount:0,absorbed:true,effectTrigger:true};
    const partial=addKnownDamageData(this.profileFor(a),data);
    if(partial.gap)this.note('add-source-gap:'+partial.gap,'Unresolved Add source field stays unsupported; independently known contact fields remain active',a);
    const resolved=resolveDamageValues(partial.data,this.profileFor(a).physics);
    if(!resolved.supported){this.note('damage-values:'+JSON.stringify(resolved.unsupported),'Unresolved target damage data; hit remains unsupported',a);return {accepted:false,reason:'unsupported-damage-values'};}
    data=resolved.data;
    const miss=currentSourceMiss2016(this,a,b,data,origin);
    if(!miss.supported){
      // Missing a runtime seed at a nontrivial threshold is unsupported. Do
      // not replace it with an old PRNG or count it as an accepted hit.
      if(miss.reason!=='npc-accuracy-instance-unavailable'){this.note('source-miss:'+miss.reason,'Original Miss input unavailable: '+(miss.missing??[]).join(', '),a);return {accepted:false,reason:'unsupported-source-miss',details:miss};}
    }else if(miss.miss){
      if(!this.observationOnly)this.processGuildContact(a,b);
      this.emit('evasion',b.id,{attackerId:a.id,origin:clone(origin),threshold:miss.threshold,sample:miss.sample,
        evidence:'target2016 conditional consumer; current explicit simulation inputs',visualUnsupported:'EvasionHit01 original particle is not in this resource closure'});
      return {accepted:false,miss:true,contactRegistered:true};
    }
    const riseEffect=a.standupAttackNoDown&&origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null;
    const standup=standupHitPolicy(a,data,
      riseEffect?{...origin,name:riseEffect.name,ownerStateSerial:riseEffect.ownerStateSerial}:origin);data=standup.data;
    // GUUser7932 returns before damage/reaction/rewards for these contacts;
    // DamageEffect3861/3890 (or GUUser AttackResult) creates the real hit.
    if(data.REACT_TYPE===11||data.REACT_TYPE===12){
      const result=this.createReactionEffect(a,b,data,origin);
      if(result.accepted&&!this.observationOnly)this.processGuildContact(a,b);
      return result;
    }
    data=lordKnightDamageData(this.profileFor(a),a,this.skill(origin.skillId??a.skillId,a),data);
    // Capture at hit entry: consuming the final points must not remove this
    // hit's active-state multiplier halfway through the accepted-hit pipeline.
    data=elesisSwordDamage(a,data,{...this.presetFor(a),skillId:origin.skillId??a.skillId});
    const elesisSwordState=a.wayOfSword?.state;
    const swordHit=isElesisProfession(a.professionId)?elesisSwordHitPolicy(a,data,this.presetFor(a)):wayOfSwordHitPolicy(a,data),swordReceivedMp=wayOfSwordReceivedMpMultiplier(b);
    const elesisBreak=elesisBreakEligible(b,data),elesisEndurance=!elesisBreak&&elesisEnduranceEligible(b,data);
    const outgoing=a.passivePolicy?modifyOutgoingHit(a.passivePolicy,{damageData:data,stateRaw:origin.damageStateRaw??this.profileFor(a).states[a.state]?.raw,targetHp:b.hp,targetMaxHp:b.hpMax,actorHp:a.hp,actorMaxHp:a.hpMax}):null;
    if(outgoing)data=outgoing.damageData;
    const addDamage=addDamageModifiers(a,data,{skillId:origin.skillId});
    const addBarrier=addBarrierEligible(b,this.profileFor(b),data);
    const forceDownMultiplier=(a.stats[origin.kind==='effect'?'forceDownMultiplierRange':'forceDownMultiplierMelee']??1)*addDamage.forceDownMultiplier;
    if(forceDownMultiplier!==1&&Number.isFinite(data.FORCE_DOWN))data={...data,FORCE_DOWN:data.FORCE_DOWN*forceDownMultiplier};
    if(a.passivePolicy?.elesis?.rawValues?.[28404]&&Number.isFinite(data.FORCE_DOWN))data={...data,FORCE_DOWN:Math.fround(data.FORCE_DOWN*a.passivePolicy.elesis.rawValues[28404].SA_FORCE_DOWN_REL)};
    const attackPosition=origin.attackPosition??[a.x,a.y,a.z];
    const fromFront=attackerIsFront([b.x,b.y,b.z],attackPosition,[1,0,0],b.facing>0,
      {arrangedFly:data.ARRANGED_FLY===1||data.ARRANGED_FLY===true,
        damageDirectionRight:origin.kind==='effect'?origin.damageDirectionRight:a.facing===1});
    // SwordMan exits for Counter/Guard before its destruction-rage branch.
    if(tryReflectProjectile(this,a,b,data,origin,fromFront))return {accepted:true,amount:0,reflected:true,effectTrigger:true};
    if(lordKnightCounter(this,a,b,data,origin,fromFront))return {accepted:true,amount:0,countered:true};
    if(infinitySwordCounter(this,a,b,data,origin,fromFront))return {accepted:true,amount:0,countered:true};
    const runeLuna=prepareRuneLunaContact(this,a,b,data,origin);
    if(runeLuna)data=runeLuna.data;
    if(!elesisBreak&&!elesisEndurance&&isDamagedReaction(data)&&!data.NO_DAMAGE){
      const cure=clearReceivedHitStun(b.buffs);
      if(cure.removed.length){
        b.buffs=cure.buffs;b.buffControls={...b.buffControls,inputBlock:cure.inputBlock,stun:cure.stun,dashBlock:cure.dashBlock};
        for(const buff of cure.removed){
          for(const e of this.state.effects)if(e.ownerId===b.id&&e.buffTemplateId===buff.templateId){e.dead=true;e.endReason='received-hit-stun-cure';}
          this.emit('buffFinished',b.id,{templateId:buff.templateId,reason:'received-hit-stun-cure'});
        }
        synchronizeBuffStats(b);
      }
    }
    const lkGuarded=!data.IGNORE_STATE_DEFENCE&&lordKnightAutoGuard(this,b,data,fromFront);
    const elesisGuarded=!elesisBreak&&!elesisEndurance&&!data.IGNORE_STATE_DEFENCE&&elesisAutoGuard(this,b,data,fromFront);
    const destructionRage=!lkGuarded&&wayOfSwordRageEligible(b,data);
    data=elesisPrepareHit(this,a,data,origin);
    const attackTypeBuff=buffAttackTypeMultiplier(a,data);
    if(attackTypeBuff!==1)data={...data,DAMAGE:Object.fromEntries(Object.entries(data.DAMAGE??{}).map(([k,v])=>[k,typeof v==='number'?Math.fround(v*attackTypeBuff):v]))};
    let physical = data.DAMAGE?.PHYSIC ?? 0, magic = data.DAMAGE?.MAGIC ?? 0;
    let type = data.DAMAGE_TYPE ?? 0;
    if (this.hasNasod(a)&&!a.passivePolicy&&this.profileFor(a).states[a.state]?.raw.BURNING_NASOD_HAND_POSSIBLE && this.presetFor(a).passives?.includes(24401)) {
      const p = this.skill(24401,a); magic = physical * p.raw.SA_DAMAGE_REL[String(p.maxLevel)]; physical = 0; type = 1;
    }
    const equipmentFormula=usesPvpEquipmentFormulas(a),online=this.presetFor(a).onlineMatch;
    const awakeningMultiplier=(isAddActor(a)?a.sourceAdd?.formation:a.awakening.remaining>0)?this.profileFor(a).referenceSemantics.awakening.powerMultiplier:1;
    let amount;
    const espReceived=data.NO_DAMAGE===1||data.NO_DAMAGE===true?1:addEspDamageMultiplier2016(this,b);
    if(data.NO_DAMAGE===1||data.NO_DAMAGE===true){
      // Contact-only carriers (including DT_BUFF) invoke their sourced hit
      // effects without asking an unrelated numeric PvP damage formula.
      amount=0;
    }else if(equipmentFormula){
      // Revenge is an attack-stat buff. Awakening is a final-damage buff;
      // the two channels must not collapse into the same multiplicative layer.
      const attackMultiplier=(online?a.pvpModifiers?.damageMultiplier??1:1)*(outgoing?.attackMultiplier??1);
      const base=computePvpBaseDamage({damageType:type,physicalMultiplier:physical,magicMultiplier:magic,
        physicalAttack:a.stats.physicalAttack*attackMultiplier,magicAttack:a.stats.magicAttack*attackMultiplier,
        weaponPhysicalAttack:a.stats.weaponPhysicalAttack==null?undefined:a.stats.weaponPhysicalAttack*attackMultiplier,
        weaponMagicAttack:a.stats.weaponMagicAttack==null?undefined:a.stats.weaponMagicAttack*attackMultiplier,
        physicalDefence:b.stats.physicalDefence,magicDefence:b.stats.magicDefence,attackerLevel:a.formulaRules.combatLevel,
        penetrate:data.PENETRATE??false,ignoreDefence:(data.IGNORE_DEFENCE??false)||a.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='ignoreDefence')),
        defencePierceMultiplier:origin.traitPolicy?.defencePierceMultiplier??1});
      if(!base.supported){this.note('pvp-damage:'+base.reason,'Unresolved PvP damage inputs: '+base.missing.join(', '),a);
        return {accepted:false,reason:'unsupported-pvp-damage',details:base};}
      // User equipment bonus follows the hit's recorded skill, including
      // delayed/secondary/passive skill effects; never the owner's current cast.
      const skillBonus=this.skill(origin.skillId,a)?a.equipmentAttributes?.skillDamageBonus??0:0;
      amount=Math.fround(base.amount*(data.PVP_RATE??1)*(origin.powerMultiplier??1)*swordHit.damage*(1+skillBonus)*addDamage.damageMultiplier);
      const meleeAttack=data.MELEE_ATTACK??(origin.kind!=='effect');
      const finalAttack=awakeningMultiplier*(meleeAttack?a.stats.finalDamageMultiplierMelee??1:a.stats.finalDamageMultiplierRange??1);
      const finalDefence=espReceived*(b.stats.finalDefenceMultiplier??1)*(b.passivePolicy?modifyReceivedHit(b.passivePolicy,{damage:1}).damage:1)*
        (online?b.pvpModifiers?.receivedMultiplier??1:1);
      amount=applyPvpFinalDamageStage(amount,{attackFinalMultiplier:finalAttack,defenceFinalMultiplier:finalDefence});
    }else{
      amount=type===0?a.stats.physicalAttack*physical:type===1?a.stats.magicAttack*magic:.5*(a.stats.physicalAttack*physical+a.stats.magicAttack*magic);
      amount*=(data.PVP_RATE??1)*(origin.powerMultiplier??1)*awakeningMultiplier*(outgoing?.attackMultiplier??1)*swordHit.damage*addDamage.damageMultiplier;
      if(online)amount*=(a.pvpModifiers?.damageMultiplier??1)*(b.pvpModifiers?.receivedMultiplier??1);
    }
    const damageReducePercent=(b.skillDamageReducePercent??0)+(destructionRage||addBarrier?100:0);
    if(elesisGuarded){amount*=b.passivePolicy.elesis.rawValues[28404].SA_DAMAGED_REL;this.emit('elesisAutoGuard',b.id,{attackerId:a.id,damageMultiplier:b.passivePolicy.elesis.rawValues[28404].SA_DAMAGED_REL});}
    if(this.nativeCritical&&damageReducePercent>0)
      amount=this.nativeCritical.reduceDamage(amount,{percent:damageReducePercent,
        penetrate:data.PENETRATE===true||data.PENETRATE===1,
        ignoreStateDefence:data.IGNORE_STATE_DEFENCE===true||data.IGNORE_STATE_DEFENCE===1});
    else if((destructionRage||addBarrier)&&!data.PENETRATE&&!data.IGNORE_STATE_DEFENCE)amount=0;
    if(equipmentFormula)amount=Math.max(0,amount);
    else{
      amount=(data.IGNORE_DEFENCE_DECLINE?amount:applyEquipmentDamageReduction(amount,b.stats))*(b.stats.finalDefenceMultiplier??1);
      if(b.passivePolicy)amount=modifyReceivedHit(b.passivePolicy,{damage:amount}).damage;
      amount*=espReceived;
    }
    if(data.NO_DAMAGE===1||data.NO_DAMAGE===true)amount=0;
    // Add DamageReact enters the original barrier before the shared receiver
    // path. It retains hit rewards/STOP/buffs but skips DamageReactStateChange.
    // Speculative observations never enter it or pay its DP charge.
    if(addBarrier&&!this.observationOnly)this.enter(b,ADD_BARRIER_STATE,'add-nasod-barrier');
    const guarded = this.canGuard(b,a,data,attackPosition,fromFront);
    const deleteDamageReactEffects=!elesisBreak&&!elesisEndurance&&shouldDeleteDamageReactEffects(b,data.REACT_TYPE??0);
    if(deleteDamageReactEffects)for (const e of this.state.effects) if (e.ownerId === b.id && e.deleteConditions.includes(1)) e.dead = true;
    // Original DamageReact samples the head before changing the reaction pose.
    // Missing skeleton data stays absent, rather than guessing actor height.
    const damageNumberAnchor=this.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01_Head',POSITION_OFFSET_Y:70}},b)?.position;
    if (guarded) {
      amount *= this.profileFor(b).referenceSemantics.core.guardDamageMultiplier;
      // GUUser8988 multiplies the existing Now velocity; it does not replace
      // it with DAMAGE_DATA.BACK_SPEED_X before the parry reaction early return.
      b.vx=Math.fround(Math.fround(b.vx)*Math.fround(.7));b.vy=0;
    }
    const headPosition=damageNumberAnchor?damageNumberAnchor.map((n,i)=>i===1?n-70:n):null;
    const muteHitAudio=isVeteran(this,a)&&veteranResidualHitAudioMuted(this.profileFor(a),origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null);
    const hitSound=resolveHitSound(data,{muted:muteHitAudio,hittedType:this.profileFor(b).components?.HITTED_TYPE,
      atStateHittedType:this.profileFor(b).states[b.state]?.raw?.HITTED_TYPE_AT_STATE??-1});
    if(hitSound&&!elesisBreak&&!elesisEndurance)this.emit('sound',b.id,{name:hitSound,field:'original-damage-hit',attackerId:a.id,...sourceSoundEventMetadata(b),
      origin:clone(origin),hitType:data.HIT_TYPE??0,evidence:'target2016 DamageSound + fixed-V5 GUUser8326–8354',
      soundPositionEvidence:'contracts/source-sound-routes-native-v45.json; frozen-V5 GUUser8343 this; original2016 dynamic hit sound producer not closed'});
    const critical=this.nativeCritical&&!elesisBreak&&!elesisEndurance&&isDamagedReaction(data)&&!data.NO_DAMAGE?evaluateHitCritical(this.nativeCritical,{amount,attacker:a,defender:b,data,
      traitPolicy:swordHit.forceCritical?{...origin.traitPolicy,forceCritical:true}:origin.traitPolicy,roll:this.rng(),headPosition}):null;
    if(critical)amount=critical.amount;
    // Target2016 ultimate Shockwave explicitly ignores damage reduction. This
    // field is distinct from IGNORE_DEFENCE: it never bypasses armor defence.
    if(equipmentFormula&&!data.IGNORE_DEFENCE_DECLINE)amount=applyPvpEquipmentReduction(amount,b.equipmentAttributes?.damageReduction??0);
    if(equipmentFormula&&((a.equipmentAttributes.additionalAttackRatio??0)>0||a.stats.additionalAttackPercent>0))amount=Math.fround(amount+isAdditionalAttackDamage({
      points:a.stats.additionalAttackPercent??0,equipmentRatio:a.equipmentAttributes.additionalAttackRatio??0,
      level:a.formulaRules.combatLevel,data,stats:a.buffBaseStats??a.stats,powerMultiplier:origin.powerMultiplier??1}));
    if(elesisBreak||elesisEndurance)amount=0;
    // This is a resource quota only: the second stage retains its authored
    // reaction/STOP/contact fields. Gate after additional-attack arithmetic.
    if(runeLuna&&!runeLuna.allowHp)amount=0;
    if(this.observationOnly){
      const luna=settleRuneLunaContact(this,a,b,runeLuna,{amount,
        mpAllowed:!elesisBreak&&!elesisEndurance&&b.hp>amount,applyMp:false});
      this.emit('observedHit',a.id,{targetId:b.id,amount,critical:critical?.critical===true,
        damageNumber:damageNumberAnchor?{position:[...damageNumberAnchor],style:critical?.red?'red':'normal'}:null});
      // Match the ordinary DD factor gate below after this exact damage is
      // subtracted. This local return value grants cosmetic eligibility only;
      // earlier absorb/reflection/effect-trigger returns do not acquire it.
      return {accepted:true,amount,observationOnly:true,effectTrigger:true,
        buffContactAllowed:!elesisBreak&&!elesisEndurance&&b.hp>amount,lunaMpApplied:luna.mpApplied};
    }
    if(critical?.soundCalls&&!muteHitAudio)this.emit('sound',b.id,{name:'Critical_Hit.wav',field:'original-critical',origin:clone(origin),...sourceSoundEventMetadata(b),
      soundPositionEvidence:'contracts/source-sound-routes-native-v45.json; frozen-V5 GUUser9226 this; original2016 delayed-critical consumer is corroboration, not this immediate path'});
    if(critical?.critical&&!headPosition)this.note('critical-head-missing','Original head bone unavailable; critical damage computed without guessed visual position',b);
    // Target NPC Lua consumes ResponseEmergency; its flag producer is only
    // available in the qualified fixed Add reference. This Web adapter calls
    // it at accepted ordinary DamageReact entry, including guard/NO_DAMAGE,
    // but excludes RT11/12 effect creation and speculative observations.
    if(b.sourceAddSummon)triggerAddApocalypseEmergency(this,b);
    const attackPvp=this.presetFor(a).onlineMatch?a.pvpModifiers??{}:{};
    const receivedPvp=this.presetFor(a).onlineMatch?b.pvpModifiers??{}:{};
    b.hp = Math.max(0,b.hp-amount);
    settleRuneLunaContact(this,a,b,runeLuna,{amount,mpAllowed:!elesisBreak&&!elesisEndurance&&b.hp>0});
    this.processGuildContact(a,b);
    elesisReceived(this,a,b,data,amount);
    if(origin.sourceAddSummonSerial===undefined){
      addStasisDamageObserved(a,amount);addAcceptedHit(this,a,b,data,origin);
      if(isAddActor(a))addCoreArmorFeedback2016(this,a,data,gainAddMutation);
      addMagnetronAcceptedHit(this,a,b,data,origin);
      maximumStrikeAcceptedHit(this,a,b,data,origin);
      addHitResources(a,data,{profile:this.profileFor(a),kind:'hit',damage:amount,powerMultiplier:origin.powerMultiplier??1,step:this.state.step,emit:(...args)=>this.emit(...args)});
    }
    addStasisDamageObserved(b,amount,{received:true});
    addHitResources(b,data,{profile:this.profileFor(b),kind:'received',damage:amount,powerMultiplier:origin.powerMultiplier??1,step:this.state.step,emit:(...args)=>this.emit(...args)});
    if(a.wayOfSword)this.applyWayOfSwordDelta(a,isElesisProfession(a.professionId)?elesisSwordAttackDelta(this.profileFor(a),a,data,origin.powerMultiplier??1):wayOfSwordHitDelta(this.profileFor(a),a.wayOfSword,data,origin.powerMultiplier??1),'hit');
    if(b.hp>0&&!b.invincible&&b.wayOfSword)this.applyWayOfSwordDelta(b,isElesisProfession(b.professionId)?elesisSwordReceivedDelta(this.profileFor(b),b,data):wayOfSwordReceivedDelta(this.profileFor(b),b.wayOfSword,data),'received');
    if(origin.sourceAddSummonSerial===undefined){
    if(usesPvpEquipmentFormulas(a))this.recoverHitResources(a,data,'hit',attackPvp,{originKind:origin.kind,
      traitMultiplier:origin.traitPolicy?.hitMpMultiplier??1,swordMultiplier:swordHit.mp});
    else {
      a.mp=clamp(a.mp+modifyHitMpGain(a.passivePolicy,{base:((data.HIT_ADD_MP??0)+(attackPvp.hitMpBonus??0))*(origin.traitPolicy?.hitMpMultiplier??1),attackType:data.ATTACK_TYPE})*guildGainModifiers(a).onHitMpMultiplier*swordHit.mp*(a.stats[origin.kind==='effect'?'hitRangeMpMultiplier':'hitMeleeMpMultiplier']??1),0,a.mpMax);
      this.addCharge(a,this.profileFor(a).referenceSemantics.awakening.onHitBase,'hit');
    }
    }
    // One receive-MP consumer owns the base, roster compensation and all gain
    // multipliers, including the source per-packet guard and exclusions.
    if(!elesisBreak&&!elesisEndurance){
    if(usesPvpEquipmentFormulas(b))this.recoverHitResources(b,data,'received',receivedPvp,{swordMultiplier:swordReceivedMp});
    else {
      b.mp=clamp(b.mp+receivedMpGain(b,data,this.state.step,guildGainModifiers(b),receivedPvp)*swordReceivedMp,0,b.mpMax);
      this.addCharge(b,this.profileFor(b).referenceSemantics.awakening.onReceivedBase,'received');
    }}
    const timeRingRevived=tryAddTimeRingRevive(this,b);
    const ownerStop=attackerHitStopOverride(data,{kind:origin.kind??'character'});
    if(ownerStop){resetActorStopCache(a);requestActorStop(a,'hit',ownerStop.stopTime,b.id);requestActorStop(a,'world',0,b.id);}
    else if(!attackerHitStopExcluded(data,{kind:origin.kind??'character'})&&Number.isFinite(data.STOP_TIME_ATT??data.STOP_TIME_ATK))
      requestActorStop(a,'hit',data.STOP_TIME_ATT??data.STOP_TIME_ATK,b.id);
    const receivedStop=defenderHitStopOverride(data,{superArmor:b.superArmor});
    if(receivedStop&&!elesisBreak&&!elesisEndurance){resetActorStopCache(b);requestActorStop(b,'hit',receivedStop.stopTime,a.id);requestActorStop(b,'world',0,a.id);}
    b.lastAttackerFront=fromFront;
    if(!elesisBreak&&!elesisEndurance){b.flyCount=nextFlyCount(b.flyCount,data,{superArmor:b.superArmor});manaBreakDamageReact(b,data);}
    a.knockdown=resetAttackerKnockdown(a.knockdown);
    if(!elesisBreak&&!elesisEndurance&&isDamagedReaction(data)&&!data.NO_DAMAGE)b.knockdown=reserveKnockdown(b.knockdown,forceDownContribution(data)*(b.passivePolicy?.elesis?.rawValues?.[28404]?.SA_FORCE_DOWN_GAIN_REL??1));
    if(guarded){
      // Source DamageReact11396 does not re-enter/consume while CanParrying.
      if(!b.core.canParry){
        this.enter(b,data.REACT_TYPE===1?'RSI_PARRYING_SMALL':S.parry,'nasod-guard',{directChange:true});
        const result=evaluateNasod(this.nativeNasod,'start',nasodSnapshot(b,{random:Math.floor(this.rng()*32768)}));
        applyNasodResult(b,result);b.core.phase='guard';b.core.phaseTime=0;b.core.animationName='Guard';b.core.animationTime=0;
        b.core.targetId=null;b.core.hit=false;b.core.attackLevel=0;
        if(result.smallCharacterAnimation)b.animationName='GuardSmallFront';
        if(result.soundCalls)this.emit('sound',b.id,{name:'Raven_NasodCore_Trans_Parry.ogg',...sourceSoundEventMetadata(b)});
        this.emit('coreGuardStarted',b.id,{sourceActorId:a.id,state:b.state,gauge:b.core.gauge,level:b.core.level,
          helper:clone(b.core.helper),source:NASOD_GUARD_SOURCE.start});
      }
      this.spawnNasodGuardFx(b);
      this.emit('sound',b.id,{name:'Raven_NasodCore_Guard.ogg',...sourceSoundEventMetadata(b)});
      this.emit('coreGuard',b.id,{sourceActorId:a.id,damageMultiplier:.25,canParry:b.core.canParry,remaining:b.core.guardRemaining,
        gauge:b.core.gauge,level:b.core.level,source:NASOD_GUARD_SOURCE.reaction});
    }
    let manaBuffApplied=false;
    if(lkGuarded){this.enter(b,amount<b.hpMax*.1?'ESSI_SI_P_ESK_AUTO_GUARD_SMALL':'ESSI_SI_P_ESK_AUTO_GUARD','lk-auto-guard');
      this.emit('lkAutoGuard',b.id,{attackerId:a.id,damage:amount});}
    if (!guarded&&!lkGuarded&&!destructionRage&&!addBarrier&&!elesisBreak&&!elesisEndurance) {
      const canRevenge=data.CAN_REVENGE!==0&&data.CAN_REVENGE!==false;
      const limitState=b.limitCrusherCharging===true?(this.nativeCritical?.limitRevenge?.({charging:true,canRevenge})??
        (canRevenge?'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK':'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK')):null;
      if(limitState){
        this.enter(b,limitState,'original-limit-charge-reaction');
        this.emit('limitChargeReaction',b.id,{canRevenge,state:limitState,source:'fixed-V5 GUUser11469-11480; target runtime pending'});
      }else{
      const heightAboveLand=this.reactionHeightAboveLand(b),ownerHeightAboveLand=this.reactionHeightAboveLand(a);
      const pickupOwner=this.hasNasod(a)?rfGroundPickupOwner({actor:a,origin,data,
        effect:origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null,
        ownerHeightAboveLand,victimHeightAboveLand:heightAboveLand,lineRadius:this.profileFor(a).referenceSemantics.lineRadius}):null;
      let reaction=selectHitReaction(data,{grounded:b.grounded,fromFront,flyCount:b.flyCount,
        superArmor:b.superArmor,
        heightAboveLand,attackerUnitHeightAboveLand:origin.kind==='character'?ownerHeightAboveLand:pickupOwner?.heightAboveLand??Infinity,
        lineRadius:this.profileFor(b).referenceSemantics.lineRadius,walkSpeed:this.profileFor(b).physics.WALK_SPEED,
        localVx:b.vx*b.facing,vy:b.vy});
      reaction=bladeMasterReaction(this,a,b,data,origin,reaction);
      // All six jump-Z declarations already collide. Near-floor Small/Big
      // selection retained falling speed and lost the user's airborne catch.
      // Scope this policy to descending airborne victims of the jump-Z body.
      if(origin.kind==='character'&&origin.state==='RSI_JUMP_COMBO_Z'&&!b.grounded&&b.vy<=0&&
        ['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK','RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK'].includes(reaction.state))
        reaction={...reaction,state:'RSI_DAMAGE_AIR_SMALL',vy:data.BACK_SPEED_Y??0,grounded:false};
      if(this.nativeManaBreak&&isDamagedReaction(data)&&b.manaBreak.charge>=b.manaBreak.minimumCharge&&data.BUFF_FACTOR&&b.hp>0){
        // User8442 applies hit factors before its12011 Mana/down tail. Correct
        // this affected path so down StateStart clears this hit's new stun too.
        const sk=this.skill(origin.skillId??a.skillId,a);
        this.grantBuff(a,b,data.BUFF_FACTOR,sk?.maxLevel??1,origin.traitPolicy);manaBuffApplied=true;
      }
      const mana=this.nativeManaBreak&&isDamagedReaction(data)?reserveManaBreak(this.nativeManaBreak,b,{
        grounded:b.grounded,fromFront,backY:data.BACK_SPEED_Y??0,damageType:data.DAMAGE_TYPE??0}):{triggered:false};
      // An ordinary RT_DOWN resets KD; a Mana Break reserves its independent
      // down without consuming KD, including when this hit declares RT_DOWN.
      if(data.REACT_TYPE===3&&!b.superArmor&&!mana.triggered)b.knockdown.now=0;
      const check=isDamagedReaction(data)&&!mana.triggered&&!standup.noDown&&!elesisNoDownHit(this,a,data,origin)?requestKnockdown(b.knockdown):{gauge:b.knockdown,triggered:false};b.knockdown=check.gauge;
      if(mana.triggered){
        // V61 supersedes the old immediate-down project preset: retain this
        // hit's reaction while the source .7 stop runs, apply down on resume.
        requestActorStop(b,'hit',mana.hitStop,a.id);
        this.emit('manaBreakTriggered',b.id,{cost:mana.cost,state:mana.state,knockdown:b.knockdown.now,source:MANA_BREAK_SOURCE,
          impactEffect:mana.impactEffect?{name:'RevengeImpactTick',position:origin.impactPoint??null}:null});
      }
      if(check.triggered){reaction={...reaction,...knockdownThresholdReaction({grounded:reaction.grounded,fromFront,vy:reaction.vy})};
        this.emit('knockdownTriggered',b.id,{now:b.knockdown.now,max:b.knockdown.max,evidence:REACTION_REFERENCE.evidence});}
      if(reaction.state){
        b.vx=reaction.localVx*b.facing;b.vy=reaction.vy;
        b.grounded=reaction.grounded;if(!b.grounded)b.lineId=null;
        this.enter(b,reaction.state,mana.triggered?'mana-break':'hit-reaction',{directChange:true});
        if(pickupOwner&&!mana.triggered&&!check.triggered&&!b.superArmor)this.emit('nearGroundMeleePickup',a.id,{
          targetId:b.id,effectId:origin.id,adapter:pickupOwner.adapter,heightAboveLand,ownerHeightAboveLand,
          state:reaction.state,evidence:pickupOwner.evidence});
      }else if(!reaction.supported)this.note('reaction:'+reaction.unsupportedType,'Unimplemented target reaction type; no guessed successor',b);
      if(mana.triggered)holdManaBreakDown(b,mana);
      }
    }
    if(destructionRage&&b.hp>0&&![6,17].includes(data.REACT_TYPE))startDestructionRage(this,b);
    if(b.hp>0&&(elesisBreak||elesisEndurance))startElesisBurst(this,b,{chivalry:elesisBreak});
    if(origin.sourceAddSummonSerial===undefined)this.coreOnHit(a,b,data,origin);
    if(origin.kind==='effect'&&origin.impactPoint){const parent=this.state.effects.find(e=>e.id===origin.id);
      if(parent)parent.lastImpactPoint=[...origin.impactPoint];}
    // The attacker's original byte increment follows its explosion/BF437
    // feedback below; the receiving unit owns its independent counter here.
    // RT_DUMMY_DAMAGE is excluded by the attacker's GetHitCount, while the
    // acquired defender HittedCount path still counts accepted dummy contact.
    if(!elesisBreak&&!elesisEndurance)b.buffs=consumeBuffHit(this.profileFor(b),b.buffs,{kind:'received'}).buffs;
    infinitySwordOnHit(this,a,b,data);
    elesisSwordOnHit(this,a,data);
    elesisOnHit(this,a,b,data,amount,{...origin,elesisSwordState});
    if(!elesisBreak&&!elesisEndurance&&isDamagedReaction(data)&&!data.NO_DAMAGE){
      const recovery=startGuildRecovery(b,{damage:amount,random:()=>this.rng()});
      if(recovery)this.emit('guildRecoveryTriggered',b.id,recovery);
    }
    if(!elesisBreak&&!elesisEndurance&&data.BUFF_FACTOR&&b.hp>0&&!manaBuffApplied){const skill=this.skill(origin.skillId??a.skillId,a);
      this.grantBuff(a,b,data.BUFF_FACTOR,skill?.maxLevel??1,origin.traitPolicy);}
    if(!elesisBreak&&!elesisEndurance&&origin.sourceBuffFactor&&b.hp>0)this.grantBuff(a,b,origin.sourceBuffFactor,this.skill(origin.skillId,a)?.maxLevel??1,origin.traitPolicy);
    const relativeBuffLearned=data.RELATIVE_SKILL_LEARN_CHECK!==1||Boolean(a.passivePolicy?.skillLevels?.[data.BUFF_FACTOR_RELATIVE_SKILL_ID]);
    if(!elesisBreak&&!elesisEndurance&&data.BUFF_FACTOR_ID&&b.hp>0&&relativeBuffLearned){const skill=this.skill(data.BUFF_FACTOR_RELATIVE_SKILL_ID??origin.skillId??a.skillId,a);
      for(const factorId of array(data.BUFF_FACTOR_ID))this.grantBuff(a,b,factorId,skill?.maxLevel??1,origin.traitPolicy);}
    if(!elesisBreak&&!elesisEndurance){
      elesisHitFinalized(this,a,b,data,origin);
      const moonlight=addMoonlightHitParameters(this,a,b,data,origin);
      if(moonlight)finalizeAddMoonlightContact(this,a,b,data,origin,moonlight);
    }
    let effectFeedbackDispatched=false;
    if(a.passivePolicy){
      const extra=passiveOnHit(a.passivePolicy,{damageData:data,random:()=>this.rng(),
        hitKind:origin.kind==='effect'?'effect':'melee',impactPoint:origin.impactPoint});
      if(extra.additionalDamageEffect){
        const request=extra.additionalDamageEffect;
        const selfBuff=explodingHandSelfBuff(a.passivePolicy,extra);
        if(selfBuff)this.grantBuff(a,a,selfBuff.factorId,selfBuff.skillLevel,null);
        if(request.impactPoint){const effect=this.createEffect(a,{NAME:request.name},{birthAnchor:{position:request.impactPoint,facing:a.facing}});
          // The original additional-hit callback creates its own power1 effect.
          // It is neither a child of the current cast nor entitled to whichever
          // active trait the owner selected while the triggering hit was in flight.
          effect.powerMultiplier=request.powerRate;effect.skillId=request.skillId;effect.traitPolicy=null;
          effectFeedbackDispatched=true;
          this.emit('additionalHitEffectCreated',a.id,{effectId:effect.id,name:request.name,trigger:request.trigger,
            passiveSkillId:request.skillId,position:clone(request.impactPoint),powerRate:request.powerRate,
            buffFactorUnsupported:null,evidence:request.evidenceClass});}
        else this.note('exploding-hand-impact-missing','Original additional damage effect requires native impact point; no guessed position',a);
      }
    }
    if(origin.sourceAddSummonSerial===undefined){
      const count=passiveBuffHitCount(data);a.sourceHitCountByte=((a.sourceHitCountByte??0)+count)&255;
      a.buffs=consumeBuffHit(this.profileFor(a),a.buffs,{kind:'hit',count,targetActor:a}).buffs;
    }
    bladeMasterAcceptedHit(this,a,b,data,amount,{...origin,effectFeedbackDispatched},fromFront);
    synchronizeStunState(this,b);
    if(timeRingRevived){
      b.knockdown.now=0;b.vx=0;
      this.enter(b,b.grounded?'RSI_DAMAGE_DOWN_FRONT':'RSI_DAMAGE_AIR_DOWN','add-time-ring-revive',{directChange:true});
    }
    if (!b.hp) { endMaximumStrike(this,b,{refund:true,reason:'death'});b.death = true;this.emit('death',b.id,{killerId:a.id});
      const fatal=deathState({hp:b.hp,grounded:b.grounded,fromFront});if(fatal&&!deathStates.has(b.state))this.enter(b,fatal,'fatal-hit');
    }
    this.emit('hit',a.id,{targetId:b.id,amount,guarded,critical:critical?.critical===true,hp:b.hp,mp:a.mp,origin,data:clone(data),deleteDamageReactEffects,
      criticalFx:critical?.critical&&critical.effectPosition?{name:'CriticalHit01',position:critical.effectPosition}:null,
      damageNumber:damageNumberAnchor?{position:[...damageNumberAnchor],style:critical?.red?'red':'normal'}:null,
      validation:equipmentFormula?`${a.formulaRules.version}; fixed-source PvP candidate; no target-client measurement`:
        'historical prototype-zero-defense formula; no target-client measurement'});
    return { accepted:true,amount,guarded };
  }
  createReactionEffect(a,b,data,origin){
    if(!b.superArmor&&(data.STOP_TIME_DEF??0)>0)requestActorStop(b,'hit',data.STOP_TIME_DEF,a.id);
    const parent=origin.kind==='effect'?this.state.effects.find(e=>e.id===origin.id):null;
    if(parent)parent.lastImpactPoint=origin.impactPoint;
    this.emit('effectContact',a.id,{targetId:b.id,origin:clone(origin),data:clone(data)});
    // Only the attack owner creates identities. The receiving defender still
    // runs its stop-time branch, and later receives the owner's real child.
    if(this.networkOwnerId!==null&&a.id!==this.networkOwnerId){
      // Playback contacts are evaluated at the receiving owner's current
      // collider/protection. A source's notice cannot install this Debuff.
      if(this.networkCombatPlaybackVersion===1&&b.id===this.networkOwnerId&&data.REACT_TYPE===11)
        addDroneMarkContact(this,a,b,parent);
      return {accepted:true,amount:0,effectTrigger:true};
    }
    const first=this.state.nextEffectId,anchor=parent?.currentAnchor??parent?.birthAnchor;
    if(data.REACT_TYPE===11&&origin.impactPoint){
      if(!this.profileFor(a).damageEffects[data.CREATE_DAMAGE_EFFECT_NAME]){this.note('reaction-effect:'+data.CREATE_DAMAGE_EFFECT_NAME,'Required original impact damage declaration unavailable',a);return {accepted:false,reason:'missing-impact-declaration'};}
      const rotation=anchor?.rotation??[0,a.facing<0?180:0,0];
      this.createEffect(a,{NAME:data.CREATE_DAMAGE_EFFECT_NAME},{parentEffectId:parent?.id??null,
        sourceLandY:parent?.sourceDamageLandY??a.landPosition?.[1],
        birthAnchor:{position:[...origin.impactPoint],facing:anchor?.facing??a.facing,rotation:[...rotation]}});
    }else if(data.REACT_TYPE===12)this.spawnSet(a,data.CREATE_EFFECT_SET_NAME);
    else return {accepted:false,reason:'missing-original-impact'};
    for(const e of this.state.effects)if(e.id>=first){
      e.powerMultiplier=origin.powerMultiplier??1;e.skillId=origin.skillId??a.skillId;e.traitPolicy=clone(origin.traitPolicy??null);
      inheritAddSummonEffectState(parent,e);
      if(data.REACT_TYPE===12&&data.CREATE_EFFECT_SET_TRACE_UNIT===1){e.traceActorId=b.id;e.traceUnitDieDelete=data.TRACE_UNIT_DIE_DELETE_EFFECT_SET===1;}
      this.emit('reactionEffectCreated',a.id,{effectId:e.id,parentEffectId:parent?.id??null,name:e.name,targetId:b.id,
        position:origin.impactPoint,powerMultiplier:e.powerMultiplier,reactType:data.REACT_TYPE,
        evidence:'fixed-V5 GUUser7932/AttackResult + DamageEffect3861-3930; target2016 declaration'});
    }
    if(data.REACT_TYPE===12)bindAddCountdownShake(this.state.effects.filter(e=>e.id>=first&&e.ownerId===a.id),b);
    if(data.REACT_TYPE===11){addDroneMarkContact(this,a,b,parent);addFantasyTracerAcceptedHit(this,a,b,data,origin);}
    return {accepted:true,amount:0,effectTrigger:true};
  }
  /** Explicit Miss entry remains available to source fixtures. The recovered
   * target2016 callback also runs for accepted ordinary contacts. */
  processGuildMiss(attackerId,targetId){
    return this.processGuildContact(this.actor(attackerId),this.actor(targetId));
  }
  processGuildContact(a,b){
    if(!a||!b||a.team===b.team||a.hp<=0||b.hp<=0)return [];
    const buffs=[];
    for(const owner of [a,b]){
      const request=guildCriticalCounterRequest(owner);if(!request)continue;
      const buff=this.grantBuff(owner,owner,request.factorId,request.skillLevel,null);
      if(buff)buffs.push({actorId:owner.id,templateId:buff.templateId});
    }
    return buffs;
  }
  grantBuff(source,target,factor,skillLevel=1,traitPolicy=source.skillContext?.traitPolicy){
    if(!this.nativeSkillValues){this.note('buff-native-math-missing','Buff requires the original numeric/interval module',target);return null;}
    const raw=typeof factor==='number'?this.profileFor(source).buffFactors?.[factor]?.raw:factor?.raw??factor;
    const transformed=skillTraitBuffFactor(raw,traitPolicy);
    const result=createBuffFromFactor(this.profileFor(source),{factor:transformed,sourceFactorId:typeof factor==='number'?factor:null,skillLevel,sourceActor:source,targetActor:target,
      roll:this.rng(),nativeValues:this.nativeSkillValues});
    if(!result.supported){this.note('buff-factor:'+JSON.stringify(factor),'Unsupported original buff factor: '+result.unsupported.map(v=>v.reason).join('; '),target);return null;}
    if(!result.accepted)return null;
    if(this.networkOwnerId!==null&&target.id!==this.networkOwnerId){
      // Predict only the immediate source MP text. Keep the established
      // remote-resource projection below; actual MP belongs to the defender.
      if(result.buff.templateId===98){
        const cosmetic=tickBuffs(this.profileFor(source),[result.buff],1/60,{targetActor:target,nativeValues:this.nativeSkillValues});
        for(const effect of cosmetic.effects)if(effect.kind==='mpDelta'&&effect.drawText&&effect.delta<0){
          const anchor=this.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01_Head',POSITION_OFFSET_Y:-50}},target)?.position;
          if(anchor)this.emit('observedBuffMpChanged',target.id,{delta:effect.delta,drawText:true,templateId:effect.templateId,
            resourceNumber:{resource:'mp',style:'red',position:[...anchor],percent:effect.templateId===98&&target.mpMax>0?Math.round(effect.delta/target.mpMax*100):null},presentationOnly:true,inference:'client-contact-estimate'});
        }
      }
      // Full legacy reports and compact observers can both predict another
      // application before its next source packet. Project the existing and
      // incoming remote-only resource rows together; never weaken the native
      // merge's kind/accumulation checks or touch the local owner's formulas.
      target.buffs=target.buffs.map(projectRemoteBuffResources);
      result.buff=projectRemoteBuffResources(result.buff);
    }
    const previousArmor=target.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor'));
    const previous=target.buffs.find(b=>b.templateId===result.buff.templateId),reapply=!!previous;
    target.buffs=mergeBuffs(this.profileFor(source),target.buffs,result.buff);
    synchronizeBuffStats(target);
    const controls=buffControls(target.buffs);
    target.buffControls={inputBlock:controls.inputBlock,dashBlock:controls.dashBlock};
    synchronizeStunState(this,target,{applied:result.buff.behaviors.some(row=>row.kind==='stun')});
    this.refreshOwnedBuffProtection(target,{previousArmor});
    const merged=target.buffs.find(b=>b.templateId===result.buff.templateId),displaySets=buffDisplaySets(merged);
    const displayChanged=reapply&&JSON.stringify(buffDisplaySets(previous))!==JSON.stringify(displaySets);
    if(displayChanged)for(const effect of this.state.effects)if(effect.ownerId===target.id&&effect.buffTemplateId===merged.templateId){
      effect.dead=true;effect.endReason='buff-accumulation-display-change';
    }
    if(!reapply||displayChanged)for(const set of displaySets){
      if(!this.profileFor(target).effectSets[set]){this.note('buff-displayer-source-closure:'+set,'Original buff display set is absent from the victim profile; shared target buff display closure is required',target);continue;}
      const first=this.state.nextEffectId;this.spawnSet(target,set);
      const display=this.state.effects.filter(effect=>effect.id>=first);
      for(const effect of display)effect.buffTemplateId=result.buff.templateId;
      lordKnightCastDisplayClock(this,target,set,display);
    }
    if(result.buff.displayer.BDT_RENDER_PARAM)this.note('buff-render-param:'+result.buff.templateId,'Original COLOR native constructor is unresolved; particle displayer retained without guessed body tint',target);
    this.emit('buffApplied',source.id,{targetId:target.id,templateId:result.buff.templateId,skillLevel,reapply,
      validation:'target fields + fixed-V5 native math; target runtime pending'});
    lordKnightDebuffApplied(this,source,target,result.buff);
    elesisDebuffApplied(this,source,target,result.buff);
    phantomSwordSync(this,target);
    return merged;
  }
  refreshOwnedBuffProtection(a,{previousArmor}={}){
    if(this.networkOwnerId===null||a?.id!==this.networkOwnerId||a!==this.actor(this.networkOwnerId))return;
    const armor=a.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor'));
    const prior=previousArmor===true||this.ownedBuffArmor.get(a)===true;
    this.ownedBuffArmor.set(a,armor);
    // Actors with no Buff armor keep their existing locally computed flags.
    // In particular, this path cannot clear a current invincibility window.
    if(!armor&&!prior)return;
    const raw=this.profileFor(a).states[a.state].raw;
    const protection=evaluateStateProtection(raw,a.animationTime,stateProtectionOptions(this.presetFor(a),a,
      {forceInvincible:a.forceInvincible,initial:a.stateTime===0&&a.animationTime===0}));
    a.superArmor=protection.superArmor;a.superArmorNotRed=protection.superArmorNotRed;
    if(a.skillSuperArmorNotRed!==undefined)a.superArmorNotRed=a.skillSuperArmorNotRed;
    preserveDestructionArmor(a);
  }
  advanceActorBuffs(a,dt){
    const previousArmor=a.buffs.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor'));
    if(!a.buffs.length){
      a.buffControls={inputBlock:false,dashBlock:false};synchronizeStunState(this,a);this.refreshOwnedBuffProtection(a);return;
    }
    const result=tickBuffs(this.profileFor(a),a.buffs,dt,{targetActor:a,nativeValues:this.nativeSkillValues,
      advanceIntervals:this.networkOwnerId===null||a.id===this.networkOwnerId,
      advanceHyperFinalizer:this.networkOwnerId===null||a.id===this.networkOwnerId});
    a.buffs=result.buffs;a.buffControls={inputBlock:result.inputBlock,dashBlock:result.dashBlock};
    // Apply original HP sink order; a DOT cannot heal/revive a unit killed by
    // an earlier behavior in this update. No hit reaction or KD is fabricated.
    for(const effect of result.effects){
      // Observers advance Buff presentation clocks; only the unit's owner
      // applies HP/MP. Restoring remote HP after a tick cannot undo a death
      // animation or death event already emitted by speculative DOT damage.
      if(this.networkOwnerId!==null&&a.id!==this.networkOwnerId&&['hpDelta','mpDelta','knockdownDelta'].includes(effect.kind))continue;
      if(effect.kind==='hpDelta'&&(!effect.applyIfHpPositive||a.hp>0)){
        a.hp=clamp(a.hp+effect.delta,0,a.hpMax);this.emit('buffHpChanged',a.id,{...effect,hp:a.hp});
      }else if(effect.kind==='mpDelta'&&a.hp>0){
        const anchor=effect.drawText&&effect.delta<0?this.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01_Head',POSITION_OFFSET_Y:-50}},a)?.position:null;
        a.mp=clamp(a.mp+effect.delta,0,a.mpMax);this.emit('buffMpChanged',a.id,{...effect,mp:a.mp,
          resourceNumber:anchor?{resource:'mp',style:'red',position:[...anchor],percent:effect.templateId===98&&a.mpMax>0?Math.round(effect.delta/a.mpMax*100):null}:null});
      }else if(effect.kind==='knockdownDelta'&&a.hp>0){
        a.knockdown.now=Math.max(0,a.knockdown.now+effect.delta);this.emit('buffKnockdownChanged',a.id,{...effect,knockdown:a.knockdown.now});
      }else if(effect.kind==='buffFinished'){
        for(const e of this.state.effects)if(e.ownerId===a.id&&e.buffTemplateId===effect.templateId){e.dead=true;e.endReason='buff-finished';}
        this.emit('buffFinished',a.id,{templateId:effect.templateId});
      }
    }
    // The known relation-SELF stat consumers are explicit candidates. Keep
    // base attributes separate so a reapply/expiration cannot compound them.
    synchronizeBuffStats(a);
    synchronizeStunState(this,a);
    this.refreshOwnedBuffProtection(a,{previousArmor});
    if(a.hp<=0&&!a.death){a.death=true;this.emit('death',a.id,{source:'buff-hp'});
      const fatal=deathState({hp:a.hp,grounded:a.grounded,fromFront:a.lastAttackerFront});
      if(fatal&&!deathStates.has(a.state))this.enter(a,fatal,'fatal-buff');}
  }
  floorY(a){
    let floor=-Infinity;
    for(const line of this.map.lines)if(withinLine(line,a.x)){const y=lineY(line,a.x);if(y<=a.y+.01&&y>floor)floor=y;}
    return floor;
  }
  reactionHeightAboveLand(a){
    // DamageReactStateChange reads UnitCondition.landPosition. A remote-depth,
    // disabled or wall line sharing X must not change the reaction branch.
    return a.y-(a.landPosition?.[1]??this.floorY(a));
  }
  /** Internal research fixture API. Do not expose it through public match input. */
  injectHit({attackerId,targetId,damageData}) {
    this.emit('fixtureHitInjection',attackerId,{targetId}); return this.applyHit(this.actor(attackerId),this.actor(targetId),clone(damageData),{kind:'fixture',powerMultiplier:1});
  }
  recoverHitResources(a,data,kind,pvpGains,{originKind='character',traitMultiplier=1,swordMultiplier=1}={}){
    if(!consumePvpResourceFrame(a,data,this.state.step,{kind,originKind}))return;
    const guild=guildGainModifiers(a);
    const passive=kind==='hit'?modifyHitMpGain(a.passivePolicy,{base:1,attackType:data.ATTACK_TYPE}):
      1+(a.passivePolicy?.skillLevels?.[24404]?a.passivePolicy.received.unresolvedMpGainField:0);
    const gainMultiplier=kind==='hit'?passive*traitMultiplier*guild.onHitMpMultiplier*swordMultiplier*(a.stats[originKind==='effect'?'hitRangeMpMultiplier':'hitMeleeMpMultiplier']??1):
      passive*guild.receivedMpMultiplier*(pvpGains.receivedMpMultiplier??1)*swordMultiplier*(a.stats.receivedMpMultiplier??1);
    a.mp=clamp(a.mp+pvpMpGain({kind,hitAddMp:data.HIT_ADD_MP??0,outnumbered:pvpGains.outnumbered??0,
      equipmentMpGainBonus:a.equipmentAttributes.mpGainBonus??0,gainMultiplier:gainMultiplier*addHitMpMultiplier(a,data,kind,{profile:this.profileFor(a)})}),0,a.mpMax);
    if(pvpAwakeningEligible(data,kind)){
      const base=this.profileFor(a).referenceSemantics.awakening[kind==='hit'?'onHitBase':'onReceivedBase'];
      this.addCharge(a,pvpAwakeningGain(a,kind,base,guild,pvpGains),kind,{finalAmount:true});
    }
  }
  addCharge(a, amount, kind, {finalAmount=false}={}) {
    if(isAddActor(a))return;
    if (a.awakening.orbs >= 3) return;
    const factor=finalAmount?1:awakeningChargeMultiplier(a,kind,guildGainModifiers(a));
    a.awakening.gauge += amount*factor;
    while (a.awakening.gauge >= 100 && a.awakening.orbs < 3) { a.awakening.gauge -= 100; a.awakening.orbs++; this.emit('awakeningOrbCharged',a.id,{orbs:a.awakening.orbs}); }
    if (a.awakening.orbs === 3) a.awakening.gauge = 0;
  }
  applyWayOfSwordDelta(a,delta,kind){
    if(delta===null)return;
    const change=advanceWayOfSword(this.profileFor(a),a.wayOfSword,delta);
    if(change){this.emit('wayOfSwordChanged',a.id,{kind,...change});(isElesisProfession(a.professionId)?synchronizeElesisSword:synchronizeWayOfSwordPresentation)(this,a,change);}
  }
  prepareWayOfSword(actorId,mode){
    const a=this.actor(actorId);
    if(!a?.wayOfSword||![-2,0,2].includes(mode))throw new TypeError('LK practice Way of Sword mode must be -2, 0 or 2');
    const fields=wayOfSwordFields(this.profileFor(a)),point=mode===2?fields.Const_VigorStateThreshold:mode===-2?fields.Const_DestStateThreshold:0;
    this.applyWayOfSwordDelta(a,point-a.wayOfSword.point,'practice-prepare');
    return clone(a.wayOfSword);
  }
  reconcileWayOfSwordResources(a,before,kind='resource-restore'){
    if(!a?.wayOfSword||!before)return;
    const after=clone(a.wayOfSword),change={before:clone(before),after,delta:Math.fround(after.point-before.point),
      evidenceClass:'explicit web resource restoration; target2016 lifecycle consumer'};
    this.emit('wayOfSwordChanged',a.id,{kind,...change});
    (isElesisProfession(a.professionId)?synchronizeElesisSword:synchronizeWayOfSwordPresentation)(this,a,change);
  }
  activateAwakening(a) {
    if(isAddActor(a)){if(activateAddFormation(a,{profile:this.profileFor(a),emit:(...args)=>this.emit(...args)}))addCoreFormationBuffs2016(this,a);return;}
    const count = a.awakening.pendingOrbs; if (!count) return;
    const reawakening=a.awakening.reawakening===true;
    if(isVeteran(this,a))a.mp=clamp(a.mp+a.passivePolicy.veteran.awakeningMp,0,a.mpMax);
    const availableOrbs=a.awakening.pendingAvailableOrbs||count,wasFull=a.awakening.full===true;
    const plan=awakeningDurationPlan(a.passivePolicy,{alreadyAwakened:reawakening,orbs:count,availableOrbs,baseSeconds:this.profileFor(a).components.MAX_HYPER_MODE_TIME,equipmentDurationBonus:a.equipmentAttributes?.awakeningDurationBonus??0});
    a.awakening.pendingOrbs = 0;a.awakening.pendingAvailableOrbs=0;a.awakening.reawakening=false;
    a.awakening.remaining=(reawakening?a.awakening.remaining:0)+plan.addedSeconds;
    // Target/user-confirmed upgrade differs from the acquired old V5 Buff,
    // which retains the first activation count. Never downgrade an active
    // electric field on subsequent one/two-bead reawakening.
    a.awakening.full=reawakening?(wasFull||availableOrbs===3):availableOrbs===3;
    if(!this.hasNasod(a)){
      this.emit('awakeningStarted',a.id,{orbs:count,availableOrbs,full:a.awakening.full,duration:a.awakening.remaining,remaining:a.awakening.remaining,addedSeconds:plan.addedSeconds,validation:'target2016 Elsword MAX_HYPER_MODE_TIME with shared source-consumer candidate; target-client-unmeasured'});
      return;
    }
    const coreBefore=a.core.gauge,coreRules=this.profileFor(a).referenceSemantics.core;
    // Fixed Raven::HyperModeBuffEffectStart adds 40 independently of bead
    // count; CreateNasodBall reads the resulting gauge level, not the beads.
    // Reawakening +2 remains the separately user-confirmed target adaptation.
    const coreAdded=reawakening?coreRules.gaugePerLevel*(a.passivePolicy?.awakening.reawakenCoreLevelsAdded??2):coreRules.activationGauge;
    a.core.gauge=clamp(a.core.gauge+coreAdded,0,coreRules.gaugeMax);this.updateCoreLevel(a);
    if(!reawakening||a.core.phase==='absent'){a.core.phase='idle';a.core.phaseTime=0;a.core.animationName='Wait';a.core.animationTime=0;}
    this.emit(reawakening?'reawakenCoreRefill':'awakeningStarted',a.id,{orbs:count,availableOrbs,full:a.awakening.full,duration:a.awakening.remaining,
      remaining:a.awakening.remaining,addedSeconds:plan.addedSeconds,coreGauge:a.core.gauge,coreGaugeBefore:coreBefore,coreGaugeAdded:a.core.gauge-coreBefore,
      coreEvidence:reawakening?'user-confirmed +2 levels; fixed-V5 +40 consumer; target2016 descriptor differs': 'fixed-V5 HyperModeBuffEffectStart +40 candidate',validation:plan.evidenceClass});
    if(a.awakening.full&&(!reawakening||!wasFull)){
      const first=this.state.nextEffectId;this.spawnSet(a,'EffectSet_RAVEN_HYPER_AURA',1,[]);
      // Keep the original EffectSet identity even if the combat record retires;
      // its presentation parent must still receive StopEffectSet at buff end.
      a.sourceAwakeningAuraEffectGroup=this.state.effects.filter(e=>e.id>=first&&e.ownerId===a.id&&e.setName==='EffectSet_RAVEN_HYPER_AURA')
        .map(e=>({id:e.id,name:e.name,setName:e.setName}));
      this.emit('coreAuraStarted',a.id,{});
    }
  }
  expireAwakening(a,reason='duration-expired') {
    if(isAddActor(a)){stopAddFormation(a,{profile:this.profileFor(a),reason,force:true,emit:(...args)=>this.emit(...args)});return;}
    if(!this.hasNasod(a)){
      a.awakening.remaining=0;a.awakening.full=false;
      if(reason==='death-animation-end'){a.awakening.pendingOrbs=0;a.awakening.pendingAvailableOrbs=0;a.awakening.reawakening=false;}
      this.emit('awakeningEnded',a.id,{reason,position:[a.x,a.y,a.z],hp:a.hp,mp:a.mp,restoredHp:0,restoredMp:0});
      return;
    }
    const gauge = Math.fround(a.core.gauge),hpBefore=a.hp,mpBefore=a.mp,coreLevelBefore=a.core.level;
    const wasFull=a.awakening.full===true;
    const returned=awakeningCoreReturnPlan({gauge,hp:a.hp,mp:a.mp,hpMax:a.hpMax,mpMax:a.mpMax});
    a.hp=returned.hp;a.mp=returned.mp;
    a.awakening.remaining=0;a.awakening.full = false; a.core.gauge = 0; a.core.level = 0; a.core.phase = 'absent'; a.core.targetId = null;
    a.core.guardRemaining=0;a.core.canParry=false;a.core.parrying=false;a.core.helperLive=false;
    // ClearNasodBall resets both request and flight clocks/flags at expiry.
    a.core.attackElapsed=0;a.core.delayElapsed=0;a.core.phaseTime=0;a.core.dirSpeed=0;a.core.useManualDir=false;
    a.core.unlockRemaining=0;a.core.manualDirDegree=[0,0,0];a.core.animationName='Wait';a.core.animationTime=0;
    a.core.attackLevel=0;a.core.hit=false;a.core.hits={};a.core.hitGaps={};a.core.helper={...a.core.helper,attackTime:[0,0]};
    // Compatibility for pre-v17 snapshots that only retained a combat record.
    const aura=new Map((a.sourceAwakeningAuraEffectGroup??[]).map(e=>[e.id,e]));
    for(const e of this.state.effects)if(e.ownerId===a.id&&e.setName==='EffectSet_RAVEN_HYPER_AURA')aura.set(e.id,{id:e.id,name:e.name,setName:e.setName});
    a.sourceAwakeningAuraEffectGroup=[...aura.values()];
    this.stopSkillEffectGroup(a,'sourceAwakeningAuraEffectGroup','original-stop-effect-set');
    if(wasFull&&aura.size)this.emit('sound',a.id,{name:'Raven_ElectricAura_Disappear.ogg',...sourceSoundEventMetadata(a)});
    if(reason==='death-animation-end'){a.awakening.pendingOrbs=0;a.awakening.pendingAvailableOrbs=0;a.awakening.reawakening=false;}
    this.emit('awakeningEnded',a.id,{reason,position:[a.x,a.y,a.z],recalledGauge:gauge,recalledLevel:Math.floor(gauge/this.profileFor(a).referenceSemantics.core.gaugePerLevel),coreLevelBefore,
      hpBefore,mpBefore,hp:a.hp,mp:a.mp,requestedHp:returned.requestedHp,requestedMp:returned.requestedMp,
      restoredHp:returned.restoredHp,restoredMp:returned.restoredMp,returnEvidence:returned.evidenceClass});
  }
  updateCoreLevel(a) {
    if(!this.hasNasod(a))return;
    const c = a.core, before = c.level;
    // DoFrameMoveNasodBall14556 retains the consumed level during parry.
    if(c.parrying)return;
    c.level = clamp(Math.floor(c.gauge/20),0,5);
    c.helperLive=c.level>0;
    if(before===0&&c.level>0&&a.awakening.remaining>0)positionNasodIdle(c,a,arcLineBasis(a,this.map.lines),true);
    if(c.phase!=='attack'&&c.phase!=='prepare')c.helper={scale:Math.fround([0,1,1.3,1.6,1.9,2.2][c.level]),
      outlineColor:[1,Math.fround(.333),Math.fround(.0745),1],attackTime:[0,0],source:'GURaven:14195-14255'};
    if (a.awakening.remaining>0 && c.level!==before) {
      // V5 DoFrameMoveNasodBall recreates the mesh on a level transition.
      // Restore idle visibility after a spent core grows from zero again.
      if (c.phase==='absent' && c.level>0) {
        c.phase='idle'; c.phaseTime=0; c.animationName='Wait'; c.animationTime=0;
      } else if (c.phase==='idle' && !c.level) c.phase='absent';
      this.emit('coreLevelChanged',a.id,{before,level:c.level,gauge:c.gauge,source:'reference-v5 X2GURaven.cpp:14555'});
      this.emit('sound',a.id,{name:before===0?'Raven_NasodCore_Appear.ogg':c.level<before?'Raven_NasodCore_Shrink.ogg':'Raven_NasodCore_Grow.ogg',...sourceSoundEventMetadata(a)});
    }
  }
  coreOnHit(a,b,data,origin={}) {
    if(!this.hasNasod(a))return;
    if(a.hp<=0||b.hp<=0)return;
    if (a.awakening.remaining <= 0 || a.core.phase === 'attack') return;
    const c = a.core;
    if ((data.ATTACK_TYPE ?? 0) !== 1 && c.phase !== 'attack') {
      c.gauge = clamp(c.gauge+Math.max(data.DAMAGE?.PHYSIC??0,data.DAMAGE?.MAGIC??0)*(origin.powerMultiplier??1)*4,0,100); this.updateCoreLevel(a);
    }
    if (data.ATTACK_TRIGGER_TYPE === 1 && c.level > 0 && !['attack','prepare','guard'].includes(c.phase)) {
      const basis=arcLineBasis(a,this.map.lines);
      if(prepareNasodAttack(c,b.id,basis.rotation)){
        this.emit('coreAttackPrepared',a.id,{targetId:b.id,level:c.attackLevel,delay:.3,source:NASOD_ATTACK_SOURCE});
        this.emit('sound',a.id,{name:'Raven_NasodCore_Trans_Attack.ogg',...sourceSoundEventMetadata(a)});
      }
    }
  }
  canGuard(b,a,data,attackPosition=[a.x,a.y,a.z],fromFront) {
    if(b.hp<=0||!this.hasNasod(b)||data.IGNORE_STATE_DEFENCE)return false;
    // User.h GetFrameData() defaults to Now; common Now uses strict <radius.
    // Grounded is the distinct Future <1/downward predicate and is insufficient.
    const footOnLineNow=!!b.landPosition&&Math.abs(b.y-b.landPosition[1])<this.profileFor(b).referenceSemantics.lineRadius;
    return evaluateNasod(this.nativeNasod,'guard',nasodSnapshot(b,{damage:data,footOnLineNow,
      attackerFrontFuture:fromFront??attackerIsFront([b.x,b.y,b.z],attackPosition,[1,0,0],b.facing>0)})).guarded;
  }
  spawnNasodGuardFx(a){
    if(!this.hasNasod(a))return;
    const set=this.profileFor(a).effectSets.EffectSet_RAVEN_PARRING;
    // GUUser9004 + EffectSet2790: saved custom position wins over TRACE.
    // Fixed source does not face-flip this +line direction offset. Custom
    // rotation is literally the fourth argument [1,0,0], not a facing flag.
    const birthAnchor={position:[a.x+70,a.y+100,a.z],facing:1,rotation:[1,0,0],customPosition:true,
      evidence:'fixed-V5 GUUser9004/EffectSet2790; unit scale1 and +X line basis host boundary'};
    this.emit('effectSet',a.id,{name:'EffectSet_RAVEN_PARRING',timing:1,customPosition:clone(birthAnchor.position)});
    for(const [key,definition]of Object.entries(set.raw))if(/^EFFECT\d+$/.test(key))
      this.createEffect(a,definition,{setName:set.raw.NAME,clock:'custom',birthAnchor:clone(birthAnchor)});
  }
  tickCore(a,dt) {
    if(!this.hasNasod(a))return;
    if(a.hp<=0){a.core.phase='absent';return;}
    const c = a.core, r = this.profileFor(a).referenceSemantics.core;
    if (a.awakening.remaining <= 0 || a.hp <= 0) return;
    c.phaseTime += dt;
    // Global mesh is advanced before the next unit callback. This uses the
    // previous packet's direction; VectorLockOn below owns the next packet.
    if(c.phase==='attack'||c.phase==='prepare')advanceNasodMesh(c,dt);else c.animationTime+=dt;
    if (c.phase === 'guard' && !parryStates.has(a.state))restoreNasodHelper(a);
    if(c.phase==='idle'){
      positionNasodIdle(c,a,arcLineBasis(a,this.map.lines));
    }
    if (c.phase === 'guard') { c.x = a.x+a.facing*70; c.y = a.y+100; c.z = a.z; }
    if(c.phase==='prepare'||c.phase==='attack')c.attackElapsed=Math.fround((c.attackElapsed??0)+Math.fround(dt));
    if(c.phase==='prepare'&&!c.parrying)c.delayElapsed=Math.fround((c.delayElapsed??0)+Math.fround(dt));
    if (c.phase === 'prepare' && c.delayElapsed >= Math.fround(r.prepareSeconds)) {
      const b = this.contactActor(this.state.actors.find(b => b.id === c.targetId),a);
      if (!b || b.hp<=0) { restoreNasodHelper(a);c.dirSpeed=0;c.attackElapsed=0;c.delayElapsed=0;c.targetId=null;c.useManualDir=false;
        this.emit('coreAttackCancelled',a.id,{reason:'target-invalid'});return; }
      launchNasodAttack(c,{...arcLineBasis(a,this.map.lines),facing:a.facing});
      this.emit('coreAttackStarted',a.id,{targetId:b.id,level:c.attackLevel,source:NASOD_ATTACK_SOURCE});
      this.emit('sound',a.id,{name:'Raven_NasodCore_Attack.ogg',...sourceSoundEventMetadata(a)});
    }
    if (c.phase === 'attack') {
      const b = this.contactActor(this.state.actors.find(b => b.id === c.targetId),a);
      c.attackLevel=c.level;
      const position=[c.x,c.y,c.z],shapes=this.nasodAttackSampler?.(c,a)??[];
      if(!this.nasodAttackSampler)this.note('core-helper-missing','Core attack requires actual AttackN helper data; no target-center hit',a);
      if(c.attackLevel>0&&shapes.length){
        const raw=clone(this.profileFor(a).damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA);
        const power=r.damageByLevel[c.attackLevel-1];raw.DAMAGE={PHYSIC:power,MAGIC:power};
        const count=this.checkHits(a,shapes,raw,c.hits??={}, {kind:'core',powerMultiplier:1,attackPosition:position,
          damageDirectionRight:a.facing>0,damageStateRaw:{},impactEvidence:'target2016 core AttackN pose/helper collision; pinned-V5 launch consumer'});
        if(count){c.hit=true;this.emit('coreAttackHit',a.id,{count,position,level:c.attackLevel,source:NASOD_ATTACK_SOURCE});}
      }
      if(advanceNasodUnlock(c,dt)&&b&&b.hp>0&&this.skillsFor(a)?.vectorLockOn){
        const targetPosition=nearestLockOnPoint(this.defenderSampler?.(b,{profile:this.profileFor(b),role:'defender'}),[a.x,a.y,a.z],[b.x,b.y+100,b.z]);
        c.manualDirDegree=this.skillsFor(a).vectorLockOn({position,manualDirDegree:c.manualDirDegree??[0,0,0],
          targetPosition,curveSpeed:30,dt}).manualDirDegree;c.useManualDir=true;
      }
      if (c.attackElapsed >= Math.fround(r.attackTimeoutSeconds)) {
        if (c.hit) c.gauge = Math.max(0,c.gauge-c.level*20);
        this.updateCoreLevel(a); this.emit('coreAttackEnded',a.id,{hit:c.hit,gauge:c.gauge});
        restoreNasodHelper(a);c.dirSpeed=0;c.attackElapsed=0;c.delayElapsed=0;c.targetId=null;c.useManualDir=false;
      }
    }
  }
}
