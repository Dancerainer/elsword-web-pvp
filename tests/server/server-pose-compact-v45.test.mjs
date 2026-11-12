/** Real production loader over a small authored pose fixture and unchanged
 * sealed Native modules. This is a storage/host parity contract, not an
 * original-client combat trajectory or an eight-player capacity measurement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {createFingerprintInventory,RESOURCE_FINGERPRINT_DOMAIN} from '../../packages/combat-assets/program-fingerprint.mjs';
import {FEEDBACK_FIXTURE_REFERENCE,FEEDBACK_FIXTURE_POSE_PATHS,writeFeedbackVisualFixture} from '../helpers/player-feedback-visual-fixture-v45.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const sourceAssets=path.resolve(process.env.RF_ASSET_ROOT??path.join(root,'artifacts'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function pose(){
  const names=['Bip01','COLLISION_SPHERE1_probe','ATTACK_SPHERE1_probe'];
  return {schemaVersion:1,frames:names.map((name,i)=>({name,parent:i?0:null,nativeRowMatrix:identity})),
    helpers:names.slice(1).map(name=>({name,nativeStoredBoundingRadius:2})),
    clips:[{name:'probe',durationSeconds:1,tracks:names.map((name,i)=>({frame_name:name,
      translation:{times:[0,.2,.2,1],values:[[0,0,1],[2.12345678901234,3+i,4],[5,6+i,7],[8,9+i,10]]},
      rotation:{times:[0,1],values:[[0,0,0,2],[0,2,0,0]]},
      scale:{times:[0,1],values:[[1,1,1],[2,2,2]]}}))}]};
}
async function fixture(t){
  const assetRoot=await mkdtemp(path.join(os.tmpdir(),'rf-server-packed-v45-')),inventory=createFingerprintInventory(RESOURCE_FINGERPRINT_DOMAIN);
  t.after(async()=>{assert.ok(path.resolve(assetRoot).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(assetRoot,{recursive:true,force:true});});
  const write=async(file,bytes,seal=true)=>{bytes=Buffer.from(bytes);const dest=path.join(assetRoot,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes);if(seal)inventory.add('assets/'+file,bytes);};
  const json=(file,value)=>write(file,JSON.stringify(value)+'\n');
  const map={sceneId:'packed-fixture',lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  await json('scene/sander-garpai-rock-pvp/manifest.json',{sceneId:map.sceneId});await json('scene/sander-garpai-rock-pvp/collision.json',map);
  const index={schemaVersion:1,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,templates:{}};
  for(const folder of ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'])await json('rf/'+folder+'/index.json',index);
  const document=pose();
  await json('rf/manifest.json',{referenceVersion:index.referenceVersion,effectAssetIndex:'effects.json',runtimePose:'pose.json'});
  await json('rf/effects.json',{templates:{fixture:{kind:'mesh',poseData:'effect.pose.json',events:[]}}});await json('rf/pose.json',document);await json('rf/effect.pose.json',document);
  await json('lk/manifest.json',{schemaVersion:1,unitClass:100,referenceVersion:index.referenceVersion,runtimeGlb:'body.glb',runtimePose:'pose.json',effectAssetIndex:'effects.json',visualEffectIndexes:['fx/index.json']});
  await json('lk/fx/index.json',index);await json('lk/effects.json',{templates:{fixture:{kind:'mesh',poseData:'effect.pose.json',events:[]}}});
  await json('lk/pose.json',document);await json('lk/effect.pose.json',document);await json('ui/skills/lk/catalog.json',{classId:100,skills:[]});
  // The additive source overlay reads seven companion poses into the raw-byte
  // seal. Its labeled GLB/texture placeholders are presence checks only; the
  // exact native sampler comparisons below still use the authored probe pose.
  const feedbackPoses=new Set(FEEDBACK_FIXTURE_POSE_PATHS);
  await writeFeedbackVisualFixture((file,bytes)=>write(file,bytes,feedbackPoses.has(file)));
  // Presence-only browser models are not copied into the combat byte seal.
  await mkdir(path.join(assetRoot,'lk'),{recursive:true});await writeFile(path.join(assetRoot,'lk/body.glb'),Buffer.from([0]));
  const manifestBytes=await readFile(path.join(sourceAssets,'native/manifest.json')),nativeManifest=JSON.parse(manifestBytes);
  await write('native/manifest.json',manifestBytes);
  for(const record of Object.values(nativeManifest.modules)){const bytes=await readFile(path.join(sourceAssets,'native',record.file));assert.equal(sha(bytes),record.sha256);await write('native/'+record.file,bytes);}
  for(const id of ['rf','lk'])for(const file of ['packages/combat-core/'+id+'-profile.json','config/'+id+'-preset.json'])inventory.add(file,await readFile(path.join(root,file)));
  return {assetRoot,document,map,nativeManifest,inventory,load:()=>loadServerCombatAssets({root,assetRoot})};
}

test('production server loader retains exact raw resource SHA and sealed Native sampling after pose packing',async t=>{
  const f=await fixture(t),assets=await f.load();
  assert.deepEqual(assets.fingerprints.resources,f.inventory.snapshot(),'raw byte inventory must not hash Float64 JSON serialization');
  const {native,samplers}=await assets.createRuntime();assert.equal(native.manifest.seal.manifestContentSha256,f.nativeManifest.seal.manifestContentSha256);
  let samples=0;
  for(const professionId of ['RF','LK']){
    const raw=createNativeSamplers({characterPose:f.document,effectIndex:{templates:{}},effectPoses:{},profile:assets.profiles[professionId],map:f.map});
    for(const animationTime of [0,.1,.2,.37,1])for(const facing of [-1,1]){
      const actor={id:professionId,professionId,x:17,y:23,z:31,lineId:0,grounded:true,facing,animationName:'probe',animationTime,animationLoop:false,consumeRootTranslation:false};
      assert.deepEqual(samplers.motionOffsetSampler(actor),raw.motionOffsetSampler(actor));
      assert.deepEqual(samplers.defenderSampler(actor),raw.defenderSampler(actor));
      assert.deepEqual(samplers.collisionSampler(actor,{raw:{}}),raw.collisionSampler(actor,{raw:{}}));samples+=3;
    }
  }
  t.diagnostic(JSON.stringify({exactSamplerComparisons:samples,rawResourceFiles:assets.fingerprints.resources.files.length,nativeModules:Object.keys(f.nativeManifest.modules).length}));
});

test('both RF and optional profession pose readers reject malformed packed channels before runtime creation',async t=>{
  const f=await fixture(t);
  for(const file of ['rf/pose.json','rf/effect.pose.json','lk/pose.json','lk/effect.pose.json']){
    const target=path.join(f.assetRoot,file),original=await readFile(target),bad=pose();bad.clips[0].tracks[0].translation.values.pop();
    await writeFile(target,JSON.stringify(bad));
    await assert.rejects(f.load(),/Invalid runtime pose channel/,'malformed '+file+' must not survive loading');
    await writeFile(target,original);
  }
});
