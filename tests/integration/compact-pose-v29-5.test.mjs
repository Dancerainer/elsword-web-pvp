import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {sampleChannel,createPoseLibrary,samplePose} from '../../tools/assets/character/sample_pose.mjs';

test('packed double channels preserve exact keys, raw nonunit quaternion and interpolation',()=>{
  const raw={schemaVersion:1,frames:[],clips:[{name:'x',tracks:[{frame_name:'b',translation:{times:[0,.23,1],values:[[0,-0,1],[2.12345678901234,3,4],[5,6,7]]},rotation:{times:[0,1],values:[[0,0,0,2],[0,2,0,0]]},scale:{times:[0,1],values:[[1,1,1],[2,2,2]]}}]}]};
  const compact=compactPoseDocument(structuredClone(raw));assert.equal(compactPoseDocument(compact),compact);
  for(const key of ['translation','rotation','scale'])for(const time of [-1,0,.1,.23,.6,1,2])
    assert.deepEqual(sampleChannel(compact.clips[0].tracks[0][key],time,key==='rotation'),sampleChannel(raw.clips[0].tracks[0][key],time,key==='rotation'));
});

test('corrupt channels reject lengths, row widths, nonfinite keys and descending times',()=>{
  const channel={times:[0,1],values:[[1,2,3],[4,5,6]]};
  for(const broken of [{...channel,times:[]},{...channel,values:[[1,2,3]]},{...channel,values:[[1,2],[3,4]]},{...channel,times:[1,0]},{...channel,times:[0,Infinity]},{...channel,values:[[1,2,NaN],[4,5,6]]}])
    assert.throws(()=>compactPoseDocument({schemaVersion:1,frames:[],clips:[{name:'broken',tracks:[{frame_name:'x',translation:broken}]}]}),/Invalid runtime pose channel/);
  assert.throws(()=>sampleChannel({times:new Float64Array([0]),values:new Float64Array(2),stride:2},0),/Invalid channel/);
});

for(const id of ['rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de'])test('actual '+id+' runtime pose retains all sampled native matrices after packing',()=>{
  const manifest=JSON.parse(readFileSync('artifacts/'+id+'/manifest.json'));
  const raw=JSON.parse(readFileSync('artifacts/'+id+'/'+manifest.runtimePose));
  const packed=compactPoseDocument(structuredClone(raw));
  const before=createPoseLibrary(raw),after=createPoseLibrary(packed);
  let comparisons=0;
  for(const [name,clip] of before.clips)for(const time of [0,clip.durationSeconds*.37,clip.durationSeconds]){
    assert.deepEqual(samplePose(after,name,time),samplePose(before,name,time),id+'/'+name+'/'+time);comparisons++;
  }
  assert.ok(comparisons>0);
});
