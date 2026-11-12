/** Web deployment policy: players share this server's 5 Mbps egress. Reserve
 * transfer time for each cold GLB plus parsing/setup, rather than ejecting a
 * healthy player at the old flat 30-second deadline. Local full clients still
 * need CPU time for cold body/pose, effect and shader preparation: reserve at
 * least two minutes, capped at three. Heartbeats remain a separate 20s gate.
 */
export function mapLoadingBudget(geometryBytes,players,{outboundBitsPerSecond=5_000_000,minimumSeconds=120,maximumSeconds=180,setupSeconds=90}={}){
  if(!Number.isSafeInteger(geometryBytes)||geometryBytes<0||!Number.isSafeInteger(players)||players<1||players>6
    ||![outboundBitsPerSecond,minimumSeconds,maximumSeconds,setupSeconds].every(Number.isFinite)
    ||outboundBitsPerSecond<=0||minimumSeconds<=0||maximumSeconds<minimumSeconds||setupSeconds<0)throw Error('invalid-map-loading-budget');
  return Math.min(maximumSeconds,Math.max(minimumSeconds,Math.ceil(geometryBytes*players*8/outboundBitsPerSecond+setupSeconds)));
}
