/** Collision helpers and visible particle meshes have separate indexes. Both
 * require original poses; do not select presentation assets by collision kind.
 */
export function collectEffectPoseFiles(...indexes){
  return [...new Set(indexes.flatMap(index=>Object.values(index.templates??{}).map(t=>t.poseData).filter(Boolean)))];
}
/** Merge independently frozen resource closures without replacing old proof. */
export function mergeVisualEffectIndexes(...indexes){
  if(!indexes.length)throw new TypeError('At least one effect index required');
  const base=indexes[0],templates={},sourceFiles=new Map();
  for(const index of indexes){
    if(index.schemaVersion!==1||index.referenceVersion!==base.referenceVersion||!index.templates)
      throw new TypeError('Effect indexes must have the same target version');
    for(const [name,template] of Object.entries(index.templates)){
      if(templates[name]&&JSON.stringify(templates[name])!==JSON.stringify(template))
        throw new Error('Conflicting original effect declaration: '+name);
      templates[name]=template;
    }
    for(const file of index.sourceFiles??[])sourceFiles.set(JSON.stringify(file),file);
  }
  const {profileSha256,...metadata}=base;
  return {...metadata,templates,sourceFiles:[...sourceFiles.values()],
    sourceProfileHashes:indexes.map(index=>index.profileSha256),
    missingTemplates:[...new Set(indexes.flatMap(index=>index.missingTemplates??[]))].filter(name=>!templates[name]),
    meshFailures:indexes.flatMap(index=>index.meshFailures??[])};
}
