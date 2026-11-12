import test from 'node:test';
import assert from 'node:assert/strict';
import {templateAssetFiles,referenceCandidates,walkStrings} from '../../tools/audit-effect-resources-v6.mjs';
test('asset audit retains collision poses as independent resources and deduplicates repeated texture references',()=>{
  assert.deepEqual(templateAssetFiles({glb:'fx/body.glb',poseData:'effects/collision.pose.json',textures:{0:{file:'fx/spark.png'},1:{file:'fx/spark.png'}}}),
    ['rf/fx/body.glb','rf/effects/collision.pose.json','rf/fx/spark.png']);
});
test('asset audit resolves namespace and GLB-relative files while excluding remote and source-machine paths',()=>{
  assert.ok(referenceCandidates('rf/fx/index.json','fx/mesh.glb').includes('rf/fx/mesh.glb'));
  assert.ok(referenceCandidates('rf/fx/mesh.glb','textures/a.png').includes('rf/fx/textures/a.png'));
  assert.deepEqual(referenceCandidates('rf/fx/index.json','D:/client/original.png'),[]);
  assert.deepEqual(referenceCandidates('rf/fx/index.json','https://example.com/a.png'),[]);
  const strings=[];walkStrings({a:['file.json',{b:'sound.ogg'}]},value=>strings.push(value));assert.deepEqual(strings,['file.json','sound.ogg']);
});
