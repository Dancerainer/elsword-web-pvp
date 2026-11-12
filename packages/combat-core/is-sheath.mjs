/** Fixed-V5 SwordMan left-hand sheath callbacks; target2016 visual template.
 * Releasing the original handle stops matrix following, not the mesh lifetime.
 */
const states=new Set(['ESSI_ETK_COMBO_ZZZ','ESSI_ETK_COMBO_XX','ESSI_ETK_DASH_COMBO_ZZ','ESSI_SI_A_ETK_COMPACT_COUNTER_GUARD_ATTACK']);
const source=(sim,a)=>sim.profileFor(a).states[a.state]?.sourceState??a.state;
const owned=(sim,a)=>sim.state.effects.filter(e=>e.ownerId===a.id&&e.sourceISSheath&&!e.dead);
function unlink(sim,a){for(const effect of owned(sim,a))effect.sourceISSheathFollowing=false;}
export function infinitySwordSheathStart(sim,a){
  if(sim.profileFor(a).target?.unitClass===112&&source(sim,a)==='ESSI_ETK_COMBO_ZZZ')unlink(sim,a);
}
export function infinitySwordSheathEvents(sim,a,before,after){
  if(sim.profileFor(a).target?.unitClass!==112)return;
  const name=source(sim,a),raw=sim.profileFor(a).states[a.state].raw;
  if(states.has(name)){
    sim.fire(a,'is-left-sheath',.01,before,after,()=>{
      const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy2_Lhand',TRACE_MATRIX:1}},a);
      if(!anchor?.matrix){sim.note('is-left-sheath-bone','Original Dummy2_Lhand matrix required for ElswordSheath02',a);return;}
      unlink(sim,a);
      const effect=sim.createEffect(a,{NAME:'ElswordSheath02'},{birthAnchor:structuredClone(anchor)});
      effect.sourceISSheath=true;effect.sourceISSheathFollowing=true;
      effect.sourcePosedAnchor=structuredClone(anchor);effect.currentAnchor=structuredClone(anchor);
    });
    if(Number.isFinite(raw.DASH_CANCEL_AFTER))sim.fire(a,'is-left-sheath-release',raw.DASH_CANCEL_AFTER,before,after,()=>unlink(sim,a));
  }
  // The source actor frame updates only its latest live handle. Previous
  // instances retain their last complete matrix while their authored fade runs.
  for(const effect of owned(sim,a))if(effect.sourceISSheathFollowing){
    const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy2_Lhand',TRACE_MATRIX:1}},a);
    if(anchor?.matrix){effect.sourcePosedAnchor=structuredClone(anchor);effect.currentAnchor=structuredClone(anchor);[effect.x,effect.y,effect.z]=anchor.position;}
  }
}
