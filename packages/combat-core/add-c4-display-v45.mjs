/** Exact original C4 trace digits. Rendering owns each one-particle lifetime;
 * retain the target identity through its finite source emission/lifetime bound. */
export function isAddC4Display(sim,a,e){
 if(a.professionId!=='MM'||e.skillId!==29211||!e.traceActorId||e.damage||
  !['EffectSet_Countdown_Bomb_Trace','EffectSet_Countdown_Bomb_Trace_Mutation'].includes(e.setName)||
  !/^EFFECT[1-6]$/.test(e.definitionMember??''))return false;
 const row=sim.profileFor(a).effectSets[e.setName]?.raw?.[e.definitionMember];
 return row?.NAME===e.name&&row.TRACE===1&&row.BONE_NAME==='_HEAD_BONE';
}
export function updateAddC4Display(sim,a,e){
 if(!isAddC4Display(sim,a,e))return false;
 const target=sim.state.actors.find(t=>t.id===e.traceActorId);
 const fields=sim.profileFor(a).effectTemplates[e.name]?.fields;
 // TriggerTime stops further emission; no particle can survive longer than
 // its own fixed Lifetime after that. This is a retained-record upper bound,
 // not a replacement for the renderer's actual one-particle delete clock.
 if(!target||e.traceUnitDieDelete&&target.hp<=0||fields?.TriggerCount!==1||!Number.isFinite(fields.TriggerTime)||!Number.isFinite(fields.Lifetime)){
  e.dead=true;e.endReason='original-c4-target-or-template-ended';return true;
 }
 if(e.elapsed>=fields.TriggerTime+fields.Lifetime){e.dead=true;e.endReason='original-c4-display-lifetime-bound';return true;}
 const anchor=sim.effectAnchorSampler?.(e,target,{profile:sim.profileFor(target)});
 if(anchor){e.currentAnchor=structuredClone(anchor);[e.x,e.y,e.z]=anchor.position;}
 return true;
}
