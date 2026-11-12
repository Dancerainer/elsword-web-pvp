import {Vector3} from '@babylonjs/core';
import {characterToonMaterial} from './character-toon-material.mjs';
import {installNativeCharacterEdge,updateNativeCharacterEdge} from './native-character-edge.mjs';
import source from '../../contracts/common-presentation-source-v28.json' with {type:'json'};
import addSource from '../../contracts/add-common-presentation-v1.json' with {type:'json'};
function under(mesh,node){for(let p=mesh;p;p=p.parent)if(p===node)return true;return false;}
const sourceKey=id=>typeof id==='string'?id.toLowerCase():'';
export function nativeOutlineWidth(distance){return distance>700?distance/1000:distance/500;}
export function sourceActorCameraDistance(view,professionId,cameraPosition){
  const key=sourceKey(professionId),center=(addSource.weaponBindings[key]?addSource.unitCenter:source.unitCenters[key])?.center;if(!center||!view.root)return null;
  const world=Vector3.TransformCoordinates(new Vector3(center[0],center[1],-center[2]),view.root.computeWorldMatrix(true));
  return Vector3.Distance(world,cameraPosition)/.01;
}
export function updateWeaponPresentation(view,actor,professionId,{cameraDistance=null}={}){
  const key=sourceKey(professionId);
  const add=!!addSource.weaponBindings[key],names=add?addSource.weaponBindings[key].map(row=>row.node):[source.weaponBindings[key]?.node].filter(Boolean);
  if(view.weaponPresentation?.meshes!==view.meshes||view.weaponPresentation?.costume!==view.costume){
    const nodes=names.map(name=>view.nodesBySourceName?.get(name)).filter(Boolean);
    const costumeNames=add?Array.from({length:6},(_,i)=>'Costume_Dynamo0'+(i+1)):[source.costumeWeaponNode];
    nodes.push(...costumeNames.map(name=>view.costume?.body.nodesBySourceName?.get(name)).filter(Boolean));
    const weapons=new Set(view.meshes.filter(mesh=>nodes.some(node=>under(mesh,node))));
    view.weaponPresentation={meshes:view.meshes,costume:view.costume,weapons};
  }
  const awake=add?actor.sourceAdd?.formation===true:(actor.awakening?.remaining??0)>0;let selected=0;
  for(const mesh of view.meshes){
    const p=characterToonMaterial(mesh.material),weapon=view.weaponPresentation.weapons.has(mesh);
    if(p){p.awakenedWeapon=weapon&&awake;if(p.awakenedWeapon)selected++;}
    if(!mesh.getTotalVertices()||!mesh.renderOutline)continue;
    // Armor's user-requested multiplier is preserved, while the base width
    // follows the verified distance-to-camera formula.
    if(Number.isFinite(cameraDistance))mesh.outlineWidth=nativeOutlineWidth(cameraDistance)*(view.armorPresentation?.widthMultiplier??1);
    if(weapon&&p&&awake)mesh.outlineColor.copyFromFloats(1,85/255,17/255);
    else if(!view.armorPresentation?.active)mesh.outlineColor.copyFromFloats(0,0,0);
    installNativeCharacterEdge(mesh);updateNativeCharacterEdge(mesh);
  }
  const proof={awake,selected,verifiedMount:source.weaponBindings[key]?.node,...(add?{verifiedMounts:names}:{})};
  Object.assign(view.weaponPresentation,proof,{proof});return proof;
}
