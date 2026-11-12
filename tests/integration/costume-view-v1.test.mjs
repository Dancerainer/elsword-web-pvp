import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {updateActorArmorPresentation} from '../../apps/web/armor-presentation.mjs';
import {updateActorInvulnerabilityPresentation} from '../../apps/web/invulnerability-presentation.mjs';
const file=url=>new URL('../../artifacts/'+url.replace(/^\/assets\//,''),import.meta.url);
const json=url=>JSON.parse(readFileSync(file(url)));
for(const profession of ['RF','LK','VC','RS','BM','IS'])test(profession+' original costume skins follow sampled bones, keep profession parts, switch awakening and release clones',
  {skip:!existsSync(file('/assets/costumes/manifest.json'))},async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;engine.getCaps().maxVertexUniformVectors=1024;
    try{
      const containers=new Map(),loadContainer=(base,name)=>{const key=base+name;let p=containers.get(key);if(!p){p=loadPoseContainer(scene,file(key));containers.set(key,p);}return p;};
      const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer});
      const base='/assets/'+profession.toLowerCase()+'/',manifest=json(base+'manifest.json');
      const source=await loadContainer(base,manifest.runtimeGlb),view=createActorView(source,scene,'actor');
      const originalMeshes=[...view.meshes],sourceGroup=view.groups[0];
      const clip=view.clips.has('Wait')?'Wait':[...view.clips.keys()][0];
      for(const id of ['officer','nasod','royal','solace']){
        const assets=await cache.load(profession,id);
        if(profession==='RF')for(const raven of ['VC','BM'])assert.equal(await cache.load(raven,id),assets,'Raven costume geometry is shared across careers');
        const appearance=prepareCostumeView(view,assets,profession,scene);assert.equal(view.costume??null,null);
        assert.ok(appearance.body.root.isEnabled()===false);
        publishCostume(view,appearance);
        const shown=originalMeshes.filter(mesh=>mesh.getTotalVertices()&&mesh.isVisible);
        assert.equal(shown.length,['LK','RS','IS'].includes(profession)?1:2,'only class face and Raven left arm remain');
        assert.ok(shown.some(mesh=>/Face/.test(mesh.name)));
        if(profession==='BM')assert.deepEqual(shown.map(mesh=>mesh.name).sort(),['actor_BM_Part_Raven_Face_render','actor_Raven_Hand_render'],
          'BM keeps original basic face item29 and class left arm item131598');
        for(const time of [0,.23,.57]){
          sampleAnimation(view,clip,time,true);appearance.update({awakening:{remaining:0}},.1);
          for(const {name}of assets.entry.poseFrames){
            const actual=appearance.body.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
            const expected=view.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
            assert.ok(actual.every((n,i)=>Number.isFinite(n)&&Math.abs(n-expected[i])<.0001),name+' matches animation owner');
          }
        }
        for(const remaining of [10,0,5]){
          appearance.update({awakening:{remaining}},.2);
          for(const row of appearance.accessories){
            if(row.awakened)assert.equal(row.awakened.view.root.isEnabled(),remaining>0);
            if(row.normal)assert.equal(row.normal.view.root.isEnabled(),remaining===0||!row.hasAwakened);
            for(const child of [row.normal,row.awakened].filter(Boolean)){
              assert.ok(child.view.root.parent.name.startsWith('actor_Bip01_'));
              assert.ok(child.view.meshes.every(mesh=>mesh.computeWorldMatrix(true).asArray().every(Number.isFinite)));
            }
          }
        }
        assert.equal(view.groups[0],sourceGroup,'profession keeps its original animation controller');
        const body=appearance.body;publishCostume(view,null);assert.equal(body.disposed,true);
        assert.deepEqual(view.meshes,originalMeshes);assert.ok(originalMeshes.every(mesh=>mesh.isVisible));
      }
      publishCostume(view,prepareCostumeView(view,await cache.load(profession,'solace'),profession,scene));
      if(profession==='BM'){
        const before=view.costume,meshCount=scene.meshes.length,nodeCount=scene.transformNodes.length;
        const valid=await cache.load('BM','officer');
        assert.throws(()=>prepareCostumeView(view,{...valid,entry:{...valid.entry,poseFrames:[{name:'missing-costume-frame'}]}},'BM',scene),/Missing costume pose frame/);
        assert.equal(view.costume,before,'failed preparation preserves the published appearance');
        assert.equal(scene.meshes.length,meshCount);assert.equal(scene.transformNodes.length,nodeCount);
      }
      const costume=view.costume;view.dispose();assert.equal(costume.body.disposed,true);
      assert.ok(!source.meshes[0].isDisposed(),'cached asset remains usable');
    }finally{scene.dispose();engine.dispose();}
  });

test('costume replacement releases disposed children from parent presentation caches while retaining base defaults',
  {skip:!existsSync(file('/assets/costumes/manifest.json'))},async()=>{
    const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
    try{
      const containers=new Map(),loadContainer=(base,name)=>{
        const key=base+name;
        if(!containers.has(key))containers.set(key,loadPoseContainer(scene,file(key),{materials:true}));
        return containers.get(key);
      };
      const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer});
      const base='/assets/rf/',manifest=json(base+'manifest.json');
      const source=await loadContainer(base,manifest.runtimeGlb),view=createActorView(source,scene,'cache-owner');
      styleCharacter(view);
      const originalMeshes=[...view.meshes],baseMeshes=new Set(originalMeshes);
      const actor={superArmor:true,superArmorNotRed:false,pvpWhiteFlash:true,deathAlpha:1};
      updateActorArmorPresentation(view,actor);updateActorInvulnerabilityPresentation(view,actor);
      const armorDefaults=new Map(view.armorOutlineDefaults),emissiveDefaults=new Map(view.invulnerabilityEmissiveDefaults);
      assert.ok(armorDefaults.size>0);assert.ok(emissiveDefaults.size>0);
      for(const id of ['royal','nasod']){
        const appearance=prepareCostumeView(view,await cache.load('RF',id),'RF',scene,styleCharacter);
        publishCostume(view,appearance);
        updateActorArmorPresentation(view,actor);updateActorInvulnerabilityPresentation(view,actor);
        const children=[appearance.body,...appearance.accessories.flatMap(row=>[row.normal?.view,row.awakened?.view].filter(Boolean)),
          ...appearance.attachments.map(row=>row.view)];
        const costumeMeshes=view.meshes.filter(mesh=>!baseMeshes.has(mesh)),costumeMaterials=new Set(costumeMeshes.map(mesh=>mesh.material));
        assert.ok(costumeMeshes.some(mesh=>view.armorOutlineDefaults.has(mesh)),'actual armor consumer retained costume meshes');
        assert.ok([...costumeMaterials].some(material=>view.invulnerabilityEmissiveDefaults.has(material)),
          'actual invulnerability consumer retained costume materials');
        publishCostume(view,null);
        assert.ok(children.every(child=>child.disposed));
        assert.ok(costumeMeshes.every(mesh=>mesh.isDisposed()&&!scene.meshes.includes(mesh)));
        assert.deepEqual(view.meshes,originalMeshes);
        assert.equal(view.armorOutlineDefaults.size,armorDefaults.size,'replacement leaves only the original outline defaults');
        assert.equal(view.invulnerabilityEmissiveDefaults.size,emissiveDefaults.size,'replacement leaves only the original material defaults');
        for(const [mesh,value]of armorDefaults)assert.equal(view.armorOutlineDefaults.get(mesh),value);
        for(const [material,value]of emissiveDefaults)assert.equal(view.invulnerabilityEmissiveDefaults.get(material),value);
      }
      view.dispose();assert.ok(!source.meshes[0].isDisposed(),'source asset cache remains reusable');
    }finally{scene.dispose();engine.dispose();}
  });

test('costume cache retries a failed shared Raven request and validates before loading',async()=>{
  let attempts=0,containers=0;
  const cache=createCostumeAssetCache({data:async()=>{
    if(++attempts===1)throw Error('interrupted');
    return {id:'costumes-2016-v1',visualRevision:'costume-effects-v2',characters:{raven:{royal:{glb:'body.glb',accessories:[],attachments:[]}}}};
  },loadContainer:async()=>({serial:++containers})});
  await assert.rejects(cache.load('BM','royal'),/interrupted/);
  const result=await cache.load('BM','royal');assert.equal(await cache.load('RF','royal'),result);assert.equal(await cache.load('VC','royal'),result);
  assert.equal(attempts,2);assert.equal(containers,1);assert.equal(await cache.load('BM','default'),null);
  await assert.rejects(cache.load('BM','../officer'),/invalid-costume/);assert.equal(attempts,2);
});
