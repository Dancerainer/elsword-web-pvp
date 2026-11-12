import test from 'node:test';
import assert from 'node:assert/strict';
import {addCommonBuffVisuals,professionPoseAssetPath} from '../../packages/combat-assets/common-buffs.mjs';

const referenceVersion='Steam-NA-2016-V6.0420.5';
const template=()=>({kind:'CT_EFFECT_MESH',fields:{bone:'Bip01_Head'},initialAnimation:'original.x',lifeTimeLiteral:1,
  glb:'meshes/original.glb',poseData:'poses/original.json',textures:{diffuse:{file:'textures/original.png'}}});
const index=templates=>({schemaVersion:1,referenceVersion,templates});

test('common buff visuals retain profession assets and resolve only missing display resources from their own directory',()=>{
  const owned=template(),common=index({owned:template(),foreign:template()}),original=index({owned});
  const merged=addCommonBuffVisuals(original,common);
  assert.equal(merged.templates.owned,owned);assert.equal(merged.templates.foreign.glb,'../common-buffs/meshes/original.glb');
  assert.equal(merged.templates.foreign.poseData,'../common-buffs/poses/original.json');
  assert.equal(merged.templates.foreign.textures.diffuse.file,'../common-buffs/textures/original.png');
  assert.equal(common.templates.foreign.glb,'meshes/original.glb');assert.equal(original.templates.foreign,undefined);
  assert.equal(professionPoseAssetPath('LK',merged.templates.foreign.poseData),'common-buffs/poses/original.json');
  assert.equal(professionPoseAssetPath('RF','fx/original.json'),'rf/fx/original.json');
  assert.equal(professionPoseAssetPath('RF','../de/fx/moonlight.pose.json'),'de/fx/moonlight.pose.json');
});

test('conflicting original declarations and wrong versions are rejected before sharing display resources',()=>{
  assert.throws(()=>addCommonBuffVisuals(index({owned:template()}),index({owned:{...template(),fields:{bone:'guessed'}}})),/Conflicting common buff declaration/);
  assert.throws(()=>addCommonBuffVisuals(index({}),{...index({}),referenceVersion:'other'}),/target version/);
});

test('common visual paths cannot escape the shared resource directory',()=>{
  for(const file of ['../foreign.glb','/foreign.glb','C:/foreign.glb','fx//foreign.glb','fx/./foreign.glb','..\\foreign.glb'])
    assert.throws(()=>addCommonBuffVisuals(index({}),index({foreign:{...template(),glb:file}})),/Invalid common buff asset path/);
});
