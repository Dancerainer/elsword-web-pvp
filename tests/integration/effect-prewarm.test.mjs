import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {NullEngine,Scene} from '@babylonjs/core';
import {collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {createActorView,sampleAnimation,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createPoseLibrary,mapClipTime,sampleLocalTransform} from '../../tools/assets/character/sample_pose.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';

const root=new URL('../../',import.meta.url);
const profile=JSON.parse(readFileSync(process.env.RF_EFFECT_PROFILE_PATH??new URL('packages/combat-core/rf-profile.json',root)));
const index=JSON.parse(readFileSync(new URL('contracts/rf-fx-index.json',root)));
// Keep the original311-template/60-pose audit independently frozen. The web
// loader now merges eight separately audited source indexes, including the
// bounded XX2X source particle, rather than overwriting the original proof.
const liveIndex=mergeVisualEffectIndexes(...[
  'rf-fx-index.json','rf-buff-display-fx-index.json','rf-shadow-weapon-fx-index.json',
  'rf-awakening-fx-index.json','rf-critical-fx-index-v11.json',
  'rf-core-shield-fx-index-v11.json','rf-skill-fx-index-v11.json','rf-xx2x-fx-index-v12.json',
].map(file=>JSON.parse(readFileSync(new URL('contracts/'+file,root)))));
const resourceAudit=JSON.parse(readFileSync(new URL('reports/rf-full-skill-assets.json',root)));
const rawStrings=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(rawStrings):[];

// Independently read actual reference fields, including every original repeated
// child. A parent can need its FinalParticleList only after it dies.
function childNames(template){return ['TraceParticleList','FinalParticleList','ParticleList'].flatMap(key=>
  template.repeated?.[key]??(template.fields[key]==null?[]:[template.fields[key]]));}
function sourceClosure(values,effectIndex=index){
  const queue=rawStrings(values),seen=new Set(),templates=new Set();
  while(queue.length){const name=queue.pop();if(seen.has(name))continue;seen.add(name);
    const t=effectIndex.templates[name];if(t){templates.add(name);queue.push(...rawStrings(t.fields),...rawStrings(t.events),...rawStrings(t.repeated));}
    const definition=profile.effectSets?.[name]?.raw??profile.damageEffects?.[name]?.raw;
    if(definition)queue.push(...rawStrings(definition));
  }return templates;
}
function subset(expected,actual,label){assert.deepEqual([...expected].filter(name=>!actual.has(name)).sort(),[],label);}

test('actual full RF profile covers selected four skill closures and every deferred source child',()=>{
  // Target66ZX, Fatal/groggy, counter DamageRevenge and both original NO_DOWN states extend98.
  assert.equal(Object.keys(profile.states).length,103,'retain target66ZX, groggy, counter and original NO_DOWN standup states');
  assert.equal(profile.states.RSI_STANDUP_ATTACK_FRONT_NO_DOWN.animationName,'SI_A_RF_GET_CHANCE_FRONT');
  assert.equal(profile.states.RSI_STANDUP_ATTACK_BACK_NO_DOWN.animationName,'SI_A_RF_GET_CHANCE_BACK');
  assert.equal(profile.states.RSI_DAMAGE_REVENGE.animationName,'DamageRevenge');
  assert.equal(profile.states.RSI_DAMAGE_GROGGY.animationName,'Fatal');
  assert.equal(profile.skillCatalog.length,36);
  const slots=[24027,24032,24203,24219].map(skillId=>({skillId,branchId:'none'}));
  const rawStates=slots.flatMap(slot=>{
    const skill=profile.skillCatalog.find(s=>s.skillId===slot.skillId);assert.ok(skill?.supported);
    return skill.states.map(name=>profile.states[name].raw);
  });
  const actual=collectEffectTemplates(profile,index,slots);
  subset(sourceClosure(rawStates),actual,'selected state dependencies and all original child lists must be warmed');
  for(const name of actual){const t=index.templates[name];assert.ok(t,'no guessed aliases');
    subset(new Set(childNames(t)),actual,`${name} child templates are used by the actual runtime`);
  }
  assert.ok(actual.has('DamageImpactCore'));
});

test('actual Charged Bolt callback dependencies have an explicit prewarm mapping',()=>{
  const skill=profile.skillCatalog.find(s=>s.skillId===24032);assert.equal(skill?.supported,true);
  // Exact target names + measured source callback resource literals, distinct
  // from the old nonexistent HYPER alias and from inferred gameplay timing.
  const roots=['RAVEN_OVER_TAKER_CHARGED_BOLT','Flare_Raven_Overtaker_Sp1a_ChargedBolt02'];
  assert.ok(profile.damageEffects[roots[0]]);assert.ok(index.templates[roots[1]]);
  const expected=sourceClosure(roots),actual=collectEffectTemplates(profile,index,[{skillId:24032,branchId:'none'}]);
  subset(expected,actual,'dynamic native callback names are absent from state.raw and need original explicit mapping');
  assert.ok(!actual.has('RAVEN_OVER_TAKER_CHARGED_BOLT_HYPER'));
});

test('historical sixteen-skill proof retains its original dependency index',()=>{
  // Prior supported nodes, kept explicit so opening four more skills cannot
  // silently replace the original resource proof with a larger snapshot.
  const ids=[24025,24026,24027,24028,24032,24217,24218,24219,
    24203,24204,24006,24007,24205,24206,24010,24603];
  const skills=ids.map(id=>profile.skillCatalog.find(s=>s.skillId===id));
  // The original audit counted311 templates; the primary index later gained
  // three source command particles. Neither is replaced by the v11 merge.
  assert.equal(resourceAudit.counts.effectTemplates,311);
  assert.equal(skills.length,16);
  for(const skill of skills){
    const actual=collectEffectTemplates(profile,index,[{skillId:skill.skillId,branchId:'none'}]);
    const states=skill.states.map(name=>profile.states[name].raw);
    subset(sourceClosure(states),actual,`actual target state closure ${skill.skillId}`);
    for(const name of actual)subset(new Set(childNames(index.templates[name])),actual,`all source child lists ${skill.skillId}/${name}`);
  }
});

test('all twenty target highest active nodes and branches prewarm complete eight-index source closures',()=>{
  // Independently selected highest2016 active nodes from NewSkillTempletVer2;
  // these IDs are not recorded runtime outputs or current hit-count gold.
  const ids=[24025,24026,24027,24028,24032,24217,24218,24219,
    24203,24204,24006,24007,24205,24206,24010,24603,24008,24009,24029,900];
  const selectable=profile.skillCatalog.filter(s=>s.selectable&&s.supported&&!s.passive);
  assert.deepEqual(selectable.map(s=>s.skillId).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b));
  for(const id of ids){
    const skill=profile.skillCatalog.find(s=>s.skillId===id);
    const sourceRoots=[skill.states.map(name=>profile.states[name].raw),
      profile.resourceOnlyEffectSets,profile.resourceOnlyTemplates];
    // Charged Bolt's dynamic callback literals are independently cited in
    // its preceding test and are not present in the target state table.
    if(id===24032)sourceRoots.push('RAVEN_OVER_TAKER_CHARGED_BOLT','Flare_Raven_Overtaker_Sp1a_ChargedBolt02');
    const expected=sourceClosure(sourceRoots,liveIndex);
    for(const branchId of ['none',...(skill.branches??[]).map(b=>b.id??b.branchId)]){
      const actual=collectEffectTemplates(profile,liveIndex,[{skillId:id,branchId}]);
      subset(expected,actual,`source closure ${id}/${branchId}`);
      for(const name of actual){
        const t=liveIndex.templates[name];assert.ok(t,'resource names must exist in a frozen source index');
        subset(new Set(childNames(t)),actual,`deferred children ${id}/${branchId}/${name}`);
      }
    }
  }
});

test('all actual FX mesh sourcePose files retain original DLL period/playback and complete channels',()=>{
  const byPath=new Map();
  for(const t of Object.values(index.templates))if(t.poseData)byPath.set(t.poseData,t);
  assert.equal(byPath.size,60,'include invisible attack-helper models as well as visible GLBs');
  let animations=0,channels=0;
  for(const [path,t] of byPath){
    const sourcePath=process.env.RF_EFFECT_ASSET_ROOT?pathToFileURL(process.env.RF_EFFECT_ASSET_ROOT+'/'+path):new URL('artifacts/rf/'+path,root);
    const bytes=readFileSync(sourcePath),doc=JSON.parse(bytes),library=createPoseLibrary(doc);
    assert.deepEqual(doc.unsupportedTracks,[]);
    const output=resourceAudit.outputInventory.find(row=>row.path==='artifacts/rf-full-skills/'+path);
    assert.ok(output);assert.equal(createHash('sha256').update(bytes).digest('hex'),output.sha256);
    for(const meta of t.animationClips){
      const clip=library.clips.get(meta.name);assert.ok(clip);
      assert.equal(clip.durationSeconds,meta.durationSeconds);assert.equal(clip.nativePlaybackField,meta.nativePlaybackField);
      assert.equal(clip.ticks_per_second,meta.ticksPerSecond);
      assert.equal(clip.nativeD3dxKeys,true);
      assert.equal(mapClipTime(meta.durationSeconds,clip.durationSeconds,false,clip.nativePlaybackField),0);
      for(const track of clip.tracks.values()){
        for(const property of ['translation','scale','rotation'])assert.ok(track[property]?.values.length);
        sampleLocalTransform(library,meta.name,Math.min(.1,meta.durationSeconds/2),track.frame_name);channels++;
      }animations++;
    }
  }
  assert.equal(animations,51);assert.equal(channels,560);
});

test('actual Iron helper sampler and renderer sourcePose use the original DLL period rather than GLB tail',async()=>{
  const t=index.templates.Raven_OverTaker_Iron_Attack01;
  const path=process.env.RF_EFFECT_ASSET_ROOT?process.env.RF_EFFECT_ASSET_ROOT+'/'+t.poseData:new URL('artifacts/rf/'+t.poseData,root);
  const doc=JSON.parse(readFileSync(path));
  const library=createPoseLibrary(doc),period=0.7666666507720947;
  assert.equal(library.clips.get('Normal').durationSeconds,period);
  assert.equal(library.clips.get('Normal').nativePlaybackField,0);
  const merged=mergeEffectIndexes({templates:{}},index);
  const sampler=createNativeSamplers({characterPose:{schemaVersion:1,frames:[],helpers:[],clips:[]},effectIndex:merged,effectPoses:{[t.poseData]:doc},profile});
  const actor={id:'owner',x:0,y:0,z:0,facing:1};
  const effect={name:'Raven_OverTaker_Iron_Attack01',damage:{MAIN_EFFECT_NAME:'Raven_OverTaker_Iron_Attack01'},definition:{},currentAnchor:{position:[0,0,0],facing:1},elapsed:period,animationTime:period};
  const shapes=sampler.effectSampler(effect,actor);
  assert.ok(shapes.length>0,'real Iron ATTACK_LINE helpers must be sampled, not two empty results compared');
  assert.deepEqual(shapes,sampler.effectSampler({...effect,elapsed:0,animationTime:0},actor));
  const names=shapes.flatMap(shape=>[shape.source.helper,shape.source.helper.replace('START','END')]);
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    const glb=process.env.RF_EFFECT_ASSET_ROOT?pathToFileURL(process.env.RF_EFFECT_ASSET_ROOT+'/'+t.glb):new URL('artifacts/rf/'+t.glb,root);
    const view=createActorView(await loadPoseContainer(scene,glb),scene,'iron-loop',.01,doc);
    sampleAnimation(view,'Normal',0,false);const atZero=getActorNativePoints(view,names);
    sampleAnimation(view,'Normal',period,false);const atPeriod=getActorNativePoints(view,names);
    for(const name of names)for(let i=0;i<3;i++)assert.ok(Math.abs(atPeriod.get(name)[i]-atZero.get(name)[i])<1e-8);
    for(const shape of shapes)for(const [property,name] of [['start',shape.source.helper],['end',shape.source.helper.replace('START','END')]]){
      for(let i=0;i<3;i++)assert.ok(Math.abs(shape[property][i]-atPeriod.get(name)[i])<.002,`${name} axis ${i} shared/render endpoint mismatch`);
    }
  }finally{scene.dispose();engine.dispose();}
});
