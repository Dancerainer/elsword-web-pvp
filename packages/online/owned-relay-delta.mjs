/** Reliable-channel codec. Every replaceable patch references stable per-life
 * actor / per-effect birth baselines, never a replaceable previous patch. New
 * baselines are critical FIFO messages, so coalescing cannot break decoding.
 * Resulting full reports still go through the ordinary ownership validators. */
import {createOwnedActionDelta} from './owned-action-delta.mjs';
import {needsFullOwnedBuffList} from './owned-buff-identity.mjs';
import {continuousAuraBaseline} from '../combat-core/continuous-aura.mjs';
const clone=value=>structuredClone(value);
// Only an explicitly supplied synchronous, read-only broadcast identity is
// cached. Ordinary callers can freely reuse/mutate their report objects.
const broadcastCache=new WeakMap();
const forbidden=new Set(['__proto__','prototype','constructor']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function safeTree(value,depth=0){
 if(depth>18)throw Error('owned-relay-too-deep');
 if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=512||typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){if(value.length>512)throw Error('owned-relay-too-large');for(const item of value)safeTree(item,depth+1);return;}
 if(!plain(value)||Object.keys(value).length>512)throw Error('invalid-owned-relay-tree');
 for(const [key,item]of Object.entries(value)){if(forbidden.has(key)||key.length>128)throw Error('invalid-owned-relay-key');safeTree(item,depth+1);}
}
// Stable birth baselines make every dynamic patch independently replaceable.
// Recurse into dictionaries so a single cooldown/core clock does not resend
// all its unchanged siblings. Arrays keep their exact original JSON values.
function narrowDifference(value,baseline){
 const fields={},removed=[],nested={};
 for(const [key,item]of Object.entries(value)){
  const prior=baseline[key];
  if(Object.is(item,prior))continue;
  if(plain(item)&&plain(prior)){
   const patch=narrowDifference(item,prior);
   if(Object.keys(patch.fields).length||patch.removed.length||Object.keys(patch.nested??{}).length)nested[key]=patch;
  }else if(JSON.stringify(item)!==JSON.stringify(prior))fields[key]=clone(item);
 }
 for(const key of Object.keys(baseline))if(!Object.hasOwn(value,key))removed.push(key);
 return {fields,removed,...(Object.keys(nested).length?{nested}:{})};
}
function restoreNarrow(patch,baseline,depth=0){
 if(depth>18||!plain(patch)||!plain(patch.fields)||!Array.isArray(patch.removed)
  ||Object.keys(patch).some(key=>!['fields','removed','nested'].includes(key))
  ||patch.nested!==undefined&&!plain(patch.nested)||!plain(baseline))throw Error('invalid-owned-relay-patch');
 const value=clone(baseline),used=new Set();
 const check=key=>{if(typeof key!=='string'||key.length>128||forbidden.has(key)||used.has(key))throw Error('invalid-owned-relay-key');used.add(key);};
 for(const key of patch.removed){check(key);delete value[key];}
 for(const [key,item]of Object.entries(patch.fields)){check(key);safeTree(item);value[key]=clone(item);}
 for(const [key,item]of Object.entries(patch.nested??{})){check(key);if(!plain(baseline[key]))throw Error('owned-relay-nested-baseline-required');value[key]=restoreNarrow(item,baseline[key],depth+1);}
 return value;
}
function difference(value,baseline){
 const fields={},removed=[];
 for(const [key,item]of Object.entries(value))if(JSON.stringify(item)!==JSON.stringify(baseline[key]))fields[key]=clone(item);
 for(const key of Object.keys(baseline))if(!Object.hasOwn(value,key))removed.push(key);
 return {fields,removed};
}
function restore(patch,baseline){
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||!patch.fields||typeof patch.fields!=='object'||Array.isArray(patch.fields)
  ||!Array.isArray(patch.removed)||patch.removed.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)))throw Error('invalid-owned-relay-patch');
 const value=clone(baseline);for(const key of patch.removed)delete value[key];
 for(const [key,item]of Object.entries(patch.fields)){if(['__proto__','prototype','constructor'].includes(key))throw Error('invalid-owned-relay-patch');value[key]=clone(item);}return value;
}
export function createOwnedRelayDelta(){
 const rows=new Map(),actions=createOwnedActionDelta();
 const fresh=epoch=>({epoch,actor:null,actorSource:null,effects:new Map(),effectSources:new Map(),buffs:new Map(),buffSources:new Map()});
 function rowFor(id,report){let row=rows.get(id);if(!row||row.epoch!==report.epoch){row=fresh(report.epoch);rows.set(id,row);}return row;}
 function prospective(id,epoch){
  const previous=rows.get(id);if(previous&&epoch<previous.epoch)throw Error('owned-relay-old-life');
  return previous?.epoch===epoch?{...previous,effects:new Map(previous.effects),effectSources:new Map(previous.effectSources),
   buffs:new Map(previous.buffs),buffSources:new Map(previous.buffSources)}:fresh(epoch);
 }
 function remember(row,report){if(!row.actor){row.actor=clone(report.actor);row.actorSource=report.actor;}for(const effect of report.effects)if(!row.effects.has(effect.id)){row.effects.set(effect.id,clone(continuousAuraBaseline(effect)));row.effectSources.set(effect.id,effect);}
  // Living baselines cannot be evicted. Retired identities are bounded just as
  // collision ledgers are; source effect IDs are monotonically generated.
  const live=new Set(report.effects.map(e=>e.id));for(const id of row.effects.keys())if(row.effects.size>512&&!live.has(id)){row.effects.delete(id);row.effectSources.delete(id);}
 }
 return {
  encodeActions:(playerId,data,options)=>actions.encode(playerId,data,options),
  decodeActions:data=>actions.decode(data),
  encodeSplit(playerId,report,{cacheKey=null,deltaVersion=2}={}){
   if(![2,3].includes(deltaVersion))throw Error('invalid-owned-relay-version');
   const row=rowFor(playerId,report),first=!row.actor;
   const births=report.effects.filter(effect=>!row.effects.has(effect.id));
   remember(row,report);
   // Stackable Buff identity is unique by template. Native immediate MP
   // templates 97/98 retain separate applications, so their rare duplicate
   // frame keeps the entire ordered list. Version 3 otherwise sends its fixed
   // definition once, then only mutable lifetime,
   // stack/stat changes. Every patch still references that reliable birth;
   // dropping intermediates cannot resurrect an expired debuff.
   const fullBuffList=deltaVersion===3&&needsFullOwnedBuffList(report.actor.buffs);
   const buffs=deltaVersion===3&&!fullBuffList?report.actor.buffs:[],buffIds=new Set();
   for(const buff of buffs){if(!Number.isSafeInteger(buff.templateId)||buff.templateId<0||buffIds.has(buff.templateId))throw Error('invalid-owned-relay-buff-identity');buffIds.add(buff.templateId);}
   const buffBirths=buffs.filter(buff=>!row.buffs.has(buff.templateId));
   for(const buff of buffBirths){row.buffs.set(buff.templateId,clone(buff));row.buffSources.set(buff.templateId,buff);}
   for(const id of row.buffs.keys())if(row.buffs.size>512&&!buffIds.has(id)){row.buffs.delete(id);row.buffSources.delete(id);}
   const sources=report.effects.map(effect=>row.effectSources.get(effect.id));
   const buffSources=buffs.map(buff=>row.buffSources.get(buff.templateId));
   const cached=cacheKey&&typeof cacheKey==='object'?broadcastCache.get(cacheKey):null;
   const reused=cached?.find(entry=>entry.deltaVersion===deltaVersion&&entry.playerId===playerId&&entry.actorSource===row.actorSource&&entry.first===first
    &&entry.buffSources.length===buffSources.length&&entry.buffSources.every((source,index)=>source===buffSources[index])
    &&entry.sources.length===sources.length&&entry.sources.every((source,index)=>source===sources[index]));
   if(reused)return reused.packet;
   const baseline=first||births.length||buffBirths.length?{playerId,baselineOnly:true,protocol:report.protocol,epoch:report.epoch,frameSeq:report.frameSeq,
    ...(first?{actorBaseline:clone(deltaVersion===3?{...row.actor,buffs:[]}:row.actor)}:{}),effectBaselines:births.map(effect=>clone(continuousAuraBaseline(effect))),liveEffectIds:report.effects.map(effect=>effect.id),
    ...(deltaVersion===3?{buffBaselines:buffBirths.map(clone),liveBuffIds:[...buffIds]}:{})}:null;
   const actor=deltaVersion===3?{...report.actor,buffs:[]}:report.actor,actorBase=deltaVersion===3?{...row.actor,buffs:[]}:row.actor;
   const packet={baseline,value:{playerId,full:false,deltaVersion,protocol:report.protocol,epoch:report.epoch,frameSeq:report.frameSeq,
    actor:narrowDifference(actor,actorBase),effects:report.effects.map(effect=>({id:effect.id,...narrowDifference(effect,row.effects.get(effect.id))})),
    ...(deltaVersion===3?(fullBuffList?{fullBuffs:clone(report.actor.buffs)}:
      {buffs:buffs.map(buff=>({id:buff.templateId,...narrowDifference(buff,row.buffs.get(buff.templateId))}))}):{})}};
   if(cacheKey&&typeof cacheKey==='object')broadcastCache.set(cacheKey,[...(cached??[]),{playerId,actorSource:row.actorSource,first,sources,buffSources,deltaVersion,packet}]);
   return packet;
  },
  encode(playerId,report){
   const row=rowFor(playerId,report),full=!row.actor||report.effects.some(e=>!row.effects.has(e.id));
   if(full){remember(row,report);return {critical:true,value:{playerId,full:true,report:clone(report)}};}
   return {critical:false,value:{playerId,full:false,protocol:report.protocol,epoch:report.epoch,frameSeq:report.frameSeq,
    actor:difference(report.actor,row.actor),effects:report.effects.map(e=>({id:e.id,...difference(e,row.effects.get(e.id))}))}};
  },
  decode(value){
   if(!value||typeof value.playerId!=='string')throw Error('invalid-owned-relay-identity');
   if(value.baselineOnly===true){
    if(value.playerId.length>128||!Number.isSafeInteger(value.epoch)||value.epoch<0||!Number.isSafeInteger(value.frameSeq)||value.frameSeq<0
     ||!Array.isArray(value.effectBaselines)||value.effectBaselines.length>512
     ||value.liveEffectIds!==undefined&&(!Array.isArray(value.liveEffectIds)||value.liveEffectIds.length>512
       ||value.liveEffectIds.some(id=>!Number.isSafeInteger(id)||id<0)||new Set(value.liveEffectIds).size!==value.liveEffectIds.length)
     ||value.actorBaseline!==undefined&&!plain(value.actorBaseline))throw Error('invalid-owned-relay-baseline');
    if(value.buffBaselines!==undefined&&(!Array.isArray(value.buffBaselines)||value.buffBaselines.length>512)
      ||value.liveBuffIds!==undefined&&(!Array.isArray(value.liveBuffIds)||value.liveBuffIds.length>512
        ||value.liveBuffIds.some(id=>!Number.isSafeInteger(id)||id<0)||new Set(value.liveBuffIds).size!==value.liveBuffIds.length))throw Error('invalid-owned-relay-buff-baseline');
    safeTree(value);
    if(new TextEncoder().encode(JSON.stringify(value)).length>128*1024)throw Error('owned-relay-too-large');
    const existing=rows.get(value.playerId);
    if((!existing||existing.epoch!==value.epoch)&&!value.actorBaseline)throw Error('owned-relay-baseline-required');
    // Validate against a prospective table. A malformed new-life baseline
    // must neither erase the healthy life nor insert half its definitions.
    const row=prospective(value.playerId,value.epoch),ids=new Set();
    for(const effect of value.effectBaselines){
     if(!plain(effect)||!Number.isSafeInteger(effect.id)||effect.id<0||ids.has(effect.id))throw Error('invalid-owned-relay-effect-baseline');ids.add(effect.id);
     if(row.effects.has(effect.id)&&JSON.stringify(row.effects.get(effect.id))!==JSON.stringify(effect))throw Error('owned-relay-baseline-conflict');
    }
    const buffIds=new Set();for(const buff of value.buffBaselines??[]){
     if(!plain(buff)||!Number.isSafeInteger(buff.templateId)||buff.templateId<0||buffIds.has(buff.templateId))throw Error('invalid-owned-relay-buff-baseline');buffIds.add(buff.templateId);
     if(row.buffs.has(buff.templateId)&&JSON.stringify(row.buffs.get(buff.templateId))!==JSON.stringify(buff))throw Error('owned-relay-baseline-conflict');
    }
    if(value.actorBaseline&&row.actor&&JSON.stringify(row.actor)!==JSON.stringify(value.actorBaseline))throw Error('owned-relay-baseline-conflict');
    row.actor??=clone(value.actorBaseline);
    for(const effect of value.effectBaselines)row.effects.set(effect.id,clone(effect));
    for(const buff of value.buffBaselines??[])row.buffs.set(buff.templateId,clone(buff));
    // Healthy RTC can suppress every dynamic relay while reliable births keep
    // arriving. Retire templates here too, using this source report's exact
    // living identities; never evict a currently living effect.
    if(value.liveEffectIds){const live=new Set(value.liveEffectIds);for(const id of row.effects.keys())if(row.effects.size>512&&!live.has(id)){row.effects.delete(id);row.effectSources.delete(id);}}
    if(value.liveBuffIds){const live=new Set(value.liveBuffIds);for(const id of row.buffs.keys())if(row.buffs.size>512&&!live.has(id)){row.buffs.delete(id);row.buffSources.delete(id);}}
    rows.set(value.playerId,row);
    return null;
   }
   if(value.full===true){const report=value.report;if(!report||!Array.isArray(report.effects)||report.effects.length>512||!plain(report.actor)
     ||!Number.isSafeInteger(report.epoch)||report.epoch<0)throw Error('invalid-owned-relay-baseline');
    safeTree(report);const ids=new Set();for(const effect of report.effects){
     if(!plain(effect)||!Number.isSafeInteger(effect.id)||effect.id<0||ids.has(effect.id))throw Error('invalid-owned-relay-effect-baseline');ids.add(effect.id);
    }
    const row=prospective(value.playerId,report.epoch);remember(row,report);const result=clone(report);rows.set(value.playerId,row);return result;}
   const row=rows.get(value.playerId);if(value.full!==false||!row?.actor||row.epoch!==value.epoch||!Array.isArray(value.effects))throw Error('owned-relay-baseline-required');
   const narrow=value.deltaVersion===2||value.deltaVersion===3,restorePatch=narrow?restoreNarrow:restore;
   if(value.deltaVersion!==undefined&&!narrow)throw Error('invalid-owned-relay-version');
   const report={protocol:value.protocol,epoch:value.epoch,frameSeq:value.frameSeq,actor:restorePatch(value.actor,row.actor),effects:value.effects.map(patch=>{
    const baseline=row.effects.get(patch.id);if(!baseline)throw Error('owned-relay-effect-baseline-required');
    const {id,...body}=patch, effect=restorePatch(narrow?body:patch,baseline);if(effect.id!==id)throw Error('owned-relay-effect-identity');return effect;
   }),hits:[]};
   if(value.deltaVersion===3){
    if(Object.hasOwn(value,'fullBuffs')){
     if(Object.hasOwn(value,'buffs')||!needsFullOwnedBuffList(value.fullBuffs))throw Error('invalid-owned-relay-buffs');
     safeTree(value.fullBuffs);
     report.actor.buffs=clone(value.fullBuffs);
    }else{
    if(!Array.isArray(value.buffs)||value.buffs.length>512)throw Error('invalid-owned-relay-buffs');
    const ids=new Set();report.actor.buffs=value.buffs.map(patch=>{
     if(!plain(patch)||!Number.isSafeInteger(patch.id)||patch.id<0||ids.has(patch.id))throw Error('invalid-owned-relay-buff-identity');ids.add(patch.id);
     const baseline=row.buffs.get(patch.id);if(!baseline)throw Error('owned-relay-buff-baseline-required');
     const {id,...body}=patch,buff=restoreNarrow(body,baseline);if(buff.templateId!==id)throw Error('invalid-owned-relay-buff-identity');return buff;
    });
    for(const id of row.buffs.keys())if(row.buffs.size>512&&!ids.has(id)){row.buffs.delete(id);row.buffSources.delete(id);}
    }
   }
   if(narrow){
    const live=new Set(value.effects.map(effect=>effect.id));for(const id of row.effects.keys())if(row.effects.size>512&&!live.has(id)){row.effects.delete(id);row.effectSources.delete(id);}
   }
   return report;
  },
  clear(){rows.clear();actions.clear();},
  get baselineCount(){return actions.baselineCount+[...rows.values()].reduce((n,row)=>n+row.effects.size+row.buffs.size+1,0);},
 };
}
