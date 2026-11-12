/** Disclosed transport fixture: a server-provided standing actor is sampled
 * with a small synthetic position oscillation and periodic standing-state
 * re-entry. Production producers encode its status and canonical events.
 * This is not Native gameplay, attack collision or original-client evidence. */
import {encodeCriticalAction,validateOwnedState} from '../packages/online/owned-state.mjs';
import {createOwnerStatusClock} from '../packages/online/owner-status-clock.mjs';
import {createCombatPlaybackProducer} from '../packages/online/combat-playback.mjs';

export function createStandingRtcSource({template,playerId,profile,ownerStatusVersion=0,combatPlaybackVersion=0,actionEveryFrames=30,poseAmplitude=5}){
 if(![0,1].includes(ownerStatusVersion)||![0,1].includes(combatPlaybackVersion))throw Error('invalid-fixture-room-capabilities');
 if(!Number.isSafeInteger(actionEveryFrames)||actionEveryFrames<1||!Number.isFinite(poseAmplitude)||poseAmplitude<0||poseAmplitude>50)throw Error('invalid-standing-source-fixture');
 const original=validateOwnedState(template),status=createOwnerStatusClock(),playback=createCombatPlaybackProducer({version:combatPlaybackVersion});
 if(original.effects.length||original.hits.length||original.actions?.length)throw Error('standing-fixture-requires-empty-event-template');
 let lastFrame=-1,reports=0;
 return {
  sample(frameSeq){
   if(!Number.isSafeInteger(frameSeq)||frameSeq<=lastFrame)throw Error('standing-fixture-frame-must-advance');lastFrame=frameSeq;
   const report=structuredClone(original);report.frameSeq=frameSeq;
   report.actor.x+=Math.sin(frameSeq/30)*poseAmplitude;
   // stateTime is an explicit fixture-only source-clock marker used by the
   // independent callback-order observer, not a simulated animation phase.
   report.actor.stateTime=frameSeq/60;
   report.actor.stateSerial=original.actor.stateSerial+Math.floor(frameSeq/actionEveryFrames);
   delete report.actor.sourceStatusClock;
   if(ownerStatusVersion===1)report.actor=status.encode(report.actor,report.epoch,frameSeq).actor;
   if(combatPlaybackVersion===1){
    const actor={...report.actor,id:playerId},source={state:{actors:[actor],effects:[]},actor:()=>actor,profile,profileFor:()=>profile};
    const action=playback.capture(source,playerId,{epoch:report.epoch,frameSeq,report,held:[],events:[]});
    report.actions=action?[action]:[];
   }else report.actions=frameSeq%actionEveryFrames===0?[encodeCriticalAction(report,{id:frameSeq})]:[];
   reports++;return validateOwnedState(report);
  },
  diagnostics(){return {evidenceClass:'standing-source-shaped-transport-fixture',ownerStatusVersion,combatPlaybackVersion,reports,
   firstPlaybackEvent:'first sampled source frame initializes the standing controller; subsequent state serials change at actionEveryFrames',
   playback:playback.diagnostics};},
 };
}
