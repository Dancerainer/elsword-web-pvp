/** Shared original particles stay separate from frozen combat profiles. */
export function addCastDisplayVisuals(index,cast){
  if(!cast)return index;
  if(cast.schemaVersion!==1||cast.referenceVersion!==index.referenceVersion||cast.clientMeasured!==false)throw Error('Casting resources must match frozen target');
  const templates={...index.templates};
  for(const [name,value]of Object.entries(cast.templates)){
    if(templates[name])throw Error('Conflicting casting template: '+name);
    const row=structuredClone(value);
    for(const texture of Object.values(row.textures??{})){
      if(!/^[\w./-]+$/.test(texture.file)||texture.file.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('Invalid casting texture path');
      texture.file='../cast-display/'+texture.file;
    }
    templates[name]=row;
  }
  return {...index,templates,castDisplay:cast};
}
