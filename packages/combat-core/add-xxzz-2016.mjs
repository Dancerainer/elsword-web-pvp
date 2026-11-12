import {changeAddDp} from './add-systems.mjs';
export const ADD_XXZZ_LOOP_SET='EffectSet_AN_Combo_XXZZ_Loop';
const f=Math.fround;
/** Original registered32776380 ->32756580. Its .01 frame callback uses
 * the shared gate with argument1; the2026 Start/DP2 reference is different. */
export function addXxzzFrame(sim,a,before,after){
 if(!/^(LP|MM|DE)$/.test(a.professionId)||sim.profileFor(a).states[a.state]?.sourceState!=='ANSI_COMBO_XXZZ_LOOP')return;
 const at=f(.01),previous=f(before),now=f(after);
 if(!(previous<at&&at<=now))return;
 sim.fire(a,'add:xxzz-loop-original2016',at,previous,now,()=>{
  const profile=sim.profileFor(a),dpMode=a.passivePolicy?.skillLevels?.[29410]>0&&a.sourceAdd?.formation===true;
  if(dpMode){if(a.sourceAdd.dp<1)return;changeAddDp(a,-1,{profile,emit:(...args)=>sim.emit(...args),reason:'original-xxzz-loop'});}
  else {if(a.mp<1)return;a.mp=f(a.mp-1);}
  const first=sim.state.nextEffectId;sim.spawnSet(a,ADD_XXZZ_LOOP_SET);
  // Native PlayEffectSet compares .1/.15/.2 members against the owner's
  // absolute animation clock. The frame callback adds no new time origin.
  for(const e of sim.state.effects)if(e.id>=first&&e.ownerId===a.id&&e.setName===ADD_XXZZ_LOOP_SET&&e.clock==='animation')e.setStartAnimation=0;
  sim.emit('addXxzzLoop',a.id,{resource:dpMode?'DP':'MP',declaredAmount:1,loops:a.sourceAddCombat?.xxzzLoops??0,
   evidence:'original2016 registered32776380->32756580 .01 gate1; original-client battle unmeasured'});
 });
}
