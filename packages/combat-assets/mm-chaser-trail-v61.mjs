import source from '../../contracts/mm-chaser-trail-v61.json' with {type:'json'};
export const MM_CHASER_TRAIL_TEXTURE=source.texture;
export function addMmChaserTrailTexture(templates,id){
 if(id!=='MM')return;const t=templates[source.target.template];if(!t)return;
 if(t.declarationSha256!==source.target.declarationSha256)throw TypeError('Chaser original trail source conflict');
 templates[t.name]={...t,textures:{...t.textures,'ADD_EXTINCTION_Trace02.dds':{file:source.texture.file,width:source.texture.width,height:source.texture.height,
  source:{archive:'data/data147.kom',name:'ADD_EXTINCTION_Trace02.dds',sha256:source.texture.sha256,bytes:source.texture.bytes}}}};
}
