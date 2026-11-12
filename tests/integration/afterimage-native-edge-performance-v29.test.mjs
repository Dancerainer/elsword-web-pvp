import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,VertexBuffer,MeshBuilder,TransformNode} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {updateNativeCharacterEdge,nativeCharacterEdge} from '../../apps/web/native-character-edge.mjs';
import {createBuffAfterimages} from '../../apps/web/buff-afterimages.mjs';
import {PHOENIX_AFTERIMAGE_COLOR} from '../../packages/presentation/buff-afterimage.mjs';

const assets=resolve(process.env.ELSWORD_ASSETS_ROOT??'artifacts');
const file=url=>resolve(assets,url.replace(/^\/assets\//,'')),json=url=>JSON.parse(readFileSync(file(url)));
const actor=id=>({id,hp:10000,x:120,y:240,z:15,facing:1,awakening:{remaining:0},buffs:[{templateId:4,factorId:46,
  displayer:{COMBINATION:{0:8},BDT_AFTER_IMAGE:{COLOR:{$symbol:'call@4.return0'}}}}]});
const ghosts=scene=>scene.meshes.filter(mesh=>mesh.name.startsWith('buff-afterimage:')&&mesh.isEnabled());
const updateEdges=view=>{for(const mesh of view.meshes)updateNativeCharacterEdge(mesh);};
const resources=scene=>({meshes:scene.meshes.length,materials:scene.materials.length});

for(const costume of ['default','nasod'])test('actual RS '+costume+' ghost merges only identical native edge skin and retains geometry/alpha',
  {skip:!existsSync(file('/assets/rs/manifest.json'))},async t=>{
    const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
    try{
      const containers=new Map(),loadContainer=(base,name)=>{const key=base+name;let promise=containers.get(key);
        if(!promise){promise=loadPoseContainer(scene,file(key));containers.set(key,promise);}return promise;};
      const manifest=json('/assets/rs/manifest.json'),pose=json('/assets/rs/'+manifest.runtimePose);
      const view=createActorView(await loadContainer('/assets/rs/',manifest.runtimeGlb),scene,'rs',.01,pose);styleCharacter(view);
      if(costume!=='default'){
        const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer});
        publishCostume(view,prepareCostumeView(view,await cache.load('RS',costume),'RS',scene,styleCharacter));
      }
      const a=actor('rs');sampleAnimation(view,'SI_SA_EMK_PHOENIX_TALON',.5);placeActor(view,a);view.costume?.update(a,.1);updateEdges(view);
      const sources=view.root.getChildMeshes().filter(mesh=>mesh.isEnabled()&&mesh.isVisible&&mesh.getTotalVertices()>0);
      const snapshots=new Map();
      for(const source of sources){source.computeWorldMatrix(true);source.skeleton?.prepare(true);
        snapshots.set(source.uniqueId,{positions:[...source.getPositionData(true,true)],world:[...source.getWorldMatrix().asArray()]});}
      const calls=new Map();for(const source of sources){const old=source.getPositionData;
        source.getPositionData=function(...args){calls.set(this.uniqueId,(calls.get(this.uniqueId)??0)+1);return old.apply(this,args);};}
      const baseline=resources(scene),renderer=createBuffAfterimages({scene,viewFor:()=>view,localActorId:'rs'});renderer.step([a],1/60);
      const captured=ghosts(scene),covered=new Set();let copies=0;
      for(const ghost of captured){
        const id=ghost.metadata.afterimageSourceId,source=sources.find(mesh=>mesh.uniqueId===id),expected=snapshots.get(id);
        assert.ok(expected);assert.deepEqual([...ghost.getVerticesData(VertexBuffer.PositionKind)],expected.positions);
        assert.deepEqual([...ghost.getWorldMatrix().asArray()],expected.world);covered.add(id);
        const count=ghost.metadata.afterimageCopies;copies+=count;
        if(count===2){const edge=nativeCharacterEdge(source).edge;
          assert.deepEqual(snapshots.get(edge.uniqueId),expected,'skinned edge duplicate has exact same positions and world basis');
          covered.add(edge.uniqueId);assert.equal(calls.get(edge.uniqueId)??0,0,'do not bake the identical edge skin a second time');}
        assert.equal(calls.get(id),1,'exactly one skin bake for the retained geometry');
      }
      assert.equal(covered.size,sources.length,'full body, original face, costume and attachments remain covered');
      assert.equal(copies,sources.length,'merge preserves all original alpha contributions');
      assert.ok(captured.length<sources.length,'native edge duplicate draws removed');
      const alpha=.5-1.6/60;
      for(const ghost of captured){const tint=ghost.material._colors4.tint;
        assert.deepEqual([tint.r,tint.g,tint.b],PHOENIX_AFTERIMAGE_COLOR.slice(0,3));
        const expected=ghost.metadata.afterimageCopies===2?alpha*(2-alpha):alpha;
        assert.equal(tint.a,expected);
        for(const background of [0,.15,.5,1])for(const color of PHOENIX_AFTERIMAGE_COLOR.slice(0,3)){
          let original=background;for(let i=0;i<ghost.metadata.afterimageCopies;i++)original=color*alpha+original*(1-alpha);
          assert.ok(Math.abs(color*tint.a+background*(1-tint.a)-original)<1e-15,'source-over ghost colour unchanged');
        }
      }
      const positions=[...captured[0].getVerticesData(VertexBuffer.PositionKind)],world=[...captured[0].getWorldMatrix().asArray()];
      a.x+=150;sampleAnimation(view,'SI_SA_EMK_PHOENIX_TALON',.8);placeActor(view,a);view.costume?.update(a,.1);updateEdges(view);renderer.step([a],1/60);
      assert.deepEqual([...captured[0].getVerticesData(VertexBuffer.PositionKind)],positions);assert.deepEqual([...captured[0].getWorldMatrix().asArray()],world);
      for(let i=0;i<120;i++)renderer.step([a],1/60);
      assert.ok(renderer.proof().meshSlots<=captured.length*10,'all local slots remain bounded');
      a.buffs=[];for(let i=0;i<30;i++)renderer.step([a],1/60);
      assert.deepEqual(resources(scene),baseline,'both normal and compensated material pools fully retire');
      renderer.dispose();view.dispose();t.diagnostic(JSON.stringify({costume,sourceBakesAndDraws:sources.length,mergedBakesAndDraws:captured.length,coverage:sources.length}));
    }finally{scene.dispose();engine.dispose();}
  });

test('a displaced native edge remains a separate frozen silhouette instead of losing coverage',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const root=new TransformNode('actor',scene),mesh=MeshBuilder.CreateBox('body',{},scene);mesh.parent=root;
    const view={root,meshes:[mesh]};styleCharacter(view);updateEdges(view);
    nativeCharacterEdge(mesh).edge.position.x=2;
    const renderer=createBuffAfterimages({scene,viewFor:()=>view,localActorId:'rs'});renderer.step([actor('rs')],1/60);
    assert.equal(ghosts(scene).length,2);assert.ok(ghosts(scene).every(ghost=>ghost.metadata.afterimageCopies===1));renderer.dispose();
  }finally{scene.dispose();engine.dispose();}
});
