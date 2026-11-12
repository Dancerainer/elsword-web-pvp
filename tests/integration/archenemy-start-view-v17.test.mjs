import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,SceneLoader,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {makeArc,project,profile,starts,poses,samplers} from '../helpers/archenemy-v17-fixture.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);

test('actual converted Start GLBs render both facings on sourceControl clock and restored core state',async()=>{
  const original=SceneLoader.LoadAssetContainerAsync;
  SceneLoader.LoadAssetContainerAsync=async(root,file,scene)=>loadPoseContainer(scene,resolve(project,'artifacts/rf',file));
  try{for(const facing of [-1,1]){
    const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
    new FreeCamera('arc-source-camera',new Vector3(0,0,10),scene);
    const view=await createEffectsView({scene,engine,index:starts,profile,samplers,effectPoses:poses,loadout:[{skillId:24008}]});
    const s=await makeArc(facing);s.step(1/60,{pressed:['A']},{snapshot:false});let cursor=0,restored=false,checked=0;
    for(let i=0;i<150;i++){
      s.step(1/60,{}, {snapshot:false});
      for(const e of s.state.events.slice(cursor))if(e.sourceArcStartMesh||e.type==='effectEnded')view.event(e,s.state);
      cursor=s.state.events.length;
      if(!restored&&s.state.effects.some(e=>e.sourceArcStartMesh&&e.sourceArcGlobalTime>.05)){
        s.restore(JSON.parse(JSON.stringify(s.snapshot())));restored=true;
      }
      view.step(1/60,s.state);view.render();
      for(const clock of view.sourceMeshClocks()){
        const e=s.state.effects.find(e=>e.id===clock.effectId);assert.ok(e?.sourceArcStartMesh);
        assert.equal(clock.animationTime,e.sourceArcPose.animationTime);assert.equal(clock.globalTime,e.sourceArcGlobalTime);
        const part=Number(e.name.at(-1))+3,bone=`Dummy0${part}`;
        const node=scene.transformNodes.find(n=>n.name.startsWith('fx-'+e.name+'-')&&n.name.endsWith('_'+bone));
        assert.ok(node,'actual source Dummy frame is rendered');const matrix=node.computeWorldMatrix(true).asArray();
        const native=samplers.effectBoneSampler(e,s.actor('rf'),bone);
        [matrix[12]/.01,matrix[13]/.01,-matrix[14]/.01].forEach((n,k)=>close(n,native[k]));checked++;
      }
    }
    assert.ok(restored&&checked>30);assert.equal(view.sourceMeshClocks().length,0);
    assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().unsupported.length,0);
    view.clear();scene.dispose();engine.dispose();
  }}finally{SceneLoader.LoadAssetContainerAsync=original;}
});
