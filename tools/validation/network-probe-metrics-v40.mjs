/** Original v38 metric definitions kept unchanged for per-trace comparison. */
import {distribution,stepMs} from './network-fault-model-v38.mjs';
export function measureStutter(samples,frames=480){
  const velocityError=[],accelerationError=[],jerkError=[],actionClockErrors=[];let movingFrames=0,zeroAdvanceFrames=0,backwardFrames=0,actionClockBacksteps=0;
  for(const direction of [0,1]){
    const rows=samples.filter(row=>row.direction===direction&&row.frame<=frames);let previousResidual=null,previousAcceleration=null;
    for(let index=1;index<rows.length;index++){
      const row=rows[index],prior=rows[index-1],source=row.x-prior.x,observed=row.observedX-prior.observedX,residual=observed-source;
      velocityError.push(Math.abs(residual));
      const sameSource=prior.sourceState===row.sourceState&&prior.sourceSerial===row.sourceSerial,
        sameObserver=prior.observedState===row.observedState&&prior.observedSerial===row.observedSerial,
        action=!['RSI_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END'].includes(row.observedState);
      const naturalLoop=row.observedAnimationLoop&&row.observedAnimationTransitionSerial>prior.observedAnimationTransitionSerial&&row.observedAnimationTime<=1e-6&&row.observedPhase>=prior.observedPhase;
      if(action&&sameObserver&&sameSource&&!naturalLoop&&row.sourceAnimationTime>=prior.sourceAnimationTime-1e-6&&row.observedAnimationTime<prior.observedAnimationTime-1e-6)actionClockBacksteps++;
      if(action&&row.sourceState===row.observedState&&row.sourceSerial===row.observedSerial)actionClockErrors.push(Math.abs(row.sourceAnimationTime-row.observedAnimationTime));
      if(Math.abs(source)>.1){movingFrames++;if(Math.abs(observed)<.1)zeroAdvanceFrames++;if(source*observed<-.01)backwardFrames++;}
      if(previousResidual!==null){const acceleration=residual-previousResidual;accelerationError.push(Math.abs(acceleration));
        if(previousAcceleration!==null)jerkError.push(Math.abs(acceleration-previousAcceleration));previousAcceleration=acceleration;}
      previousResidual=residual;
    }
  }
  return {movingFrames,zeroAdvanceFrames,zeroAdvanceRatio:movingFrames?zeroAdvanceFrames/movingFrames:0,backwardFrames,
    velocityResidualPerFrame:distribution(velocityError),accelerationResidualPerFrame2:distribution(accelerationError),jerkResidualPerFrame3:distribution(jerkError),
    actionClockBacksteps,matchedActionClockErrorSeconds:distribution(actionClockErrors)};
}
export function measureVertical(samples,frames=480){
  const rows=samples.filter(row=>row.direction===1&&row.frame<=frames),air=rows.filter(row=>!row.sourceGrounded||!row.observedGrounded),reactionEvents=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i],previous=rows[i-1];if(!/^(?:RSI_DAMAGE_AIR_(?:UP|DOWN)$|RSI_DAMAGE_SMALL_)/.test(row.sourceState)||row.sourceSerial===previous.sourceSerial&&row.sourceState===previous.sourceState)continue;
    const window=rows.slice(i,i+61),found=window.find(candidate=>candidate.observedState===row.sourceState&&candidate.observedSerial===row.sourceSerial);
    reactionEvents.push({state:row.sourceState,serial:row.sourceSerial,sourceFrame:row.frame,observedFrame:found?.frame??null,
      ms:found?(found.frame-row.frame)*stepMs:null,censored:!found,windowMs:(window.length-1)*stepMs});
  }
  return {airFrames:air.length,heightError:distribution(air.map(row=>row.yError)),velocityError:distribution(air.map(row=>Math.abs(row.sourceVy-row.observedVy))),
    phaseDisagreementFrames:rows.filter(row=>row.sourceGrounded!==row.observedGrounded).length,
    staleRisingFrames:rows.filter(row=>row.sourceVy< -100&&row.observedVy>100).length,reactionEvents};
}
export function measureBody(samples,body,frames=480){
  const width=body.UNIT_WIDTH,height=body.UNIT_HEIGHT,penetrations=[],adhesionEpisodes=[];let overlapFrames=0;
  for(const direction of [0,1]){
    const rows=samples.filter(row=>row.direction===direction&&row.frame<=frames);let consecutive=0,start=null;
    for(let i=1;i<rows.length;i++){
      const row=rows[i],prior=rows[i-1],vertical=Math.abs(row.observedY-row.localOtherY)<=height,penetration=vertical?Math.max(0,width-row.observedGap):0;
      if(penetration>.01)overlapFrames++;penetrations.push(penetration);
      // A symptom signature, not proof of unwanted force: observer remains
      // body-adjacent and follows its own player while true owners separated.
      const follower=Math.abs((row.observedX-prior.observedX)-(row.localOtherX-prior.localOtherX))<1,
        signature=vertical&&row.observedGap<=width+3&&row.sourceGap>width*1.5&&Math.abs(row.localOtherX-prior.localOtherX)>.1&&follower;
      if(signature){consecutive++;start??=row.frame;}
      else if(consecutive){adhesionEpisodes.push({direction,start,frames:consecutive,ms:consecutive*stepMs});consecutive=0;start=null;}
    }
    if(consecutive)adhesionEpisodes.push({direction,start,frames:consecutive,ms:consecutive*stepMs});
  }
  return {width,height,overlapFrames,penetration:distribution(penetrations),adhesionEpisodes,
    maximumAdhesionSignatureMs:Math.max(0,...adhesionEpisodes.map(row=>row.ms)),totalAdhesionSignatureMs:adhesionEpisodes.reduce((sum,row)=>sum+row.ms,0)};
}
