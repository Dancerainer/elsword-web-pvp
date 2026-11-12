/** Stable resource IDs; the names are English labels for the packaged scenes.
 * Geometry, collision and starts remain the original converted declarations.
 */
export const DEFAULT_SCENE_ID = 'sander-garpai-rock-pvp';
export const MAP_NAMES = Object.freeze({
  'ruben-el-tree-stage-pvp': 'El Tree',
  eltreedown: 'Lower El Tree',
  'elder-benders-cave-stage3': 'Banthus Cave',
  'elder-wally-castle-center-stage4': 'Wally’s Castle Center',
  'elder-wally-castle-roof-stage4': 'Wally’s Castle Rooftop',
  'besma-besma-lake-pvpmap': 'Bethma Lake',
  'besma-air-ship-pvpmap': 'Cargo Airship',
  'summer-2008-pvp': 'Summer Beach',
  'peita-offerings-stage-pvp': 'Altar of Dedication',
  'peita-spiral-corridor-pvp': 'Spiral Corridor',
  'velder-bridge-hope-stage-pvp': 'Hope Bridge',
  'pvp-winter-velder': 'Winter Velder',
  'sander-garpai-rock-pvp': 'Garpai Rock',
  'sander-villiage-pvpmap': 'Sander Village',
  'elder-druid-forest-stage-pvp': 'Shadow Forest (variant)',
  'summer-2008-pvp-test': 'Summer Beach (test variant)',
});
export function isMapId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
}

/** Scene IDs stay stable across localized resource packs. */
export function mapDisplayName({id, name}) {
  return MAP_NAMES[id] ?? (typeof name === 'string' && name.trim() && !/\p{Script=Han}/u.test(name) ? name : id);
}
