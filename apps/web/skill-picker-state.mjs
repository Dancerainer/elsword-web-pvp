// Display order is independent of the combat slot indices (ASDCQWER).
export function skillSlotPosition(key) {
  const top='QWER'.indexOf(String(key).toUpperCase());
  const bottom='ASDC'.indexOf(String(key).toUpperCase());
  if(top<0&&bottom<0)throw Error('Unknown skill key');
  return {row:top>=0?1:2,column:(top>=0?top:bottom)+1,defaultRow:bottom>=0};
}
/** Right-click equips the first empty default-row slot, then the upper row.
 * Slot indices and saved skill/trait objects do not change when F becomes C. */
export function quickEquipTarget(loadout,skillId) {
  if(!Array.isArray(loadout)||loadout.length!==8)throw Error('The skill bar needs eight slots');
  if(loadout.some(slot=>Number(slot?.skillId)===Number(skillId)))throw Error('Skill already equipped. Drag to move it.');
  const target=loadout.findIndex(slot=>slot==null);
  if(target<0)throw Error('Skill bar full. Right-click a slot to clear it or drag to replace it.');
  return target;
}
export function placeSkillSlot(element,key) {
  const position=skillSlotPosition(key);
  element.style.gridRow=String(position.row);element.style.gridColumn=String(position.column);
  element.dataset.defaultRow=String(position.defaultRow);return element;
}
const idOf=skill=>Number(skill?.skillId??skill?.id);
const keyOf=branch=>String(branch?.branchId??branch?.id);
const branchesOf=skill=>skill?.branches??[];
export function validatePickerBranch(skill,branchId) {
  if(!skill||skill.passive||[1,8].includes(skill.type))throw Error('Passive skills have no selectable traits');
  const id=String(branchId);
  if(id!=='none'&&!branchesOf(skill).some(b=>keyOf(b)===id&&(b.selectable===true||b.supported===true)))
    throw Error('Invalid skill trait');
  return id;
}
/** Saved preferences are independent of equipment; only recognized IDs survive. */
export function readPickerBranches(raw,skills) {
  const result={};let entries;
  try{entries=typeof raw==='string'?JSON.parse(raw):raw;}catch{return result;}
  if(!entries||Array.isArray(entries)||typeof entries!=='object')return result;
  for(const skill of skills){const id=idOf(skill);if(!Object.hasOwn(entries,id))continue;
    try{result[id]=validatePickerBranch(skill,entries[id]);}catch{}}
  return result;
}
export function choosePickerBranch(choices,skill,branchId) {
  return {...choices,[idOf(skill)]:validatePickerBranch(skill,branchId)};
}
export function applyPickerBranches(loadout,choices,skills) {
  return loadout.map(slot=>{
    if(!slot)return null;
    const next={...slot},skill=skills.find(s=>idOf(s)===Number(slot.skillId));
    if(Object.hasOwn(choices,slot.skillId))next.branchId=validatePickerBranch(skill,choices[slot.skillId]);
    return next;
  });
}
