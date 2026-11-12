/** Player-requested prepared-orb layout. The six source slots, source Rotate
 * clock and actual Dummy02 radius remain authoritative; the shared plane and
 * body-centred layout are an explicit Web display correction, not 2016 proof.
 * No serialized state, damage or additional orb is created here. */
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),DEG=Math.PI/180;
export function maximumStrikePreparedPoint(effect,sourcePoint,sourceAnchor,actorCenter,localRotation,actorYaw=0){
 const slot=effect?.sourceAddMaximumStrike?.index;
 if(effect?.name!=='DamageEffect_ATT_Maximum_Strike_Bullet_Projectile'||!Number.isInteger(slot)||slot<0||slot>5)return null;
 if(![sourcePoint,sourceAnchor,actorCenter,localRotation].every(finite)||!Number.isFinite(actorYaw))return null;
 // The original helper has a large downward component. Measuring its full
 // local radius avoids shrinking that authored radius to its XZ projection,
 // which placed every previous orb below the caster's feet.
 const radius=Math.hypot(...sourcePoint.map((n,i)=>n-sourceAnchor[i]));if(!(radius>0))return null;
 const phase=(localRotation[2]+slot*60)*DEG,c=Math.cos(phase),s=Math.sin(phase),tilt=Math.SQRT1_2,yaw=actorYaw*DEG;
 const x=radius*c,z=radius*s*tilt;
 return [actorCenter[0]+x*Math.cos(yaw)+z*Math.sin(yaw),actorCenter[1]-radius*s*tilt,
  actorCenter[2]-x*Math.sin(yaw)+z*Math.cos(yaw)];
}
