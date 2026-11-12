/** Network arrival projection, not a new source body policy. A remote report
 * arrives between physics steps, where CheckPassUnit has no movement backup.
 * Reuse its frozen reference geometry only for that remote visible body. The
 * wire, historical attack anchors, local actor and combat clocks stay intact.
 * Memory is one row per room actor; counters never retain packet/event traces. */
import {nativeBodyOverlap,nativeBodyPassBlocked,nativeBodyPushCandidate} from '../combat-core/reaction-policy.mjs';

const position=actor=>[actor.x,actor.y,actor.z];
const flagWindows=new WeakMap();
const pushProjections=new WeakMap();
const witnessFields=['x','y','z','facing','state','stateSerial','animationTime','grounded','lineId','lastTouchLineId','sourceBlackHoleCanPass'];
const witnessPose=actor=>Object.fromEntries(witnessFields.filter(key=>Object.hasOwn(actor,key)).map(key=>[key,structuredClone(actor[key])]));
function flag(profile,actor,name,fallback){
  if(name==='CAN_PASS_UNIT'&&actor.sourceBlackHoleCanPass!=null)return actor.sourceBlackHoleCanPass;
  const raw=profile.states?.[actor.state]?.raw??{};let value=raw[name]??fallback;
  let byName=flagWindows.get(raw);if(!byName){byName=new Map();flagWindows.set(raw,byName);}
  let windows=byName.get(name);if(!windows){const prefix=name+'_TIME',numbered=new RegExp('^'+prefix+'\\d+$');windows=Object.entries(raw).filter(([key])=>key===prefix||numbered.test(key)).map(([,row])=>row);byName.set(name,windows);}
  for(const row of windows)if(actor.animationTime>=row['1'])value=row['2'];
  return value===1||value===true;
}
const profileFor=(simulation,actor)=>simulation.profileFor?.(actor)??simulation.profile;
// Historical wire actors carry only mutable pose data. Their geometry and
// state declaration must always come from the room's frozen roster identity.
const body=(simulation,actor,identity=actor)=>{const profile=profileFor(simulation,identity);return {position:position(actor),height:profile.body.UNIT_HEIGHT,width:profile.body.UNIT_WIDTH};};
const absent=actor=>!actor||actor.deathComplete||actor.pvpDead||actor.pvpDisconnected||actor.hp<=0;
const same=(a,b)=>a.every((v,index)=>v===b[index]);
function permit(frames,frame){
  if(frames.includes(frame))return;
  frames.push(frame);frames.sort((a,b)=>a-b);
  // Preserve the first pending witness and the newest15. A future action
  // arriving first must not hide an earlier usable witness, and a transport
  // gap must not turn these numeric permits into an unbounded action queue.
  if(frames.length>16)frames.splice(1,frames.length-16);
}

/** A narrow published native overlap-push operation. The source body and the
 * obstacle must have frozen roster profiles. No arbitrary offset, previous
 * projected-body chain, crossing recovery or state/protection substitution. */
export function nativeBodyPushWitnessPosition(target,targetProfile,obstacle,obstacleProfile,{map,nativeGeometry}={}){
  if(!target||!obstacle||!targetProfile?.states?.[target.state]||!obstacleProfile?.states?.[obstacle.state]||
    ![target,obstacle].every(actor=>['x','y','z','animationTime'].every(key=>Number.isFinite(actor[key])))||
    ![1,-1].includes(target.facing)||![targetProfile,obstacleProfile].every(profile=>
      Number.isFinite(profile.body?.UNIT_WIDTH)&&profile.body.UNIT_WIDTH>0&&Number.isFinite(profile.body?.UNIT_HEIGHT)&&profile.body.UNIT_HEIGHT>0))return null;
  // A transient black-hole pass override is not an ordinary immutable state
  // witness. Keep that specialized controller out of this narrow contract.
  if(target.sourceBlackHoleCanPass!=null||obstacle.sourceBlackHoleCanPass!=null||
    flag(targetProfile,target,'CAN_PASS_UNIT',0)||flag(obstacleProfile,obstacle,'CAN_PASS_UNIT',0)||
    !(flag(targetProfile,target,'CAN_PUSH_UNIT',1)||!flag(obstacleProfile,obstacle,'CAN_PUSH_UNIT',1)))return null;
  const a={position:position(target),height:targetProfile.body.UNIT_HEIGHT,width:targetProfile.body.UNIT_WIDTH};
  const b={position:position(obstacle),height:obstacleProfile.body.UNIT_HEIGHT,width:obstacleProfile.body.UNIT_WIDTH};
  if(!nativeBodyOverlap(a,b).overlaps)return null;
  const candidate=nativeBodyPushCandidate(a,b,{position:a.position,direction:[target.facing,0,0]});
  if(same(candidate,a.position)||nativeBodyPassBlocked(a,b,{position:candidate,backupPosition:b.position}))return null;
  // Reconstruct only the pure push: if the native/map support would clip it,
  // the caller must retain the existing unreferenced-contact fallback.
  if(target.grounded&&map){
    if(nativeGeometry){
      const support=nativeGeometry.support({position:candidate,radius:targetProfile.referenceSemantics.lineRadius,lastLineId:target.lastTouchLineId});
      if(!support.found||!same(candidate,support.point))return null;
    }else{
      const line=map.lines.find(line=>line.lineId===target.lineId);if(!line)return null;
      const increasing=line.end[0]>=line.start[0];
      const startOutside=increasing?candidate[0]<line.start[0]:candidate[0]>line.start[0];
      const endOutside=increasing?candidate[0]>line.end[0]:candidate[0]<line.end[0];
      if(startOutside&&line.beforeLine===-2||endOutside&&line.nextLine===-2)return null;
    }
  }
  return candidate;
}

/** Internal local witness metadata; it is not serialized as actor state. */
export function ownedBodyPushProjection(actor,{epoch,frameSeq}={}){
  const row=pushProjections.get(actor);return row&&row.epoch===epoch&&row.frameSeq===frameSeq?row:null;
}

export function createOwnedBodyArrivalGuard(){
  const rows=new Map(),counts={accepted:0,crossingBlocked:0,crossingRecovered:0,overlapProjected:0,mapLimited:0,newLife:0,canPass:0,observedPass:0,observedVertical:0,ineligible:0,unchanged:0,bodyPushWitnesses:0};
  let simulation=null,localId=null;
  const projectedActors=new Set();
  function clearProjection(id){for(const actor of projectedActors)if(id===undefined||actor.id===id){pushProjections.delete(actor);projectedActors.delete(actor);}}
  function reset(id,epoch){clearProjection(id);rows.set(id,{epoch,fresh:true,frameSeq:-1,passFrames:[],verticalFrames:[],localPass:false,verticalClear:false,recovery:null});}
  function observeActions(id,actions,epoch,frameSeq){
    const row=rows.get(id);if(!simulation||!row||row.epoch!==epoch||!Array.isArray(actions))return;
    // Only evidence newer than the last accepted source pose can permit its
    // next correction. An old action must not unlock every later packet.
    const local=simulation.state.actors.find(actor=>actor.id===localId),remote=simulation.state.actors.find(actor=>actor.id===id);if(!remote)return;
    for(const action of actions)if(action.frameSeq>row.frameSeq&&action.frameSeq<=frameSeq){
      if(flag(profileFor(simulation,remote),action.actor,'CAN_PASS_UNIT',0))permit(row.passFrames,action.frameSeq);
      if(!absent(local)&&!nativeBodyOverlap(body(simulation,action.actor,remote),body(simulation,local)).verticalOverlap)permit(row.verticalFrames,action.frameSeq);
    }
  }
  return {
    reset,
    capture(sim,id,owner){
      simulation=sim;localId=owner;const actor=sim.state.actors.find(actor=>actor.id===id);
      clearProjection(id);
      return actor?{position:position(actor),canPass:flag(profileFor(sim,actor),actor,'CAN_PASS_UNIT',0)}:null;
    },
    observe(sim,owner){
      simulation=sim;localId=owner;const local=sim.state.actors.find(actor=>actor.id===owner);if(absent(local))return;
      for(const actor of sim.state.actors){
        if(actor.id===owner||actor.team===local.team||absent(actor))continue;
        const row=rows.get(actor.id);if(!row||row.fresh)continue;
        row.localPass ||= flag(profileFor(sim,local),local,'CAN_PASS_UNIT',0)||flag(profileFor(sim,actor),actor,'CAN_PASS_UNIT',0);
        row.verticalClear ||= !nativeBodyOverlap(body(sim,actor),body(sim,local)).verticalOverlap;
      }
    },
    observeActions,
    accept(sim,id,report,owner,before){
      simulation=sim;localId=owner;clearProjection(id);let row=rows.get(id);
      if(!row||row.epoch!==report.epoch){reset(id,report.epoch);row=rows.get(id);}
      observeActions(id,report.actions,report.epoch,report.frameSeq);
      const remote=sim.state.actors.find(actor=>actor.id===id),local=sim.state.actors.find(actor=>actor.id===owner);
      const fresh=row.fresh,observedPass=row.localPass||row.passFrames.some(frame=>frame<=report.frameSeq),observedVertical=row.verticalClear||row.verticalFrames.some(frame=>frame<=report.frameSeq);
      row.fresh=false;row.frameSeq=report.frameSeq;row.localPass=false;row.verticalClear=false;
      row.passFrames=row.passFrames.filter(frame=>frame>report.frameSeq);
      row.verticalFrames=row.verticalFrames.filter(frame=>frame>report.frameSeq);
      counts.accepted++;
      if(fresh){row.recovery=null;counts.newLife++;return;}
      if(!before||id===owner||absent(remote)||absent(local)||remote.team===local.team){row.recovery=null;counts.ineligible++;return;}
      if(before.canPass||flag(profileFor(sim,remote),remote,'CAN_PASS_UNIT',0)||flag(profileFor(sim,local),local,'CAN_PASS_UNIT',0)){row.recovery=null;counts.canPass++;return;}
      if(observedPass){row.recovery=null;counts.observedPass++;return;}
      if(observedVertical){row.recovery=null;counts.observedVertical++;return;}
      const old={...body(sim,remote),position:before.position},other=body(sim,local),incoming=position(remote);
      const targetPose=witnessPose(remote),obstaclePose=witnessPose(local);
      let candidate=incoming;
      // Arrival has no source physics backup. The current local body is the
      // reference obstacle; never restore or displace that owned actor.
      const blocked=nativeBodyPassBlocked(old,other,{position:incoming,backupPosition:other.position});
      if(blocked){
        const incomingBody={...old,position:incoming};
        const separated=!nativeBodyOverlap(incomingBody,other).overlaps;
        const side=Math.sign(incoming[0]-other.position[0]);
        if(separated&&side!==0){
          if(!row.recovery||row.recovery.side!==side)row.recovery={side,firstFrame:report.frameSeq,lastFrame:report.frameSeq,samples:1};
          else if(report.frameSeq>row.recovery.lastFrame){row.recovery.lastFrame=report.frameSeq;row.recovery.samples++;}
          // This is an arrival correction, not permission for local physics
          // to cross bodies. Several fresh, disjoint authoritative endpoints
          // bound a projection that would otherwise pin this owner forever.
          if(row.recovery.samples>=3&&report.frameSeq-row.recovery.firstFrame>=6){counts.crossingRecovered++;row.recovery=null;return;}
        }else row.recovery=null;
        candidate=[...before.position];counts.crossingBlocked++;
      }else row.recovery=null;
      const canPush=flag(profileFor(sim,remote),remote,'CAN_PUSH_UNIT',1)||!flag(profileFor(sim,local),local,'CAN_PUSH_UNIT',1);
      if(canPush){
        const pushed=nativeBodyPushCandidate(old,other,{position:candidate,direction:[remote.facing,0,0]});
        if(!same(pushed,candidate)){counts.overlapProjected++;candidate=pushed;}
      }
      if(same(candidate,incoming)){counts.unchanged++;return;}
      // Match the existing isolated native map query for a grounded body;
      // an authored wall may prevent complete separation at a corner. Never
      // invent a rectangular map boundary or move the local player to fit it.
      if(remote.grounded&&sim.nativeGeometry){
        const support=sim.nativeGeometry.support({position:candidate,radius:profileFor(sim,remote).referenceSemantics.lineRadius,lastLineId:remote.lastTouchLineId});
        if(support.found){if(!same(candidate,support.point))counts.mapLimited++;candidate=support.point;}
        else {candidate=[...before.position];counts.mapLimited++;}
      }else if(remote.grounded){
        const line=sim.map.lines.find(line=>line.lineId===remote.lineId);
        if(line){
          const increasing=line.end[0]>=line.start[0],startOutside=increasing?candidate[0]<line.start[0]:candidate[0]>line.start[0],endOutside=increasing?candidate[0]>line.end[0]:candidate[0]<line.end[0];
          if(startOutside&&line.beforeLine===-2||endOutside&&line.nextLine===-2){candidate=[...(startOutside?line.start:line.end)];counts.mapLimited++;}
        }
      }
      // Native support can clip a projection. A map correction must not put
      // the remote back across the same obstacle it was meant to respect.
      if(nativeBodyPassBlocked(old,other,{position:candidate,backupPosition:other.position})){candidate=[...before.position];counts.mapLimited++;}
      [remote.x,remote.y,remote.z]=candidate;
      if(!blocked){
        const targetProfile=profileFor(sim,remote),obstacleProfile=profileFor(sim,local);
        // The actual arrival path above already applied map support. Equal
        // pure-push output proves it was not clipped; avoid a second map query.
        const exact=nativeBodyPushWitnessPosition(targetPose,targetProfile,obstaclePose,obstacleProfile);
        if(exact&&same(exact,candidate)){
          pushProjections.set(remote,{epoch:report.epoch,frameSeq:report.frameSeq,targetPose,obstaclePose,targetProfile,obstacleProfile,
            obstacleId:owner,projectedPosition:[...candidate]});projectedActors.add(remote);
          counts.bodyPushWitnesses++;
        }
      }
    },
    get diagnostics(){let pendingPermits=0;for(const row of rows.values())pendingPermits+=row.passFrames.length+row.verticalFrames.length;return {...counts,trackedActors:rows.size,pendingPermits};},
    clear(){clearProjection();rows.clear();for(const key of Object.keys(counts))counts[key]=0;simulation=null;localId=null;},
  };
}
