import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,Color3,Vector4} from '@babylonjs/core';
import {installNativeCharacterEdge,updateNativeCharacterEdge} from '../../apps/web/native-character-edge.mjs';

test('native vec4 edge colour retains all RGBA components and updates the same typed value',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const mesh=MeshBuilder.CreateBox('source',{},scene);mesh.renderOutline=true;mesh.outlineWidth=.125;
    const row=installNativeCharacterEdge(mesh),color=row.color;
    assert.ok(color instanceof Vector4);assert.deepEqual(color.asArray(),[0,0,0,1]);
    assert.equal(row.material._floatsArrays.nativeEdgeColor,undefined);
    assert.equal(row.material._vectors4.nativeEdgeColor,color);
    mesh.outlineColor=new Color3(.25,.75,.5);mesh.visibility=.6;updateNativeCharacterEdge(mesh);
    assert.equal(row.color,color);assert.deepEqual(color.asArray(),[.25,.75,.5,.6]);
    assert.equal(row.material._vectors4.nativeEdgeColor,color);assert.ok(row.edge.isEnabled());
    mesh.renderOutline=false;updateNativeCharacterEdge(mesh);assert.equal(row.edge.isEnabled(),false);
    mesh.dispose();assert.equal(row.edge.isDisposed(),true);
  }finally{scene.dispose();engine.dispose();}
});
