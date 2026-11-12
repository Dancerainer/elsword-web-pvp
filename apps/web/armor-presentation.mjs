import { Color3 } from '@babylonjs/core';
import {isBuffActive} from '../../packages/combat-core/buffs.mjs';
const sourceRed = new Color3(1, 0, 0);
const enduranceOrange=new Color3(1,.5,0);
export function hasElesisEnduranceOutline(actor){
  return ['GM','BH','CA'].includes(actor.professionId)&&actor.hp>0&&actor.buffs?.some(b=>b.templateId===238&&isBuffActive(b))===true;
}

/** X2GUUser.cpp 7094–7101, 14065–14067 (fixed V5 reference).
 * The red edge is independently gated from collision protection. The Lua
 * default for SUPER_ARMOR_NOT_RED is true; absent data must remain invisible.
 * No target CartoonSuperArmor texture exists in the audited 2016 catalog.
 */
export function hasVisibleSuperArmor(actor, rawState = {}, {showAll=false}={}) {
  const notRed = actor.superArmorNotRed ?? rawState.SUPER_ARMOR_NOT_RED ?? true;
  // Invulnerable actions (including Wolf Fang's confirmed slash) can also
  // carry SUPER_ARMOR in the source table. Their active protection takes
  // precedence over the optional armor outline.
  return actor.invincible !== true && actor.superArmor === true && (showAll || notRed === false || notRed === 0);
}

/** Change the existing skin-aware outline only; no duplicate geometry,
 * independent animatables, guessed shield, or extra texture shimmer.
 */
export function updateActorArmorPresentation(view, actor, rawState = {}, options={}) {
  const endurance=hasElesisEnduranceOutline(actor),active=endurance||hasVisibleSuperArmor(actor, rawState, options);
  // User-requested 25% widening of the existing protection edges only.
  // Keep the normal outline and camera-distance width formula unchanged.
  const widthMultiplier=endurance?2.125:active?2.5:1;
  view.armorOutlineDefaults ??= new Map();
  for (const mesh of view.meshes) {
    if (!mesh.getTotalVertices() || !mesh.renderOutline) continue;
    if (!view.armorOutlineDefaults.has(mesh)) view.armorOutlineDefaults.set(mesh, {color:mesh.outlineColor.clone(),width:mesh.outlineWidth});
    const defaults = view.armorOutlineDefaults.get(mesh);
    const color = endurance?enduranceOrange:active ? sourceRed : defaults.color;
    mesh.outlineColor.copyFrom(color);
    // Requested web visibility adjustment; the reference only establishes
    // the red-edge gate, not a measured 2016 outline thickness.
    mesh.outlineWidth = defaults.width * widthMultiplier;
  }
  view.armorPresentation = { active, endurance,sourceGateActive:hasVisibleSuperArmor(actor,rawState),
    showAllRequested:options.showAll===true,widthMultiplier,evidence: endurance?'target2016 buff238 OUT_LINE_WIDE1.7; user-requested orange display and 25% wider protection edge':'reference-V5 red CARTOON_COLOR_EDGE gate; user-requested 25% widening of the existing 2x protection edge' };
  return view.armorPresentation;
}
