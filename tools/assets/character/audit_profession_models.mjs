/** Full converted-character audit against preserved source keys. NullEngine
 * checks node/skin/weapon mathematics; it is not an original-client GPU test.
 * node .../audit_profession_models.mjs RF_ASSETS LK_ASSETS OUTPUT_JSON
 * node .../audit_profession_models.mjs --profession VC VC_ASSETS OUTPUT_JSON
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadPoseContainer,readGlb} from '../../../tests/helpers/babylon-assets.mjs';
import {createSkinAudit} from '../../../tests/helpers/skin-audit.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../../apps/web/actor-presentation.mjs';
import {createPoseAudit} from '../../../apps/web/pose-audit.mjs';
import {createPoseLibrary,samplePose,mapClipTime} from './sample_pose.mjs';
import {mergeVisualEffectIndexes} from '../../../packages/combat-assets/effect-indexes.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../../packages/combat-assets/shared-character.mjs';
import {PROFESSION_IDS} from '../../../packages/professions/catalog.mjs';

const args=process.argv.slice(2),single=args[0]==='--profession';
const [rfRoot,lkRoot]=args,output=single?args[3]:args[2];
const requests=single?[[args[1]?.toUpperCase(),args[2]]]:[['RF',rfRoot],['LK',lkRoot]];
if(!output||requests.some(([id,root])=>!PROFESSION_IDS.includes(id)||!root))
  throw Error('Expected RF_ASSETS LK_ASSETS OUTPUT_JSON or --profession PROFESSION ASSETS OUTPUT_JSON');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={schemaVersion:1,evidenceClass:'simulation-conversion-audit',clientMeasured:false,
  limits:['NullEngine omits texture/GPU rendering. Source pose and skin math do not establish original-client gameplay or lighting fidelity.',
    'Source keys are preserved decoded inputs; independent D3DX interpolation evidence remains in its original reports.'],professions:{}};
result.programInputs=Object.fromEntries(['tools/assets/character/audit_profession_models.mjs','tests/helpers/skin-audit.mjs',
  'apps/web/actor-presentation.mjs','apps/web/pose-audit.mjs','tools/assets/character/sample_pose.mjs',
  'packages/combat-assets/shared-character.mjs'].map(file=>[file,sha(readFileSync(new URL('../../../'+file,import.meta.url)))]));
for(const [id,requestedRoot]of requests){
  const root=resolve(requestedRoot);
  const inputs={},readBytes=file=>{const bytes=readFileSync(join(root,file));inputs[file]=sha(bytes);return bytes;};
  const manifest=JSON.parse(readBytes('manifest.json'));
  // VC packing moves full conversion evidence into its source-proof folder.
  // Record the actual path and bytes; never fall back to another worktree.
  const sourceFile=existsSync(join(root,manifest.poseTracks))?manifest.poseTracks:join('source-proof',manifest.poseTracks);
  const source=JSON.parse(gunzipSync(readBytes(sourceFile))),privateRuntime=JSON.parse(readBytes(manifest.runtimePose));
  const sharedPose=privateRuntime.sharedPose?JSON.parse(readBytes(privateRuntime.sharedPose)):null;
  const runtime=composeCharacterPose(privateRuntime,sharedPose);
  const indexFiles=manifest.visualEffectIndexes??['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx'].map(name=>name+'/index.json');
  const visual=mergeVisualEffectIndexes(...indexFiles.map(file=>JSON.parse(readBytes(file)))),resourceFiles=new Set(),gaps=[];
  for(const [name,template]of Object.entries(visual.templates)){
    for(const file of [template.glb,template.poseData,...Object.values(template.textures??{}).map(t=>t.file)].filter(Boolean))resourceFiles.add(file);
    if(template.unsupported?.length||template.animationRequiresUnconfirmedRate)gaps.push({name,unsupported:template.unsupported??[],animationRequiresUnconfirmedRate:template.animationRequiresUnconfirmedRate??false});
  }
  const missingFiles=[...resourceFiles].filter(file=>!existsSync(join(root,file)));
  assert.deepEqual(missingFiles,[],'missing presentation resources');
  if(id==='BM')assert.deepEqual(visual.missingTemplates,['RAVEN_HYPER_SONIC_STAB_DOWN'],
    'BM target declaration gap differs from the separately audited HA particle reference');
  else if(id!=='VC')assert.deepEqual(visual.missingTemplates,[],'missing source templates');
  const closure={indexFiles,templates:Object.keys(visual.templates).length,resourceFiles:resourceFiles.size,missingFiles,missingTemplates:visual.missingTemplates,gaps,
    complete:missingFiles.length===0&&visual.missingTemplates.length===0&&gaps.length===0};
  const fullLibrary=createPoseLibrary(source),compactLibrary=createPoseLibrary(runtime);
  const profileBytes=readFileSync(new URL('../../../packages/combat-core/'+id.toLowerCase()+'-profile.json',import.meta.url)),profile=JSON.parse(profileBytes);
  const stateAnimations=[...new Set(Object.values(profile.states).map(state=>state.animationName))];
  const missingStateAnimations=stateAnimations.filter(name=>!compactLibrary.clips.has(name));
  assert.deepEqual(missingStateAnimations,[],'state animations absent from runtime character');
  const glbFile=manifest.runtimeGlb??manifest.glb;
  const passes=[{name:'runtime',file:glbFile,pose:runtime,shared:manifest.sharedCharacterAnimations}];
  // The shipped subset proves every registered action, while the preserved
  // full conversion additionally checks unused original clips on the same body.
  if(['VC','BM'].includes(id)&&manifest.glb!==glbFile)passes.push({name:'fullSourceConversion',file:manifest.glb,pose:source});
  const passResults={};
  for(const pass of passes){
  readBytes(pass.file);
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('audit-camera',new Vector3(0,0,10),scene);
  const container=await loadPoseContainer(scene,join(root,pass.file));
  let sharedContainer=null;
  if(pass.shared?.clips?.length){
    readBytes(pass.shared.glb);sharedContainer=await loadPoseContainer(scene,join(root,pass.shared.glb));
    installSharedCharacterAnimations(container,sharedContainer,pass.shared.clips);
  }
  const glb=readGlb(join(root,pass.file));
  const view=createActorView(container,scene,id,.01,pass.pose),poseAudit=createPoseAudit(source),skinAudit=createSkinAudit(source,glb);
  const stats={clips:pass.pose.clips.length,fullFrames:source.frames.length,runtimeFrames:pass.pose.frames.length,
    geometry:glb.json.nodes.filter(node=>node.mesh!==undefined).map(node=>({name:node.name,skinned:node.skin!==undefined,
      primitives:glb.json.meshes[node.mesh].primitives.map(primitive=>({vertices:glb.json.accessors[primitive.attributes.POSITION].count,
        indices:primitive.indices===undefined?null:glb.json.accessors[primitive.indices].count}))})),
    samples:0,comparedNodes:0,comparedVertices:0,maximumPoseErrorNative:0,maximumSkinErrorNative:0,maximumRuntimePoseErrorNative:0,worst:null};
  try{
    assert.deepEqual([...view.clips.keys()].sort(),pass.pose.clips.map(c=>c.name).sort(),'GLB/runtime clips differ');
    for(const clip of pass.pose.clips){
      assert.ok(fullLibrary.clips.has(clip.name),'missing full source clip '+clip.name);
      const duration=fullLibrary.clips.get(clip.name).durationSeconds;
      for(const fraction of [0,.173,.5,.827,1])for(const facing of [-1,1]){
        const time=duration*fraction,actor={id,animationName:clip.name,animationTime:time,animationLoop:false,x:2022.98,y:2840,z:37,facing};
        assert.equal(sampleAnimation(view,clip.name,time),true);placeActor(view,actor);scene.render();
        const pose=poseAudit(view,actor),skin=skinAudit(view,actor);
        assert.equal(pose.supported,true,JSON.stringify(pose));
        assert.ok(pose.maximumErrorNative<.01,`${id}/${clip.name}: pose ${JSON.stringify(pose)}`);
        assert.ok(skin.maximumErrorNative<.01,`${id}/${clip.name}: skin ${JSON.stringify(skin)}`);
        if(pose.maximumErrorNative>stats.maximumPoseErrorNative)stats.worst={clip:clip.name,fraction,facing,node:pose.worstNode};
        stats.maximumPoseErrorNative=Math.max(stats.maximumPoseErrorNative,pose.maximumErrorNative);
        stats.maximumSkinErrorNative=Math.max(stats.maximumSkinErrorNative,skin.maximumErrorNative);
        stats.samples++;stats.comparedNodes+=pose.comparedNodes;stats.comparedVertices+=skin.vertices;
        const seconds=mapClipTime(time,duration,false,clip.nativePlaybackField),full=samplePose(fullLibrary,clip.name,seconds),compact=samplePose(pass.name==='runtime'?compactLibrary:fullLibrary,clip.name,seconds);
        for(const [name,matrix]of compact){assert.ok(full.has(name));
          const error=Math.max(...matrix.map((v,i)=>Math.abs(v-full.get(name)[i])));
          assert.ok(error<1e-8,`${id}/${clip.name}/${name}: compact helper diverges ${error}`);
          stats.maximumRuntimePoseErrorNative=Math.max(stats.maximumRuntimePoseErrorNative,error);
        }
      }
    }
    passResults[pass.name]=stats;
  }finally{view.dispose();container.dispose();sharedContainer?.dispose();scene.dispose();engine.dispose();}
  }
  result.professions[id]={inputs,profileSha256:sha(profileBytes),closure,stateAnimations:stateAnimations.length,missingStateAnimations,
    privateRuntimeClips:privateRuntime.clips.length,sharedRuntimeClips:privateRuntime.sharedClips?.length??0,
    sourceOnlyClips:source.clips.filter(clip=>!compactLibrary.clips.has(clip.name)).map(clip=>clip.name),
    ...passResults.runtime,...(passResults.fullSourceConversion?{fullSourceConversion:passResults.fullSourceConversion}:{})};
}
mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.professions));
