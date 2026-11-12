/** Original ADD atlas crops use their own base; never an online icon alias. */
export const ADD_BUFF_ICON_KEYS=Object.freeze({320:'BUFF_ICON_HYPER',436:'BUFF_ICON_CREST_OF_TIME',673:'DEBUFF_ICON_CREST_OF_TIME'});
export function addBuffIcon(index,{templateId,iconKey}={},assetBase='/assets/ui/add/'){
  const key=String(iconKey??ADD_BUFF_ICON_KEYS[templateId]??'').toUpperCase();
  if(!Object.values(ADD_BUFF_ICON_KEYS).includes(key))return null;
  const piece=index?.pieces?.[key];
  return typeof piece?.file==='string'&&piece.file?{...piece,iconKey:key,iconBase:assetBase}:null;
}
