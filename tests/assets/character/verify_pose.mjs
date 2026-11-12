// Independent GLB-byte inspection checks source trajectory conversion and
// runtime key compaction. These are internal conversion checks, not client gold.
// node verify_pose.mjs artifacts/rf reports/rf-assets-pose-validation.json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {createPoseLibrary, samplePose, sampleHelpers, sampleChannel, compose, transform, multiply}
  from '../../../tools/assets/character/sample_pose.mjs';

const [folder, reportPath] = process.argv.slice(2);
if (!folder || !reportPath) throw new Error('Expected asset folder and report path');

function close(a, b, tolerance=0.0001) {
  assert.equal(a.length, b.length);
  for (let i=0;i<a.length;i++) assert.ok(Math.abs(a[i]-b[i])<=tolerance, `${i}: ${a[i]} != ${b[i]}`);
}

// Authored synthetic expectations: column transforms and quaternion hemisphere.
close(transform(compose([1,2,3],[2,3,4],[0,0,0,1]),[5,6,7]),[11,20,31]);
close(transform(multiply(compose([1,0,0],[1,1,1],[0,0,0,1]),compose([0,2,0],[1,1,1],[0,0,0,1])),[0,0,0]),[1,2,0]);
close(sampleChannel({times:[0,1],values:[[0,0,0,1],[0,0,0,-1]]},.5,true),[0,0,0,1]);
assert.throws(()=>sampleChannel({times:[0],values:[[0,0,0,0]]},0,true));

function loadGlb(file) {
  const bytes=fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLength=bytes.readUInt32LE(12), document=JSON.parse(bytes.subarray(20,20+jsonLength));
  const binaryStart=20+jsonLength+8, binary=bytes.subarray(binaryStart);
  function accessor(index) {
    const access=document.accessors[index],view=document.bufferViews[access.bufferView],start=(view.byteOffset??0)+(access.byteOffset??0);
    const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[access.type];
    const componentWidth={5126:4,5125:4,5123:2,5121:1}[access.componentType];
    const read={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE',5121:'readUInt8'}[access.componentType];
    const stride=view.byteStride??width*componentWidth;
    return Array.from({length:access.count},(_,i)=>Array.from({length:width},(_,j)=>binary[read](start+i*stride+j*componentWidth)));
  }
  const parents=new Map();
  document.nodes.forEach((node,index)=>(node.children??[]).forEach(child=>parents.set(child,index)));
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const clips=document.animations.map(animation=>{
    const tracks=new Map();
    for(const channel of animation.channels){
      const {node,path:channelPath}=channel.target,sampler=animation.samplers[channel.sampler];
      const track=tracks.get(node)??{};
      track[channelPath]={times:accessor(sampler.input).map(v=>v[0]),values:accessor(sampler.output)};
      tracks.set(node,track);
    }
    return {name:animation.name,tracks};
  });
  function pose(name,time){
    const clip=clips.find(c=>c.name===name),worlds=new Map();
    if(!clip)throw new Error('Missing GLB clip '+name);
    function evaluate(index){
      if(worlds.has(index))return worlds.get(index);
      const node=document.nodes[index],track=clip.tracks.get(index);
      const t=track?.translation?sampleChannel(track.translation,time):node.translation??[0,0,0];
      const s=track?.scale?sampleChannel(track.scale,time):node.scale??[1,1,1];
      const q=track?.rotation?sampleChannel(track.rotation,time,true):node.rotation??[0,0,0,1];
      const local=track||!node.matrix?compose(t,s,q):node.matrix;
      const parent=parents.has(index)?evaluate(parents.get(index)):identity;
      const world=multiply(parent,local);worlds.set(index,world);return world;
    }
    document.nodes.forEach((_,i)=>evaluate(i));return worlds;
  }
  return {document,accessor,pose,nodesByName:new Map(document.nodes.map((node,i)=>[node.name,i]))};
}

const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
const source=createPoseLibrary(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(folder,'pose-tracks.json.gz')))));
const runtimeSource=createPoseLibrary(JSON.parse(fs.readFileSync(path.join(folder,manifest.runtimePose),'utf8')));
const full=loadGlb(path.join(folder,manifest.glb)),runtime=loadGlb(path.join(folder,manifest.runtimeGlb));
const records=new Map(manifest.clips.map(c=>[c.name,c]));
if(manifest.runtimeCharacter.profileCoverage){
  const included=new Set(manifest.runtimeCharacter.selection.included);
  for(const [state,name] of Object.entries(manifest.runtimeCharacter.profileCoverage.stateAnimations))
    assert.ok(included.has(name),`Missing profile state animation ${state}: ${name}`);
}
let compared=0,largestDifference=0;
for(const name of manifest.runtimeCharacter.selection.included){
  const duration=records.get(name).durationSeconds;
  for(const time of [0,.003,Math.min(.11,duration),duration*.5,Math.max(0,duration-.003),duration]){
    const nativePose=samplePose(source,name,time),fullPose=full.pose(name,time),runtimePose=runtime.pose(name,time);
    const helperPose=samplePose(runtimeSource,name,time);
    for (const [node,matrix] of helperPose) close(matrix,nativePose.get(node),1e-10);
    for(const [node,native] of nativePose){
      const original=fullPose.get(full.nodesByName.get(node)),compacted=runtimePose.get(runtime.nodesByName.get(node));
      if(!original||!compacted)throw new Error('Missing conversion node '+node);
      const reflected=native.map((value,index)=>value*((index%4===2?-1:1)*(Math.floor(index/4)===2?-1:1)));
      close(original,reflected,.001);close(compacted,original,1e-10);
      largestDifference=Math.max(largestDifference,...original.map((value,index)=>Math.abs(value-reflected[index])));compared++;
    }
  }
}

function skinnedBounds(asset,clip,time,filter=()=>true){
  const worlds=asset.pose(clip,time),points=[];
  asset.document.nodes.forEach((node,index)=>{
    if(node.mesh===undefined||!filter(node))return;
    const skin=node.skin!==undefined?asset.document.skins[node.skin]:null;
    const offsets=skin?asset.accessor(skin.inverseBindMatrices):null;
    for(const primitive of asset.document.meshes[node.mesh].primitives){
      const vertices=asset.accessor(primitive.attributes.POSITION);
      const joints=skin?asset.accessor(primitive.attributes.JOINTS_0):null,weights=skin?asset.accessor(primitive.attributes.WEIGHTS_0):null;
      vertices.forEach((vertex,vi)=>{
        if(!skin){points.push(transform(worlds.get(index),vertex));return;}
        const out=[0,0,0];
        for(let j=0;j<4;j++)if(weights[vi][j]){
          const joint=joints[vi][j],p=transform(multiply(worlds.get(skin.joints[joint]),offsets[joint]),vertex);
          for(let axis=0;axis<3;axis++)out[axis]+=p[axis]*weights[vi][j];
        }
        points.push(out);
      });
    }
  });
  return {min:[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))),max:[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis])))};
}
const waitBounds=skinnedBounds(full,'Wait',0);
const feetBounds=skinnedBounds(full,'Wait',0,node=>/Foot/.test(node.name));
const helpers=sampleHelpers(source,'ComboZ1',.15);
const effectChecks=[];
for (const effect of manifest.effects) {
  const data=JSON.parse(fs.readFileSync(path.join(folder,effect.poseData),'utf8'));
  if(data.unsupportedTracks.length){assert.throws(()=>createPoseLibrary(data));effectChecks.push({source:effect.source,status:'unsupported tracks rejected'});continue;}
  const library=createPoseLibrary(data);
  let sampled=0;
  for (const name of library.clips.keys()) for (const time of [0,.5,1]) {
    for (const helper of sampleHelpers(library,name,time)) for(const vertex of helper.vertices) assert.ok(vertex.every(Number.isFinite));
    sampled++;
  }
  effectChecks.push({source:effect.source,status:'source helper poses finite',samples:sampled});
}
const effectAssetIndex=JSON.parse(fs.readFileSync(path.join(folder,manifest.effectAssetIndex),'utf8'));
const effectTemplateChecks=[];
for(const name of ['Raven_WeaponDummy01','Raven_NasodBall','Raven_Aura','Mesh_Power_Assault']){
  const asset=effectAssetIndex.templates[name];
  assert.ok(asset?.poseData,'Missing mainEffect resource '+name);
  const library=createPoseLibrary(JSON.parse(fs.readFileSync(path.join(folder,asset.poseData),'utf8')));
  const helpers=sampleHelpers(library,asset.initialAnimation.name,.15);
  assert.ok(helpers.some(helper=>helper.vertices.length),'Missing original helper geometry '+name);
  for(const helper of helpers)assert.ok(helper.position.every(Number.isFinite));
  effectTemplateChecks.push({name,poseData:asset.poseData,initialSize:asset.initialSize,initialAnimation:asset.initialAnimation,
    initialVelocity:asset.initialVelocity,helperNames:helpers.map(helper=>helper.name)});
}
assert.equal(effectAssetIndex.templates.Raven_WeaponDummy02,undefined);
const dummy=effectAssetIndex.templates.Raven_WeaponDummy01;
assert.equal(dummy.initialVelocity,null); // Absence is preserved, never an inferred XYZ(0,0,0).
assert.equal(dummy.drawCountLiteral,'0');
const rootSamples=['Wait','BoostPower','SP2a_PowerAssault','Raven_OT_SP1a_ChargedBolt','SI_A_RF_MEGADRILL_BREAK','SI_A_RF_THRUST'].map(name=>{
  const record=records.get(name),times=[0,record.durationSeconds/2,record.durationSeconds];
  return {name,samples:times.map(time=>({time,nativeRoot:samplePose(source,name,time).get('Bip01').slice(12,15),
    nativeRootWithHorizontalConsumed:samplePose(source,name,time,{rootTranslationOverride:[0,null,0]}).get('Bip01').slice(12,15)}))};
});
const report={clientMeasured:false,checks:['synthetic matrix/quaternion contracts','full GLB vs original decoded pose','compacted runtime GLB vs full GLB'],
  runtimeClips:manifest.runtimeCharacter.selection.included.length,comparedNodePoses:compared,largestSourceGltfDifference:largestDifference,
  waitBoundsGltf:waitBounds,waitFeetBoundsGltf:feetBounds,rootSamples,exampleHelperBounds:helpers.map(h=>({name:h.name,bounds:h.bounds,position:h.position})),
  effectChecks,effectTemplateChecks,runtimeHelperBones:runtimeSource.frames.length,
  runtimeProfileCoverage:manifest.runtimeCharacter.profileCoverage??null,
  limits:'Internal conversion verification; native original-client pose/timing/collision fidelity remains unmeasured.'};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({comparedNodePoses:compared,largestSourceGltfDifference:largestDifference,waitFeetBoundsGltf:feetBounds}));
