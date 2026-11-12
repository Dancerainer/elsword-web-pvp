/** Lossless codec for a negotiated reliable, ordered peer-control stream.
 * Birth baselines are carried in the same FIFO packet as their first use.
 * Ordinary ownership validators still receive the reconstructed full report.
 * Pose transport is deliberately independent of this reliable-channel codec. */
import {createOwnedActionDelta} from './owned-action-delta.mjs';
import {createOwnedRelayDelta} from './owned-relay-delta.mjs';
export const PEER_CONTROL_DELTA_VERSION=1;
const playerId='peer-control',clone=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const identity=value=>Number.isSafeInteger(value)&&value>=0;
const buffList=value=>Array.isArray(value)&&value.every(buff=>plain(buff)&&identity(buff.templateId));
/** Older/minimal adapters need no new producer contract. Canonical production
 * actors include a Buff list; incomplete adapter reports retain legacy JSON. */
export function canEncodePeerControlDelta(report){
 return plain(report)&&plain(report.actor)&&buffList(report.actor.buffs)&&Array.isArray(report.actions)&&report.actions.length>0
  &&report.actions.every(action=>plain(action)&&identity(action.id)&&identity(action.frameSeq)&&plain(action.actor)
    &&Array.isArray(action.effects)&&action.effects.every(effect=>plain(effect)&&identity(effect.id))
    &&(!Object.hasOwn(action.actor,'buffs')||buffList(action.actor.buffs)));
}
function mergeBirths(previous,current,key){
 const rows=new Map((previous??[]).map(value=>[value[key],value]));
 for(const value of current??[]){
  const old=rows.get(value[key]);
  if(old&&JSON.stringify(old)!==JSON.stringify(value))throw Error('peer-control-delta-birth-conflict');
  rows.set(value[key],value);
 }
 return [...rows.values()].map(clone);
}
export function createPeerControlDelta(){
 const current=createOwnedRelayDelta(),actions=createOwnedActionDelta();
 return {
  encode(report,{previous=null}={}){
   if(!canEncodePeerControlDelta(report))throw Error('peer-control-delta-source-required');
   const {actor,effects,hits,actions:captured,...header}=report;
   const body=current.encodeSplit(playerId,{...report,effects:[],hits:[],actions:[]},{deltaVersion:3});
   const event=actions.encode(playerId,{playerId,epoch:report.epoch,frameSeq:report.frameSeq,actions:captured});
   // A wholly unsent tail may grow after the transport returned false. The
   // encoder already remembered that tail's births, but its receiver has not.
   // Retain those exact definitions when rebuilding the tail's newer patch.
   if(previous){
    if(previous.controlDeltaVersion!==PEER_CONTROL_DELTA_VERSION||previous.epoch!==report.epoch)throw Error('peer-control-delta-tail-life');
    const old=previous.current.baseline;
    if(old){
     const next=body.baseline;
     body.baseline={...old,...next,frameSeq:report.frameSeq,
      ...(old.actorBaseline?{actorBaseline:clone(old.actorBaseline)}:{}),
      effectBaselines:mergeBirths(old.effectBaselines,next?.effectBaselines,'id'),
      buffBaselines:mergeBirths(old.buffBaselines,next?.buffBaselines,'templateId'),
      liveEffectIds:[],liveBuffIds:(body.value.buffs??[]).map(buff=>buff.id)};
    }
    const prior=previous.actionEvent;
    if(prior.actionActorBaseline)event.actionActorBaseline=clone(prior.actionActorBaseline);
    event.actionEffectBaselines=mergeBirths(prior.actionEffectBaselines,event.actionEffectBaselines,'id');
    event.actionBuffBaselines=mergeBirths(prior.actionBuffBaselines,event.actionBuffBaselines,'templateId');
   }
   return {...header,controlDeltaVersion:PEER_CONTROL_DELTA_VERSION,current:body,actionEvent:event};
  },
  decode(value){
   if(!plain(value)||value.controlDeltaVersion!==PEER_CONTROL_DELTA_VERSION||!plain(value.current)||!plain(value.actionEvent)
    ||Object.keys(value.current).some(key=>!['baseline','value'].includes(key)))throw Error('invalid-peer-control-delta');
   const {controlDeltaVersion,current:body,actionEvent,...header}=value;
   const matching=part=>plain(part)&&part.playerId===playerId&&part.protocol===header.protocol&&part.epoch===header.epoch&&part.frameSeq===header.frameSeq;
   if(!matching(body.value)||body.baseline!==null&&!matching(body.baseline)
    ||actionEvent.playerId!==playerId||actionEvent.epoch!==header.epoch||actionEvent.frameSeq!==header.frameSeq
    ||Object.keys(actionEvent).some(key=>!['playerId','epoch','frameSeq','actions','actionDeltaVersion','actionActorBaseline','actionEffectBaselines','actionBuffBaselines'].includes(key)))
    throw Error('peer-control-delta-identity');
   if(body.baseline)current.decode(body.baseline);
   const state=current.decode(body.value),event=actions.decode(actionEvent);
   if(state.effects.length)throw Error('peer-control-delta-body-effects');
   return {...header,actor:state.actor,effects:[],hits:[],actions:event.actions};
  },
  clear(){current.clear();actions.clear();},
  get baselineCount(){return current.baselineCount+actions.baselineCount;},
 };
}
