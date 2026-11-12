/** Actual Add recipient display assets, independent of the buff application
 * consumer. NullEngine validates geometry/pose and particle matrices; PNG bytes
 * are verified separately. This is not target-client GPU evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial,PBRMaterial} from '@babylonjs/core';
import {installCommonBuffs} from '../../packages/combat-core/buffs.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {addCommonBuffVisuals} from '../../packages/combat-assets/common-buffs.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createPoseLibrary,samplePose} from '../../tools/assets/character/sample_pose.mjs';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..'),read=path=>JSON.parse(readFileSync(path));
const assets=process.env.PROFESSION_ASSET_ROOT??resolve(root,'artifacts');
const increment=process.env.ADD_COMMON_BUFF_INCREMENT??resolve(root,'artifacts/common-buffs-add-v2-final');
const catalog=read(resolve(increment,'preview/common-buff-catalog.json'));
const index=read(resolve(increment,'common-buffs/add-fx/index.json'));
const ui=read(resolve(increment,'preview/buff-ui-manifest.json'));
const sourceProfile=id=>read(resolve(root,'packages/combat-core',id.toLowerCase()+'-profile.json'));
const name='Emoticon_State_Abnormality_REVERSE_STIGMA',setName='EffectSet_REVERSE_STIGMA';
const near=(a,b,eps=.002)=>a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<eps,`${a} != ${b}`));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('all twelve recipients reserve original Add DISPLAYER resources without acquiring source attacks',()=>{
  const commonIndex=read(resolve(root,'contracts/common-buff-display-fx-index.json'));
  const union={...commonIndex,templates:{...commonIndex.templates,...index.templates}};
  for(const id of ['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE']){
    const original=sourceProfile(id),before=structuredClone(original),profile=installCommonBuffs(structuredClone(original),catalog);
    const budget=collectEffectMeshBudget(profile,union,[],{effectQuality:{level:'high',particleDivisor:1}});
    assert.ok(budget.templates.has(name),id+' reserves foreign Stigma head display');
    assert.ok(budget.templates.has('ATT_Void_Field_P13'),id+' reserves original Void Field display mesh');
    assert.deepEqual(profile.buffFactors[478].raw,catalog.buffFactors[478].raw);
    assert.deepEqual(profile.buffFactors[368].raw,catalog.buffFactors[368].raw);
    for(const group of ['states','skillCatalog','damageEffects'])assert.deepEqual(profile[group],original[group],id+' '+group);
    assert.deepEqual(original,before);
  }
  assert.equal(catalog.buffTemplates[414],undefined,'NPC-only 38-bone Always cannot become an actor display root');
  assert.equal(catalog.effectSets.EffectSet_SI_HA_AMM_Apocalypse_Always,undefined);
});

test('LK received Stigma and Drone rows resolve the exact original Add atlas pieces',()=>{
  const lk=installCommonBuffs(sourceProfile('LK'),catalog),profiles={de:read(resolve(increment,'inputs/de-profile.json')),mm:read(resolve(increment,'inputs/mm-profile.json'))};
  const buffs=[{templateId:440,sourceActorId:'de'},{templateId:344,sourceActorId:'mm'}].map(row=>({...row,behaviors:[],finalizers:[{kind:'time',remaining:8}]}));
  const rows=buildBuffRows({id:'lk',professionId:'LK',buffs},{profile:lk,profileForBuff:b=>profiles[b.sourceActorId],assets:ui});
  assert.deepEqual(rows.map(row=>row.templateId),[440,344]);
  assert.ok(rows.every(row=>row.originalIcon));
  assert.deepEqual(rows.map(row=>row.isDebuff),[false,true],'target Stigma IS_DEBUF=0 is preserved despite its Debuff_Icon name');
  for(const row of rows){
    assert.equal(row.iconKey,profiles[buffs.find(b=>b.templateId===row.templateId).sourceActorId].buffTemplates[row.templateId].raw.BUFF_ICON_TEXTURE_KEY);
    const piece=ui.buffIcons[row.templateId],bytes=readFileSync(resolve(increment,'ui/buffs',piece.file));
    assert.equal(hash(bytes),piece.sha256);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  }
  assert.equal(catalog.buffFactors[368].raw.BUFF_TEMPLET_ID,344);assert.equal(catalog.buffFactors[370].raw.BUFF_TEMPLET_ID,344);
  assert.equal(catalog.buffTemplates[344].raw.DISPLAYER?.BDT_EFFECT_SET,undefined,'Drone declares an icon, not an invented actor effect set');
});

test('the increment merges into all twelve actual profession visual indexes with usable relative resource paths',()=>{
  const baseline=read(resolve(root,'contracts/common-buff-display-fx-index.json'));
  const common=mergeVisualEffectIndexes(baseline,index);
  for(const id of ['rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de']){
    const professionAssets=['gm','bh','ca'].includes(id)?process.env.ELESIS_ASSET_ROOT??assets:assets;
    const manifest=read(resolve(professionAssets,id,'manifest.json'));
    const original=mergeVisualEffectIndexes(...(manifest.visualEffectIndexes??['fx/index.json']).map(file=>read(resolve(professionAssets,id,file))));
    const visual=addCommonBuffVisuals(original,common);
    for(const [key,row] of Object.entries(original.templates))assert.strictEqual(visual.templates[key],row,'own profession conversion remains authoritative');
    for(const key of Object.keys(index.templates)){
      const row=visual.templates[key];assert.ok(row,id+' '+key);
      for(const file of [row.glb,row.poseData,...Object.values(row.textures??{}).map(texture=>texture.file)].filter(Boolean)){
        const path=file.startsWith('../common-buffs/add-fx/')?resolve(increment,'common-buffs',file.slice('../common-buffs/'.length)):resolve(professionAssets,id,file);
        assert.ok(readFileSync(path).length,id+' '+file);
      }
    }
  }
});

test('all twelve distinct converted display models load real geometry and source poses remain parseable',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);t.after(()=>{scene.dispose();engine.dispose();});
  const files=[...new Set(Object.values(index.templates).flatMap(row=>row.glb?[row.glb]:[]))];
  assert.equal(files.length,12);
  for(const file of files){
    const container=await loadPoseContainer(scene,resolve(increment,'common-buffs',file));
    assert.ok(container.meshes.some(mesh=>mesh.getTotalVertices()>0),file+' contains original geometry');container.dispose();
  }
  for(const row of Object.values(index.templates))if(row.poseData){
    const library=createPoseLibrary(read(resolve(increment,'common-buffs',row.poseData)));
    assert.ok(library.frames.size>0||library.frames.length>0,row.name+' original frame hierarchy');
  }
});

test('Stigma is rendered at the actual LK head, follows its movement once, and retires with the buff',async t=>{
  const manifest=read(resolve(assets,'lk/manifest.json')),pose=read(resolve(assets,'lk',manifest.runtimePose));
  const profile=installCommonBuffs(sourceProfile('LK'),catalog),definition=catalog.effectSets[setName].raw.EFFECT0;
  assert.equal(definition.BONE_NAME,'_HEAD_BONE');assert.equal(index.templates[name].fields.Trace,true);
  const samplers=createNativeSamplers({characterPose:pose,profile,effectIndex:index,effectPoses:{}});
  const library=createPoseLibrary(pose),clip=library.clips.get('Wait')??library.clips.values().next().value;
  const actor={id:'lk',professionId:'LK',hp:100,x:120,y:240,z:13,facing:1,state:'WAIT',stateSerial:1,
    animationName:clip.name,animationTime:0,animationLoop:true,consumeRootTranslation:true,awakening:{remaining:0},buffs:[{templateId:440}]};
  const anchor=samplers.effectAnchorSampler({definition},actor);assert.ok(anchor?.position);
  const head=samplePose(library,actor.animationName,0,{rootTranslationOverride:[0,null,0]}).get('Bip01_Head').slice(12,15);
  near(anchor.position,[head[0]+120,head[1]+240+70+(definition.POSITION_OFFSET_Y??0),head[2]+13]);
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('add-foreign-buff',new Vector3(0,0,10),scene);
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{440:profile.buffTemplates[440]},effectSets:{[setName]:profile.effectSets[setName]},resourceOnlyTemplates:[],resourceOnlyEffectSets:[]};
  const view=await createEffectsView({scene,engine,index:{...index,templates:{[name]:index.templates[name]}},profile:bounded,samplers,
    assetBase:'/assets/common-buffs/',effectQuality:{level:'low',particleDivisor:8}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const effect={id:9,ownerId:'lk',ownerStateSerial:1,name,mainEffectName:name,setName,definition,buffTemplateId:440,
    birthAnchor:anchor,active:true,elapsed:0,animationTime:0};
  const state={actors:[actor],effects:[effect]};
  view.event({type:'effectStarted',effectId:9,actorId:'lk',name,definition,birthAnchor:anchor,buffTemplateId:440,ownerStateSerial:1},state);
  for(let i=0;i<12;i++)view.step(.01,state);view.render();
  const mesh=scene.meshes.find(m=>m.name.startsWith('native-particle:'+name+'|')&&m.thinInstanceCount>0);
  assert.ok(mesh,'the original singleton remains visible even at the low particle budget');assert.equal(mesh.thinInstanceCount,1);
  const position=()=>{const m=mesh._thinInstanceDataStorage.matrixData;return [m[12]*100,m[13]*100,-m[14]*100];};
  near(position(),anchor.position);actor.x+=135;actor.y+=27;actor.z-=19;
  view.step(.01,state);view.render();near(position(),[anchor.position[0]+135,anchor.position[1]+27,anchor.position[2]-19]);
  actor.buffs=[];view.step(.01,state);view.render();
  assert.equal(view.proof().activeParticles,0,'the 9999-second authored particle ends with its buff owner');
});
