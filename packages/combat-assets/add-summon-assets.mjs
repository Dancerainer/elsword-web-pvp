/** Browser/headless shared resource composition for the independent NPC. */
export const APOCALYPSE_ASSET_DIRECTORY='summons/apocalypse/';
function relativePath(value){
  if(typeof value!=='string'||!value||value.startsWith('/')||/[\\:\0?#]/.test(value))throw new TypeError('Invalid summon resource path');
  const parts=[];for(const part of value.split('/')){if(!part||part==='.')continue;if(part==='..'&&parts.length&&parts.at(-1)!=='..')parts.pop();else parts.push(part);}
  return parts.join('/');
}
export function rebaseAddSummonEffectIndex(index,prefix=APOCALYPSE_ASSET_DIRECTORY){
  if(index?.schemaVersion!==1||!index.templates)throw new TypeError('Original summon effect index required');
  const result=structuredClone(index);
  for(const t of Object.values(result.templates)){
    for(const key of ['glb','poseData'])if(t[key])t[key]=relativePath(prefix+t[key]);
    for(const value of Object.values(t.textures??{}))value.file=relativePath(prefix+value.file);
  }
  return result;
}
export function mergeAddSummonAudio(original,extra){
  if(!extra)return original;
  if(extra.schemaVersion!==1||!extra.files)throw new TypeError('Original summon audio manifest required');
  if(!original)return structuredClone(extra);
  const result={...original};
  for(const key of ['files','states','effectSounds']){
    result[key]={...original[key]};
    for(const [name,value]of Object.entries(extra[key]??{})){
      const prior=result[key][name];
      if(prior&&(key==='files'?prior.sha256!==value.sha256:JSON.stringify(prior)!==JSON.stringify(value)))throw new Error('Conflicting original summon audio '+key+': '+name);
      if(!prior)result[key][name]=value;
    }
  }
  result.unsupported=[...(original.unsupported??[]),...(extra.unsupported??[])];
  result.summonSources=[...(original.summonSources??[]),extra.profile];return result;
}
/** loadContainer is optional for headless use. Callers own any container and
 * include this function's JSON reads in their ordinary fingerprint inventory. */
export async function loadAddSummonAssets({base,data,loadContainer,profile}){
  const directory=APOCALYPSE_ASSET_DIRECTORY,manifest=await data(base+directory+'manifest.json');
  if(manifest.npcId!==1604||manifest.id!=='apocalypse'||manifest.unitScale!==manifest.rawSystem?.UNIT_SCALE)throw new TypeError('Invalid original Apocalypse manifest');
  const source=profile?.summonDeclarations?.apocalypse?.source;
  if(source?.sha256&&source.sha256!==manifest.source?.sha256)throw new TypeError('NPC profile and asset source mismatch');
  const [pose,fx,audio,bodyContainer]=await Promise.all([
    data(base+directory+relativePath(manifest.poseData)),data(base+directory+relativePath(manifest.fx)),
    data(base+directory+relativePath(manifest.audio)),
    loadContainer?loadContainer(base+directory,relativePath(manifest.runtimeGlb)):null,
  ]);
  return {manifest,pose,bodyContainer,base:base+directory,fxIndex:rebaseAddSummonEffectIndex(fx),audio,
    sourceIndexes:[base+directory+'manifest.json',base+directory+manifest.fx]};
}
