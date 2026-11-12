import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root)));
const profile=read('packages/combat-core/is-profile.json'),map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/is/effect-assets.json'),read('artifacts/is/fx/index.json'));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/is/'+p)]));
const pose=read('artifacts/is/runtime-pose.json'),characterPose=composeCharacterPose(pose,read('artifacts/is/'+pose.sharedPose));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('artifacts/native/'+p,root))});
function make(facing){return createSimulation({profile,map,preset:{guildPassives:[],passives:[],loadout:Array(8).fill(null)},
  actors:[{id:'is',professionId:'IS',team:0,position:[0,3080,0],lineId:2,facing}],nativeGeometry:native.geometry,
  ...createNativeSamplers({profile,characterPose,effectIndex:index,effectPoses:poses})});}
for(const facing of [-1,1])test('original left sheath follows complete hand matrix, releases without vanishing, and expires at source lifetime '+facing,()=>{
  const sim=make(facing),a=sim.actor('is');sim.enter(a,'ESSI_ETK_COMBO_XX','sheath-source-fixture');
  const unitPosition={x:a.x,y:a.y,z:a.z};
  sim.step(1/60,{});const e=sim.state.effects.find(e=>e.sourceISSheath);assert.ok(e);
  assert.equal(e.name,'ElswordSheath02');assert.equal(e.damage,null);assert.equal(e.lifeTimeSeconds,3);
  assert.equal(e.sourceISSheathFollowing,true);
  // The unit callback precedes this packet's Future movement integration;
  // retain its complete source matrix rather than resampling the moved actor.
  assert.deepEqual(e.sourcePosedAnchor.matrix,sim.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand',TRACE_MATRIX:1}},{...a,...unitPosition}).matrix);
  const first=structuredClone(e.sourcePosedAnchor.matrix);sim.step(1/60,{});assert.notDeepEqual(e.sourcePosedAnchor.matrix,first);
  assert.equal(e.sourceArcPose.animationName,'Elsword_SisKnight_sheath','failed Normal selects original index0 through the existing native controller');
  for(let i=0;i<10&&e.sourceISSheathFollowing;i++)sim.step(1/60,{});
  assert.equal(e.sourceISSheathFollowing,false);assert.ok(sim.state.effects.includes(e));
  const released=structuredClone(e.sourcePosedAnchor);sim.enter(a,'RSI_WAIT','release-test');a.x+=200;
  for(let i=0;i<20;i++)sim.step(1/60,{});assert.deepEqual(e.sourcePosedAnchor,released);
  for(let i=0;i<190;i++)sim.step(1/60,{});assert.ok(!sim.state.effects.includes(e));
});
test('all four source callbacks create the sheath while unrelated states do not',()=>{
  for(const name of ['ESSI_ETK_COMBO_ZZZ','ESSI_ETK_COMBO_XX','ESSI_ETK_DASH_COMBO_ZZ','ESSI_SI_A_ETK_COMPACT_COUNTER_GUARD_ATTACK','RSI_COMBO_Z']){
    const sim=make(1),a=sim.actor('is');sim.enter(a,name,'source-callback-fixture');sim.step(1/60,{});
    assert.equal(sim.state.effects.some(e=>e.sourceISSheath),name!=='RSI_COMBO_Z',name);
  }
});
