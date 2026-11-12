/** Original converted mesh/source checks plus current display-budget checks.
 * The six-fragment budget is an authorized Web quality tradeoff, not an
 * original-client trajectory or a new combat declaration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene} from '@babylonjs/core';
import {readGlb,loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {effectMeshPresentationIndices} from '../../packages/effect-runtime/presentation-quality.mjs';
const url=p=>new URL('../../'+p,import.meta.url),read=p=>JSON.parse(readFileSync(url(p)));
const profile=read('packages/combat-core/lk-profile.json'),index=read('artifacts/lk/fx/index.json');
const stone='ESK_Mortal_Blow_MOVE_Stone',flames=['ESK_MORTAL_BLOW_Grow1','ESK_Mortal_Blow_Explosion01'];
const glbFile='artifacts/lk/fx/meshes/ESK_MORTAL_BLOW_Rock2.glb';
const all12=Array.from({length:12},(_,i)=>i),half12=[0,2,4,6,8,10];
const sha=p=>createHash('sha256').update(readFileSync(url(p))).digest('hex');

test('frozen Mortal Blow rock model has twelve fragments with identical materials and unchanged source hashes',()=>{
  assert.equal(sha(glbFile),'2532f42a206656b1634d185155b38437e9be75496b99762ce333a14cc1eb957a');
  const original=read('contracts/lk-fx-index.json').templates[stone];
  for(const declaration of [index.templates[stone],profile.effectTemplates[stone]]){
    assert.equal(declaration.declarationSha256,'e76a2cb744a9594a938f8e347b5725b56cc5e56e637ecb9fff841d8eca598729');
    for(const field of ['fields','events','repeated'])assert.deepEqual(declaration[field],original[field]);
  }
  assert.equal(index.sourceFiles.find(source=>source.name==='ESK_MORTAL_BLOW_Rock2.X').sha256,
    'aa0c56f90ebab09e2b3b20c9cd03fa85cfed5db770ec17eb5b7753bf78461d9d','independent original model provenance remains frozen');
  const json=readGlb(url(glbFile)).json;
  assert.equal(json.meshes.length,12);assert.equal(json.materials.length,12);
  assert.ok(json.meshes.every(mesh=>mesh.primitives.length===1));
  assert.ok(json.materials.every(material=>JSON.stringify(material)===JSON.stringify(json.materials[0])));
  assert.equal(json.meshes.reduce((n,mesh)=>n+json.accessors[mesh.primitives[0].attributes.POSITION].count,0),1500);
  assert.equal(json.animations[0].channels.length,42,'the unchanged original fragment animations are retained');
  const damage=profile.damageEffects.DamageEffect_ESK_Mortal_Blow_MOVE_Stone.raw;
  assert.equal(damage.DAMAGE_DATA.NO_DAMAGE,1);assert.equal(damage.DAMAGE_DATA.RE_ATTACK,0);
  assert.equal(index.templates[stone].animationClips[0].durationSeconds,1.5);
});

test('only the exact decorative rock template uses alternating fragment selection',()=>{
  for(const level of ['medium','low'])assert.deepEqual(effectMeshPresentationIndices(index.templates[stone],12,{level}),half12);
  assert.deepEqual(effectMeshPresentationIndices(index.templates[stone],12,{level:'high'}),all12);
  for(const name of [...flames,'ESK_MORTAL_BLOW_Rock11','Mesh_ESK_Mortal_Blow_Fire_Ground'])
    assert.deepEqual(effectMeshPresentationIndices(index.templates[name],12,{level:'medium'}),all12,name+' retains all of its source geometry');
  assert.deepEqual(effectMeshPresentationIndices({...index.templates[stone],glb:'other.glb'},12,{level:'medium'}),all12);
});

for(const level of ['medium','high'])test(`real pooled mesh rendering keeps the ${level} rock budget through animation, appearance and reuse`,async()=>{
  const engine=new NullEngine(),scene=new Scene(engine),names=[stone,...flames];
  const templates=Object.fromEntries(names.map(name=>[name,index.templates[name]]));
  const effectPoses=Object.fromEntries(names.map(name=>{const p=templates[name].poseData;return[p,read('artifacts/lk/'+p)];}));
  const view=await createEffectsView({scene,engine,index:{templates},profile,effectPoses,samplers:{},
    effectQuality:{level,particleDivisor:level==='high'?1:8},
    loadContainer:async(_base,file)=>loadPoseContainer(scene,url('artifacts/lk/'+file))});
  const state={actors:[{id:'caster',professionId:'LK',skillId:21034,facing:1,x:0,y:0,z:0}],effects:[]};
  const sourceMeshes=name=>scene.meshes.filter(mesh=>mesh.name.startsWith('fx-'+name+'-')&&mesh.getTotalVertices()>0);
  const liveMeshes=name=>sourceMeshes(name).filter(mesh=>mesh.isEnabled());
  const birth=(name,id)=>view.event({type:'effectStarted',actorId:'caster',effectId:id,name,skillId:21034,
    definition:{NAME:name},birthAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1}},state);
  try{
    for(let cycle=0;cycle<2;cycle++){
      names.forEach((name,i)=>birth(name,cycle*10+i+1));
      let flamePeak=0;
      for(let frame=0;frame<30;frame++){
        view.step(1/60,state);view.render();
        assert.equal(liveMeshes(stone).length,level==='high'?12:6,'animation/color sampling must not enable omitted child meshes');
        assert.deepEqual(sourceMeshes(stone).map((mesh,i)=>mesh.isEnabled()?i:null).filter(i=>i!==null),level==='high'?all12:half12);
        flamePeak=Math.max(flamePeak,liveMeshes(flames[1]).length);
      }
      assert.equal(sourceMeshes(stone).length,12,'the original pose hierarchy and every fragment remain in the view');
      assert.equal(liveMeshes(flames[0]).length,2,'all original growing-flame primitives remain visible');
      assert.ok(flamePeak>0,'the original explosion-fire mesh still births and naturally retires');
      view.clear();assert.equal(liveMeshes(stone).length,0);
    }
  }finally{scene.dispose();engine.dispose();}
  assert.equal(sha(glbFile),'2532f42a206656b1634d185155b38437e9be75496b99762ce333a14cc1eb957a');
});
