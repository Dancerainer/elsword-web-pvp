/** Original RF shadow-weapon declarations use Steam_BP while the shared
 * converted file is Steam_Bp. Keep cached RF and embedded VC declarations
 * readable on Linux without duplicating or replacing the original image.
 * This is an exact known alias, not a case-insensitive filesystem fallback.
 */
const aliases = new Map([
  ['rf/fx/textures/Steam_BP-0430ebd489.png', 'rf/fx/textures/Steam_Bp-0430ebd489.png'],
]);
export function canonicalAssetRequest(relative) {
  return aliases.get(relative) ?? relative;
}
