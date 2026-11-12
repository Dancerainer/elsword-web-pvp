/** Privacy-preserving native WebRTC statistics. An open channel is not route proof. */
import {MODE_CONFIG,queueWaitSeconds} from '../packages/online/modes.mjs';

/** The coordinator starts one room per matching deadline. This bounds only
 * waiting for the requested lobby layout, independently of network timeouts. */
export function multiRoomMatchWait(mode,rooms) {
  if(!MODE_CONFIG[mode]||!Number.isSafeInteger(rooms)||rooms<1||rooms>3)throw Error('invalid-fixture-room-layout');
  let normalQueueWaitMs=0;
  for(let remaining=(rooms-1)*MODE_CONFIG[mode].playerCount;remaining>0;remaining-=MODE_CONFIG[mode].playerCount)
    normalQueueWaitMs+=queueWaitSeconds(mode,remaining)*1000;
  return {normalQueueWaitMs,timeoutMs:Math.max(15000,normalQueueWaitMs+4000)};
}

export function summarizeNativeRtcStats(values) {
  const rows = Array.from(values), byId = new Map(rows.map(row => [row.id, row]));
  const transport = rows.find(row => row.type === 'transport' && row.selectedCandidatePairId);
  const pair = transport ? byId.get(transport.selectedCandidatePairId)
    : rows.find(row => row.type === 'candidate-pair' && row.selected === true);
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  const candidateType = row => ['host', 'srflx', 'prflx', 'relay'].includes(row?.candidateType) ? row.candidateType : null;
  const local = pair && byId.get(pair.localCandidateId), remote = pair && byId.get(pair.remoteCandidateId);
  const localCandidateType = candidateType(local), remoteCandidateType = candidateType(remote);
  const selected = pair?.type === 'candidate-pair' && pair.state === 'succeeded';
  return {
    selectionEvidence: {
      transportCount: rows.filter(row => row.type === 'transport').length,
      pairCount: rows.filter(row => row.type === 'candidate-pair').length,
      explicitTransportSelection: Boolean(transport),
      referencedPairPresent: Boolean(pair),
      referencedPairState: ['succeeded','in-progress','failed','waiting','frozen'].includes(pair?.state) ? pair.state : null,
      localCandidatePresent: Boolean(local), remoteCandidatePresent: Boolean(remote),
    },
    selected: Boolean(selected),
    route: !selected ? 'unknown' : localCandidateType === 'relay' || remoteCandidateType === 'relay' ? 'relay'
      : localCandidateType && remoteCandidateType ? 'direct' : 'unknown',
    localCandidateType: selected ? localCandidateType : null,
    remoteCandidateType: selected ? remoteCandidateType : null,
    protocol: selected && ['udp', 'tcp'].includes(local?.protocol) ? local.protocol : null,
    roundTripTimeMs: selected && number(pair.currentRoundTripTime) !== null ? pair.currentRoundTripTime * 1000 : null,
    pairBytesSent: selected ? number(pair.bytesSent) : null,
    pairBytesReceived: selected ? number(pair.bytesReceived) : null,
    channels: rows.filter(row => row.type === 'data-channel').map(row => ({
      label: row.label, state: row.state,
      messagesSent: number(row.messagesSent), messagesReceived: number(row.messagesReceived),
      bytesSent: number(row.bytesSent), bytesReceived: number(row.bytesReceived),
    })),
  };
}

/** A missing selection is not replaced with historical evidence. Final observers
 * may ask the same live PC at most three times; every attempt is retained without
 * candidate addresses. Periodic observers and closed PCs make one request. */
export async function collectNativeRtcStats(connection, {retryMissingSelection=false, pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const types=new Set(['transport','candidate-pair','local-candidate','remote-candidate','data-channel']);
  const attempts=[];let rawStats=[];
  for(let index=0;index<(retryMissingSelection?3:1);index++) {
    rawStats=[...(await connection.getStats()).values()].filter(row=>types.has(row.type));
    const stats=summarizeNativeRtcStats(rawStats);
    attempts.push({atWallMs:Date.now(),connectionState:connection.connectionState,stats});
    if(stats.selected&&stats.route!=='unknown'||connection.connectionState!=='connected'||!retryMissingSelection)break;
    if(index<2)await pause(25);
  }
  return {rawStats,attempts};
}

/** Cumulative admission/bytes alone cannot establish a healthy current P2P path. */
export function assessOnlinePeerHealth(peer,{peerMode='hybrid',fault='none',closedDirectedPairs=[],expectedNativeCreditLimit=4}={}) {
  if(!Number.isSafeInteger(expectedNativeCreditLimit)||expectedNativeCreditLimit<1)throw Error('invalid-expected-native-credit-limit');
  const reasons=[],transport=peer.transport??{},closed=new Set(closedDirectedPairs);
  if(transport.ownerFatal!==null)reasons.push('source-fatal:'+peer.playerId);
  if(peerMode!=='hybrid')return reasons;
  for(const [id,control]of Object.entries(transport.peerControls??{})) {
    const key=peer.playerId+'/'+id;
    if(!control.negotiated||control.failed||control.degraded)reasons.push('current-control-unhealthy:'+key);
    if(!control.frontierComplete)reasons.push('current-control-frontier-incomplete:'+key);
    if(control.creditLimit!==expectedNativeCreditLimit||!Number.isSafeInteger(control.inflightPackets)||control.inflightPackets<0||control.inflightPackets>expectedNativeCreditLimit)reasons.push('native-control-credit-invalid:'+key);
    if(control.wire?.encodeFailures!==0||control.wire?.decodeFailures!==0)reasons.push('control-codec-failure:'+key);
  }
  for(const [id,row]of Object.entries(transport.peerActionLedgers??{}))if(row.disabled)reasons.push('peer-ledger-disabled:'+peer.playerId+'/'+id);
  for(const [id,restarts]of Object.entries(transport.peerRestarts??{})) {
    if(!Number.isSafeInteger(restarts)||restarts<0||restarts>0&&(fault!=='one-pair-close'||!closed.has(peer.playerId+'/'+id)))reasons.push('unexpected-peer-restart:'+peer.playerId+'/'+id);
  }
  return reasons;
}

export function assessNativeRtcEvidence(report) {
  const reasons = [];
  const peers = report.final ?? [], expected = report.players * (report.players - 1);
  if (peers.length !== report.players) reasons.push('missing-browser-peer');
  const pairs = peers.flatMap(peer => peer.pairs ?? []);
  if (pairs.length !== expected) reasons.push('missing-directed-pair');
  for (const peer of peers) {
    if (peer.errors?.length) reasons.push('browser-error');
    for (const pair of peer.pairs ?? []) {
      const key = `${peer.playerId}/${pair.playerId}`;
      if (!pair.everSelected) reasons.push(`unproven-selected-route:${key}`);
      if (!(pair.pose.received > 0) || !(pair.control.received > 0) || !(pair.control.acknowledged > 0)) reasons.push(`missing-application-delivery:${key}`);
      if (pair.control.orderViolations !== 0) reasons.push(`reliable-channel-order:${key}`);
      const channels = pair.stats?.channels ?? [];
      if (!channels.some(row => row.label === 'input' && row.bytesSent > 0 && row.bytesReceived > 0)
        || !channels.some(row => row.label === 'control' && row.bytesSent > 0 && row.bytesReceived > 0)) reasons.push(`missing-native-channel-bytes:${key}`);
    }
  }
  if (report.fault === 'one-pair-close') {
    if (!report.faultReceipt?.closedDirectedPairs?.length) reasons.push('pair-close-not-applied');
    const closed = new Set(report.faultReceipt?.closedDirectedPairs ?? []);
    for (const peer of peers) for (const pair of peer.pairs ?? []) {
      const key = `${peer.playerId}/${pair.playerId}`;
      if (!closed.has(key) && !(pair.pose.received > (report.faultReceipt?.beforeReceived?.[key] ?? Infinity))) reasons.push(`healthy-pair-stalled:${key}`);
    }
  }
  if (report.fault === 'critical-late' && !pairs.some(pair => pair.pose.aheadOfControl > 0)) reasons.push('cross-channel-order-fault-not-observed');
  return {passed: reasons.length === 0, reasons: [...new Set(reasons)], scope: 'native-RTC-mesh-transport-and-synthetic-application-ACK'};
}
