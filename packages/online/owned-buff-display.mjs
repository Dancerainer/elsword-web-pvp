import {buffDisplaySets,isBuffActive} from '../combat-core/buffs.mjs';
import {resolveEffectTemplateKey} from '../combat-assets/effect-template-key.mjs';

// Owner status may beat or trail the separate effect stream. Reconstruct only
// sourced, pure particle display sets: no damage, mesh/controller or unknown
// declaration is permission to execute an attack from a Buff receipt.
const activeDisplays=new WeakMap(),restoredDisplays=new WeakSet();
const identity=(templateId,setName,member,name)=>JSON.stringify([templateId,setName,member,name]);
const declaredSets=(profile,buff)=>buffDisplaySets(buff).filter(set=>Object.values(
  profile?.buffTemplates?.[buff.templateId]?.raw?.DISPLAYER?.BDT_EFFECT_SET??{}).includes(set));
function particleMembers(profile,setName){
  const raw=profile?.effectSets?.[setName]?.raw;if(!raw)return [];
  const members=Object.entries(raw).filter(([key])=>/^EFFECT\d+$/.test(key));
  return members.length&&members.every(([,def])=>Number.isInteger(def.EFFECT_TYPE)&&def.EFFECT_TYPE>=6&&def.EFFECT_TYPE<=9
    &&!profile.damageEffects?.[def.NAME]
    &&profile.effectTemplates?.[resolveEffectTemplateKey(profile.effectTemplates,def.NAME,def.EFFECT_TYPE)]?.kind==='particle')?members:[];
}
export function reconcileOwnedBuffDisplays(simulation,actor){
  if(actor.id===simulation.networkOwnerId||typeof simulation.createEffect!=='function')return;
  const profile=simulation.profileFor?.(actor)??simulation.profile,desired=new Map();
  if(actor.hp>0&&!actor.pvpDead&&!actor.pvpDisconnected)for(const buff of actor.buffs??[])if(isBuffActive(buff))
    for(const set of declaredSets(profile,buff))for(const [member,definition]of particleMembers(profile,set))
      desired.set(identity(buff.templateId,set,member,definition.NAME),{templateId:buff.templateId,set,member,definition});
  const previous=activeDisplays.get(actor)??new Set(),live=new Set();
  for(const effect of simulation.state.effects){
    if(effect.ownerId!==actor.id||effect.buffTemplateId==null||effect.dead)continue;
    const key=identity(effect.buffTemplateId,effect.setName,effect.definitionMember,effect.name);
    // Leave non-particle/controller display lifetimes to their original owner.
    if(!particleMembers(profile,effect.setName).length)continue;
    if(!desired.has(key)){effect.dead=true;effect.endReason='buff-removed';}
    else live.add(key);
  }
  for(const [key,row]of desired)if(!previous.has(key)&&!live.has(key)){
    const timing=profile.effectSets[row.set].raw.EVENT_TIMER_TYPE??profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_ANIM;
    const effect=simulation.createEffect(actor,row.definition,{setName:row.set,
      clock:timing===profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM?'custom':'animation',start:row.definition.START_TIME??0});
    if(effect){effect.buffTemplateId=row.templateId;effect.definitionMember=row.member;restoredDisplays.add(effect);}
  }
  // Repeated checkpoints and timed particle completion do not restart visuals.
  activeDisplays.set(actor,new Set(desired.keys()));
}
export function restoredOwnedBuffDisplay(simulation,actor,state){
  if(state.buffTemplateId==null)return null;
  const profile=simulation.profileFor?.(actor)??simulation.profile;
  if(!particleMembers(profile,state.setName).some(([member,def])=>member===state.definitionMember&&def.NAME===state.name))return null;
  return simulation.state.effects.find(effect=>restoredDisplays.has(effect)&&effect.ownerId===actor.id&&!effect.dead
    &&isCurrentOwnedBuffDisplay(actor,effect)&&effect.buffTemplateId===state.buffTemplateId&&effect.setName===state.setName
    &&effect.definitionMember===state.definitionMember&&effect.name===state.name)??null;
}
export function isCurrentOwnedBuffDisplay(actor,effect){
  return restoredDisplays.has(effect)&&actor.hp>0&&!actor.pvpDead&&!actor.pvpDisconnected&&!effect.dead
    &&activeDisplays.get(actor)?.has(identity(effect.buffTemplateId,effect.setName,effect.definitionMember,effect.name))
    &&actor.buffs?.some(buff=>buff.templateId===effect.buffTemplateId&&isBuffActive(buff)&&buffDisplaySets(buff).includes(effect.setName));
}
