import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {sampleChannel,sampleChannelToRef,nativeQuaternionNlerp,nativeQuaternionNlerpToRef} from '../../tools/assets/character/sample_pose.mjs';

const assets=resolve(process.env.ELSWORD_ASSETS_ROOT??'artifacts');
const read=file=>JSON.parse(readFileSync(file));

test('caller-owned sampling preserves raw exact keys, packed channels, sign correction and duplicate key boundaries',()=>{
  const document={schemaVersion:1,frames:[],clips:[{name:'raw',tracks:[{frame_name:'bone',
    translation:{times:[0,.2,.2,1],values:[[0,-0,1],[2,3,4],[5,6,7],[8,9,10]]},
    scale:{times:[0,1],values:[[1,2,3],[4,5,6]]},
    rotation:{times:[0,.2,1],values:[[0,0,0,2],[0,3,0,1],[0,-4,0,-1]]}}]}]};
  for(const source of [document,compactPoseDocument(structuredClone(document))]){
    for(const key of ['translation','scale','rotation']){
      const channel=source.clips[0].tracks[0][key],out=new Float64Array(key==='rotation'?4:3);
      for(const time of [-1,0,.1,.2,.37,1,2]){
        assert.equal(sampleChannelToRef(channel,time,key==='rotation',out),out);
        assert.deepEqual([...out],sampleChannel(channel,time,key==='rotation'));
      }
      if(channel.stride!==undefined){channel.values.subarray=()=>{throw Error('hot path must not allocate subarray wrappers');};
        sampleChannelToRef(channel,.37,key==='rotation',out);}
    }
  }
  const result=new Float64Array(4);
  for(const [left,right] of [[[0,0,0,2],[0,3,0,1]],[[0,0,0,2],[0,-3,0,-1]],[[1,2,3,4],[-1,-2,-3,-4]]])
    for(const weight of [0,.1,.37,.9,1])assert.deepEqual([...nativeQuaternionNlerpToRef(left,right,weight,result)],nativeQuaternionNlerp(left,right,weight));
  const left=new Float64Array([1,2,3,4]),right=new Float64Array([2,3,4,5]),expected=nativeQuaternionNlerp(left,right,.37);
  assert.equal(nativeQuaternionNlerpToRef(left,right,.37,left),left);assert.deepEqual([...left],expected,'in-place caller storage is safe');
});

test('caller storage validates malformed channels and quaternion interpolation',()=>{
  for(const channel of [{times:[],values:[]},{times:[0],values:[]},{times:new Float64Array([0]),values:new Float64Array(2),stride:2}])
    assert.throws(()=>sampleChannelToRef(channel,0,false,new Float64Array(3)),/Invalid channel/);
  assert.throws(()=>sampleChannelToRef({times:[0],values:[[1,2,3]]},0,false,new Float64Array(4)),/Invalid channel result/);
  for(const pair of [[[0,0,0,0],[1,0,0,0]],[[NaN,0,0,1],[0,0,0,1]],[[0,0,0,1],[0,Infinity,0,1]]])
    assert.throws(()=>nativeQuaternionNlerpToRef(...pair,.5,new Float64Array(4)),/Invalid quaternion/);
  assert.throws(()=>nativeQuaternionNlerpToRef([0,0,0,1],[0,0,0,1],2,new Float64Array(4)),/Invalid native quaternion weight/);
});

for(const id of ['rf','lk','vc','rs','is','bm','gm','bh','ca','lp','mm','de'])
  test('actual '+id+' double pose keys remain numerically identical through reusable sampling',
    {skip:!existsSync(resolve(assets,id,'manifest.json'))},t=>{
      const manifest=read(resolve(assets,id,'manifest.json'));
      const pose=compactPoseDocument(read(resolve(assets,id,manifest.runtimePose)));let samples=0;
      for(const clip of pose.clips)for(const track of clip.tracks)for(const key of ['translation','scale','rotation']){
        const channel=track[key];if(!channel)continue;const out=new Float64Array(key==='rotation'?4:3);
        for(const time of [channel.times[0],channel.times[Math.floor(channel.times.length/2)],channel.times.at(-1),
          channel.times[0]+(channel.times.at(-1)-channel.times[0])*.37]){
          assert.equal(sampleChannelToRef(channel,time,key==='rotation',out),out);
          assert.deepEqual([...out],sampleChannel(channel,time,key==='rotation'),id+'/'+clip.name+'/'+track.frame_name+'/'+key+'/'+time);samples++;
        }
      }
      assert.ok(samples>0);t.diagnostic(JSON.stringify({profession:id,clips:pose.clips.length,equivalentSamples:samples}));
    });
