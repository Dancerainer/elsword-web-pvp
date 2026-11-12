import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedNativeQuadMaterial} from '../../apps/web/native-quad-materials.mjs';
function template(name,fields={}){return{name,kind:'particle',fields:{particleType:'PT_3D_PLANE',...fields}};}
test('same original texture from different profession paths and template names shares the exact material',()=>{
  const scene={},made=[],base={scene,create:()=>{const m={n:made.length};made.push(m);return m;}};
  const a=sharedNativeQuadMaterial({...base,template:template('demolition-wake'),path:'fx/a.png',assetBase:'/assets/lk/'});
  const b=sharedNativeQuadMaterial({...base,template:template('storm-flash',{Layer:15}),path:'../lk/fx/a.png',assetBase:'/assets/rs/'});
  assert.equal(a,b);assert.equal(made.length,1);
  for(const fields of [{SourceBlendMode:'D3DBLEND_ONE'},{DestBlendMode:'D3DBLEND_INVSRCALPHA'},{ZEnable:false}]){
    assert.notEqual(sharedNativeQuadMaterial({...base,template:template('barrier',fields),path:'fx/a.png',assetBase:'/assets/lk/'}),a);
  }
  assert.notEqual(sharedNativeQuadMaterial({...base,template:template('other-file'),path:'fx/b.png',assetBase:'/assets/lk/'}),a);
  assert.notEqual(sharedNativeQuadMaterial({...base,scene:{},template:template('other-scene'),path:'fx/a.png',assetBase:'/assets/lk/'}),a);
});
test('disposing a shared shader allows preparation to create a fresh material',()=>{
  const callbacks=[],base={scene:{},template:template('cue'),path:'@native-untextured',assetBase:'/assets/lk/',create:()=>({onDisposeObservable:{addOnce:fn=>callbacks.push(fn)}})};
  const a=sharedNativeQuadMaterial(base);assert.equal(sharedNativeQuadMaterial(base),a);callbacks[0]();assert.notEqual(sharedNativeQuadMaterial(base),a);
});
test('mesh and particle default destination blends remain distinct even with identical plane depth state',()=>{
  const base={scene:{},path:'@native-untextured',assetBase:'/assets/lk/',create:()=>({})};
  const particle=template('particle',{ZEnable:false}),mesh={...particle,name:'mesh',kind:'mesh'};
  assert.notEqual(sharedNativeQuadMaterial({...base,template:particle}),sharedNativeQuadMaterial({...base,template:mesh}));
  assert.equal(sharedNativeQuadMaterial({...base,template:particle}),sharedNativeQuadMaterial({...base,template:{...mesh,fields:{...mesh.fields,DestBlendMode:'D3DBLEND_DESTALPHA'}}}));
});
test('canonical aliases adopt the same sampler and original readiness promise without another factory call',()=>{
  const texture={},textureLoad=Promise.resolve(),material={},entry={material,texture,textureLoad},adopted=[];
  const base={scene:{},template:template('shared'),create:()=>entry,adopt:value=>adopted.push(value)};
  assert.equal(sharedNativeQuadMaterial({...base,assetBase:'/assets/vc/',path:'../rf/fx/a.png'}),material);
  assert.equal(sharedNativeQuadMaterial({...base,assetBase:'/assets/rs/',path:'../rf/fx/a.png',create:()=>{throw Error('duplicate texture factory');}}),material);
  assert.deepEqual(adopted,[entry,entry]);assert.equal(adopted[1].textureLoad,textureLoad);assert.equal(adopted[1].texture,texture);
});
