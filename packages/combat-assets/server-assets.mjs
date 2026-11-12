/** Headless counterpart of the browser's authenticated asset loading. */
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_VERSION} from '../combat-core/index.mjs';
import {createNativeRuntime} from '../native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from './index.mjs';
import {composeCharacterPose} from './shared-character.mjs';
import {addPlayerFeedbackVisuals,loadPlayerFeedbackVisualIndexes,playerFeedbackVisualTextureFiles} from './player-feedback-visuals-v45.mjs';
import {createProfessionSamplers} from './profession-samplers.mjs';
import {loadAddSummonAssets} from './add-summon-assets.mjs';
import {createAddSummonSamplers} from './add-summon-samplers.mjs';
import prismSource from '../../contracts/add-prism-endpoints-2016.json' with {type:'json'};
import {addCommonBuffVisuals,professionPoseAssetPath} from './common-buffs.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from './effect-indexes.mjs';
import {createFingerprintInventory,fingerprintHostProgram,RESOURCE_FINGERPRINT_DOMAIN} from './program-fingerprint.mjs';
import {DEFAULT_SCENE_ID,MAP_NAMES,isMapId} from '../online/map-pool.mjs';
import {MODE_CONFIG,ONLINE_MODES} from '../online/modes.mjs';
import {chooseTeamSpawns} from '../pvp/index.mjs';
import {PROFESSIONS,PROFESSION_IDS} from '../professions/catalog.mjs';
import {compactPoseDocument} from './compact-pose.mjs';
export async function loadServerCombatAssets({root,assetRoot}){
  const resources=createFingerprintInventory(RESOURCE_FINGERPRINT_DOMAIN);
  const readBytes=async file=>{
    if(typeof file!=='string'||!file||file.includes(':')||file.includes('\\')||file.includes('\0'))throw new TypeError('Invalid source asset path');
    const normalized=path.posix.normalize(file);
    if(normalized==='..'||normalized.startsWith('../')||normalized.startsWith('/'))throw new TypeError('Source asset escaped its root');
    const bytes=await readFile(path.join(assetRoot,normalized));resources.add('assets/'+normalized,bytes);return bytes;
  };
  // Hash original bytes first, then use the browser's exact Float64 storage.
  // This releases one nested JS array per animation key without altering source
  // resources, precision, Native modules or which professions the loader visits.
  const read=async file=>compactPoseDocument(JSON.parse((await readBytes(file)).toString('utf8')));
  const readConfig=async file=>{const bytes=await readFile(path.join(root,file));resources.add(file,bytes);return JSON.parse(bytes.toString('utf8'));};
  const profile=await readConfig('packages/combat-core/rf-profile.json');
  const preset=await readConfig('config/rf-preset.json');
  const defaultManifest=await read('scene/'+DEFAULT_SCENE_ID+'/manifest.json');
  const map={...defaultManifest,...await read('scene/'+DEFAULT_SCENE_ID+'/collision.json')};
  const rf=await read('rf/manifest.json'),manifest=await read('native/manifest.json');
  let mapEffects;
  try{mapEffects=await read('map-mechanics/index.json');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(mapEffects){
    for(const file of new Set(Object.values(mapEffects.templates).map(t=>t.poseData).filter(Boolean)))
      await read('map-mechanics/'+file);
    const files=new Set(Object.values(mapEffects.templates).flatMap(t=>[t.glb,
      ...Object.values(t.textures??{}).map(texture=>texture.file)]).filter(Boolean));
    for(const audio of Object.values(mapEffects.audio??{}))files.add(audio.file);
    for(const file of files)if(!(await stat(path.join(assetRoot,'map-mechanics',file))).isFile())
      throw Error('pvp-map-effect-resource-missing: '+file);
  }
  let commonBuffManifest,commonBuffs,commonBuffVisuals;
  try{commonBuffManifest=await read('common-buffs/manifest.json');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(commonBuffManifest){commonBuffs=await read('common-buffs/'+commonBuffManifest.definitionCatalog);
    commonBuffVisuals=mergeVisualEffectIndexes(...await Promise.all(commonBuffManifest.visualEffectIndexes.map(file=>read('common-buffs/'+file))));}
  const indexes=await Promise.all(['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'].map(f=>read('rf/'+f+'/index.json')));
  // Older minimal fixtures/releases predate this display-only source overlay.
  // When present it belongs to the real effect/pose closure and resource seal.
  try {indexes.push(await read('rf/landing-fx/index.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const visual=addCommonBuffVisuals(addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...indexes),'RF'),commonBuffVisuals);
  const effectIndex=mergeEffectIndexes(await read('rf/'+rf.effectAssetIndex),visual);
  const characterPose=await read('rf/'+rf.runtimePose);
  const effectPoses=Object.fromEntries(await Promise.all(collectEffectPoseFiles(effectIndex,visual).map(async f=>[f,await read(professionPoseAssetPath('RF',f))])));
  const profiles={RF:profile},presets={RF:preset},professionAssets={RF:{characterPose,effectIndex,effectPoses}},assetDiagnostics=[];
  for(const id of PROFESSION_IDS.filter(id=>id!=='RF')){
  const folder=id.toLowerCase(),unitClass=PROFESSIONS[id].unitClass;
  try{
    // Optional professions publish atomically. A partial deployment must not
    // disable the prepared RF room or seal unconsumed partial LK inputs.
    const resolveAssetPath=relative=>{
      if(typeof relative!=='string'||!relative||relative.includes(':')||relative.includes('\\')||relative.includes('\0'))throw Error('invalid-lk-runtime-asset-path');
      const resolved=path.resolve(assetRoot,relative),inside=path.relative(assetRoot,resolved);
      if(!inside||inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))throw Error('invalid-lk-runtime-asset-path');
      return resolved;
    };
    const staged=new Map(),readLk=async file=>{const bytes=await readFile(resolveAssetPath(file));
      staged.set('assets/'+path.posix.normalize(file),bytes);return compactPoseDocument(JSON.parse(bytes.toString('utf8')));};
    const readLkConfig=async file=>{const bytes=await readFile(path.join(root,file));
      staged.set(file,bytes);return JSON.parse(bytes.toString('utf8'));};
    const requireBrowserFile=async relative=>{
      const resolved=resolveAssetPath(relative);
      if(!(await stat(resolved)).isFile())throw Error('invalid-lk-runtime-asset-type');
    };
    const candidate=await readLk(folder+'/manifest.json');
    if(!candidate||candidate.schemaVersion!==1||typeof candidate.runtimePose!=='string'||typeof candidate.effectAssetIndex!=='string'
      ||typeof (candidate.runtimeGlb??candidate.glb)!=='string'||candidate.visualEffectIndexes!==undefined
        &&(!Array.isArray(candidate.visualEffectIndexes)||!candidate.visualEffectIndexes.length||candidate.visualEffectIndexes.some(file=>typeof file!=='string')))
      throw Error('invalid-lk-runtime-manifest');
    const profile=await readLkConfig('packages/combat-core/'+folder+'-profile.json'),preset=await readLkConfig('config/'+folder+'-preset.json');
    if(profile.target.unitClass!==unitClass||candidate.unitClass!==undefined&&candidate.unitClass!==unitClass)throw Error('lk-source-class-mismatch');
    const indexes=[];for(const file of candidate.visualEffectIndexes??['fx/index.json'])indexes.push(await readLk(folder+'/'+file));
    indexes.push(...await loadPlayerFeedbackVisualIndexes(id,readLk));
    for(const file of playerFeedbackVisualTextureFiles(id))staged.set('assets/'+file,await readFile(resolveAssetPath(file)));
    const summons={};
    if(['LP','MM','DE'].includes(id))for(const row of Object.values(prismSource.audio.files))await requireBrowserFile('audio/'+row.file);
    if(id==='MM'&&profile.summonDeclarations?.apocalypse){
      const npc=summons.apocalypse=await loadAddSummonAssets({base:folder+'/',data:readLk,profile});
      indexes.push(npc.fxIndex);
      await requireBrowserFile(folder+'/summons/apocalypse/'+npc.manifest.runtimeGlb);
      for(const row of Object.values(npc.audio.files))await requireBrowserFile('audio/'+row.file);
    }
    const visual=addCommonBuffVisuals(addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...indexes),id),commonBuffVisuals);
    const effectIndex=mergeEffectIndexes(await readLk(folder+'/'+candidate.effectAssetIndex),visual),rawPose=await readLk(folder+'/'+candidate.runtimePose);
    const characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?await readLk(folder+'/'+rawPose.sharedPose):null);
    const effectPoses={};for(const file of collectEffectPoseFiles(effectIndex,visual))effectPoses[file]=await readLk(professionPoseAssetPath(id,file));
    // These files are consumed by the browser before the lobby is available.
    // Check presence without copying, rewriting or hashing large GLB payloads.
    await requireBrowserFile(folder+'/'+(candidate.runtimeGlb??candidate.glb));
    if(candidate.sharedCharacterAnimations)await requireBrowserFile(folder+'/'+candidate.sharedCharacterAnimations.glb);
    const catalog=await readLk('ui/skills/'+folder+'/catalog.json');if(catalog.classId!==unitClass)throw Error('lk-skill-catalog-class-mismatch');
    for(const portrait of Object.values(candidate.portraits??{})){
      if(typeof portrait?.file!=='string')throw Error('invalid-lk-runtime-asset-path');
      await requireBrowserFile(folder+'/'+portrait.file);
    }
    if(candidate.audioManifest){const audio=await readLk(folder+'/'+candidate.audioManifest);
      for(const record of Object.values(audio.files??{})){
        if(typeof record?.file!=='string')throw Error('invalid-lk-runtime-asset-path');
        await requireBrowserFile('audio/'+record.file);
      }
    }
    for(const template of Object.values(visual.templates??{})){
      if(template.glb)await requireBrowserFile(professionPoseAssetPath(id,template.glb));
      for(const texture of Object.values(template.textures??{}))if(texture.file)await requireBrowserFile(professionPoseAssetPath(id,texture.file));
    }
    for(const [file,bytes]of staged)resources.add(file,bytes);
    profiles[id]=profile;presets[id]=preset;professionAssets[id]={characterPose,effectIndex,effectPoses,summons};
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    const missing=String(error.path??folder+'/manifest.json'),relative=path.relative(assetRoot,missing);
    assetDiagnostics.push({professionId:id,reason:'missing-profession-asset',file:relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)
      ?relative.replaceAll('\\','/'):path.relative(root,missing).replaceAll('\\','/')});
  }
  }
  const binaries=Object.fromEntries(await Promise.all(Object.values(manifest.modules).map(async r=>[r.file,await readBytes('native/'+r.file)])));
  const fingerprints=Object.freeze({hostProgram:await fingerprintHostProgram({root}),resources:resources.snapshot()});
  // Keep native provenance distinct: nativeProgram names the unchanged native
  // manifest content seal, not the host executor or a compiled browser bundle.
  const nativeManifestSha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const versions={referenceVersion:rf.referenceVersion,presetVersion:preset.presetVersion,
    programVersion:'rf-local-pvp-ui-v2',coreVersion:CORE_VERSION,
    hostProgramSha256:fingerprints.hostProgram.sha256,program:fingerprints.hostProgram.sha256,
    resourceSha256:fingerprints.resources.sha256,nativeProgram:manifest.seal?.manifestContentSha256??null,
    profileSha256:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    presetSha256:createHash('sha256').update(JSON.stringify(preset)).digest('hex'),
    nativeManifestSha256,professions:Object.fromEntries(Object.entries(profiles).map(([id,p])=>[id,{
      profile:createHash('sha256').update(JSON.stringify(p)).digest('hex'),
      preset:createHash('sha256').update(JSON.stringify(presets[id])).digest('hex'),
      reference:createHash('sha256').update(JSON.stringify(p.target)).digest('hex'),
    }]))};
  const runtimeForMap=async map=>{
    const native=await createNativeRuntime({manifest,map,loadBinary:async file=>binaries[file]});
    const samplers=createProfessionSamplers(Object.fromEntries(Object.entries(professionAssets).map(([id,a])=>[id,
      {...createNativeSamplers({...a,profile:profiles[id],map}),...(a.summons?.apocalypse?createAddSummonSamplers(a.summons.apocalypse):{})}])));
    return {native,samplers};
  };
  const commonResources=fingerprints.resources.files.filter(row=>!row.file.startsWith('assets/scene/'));
  const mapAssets=new Map();
  function sceneAssets(sceneId,scene,rows,extra={}){
    const files=Object.freeze([...commonResources,...rows].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0));
    const content={schemaVersion:1,domain:RESOURCE_FINGERPRINT_DOMAIN,files};
    const resourceFingerprint=Object.freeze({...content,sha256:createHash('sha256').update(JSON.stringify(content)).digest('hex')});
    return {profile,preset,profiles,presets,commonBuffs,assetDiagnostics,professions:Object.fromEntries(PROFESSION_IDS.map(id=>[id,Boolean(profiles[id])])),map:scene,fingerprints:{...fingerprints,resources:resourceFingerprint},
      versions:Object.freeze({...versions,resourceSha256:resourceFingerprint.sha256,sceneId,
        mapCollisionSha256:scene.collision?.sha256??null,mapGeometrySha256:scene.geometry?.sha256??null,...extra}),
      createRuntime:()=>runtimeForMap(scene)};
  }
  mapAssets.set(DEFAULT_SCENE_ID,sceneAssets(DEFAULT_SCENE_ID,map,fingerprints.resources.files.filter(row=>row.file.startsWith('assets/scene/'))));
  let catalogue;
  try {catalogue=JSON.parse((await readFile(path.join(assetRoot,'scene/catalog.json'))).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let maps=[{id:DEFAULT_SCENE_ID,name:MAP_NAMES[DEFAULT_SCENE_ID],modes:[...ONLINE_MODES],
    geometrySha256:defaultManifest.geometry?.sha256??null,collisionSha256:defaultManifest.collision?.sha256??null}];
  if(catalogue){
    if(catalogue.schemaVersion!==1||!Array.isArray(catalogue.maps)||!catalogue.maps.length||catalogue.failures?.length
      ||new Set(catalogue.maps.map(row=>row.sceneId)).size!==catalogue.maps.length)throw Error('invalid-pvp-scene-catalogue');
    maps=[];
    for(const row of catalogue.maps){
      const id=row.sceneId;
      if(!isMapId(id)||row.manifestUrl!==id+'/manifest.json'||!/^[a-f0-9]{64}$/.test(row.manifestSha256))throw Error('invalid-pvp-scene-catalogue-row');
      const inventory=createFingerprintInventory(RESOURCE_FINGERPRINT_DOMAIN);
      const readScene=async file=>{const bytes=await readFile(path.join(assetRoot,'scene',id,file));
        const record=inventory.add('assets/scene/'+id+'/'+file,bytes);return {value:JSON.parse(bytes.toString('utf8')),sha256:record.sha256};};
      const loaded=await readScene('manifest.json'),scene=loaded.value;
      if(loaded.sha256!==row.manifestSha256||scene.sceneId!==id||scene.collision?.url!=='collision.json'
        ||scene.geometry?.url!=='scene.glb'||!/^[a-f0-9]{64}$/.test(scene.collision.sha256)||!/^[a-f0-9]{64}$/.test(scene.geometry.sha256)
        ||scene.collision.sha256!==row.collision?.sha256||scene.geometry.sha256!==row.geometry?.sha256)throw Error('pvp-scene-catalogue-mismatch: '+id);
      const collision=await readScene('collision.json');
      if(collision.sha256!==scene.collision.sha256||collision.value.sceneId!==id)throw Error('pvp-scene-collision-mismatch: '+id);
      const geometryFile=await stat(path.join(assetRoot,'scene',id,'scene.glb'));
      if(!geometryFile.isFile())throw Error('pvp-scene-geometry-missing: '+id);
      const map={...scene,...collision.value};
      const modes=ONLINE_MODES.filter(mode=>{try{chooseTeamSpawns(map,Array.from({length:MODE_CONFIG[mode].playerCount},(_,i)=>({id:String(i),team:i<MODE_CONFIG[mode].teamSize?0:1})));return true;}catch{return false;}});
      if(!modes.length)throw Error('pvp-scene-missing-team-spawns: '+id);
      mapAssets.set(id,sceneAssets(id,map,inventory.snapshot().files,{mapManifestSha256:row.manifestSha256}));
      maps.push({id,name:MAP_NAMES[id]??id,modes,classification:row.classification,
        manifestSha256:row.manifestSha256,collisionSha256:scene.collision.sha256,geometrySha256:scene.geometry.sha256,geometryBytes:geometryFile.size});
    }
    if(!mapAssets.has(DEFAULT_SCENE_ID)||!maps.some(row=>row.id===DEFAULT_SCENE_ID))throw Error('pvp-scene-default-missing');
  }
  return {...mapAssets.get(DEFAULT_SCENE_ID),maps:Object.freeze(maps.map(row=>Object.freeze(row))),
    forScene(sceneId){const loaded=mapAssets.get(sceneId);if(!loaded)throw Error('unknown-pvp-scene');return loaded;}};
}
