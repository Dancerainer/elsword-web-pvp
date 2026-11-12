/** Read-only postprocessing of shared-wire measurements. Does not change gates,
 * scheduling, production packets or the result of the underlying v7 job. */
import {distribution} from '../network-room-metrics-v5.mjs';

export function summarizeCapacityHeadroom({result, wire}) {
  const start=result.concurrency?.startWallMs,end=result.concurrency?.endWallMs;
  const bins=new Map(wire.bins.map(row=>[row.atWallMs,row]));
  const rows=[];
  if(Number.isFinite(start)&&Number.isFinite(end)) {
    for(let at=Math.ceil((start+5000)/100)*100;at+1000<=end;at+=100) {
      let bytes=0;
      for(let offset=0;offset<1000;offset+=100)bytes+=bins.get(at+offset)?.down??0;
      rows.push({atWallMs:at,downBytes:bytes,mbps:bytes*8/1e6});
    }
  }
  const rates={...distribution(rows.map(row=>row.mbps)),min:rows.length?Math.min(...rows.map(row=>row.mbps)):null};
  const queueRows=(wire.queueSamples??[]).filter(row=>row.atWallMs>=start+5000&&row.atWallMs<end);
  const down=wire.flows.filter(row=>row.direction==='down');
  const observedOverheadMargin=rate=>rate===null?null:10-rate;
  const failures=[];
  const method=result.method??{},rooms=method.rooms??[],coverage=result.health?.consumptionCoverage;
  if(rooms.length!==2||rooms.some(mode=>mode!=='2v2')||method.players!==8||method.rtc!==false
      ||method.sharedBottleneck!==true||method.egressMbps!==10||wire.method?.egressBytesPerSecond!==1250000)failures.push('unexpected-two-room-wire-contract');
  if(wire.phase!=='pre-server-stop'||!Number.isFinite(wire.capturedAtWallMs))failures.push('missing-authoritative-pre-stop-snapshot');
  const queueTimes=queueRows.map(row=>row.atWallMs),queueGaps=queueTimes.slice(1).map((at,i)=>at-queueTimes[i]);
  const queueCoverage=queueRows.length>0&&queueTimes[0]<=start+5000+250&&queueTimes.at(-1)>=end-250&&queueGaps.every(gap=>gap<=250);
  if(!queueCoverage)failures.push('incomplete-steady-queue-observation');
  const coverageFields=['steadyObserved','matchedSource','unmatchedCanonicalIdentity','missingGeneratedSource','sourceOutsideSteady'];
  if(!coverage||!coverageFields.every(key=>Number.isSafeInteger(coverage[key])&&coverage[key]>=0)||coverage.steadyObserved<=0
      ||coverage.steadyObserved!==coverage.matchedSource+coverage.unmatchedCanonicalIdentity+coverage.missingGeneratedSource+coverage.sourceOutsideSteady
      ||coverage.unmatchedCanonicalIdentity>0||coverage.missingGeneratedSource>0)failures.push('unverified-steady-action-consumption');
  const discarded=down.filter(row=>(row.abortedQueuedBytes??0)>0),steadyDiscarded=discarded.filter(row=>row.closedAtWallMs>=start+5000&&row.closedAtWallMs<end),
    unclassifiedDiscarded=discarded.filter(row=>!Number.isFinite(row.closedAtWallMs));
  if(steadyDiscarded.length||unclassifiedDiscarded.length)failures.push('steady-or-unclassified-downstream-discard');
  const snapshotDownQueuedBytes=down.reduce((sum,row)=>sum+(row.queuedBytes??0),0);
  if(snapshotDownQueuedBytes>0)failures.push('pre-stop-downstream-tail-not-drained');
  if(!result.integrity?.passed)failures.push('underlying-integrity-failed');
  if(!result.health?.qualityPassed)failures.push('underlying-quality-failed');
  if(!rows.length)failures.push('no-complete-sliding-window');
  if(rates.p95>8.5)failures.push('sliding-p95-exceeds-8.5mbps');
  if(rates.max>9)failures.push('sliding-peak-exceeds-9mbps');
  return {
    schemaVersion:1,scope:'Two-room all-relay native activity over a shared 10 Mbps raw TCP proxy; complete 1-second windows every 100 ms after 5-second warmup.',
    passed:failures.length===0,failures,
    slidingOneSecondMbps:rates,applicationMarginMbps:{p95:observedOverheadMargin(rates.p95),peak:observedOverheadMargin(rates.max)},
    sharedDownQueueBytes:distribution(queueRows.map(row=>row.downQueuedBytes)),
    readyDownQueueBytes:distribution(queueRows.map(row=>row.readyDownQueuedBytes)),
    completeRunMaxSharedDownQueuedBytes:wire.maxSharedDownQueuedBytes??null,
    completeRunMaxReadyWaitMs:down.length?Math.max(...down.map(row=>row.maxReadyWaitMs??0)):null,
    snapshotDownQueuedBytes,steadyDiscardedDownQueuedBytes:steadyDiscarded.reduce((sum,row)=>sum+row.abortedQueuedBytes,0),
    outOfSteadyDiscardedDownQueuedBytes:discarded.filter(row=>!steadyDiscarded.includes(row)&&!unclassifiedDiscarded.includes(row)).reduce((sum,row)=>sum+row.abortedQueuedBytes,0),
    queueObservation:{complete:queueCoverage,samples:queueRows.length,maximumGapMs:queueGaps.length?Math.max(...queueGaps):null},
    consumptionCoverage:coverage??null,authoritativeSnapshot:{phase:wire.phase??null,capturedAtWallMs:wire.capturedAtWallMs??null},
    disconnectedDownQueuedBytes:down.reduce((sum,row)=>sum+(row.abortedQueuedBytes??0),0),
    underlyingIntegrity:result.integrity,underlyingQuality:result.health?.qualityPassed,
    activity:result.activity,concurrency:result.concurrency,
    limitations:['100 ms bins cannot resolve shorter bursts or precise 250 ms peaks.','No IP/TCP/TLS headers, kernel retransmission or physical WAN/NAT capacity claim.','Queue fields include setup and expected connection shutdown unless explicitly labelled steady-overlap.','Out-of-steady discarded bytes remain discarded bytes; they are classified, never called delivered.','A pass is this finite workload result, not a universal room-capacity guarantee.']
  };
}
