import {nativeEffectDepthProfile} from './native-effect-depth-v7.mjs';

/** Particle quad color/size/rotation live in instance attributes. Template
 * names and native layers therefore need not allocate different materials.
 * Keep texture, shader and actual scoped blend/depth state as hard barriers.
 * The renderer still sorts every emitter and only joins consecutive draws. */
const scenes=new WeakMap();
export function sharedNativeQuadMaterial({scene,template,path,assetBase,create,adopt}){
  let materials=scenes.get(scene);if(!materials){materials=new Map();scenes.set(scene,materials);}
  const untextured=path==='@native-untextured',fields=template.fields;
  const url=untextured?path:new URL(assetBase+path,'http://native-effect-assets.invalid').href;
  const depth=nativeEffectDepthProfile(template);
  const key=JSON.stringify([url,untextured?'untextured':'textured',
    fields.SourceBlendMode??'D3DBLEND_SRCALPHA',fields.DestBlendMode??(template.kind==='mesh'?'D3DBLEND_INVSRCALPHA':'D3DBLEND_DESTALPHA'),depth.depthTest,depth.depthWrite]);
  let entry=materials.get(key);
  if(!entry||entry.material.isDisposed?.()){
    const created=create();
    // Existing material-only callers remain valid. Production quad factories
    // include their sampler and original load promise so every profession's
    // resource closure can await and diagnose the same texture, including a
    // rejected load. Reusing a shader must never bypass sampler readiness.
    entry=Object.hasOwn(created,'material')?created:{material:created};materials.set(key,entry);
    entry.material.onDisposeObservable?.addOnce(()=>{if(materials.get(key)===entry)materials.delete(key);});
  }
  adopt?.(entry);
  return entry.material;
}
