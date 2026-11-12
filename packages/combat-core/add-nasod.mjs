import {addFactoryStateStart} from './add-factory.mjs';
import {addPanzerStateStart} from './add-panzer-v57.mjs';
import {addRecastStateStart} from './add-recasts.mjs';
import {initializeAddStardust} from './add-analysis-skills.mjs';
import {consumeAddMutation,requestAddMutation2016} from './add-systems.mjs';
import {applyAddDePrediction2016} from './add-de-prediction-2016.mjs';
import {addFixedDistancePosition} from './add-nasod-geometry.mjs';
import {ADD_BARRIER_STATE,addBarrierStateStart} from './add-barrier.mjs';
import {addFantasyTracerAcceptedHit,restoreAddFantasyTracerTarget} from './add-fantasy-tracer.mjs';
import {captureLPZxAcceptedZ,startLPZxTier} from './add-lp-zx-tier-v61.mjs';
/** Add target Nasod entry declarations and qualified Add native consumer.
 * Keep accepted-hit targeting separate from input buffering. */
const f=Math.fround;
const own=a=>['LP','MM','DE'].includes(a.professionId);
const memo=a=>(a.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1});
const pose=a=>[a.x,a.y,a.z];
const bone=(sim,a)=>sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:sim.profileFor(a)})?.position;
export function addDamageModifiers(a,data,origin={}){
 const p=a.passivePolicy?.add;
 return {damageMultiplier:own(a)&&data.DYNAMO_PARTICLE_RATE_TYPE===3?p?.nasodArmorDamageMultiplier??1:1,
  forceDownMultiplier:own(a)?p?.forceDownMultiplier??1:1};
}
export function addAcceptedHit(sim,a,target,data,hitOrigin={}){
 addFantasyTracerAcceptedHit(sim,a,target,data,hitOrigin);
 if(a.professionId==='LP'){memo(a);captureLPZxAcceptedZ(sim,a,target,hitOrigin);}
 if(a.professionId==='MM'&&sim.profileFor(a).states[a.state]?.sourceState==='ANSI_AMM_COMBO_ZZX'&&target.hp>0&&target.team!==a.team)memo(a).commandTargetId=target.id;
 if(!own(a)||data.CAN_ACTIVATE_NASOD_ARMOR_COMBO!==1||target.hp<=0||target.team===a.team)return false;
 const origin=pose(a),body=bone(sim,target),selfBody=bone(sim,a);
 // Native uses a ground-projected defender Bip01 for distance, and original
 // pelvis positions for PvP height. Missing sampling stays explicit.
 if(!body||!selfBody||!sim.nativeGeometry?.nearest){sim.note('add-nasod-target-bone','Original pelvis/nearest-line sampler required for Nasod target eligibility',a);return false;}
 const query=sim.nativeGeometry.nearest({position:body});const targetPos=query.found?query.point:body;
 if(Math.hypot(...origin.map((n,i)=>n-targetPos[i]))>1000||Math.abs(body[1]-selfBody[1])>500)return false;
 memo(a).nasodTargetId=target.id;return true;
}
export function addNasodRequest(a,definition,profile,keys){
 const source=definition.sourceState;
 // Conqueror registers the same EventProcess for the formed state. The
 // generated callback inventory listed only its normal alias, despite the
 // original formed declaration having its own EVENT_PROCESS_TIME0.
 const registered=profile.referenceSemantics.nasodArmorStates?.includes(source)||
  source==='ANSI_SA_APT_CONQUEROR_HYPER'&&profile.referenceSemantics.nasodArmorStates?.includes('ANSI_SA_APT_CONQUEROR');
 if(!own(a)||!(registered||source===ADD_BARRIER_STATE))return null;
 const s=memo(a),w=definition.raw.EVENT_PROCESS_TIME0;if(!w||![w['1'],w['2'],w['3']].every(Number.isFinite))return null;
 const t=f(a.animationTime);
 // The newly closed normal-mode branch is original native129/ZZZX only.
 // A valid latch can outlive its last point:32745d30 still requests-1 before
 // requesting156, so do not recheck a positive pool at consumption time.
 const normal129=source==='ANSI_COMBO_ZZZX'&&a.professionId==='DE'&&(a.passivePolicy?.skillLevels?.[29410]??0)>0;
 if(source==='ANSI_COMBO_ZZZX'&&a.animationStopped)return null;
 if(s.nasodFlag&&(a.sourceAdd?.formation||normal129)&&s.nasodTargetId&&t>f(w['3'])){
  if(!a.sourceAdd?.formation)requestAddMutation2016(a,-1,{profile});
  s.nasodFlag=false;return 'ANSI_COMBO_NASOD_ARMOR_READY';
 }
 if((a.sourceAdd?.formation||normal129&&a.sourceAdd?.mutation>0)&&(keys.pressed.has('Z')||keys.pressed.has('X'))&&t>=f(w['1'])&&t<f(w['2']))s.nasodFlag=true;
 return null;
}
export function addStateStart(sim,a){
 if(!own(a))return;addBarrierStateStart(sim,a);addRecastStateStart(sim,a);addFactoryStateStart(sim,a);const n=sim.profileFor(a).states[a.state].sourceState,s=memo(a);s.nasodFlag=false;
 startLPZxTier(sim,a,n);
 addPanzerStateStart(sim,a);
 if(n==='ANSI_ATT_DASH_JUMP_COMBO_ZX')applyAddDePrediction2016(sim,a);
 if(n==='ANSI_SA_ATT_STARDUST_SHOWER')initializeAddStardust(sim,a,{consumeMutation:consumeAddMutation});
 if(n==='ANSI_WAIT'||n==='ANSI_HYPER_WAIT'){s.nasodTargetId=null;s.nasodFlag=false;}
 if(n!=='ANSI_COMBO_NASOD_ARMOR_ATTACK')return;
 if(restoreAddFantasyTracerTarget(sim,a)===false)return;
 const target=sim.state.actors.find(b=>b.id===s.nasodTargetId&&b.hp>0&&b.team!==a.team);
 if(!target)return;
 // Pursuit and damage acceptance are separate. A knocked-down/protected
 // target still receives the player's requested pursuit attempt; ordinary
 // current protection continues to reject the catching attack's damage.
 const line=sim.map.lines.find(l=>l.lineId===(target.lineId??target.lastTouchLineId));
 const type=line?.type??line?.nativeFields?.LINE_TYPE;const symbol=type?.symbol??type?.$symbol??type;
 if(!line||![0,'LT_NORMAL','LINE_TYPE.LT_NORMAL'].includes(symbol)||line.enabled===false||line.nativeFields?.ENABLE===0||target.y<line.start[1])return;
 const query=sim.nativeGeometry?.fixedDistancePositionForWeaponTaker??(sim.nativeGeometry?.land&&sim.nativeGeometry?.distance?(request=>addFixedDistancePosition(sim.nativeGeometry,sim.map,request)):null);
 if(!query){sim.note('add-nasod-native-offset','Original GetFixedDistancePositionForWeaponTaker adapter unavailable; target pursuit displacement is unsupported',a);return;}
 // The former >500 branch solved from the caster's own position. That
 // literal came from a 2026 reconstruction, not target2016 evidence, and
 // turns a successfully captured launched target into an idle local grab.
 // Eligibility retains its existing original declaration/qualified range
 // gates; the fixed-distance solver always receives that selected target.
 const result=query({position:pose(target),distance:100,right:a.facing<0});
 const out=result.found?[result.point[0],target.y,result.point[2]]:pose(target);
 const before=pose(a);[a.x,a.y,a.z]=out;a.lastTouchLineId=target.lastTouchLineId??target.lineId;
 // Teleporting to an airborne defender invalidates the old caster floor
 // cache. Let the native support solver determine landing from the new point.
 a.grounded=false;a.lineId=null;
 // V61 grounded-target pursuit rule. A ZX dive can carry -5200 into this
 // teleport; its next physics packet skips the target's platform and finds
 // the caster's old floor below it. Rebase only an LP pursuit whose new feet
 // are independently supported at the grounded defender's actual height.
 // Airborne targets and unsupported offsets keep ordinary falling physics.
 if(a.professionId==='LP'&&target.grounded&&sim.nativeGeometry?.support){
  const support=sim.nativeGeometry.support({position:out,radius:sim.profileFor(a).referenceSemantics.lineRadius,lastLineId:target.lineId??target.lastTouchLineId});
  if(support.found&&Math.fround(support.point[1])===Math.fround(out[1])){
   a.vy=0;a.landPosition=[...support.point];a.lastTouchLineId=support.lineId;
  }
 }
 sim.emit?.('addNasodPursuitAttempt',a.id,{targetId:target.id,from:before,position:[...out],resolved:!!result.found,
  evidence:'player-corrected pursuit; original target identity + qualified authored-line fixed100 offset; target2016 callback unmeasured'});
}
