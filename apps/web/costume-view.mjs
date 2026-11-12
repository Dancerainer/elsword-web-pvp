import {createActorView,sampleAnimation} from './actor-presentation.mjs';
import {normalizeCostumeId,costumeCharacter,COSTUME_VERSION} from '../../packages/professions/costumes.mjs';
import {styleCostumeMaterials} from './costume-materials.mjs';
import {registerNasodLaserGlow} from './costume-laser-glow.mjs';

// Names are the retained meshes exported from the selected UnitTemplet face /
// Raven-left-arm items. Clothing and weapon skins never change combat geometry.
const retained={GM:['Eve_Face01_render'],BH:['Eve_Face01_render'],CA:['CA_Part_Ellysys_Face_render'],BM:['BM_Part_Raven_Face_render','Raven_Hand_render'],LK:['Elsword_Face_render'],RS:['Elsword_Face_render'],IS:['Elsword_Face_render'],RF:['RF_Part_Raven_Face_render','Raven_Left_Hand_render'],VC:['VC_Part_Raven_Face_render','VC_Part_Raven_Left_Hand_VC_render'],LP:['Add_Base_Face_render'],MM:['Add_Base_Face_render'],DE:['Add_Base_Face_render']};
export function createCostumeAssetCache(cache) {
  const choices=new Map();let manifest;
  return {async load(professionId,costumeId='default'){
    normalizeCostumeId(costumeId);const character=costumeCharacter(professionId);
    if(costumeId==='default')return null;
    const key=character+'/'+costumeId;if(choices.has(key))return choices.get(key);
    const pending=(async()=>{
      manifest??=cache.data('/assets/costumes/manifest.json').catch(error=>{manifest=null;throw error;});
      const index=await manifest,entry=index.characters?.[character]?.[costumeId];
      if(index.id!==COSTUME_VERSION||index.visualRevision!=='costume-effects-v2'||!entry)throw Error('Costume assets are missing or outdated: '+costumeId);
      const base='/assets/costumes/'+key+'/';
      const mode=async row=>row?.glb?{container:await cache.loadContainer(base,row.glb),pose:await cache.data(base+row.poseData),clip:row.animations[0]?.name,renderProfile:row.renderProfile}:null;
      const [bodyContainer,accessories,attachments]=await Promise.all([cache.loadContainer(base,entry.glb),
        Promise.all(entry.accessories.flatMap(item=>item.models.map(row=>({...row,itemId:item.itemId}))).map(async row=>({itemId:row.itemId,bone:row.bone,normal:await mode(row.normal),awakened:await mode(row.awakened),hasAwakened:!!row.awakened}))),
        Promise.all(entry.attachments.map(async row=>({...row,normal:await mode(row.normal)})))]);
      return {id:costumeId,entry,bodyContainer,accessories,attachments};
    })();choices.set(key,pending);pending.catch(()=>{if(choices.get(key)===pending)choices.delete(key);});return pending;
  }};
}

/** Prepare offscreen first; publication and replacement are synchronous. */
export function prepareCostumeView(view,assets,professionId,scene,style=()=>{}) {
  if(!assets)return null;
  const baseMeshes=view.costume?.baseMeshes??view.meshes;
  const keep=new Set(retained[professionId]);
  if([...keep].some(name=>!view.nodesBySourceName.has(name)))throw Error('Missing original profession face/arm');
  const children=[];let body,pairs,accessories,attachments,particles,active=false,disposed=false,normalTime=0,awakeTime=0;
  const make=(container,id,pose,parent,profile)=>{
    const child=createActorView(container,scene,view.id+'-costume-'+assets.id+'-'+id,1,pose);children.push(child);
    child.root.parent=parent;child.root.setEnabled(false);style(child);styleCostumeMaterials(child,profile,scene.getEngine());return child;
  };
  try{
    body=make(assets.bodyContainer,'body',null,view.root);
    pairs=assets.entry.poseFrames.map(({name})=>{
      const target=body.nodesBySourceName.get(name),source=view.nodesBySourceName.get(name);
      if(!target||!source)throw Error('Missing costume pose frame: '+name);
      return {target,source};
    });
    accessories=assets.accessories.map((row,index)=>{
      const bone=view.nodesBySourceName.get(row.bone);if(!bone)throw Error('Missing costume attachment: '+row.bone);
      const mode=(entry,suffix)=>entry?{view:make(entry.container,index+'-'+suffix,entry.pose,bone,entry.renderProfile),clip:entry.clip}:null;
      return {itemId:row.itemId,normal:mode(row.normal,'normal'),awakened:mode(row.awakened,'awakened'),hasAwakened:row.hasAwakened};
    });
    const ownerFor=row=>row.owner==='body'?body:accessories.find(a=>a.itemId===row.owner)?.normal?.view;
    const boneFor=row=>{const bone=ownerFor(row)?.nodesBySourceName.get(row.bone);if(!bone)throw Error('Missing costume sub-attachment bone: '+row.owner+'/'+row.bone);return bone;};
    attachments=assets.attachments.map((row,index)=>{
      const child=make(row.normal.container,'sub-'+index,row.normal.pose,boneFor(row),row.normal.renderProfile);
      registerNasodLaserGlow(child,row.itemId,scene);
      return {view:child,clip:row.normal.clip};
    });
    particles=assets.entry.particles.map(row=>{const bone=boneFor(row);return {template:row.template,position(){
      const m=bone.computeWorldMatrix(true).asArray();return [m[12]/.01,m[13]/.01,-m[14]/.01];
    }};});
  }catch(error){for(const child of children)child.dispose();throw error;}
  const appearance={id:assets.id,baseMeshes,body,accessories,attachments,particles,
    activate(){if(disposed)throw Error('Disposed costume');active=true;body.root.setEnabled(true);
      for(const mesh of baseMeshes)if(mesh.getTotalVertices())mesh.isVisible=keep.has(mesh.name.slice(view.id.length+1));
      view.meshes=[...baseMeshes,...children.flatMap(child=>child.meshes)];appearance.update({},0);
    },
    update(actor,dt=0){if(!active||disposed)return;const awake=(actor.awakening?.remaining??0)>0;
      normalTime+=Math.max(0,dt);if(awake)awakeTime+=Math.max(0,dt);
      for(const {source,target}of pairs){target.position.copyFrom(source.position);target.scaling.copyFrom(source.scaling);
        if(source.rotationQuaternion){if(target.rotationQuaternion)target.rotationQuaternion.copyFrom(source.rotationQuaternion);else target.rotationQuaternion=source.rotationQuaternion.clone();}
        else {target.rotationQuaternion=null;target.rotation.copyFrom(source.rotation);}}
      for(const row of accessories){for(const [mode,time]of [['normal',normalTime],['awakened',awakeTime]]){
        const entry=row[mode];if(!entry)continue;
        entry.view.root.setEnabled(mode==='awakened'?awake:!awake||!row.hasAwakened);
        if(entry.clip&&(mode==='normal'||awake))sampleAnimation(entry.view,entry.clip,time,true);
      }}
      for(const entry of attachments){entry.view.root.setEnabled(true);if(entry.clip)sampleAnimation(entry.view,entry.clip,normalTime,true);}
    },
    dispose(){if(disposed)return;disposed=true;for(const child of children){
      for(const mesh of child.meshes){view.armorOutlineDefaults?.delete(mesh);view.invulnerabilityEmissiveDefaults?.delete(mesh.material);}
      child.dispose();
    }
      if(active){for(const mesh of baseMeshes)mesh.isVisible=true;view.meshes=baseMeshes;}active=false;}
  };return appearance;
}
export function publishCostume(view,appearance){view.costume?.dispose();view.costume=appearance;appearance?.activate();}
