/** Registered Elsword classes share the original character's presentation and
 * Way of Sword. Class-specific commands, skills and stats stay in their profile. */
export const isElswordProfession = id => ['LK','RS','IS'].includes(id);
export const isElswordProfile = profile => [100,101,112].includes(profile?.target?.unitClass);
export const isElesisProfession = id => ['GM','BH','CA'].includes(id);
export const isElesisProfile = profile => [120,121,125].includes(profile?.target?.unitClass);
export const isAddProfession = id => ['LP','MM','DE'].includes(id);
export const isAddProfile = profile => [122,123,126].includes(profile?.target?.unitClass);
export const professionIdForProfile = profile => ({100:'LK',101:'RS',112:'IS',106:'BM',107:'RF',115:'VC',120:'GM',121:'BH',125:'CA',122:'LP',123:'MM',126:'DE'})[profile?.target?.unitClass];
