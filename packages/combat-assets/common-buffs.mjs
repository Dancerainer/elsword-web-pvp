/** Shared target buff display assets keep their own storage directory. Only
 * missing visual declarations are added; each profession's original closure
 * continues to own its existing resources and all attack definitions. */
const declarationKeys=['kind','fields','initialAnimation','initialSize','initialVelocity','initialDirSpeed','lifeTimeLiteral'];
const rebase=file=>{
  if(typeof file!=='string'||file.startsWith('/')||file.includes(':')||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..'))throw new TypeError('Invalid common buff asset path');
  return '../common-buffs/'+file;
};
export function addCommonBuffVisuals(index,common){
  if(!common)return index;
  if(common.schemaVersion!==1||common.referenceVersion!==index.referenceVersion)throw new TypeError('Common buffs must match the target version');
  const templates={...index.templates};
  for(const [name,original]of Object.entries(common.templates??{})){
    const existing=templates[name];
    if(existing){
      for(const key of declarationKeys)if(JSON.stringify(existing[key])!==JSON.stringify(original[key]))throw new Error('Conflicting common buff declaration: '+name+'.'+key);
      continue;
    }
    const template=structuredClone(original);
    for(const key of ['glb','poseData'])if(template[key])template[key]=rebase(template[key]);
    for(const texture of Object.values(template.textures??{}))if(texture.file)texture.file=rebase(texture.file);
    templates[name]=template;
  }
  return {...index,templates,commonBuffSourceFiles:common.sourceFiles??[]};
}
export function professionPoseAssetPath(id,file){
  return /^(?:\.\.\/common-buffs\/|\.\.\/battle-life\/|\.\.\/de\/)/.test(file)?file.slice(3):id.toLowerCase()+'/'+file;
}
