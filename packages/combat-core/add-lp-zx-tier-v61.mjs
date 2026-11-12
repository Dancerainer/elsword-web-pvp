/** V61/V62 project rule: an actual accepted668Z victim may supply the following
 * LP ZX's supported tier. The original ZX fixed velocities remain the default;
 * no target search or original2016 homing claim is introduced. */
import {addFixedDistancePosition} from './add-nasod-geometry.mjs';
const Z=new Set(['ANSI_DASH_JUMP_COMBO_Z','ANSI_DASH_JUMP_COMBO_ZZ']);
const ZX='ANSI_APT_DASH_JUMP_COMBO_ZX',BULLET='DamageEffect_AN_Dash_Jump_Combo_Z_Bullet';
const own=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const epoch=(sim,a)=>sim.networkEpochFor?.(a.id)??a.networkFrameEpoch??0;
const position=a=>[a.x,a.y,a.z];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const live=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
export function validateLPZxCapture(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||
  !['targetId','stateSerial','ownerEpoch','targetEpoch'].every(k=>Object.hasOwn(value,k))||
  typeof value.targetId!=='string'||!value.targetId.length||value.targetId.length>128||
  !integer(value.stateSerial)||value.stateSerial<1||!integer(value.ownerEpoch)||!integer(value.targetEpoch))
  throw new TypeError('invalid-lp-zx-capture');
 return true;
}
function normalLine(sim,id){
 const line=sim.map.lines.find(l=>l.lineId===id);
 const raw=line?.type??line?.nativeFields?.LINE_TYPE,type=raw?.symbol??raw?.$symbol??raw;
 return line&&[0,'LT_NORMAL','LINE_TYPE.LT_NORMAL'].includes(type)&&line.enabled!==false&&line.nativeFields?.ENABLE!==0?line:null;
}
function sameSurface(sim,a,b){
 if(!normalLine(sim,a)||!normalLine(sim,b))return false;
 if(a===b)return true;
 const x=sim.nativeGeometry?.lineGroup?.(a),y=sim.nativeGeometry?.lineGroup?.(b);
 return !!x&&!!y&&x.startLineId===y.startLineId&&x.endLineId===y.endLineId;
}
function supported(sim,b){
 if(!b.grounded)return null;
 const id=b.lineId??b.lastTouchLineId;if(!normalLine(sim,id))return null;
 const s=sim.nativeGeometry?.support?.({position:position(b),radius:sim.profileFor(b).referenceSemantics.lineRadius,lastLineId:id});
 // IsOnLine already owns the original admission/projection tolerance. A
 // second exact float32-Y equality rejects ordinary repeated slope projection.
 return s?.found&&sameSurface(sim,s.lineId,id)?s:null;
}
const validSerial=(value,source,serial)=>Z.has(source)?value.stateSerial===serial:source===ZX&&value.stateSerial+1===serial;
export function captureLPZxAcceptedZ(sim,a,b,origin){
 const definition=sim.profileFor(a).states[a.state],source=definition.sourceState;
 if(a.professionId!=='LP'||!own(sim,a)||sim.observationOnly||!(Z.has(source)||source===ZX)||!live(b)||b.team===a.team||origin.kind!=='effect')return false;
 if(a.sourceAddCombat.lpZxTarget)return false;
 const carrier=sim.state.effects.find(e=>e.id===origin.id);
 const sourceSerial=source===ZX?a.stateSerial-1:a.stateSerial;
 if(carrier?.name!==BULLET||carrier.ownerId!==a.id||carrier.ownerStateSerial!==sourceSerial||!supported(sim,b))return false;
 // The existing host increments hitCount after checkHits returns accepted
 // contacts. A first late acceptance still sees0 here; an old carrier cannot
 // grant another capture after its previous victim changes life epoch.
 if(source===ZX&&carrier.hitCount!==0)return false;
 const duration=definition.clip.durationSeconds;
 if(a.animationStopped||a.animationTime>(source===ZX?duration:duration-Math.max(duration/10,.03)))return false;
 const value={targetId:b.id,stateSerial:sourceSerial,ownerEpoch:epoch(sim,a),targetEpoch:epoch(sim,b)};
 validateLPZxCapture(value);a.sourceAddCombat.lpZxTarget=value;return true;
}
/** Retained only through the actual adjacent ZX. Called after native movement,
 * before this packet's landing callback; no damage callback moves either actor. */
export function tickLPZxTier(sim,a){
 const value=a.sourceAddCombat?.lpZxTarget;if(!value)return false;
 const definition=sim.profileFor(a).states[a.state],source=definition.sourceState;
 if(a.professionId!=='LP'||!validSerial(value,source,a.stateSerial)||value.ownerEpoch!==epoch(sim,a)||
  a.animationStopped||a.animationTime>definition.clip.durationSeconds){delete a.sourceAddCombat.lpZxTarget;return false;}
 if(source!==ZX||!own(sim,a)||sim.observationOnly)return false;
 const b=sim.state.actors.find(b=>b.id===value.targetId&&b.team!==a.team&&live(b));
 const targetSupport=b&&value.targetEpoch===epoch(sim,b)&&supported(sim,b);
 if(!targetSupport){delete a.sourceAddCombat.lpZxTarget;return false;}
 // Preserve the ordinary dive while above the victim, rather than consuming
 // the target identity before the descending feet can reach its surface.
 if(a.y>=targetSupport.point[1]||a.vy>0)return false;
 const geometry=sim.nativeGeometry,query=geometry?.fixedDistancePositionForWeaponTaker??
  (geometry?.land&&geometry?.distance?(request=>addFixedDistancePosition(geometry,sim.map,request)):null);
 if(!query)return false;
 const q=query({position:[...targetSupport.point],distance:100,right:a.facing<0});
 let support=null;
 if(q.found&&sameSurface(sim,q.lineId,targetSupport.lineId)){
  const s=geometry.support({position:q.point,radius:sim.profileFor(a).referenceSemantics.lineRadius,lastLineId:q.lineId});
  if(s.found&&sameSurface(sim,s.lineId,targetSupport.lineId))support=s;
 }
 // A failed edge offset can use only the already verified target surface;
 // it cannot replace a valid slope Y with b.y or fall through to another tier.
 support??=targetSupport;
 const from=position(a);[a.x,a.y,a.z]=support.point;a.vy=0;a.grounded=true;
 a.lineId=a.lastTouchLineId=support.lineId;a.landPosition=[...support.point];
 delete a.sourceAddCombat.lpZxTarget;
 sim.emit('lpZxTierSettled',a.id,{targetId:b.id,from,position:position(a),lineId:support.lineId,
  evidence:'V62 accepted668Z + adjacent ZX project rule; Native IsOnLine/lineGroup and qualified fixed100 support offset'});
 return true;
}
/** Actual state entry owns expiry. The original four-field record can survive
 * only its source Z/ZZ serial or the immediately adjacent ZX serial. */
export function startLPZxTier(sim,a,sourceState){
 const value=a.sourceAddCombat?.lpZxTarget;if(!value)return false;
 if(!validSerial(value,sourceState,a.stateSerial)){delete a.sourceAddCombat.lpZxTarget;return false;}
 return sourceState===ZX?tickLPZxTier(sim,a):false;
}
export function validateLPZxCaptureReferences(value,state,actor,profile,actors=[]){
 if(value===undefined)return;
 validateLPZxCapture(value);
 const source=profile.states[state.state]?.sourceState,target=actors.find(b=>b.id===value.targetId);
 if(profile.target?.unitClass!==122||!validSerial(value,source,state.stateSerial)||
  state.animationTime>profile.states[state.state].clip.durationSeconds||
  !target||target.id===actor.id||target.team===actor.team)
  throw new TypeError('invalid-lp-zx-capture-reference');
}
