/** Lossless reliable action history codec for negotiated Web relay v3.
 * No hit sample is removed. Definitions are reliable per-life baselines;
 * mutable action samples always refer to those baselines, never each other. */
import {needsFullOwnedBuffList} from './owned-buff-identity.mjs';
import {validateOwnedTargetViews,validateCombatPlayback} from './owned-state.mjs';
import {continuousAuraBaseline} from '../combat-core/continuous-aura.mjs';
const clone=value=>structuredClone(value);
const forbidden=new Set(['__proto__','prototype','constructor']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const cache=new WeakMap();
function tree(value,depth=0){
 // A narrow dictionary patch adds a `nested` wrapper at each source level.
 // Keep the reconstructed path limit at 18 while allowing its bounded wire
 // representation (the full owner report already passed the source limit).
 if(depth>40)throw Error('action-delta-too-deep');
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=512)return;
 if(Array.isArray(value)){if(value.length>1536)throw Error('action-delta-too-large');for(const item of value)tree(item,depth+1);return;}
 if(!plain(value)||Object.keys(value).length>512)throw Error('invalid-action-delta-tree');
 for(const [key,item]of Object.entries(value)){if(forbidden.has(key)||key.length>128)throw Error('invalid-action-delta-key');tree(item,depth+1);}
}
function delta(value,base){
 const fields={},removed=[],nested={};
 for(const [key,item]of Object.entries(value)){
  const old=base[key];if(Object.is(item,old))continue;
  if(plain(item)&&plain(old)){const patch=delta(item,old);if(Object.keys(patch.fields).length||patch.removed.length||patch.nested)nested[key]=patch;}
  else if(JSON.stringify(item)!==JSON.stringify(old))fields[key]=clone(item);
 }
 for(const key of Object.keys(base))if(!Object.hasOwn(value,key))removed.push(key);
 return {fields,removed,...(Object.keys(nested).length?{nested}:{})};
}
function restore(patch,base,depth=0){
 if(depth>18||!plain(patch)||!plain(patch.fields)||!Array.isArray(patch.removed)||patch.nested!==undefined&&!plain(patch.nested)
  ||Object.keys(patch).some(key=>!['fields','removed','nested'].includes(key))||!plain(base))throw Error('invalid-action-delta-patch');
 const value=clone(base),used=new Set(),check=key=>{
  if(typeof key!=='string'||key.length>128||forbidden.has(key)||used.has(key))throw Error('invalid-action-delta-key');used.add(key);
 };
 for(const key of patch.removed){check(key);delete value[key];}
 for(const [key,item]of Object.entries(patch.fields)){check(key);value[key]=clone(item);}
 for(const [key,item]of Object.entries(patch.nested??{})){check(key);if(!plain(base[key]))throw Error('action-delta-nested-baseline-required');value[key]=restore(item,base[key],depth+1);}
 return value;
}
const fresh=epoch=>({epoch,actor:null,actorSource:null,effects:new Map(),effectSources:new Map(),buffs:new Map(),buffSources:new Map()});
function trim(row){
 // All identities in the current message have already been encoded/decoded.
 // Reappearing retired IDs are declared again before any later use.
 for(const [items,sources]of [[row.effects,row.effectSources],[row.buffs,row.buffSources]])while(items.size>512){const id=items.keys().next().value;items.delete(id);sources.delete(id);}
}
function validEvent(value){
 if(!plain(value)||typeof value.playerId!=='string'||value.playerId.length>128||!integer(value.epoch)||!integer(value.frameSeq)
  ||!Array.isArray(value.actions)||value.actions.length<1||value.actions.length>16)throw Error('invalid-action-delta-event');
}
export function createOwnedActionDelta(){
 const rows=new Map();
 return {
  encode(playerId,data,{cacheKey=null}={}){
   validEvent(data);if(playerId!==data.playerId)throw Error('invalid-action-delta-identity');
   let row=rows.get(playerId);if(!row||row.epoch!==data.epoch){row=fresh(data.epoch);rows.set(playerId,row);}
   const first=!row.actor,effectBirths=[],buffBirths=[];
   const fullBuffActions=new Set(data.actions.filter(action=>Object.hasOwn(action.actor,'buffs')&&needsFullOwnedBuffList(action.actor.buffs)));
   if(first){row.actor=clone(data.actions[0].actor);row.actorSource=data.actions[0].actor;}
   for(const action of data.actions){
    if(action.playback!==undefined){validateCombatPlayback(action.playback);if(action.targetViews!==undefined)throw Error('playback-cannot-carry-history-witness');}
    for(const effect of action.effects)if(!row.effects.has(effect.id)){row.effects.set(effect.id,clone(continuousAuraBaseline(effect)));row.effectSources.set(effect.id,effect);effectBirths.push(continuousAuraBaseline(effect));}
    if(!fullBuffActions.has(action))for(const buff of action.actor.buffs??[])if(!row.buffs.has(buff.templateId)){row.buffs.set(buff.templateId,clone(buff));row.buffSources.set(buff.templateId,buff);buffBirths.push(buff);}
   }
   const sources=data.actions.flatMap(action=>action.effects.map(effect=>row.effectSources.get(effect.id)));
   const buffSources=data.actions.flatMap(action=>(action.actor.buffs??[]).map(buff=>row.buffSources.get(buff.templateId)));
   const cached=cacheKey&&typeof cacheKey==='object'?cache.get(cacheKey):null;
   const reused=cached?.find(entry=>entry.playerId===playerId&&entry.actorSource===row.actorSource&&entry.first===first
    &&entry.sources.length===sources.length&&entry.sources.every((item,i)=>item===sources[i])
    &&entry.buffSources.length===buffSources.length&&entry.buffSources.every((item,i)=>item===buffSources[i]));
   if(reused){trim(row);return reused.value;}
   const actorBase={...row.actor};delete actorBase.buffs;
   const value={...data,actionDeltaVersion:1,...(first?{actionActorBaseline:actorBase}:{}),
    actionEffectBaselines:effectBirths.map(clone),actionBuffBaselines:buffBirths.map(clone),actions:data.actions.map(action=>{
     const actor={...action.actor};if(!fullBuffActions.has(action))delete actor.buffs;
     return {...action,actor:delta(actor,actorBase),effects:action.effects.map(effect=>({id:effect.id,...delta(effect,row.effects.get(effect.id))})),
      ...(Object.hasOwn(action.actor,'buffs')&&!fullBuffActions.has(action)?{buffs:action.actor.buffs.map(buff=>({id:buff.templateId,...delta(buff,row.buffs.get(buff.templateId))}))}:{})};
    })};
   if(cacheKey&&typeof cacheKey==='object')cache.set(cacheKey,[...(cached??[]),{playerId,actorSource:row.actorSource,first,sources,buffSources,value}]);
   trim(row);return value;
  },
  decode(data){
   validEvent(data);
   if(data.actionDeltaVersion!==1||!Array.isArray(data.actionEffectBaselines)||data.actionEffectBaselines.length>1536
    ||!Array.isArray(data.actionBuffBaselines)||data.actionBuffBaselines.length>512
    ||data.actionActorBaseline!==undefined&&!plain(data.actionActorBaseline))throw Error('invalid-action-delta-baseline');
   tree(data);if(new TextEncoder().encode(JSON.stringify(data)).length>256*1024)throw Error('action-delta-too-large');
   const old=rows.get(data.playerId);
   if(old&&data.epoch<old.epoch)throw Error('action-delta-old-life');
   // Construct a prospective baseline table. Corrupt patches cannot poison
   // a healthy stream even when a message carries new reliable definitions.
   const row=old?.epoch===data.epoch?{...old,effects:new Map(old.effects),effectSources:new Map(),buffs:new Map(old.buffs),buffSources:new Map()}:fresh(data.epoch);
   if(!row.actor&&!data.actionActorBaseline)throw Error('action-delta-baseline-required');
   if(data.actionActorBaseline&&row.actor&&JSON.stringify(row.actor)!==JSON.stringify(data.actionActorBaseline))throw Error('action-delta-baseline-conflict');
   row.actor??=clone(data.actionActorBaseline);
   for(const [list,items,key]of [[data.actionEffectBaselines,row.effects,'id'],[data.actionBuffBaselines,row.buffs,'templateId']]){
    const ids=new Set();for(const item of list){
     if(!plain(item)||!integer(item[key])||ids.has(item[key]))throw Error('invalid-action-delta-baseline');ids.add(item[key]);
     if(items.has(item[key])&&JSON.stringify(items.get(item[key]))!==JSON.stringify(item))throw Error('action-delta-baseline-conflict');
     items.set(item[key],clone(item));
    }
   }
   let previous=-1;
   const restoreList=(patches,items,key)=>{
    if(!Array.isArray(patches)||patches.length>512)throw Error('invalid-action-delta-list');
    const ids=new Set();return patches.map(patch=>{
     if(!plain(patch)||!integer(patch.id)||ids.has(patch.id))throw Error('invalid-action-delta-identity');ids.add(patch.id);
     const base=items.get(patch.id);if(!base)throw Error('action-delta-instance-baseline-required');
     const {id,...body}=patch,value=restore(body,base);if(value[key]!==id)throw Error('invalid-action-delta-identity');return value;
    });
   };
   const actions=data.actions.map(action=>{
    if(!plain(action)||Object.keys(action).some(key=>!['id','frameSeq','actor','effects','buffs','targetViews','playback'].includes(key))
     ||!integer(action.id)||action.id<=previous||!integer(action.frameSeq)||action.frameSeq>data.frameSeq)throw Error('invalid-action-delta-action');previous=action.id;
    const actor=restore(action.actor,row.actor),effects=restoreList(action.effects,row.effects,'id');
    if(Object.hasOwn(actor,'buffs')&&(Object.hasOwn(action,'buffs')||!needsFullOwnedBuffList(actor.buffs)))throw Error('invalid-action-delta-buffs');
    if(Object.hasOwn(action,'buffs'))actor.buffs=restoreList(action.buffs,row.buffs,'templateId');
    if(action.playback!==undefined&&action.targetViews!==undefined)throw Error('playback-cannot-carry-history-witness');
    return {id:action.id,frameSeq:action.frameSeq,actor,effects,
      ...(action.playback!==undefined?{playback:validateCombatPlayback(action.playback)}:{}),
      ...(action.targetViews!==undefined?{targetViews:validateOwnedTargetViews(action.targetViews)}:{})};
   });
   const value={...data,actions};for(const key of ['actionDeltaVersion','actionActorBaseline','actionEffectBaselines','actionBuffBaselines'])delete value[key];
   trim(row);rows.set(data.playerId,row);return value;
  },
  clear(){rows.clear();},
  get baselineCount(){return [...rows.values()].reduce((n,row)=>n+1+row.effects.size+row.buffs.size,0);},
 };
}
