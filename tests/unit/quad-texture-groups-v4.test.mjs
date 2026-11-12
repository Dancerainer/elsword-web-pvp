import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeQuadTextureDrawGroups,nativeParticleTextureEventId} from '../../apps/web/native-sequence-render-order.mjs';
import {compileEvents} from '../../packages/effect-runtime/index.mjs';

test('source texture events retain declaration IDs even when names repeat at later times',()=>{
  const channels=compileEvents({events:[
    {property:'Texture',start:0,end:0,fade:false,value:'same.dds'},
    {property:'Size',start:0,end:0,fade:false,value:[1,1,1]},
    {property:'Texture',start:1,end:1,fade:false,value:'other.dds'},
    {property:'Texture',start:2,end:2,fade:false,value:'same.dds'},
  ]});
  assert.deepEqual([0,.99,1,2].map(age=>nativeParticleTextureEventId({channels,age})),[0,0,2,3]);
});

test('native texture-map order collects interleaved births and repeats each complete texture group',()=>{
  const rows=[
    {id:'old-tex1',textureId:1,path:'b',drawCount:2},
    {id:'tex0',textureId:0,path:'a',drawCount:2},
    {id:'young-tex1',textureId:1,path:'b',drawCount:2},
  ];
  assert.deepEqual(nativeQuadTextureDrawGroups(rows).map(g=>[g.textureId,g.draw,g.rows.map(p=>p.id)]),[
    [0,0,['tex0']],[0,1,['tex0']],
    [1,0,['old-tex1','young-tex1']],[1,1,['old-tex1','young-tex1']],
  ]);
});

test('distinct native texture IDs remain distinct groups even if both refer to the same file',()=>{
  const a={id:'later-map-id',textureId:4,path:'same.dds',drawCount:1};
  const b={id:'earlier-map-id',textureId:2,path:'same.dds',drawCount:1};
  const groups=nativeQuadTextureDrawGroups([a,b]);
  assert.deepEqual(groups.map(g=>g.textureId),[2,4]);
  assert.equal(groups[0].rows[0],b);assert.equal(groups[1].rows[0],a);
  assert.deepEqual(nativeQuadTextureDrawGroups([]),[]);
});
