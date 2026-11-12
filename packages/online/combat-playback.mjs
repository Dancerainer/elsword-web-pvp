/** Reliable source events for recipient-local combat playback. Wire source
 * clocks remain canonical validation data; they are not catch-up collisions.
 * No interval sampler belongs here: ordinary pose/status calibration remains
 * on its independent, replaceable transport. */
import {encodeOwnedState,encodeCriticalAction,encodeEffectState,validateCombatPlayback,MAX_OWNER_EFFECTS} from './owned-state.mjs';
import {captureForceFingerResourceNumbers} from './force-finger-resource-numbers-v49.mjs';

export const COMBAT_PLAYBACK_VERSION=1;
const clone=value=>structuredClone(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const signature=value=>JSON.stringify(value);
// Generic NEXT stage is a local collision-clock result. A phase-only change
// cannot control another receiver's clock and needs no reliable event. Typed
// command phases and explicit instance changes below remain reliable controls.
const phaseKeys=['name','setName','definitionMember','ownerStateSerial','skillId','powerMultiplier','clock','start','active','dead',
  'hyperMode','deleteOnStateEnd','deleteConditions','parentEffectId','buffTemplateId','lifeTimeSeconds','sourceDirSpeedSign','sourceArcHandle',
  'sourceArcStartMesh','sourcePhantomSword','sourcePhantomAttackSerial','sourceRuneLevel','sourceISSheath','sourceReflected','sourceProfessionId',
  'sourceAddSummonSerial','sourceAddStormSize','sourceAddEnergyBoomMutation','sourceAddStasisSize','sourceAddVoidCollapse','sourceBoneEffectSetId','sourceBoneTargetMeshId','sourceEffectSetId','sourceTargetMeshId',
  'sourceVeteranTargetId','traceActorId','traceUnitDieDelete','sourceBuffFactor','sourceAddStardustMesh'];
// Native ChangeAnim loops increment a display serial without re-entering the
// combat state. They must not become reliable StateStart commands.
const actorController=actor=>[actor.state,actor.stateSerial,actor.animationName];
const sameController=(left,right)=>right!==null&&left.every((value,index)=>value===right[index]);
/** Logical controls exclude all source animation/global/lifetime accumulators,
 * steering vectors, bone positions and linked-mesh matrices. */
export function combatPlaybackEffectSignature(effect){
  return signature({...pick(effect,phaseKeys),attackWindow:effect.damage&&pick(effect.damage,['ATTACK_TIME_START','ATTACK_TIME_END']),
    dirSpeed:effect.initialDirSpeed,
    aura:effect.sourceContinuousAura&&pick(effect.sourceContinuousAura,['version','revision','phase']),
    lockOn:effect.sourceAddLockOn&&pick(effect.sourceAddLockOn,['targetId']),
    fission:effect.sourceAddFissionSplit&&pick(effect.sourceAddFissionSplit,['parentName','member']),
    markedDrone:effect.sourceAddMarkedDrone&&pick(effect.sourceAddMarkedDrone,['targetEpoch']),
    maximumStrike:effect.sourceAddMaximumStrike&&pick(effect.sourceAddMaximumStrike,['index','group']),
    maximumStrikeOrbit:effect.sourceAddMaximumStrikeOrbit&&pick(effect.sourceAddMaximumStrikeOrbit,['sphereIndex','targetEpoch']),
    blazeWing:effect.sourceBlazeWingLockOn&&pick(effect.sourceBlazeWingLockOn,['targetId','selectionSerial']),
    fury:effect.sourceAddFury&&pick(effect.sourceAddFury,['role','index','group','targetId']),
    quicksilver:effect.sourceAddQuicksilverLink&&pick(effect.sourceAddQuicksilverLink,['phase','group']),
    reflection:effect.sourceReflection&&pick(effect.sourceReflection,['remaining','sourceActorId','sourceEffectId','sourceEpoch'])});
}
const actorControls=actor=>signature({facing:actor.facing,skillId:actor.skillId,skillScale:actor.skillScale,
  prism:(actor.sourceAddPrismEndpoints??[]).map(n=>pick(n,['id','state','pendingState','hp'])),
  forceFingerResourceNumbers:actor.sourceForceFingerResourceNumbers&&pick(actor.sourceForceFingerResourceNumbers,['epoch','serial']),
  stopped:{hit:actor.hitStop>0,world:actor.worldStop>0},
  awakening:{full:actor.awakening?.full,active:(actor.awakening?.remaining??0)>0},
  add:pick(actor.sourceAdd,['formation','formationPending']),
  generator:actor.sourceAdd?.generator?pick(actor.sourceAdd.generator,['skillId','phase','generation']):null,
  mega:pick(actor.sourceMegaDrill,['damageStage','reAttack','attackBoxMask']),
  maximumStrike:pick(actor.sourceAddCombat?.maximumStrike,['targetId','power','group','formationAtLastLiveStep','totalLifetime','cooldownBase']),
  moonlight:pick(actor.sourceAddCombat?.moonlight,['period','power','group','skillId']),
  phantom:actor.sourceInfinitySword?.phantomSword&&{phase:actor.sourceInfinitySword.phantomSword.phase,
    attack:pick(actor.sourceInfinitySword.phantomSword.currentAttack,['serial','stateSerial','state','stage'])},
  arc:actor.sourceArcEnemy&&{data:actor.sourceArcEnemy.data.map(row=>row.handle),effects:actor.sourceArcEnemy.effects.map(row=>
    pick(row,['handle','name','alive','hasMesh','power','lockOnUnitUID','lockOnNPCUID','dirSpeed','maxLifeTime','attackTime']))},
  core:pick(actor.core,['phase','targetId','attackLevel','helperLive']),
  emittedStops:(actor.fired??[]).filter(field=>/^STOP_OTHER_UNIT\d+$/.test(field)),
  emittedCore:(actor.fired??[]).filter(field=>/^core/.test(field))});
const links=['parentEffectId','sourceBoneEffectSetId','sourceBoneTargetMeshId','sourceEffectSetId','sourceTargetMeshId','sourceVeteranTargetId'];
function closure(selected,all,actor){
  const added=new Map(selected),include=id=>{const effect=all.get(id);if(effect&&!added.has(id))added.set(id,effect);};
  // Phantom validators require the paired original mesh identities even when
  // only the attack controller changed. Bone/parent handles are similarly
  // authored dependencies, never every unrelated continuous visual.
  const phantom=actor.sourceInfinitySword?.phantomSword;
  if(phantom){include(phantom.effectId);include(phantom.centerId);}
  for(const effect of added.values())for(const key of links)include(effect[key]);
  if(added.size>MAX_OWNER_EFFECTS)throw new RangeError('playback-effect-closure-overflow');
  return added;
}

export function createCombatPlaybackProducer({version=0}={}){
  let mode=0;const owners=new Map();
  const metrics={actions:0,starts:0,births:0,controls:0,ends:0,transientEnds:0,naturallyRetired:0,
    sourceReportsEncoded:0,reusedEffectStates:0,terminalEffectStatesEncoded:0};
  const setVersion=value=>{if(![0,1].includes(value))throw new TypeError('invalid-combat-playback-version');if(mode!==value)owners.clear();mode=value;};
  setVersion(version);
  function rowFor(playerId,epoch){
    let row=owners.get(playerId);if(!row||row.epoch!==epoch){row={epoch,frame:-1,controller:null,controls:null,held:null,effects:new Map(),prior:new Map()};owners.set(playerId,row);}
    return row;
  }
  return {
    setVersion,configureVersion:setVersion,
    beforeStep(simulation,playerId){
      if(mode!==1)return;
      const row=owners.get(playerId);if(row)row.prior=new Map(simulation.state.effects.filter(effect=>effect.ownerId===playerId).map(effect=>[effect.id,effect]));
    },
    capture(simulation,playerId,{epoch=0,frameSeq,events=[],held=[],report,getReport}={}){
      if(mode!==1)return null;
      if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(frameSeq)||frameSeq<0)throw new TypeError('invalid-combat-playback-source-clock');
      const normalizedHeld=validateCombatPlayback({version:1,start:false,held}).held.sort();
      const actor=simulation.actor(playerId),row=rowFor(playerId,epoch);
      if(frameSeq<=row.frame)throw new TypeError('combat-playback-source-frame-must-advance');
      captureForceFingerResourceNumbers(simulation,actor,{epoch,frameSeq,events});
      const controller=actorController(actor),controls=actorControls(actor),heldKey=signature(normalizedHeld);
      const start=!sameController(controller,row.controller);
      const actorChanged=start||controls!==row.controls||heldKey!==row.held||events.some(event=>event.actorId===playerId&&
        ['stateChanged','characterDamageDataChanged','characterAttackBoxesChanged','worldStop','coreAttackStarted','coreGuardStarted'].includes(event.type));
      const live=new Map(simulation.state.effects.filter(effect=>effect.ownerId===playerId&&!effect.dead&&!effect.combatRetired).map(effect=>[effect.id,effect]));
      const selected=new Map(),signatures=new Map();
      for(const [id,effect]of live){const current=combatPlaybackEffectSignature(effect);signatures.set(id,current);
        if(!row.effects.has(id)){selected.set(id,effect);metrics.births++;}
        else if(row.effects.get(id).signature!==current){selected.set(id,effect);metrics.controls++;}
      }
      for(const [id,old]of row.effects)if(!live.has(id)){
        const last=row.prior.get(id)??old.effect;
        // combatRetired releases only the source collision executor. Finite
        // renderer templates still own their ordinary particle/mesh tails.
        // It is not an authoritative stop notification.
        if(last.combatRetired&&!last.dead&&!last.endEmitted&&!events.some(event=>event.actorId===playerId&&event.type==='effectEnded'&&event.effectId===id)){
          metrics.naturallyRetired++;continue;
        }
        selected.set(id,{...last,active:false,dead:true,endEmitted:true});metrics.ends++;
      }
      // An actual renderer birth may also retire inside the same source tick.
      // Preserve a terminal source identity; never manufacture an active old
      // collider simply to make a late receiver charge retroactive damage.
      const births=events.filter(event=>event.actorId===playerId&&event.type==='effectStarted');
      for(const event of births)if(!live.has(event.effectId)&&!selected.has(event.effectId)){
        const last=row.prior.get(event.effectId)??event.visualBirth;
        const ended=events.some(end=>end.actorId===playerId&&end.type==='effectEnded'&&end.effectId===event.effectId);
        if(last){
          if(ended||last.dead||last.endEmitted){selected.set(event.effectId,{...last,active:false,dead:true,endEmitted:true});metrics.transientEnds++;}
          else if(event.visualBirth){selected.set(event.effectId,event.visualBirth);metrics.births++;}
        }
        else if(ended){
          // All fields below are the actual source birth's canonical identity
          // and anchor. No native object is instantiated for this closed ID.
          selected.set(event.effectId,{id:event.effectId,ownerId:playerId,name:event.name,setName:event.setName,ownerStateSerial:event.ownerStateSerial,
            skillId:event.skillId,powerMultiplier:actor.skillScale,clock:'custom',start:0,setElapsed:0,elapsed:0,animationTime:0,
            x:event.birthAnchor?.position?.[0]??actor.x,y:event.birthAnchor?.position?.[1]??actor.y,z:event.birthAnchor?.position?.[2]??actor.z,
            birthAnchor:clone(event.birthAnchor??null),active:false,dead:true,endEmitted:true,deleteConditions:clone(event.deleteConditions??[])});
          metrics.transientEnds++;
        }
      }
      const commit=()=>{row.frame=frameSeq;row.controller=controller;row.controls=controls;row.held=heldKey;
        row.effects=new Map([...live].map(([id,effect])=>[id,{signature:signatures.get(id),effect}]));row.prior=new Map(live);};
      if(!actorChanged&&!selected.size){commit();return null;}
      const states=closure(selected,new Map([...row.prior,...live,...selected]),actor);
      // Generate this source frame only after a logical change is known. The
      // ownership coordinator supplies a synchronous, frame-local factory so
      // its ordinary pose can share this detached snapshot. Never retain the
      // factory or a live mutable actor across capture calls.
      const source=report??getReport?.()??(()=>{metrics.sourceReportsEncoded++;
        return encodeOwnedState(simulation,playerId,{epoch,frameSeq});})();
      if(source.epoch!==epoch||source.frameSeq!==frameSeq)throw new TypeError('playback-report-clock-mismatch');
      // The complete snapshot already encoded every live effect. Clone only
      // this action's dependency closure; terminal records absent from the
      // live report still require their own canonical encoder. An empty list
      // avoids encodeCriticalAction copying Phantom meshes just to replace it.
      // An explicitly supplied historical report is supported by the old API
      // as an actor header; its effects need not be this capture's live view.
      const encoded=new Map(report?[]:source.effects.map(effect=>[effect.id,effect]));
      const action=encodeCriticalAction({...source,effects:[]},{id:frameSeq});
      action.effects=[...states.values()].map(effect=>{
        const cached=encoded.get(effect.id);
        if(cached&&!effect.dead&&!effect.endEmitted){metrics.reusedEffectStates++;return clone(cached);}
        metrics.terminalEffectStatesEncoded++;
        return encodeEffectState(effect,simulation.effectProfileFor?.(effect)??simulation.profileFor(actor),actor);
      });
      action.playback={version:1,start,held:normalizedHeld};
      commit();metrics.actions++;if(start)metrics.starts++;
      return action;
    },
    clear(){owners.clear();for(const key of Object.keys(metrics))metrics[key]=0;},
    get diagnostics(){return {version:mode,...metrics,owners:owners.size,liveEffectSignatures:[...owners.values()].reduce((n,row)=>n+row.effects.size,0)};},
  };
}
