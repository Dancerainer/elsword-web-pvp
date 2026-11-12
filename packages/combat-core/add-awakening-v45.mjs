/** Original2016 BDT_EFFECT_SET animation clock, qualified independently from
 * the unresolved Add awakening attack producer. See add-awakening-native-v45. */
export const ADD_FORMATION_SOURCE_SET='EffectSet_AN_Formation_Start';
export function applyAddFormationSourceClock(effect,actor,profile){
 if(effect.setName!==ADD_FORMATION_SOURCE_SET||effect.clock!=='animation')return false;
 if(profile.target?.unitType!==9||!['LP','MM','DE'].includes(actor.professionId?.toUpperCase())||effect.ownerId!==actor.id)
  throw new TypeError('Invalid original Add formation clock owner');
 // ctor321cec99:useAnimationTiming=true; consumer321cba0d..3d reads the
 // owner's current animation time directly. BDT32ae37d0 does not rebase it
 // to the .46 buff birth. Raw .3/.4 members are already due at that birth.
 effect.setStartAnimation=0;
 return true;
}
