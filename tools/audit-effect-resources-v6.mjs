import {readFileSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../packages/combat-assets/effect-indexes.mjs';
import {mergeEffectIndexes} from '../packages/combat-assets/index.mjs';
import {collectEffectTemplates} from '../apps/web/effect-prewarm.mjs';
import {showsDamageParticle,normalizeEffectQuality} from '../packages/effect-runtime/presentation-quality.mjs';
import {runtimeAssetExclusionReason,animationSidecarEmbeddedInPose,isStandaloneAnimationAsset} from './runtime-asset-policy.mjs';

const visualFiles=['rf/fx/index.json','rf/buff-fx/index.json','rf/shadow-weapon-fx/index.json','rf/awakening-fx/index.json',
  'rf/critical-fx/index.json','rf/core-shield-fx/index.json','rf/skill-fx-v11/index.json','rf/xx2x-fx/index.json',
  'rf/xxx-fx/index.json','rf/archenemy-fx-v17/index.json','rf/landing-fx/index.json'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function templateAssetFiles(template){
  return [...new Set([template.glb,template.poseData,...Object.values(template.textures??{}).map(texture=>texture.file)].filter(Boolean).map(file=>'rf/'+file))];
}
export function referenceCandidates(origin,value){
  if(typeof value!=='string'||!value||/^data:|^https?:|^[a-z]:[\\/]/i.test(value))return [];
  const clean=value.replace(/^\/assets\//,'').replaceAll('\\','/');
  return [...new Set([clean,posix.join(posix.dirname(origin),clean),posix.join(origin.split('/')[0],clean)].map(file=>posix.normalize(file)).filter(file=>!file.startsWith('../')))];
}
export function walkStrings(value,visit){
  if(typeof value==='string')visit(value);
  else if(value&&typeof value==='object')for(const child of Object.values(value))walkStrings(child,visit);
}
function glbReferences(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67)return [];
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim());
  return [...(json.images??[]),...(json.buffers??[])].map(item=>item.uri).filter(Boolean);
}
export function auditEffectResources({root=process.cwd(),metadataFile='dist/deployment.json'}={}){
  const metadataBytes=readFileSync(resolve(root,metadataFile)),metadata=JSON.parse(metadataBytes),sealed=metadata.files;
  if(!sealed||!metadata.assetRoot)throw Error('Expected a sealed deployment inventory');
  const read=file=>JSON.parse(readFileSync(resolve(metadata.assetRoot,file)));
  const profile=JSON.parse(readFileSync(resolve(root,'packages/combat-core/rf-profile.json')));
  const visual=mergeVisualEffectIndexes(...visualFiles.map(read)),originalCollision=read('rf/effect-assets.json');
  const collision=mergeEffectIndexes(originalCollision,visual);
  const medium=normalizeEffectQuality({level:'medium',particleDivisor:8}),allSkills=profile.skillCatalog.map(({skillId})=>({skillId}));
  const mediumProfile=structuredClone(profile),particleEntries=[],suppressedEntries=[];
  for(const [damageName,damage] of Object.entries(profile.damageEffects))for(const [key,entry] of Object.entries(damage.raw))if(entry?.PARTICLE_NAME){
    const row={damageName,key,particleName:entry.PARTICLE_NAME,showLevel:entry.SHOW_LEVEL??2,explicitShowLevel:entry.SHOW_LEVEL!==undefined};
    particleEntries.push(row);
    if(!showsDamageParticle(entry,medium)){suppressedEntries.push(row);delete mediumProfile.damageEffects[damageName].raw[key];}
  }
  const highReachable=collectEffectTemplates(profile,visual,allSkills),mediumReachable=collectEffectTemplates(mediumProfile,visual,allSkills);
  const highOnlyTemplates=[...highReachable].filter(name=>!mediumReachable.has(name));
  const collisionPoses=new Set(collectEffectPoseFiles(collision).map(file=>'rf/'+file));
  const eagerGlbs=new Set(Object.values(visual.templates).filter(template=>template.glb&&(template.fields.DrawCount??1)>0).map(template=>'rf/'+template.glb));
  const fileOwners=new Map();for(const template of Object.values(visual.templates))for(const file of templateAssetFiles(template)){
    if(!fileOwners.has(file))fileOwners.set(file,[]);fileOwners.get(file).push(template.name);
  }
  const references=new Map(),rows=[],badHashes=[],contentGroups=new Map(),categories={};
  const addReference=(file,origin)=>{if(!references.has(file))references.set(file,new Set());references.get(file).add(origin);};
  for(const [file,expected] of Object.entries(sealed)){
    const filePath=resolve(metadata.assetRoot,file),bytes=readFileSync(filePath),actual=sha256(bytes);
    if(actual!==expected)badHashes.push({file,expected,actual});
    const category=file.split('/')[0];const item=categories[category]??={files:0,bytes:0};item.files++;item.bytes+=bytes.length;
    rows.push({file,bytes:bytes.length,sha256:actual});
    if(!contentGroups.has(actual))contentGroups.set(actual,[]);contentGroups.get(actual).push({file,bytes:bytes.length});
    const strings=[];
    if(file.endsWith('.json'))walkStrings(JSON.parse(bytes),value=>strings.push(value));
    if(file.endsWith('.glb'))strings.push(...glbReferences(bytes));
    for(const value of strings)for(const candidate of referenceCandidates(file,value))if(Object.hasOwn(sealed,candidate))addReference(candidate,file);
  }
  const candidateFiles=[...new Set(highOnlyTemplates.flatMap(name=>templateAssetFiles(visual.templates[name])))];
  const candidates=candidateFiles.map(file=>({file,bytes:statSync(resolve(metadata.assetRoot,file)).size,
    owners:fileOwners.get(file)??[],protectedByCollision:collisionPoses.has(file),eagerVisualGlb:eagerGlbs.has(file),
    otherTemplateOwners:(fileOwners.get(file)??[]).filter(name=>!highOnlyTemplates.includes(name)),sealedReferences:[...(references.get(file)??[])]}));
  const duplicateContents=[...contentGroups].filter(([,items])=>items.length>1).map(([hash,files])=>({sha256:hash,files,
    repeatedBytes:files.slice(1).reduce((sum,file)=>sum+file.bytes,0)}));
  const rfManifest=read('rf/manifest.json'),generatorOnly=[],retainedAnimationSidecars=[];
  for(const row of rows){
    let animationRedundant=false;
    if(isStandaloneAnimationAsset(row.file)){
      const poseFile=row.file.replace(/\.animation\.json$/,'.pose.json');
      animationRedundant=Object.hasOwn(sealed,poseFile)&&animationSidecarEmbeddedInPose(read(row.file),read(poseFile));
      if(!animationRedundant)retainedAnimationSidecars.push({file:row.file,poseFile,reason:'Exact complete clip tracks were not proven embedded'});
    }
    const reason=runtimeAssetExclusionReason(row.file,{rfManifest,hasRuntimeGlb:Object.hasOwn(sealed,'rf/'+rfManifest.runtimeGlb),animationRedundant});
    if(reason)generatorOnly.push({...row,reason});
  }
  return {schema:'elsword.effect-resource-audit-v6',metadataFile,metadataSha256:sha256(metadataBytes),assetRoot:metadata.assetRoot,
    assetSourceRoot:metadata.assetSourceRoot,sealedFiles:rows.length,totalBytes:rows.reduce((sum,row)=>sum+row.bytes,0),
    verifiedHashes:rows.length-badHashes.length,badHashes,categories,
    evidenceClass:'read-only current local published snapshot and source reference analysis; no deletion, cloud mutation or target-client measurement',
    policy:{quality:medium,emissionOnlyAssetRemoval:0,reason:'Emission scaling changes runtime births, not published paths, template fields or initialization resource loading'},
    visual:{indexes:visualFiles,templates:Object.keys(visual.templates).length,eagerPositiveDrawGlbs:eagerGlbs.size,eagerGlbFiles:[...eagerGlbs],
      uniqueTemplateFiles:fileOwners.size,prewarmTemplateSetHigh:highReachable.size,prewarmTemplateSetMedium:mediumReachable.size},
    collision:{originalTemplates:Object.keys(originalCollision.templates).length,mergedTemplates:Object.keys(collision.templates).length,
      loadedPoseFiles:collisionPoses.size,loadedPosePaths:[...collisionPoses],reason:'Combat samplers load the merged effect pose closure, including invisible collision helpers'},
    mediumSuppression:{particleEntryCount:particleEntries.length,explicitShowLevelEntries:particleEntries.filter(row=>row.explicitShowLevel),suppressedEntries,
      highOnlyTemplates,candidateFiles:candidates,currentlySafeRemovals:[],
      reason:'All published indexes remain consumed; initialization eagerly loads positive-draw visual GLBs and merged collision poses. Candidate files require an explicit index/loading rewrite and every shared reference to be eliminated before pruning.'},
    duplicateContents:{groups:duplicateContents.length,repeatedBytes:duplicateContents.reduce((sum,group)=>sum+group.repeatedBytes,0),groupsDetail:duplicateContents,
      safeUrlRemovals:[],reason:'Equal bytes at distinct referenced URLs establish possible storage deduplication, not permission to remove a path'},
    generatorOnlyExclusions:{files:generatorOnly.length,bytes:generatorOnly.reduce((sum,row)=>sum+row.bytes,0),candidates:generatorOnly,retainedAnimationSidecars,
      keptRuntimePaths:['rf/rf-runtime.glb','rf/runtime-pose.json','rf/pose-tracks.json.gz',...collisionPoses],
      evidence:'game.mjs explicitly selects manifest.runtimeGlb, loads runtimePose and collectEffectPoseFiles; motion-inspector.mjs explicitly fetches pose-tracks.json.gz. No apps/packages fetch uses preview, output inventory, native motion dump or standalone animation sidecars. Source artifacts and proof references are retained.'},
    files:rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const evidence=auditEffectResources({metadataFile:process.argv[2]??'dist/deployment.json'});
  mkdirSync('runtime/effects-density-v6',{recursive:true});writeFileSync('runtime/effects-density-v6/resource-audit.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({sealedFiles:evidence.sealedFiles,totalBytes:evidence.totalBytes,verifiedHashes:evidence.verifiedHashes,categories:evidence.categories,
    visual:evidence.visual.templates,collision:evidence.collision.loadedPoseFiles,mediumSuppression:evidence.mediumSuppression,duplicateGroups:evidence.duplicateContents.groups}));
  if(evidence.badHashes.length)process.exitCode=1;
}
