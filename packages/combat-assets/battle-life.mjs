/** Display assets are shared across professions without changing their frozen
 * combat profiles. Original minor respawn declarations have an explicit scope. */
const keys=['kind','fields','events','repeated','declarationSha256'];
function rebase(file){
  if(typeof file!=='string'||file.startsWith('/')||file.includes(':')||file.includes('\\')||file.split('/').some(p=>!p||p==='.'||p==='..'))
    throw new TypeError('Invalid battle life asset path');
  return '../battle-life/'+file;
}
export function addBattleLifeVisuals(index,life){
  if(!life)return index;
  if(life.schemaVersion!==1||life.referenceVersion!==index.referenceVersion||life.clientMeasured!==false)
    throw new TypeError('Battle life resources must match the frozen target');
  const templates={...index.templates};
  for(const [name,source]of Object.entries(life.templates??{})){
    const old=templates[name];
    if(old){for(const key of keys)if(JSON.stringify(old[key])!==JSON.stringify(source[key]))throw new Error('Conflicting battle life declaration: '+name+'.'+key);continue;}
    const row=structuredClone(source);
    for(const key of ['glb','poseData'])if(row[key])row[key]=rebase(row[key]);
    for(const texture of Object.values(row.textures??{}))if(texture.file)texture.file=rebase(texture.file);
    templates[name]=row;
  }
  return {...index,templates,battleLife:life};
}
