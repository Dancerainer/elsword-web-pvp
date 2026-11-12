import source from '../../contracts/add-literal-meshes-v31.json' with {type:'json'};
import fissionDrone from '../../contracts/mm-fission-drone-v32.json' with {type:'json'};
import analysis from '../../contracts/add-analysis-literal-meshes-v37.json' with {type:'json'};
// DE aerial ZX exact original source has initialDirSpeed2000 and0.270s
// lifetime, independently sealed in de-air-combo-visual-v45.json.
export const ADD_LITERAL_MESH_NAMES=new Set([...source.rows,...fissionDrone.rows,...analysis.rows].map(row=>row.name).concat('Mesh_ADE_Dash_Jump_Combo_XXX','Mesh_ATT_Stardust_Shower_Drop','ATT_Stardust_Shower_M01','ATT_Stardust_Shower_M02'));
export function addLiteralMotionEvents(profile,effect,events){
 return usesAddLiteralMesh(profile,effect)?events.filter(event=>event.property!=='SlashTrace'):events;
}
export function usesAddLiteralMesh(profile,effect){
 return [122,123,126].includes(profile.target?.unitClass)&&ADD_LITERAL_MESH_NAMES.has(effect.mainEffectName)&&
  ![effect.definition.TRACE,effect.definition.TRACE_MORE,effect.definition.TRACE_MATRIX].some(v=>v===1);
}
export function addLiteralMotionRotation(profile,effect){
 if(!usesAddLiteralMesh(profile,effect))return undefined;
 // Stardust's Initial Rotate is a local display/skin transform (458..460).
 // Its velocity uses the separate external birth basis, not that local roll.
 if(effect.sourceAddStardustMesh||effect.mainEffectName==='ATT_Stardust_Shower_M02')return effect.birthAnchor.rotation??[0,0,0];
 const rotation=profile.effectTemplates[effect.mainEffectName]?.events.find(e=>e.property==='Rotate'&&e.start===0&&!e.fade)?.value;
 if(!rotation||rotation[0]!==0||rotation[1]!==0)return undefined;
 return [0,effect.birthAnchor.rotation?.[1]??0,rotation[2]+(effect.sourceAddFissionSplit?effect.birthAnchor.rotation?.[2]??0:0)];
}
