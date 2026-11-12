/** Real packed VC/RF animation channels through the production asset loader.
 * NullEngine pose checks do not constitute an original-client or GPU capture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createPoseAudit} from '../../apps/web/pose-audit.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=new URL('../../',import.meta.url),assetRoot=fileURLToPath(new URL('artifacts/',root));
const path=url=>resolve(assetRoot,new URL(url,'http://assets.local').pathname.replace(/^\/assets\//,''));

test('deployed VC Fatal closure retargets actual shared Raven animation and matches original VC pose keys',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('vc-stun',new Vector3(0,0,10),scene);
  t.after(()=>{scene.dispose();engine.dispose();});
  const assets=await loadProfessionAssets({id:'VC',
    data:async url=>JSON.parse(readFileSync(path(url))),
    loadContainer:(base,file)=>loadPoseContainer(scene,path(base+file))});
  assert.equal(assets.profile.states.RSI_DAMAGE_GROGGY.animationName,'Fatal');
  assert.equal(assets.bodyContainer.animationGroups.filter(group=>group.name==='Fatal').length,1);
  assert.equal(assets.characterPose.clips.filter(clip=>clip.name==='Fatal').length,1);
  const original=JSON.parse(gunzipSync(readFileSync(new URL('artifacts/vc/source-proof/pose-tracks.json.gz',root))));
  const view=createActorView(assets.bodyContainer,scene,'vc-stun',.01,assets.characterPose),audit=createPoseAudit(original);
  for(const animationTime of [0,.1,.6,1.0666666666666667,1.2,2.3]){
    const actor={id:'vc-stun',animationName:'Fatal',animationTime,animationLoop:true,
      x:1858.11,y:2840,z:0,facing:-1,applyMotionOffset:false,consumeRootTranslation:true};
    assert.equal(sampleAnimation(view,'Fatal',animationTime,true),true);
    placeActor(view,actor);scene.render();
    const proof=audit(view,actor);
    assert.ok(proof.maximumErrorNative<.002,JSON.stringify({animationTime,...proof}));
  }
});
