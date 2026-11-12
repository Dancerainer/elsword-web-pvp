/** Original2016 .31 query / link lifecycle, source-bound in
 * contracts/ca-shadow-edge-native-v61.json. Victim-owned network settlement
 * remains a Web adapter; received target identities never apply a buff. */
import {synchronizeBuffStats} from './passive-attributes-v20.mjs';
import {authoredLineBasis} from '../combat-assets/line-basis.mjs';
export const ELESIS_SHADOW_LINK='DAMAGE_EFFECT_SCA_SHADOW_EDGE_Link';
const EXPLOSION='DamageEffect_SCA_SHADOW_EDGE_Projectile_EXPLOSION';
const f=Math.fround;
const entries=(sim,a)=>sim.state.effects.filter(e=>e.ownerId===a.id&&e.sourceElesisShadowLink&&!e.dead);
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
const range=(sim,a)=>sim.presetFor(a).gameMode==='NPC'?1200:700;
const owned=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
function receivedEpoch(sim,a,e){
  const current=sim.networkEpochFor?.(a.id),packet=e.networkEpoch;
  if(current!=null&&packet!=null&&current!==packet)return null;
  return packet??current??0;
}
/** Original3209dda0 compares against the target's lane, ignoring Y.
 * At exactly zero the original left-facing branch accepts the candidate. */
function inFront(sim,a,b){
  let line;try{line=authoredLineBasis(b,sim.map);}catch{return false;}
  const dot=f(f(b.x-a.x)*f(line.dirVector[0])+f(b.z-a.z)*f(line.dirVector[2]));
  return dot>0?a.facing===1:a.facing===-1;
}
/** Repeated nearest search320a6400; <= replaces the previous best, so equal
 * distances prefer the last enumerated unselected unit. Actors here are
 * User units; NPC state/size consumers are outside this player collection. */
export function elesisShadowTargets(sim,a){
  const selected=[];
  for(let i=0;i<3;i++){
    let candidate=null,best=range(sim,a);
    for(const b of sim.state.actors){
      if(!b||b.id===a.id||selected.includes(b)||b.team===a.team||b.hp<=0||
        b.pvpDead||b.pvpDisconnected||b.invincible||b.forceInvincible>0||!inFront(sim,a,b))continue;
      const dx=f(b.x-a.x),dy=f(b.y-a.y),dz=f(b.z-a.z);
      const d=f(Math.sqrt(f(dx*dx+dy*dy+dz*dz)));
      if(d<=best){best=d;candidate=b;}
    }
    if(!candidate)break;selected.push(candidate);
  }
  return selected;
}
function endpoint(sim,a){
  const bone=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a);
  return bone?.position?.length===3?bone.position.map((v,i)=>v+(i===1?25:0)):[a.x,a.y+100,a.z];
}
function end(sim,a,e,reason){
  const b=sim.state.actors.find(b=>b.id===e.sourceElesisShadowLink.targetId);
  if(b){b.buffs=b.buffs.filter(v=>!(v.templateId===432&&v.sourceActorId===a.id));synchronizeBuffStats(b);}
  e.dead=true;e.endReason=reason;
}
export function clearElesisShadowLinks(sim,a){for(const e of entries(sim,a))end(sim,a,e,'shadow-edge-recast');}
export function retireElesisShadowLink(sim,e,reason='shadow-edge-owner-ended'){
  if(!e.sourceElesisShadowLink)return;
  const a=sim.state.actors.find(a=>a.id===e.ownerId);if(a)end(sim,a,e,reason);
}
function aim(from,to){
  const d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);
  return length?[0,Math.atan2(-d[2],d[0])*180/Math.PI,Math.asin(Math.max(-1,Math.min(1,d[1]/length)))*180/Math.PI]:[0,0,0];
}
function pose(sim,a,b,e){
  const from=endpoint(sim,a),to=endpoint(sim,b),rotation=aim(from,to);
  const length=Math.hypot(...to.map((v,i)=>v-from[i]));
  // Web packets expose an atomic state. Apply the original next-update
  // endpoint break in this birth packet rather than serializing a transient
  // length beyond the existing1200 wire bound (not a claim of native timing).
  if(length>1200){end(sim,a,e,'shadow-edge-link-broken');return false;}
  e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position:from,rotation};
  [e.x,e.y,e.z]=from;e.sourceElesisShadowLink.scale=Math.max(1,length)/sim.profileFor(a).damageEffects[ELESIS_SHADOW_LINK].raw.LINK_EFFECT_RATE;
  e.definition=elesisShadowLinkDefinition(sim.profileFor(a),e,e.definition);
  return true;
}
function grant(sim,a,b,carrier,remaining){
  const skill=sim.skill(28215,a),level=skill.maxLevel;
  const buff=sim.grantBuff(a,b,skill.raw.BUFF_FACTOR[level],level,carrier?.traitPolicy??a.skillContext?.traitPolicy);
  if(buff&&remaining!==undefined)for(const finalizer of buff.finalizers)if(finalizer.kind==='time')finalizer.remaining=Math.min(finalizer.remaining,remaining);
  return buff;
}
function link(sim,a,b,carrier){
  const skill=sim.skill(28215,a),level=skill.maxLevel;
  const e=sim.createEffect({...a,skillId:28215,skillScale:carrier?.powerMultiplier??a.skillScale,
    skillContext:{traitPolicy:carrier?.traitPolicy??a.skillContext?.traitPolicy}},
    {NAME:ELESIS_SHADOW_LINK},{birthAnchor:{position:endpoint(sim,a),facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
  if(!e)return null;
  e.sourceSkillMeshControl=true;
  e.sourceElesisShadowLink={targetId:b.id,remaining:skill.raw.SA_EFFECTIVE_TIME[level],scale:Math.max(1,distance(a,b))/530};
  if(!pose(sim,a,b,e))return null;
  sim.emit('elesisShadowBound',a.id,{targetId:b.id,effectId:e.id,duration:e.sourceElesisShadowLink.remaining,range:range(sim,a)});
  sim.note('elesis-shadow-edge-recovery','Original floor-boundary update found; full two-argument HP wrapper contract remains unresolved, so no recovery is guessed',a);
  return e;
}
export function castElesisShadowEdge(sim,a){
  if(a.professionId!=='CA'||a.skillId!==28215||!owned(sim,a)||sim.observationOnly)return;
  clearElesisShadowLinks(sim,a);
  const rotation=[0,authoredLineBasis(a,sim.map).yRotationDegrees,0];
  for(const b of elesisShadowTargets(sim,a)){
    sim.createEffect(a,{NAME:EXPLOSION},{birthAnchor:{position:endpoint(sim,b),facing:a.facing,rotation}});
    const e=link(sim,a,b);
    if(e&&owned(sim,b))grant(sim,a,b);
  }
}
export function elesisShadowEdgeHit(sim,a,b,data,origin){
  if(sim.observationOnly||a.professionId!=='CA'||b.team===a.team||b.hp<=0||origin.kind!=='effect'||data.APPLIED_SKILL_ID!==28215)return;
  const carrier=sim.state.effects.find(e=>e.id===origin.id);
  if(carrier?.name!==EXPLOSION||carrier.skillId!==28215||!owned(sim,b)||owned(sim,a))return;
  const links=entries(sim,a),existing=links.find(e=>e.sourceElesisShadowLink.targetId===b.id);
  if(links.length>=3&&!existing)return;
  if(sim.networkOwnerId!=null){
    // This local receipt is intentionally absent from owned packets. An AoE
    // contact alone cannot acquire an extra victim; a matching received Link
    // and this independently accepted local contact are both required.
    const epoch=receivedEpoch(sim,a,carrier);if(epoch===null)return;
    const key={ownerId:a.id,epoch,
      stateSerial:carrier.ownerStateSerial,targetId:b.id};
    const rows=contacts(sim);
    if(!rows.some(r=>Object.keys(key).every(k=>r[k]===key[k])))rows.push({...key,
      expiresAt:sim.state.time+Math.max(0,8-(carrier.elapsed??0)),settled:false});
    if(rows.length>64)rows.splice(0,rows.length-64);
  }
  // An owner's link packet can arrive before this receiving victim accepts
  // the actual explosion contact. The wire identity alone never grants slow;
  // that accepted contact installs only the link's remaining source duration.
  if(existing)settleReceivedLink(sim,a,b,existing);
}
function contacts(sim){
  // Expired identities remain bounded tombstones. Replaying the same old
  // explosion must not create a fresh eight-second authorization window.
  return sim.state.localOwnerElesisShadowContacts??=[];
}
function settleReceivedLink(sim,a,b,e){
  if(sim.networkOwnerId==null||!owned(sim,b)||owned(sim,a))return;
  const epoch=receivedEpoch(sim,a,e);if(epoch===null)return;
  const row=contacts(sim).find(r=>!r.settled&&r.expiresAt>sim.state.time&&r.ownerId===a.id&&r.epoch===epoch&&
    r.stateSerial===e.ownerStateSerial&&r.targetId===b.id);
  if(row){row.settled=true;if(!b.buffs.some(v=>v.templateId===432&&v.sourceActorId===a.id))grant(sim,a,b,e,e.sourceElesisShadowLink.remaining);}
}
/** Called once on the global effect clock, including character frame stops. */
export function tickElesisShadowLinks(sim,dt){
  // tickEffects(0) is a temporary historical collision sample. It must not
  // retire a current victim buff using an older caster/target pose.
  if(!(dt>0))return;
  for(const e of sim.state.effects){
    if(!e.sourceElesisShadowLink||e.dead)continue;
    const a=sim.state.actors.find(a=>a.id===e.ownerId),b=sim.state.actors.find(b=>b.id===e.sourceElesisShadowLink.targetId);
    if(!a){e.dead=true;e.endReason='shadow-edge-owner-missing';continue;}
    const s=e.sourceElesisShadowLink;s.remaining=Math.max(0,f(s.remaining-dt));
    if(a.hp<=0||a.pvpDead||a.pvpDisconnected||!b||b.hp<=0||b.pvpDead||b.pvpDisconnected||b.team===a.team||s.remaining<=0){
      end(sim,a,e,s.remaining<=0?'shadow-edge-expired':'shadow-edge-link-broken');continue;
    }
    if(pose(sim,a,b,e))settleReceivedLink(sim,a,b,e);
  }
}
export function elesisShadowLinkDefinition(profile,effect,definition){
  if(effect.sourceElesisShadowLink===undefined)return definition;
  validateElesisShadowLink(effect,profile.target?.unitClass===125?'CA':'other');
  const size=profile.effectTemplates[profile.damageEffects[ELESIS_SHADOW_LINK].raw.MAIN_EFFECT_NAME].initialSize;
  return {...definition,SCALE_X:effect.sourceElesisShadowLink.scale/size[0],SCALE_Y:1/size[1],SCALE_Z:1/size[2]};
}
export function validateElesisShadowLink(effect,profession,actors=[]){
  const s=effect.sourceElesisShadowLink;if(s===undefined)return;
  if(profession!=='CA'||!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||
    Object.keys(s).some(k=>!['targetId','remaining','scale'].includes(k))||typeof s.targetId!=='string'||!s.targetId.length||s.targetId.length>128||
    !Number.isFinite(s.remaining)||s.remaining<0||s.remaining>8||!Number.isFinite(s.scale)||s.scale<1/530||s.scale>1200/530||
    effect.skillId!==28215||effect.name!==ELESIS_SHADOW_LINK)throw new TypeError('Invalid Elesis Shadow Edge link');
  if(actors.length){const a=actors.find(a=>a.id===effect.ownerId),b=actors.find(b=>b.id===s.targetId);
    if(!a||!b||a.team===b.team)throw new TypeError('Invalid Elesis Shadow Edge target');}
}
