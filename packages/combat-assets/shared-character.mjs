/** Immutable source-key reuse. Per-class bind frames/helpers remain private. */
export function composeCharacterPose(pose,shared){
  const rollNames=['StandUpRollingFrontFront','StandUpRollingFrontBack','StandUpRollingBackFront','StandUpRollingBackBack'];
  // BM and VC use the same independently sourced Raven recovery rows. Their
  // compact shared lists predate those rows and omitted the actual root keys.
  const namesToShare=[...new Set([...(pose.sharedClips??[]),...(pose.sharedPose==='../rf/runtime-pose.json'
    ?rollNames.filter(name=>!pose.clips.some(clip=>clip.name===name)):[])])];
  if(!namesToShare.length)return pose;
  if(!shared?.clips)throw new TypeError('Missing shared character pose');
  const frames=new Set(pose.frames.map(f=>f.name)),available=new Map(shared.clips.map(c=>[c.name,c]));
  const clips=[...pose.clips],names=new Set(clips.map(c=>c.name));
  for(const name of namesToShare){
    const original=available.get(name);
    if(!original||names.has(name))throw new TypeError('Invalid shared character clip: '+name);
    // Reuse channel arrays; skip foreign weapon frames without cloning keys.
    const tracks=original.tracks.filter(t=>frames.has(t.frame_name));
    const trackNames=new Set(tracks.map(t=>t.frame_name));
    // A sibling profession may need an additional original attachment bone
    // absent from the shared compact pose (IS's second-sword left hand).
    // Keep its independently verified source channel, never a guessed bind.
    const supplements=pose.sharedClipTrackSupplements?.[name]??[];
    if(!Array.isArray(supplements))throw new TypeError('Invalid shared character supplements: '+name);
    for(const track of supplements){
      if(!track||!frames.has(track.frame_name)||trackNames.has(track.frame_name))throw new TypeError('Invalid shared character supplemental bone: '+name);
      tracks.push(track);trackNames.add(track.frame_name);
    }
    clips.push({...original,tracks});names.add(name);
  }
  return {...pose,clips,sharedClips:namesToShare};
}

/** AssetContainer clones later retarget these groups to each actor instance. */
export function installSharedCharacterAnimations(container,shared,names){
  const targets=new Map([...container.transformNodes,...container.meshes].map(n=>[n.name,n]));
  const existing=new Set(container.animationGroups.map(g=>g.name)),groups=new Map(shared.animationGroups.map(g=>[g.name,g]));
  for(const name of names){
    if(existing.has(name))throw new TypeError('Duplicate shared character animation: '+name);
    const source=groups.get(name);if(!source)throw new TypeError('Missing shared character animation: '+name);
    for(const row of source.targetedAnimations)if(!targets.has(row.target.name))throw new TypeError('Shared animation target missing: '+row.target.name);
    const group=source.clone(name,target=>targets.get(target.name),false);group.stop();container.animationGroups.push(group);existing.add(name);
  }
}
