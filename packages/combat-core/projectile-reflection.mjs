/** Fixed-reference GUUser REFLEX_MAGIC/RS passive + DamageEffect recreation.
 * The source profession owns declarations only; the defender owns the new hit.
 * See contracts/rs-reflection-source-v1.json. No renderer or network is required.
 */
export function effectSourceProfile(sim,e,owner=sim.actor(e.ownerId)) {
  return e.sourceProfessionId ? sim.profiles[e.sourceProfessionId] : sim.profileFor(owner);
}

export function tryReflectProjectile(sim,a,b,data,origin,fromFront) {
  if(origin.kind!=='effect'||!(data.CAN_REFLEX===1||data.CAN_REFLEX===true))return false;
  if(sim.profileFor(b).target.unitClass!==101)return false;
  const e=sim.state.effects.find(e=>e.id===origin.id&&!e.dead);if(!e)return false;
  // Victim ownership decides reflection. The attacker's speculative remote
  // contact cannot manufacture a second authoritative reflected instance.
  if(sim.networkOwnerId!==null&&sim.networkOwnerId!==b.id)return false;
  const window=sim.profileFor(b).states[b.state]?.raw.REFLEX_MAGIC;
  const guarding=fromFront&&window&&b.animationTime>window['1']&&b.animationTime<window['2'];
  const originalSkill=sim.skill(origin.skillId,a),special=data.ATTACK_TYPE===sourceAttackSpecial(sim,a)||[13,14,15,16].includes(originalSkill?.type);
  const chance=special?0:b.passivePolicy?.runeSlayer?.magicReflectChance??0;
  if(!guarding&&!(chance>0&&sim.rng()<=chance))return false;
  const remaining=e.sourceReflection?.remaining??2;
  // DamageEffect emits the reaction particles before testing REFLECT. Runes
  // which reject damage without creating a new instance still show feedback.
  {
    const anchor=e.currentAnchor??e.birthAnchor;
    const notice=b.sourceReflectionNotice={serial:(b.sourceReflectionNotice?.serial??0)+1,
      position:[...(origin.impactPoint??anchor?.position??[b.x,b.y,b.z])],
      landY:e.sourceDamageLandY??e.sourceMeshLandY??b.y,remaining:.5,particles:remaining>0};
    sim.emit('projectileReflectionFeedback',b.id,{...notice,sourceProfessionId:b.professionId});
  }
  // CAN_REFLEX governs damage rejection. REFLECT independently permits the
  // original CEffect to die and create another copy (count starts at two).
  if((e.damage?.REFLECT===1||e.damage?.REFLECT===true)&&remaining>0){
    const anchor=e.currentAnchor??e.birthAnchor;
    if(!anchor?.position){sim.note('reflection-anchor:'+e.name,'Original main-mesh transform unavailable; reflected projectile not fabricated',b);return false;}
    const sourceProfessionId=e.sourceProfessionId??a.professionId;
    const rotation=[...(anchor.rotation??[0,anchor.facing<0?180:0,0])];rotation[2]+=180;
    const sourceEpoch=e.networkEpoch??sim.networkEpochFor?.(e.ownerId)??0;
    const reflected=sim.createEffect(b,{NAME:e.name},{clock:'custom',sourceProfessionId,
      sourceLandY:e.sourceDamageLandY??e.sourceMeshLandY,
      birthAnchor:{position:[...anchor.position],rotation,facing:-anchor.facing,customPosition:true}});
    reflected.skillId=null;reflected.traitPolicy=null;
    reflected.powerMultiplier=e.powerMultiplier*(guarding?(sim.skill(21211,b)?.raw.SA_EFFECTIVE_RATE?.[String(sim.skill(21211,b)?.maxLevel)]??1):1);
    reflected.sourceReflection={remaining:remaining-1,sourceActorId:e.ownerId,sourceEffectId:e.networkId??e.id,sourceEpoch};
    reflected.sourceReflected=true;
    // The original source spawns a new instance with Z+180. These roots use
    // local linear velocity; use the saved world rotation for both axes.
    reflected.sourceSkillMeshControl=e.sourceSkillMeshControl;
    e.dead=true;e.endReason='projectile-reflected';e.suppressSecondaryDamage=true;
    sim.emit('projectileReflected',b.id,{effectId:reflected.id,sourceEffectId:e.id,sourceActorId:a.id,
      sourceProfessionId:b.professionId,projectileSourceProfessionId:sourceProfessionId,remaining:remaining-1,
      position:[...(origin.impactPoint??anchor.position)],landY:e.sourceDamageLandY??e.sourceMeshLandY,
      evidence:'fixed-reference GUUser8176 / DamageEffect3761; target2016 fields'});
  }
  sim.emit('projectileReflectionGuard',b.id,{sourceEffectId:e.id,sourceActorId:a.id,passive:!guarding});
  return true;
}
function sourceAttackSpecial(sim,a){return sim.profileFor(a).enums.ATTACK_TYPE.AT_SPECIAL;}

/** Z+180 in the original mesh reverses its local X and Y, not merely facing. */
export function reflectedDisplacement(e,velocity,dt){
  const r=(e.currentAnchor??e.birthAnchor)?.rotation;
  if(!e.sourceReflected||!r)return null;
  const [pitch,yaw,roll]=r.map(x=>x*Math.PI/180),[x,y,z]=velocity;
  // D3DX rotation yaw-pitch-roll: roll first, then pitch, then yaw.
  const cx=Math.cos(pitch),sx=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw),cz=Math.cos(roll),sz=Math.sin(roll);
  const rx=x*cz-y*sz,ry=x*sz+y*cz,py=ry*cx-z*sx,pz=ry*sx+z*cx;
  return [(rx*cy+pz*sy)*dt,py*dt,(-rx*sy+pz*cy)*dt];
}

export function retireReflectedSource(sim,e){
  const r=e.sourceReflection;if(!r)return;
  const receipt={...r,name:e.name,sourceProfessionId:e.sourceProfessionId};
  const receipts=sim.state.reflectionReceipts??=[];
  if(!receipts.some(row=>JSON.stringify(row)===JSON.stringify(receipt))){
    receipts.push(receipt);if(receipts.length>256)receipts.shift();
  }
}
export function matchesReflectionReceipt(sim,original,receipt){
  const source=original.sourceProfessionId??sim.actor(original.ownerId)?.professionId;
  return original.name===receipt.name&&source===receipt.sourceProfessionId&&
    (original.damage?.REFLECT===1||original.damage?.REFLECT===true)&&
    (original.damage?.DAMAGE_DATA?.CAN_REFLEX===1||original.damage?.DAMAGE_DATA?.CAN_REFLEX===true)&&
    (original.sourceReflection?.remaining??2)===receipt.remaining+1;
}
export function retireReflectionReceipts(sim){
  const receipts=sim.state.reflectionReceipts??[];if(!receipts.length)return;
  const keys=new Map();for(const r of receipts){const key=r.sourceActorId+'\0'+r.sourceEpoch+'\0'+r.sourceEffectId;
    const rows=keys.get(key)??[];rows.push(r);keys.set(key,rows);}
  for(const original of sim.state.effects){
    if(original.dead)continue;
    const id=original.networkId??original.id;
    const epoch=original.networkEpoch??sim.networkEpochFor?.(original.ownerId)??0;
    if(!keys.get(original.ownerId+'\0'+epoch+'\0'+id)?.some(r=>matchesReflectionReceipt(sim,original,r)))continue;
    original.dead=true;original.endReason='projectile-reflected';original.suppressSecondaryDamage=true;
  }
}
