/** Small current-host diagnostic; original GetKeys/source evidence is separate. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {makeArc,read,project,starts,samplers} from '../../tests/helpers/archenemy-v17-fixture.mjs';
import {ARC_START_MESH_NAMES} from '../../packages/combat-core/archenemy-mesh.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),json=v=>JSON.parse(JSON.stringify(v));
const old=read('contracts/rf-archenemy-source-v12.json');
const wanted={
  'X2Lib/X2GURaven.cpp':[[475,552],[5351,5428],[13146,13307]],
  'KTDXLIB/KTDGXMeshPlayer.cpp':[[305,375],[1216,1268],[1466,1522],[1573,1637],[1951,2030],[2065,2146],[2443,2548],[2918,2944],[2997,3004]],
  'KTDXLIB/KTDGXSkinAnim.cpp':[[6,42],[758,796],[1166,1288]],
  'KTDXLIB/KTDGXSkinAnim.h':[[150,152],[380,435]]};
const sourceRows=Object.entries(wanted).map(([file,lineSpans])=>{
  const row=old.sourceRows.find(r=>r.file===file);assert.ok(row);
  const path=resolve(project,'.cache/native-source-runtime',file),raw=readFileSync(path);
  assert.equal(hash(raw),row.sourceFileSha256);
  const lines=raw.toString('latin1').split('\n');
  return {file,sourceFileSha256:row.sourceFileSha256,lineSpans,
    evidenceClass:'fixed-V5-reference-a8438f3-not2016',
    spanSha256:lineSpans.map(([a,b])=>hash(Buffer.from(lines.slice(a-1,b).join('\n')+'\n','latin1')))};
});
const request=read('reports/rf-archenemy-start-d3dx-sources-v17.json');
for(const row of request.sources)assert.equal(hash(readFileSync(row.source)),row.sourceSha256);
const native=read('artifacts/native/manifest.json');
if(native.runtimeVersion==='original-source-functions-v10'){
  const bounded=read('contracts/rf-awakened-skills-source-v17.json');
  for(const [name,record] of Object.entries(bounded.retainedPairings))assert.deepEqual(native.modules[name],record);
  assert.equal(native.modules.skills.sha256,bounded.runtimeModule.sha256);
  assert.ok(native.seal.boundedRebuildHistory.some(row=>row.module==='skills'&&
    row.previousSha256===bounded.previousSkills.sha256&&row.sha256===bounded.runtimeModule.sha256));
}else assert.equal(native.seal.manifestContentSha256,'55b5be44dc2a9983cd87c5a73d7139df1f75bebe40ac9ab11afaaa57984427c1');
for(const row of Object.values(native.modules))assert.equal(hash(readFileSync(resolve(project,'artifacts/native',row.file))),row.sha256);
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(resolve(dir,x.name)):[resolve(dir,x.name)]);
const inventory=files(resolve(project,'artifacts/rf/archenemy-fx-v17')).sort().map(path=>({
  path:relative(project,path).replaceAll('\\','/'),bytes:readFileSync(path).length,sha256:hash(readFileSync(path))}));
const runs=[];
for(const facing of [-1,1]){
  const s=await makeArc(facing);s.step(1/60,{pressed:['A']},{snapshot:false});
  const observed=new Map(),poses=[];
  for(let i=0;i<150;i++){
    s.step(1/60,{}, {snapshot:false});
    for(const e of s.state.effects.filter(e=>e.sourceArcStartMesh)){
      const saved=observed.get(e.id)??new Set(),phase=!saved.has('birth')?'birth':
        e.sourceArcPose.animationTime>=1/3&&!saved.has('rear')?'rear':null;
      const index=ARC_START_MESH_NAMES.indexOf(e.name),bone=`Dummy0${index+4}`;
      const sample={phase:phase??'last-live',effectId:e.id,name:e.name,worldTime:s.state.time,
        ownerAnimationTime:s.actor('rf').animationTime,meshGlobalTime:e.sourceArcGlobalTime,
        meshControllerTime:e.sourceArcPose.animationTime,anchor:e.currentAnchor,
        bone,sourceBonePosition:samplers.effectBoneSampler(e,s.actor('rf'),bone),
        TRACE_START0:samplers.effectBoneSampler(e,s.actor('rf'),'TRACE_START0'),slashTrace:e.sourceArcSlashTrace};
      if(phase){poses.push(sample);saved.add(phase);}observed.set(e.id,saved);
      observed.set(e.id+':last',sample);
    }
  }
  for(const [key,sample] of observed)if(typeof key==='string')poses.push(sample);
  const lifecycle=s.state.events.filter(e=>e.type==='effectStarted'&&(e.sourceArcStartMesh||e.sourceArcMesh)||
    e.type==='effectEnded'&&e.reason==='original-mesh-play-end').map(e=>({type:e.type,time:e.time,name:e.name,
      effectId:e.effectId,reason:e.reason,sourceArcStartMesh:e.sourceArcStartMesh,sourceArcMesh:e.sourceArcMesh}));
  const prior=s.state.events.length;s.step(1/60,{pressed:['Z']},{snapshot:false});
  let released,resumeMatches=false;
  for(let i=0;i<150;i++){
    s.step(1/60,{}, {snapshot:false});
    if(!released){const e=s.state.effects.find(e=>e.sourceArcHandle&&e.initialDirSpeed===3000);
      if(e){released={time:s.state.time,effectId:e.id,position:e.currentAnchor.position,meshGlobalTime:e.sourceArcGlobalTime,
        resetLifetime:e.meshLifetimeElapsed,maxLifetime:e.lifeTimeSeconds};
        const restored=await makeArc(facing);restored.restore(json(s.snapshot()));
        for(let k=0;k<5;k++){s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
        resumeMatches=JSON.stringify(json(restored.snapshot()))===JSON.stringify(json(s.snapshot()));assert.ok(resumeMatches);}}
  }
  const hits=s.state.events.slice(prior).filter(e=>e.type==='hit'&&e.origin?.kind==='effect'&&e.origin.skillId===24008);
  assert.equal(hits.length,1);s.actor('rf').hp=0;s.step(1/60,{}, {snapshot:false});
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,0);
  runs.push({facing,poses,lifecycle,released,releaseResumeMatches:resumeMatches,spearHits:hits.map(e=>({time:e.time,amount:e.amount,
    effectId:e.origin.id,coefficient:e.data.DAMAGE.MAGIC})),remainingOwnedAfterDeath:s.actor('rf').sourceArcEnemy.data.length});
}
const contract={schemaVersion:1,targetClientCombatMeasured:false,fullClientExecuted:false,
  fixedReferenceCommit:old.fixedReferenceCommit,sourceRows,
  targetDeclaration:{file:'GameMajorXMeshPlayer.txt',sha256:starts.templates[ARC_START_MESH_NAMES[0]].source.sha256,
    lines:[[6458,6476],[6478,6496],[6498,6516],[6518,6536]],
    templates:ARC_START_MESH_NAMES.map(name=>({name,declarationSha256:starts.templates[name].declarationSha256,
      initialAnimation:starts.templates[name].initialAnimation,initialAniSpeed:starts.templates[name].initialAniSpeed,
      initialSize:starts.templates[name].initialSize,fields:starts.templates[name].fields,events:starts.templates[name].events}))},
  originalDll:{sourceRequest:'reports/rf-archenemy-start-d3dx-sources-v17.json',
    sourceRequestSha256:hash(readFileSync(resolve(project,'reports/rf-archenemy-start-d3dx-sources-v17.json'))),
    keyManifest:'reports/rf-archenemy-start-d3dx-keyframes-v17.json',
    sources:request.sources,dllSha256:request.dllSha256},
  binding:{creation:'four source Now mesh commands at .6666/.8/1/1.1333; instance GetPos/GetRotateDegree; no BONE_NAME attachment',
    handToRear:'original Start Dummy04/05/06/07 keys; no synthetic path or owner follow',
    waiting:'existing1.5 callback creates separate four owned damage meshes and SetPos rear immediately',
    controller:'fixed-V5 initial .1 speed ramp, mesh AniSpeed1.4, strict XAP_ONE end pulse consumed by next mesh packet',
    lifetime:'each original measured Normal period; never extend Start to the1.5 waiting callback',
    slashTrace:'global Initial false; Anim .05 true using prior SkinAnim clock; original TRACE endpoints through existing renderer'},
  integration:{index:'contracts/rf-archenemy-start-fx-index-v17.json',servedIndex:'/assets/rf/archenemy-fx-v17/index.json',
    mergeProfileTemplates:ARC_START_MESH_NAMES,resourceOnlyTemplates:ARC_START_MESH_NAMES,inventory,
    ignoredDllKeys:'artifacts/native-d3dx/archenemy-start-v17-keyframes.json'},
  nativeSeal:{moduleCount:Object.keys(native.modules).length,manifestContentSha256:native.seal.manifestContentSha256,arcTaskModuleBytesChanged:false,
    integrationChangedModules:native.runtimeVersion==='original-source-functions-v10'?['skills']:[]},
  limitations:['No original2016 whole-client trajectory or GPU comparison.',
    'Original DLL GetKeys confirms resources, not the2016 production controller or callback schedule.',
    'Fixed V5 Start instances revert to perFrame=false after .0001 creation; current-host step does not recreate render FinalFrame grouping.',
    'Exact actor hand overlap in2016 was not measured; no extra hand attachment was inferred.',
    'Waiting/Normal failed-LOOP candidate and unresolved target4.48/7.61 coefficient boundary stay as documented in v12.']};
const report={schemaVersion:1,evidenceClass:'current-web-host-diagnostic-not-original-client',originalClientExecuted:false,
  dt:1/60,skillId:24008,runs,nativeSeal:contract.nativeSeal};
writeFileSync(resolve(project,'contracts/rf-archenemy-start-source-v17.json'),JSON.stringify(contract,null,2)+'\n');
writeFileSync(resolve(project,'reports/rf-archenemy-start-observations-v17.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceFilesChecked:sourceRows.length,originalXsChecked:request.sources.length,
  assetFiles:inventory.length,runs:runs.map(r=>({facing:r.facing,lifecycleEvents:r.lifecycle.length,spearHits:r.spearHits.length,resume:r.releaseResumeMatches})),nativeSeal:contract.nativeSeal}));
