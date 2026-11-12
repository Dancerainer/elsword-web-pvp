import {captureActorPresentation,interpolateActorPresentation} from './actor-render-clock.mjs';
import {CONTACT_FIELDS,captureContactObservation} from '../../packages/combat-core/contact-observation.mjs';
import {ownedBodyPushProjection,nativeBodyPushWitnessPosition} from '../../packages/online/owned-body-arrival.mjs';

/** Web observation adapter. Source frame numbers are 60 Hz owner steps, not
 * arrival intervals or synchronized wall clocks. The local player never
 * waits for this queue. Optional contact samples let its outgoing collision
 * use the same remote body as the display, without replaying skill callbacks
 * or assigning authority over another player. These are Web adapter bounds,
 * not target2016 constants or a claim of original-client equivalence.
 *
 * Keep a small source timeline, hold at its end instead of inventing movement,
 * and vary playback slightly to absorb jitter. A long interruption rebases in
 * bounded time; ordinary recovery blends position, a new life resets exactly.
 */
const frameMs=1000/60,axes=['x','y','z'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(...axes.map(key=>(a[key]??0)-(b[key]??0)));
const finitePosition=a=>axes.every(key=>Number.isFinite(a?.[key]));
function capture(actor){
  const pose=captureActorPresentation(actor);
  for(const key of ['lineId','lastTouchLineId','grounded','applyMotionOffset','consumeRootTranslation',
    'animationPlaybackSpeed','stateTime','skillId'])pose[key]=actor[key];
  return pose;
}
function between(a,b,time){
  if(!b||time<=a.time)return a.pose;
  const alpha=clamp((time-a.time)/(b.time-a.time),0,1);
  // Discrete state/facing/line identity changes at its source sample, never
  // halfway through a controller transition. Only compatible clocks blend.
  const result={...a.pose};
  for(const key of axes)result[key]=a.pose[key]+(b.pose[key]-a.pose[key])*alpha;
  const continuous=interpolateActorPresentation(a.pose,b.pose,alpha);
  if(a.pose.stateSerial===b.pose.stateSerial&&a.pose.state===b.pose.state&&a.pose.facing===b.pose.facing){
    if(a.pose.animationName===b.pose.animationName&&a.pose.animationTransitionSerial===b.pose.animationTransitionSerial
      &&b.pose.animationTime>=a.pose.animationTime){
      result.animationTime=continuous.animationTime;result.presentationTransition=continuous.presentationTransition;
    }
    result.deathAlpha=continuous.deathAlpha;
  }
  // The core has an independent controller: an owner combo/facing change
  // must not interrupt its flight. Its own phase and loops remain discrete.
  if(a.pose.core?.phase===b.pose.core?.phase&&a.pose.core?.animationName===b.pose.core?.animationName
    &&b.pose.core?.animationTime>=a.pose.core?.animationTime)result.core=continuous.core;
  return result;
}
function weightsAt(row,time){
  let i=0;while(i+1<row.samples.length&&row.samples[i+1].time<=time)i++;
  const a=row.samples[i],b=row.samples[i+1];
  if(!b||time<=a.time)return new Map([[a,1]]);
  const alpha=clamp((time-a.time)/(b.time-a.time),0,1);
  return new Map([[a,1-alpha],[b,alpha]]);
}
function displayedWeights(row,time){
  const first=row.samples[0],last=row.samples.at(-1),result=new Map();
  const radius=Math.min(frameMs,time-first.time,last.time-time);
  const points=radius>0?[[time-radius,.25],[time,.5],[time+radius,.25]]:[[time,1]];
  for(const [at,weight]of points)for(const [sample,fraction]of weightsAt(row,at)){
    const value=(result.get(sample)??0)+weight*fraction;if(value>1e-12)result.set(sample,value);
  }
  return [...result].sort(([a],[b])=>a.frameSeq-b.frameSeq);
}

export function createRemoteActorClock({clock=()=>performance.now(),minDelayMs=50,maxDelayMs=120,
  maxSamples=32,maxLagMs=250,recoveryMs=100,discontinuityDistance=1200,captureContacts=false}={}){
  if(!(minDelayMs>=0&&maxDelayMs>=minDelayMs&&maxLagMs>maxDelayMs&&recoveryMs>0&&discontinuityDistance>0)
    ||!Number.isSafeInteger(maxSamples)||maxSamples<2)throw new RangeError('Invalid remote presentation bounds');
  const rows=new Map();
  let bodyPushWitnessVersion=0,contactContext=null;
  const counts={accepted:0,stale:0,resets:0,rebases:0,clockRebases:0,discontinuities:0};
  const witnessCounts={requested:0,accepted:0,bodyPushAccepted:0,noObservation:0,recovery:0,invalidSamples:0,
    projectedDisabled:0,unverifiedProjection:0,obstacleChanged:0,positionMismatch:0,controllerMismatch:0};
  const rejectWitness=reason=>{witnessCounts[reason]++;return null;};
  function poseAt(row,time){
    let i=0;while(i+1<row.samples.length&&row.samples[i+1].time<=time)i++;
    return between(row.samples[i],row.samples[i+1],time);
  }
  function displayedPose(row,time){
    const pose={...poseAt(row,time)},first=row.samples[0],last=row.samples.at(-1);
    if(time<=first.time||time>=last.time)return pose;
    // Urgent controller packets can be one source tick apart. A short root
    // movement which the periodic 20 Hz samples used to spread over 50 ms
    // must not become a one-display-frame spike. This symmetric position
    // filter adds no phase lag to constant velocity and uses only confirmed
    // samples; animation/state boundaries still use the exact source cursor.
    const radius=Math.min(frameMs,time-first.time,last.time-time);
    const left=poseAt(row,time-radius),right=poseAt(row,time+radius);
    for(const key of axes)pose[key]=(left[key]+2*pose[key]+right[key])/4;
    return pose;
  }
  function observe(actor,{epoch,frameSeq,at=clock(),actor:sourceActor}={}){
    if(!finitePosition(actor)||!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(frameSeq)||frameSeq<=0||!Number.isFinite(at))return false;
    let row=rows.get(actor.id);
    if(row&&(epoch<row.epoch||epoch===row.epoch&&frameSeq<=row.frameSeq)){counts.stale++;return false;}
    const time=frameSeq*frameMs,pose=capture(actor),offset=at-time;
    if(!row||epoch!==row.epoch){
      row={epoch,frameSeq,samples:[],offsets:[],base:offset,delay:minDelayMs,cursor:time,lastAt:at,
        shown:null,recovery:null,held:0};rows.set(actor.id,row);counts.resets++;
    }
    const last=row.samples.at(-1);
    // Large, short source discontinuities are not a traversable movement path.
    // Respawns normally use epoch; this also handles an explicit source warp.
    if(last&&time-last.time<=100&&distance(last.pose,pose)>discontinuityDistance){
      row.samples.length=0;row.cursor=time;row.shown=null;row.recovery=null;row.lastAt=at;counts.discontinuities++;
    }
    // Source rendering can pause without accruing source ticks (tab/CPU stall).
    // Treat the resulting offset step as a new clock origin. Otherwise a
    // seconds-old minimum makes healthy resumed packets hold at the queue end.
    if(last&&at-row.arrived-(time-last.time)>maxLagMs){row.offsets.length=0;counts.clockRebases++;}
    row.offsets.push({offset,at});row.offsets=row.offsets.filter(sample=>at-sample.at<=1000).slice(-64);
    const sorted=row.offsets.map(sample=>sample.offset).sort((a,b)=>a-b),base=sorted[0];
    // Rolling minimum excludes constant transit time. This measures jitter,
    // not one-way latency. A new faster path can be used immediately.
    row.base=base;
    const jitter=Math.max(0,sorted[Math.floor((sorted.length-1)*.9)]-base);
    // One regular 50 ms report interval suffices on a clean path. Keep the
    // previous 10 ms safety margin once jitter is observed instead of making
    // weak links pay for the clean-path latency reduction with more holds.
    row.delay=clamp(minDelayMs+jitter+Math.min(10,jitter),minDelayMs,maxDelayMs);
    row.frameSeq=frameSeq;row.arrived=at;row.samples.push({time,frameSeq,pose,
      sourcePosition:!sourceActor||axes.every(key=>Number.isFinite(sourceActor[key])&&Math.abs(sourceActor[key]-pose[key])<=1e-6),
      bodyPushProjection:ownedBodyPushProjection(actor,{epoch,frameSeq}),
      ...(captureContacts?{contact:captureContactObservation(actor)}:{})});
    if(row.samples.length>maxSamples)row.samples.splice(0,row.samples.length-maxSamples);
    counts.accepted++;return true;
  }
  function sampleActor(actor,now){
    const row=rows.get(actor.id);
    if(!row||!row.samples.length)return actor;
    // Server lifecycle presentation wins immediately. Never interpolate into
    // a disconnected/dead actor or use an old life at a new spawn position.
    if(actor.pvpDisconnected||actor.pvpDead||actor.hidden||actor.pvpPresentation){
      rows.delete(actor.id);return actor;
    }
    const latest=row.samples.at(-1),first=row.samples[0];
    const elapsed=clamp(now-row.lastAt,0,50);row.lastAt=Math.max(row.lastAt,now);
    const desired=Math.min(latest.time,now-row.base-row.delay);
    if(desired-row.cursor>maxLagMs||row.cursor<first.time){
      const previous=row.shown;row.cursor=Math.max(first.time,desired);counts.rebases++;
      const target=displayedPose(row,row.cursor);
      row.recovery=previous&&distance(previous,target)<=discontinuityDistance?
        {started:now,offset:axes.map(key=>previous[key]-target[key])}:null;
    }else if(desired>row.cursor){
      // Clock never runs backward when the jitter allowance increases.
      const rate=clamp(1+(desired-row.cursor-elapsed)/160,.85,1.25);
      row.cursor=Math.min(desired,row.cursor+elapsed*rate);
    }
    row.cursor=Math.min(latest.time,Math.max(first.time,row.cursor));
    const pose=displayedPose(row,row.cursor);
    if(row.recovery){
      const remaining=1-clamp((now-row.recovery.started)/recoveryMs,0,1);
      for(let i=0;i<3;i++)pose[axes[i]]+=row.recovery.offset[i]*remaining;
      if(!remaining)row.recovery=null;
    }
    row.held=row.cursor>=latest.time?Math.max(0,now-row.arrived):0;
    row.shown=pose;
    // HUD health/buff lifetimes and room state stay live. With contact history
    // enabled, model protection follows the same boundary as its collider.
    const shown={...actor,...pose};
    if(captureContacts){
      let index=0;while(index+1<row.samples.length&&row.samples[index+1].time<=row.cursor)index++;
      const contact=row.samples[index].contact;
      if(contact)for(const key of ['invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed'])shown[key]=contact[key];
    }
    for(const key of ['hidden','deathComplete','deathAlpha'])shown[key]=actor[key];
    return shown;
  }
  return {observe,
    setBodyPushWitnessVersion(version){if(![0,1].includes(version))throw new TypeError('invalid-body-push-witness-version');bodyPushWitnessVersion=version;},
    observationReference(id){
      witnessCounts.requested++;
      const row=rows.get(id);if(!captureContacts||!row?.shown)return rejectWitness('noObservation');
      if(row.recovery)return rejectWitness('recovery');
      let i=0;while(i+1<row.samples.length&&row.samples[i+1].time<=row.cursor)i++;
      const sample=row.samples[i],weights=displayedWeights(row,row.cursor);
      const totalWeight=weights.reduce((sum,[,weight])=>sum+weight,0);
      // Name the actual confirmed source samples used to draw this body.
      // A source owner reconstructs these positions from its bounded sent
      // history; no nearest-frame guess, arbitrary position or local arrival
      // projection is eligible. Discrete protection stays at the lower anchor.
      if(!weights.length||weights.length>4||weights.at(-1)[0].frameSeq-weights[0][0].frameSeq>30||
        !Number.isFinite(totalWeight)||Math.abs(totalWeight-1)>1e-7||
        !weights.some(([item])=>item.frameSeq===sample.frameSeq)||weights.some(([,weight])=>!Number.isFinite(weight)||weight<=0||weight>1))return rejectWitness('invalidSamples');
      const bodyPushFrames=[];
      for(const [item]of weights)if(!item.sourcePosition){
        if(bodyPushWitnessVersion!==1)return rejectWitness('projectedDisabled');
        const projection=item.bodyPushProjection;if(!projection)return rejectWitness('unverifiedProjection');
        const obstacle=contactContext?.actors.find(actor=>actor.id===contactContext.localId);
        if(!obstacle||obstacle.id!==projection.obstacleId||obstacle.hp<=0||obstacle.pvpDead||obstacle.pvpDisconnected||obstacle.hidden||
          axes.some(key=>Math.abs(obstacle[key]-projection.obstaclePose[key])>1e-6))return rejectWitness('obstacleChanged');
        // The later attack captures this same current obstacle position. A
        // receiver can reproduce a pure push from its named raw source body
        // and that captured attacker; no prior projected chain is transmitted.
        const pushed=nativeBodyPushWitnessPosition(projection.targetPose,projection.targetProfile,obstacle,projection.obstacleProfile);
        if(!pushed||axes.some((key,axis)=>Math.abs(pushed[axis]-item.pose[key])>1e-6))return rejectWitness('unverifiedProjection');
        bodyPushFrames.push(item.frameSeq);
      }
      if(axes.some(key=>Math.abs(weights.reduce((sum,[item,weight])=>sum+item.pose[key]*weight,0)-row.shown[key])>1e-6))return rejectWitness('positionMismatch');
      if(sample.pose.state!==row.shown.state||sample.pose.stateSerial!==row.shown.stateSerial)return rejectWitness('controllerMismatch');
      const reference={epoch:row.epoch,frameSeq:sample.frameSeq,position:axes.map(key=>row.shown[key])};
      if(weights.length===1){
        if(Math.abs((sample.pose.animationTime??0)-(row.shown.animationTime??0))>1e-6)return rejectWitness('controllerMismatch');
      }else reference.positionSamples=weights.map(([item,weight])=>({frameSeq:item.frameSeq,weight}));
      if(bodyPushFrames.length){reference.bodyPushFrames=bodyPushFrames;witnessCounts.bodyPushAccepted++;}
      witnessCounts.accepted++;return reference;
    },
    contacts(actors,localId,{now=clock()}={}){
      if(!captureContacts)return [];
      contactContext={actors,localId};
      const result=[];
      for(const actor of actors){
        if(actor.id===localId)continue;
        sampleActor(actor,now);const row=rows.get(actor.id);
        if(!row)continue;
        let index=0;while(index+1<row.samples.length&&row.samples[index+1].time<=row.cursor)index++;
        const saved=row.samples[index].contact;if(!saved)continue;
        // The very same filtered position and controller pose is used for
        // drawing and contact. Other contact fields switch at source samples.
        // Live HUD buff lists are deliberately not replaced by this history.
        const view={...actor},detached=structuredClone(saved);
        for(const key of CONTACT_FIELDS)view[key]=detached[key];
        result.push(Object.assign(view,row.shown));
      }
      return result;
    },
    sample(actors,localId,{now=clock(),exact=false}={}){
      if(exact)return actors;
      return actors.map(actor=>actor.id===localId?actor:sampleActor(actor,now));
    },
    reset(id){rows.delete(id);},
    clear(){rows.clear();contactContext=null;bodyPushWitnessVersion=0;for(const key of Object.keys(counts))counts[key]=0;for(const key of Object.keys(witnessCounts))witnessCounts[key]=0;},
    diagnostics(){return {...counts,bodyPushWitnessVersion,witnesses:{...witnessCounts},peers:Object.fromEntries([...rows].map(([id,row])=>[id,{
      epoch:row.epoch,frameSeq:row.frameSeq,samples:row.samples.length,bufferMs:row.delay,
      sourceCursorMs:row.cursor,behindNewestMs:Math.max(0,row.samples.at(-1).time-row.cursor),
      heldMs:row.held,recovering:row.recovery!==null}]))};},
  };
}
