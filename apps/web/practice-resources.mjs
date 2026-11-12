/** Explicit practice fixtures requested by the user. Profession equipment
 * presets and live-match initialization continue to use their own source HP. */
export const PRACTICE_TARGET_HP=9999999;
export function preparePracticeTarget(simulation){
  const target=simulation.state.actors[1];if(!target)throw Error('Practice target unavailable');
  target.hp=target.hpMax=PRACTICE_TARGET_HP;
  target.stats.hpMax=target.buffBaseStats.hpMax=PRACTICE_TARGET_HP;
}
export function restorePracticeResources(simulation){
  for(const actor of simulation.state.actors){actor.mp=actor.mpMax;
    for(const key of Object.keys(actor.cooldowns))actor.cooldowns[key]=0;}
}
