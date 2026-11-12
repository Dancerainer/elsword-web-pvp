import source from '../../contracts/add-crest-display-v61.json' with {type:'json'};
export const ADD_CREST_SOURCE_FILES=Object.freeze(source.sourceFiles);
export const ADD_CREST_DISPLAY_SET='EffectSet_ATT_Common_Crest_of_Time_Buff';
export const ADD_CREST_DISPLAY_NAMES=Object.freeze(Object.keys(source.templates));
/** Presentation-only closure. The original recipient436 BDT is represented
 * by existing authoritative sourceTimeRing, not a second resource/revive buff. */
export function installAddCrestDisplayProfile(profile,index){
 if(index&&!ADD_CREST_DISPLAY_NAMES.every(name=>index.templates?.[name]))return profile;
 return {...profile,effectSets:{...profile.effectSets,...source.effectSets},
  effectTemplates:{...profile.effectTemplates,...source.templates},
  resourceOnlyTemplates:[...new Set([...(profile.resourceOnlyTemplates??[]),...ADD_CREST_DISPLAY_NAMES])]};
}
export function addCrestDisplayTemplates(templates,id){
 for(const [name,value]of Object.entries(source.templates)){
  const prefix=id==='DE'?'':'../de/';
  const template={...value,...(value.glb?{glb:prefix+value.glb}:{}),...(value.poseData?{poseData:prefix+value.poseData}:{}),
   textures:Object.fromEntries(Object.entries(value.textures).map(([key,t])=>[key,{...t,file:prefix+t.file}]))};
  const old=templates[name];if(old&&old.declarationSha256!==template.declarationSha256)throw TypeError('Conflicting original Crest recipient display: '+name);
  templates[name]=old??template;
 }
}
