import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
import {PROFESSIONS,PROFESSION_IDS,normalizeProfessionId,isRavenProfession} from '../../packages/professions/catalog.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {addCommonBuffVisuals} from '../../packages/combat-assets/common-buffs.mjs';
import {addCastDisplayVisuals} from '../../packages/combat-assets/cast-display.mjs';
import {addBattleLifeVisuals} from '../../packages/combat-assets/battle-life.mjs';
import {assetUrl} from './asset-urls.mjs';
import {loadAddSummonAssets,mergeAddSummonAudio} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {addPrismEndpointAudio} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {addPlayerFeedbackVisuals,loadPlayerFeedbackVisualIndexes,playerFeedbackVisualIndexFiles} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
const rfIndexes=['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx'].map(name=>name+'/index.json');

export async function loadProfessionAssets({id,data,loadContainer,map,onUnsupported,commonBuffVisuals,commonBuffSourceIndexes=[],battleLifeVisuals,battleLifeSourceIndexes=[],castDisplayVisuals,castDisplaySourceIndexes=[],retainContainersOnFailure=false}) {
  normalizeProfessionId(id);
  const pendingContainers=[],pendingBranches=[],loadedContainers=new Set();
  const branch=promise=>{pendingBranches.push(promise);return promise;};
  const container=(base,file)=>{const pending=Promise.resolve().then(()=>loadContainer(base,file)).then(value=>{loadedContainers.add(value);return value;});pendingContainers.push(pending);return pending;};
  try {
  const base=PROFESSIONS[id].assetBase,profile=getProfessionProfile(id),manifest=await data(base+'manifest.json');
  const visualIndexFiles=manifest.visualEffectIndexes??(id==='RF'?rfIndexes:['fx/index.json']);
  // Only the manifest is a common prerequisite. Do not make small independent
  // JSON/audio/core reads wait for a body GLB decode or its shader preparation.
  const body=branch(container(base,manifest.runtimeGlb??manifest.glb));
  const pose=branch(Promise.resolve().then(()=>data(base+manifest.runtimePose)).then(async raw=>
    composeCharacterPose(raw,raw.sharedPose?await data(base+raw.sharedPose):null)));
  const shared=branch(manifest.sharedCharacterAnimations?.clips.length?container(base,manifest.sharedCharacterAnimations.glb):Promise.resolve(null));
  const summon=branch(id==='MM'&&profile.summonDeclarations?.apocalypse?
    loadAddSummonAssets({base,data,loadContainer:container,profile}):Promise.resolve(null));
  const coreFile=manifest.mechanismResources?.ravenNasodCore?.glb??null;
  const core=branch(coreFile?Promise.all([container(base,coreFile),data(base+coreFile.replace(/\.glb$/,'.pose.json'))]):Promise.resolve([null,null]));
  const sound=branch(manifest.audioManifest?Promise.resolve().then(()=>data(base+manifest.audioManifest)):Promise.resolve(null));
  const visuals=branch(Promise.all([
    data(base+manifest.effectAssetIndex),Promise.all(visualIndexFiles.map(file=>data(base+file))),
    loadPlayerFeedbackVisualIndexes(id,file=>data('/assets/'+file)),summon,
  ]).then(async([oldEffectIndex,indexes,feedback,apocalypse])=>{
    indexes.push(...feedback);
    const fxIndex=addCastDisplayVisuals(addBattleLifeVisuals(addCommonBuffVisuals(addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...indexes,...(apocalypse?[apocalypse.fxIndex]:[])),id),commonBuffVisuals),battleLifeVisuals),castDisplayVisuals),effectIndex=mergeEffectIndexes(oldEffectIndex,fxIndex);
    const effectPoses=Object.fromEntries(await Promise.all(collectEffectPoseFiles(effectIndex,fxIndex).map(async file=>[file,await data(base+file)])));
    return {indexes,fxIndex,effectIndex,effectPoses};
  }));
  const [bodyContainer,characterPose,sharedContainer,apocalypse,[coreContainer,corePose],originalAudio,{indexes,fxIndex,effectIndex,effectPoses}]=
    await Promise.all([body,pose,shared,summon,core,sound,visuals]);
  const samplers=createNativeSamplers({characterPose,effectIndex,effectPoses,profile,map,onUnsupported});
  if(apocalypse)Object.assign(samplers,createAddSummonSamplers({...apocalypse,onUnsupported}));
  let audio=originalAudio;
  if(apocalypse)audio=mergeAddSummonAudio(audio,apocalypse.audio);
  if(['LP','MM','DE'].includes(id))audio=mergeAddSummonAudio(audio,addPrismEndpointAudio);
  if(sharedContainer){
    // Pose keys and compact GLB groups have independent inventories. BM/RS
    // retain full source keys (sharedClips=[]), while their GLBs still omit
    // the manifest-declared shared groups. Include the exact GLB contract as
    // well as source-pose additions such as Raven's recovery animations.
    const sharedGroups=[...new Set([...manifest.sharedCharacterAnimations.clips,...(characterPose.sharedClips??[])])];
    // Mutate the cached body only after the other assembly/validation steps
    // succeeded. If a later shared group fails, retire the already installed
    // clones so an asset-record retry starts from the original body groups.
    const originalGroupCount=bodyContainer.animationGroups.length;
    try{installSharedCharacterAnimations(bodyContainer,sharedContainer,sharedGroups);}
    catch(error){for(const group of bodyContainer.animationGroups.splice(originalGroupCount))group.dispose?.();throw error;}
  }
  return {id,base,manifest,profile,bodyContainer,characterPose,effectIndex,fxIndex,effectPoses,samplers,coreContainer,corePose,audio,summons:apocalypse?{apocalypse}:{},
    sourceIndexes:[...visualIndexFiles.map(file=>base+file),...playerFeedbackVisualIndexFiles(id).map(file=>'/assets/'+file),...(apocalypse?.sourceIndexes??[]),...(commonBuffVisuals?commonBuffSourceIndexes:[]),...(battleLifeVisuals?battleLifeSourceIndexes:[]),...(castDisplayVisuals?castDisplaySourceIndexes:[])],
    criticalSoundFile:indexes.find(index=>index.audio?.file)?.audio.file};
  } catch(error) {
    // Promise.all may reject before a GLB decoder finishes. Wait for every
    // owned container before releasing, including a late successful decode.
    // A late summon manifest can start a container after another branch has
    // already failed. Drain the branches before taking the container snapshot.
    await Promise.allSettled(pendingBranches);
    await Promise.allSettled(pendingContainers);
    if(!retainContainersOnFailure)for(const value of loadedContainers)value?.dispose?.();
    throw error;
  }
}

/** A cache belongs to one scene/page, never to a global profession selection.
 * A rejected leaf is evicted while successful partial loads remain owned here
 * for retry. In particular, a late pose failure cannot leak/redecode its GLB.
 * Dispose only after all actor/effect consumers of these containers retire. */
export function createProfessionAssetCache({data,loadContainer,loadImage=loadDecodedProfessionImage,...options}) {
  const json=new Map(),containers=new Map(),images=new Map(),assetRecords=new Map(),professions=new Map();
  const attempts={json:0,containers:0,images:0},failures={json:0,containers:0,images:0};
  const ownedContainers=new Set(),ownedImages=new Set();let disposed=false;
  const open=()=>{if(disposed)throw Error('Profession asset cache disposed');};
  const key=url=>assetUrl(new URL(url,'http://profession-assets.local').pathname);
  function cached(cache,kind,url,load,owned,release) {
    open();const id=key(url);if(cache.has(id))return cache.get(id);
    attempts[kind]++;
    const pending=Promise.resolve().then(load).then(value=>{
      if(disposed){release?.(value);throw Error('Profession asset cache disposed');}
      owned?.add(value);return value;
    }).catch(error=>{failures[kind]++;if(cache.get(id)===pending)cache.delete(id);throw error;});
    cache.set(id,pending);return pending;
  }
  const releaseContainer=value=>value?.dispose?.();
  const releaseImage=value=>{if(value)value.src='';};
  const cachedData=url=>cached(json,'json',url,async()=>compactPoseDocument(await data(url)));
  const cachedContainer=(base,file)=>cached(containers,'containers',base+file,()=>loadContainer(base,file),ownedContainers,releaseContainer);
  const cachedImage=url=>cached(images,'images',url,()=>loadImage(assetUrl(url)),ownedImages,releaseImage);
  function loadAssetRecord(id) {
    if(assetRecords.has(id))return assetRecords.get(id);
    // Assembly installs shared animation groups onto the cached body exactly
    // once. An independent catalog/icon failure must not rerun that mutation,
    // including when a caller retries while this branch is still preparing.
    const pending=loadProfessionAssets({id,...options,data:cachedData,loadContainer:cachedContainer,retainContainersOnFailure:true})
      .then(assets=>{open();return assets;})
      .catch(error=>{if(assetRecords.get(id)===pending)assetRecords.delete(id);throw error;});
    assetRecords.set(id,pending);return pending;
  }
  function load(id) {
    open();normalizeProfessionId(id);if(professions.has(id))return professions.get(id);
    const pending=Promise.all([
      loadAssetRecord(id),
      cachedData(PROFESSIONS[id].catalogUrl).then(async catalog=>{
        await Promise.all(collectProfessionImageUrls(id,catalog).map(cachedImage));return catalog;
      }),
    ]).then(([assets,catalog])=>{
      open();
      return {...assets,catalog,allSkillLoadout:allProfessionSkillLoadout(assets.profile)};
    }).catch(error=>{if(professions.get(id)===pending)professions.delete(id);throw error;});
    professions.set(id,pending);return pending;
  }
  return {load,data:cachedData,loadContainer:cachedContainer,
    async loadAll(ids=PROFESSION_IDS){
      const ordered=[...new Set(ids)];for(const id of ordered)normalizeProfessionId(id);
      const values=new Array(ordered.length);let next=0,failed=false;
      async function worker(){while(!failed&&next<ordered.length){const index=next++;try{values[index]=await load(ordered[index]);}catch(error){failed=true;throw error;}}}
      // At most two roster professions prepare together; this overlaps I/O
      // without eagerly decoding all twelve choices or changing Map order.
      const workers=await Promise.allSettled(Array.from({length:Math.min(2,ordered.length)},worker));
      const failure=workers.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      return new Map(ordered.map((id,index)=>[id,values[index]]));
    },
    proof(){return {disposed,professions:professions.size,assetRecords:assetRecords.size,json:json.size,containers:containers.size,images:images.size,
      attempts:{...attempts},failures:{...failures}};},
    dispose(){if(disposed)return;disposed=true;professions.clear();assetRecords.clear();json.clear();containers.clear();images.clear();
      for(const value of ownedContainers)releaseContainer(value);ownedContainers.clear();
      for(const value of ownedImages)releaseImage(value);ownedImages.clear();},
  };
}

export function collectProfessionImageUrls(id,catalog) {
  normalizeProfessionId(id);
  return [...new Set([PROFESSIONS[id].portraitUrl,
    ...(id==='RF'?['/assets/ui/r_fist_state.png']:[PROFESSIONS[id].assetBase+'ui/portrait-state.png']),
    ...(isRavenProfession(id)?['/assets/ui/raven_3_bg.png','/assets/ui/raven_3.png']:[]),
    '/assets/ui/rage_bg.png','/assets/ui/rage_bead.png',
    '/assets/ui/skill-sword/skill-sword-blue.png','/assets/ui/skill-sword/skill-sword-red.png',
    ...(catalog.skills??[]).filter(skill=>skill.icon).map(skill=>'/assets/ui/skills/'+skill.icon),
    ...['memo_lock','memo_select','memo_open'].map(name=>'/assets/ui/skill-picker/'+name+'.png')])];
}
export async function loadDecodedProfessionImage(url) {
  const image=new Image();image.decoding='async';image.src=url;
  try{await image.decode();return image;}catch(error){image.src='';throw error;}
}

/** Source catalog states include their ordinary/awake and trait branches.
 * This is a resource union, not a legal equipped loadout or a gameplay cast. */
export function allProfessionSkillLoadout(profile) {
  return [...new Set((profile.skillCatalog??[]).filter(skill=>skill.states?.length).map(skill=>Number(skill.skillId)))].map(skillId=>({skillId}));
}
const fullSkillPreparations=new WeakMap();
export async function prewarmAllProfessionSkills(effectViews,professionAssets) {
  const entries=professionAssets instanceof Map?[...professionAssets]:Object.entries(professionAssets);
  await Promise.all(entries.map(async([id,assets])=>{
    const view=effectViews[id];if(!view)throw Error('Missing profession effect view: '+id);
    const loadout=assets.allSkillLoadout??allProfessionSkillLoadout(assets.profile),key=JSON.stringify([id,loadout]);
    let cached=fullSkillPreparations.get(view);
    if(cached?.key!==key){
      // One source material preparation per authored pass. Saved eight-slot
      // loadouts and multiplayer rosters own their separate finite burst pool.
      const promise=Promise.resolve().then(()=>view.prewarmResources(loadout));
      cached={key,promise};fullSkillPreparations.set(view,cached);
      promise.catch(()=>{if(fullSkillPreparations.get(view)===cached)fullSkillPreparations.delete(view);});
    }
    await cached.promise;
  }));
}
