// Bounded consumption of actual original pose and GLB bytes; no GPU claim.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadPoseContainer} from '../../tests/helpers/babylon-assets.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {createPoseLibrary,samplePose} from '../../tools/assets/character/sample_pose.mjs';

const root=resolve(process.argv[2]??fileURLToPath(new URL('../../runtime/capacity-assets-overlay/',import.meta.url)));
const runtimeRoot=resolve(fileURLToPath(new URL('../../runtime/',import.meta.url)));
assert.ok(root.startsWith(runtimeRoot+'/')||root.startsWith(runtimeRoot+'\\'),'Evidence output must stay in task runtime');
const evidence=JSON.parse(readFileSync(resolve(root,'vc-metadata-merge-evidence.json')));
assert.equal(evidence.readyForClosure,true,'Seal merged profile before consumption check');
const sealed=evidence.oldSealedAssetRoot;
const read=path=>JSON.parse(readFileSync(path));
const metadata=read(resolve(root,'vc/manifest.json'));
const pose=read(resolve(root,'vc/runtime-pose.json'));
const rfPose=read(resolve(sealed,'rf/runtime-pose.json'));
const merged=composeCharacterPose(pose,rfPose),library=createPoseLibrary(merged);
const bytes=readFileSync(resolve(root,'vc/runtime-pose.json'));
assert.deepEqual(gunzipSync(readFileSync(resolve(root,'vc/runtime-pose.json.gz'))),bytes);
const profileBytes=readFileSync(evidence.profileFile,'utf8').replaceAll('\r\n','\n');
assert.equal(createHash('sha256').update(profileBytes).digest('hex'),evidence.profileSha256);
const profile=JSON.parse(profileBytes),missingStateAnimations=[...new Set(Object.values(profile.states).map(state=>state.animationName))].filter(name=>!library.clips.has(name));
assert.deepEqual(missingStateAnimations,[]);
const required=['Fatal','DamageRevenge','SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK'];
const coverage={};
for(const name of required){
  const clip=library.clips.get(name);assert.ok(clip);
  const times=[0,Math.min(.23,clip.durationSeconds),Math.min(.4,clip.durationSeconds),clip.durationSeconds];
  for(const time of times)for(const matrix of samplePose(library,name,time).values())assert.ok(matrix.every(Number.isFinite));
  coverage[name]={durationSeconds:clip.durationSeconds,sampledTimes:times,poseFrames:merged.frames.length};
}
const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
const scene=new Scene(engine);scene.useRightHandedSystem=true;
new FreeCamera('overlay-coverage',new Vector3(0,0,10),scene);
try{
  const container=await loadPoseContainer(scene,resolve(sealed,'vc',metadata.runtimeGlb));
  const shared=await loadPoseContainer(scene,resolve(sealed,'vc',metadata.sharedCharacterAnimations.glb));
  installSharedCharacterAnimations(container,shared,metadata.sharedCharacterAnimations.clips);
  const available=new Set(container.animationGroups.map(group=>group.name));
  for(const name of required){assert.ok(available.has(name),name+' actual GLB group missing');coverage[name].actualGLBGroupLoaded=true;}
  assert.equal(available.size,container.animationGroups.length,'Duplicate GLB animation groups');
  const result={schemaVersion:1,evidenceClass:'current-simulation-original-key-and-actual-GLB-consumption; no GPU or original-client dynamic measurement',
    profileSha256:evidence.profileSha256,allProfileStateAnimations:missingStateAnimations.length===0,
    registeredPoseClips:library.clips.size,actualGLBAnimationGroups:available.size,coverage};
  writeFileSync(resolve(root,'vc-metadata-consumption-evidence.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result)+'\n');
}finally{scene.dispose();engine.dispose();}
