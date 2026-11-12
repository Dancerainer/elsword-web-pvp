import {arcLineBasis} from './archenemy-mesh.mjs';
import {addOriginalRandomQ} from './add-random-table-2016.mjs';
/** 3274ad90/3274aff0 and original indexed table. Web seed policy: take the
 * current deterministic simulation seed's low16 bits once per callback.
 * This supplies an instance input, not a claim about original battle seeds. */
export function fireAddConqueror(sim,a,{hyper=false,consumeMutation}={}){
 const profile=sim.profileFor(a),sample=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile});
 if(!sample?.position){sim.note('add-conqueror-source-bone','Original Bip01 required for Conqueror release',a);return;}
 const count=Math.min(a.sourceAdd?.mutation??0,3),n=hyper?count:12+count,seed=sim.state.seed&65535;
 const position=sample.position.map((v,i)=>v+(i===0?200*a.facing:0)),basis=arcLineBasis(a,sim.map.lines).rotation;
 const spend=()=>{if(count&&consumeMutation)consumeMutation(a,count,{profile,allowDissolution:true,emit:(...args)=>sim.emit(...args)});};
 if(!hyper)spend();
 for(let i=0;i<n;i++){
  const rotation=[basis[0],Math.fround(basis[1]+2*addOriginalRandomQ(seed,i)-135),Math.fround(basis[2]+2*addOriginalRandomQ(seed,i+n)-135)];
  const e=sim.createEffect(a,{NAME:'DamageEffect_SA_APT_Conqueror_Projectile'},{birthAnchor:{position:[...position],facing:a.facing,rotation}});
  // Native LOT4 selector uses related Q(0)+i, not nearest-target priority.
  if(e){const range=profile.damageEffects[e.name].raw.LOCK_ON_DATA.LOCK_ON_RANGE_FROM_OWNER.AT_PVP,candidates=sim.state.actors.filter(b=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<=range);
   if(candidates.length){const id=candidates[((addOriginalRandomQ(seed)+i)%30+1)%candidates.length].id;e.sourceAddLockOn={targetId:id,manualDirDegree:[...rotation],useManualDir:false};}
  }
 }
 if(hyper){spend();
  sim.createEffect(a,{NAME:'DamageEffect_SA_APT_Conqueror_Hyper'},{birthAnchor:{position:sample.position.map((v,i)=>v+(i===0?300*a.facing:0)),facing:a.facing,rotation:basis}});
  if(count)sim.note('add-conqueror-hyper-main-modifier','Original key15/skill9009 runtime modifier is unavailable; main base scalar retained explicitly',a);
 }
}
