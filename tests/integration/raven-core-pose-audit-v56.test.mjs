/** Actual core GLB/source keys. This verifies conversion under a common root,
 * not original-client dynamic steering or Web collision adjudication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {createPoseAudit} from '../../apps/web/pose-audit.mjs';
const glb=new URL('../../artifacts/rf/effects/Motion_Raven_RageMode_Nasod.glb',import.meta.url);
const document=JSON.parse(readFileSync(new URL('../../artifacts/rf/effects/Motion_Raven_RageMode_Nasod.pose.json',import.meta.url)));
async function fixture(t){
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 t.after(()=>{scene.dispose();engine.dispose();});
 const container=await loadPoseContainer(scene,glb),view=createActorView(container,scene,'original-core',.01,document);
 const actor={x:2349.1435546875,y:2966,z:0,facing:-1,animationName:'Attack3',animationTime:.30000004172325134,animationLoop:false,applyMotionOffset:false};
 const original=createPoseAudit(document),displayed=createPoseAudit(document,{useDisplayedRoot:true});
 function present(name,time,scale,rotation){
  Object.assign(actor,{animationName:name,animationTime:time});
  view.root.position.set(actor.x*.01,actor.y*.01,-actor.z*.01);view.root.scaling.setAll(.01*scale);
  view.root.rotation.set(...rotation.map(n=>-n*Math.PI/180));sampleAnimation(view,name,time,false);
  for(const node of view.root.getDescendants())node.computeWorldMatrix(true);
 }
 return {view,actor,original,displayed,present};
}
test('real Attack3 helper1.4 reproduces the failed character-root audit, while common-root source tracks retain the strict .02 gate',async t=>{
 const q=await fixture(t);q.present('Attack3',.30000004172325134,1.399999976158142,[0,-180,0]);
 const wrong=q.original(q.view,q.actor),correct=q.displayed(q.view,q.actor);
 assert.equal(wrong.worldTransform,'authored-actor');assert.ok(wrong.maximumErrorNative>8.4&&wrong.maximumErrorNative<8.6);
 assert.equal(wrong.worstNode,'X_UnnamedFrame__duplicate_4');
 assert.equal(correct.worldTransform,'displayed-root');assert.equal(correct.referenceFrame,'source-local-tracks-under-displayed-root');
 assert.match(correct.purpose,/native core root position, scale and steering policy are not verified/);
 assert.equal(correct.supported,true);assert.equal(correct.comparedNodes,51);
 assert.deepEqual(correct.missing,[]);assert.equal(correct.clockDifferenceSeconds,0);assert.ok(correct.maximumErrorNative<.02,JSON.stringify(correct));
});
test('all five original AttackN clips retain .02 source-track accuracy with independently selected helper scales and steering rotations',async t=>{
 const q=await fixture(t);
 for(const name of ['Attack1','Attack2','Attack3','Attack4','Attack5'])for(const scale of [1,1.399999976158142,1.600000023841858])
 for(const rotation of [[0,-180,0],[0,-179.96465979496364,-5.811679148539196]]){
  q.present(name,.35403342019319506,scale,rotation);const proof=q.displayed(q.view,q.actor);
  assert.equal(proof.supported,true);assert.equal(proof.comparedNodes,51);assert.deepEqual(proof.missing,[]);
  assert.equal(proof.clockDifferenceSeconds,0);assert.ok(proof.maximumErrorNative<.02,JSON.stringify({name,scale,rotation,proof}));
 }
});
test('common-root comparison still rejects a wrong displayed source clip and detects an altered original local track',async t=>{
 const q=await fixture(t);q.present('Attack3',.49,1.399999976158142,[0,-179.96465979496364,-5.811679148539196]);
 assert.equal(q.displayed(q.view,{...q.actor,animationName:'Attack2'}).supported,false);
 const node=q.view.nodesBySourceName.get('X_UnnamedFrame__duplicate_4');node.position.x+=1;
 for(const current of q.view.root.getDescendants())current.computeWorldMatrix(true);
 const corrupt=q.displayed(q.view,q.actor);assert.ok(corrupt.maximumErrorNative>.02,'only the root is shared; local source-track errors must remain visible');
});
