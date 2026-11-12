/** Private, bounded failure evidence. Normal runs never call snapshot or
 * serialize actors. Credentials/headers are not accepted as evidence fields. */
const sensitive=/^(?:password|passwd|cookie|set-cookie|authorization|secret|token|accessToken|refreshToken|sessionToken)$/i;
function safe(value,seen=new Set(),depth=0){
  if(value===null||typeof value!=='object')return typeof value==='bigint'?String(value):value;
  if(depth>48)return {omitted:'maximum evidence nesting depth'};
  if(seen.has(value))return {omitted:'circular evidence reference'};seen.add(value);
  const result=Array.isArray(value)?value.map(row=>safe(row,seen,depth+1)):Object.fromEntries(Object.entries(value).map(([key,row])=>[key,sensitive.test(key)?'[redacted]':safe(row,seen,depth+1)]));
  seen.delete(value);return result;
}
const bytes=value=>Buffer.byteLength(JSON.stringify(value)??'null','utf8');
const actorKeys=new Set(['id','professionId','profileId','team','state','stateSerial','stateTime','animationName','animationTime','animationLoop','presentationTransition',
  'hp','hpMax','mp','mpMax','x','y','z','facing','loadout','passives','guildPassives','buffs','skillId','skillSlot','skillBuild','skillPreferences','epoch','pvpDead','pvpDisconnected']);
export function createPeerFailureEvidence({maximumBytes=1024*1024,clock=()=>Date.now()}={}){
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<4096)throw Error('failure evidence budget must be at least 4096 bytes');
  let captured=null;
  return {
    capture(error,{simulation,localPlayerId,eventType=null,value=null,presets={}}={}){
      if(captured!==null)return false;
      const record={schemaVersion:1,scope:'Private first-failure native peer state; no credentials or HTTP headers; no original-client trace',atWallMs:clock(),localPlayerId,
        error:{name:String(error?.name??'Error').slice(0,128),message:String(error?.message??error).slice(0,16384),stack:String(error?.stack??'Unavailable').slice(0,32768)},
        trigger:{eventType,playerId:value?.playerId??null,epoch:value?.epoch??value?.report?.epoch??null,frameSeq:value?.frameSeq??value?.report?.frameSeq??null},actors:[],omitted:[]};
      let snapshot;
      try{snapshot=simulation?.snapshot?.();}catch(snapshotError){record.snapshotError=String(snapshotError.message);}
      const actors=snapshot?.actors??[];
      // Identity remains visible even when the state is too large. Prioritize
      // the local actor and triggering owner, then retain fields independently.
      for(const actor of actors)record.actors.push(safe(Object.fromEntries(['id','professionId','profileId','team','state','stateSerial','skillId'].filter(key=>actor[key]!==undefined).map(key=>[key,actor[key]]))));
      const reserve=Math.min(2048,Math.floor(maximumBytes/4));
      function include(target,key,input,label){const candidate=safe(input);target[key]=candidate;
        if(bytes(record)>maximumBytes-reserve){const originalBytes=bytes(candidate);delete target[key];record.omitted.push({field:label,reason:'evidence byte budget',originalBytes});
          if(record.omitted.length>32)record.omitted.splice(31,record.omitted.length-31,{field:'additional fields',reason:'further omissions combined'});}}
      const ordered=[...actors].sort((a,b)=>(a.id===localPlayerId?-2:a.id===value?.playerId?-1:0)-(b.id===localPlayerId?-2:b.id===value?.playerId?-1:0));
      for(const actor of ordered){const target=record.actors.find(row=>row.id===actor.id);for(const [key,input]of Object.entries(actor))if(!Object.hasOwn(target,key)&&(actorKeys.has(key)||/^(?:source|passive|buff)/i.test(key)))include(target,key,input,`actor:${actor.id}.${key}`);
        const preset=presets[actor.professionId];if(preset)include(target,'configuredPreset',{passives:preset.passives,guildPassives:preset.guildPassives,loadout:preset.loadout},`actor:${actor.id}.configuredPreset`);}
      if(value)include(record.trigger,'payload',{...Object.fromEntries(['playerId','matchId','epoch','frameSeq','report','actions','pvp'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])),
        ...(value.snapshot?{snapshot:{actors:value.snapshot.actors,tick:value.snapshot.tick,time:value.snapshot.time,versions:value.snapshot.versions}}:{})},'trigger.payload');
      let serialized=JSON.stringify(record);
      if(Buffer.byteLength(serialized)>maximumBytes){const minimal={schemaVersion:1,atWallMs:record.atWallMs,error:{name:record.error.name,message:record.error.message.slice(0,1024),stack:record.error.stack.slice(0,2048)},omitted:[{field:'state and error text tail',reason:'minimum evidence envelope exceeds byte budget'}]};
        serialized=JSON.stringify(minimal);while(Buffer.byteLength(serialized)>maximumBytes){minimal.error.message=minimal.error.message.slice(0,Math.floor(minimal.error.message.length/2));minimal.error.stack=minimal.error.stack.slice(0,Math.floor(minimal.error.stack.length/2));serialized=JSON.stringify(minimal);}}
      captured=serialized;return true;
    },
    get serialized(){return captured;},
    get byteLength(){return captured===null?0:Buffer.byteLength(captured,'utf8');},
  };
}
