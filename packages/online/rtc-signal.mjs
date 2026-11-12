/** Signaling identities are separate from combat/life counters. sourceEpoch
 * is assigned by the authenticated coordinator, never accepted from a sender. */
export const RTC_SIGNAL_VERSION=1;
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function readRtcSignalIdentity(value,{received=false}={}){
  if(!value||value.signalVersion!==RTC_SIGNAL_VERSION||!positive(value.generation)
    ||typeof value.offerId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value.offerId)
    ||received&&!positive(value.sourceEpoch))throw new TypeError('invalid-signal-identity');
  return {signalVersion:RTC_SIGNAL_VERSION,generation:value.generation,offerId:value.offerId,
    ...(received?{sourceEpoch:value.sourceEpoch}:{})};
}
export function compareRtcSignalIdentity(a,b){
  return a.sourceEpoch!==b.sourceEpoch?Math.sign(a.sourceEpoch-b.sourceEpoch):Math.sign(a.generation-b.generation);
}
export function rtcSdpUfrag(sdp){return typeof sdp==='string'?/^a=ice-ufrag:([^\r\n]+)$/m.exec(sdp)?.[1]??null:null;}
export function rtcCandidateUfrag(candidate){
  return candidate?.usernameFragment??(typeof candidate?.candidate==='string'?/(?:^|\s)ufrag\s+(\S+)/.exec(candidate.candidate)?.[1]??null:null);
}
