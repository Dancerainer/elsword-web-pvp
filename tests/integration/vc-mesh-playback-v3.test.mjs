/** Resource/lifecycle smoke test, not a GPU or original-client visual verdict. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {nativeEffectMeshHasNoOutput} from '../../apps/web/native-effect-depth-v7.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const vcEffectPoses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/vc',path)))]));

test('the newly included DropDown mesh retains frozen minor declaration, original DLL clip and reused bytes',()=>{
  const source=JSON.parse(readFileSync(new URL('../../contracts/rf-landing-fx-index-v1.json',import.meta.url))).templates.DropDown;
  const proof=JSON.parse(readFileSync(new URL('../../contracts/vc-landing-reuse-v3.json',import.meta.url)));
  const mesh=index.templates.DropDown,pose=vcEffectPoses[mesh.poseData];
  assert.deepEqual(Object.values(index.templates).filter(t=>t.glb&&t.sharedResourceEvidence?.index==='artifacts/rf/landing-fx/index.json').map(t=>t.name),['DropDown']);
  for(const key of ['fields','events','source','declarationSha256','animationClips','meshMaterialClosure'])assert.deepEqual(mesh[key],source[key]);
  assert.equal(mesh.glb,'../rf/'+source.glb);assert.equal(mesh.poseData,'../rf/'+source.poseData);
  for(const file of proof.sharedFiles.filter(f=>[mesh.glb,mesh.poseData].includes(f.file))){
    const bytes=readFileSync(resolve('artifacts/vc',file.file));
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  }
  assert.deepEqual(mesh.events.find(e=>e.property==='AniName').value,{animation:'dropdown',playback:'XAP_ONE'});
  assert.equal(mesh.fields.PlayCount,1);assert.equal(mesh.animationClips[0].durationSeconds,0.3333333432674408);
  assert.equal(pose.clips[0].name,'dropdown');assert.equal(pose.clips[0].durationSeconds,mesh.animationClips[0].durationSeconds);
  assert.equal(pose.observedClock.evidenceClass,'target-2016-shipped-DLL-executed');
  assert.equal(pose.observedClock.ticksPerSecond,4800);
  assert.equal(pose.observedClock.sourceSha256,mesh.meshMaterialClosure[0].meshSource.sha256);
  assert.equal(pose.observedClock.dllSha256,'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f');
});

test('all VC mesh templates use confirmed original clips and every visible template creates finite render geometry',async t=>{
  const templates=Object.values(index.templates).filter(row=>row.glb),names=templates.filter(row=>(row.fields.DrawCount??1)>0&&!nativeEffectMeshHasNoOutput(row)).map(row=>row.name);
  assert.equal(templates.length,110);assert.equal(new Set(templates.map(row=>row.glb)).size,52);
  assert.equal(names.length,80);assert.ok(names.includes('DropDown'));
  for(const template of templates){
    assert.equal(template.animationRequiresUnconfirmedRate,false,template.name);
    const animations=template.events.filter(event=>event.property==='AniName');
    for(const event of animations)assert.ok(template.animationClips.some(clip=>clip.name===event.value.animation&&clip.durationSeconds>0),template.name+': '+event.value.animation);
    assert.ok(vcEffectPoses[template.poseData],template.name+' complete original pose');
  }
  const f=vcFixture(),engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('vc-mesh-check',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  const profile={...vcProfile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:vcEffectPoses,
    samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const state={actors:[f.a],effects:[]},failures=[];
  for(const name of names){
    view.clear();view.event({type:'effectStarted',effectId:name,name,actorId:f.a.id,skillId:24034,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    let drawn=false;
    for(let frame=0;frame<90;frame++){
      view.step(1/60,state);view.render();
      const root=scene.transformNodes.find(node=>node.name.startsWith('fx-'+name+'-')&&node.name.endsWith('-world')&&node.isEnabled());
      if(root){
        const meshes=root.getChildMeshes().filter(mesh=>mesh.getTotalVertices()>0);
        assert.ok(meshes.length>0,name+' original mesh geometry');
        for(const mesh of meshes)assert.ok(mesh.computeWorldMatrix(true).asArray().every(Number.isFinite),name+' finite world matrix');
        drawn=true;
      }
    }
    if(!drawn)failures.push({name,unsupported:view.proof().unsupported});
    if(name==='DropDown'){
      assert.equal(view.count,0,'new shared DropDown finishes its actual original one-shot clip');
      assert.equal(view.proof().activeEffectParents,0,'new shared DropDown leaves no parent after its tail');
    }
  }
  assert.deepEqual(failures,[],'every visible source template reaches render geometry');
  t.diagnostic(`${names.length} visible template lifecycles / ${templates.length} authored mesh templates / 52 shared-or-private GLBs; NullEngine only`);
});
