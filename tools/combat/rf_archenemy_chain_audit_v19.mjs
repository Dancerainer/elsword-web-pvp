/** Current-host observations are separate from independently frozen source evidence. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {makeChain,runChain,inputTimeline,read,project,impactIndex,audioManifest,newSkillsPath,json} from '../../tests/helpers/archenemy-v19-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const write=(path,value)=>writeFileSync(resolve(project,path),JSON.stringify(value,null,2)+'\n');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(resolve(dir,e.name)):[resolve(dir,e.name)]);
const inventory=paths=>paths.map(path=>({path:relative(project,path).replaceAll('\\','/'),sha256:sha(readFileSync(path)),bytes:readFileSync(path).length}));
const baselineRoot=process.argv[2]?resolve(process.argv[2]):null;
const baselineFrozenRoot=process.argv[3]?resolve(process.argv[3]):null;
const proof=resolve(project,'artifacts/proof-archenemy-v19');mkdirSync(proof,{recursive:true});
const current=read('.cache/native-archenemy-skills-v19/source-contract.json');
const prior=read('.cache/native-skills-generated/source-contract.json');
const oldMethods=[...prior.functions,...prior.extraFunctions],methods=[...current.functions,...current.extraFunctions];
assert.equal(methods.length,71);assert.equal(oldMethods.length,70);
for(const r of oldMethods)assert.deepEqual(methods.find(n=>n.name===r.name),r);
assert.equal(current.wasm.sha256,sha(readFileSync(newSkillsPath)));
const sourceRows=[];
const wanted={
  'X2Lib/X2GURaven.cpp':[[474,552],[2985,2995],[5351,5428],[13146,13307],[13310,13320],[13322,13482],[13485,13495]],
  'X2Lib/X2DamageEffect.cpp':[[3668,3678],[4480,4503],[4994,5014],[5463,5485],[7123,7142]],
  'X2Lib/X2GUUser.cpp':[[8326,8354],[8925,8937],[11567,11617]],
  'KTDXLIB/Always.h':[[2684,2684],[2862,2862],[3317,3317]]};
const hashes={'X2Lib/X2GURaven.cpp':'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
  'X2Lib/X2DamageEffect.cpp':'8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8',
  'X2Lib/X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
  'KTDXLIB/Always.h':'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069'};
for(const [path,spans] of Object.entries(wanted)){
  const bytes=readFileSync(resolve(project,'.cache/native-source-runtime',path));assert.equal(sha(bytes),hashes[path]);
  const lines=bytes.toString('latin1').split('\n');
  sourceRows.push({path,sha256:hashes[path],bytes:bytes.length,classification:'fixed-V5-reference-not-target2016',
    spans:spans.map(([start,end])=>({startLine:start,endLine:end,sha256:sha(Buffer.from(lines.slice(start-1,end).join('\n')+'\n','latin1'))}))});
}
// Read both original functions independently from the frozen source bytes.
// Group18 may be reused only if the entire bodies are equal, including the
// original Future end/grounding queries and CommonEventProcess call.
const ravenSource=readFileSync(resolve(project,'.cache/native-source-runtime/X2Lib/X2GURaven.cpp'));
function originalEvent(name){
  const marker=Buffer.from('void CX2GURaven::'+name+'()'),start=ravenSource.indexOf(marker);
  assert.ok(start>=0);assert.equal(ravenSource.indexOf(marker,start+1),-1);
  const open=ravenSource.indexOf(123,start);let depth=1,end=open+1;
  for(;depth&&end<ravenSource.length;end++){if(ravenSource[end]===123)depth++;else if(ravenSource[end]===125)depth--;}
  assert.equal(depth,0);return {name,startLine:ravenSource.subarray(0,start).toString('latin1').split('\n').length,
    endLine:ravenSource.subarray(0,end).toString('latin1').split('\n').length,
    sha256:sha(ravenSource.subarray(start,end)),bodySha256:sha(ravenSource.subarray(open,end)),body:ravenSource.subarray(open,end)};
}
const normalEvent=originalEvent('RSI_SI2_OVER_TAKER_ARC_ENEMY_EventProcess');
const hyperEvent=originalEvent('RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_EventProcess');
assert.deepEqual(normalEvent.body,hyperEvent.body);
const {body:normalBody,...normalEventRecord}=normalEvent,{body:hyperBody,...hyperEventRecord}=hyperEvent;
const compiledEvent=methods.find(r=>r.name===normalEvent.name);
assert.equal(compiledEvent.sha256,normalEvent.sha256);assert.equal(compiledEvent.bodySha256,normalEvent.bodySha256);
const eventProcessReuse={normal:normalEventRecord,hyper:hyperEventRecord,byteIdenticalBodies:true,
  sharedCallbackGroup:18,hostMapping:'packages/combat-core/active-skills.mjs:ORIGINAL_SKILL_EVENTS',
  rule:'Future IsAnimationEnd -> Future grounded WAIT / ungrounded JUMP_DOWN; CommonEventProcess unchanged'};
let baseline;
if(baselineRoot){
  baseline=await import(pathToFileURL(resolve(baselineRoot,'tests/helpers/archenemy-v17-fixture.mjs')).href);
}
const runs=[];
for(const facing of [-1,1])for(const hyper of [false,true])for(const far of [false,true])for(const air of [false,true]){
  const options={facing,hyper,far,air},label=`${facing}_${hyper?'hyper':'normal'}_${far?'far':'near'}_${air?'jump':'ground'}`;
  const observed=await runChain(options);
  const before=baseline?await baseline.makeArc(facing):null;
  let oldReaction=[];
  if(before){
    before.configureLoadout([{skillId:24008},{skillId:24204},{skillId:24025},null,null,null,null,null],'rf');
    before.actor('rf').awakening.orbs=hyper?3:0;if(far)before.actor('target').x+=420*facing;
    for(const frame of observed.timeline)before.step(frame.dt,frame.input,{snapshot:false});
    oldReaction=before.state.events.filter(e=>e.type==='hit'&&e.origin.skillId===24008);
  }
  const output=`artifacts/proof-archenemy-v19/${label}.json`;
  write(output,{schemaVersion:1,targetClientMeasured:false,classification:'simulation-observation-not-source-oracle',options,
    timeline:observed.timeline,frames:observed.frames,
    baselineEvents:before?json(before.state.events):null});
  const impact=observed.reactions[0];assert.ok(impact);
  const saved=json(observed.s.snapshot()),restored=await makeChain(options);restored.restore(saved);
  for(let i=0;i<120;i++){observed.s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(json(observed.s.snapshot()),json(restored.snapshot()));
  runs.push({options,trace:{path:output,sha256:sha(readFileSync(resolve(project,output))),bytes:readFileSync(resolve(project,output)).length},
    observations:{spearHits:observed.reactions.map(r=>({time:r.time,amount:r.hit.amount,raw:r.hit.data,
      state:r.state,animation:r.animation,animationTime:r.animationTime,heightAboveLand:r.heightAboveLand,
      hitStop:r.hitStop,worldStop:r.worldStop,position:r.position})),
      ownedRemaining:observed.s.actor('rf').sourceArcEnemy.data.length,restore120Steps:true,
      releaseSounds:observed.s.state.events.filter(e=>e.type==='sound'&&e.field==='original-arc-release').length},
    baseline:before?{spearHits:oldReaction.length,coefficients:oldReaction.map(e=>e.data.DAMAGE.MAGIC),
      spearNames:before.state.events.filter(e=>e.type==='effectStarted'&&e.sourceArcMesh).map(e=>e.name)}:null});
}
const assets=read('contracts/rf-archenemy-hit-assets-v19.json');
const compiledFiles=inventory(files(resolve(project,'.cache/native-archenemy-skills-v19')).sort());
const contract={schemaVersion:1,targetClientMeasured:false,fullClientExecuted:false,
  sourceReferenceCommit:current.sourceCommit,sourceRows,eventProcessReuse,
  targetDamageContract:{path:'contracts/rf-archenemy-hit-assets-v19.json',sha256:sha(readFileSync(resolve(project,'contracts/rf-archenemy-hit-assets-v19.json')))},
  independentReactionProbe:{path:'reports/rf-archenemy-reaction-probe-v19.json',sha256:sha(readFileSync(resolve(project,'reports/rf-archenemy-reaction-probe-v19.json'))),cases:18},
  native:{oldWasm:prior.wasm,newWasm:current.wasm,callbackGroupIds:current.callbackGroupIds,
    capabilityExport:'skills_callback_group_count',retainedMethodCount:70,newMethod:methods.find(r=>r.name==='RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove'),
    compiledFiles},integration:assets.integration,
  rules:{ownedSpears:4,waitingLifetimeSeconds:30,releaseCooldownSeconds:.3,releaseDirSpeed:3000,
    releasedLifetimeSeconds:.35,normalImpactEntries:3,hyperImpactEntries:8,
    reactionType:2,defenderStopTimeSeconds:0,nearGroundStrictHeight:150,
    memoEnabled:false,normalMagicCoefficient:4.48,hyperMagicCoefficient:5.72},
  limits:['No target2016 client combat/GPU/audio-mixer measurement: no1:1 acceptance claim.',
    'The target761-percent descriptor vs normal4.48/Hyper5.72 and old memo/APPLIED_SKILL_ID binding is unresolved; no coefficient replacement.',
    'Original fixed-V5 Hyper state registration drives a cast-frozen host flag; target2016 executable registration is not acquired.',
    'Normal/special/class-system trigger exclusions remain the separately labelled existing target-description adapter.',
    'Full collision target loss/reacquisition and native controller/GPU frame scheduling remain bounded by the previous v12/v17 contracts.',
    'Trace initial positions/preset/awakening orbs are fixture inputs; packets execute real core inputs, not browser DOM/client measurements.']};
write('contracts/rf-archenemy-chain-source-v19.json',contract);
const baselineAudio=baselineRoot?JSON.parse(readFileSync(resolve(baselineRoot,'artifacts/audio/manifest.json'))):null;
const baselineIndexes=baselineRoot?['fx','buff-fx','shadow-weapon-fx','skill-fx-v11','archenemy-fx-v17'].map(p=>JSON.parse(readFileSync(resolve(baselineRoot,'artifacts/rf',p,'index.json')))):[];
const baselineMissing=Object.keys(impactIndex.templates).filter(name=>!baselineIndexes.some(i=>i.templates[name]));
let frozenProduction=null;
if(baselineFrozenRoot){
  const closure=assets.integration.inventory.filter(r=>r.path.startsWith('artifacts/rf/'));
  for(const item of closure){const path=resolve(baselineFrozenRoot,item.path.slice('artifacts/'.length));
    assert.equal(sha(readFileSync(path)),item.sha256,'Original served impact closure changed: '+item.path);}
  const frozenAudio=JSON.parse(readFileSync(resolve(baselineFrozenRoot,'audio/manifest.json')));
  frozenProduction={root:baselineFrozenRoot,fileCount:files(baselineFrozenRoot).length,
    existingImpactClosureFiles:closure.length,existingImpactClosureMatches:true,
    releaseSoundAvailable:!!frozenAudio.files[assets.releaseSound.file],
    releaseSoundFileExists:existsSync(resolve(baselineFrozenRoot,'audio',assets.releaseSound.file))};
}
write('reports/rf-archenemy-chain-observations-v19.json',{schemaVersion:1,targetClientMeasured:false,runs,
  baseline:baselineRoot?{root:baselineRoot,skillsModule:JSON.parse(readFileSync(resolve(baselineRoot,'artifacts/native/manifest.json'))).modules.skills,
    coreSha256:sha(readFileSync(resolve(baselineRoot,'packages/combat-core/index.mjs'))),
    missingImpactTemplates:baselineMissing,releaseSoundAvailable:!!baselineAudio.files['Raven_OT_SP2_FlyingImpact3.ogg']}:null,
  frozenProduction,
  productionAssetDelta:1,tests:{newNodeCases:30,independentPythonExtraction:4,cppReactionCases:18,
    originalClientMeasurements:0,gpuVisualAcceptance:false,audioListeningAcceptance:false},limits:contract.limits});
console.log(JSON.stringify({runs:runs.length,compiledFiles:compiledFiles.length,addedProductionFiles:1,
  newSkills:current.wasm,baselineMissingImpactTemplates:baselineMissing}));
