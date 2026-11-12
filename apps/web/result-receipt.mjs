/** Match identity makes repeated SSE/poll delivery idempotent. Presentation is
 * not acknowledgment: only an explicit result dismissal persists locally.
 * This UI receipt never recalculates a result or changes server awards. */
export function createResultReceipt({limit=64,storage}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>256)throw new TypeError('invalid-result-receipt-limit');
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const shown=new Set(),dismissed=new Map(),identity=value=>typeof value==='string'&&value.length>0&&value.length<=256;
  const key=playerId=>'webpvp:result-dismissed:v1:'+JSON.stringify(playerId);
  const trim=values=>{while(values.size>limit)values.delete(values.values().next().value);};
  function acknowledgments(playerId){
    const values=dismissed.get(playerId)??new Set();dismissed.set(playerId,values);
    try{
      const value=JSON.parse(storage?.getItem(key(playerId))??'null');
      if(value?.version===1&&Array.isArray(value.matchIds)&&value.matchIds.length<=256)
        for(const matchId of value.matchIds)if(identity(matchId))values.add(matchId);
    }catch{}
    trim(values);return values;
  }
  function persist(matchId,playerId){
    const values=acknowledgments(playerId);values.delete(matchId);values.add(matchId);trim(values);
    try{storage?.setItem(key(playerId),JSON.stringify({version:1,matchIds:[...values]}));}catch{}
    return true;
  }
  return {accept(value,{activeMatchId=null,playerId,mode='lobby'}={}){
    if(!identity(value?.matchId)||!identity(playerId))return null;
    const token=JSON.stringify([playerId,value.matchId]);
    if(shown.has(token)||acknowledgments(playerId).has(value.matchId))return null;
    const result=value.result;
    if(!result||!Array.isArray(result.players)||!result.players.some(player=>player.id===playerId))return null;
    const active=value.matchId===activeMatchId,recovered=!activeMatchId&&mode==='lobby';
    if(!active&&!recovered)return null;
    shown.add(token);trim(shown);
    return {result,recovered,matchId:value.matchId,playerId};
  },dismiss({matchId,playerId}={}){
    if(!identity(matchId)||!identity(playerId)||!shown.has(JSON.stringify([playerId,matchId])))return false;
    return persist(matchId,playerId);
  },skipEndedReconnect({matchId,playerId}={}){
    // Only the authenticated server's ended-reconnect event invokes this.
    // Product policy returns an absent player to the lobby without opening a
    // historical result. Do not change accept/dismiss for normal result flow.
    if(!identity(matchId)||!identity(playerId))return false;
    return persist(matchId,playerId);
  }};
}
