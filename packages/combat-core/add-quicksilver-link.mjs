/** Target2016 link declaration/assets with fixed a8438f3 V5 callback timing.
 * This is a qualified source adapter, not a target-client execution trace.
 * SetLinkMainEffectByPos changes the main mesh only. Its display packet must
 * never replace the DamageEffect anchor, collision scale or original payload. */
import {arcLineBasis} from './archenemy-mesh.mjs';
export const ADD_QUICKSILVER_LINK='DamageEffect_APT_Pylon_Additional_Shock';
export const ADD_QUICKSILVER_LINK_MAIN='ADD_PYLON_DYNAMO_SPARK01_MAIN';
const states=Object.freeze({
  ANSI_SA_ALP_QUICKSILVER_ACCEL:{phase:'forward',create:.001,retire:.85,impact:.8,first:.001},
  ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK:{phase:'back',create:.01,retire:.57,impact:.596,first:0},
});
const crossed=(before,after,time)=>before<=time&&after>=time&&after>before;
const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const current=(sim,a)=>a.professionId==='LP'?states[sim.profileFor(a).states[a.state]?.sourceState??a.state]:null;
const rows=(sim,a)=>sim.state.effects.filter(e=>e.ownerId===a.id&&e.sourceAddQuicksilverLink&&!e.dead);
function retire(sim,a,e,reason){
  e.dead=true;e.endReason=reason;
  if(!e.endEmitted){e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason});}
}
/** Invoke from StateEnd before replacing actor.state/stateSerial; safe again
 * on death, disconnect or an early recast. All handles belong to this caster. */
export function endAddQuicksilverLink(sim,a,reason='add-quicksilver-state-ended'){
  for(const e of rows(sim,a))retire(sim,a,e,reason);
}
function sourcePose(sim,a){
  const sample=bone=>sim.effectAnchorSampler?.({definition:{BONE_NAME:bone}},a)?.position;
  const hand=sample('Bip01_L_Finger2'),body=sample('Bip01');
  if(!finite3(hand)||!finite3(body)){
    sim.note('add-quicksilver-link-bone','Original Bip01_L_Finger2 and Bip01 are required; no substitute anchor',a);return null;
  }
  let rotation;
  try{rotation=arcLineBasis(a,sim.map.lines).rotation;}
  catch{sim.note('add-quicksilver-link-line','Original saved line yaw is required for the link endpoint',a);return null;}
  // Preserve the source literal 1.57, not Math.PI/2. Endpoint is formed from
  // GetBonePos(Bip01), independently of the impact's 250/100 + 50/30 offsets.
  const yaw=Math.fround(rotation[1]*.01745329238474369+1.5700000524520874);
  const end=[body[0]+150*Math.sin(yaw),body[1]+45,body[2]+150*Math.cos(yaw)];
  const delta=end.map((value,i)=>value-hand[i]),length=Math.hypot(...delta);
  // Shared qualified native direction convention; target trigonometric
  // rounding/zero-vector engine behavior has not been measured.
  const aim=length?[0,Math.atan2(-delta[2],delta[0])*180/Math.PI,
    Math.asin(Math.max(-1,Math.min(1,delta[1]/length)))*180/Math.PI]:[0,0,0];
  return {hand:[...hand],rotation,length,mainAnchor:{position:[...hand],rotation:aim,facing:a.facing}};
}
function rate(sim,a){
  const raw=sim.profileFor(a).damageEffects[ADD_QUICKSILVER_LINK]?.raw;
  if(raw?.MAIN_EFFECT_NAME!==ADD_QUICKSILVER_LINK_MAIN||raw.LINK_EFFECT_RATE!==800){
    sim.note('add-quicksilver-link-template','Confirmed target main and LINK_EFFECT_RATE=800 required',a);return null;
  }
  return raw.LINK_EFFECT_RATE;
}
function assignMain(e,pose,denominator){
  e.sourceAddQuicksilverLink.mainAnchor=pose.mainAnchor;
  // Native: only a nonpositive distance becomes 1. Positive sub-unit lengths
  // are retained; Math.max(distance,1) would change their source behavior.
  e.sourceAddQuicksilverLink.mainScale=[(pose.length>0?pose.length:1)/denominator,1,1];
}
/** Call on the same animation interval as addRecastEvents. The source order
 * is impact else creation else retirement; impact itself stays in recasts. */
export function addQuicksilverLinkEvents(sim,a,before,after){
  const state=current(sim,a);if(!state||a.skillId!==29011||a.hp<=0||a.pvpDead||a.pvpDisconnected)return;
  if(crossed(before,after,state.impact))return;
  let creationBranch=false;
  sim.fire(a,'add-quicksilver-link:create',state.create,before,after,()=>{
    creationBranch=true;
    endAddQuicksilverLink(sim,a,'add-quicksilver-new-handle');
    const denominator=rate(sim,a),pose=denominator&&sourcePose(sim,a);if(!pose)return;
    const effect=sim.createEffect(a,{NAME:ADD_QUICKSILVER_LINK},{deleteConditions:[2,3],
      birthAnchor:{position:pose.hand,facing:a.facing,rotation:pose.rotation}});
    if(!effect)return;
    effect.sourceAddQuicksilverLink={phase:state.phase,group:a.stateSerial,mainAnchor:pose.mainAnchor,mainScale:[1,1,1]};
    assignMain(effect,pose,denominator);
  });
  if(!creationBranch)sim.fire(a,'add-quicksilver-link:retire',state.retire,before,after,
    ()=>endAddQuicksilverLink(sim,a,'add-quicksilver-window-ended'));
}
/** Call after actor pose/motion integration, including a zero-motion frame.
 * StateEnd is the primary teardown; this identity check also retires stale
 * handles after rollback/import/death without affecting another caster. */
export function updateAddQuicksilverLink(sim,a){
  const state=current(sim,a),entries=rows(sim,a);
  for(const effect of entries){
    const s=effect.sourceAddQuicksilverLink;
    if(!state||s.group!==a.stateSerial||s.phase!==state.phase||a.skillId!==29011||a.hp<=0||a.pvpDead||a.pvpDisconnected){
      retire(sim,a,effect,'add-quicksilver-owner-state-changed');continue;
    }
    if(a.animationTime<state.first||a.animationTime>=state.retire)continue;
    const denominator=rate(sim,a),pose=denominator&&sourcePose(sim,a);
    if(!pose){retire(sim,a,effect,'add-quicksilver-source-pose-unavailable');continue;}
    assignMain(effect,pose,denominator);
  }
}
/** Main-only owned-state payload. Unknown members/nonfinite transforms and
 * cross-profession/skill/handle reuse are rejected before reconstruction. */
export function validateAddQuicksilverLinkState(effect,profession,actors=[]){
  const s=effect.sourceAddQuicksilverLink;if(s===undefined)return;
  if(profession!=='LP'||!exact(s,['phase','group','mainAnchor','mainScale'])||!['forward','back'].includes(s.phase)||
    !Number.isSafeInteger(s.group)||s.group<0||effect.ownerStateSerial!==s.group||effect.skillId!==29011||
    effect.name!==ADD_QUICKSILVER_LINK||effect.mainEffectName!==ADD_QUICKSILVER_LINK_MAIN||
    effect.sourceAddFury!==undefined||effect.sourceAddSummonSerial!==undefined||effect.sourceAddLinkScale!==undefined||
    !exact(s.mainAnchor,['position','rotation','facing'])||!finite3(s.mainAnchor.position)||!finite3(s.mainAnchor.rotation)||
    ![-1,1].includes(s.mainAnchor.facing)||!finite3(s.mainScale)||s.mainScale[0]<=0||s.mainScale[1]!==1||s.mainScale[2]!==1)
    throw new TypeError('Invalid Add Quicksilver main-mesh link');
  if(actors.length){
    const owner=actors.find(a=>a.id===effect.ownerId);
    if(!owner||owner.professionId!=='LP'||!effect.dead&&(owner.stateSerial!==s.group||owner.skillId!==29011||
      (states[owner.state]?.phase??null)!==s.phase))throw new TypeError('Invalid Add Quicksilver owner identity');
  }
}
