/** Repeatable source-buffer diagnosis, never an original-client golden trace. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {observeDashZx,dashZxFixture} from './rf_dash_zx_audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=[
  ['.cache/native-source-runtime/X2Lib/X2Data.cpp',[[1533,1542,'GameMajor mesh frame advances before EffectSet frame']]],
  ['.cache/native-source-runtime/X2Lib/X2Game.cpp',[[3020,3033,'unit OnFrameMove'],[3159,3168,'DamageEffect after unit frames; mesh calls commented out']]],
  ['.cache/native-reference/X2Lib/X2EffectSet.cpp',[[65,74,'create/delete/update order'],[1287,1335,'TRACE damage effect SetPos']]],
  ['.cache/native-reference/X2Lib/X2DamageEffect.cpp',[[1864,1888,'reads previously updated live mesh matrix'],[6841,6850,'SetPos delegates position only to mesh']]],
  ['.cache/native-reference/X2Lib/X2DamageManager.cpp',[[1774,1777,'collision reads XSkinAnim attack helper list']]],
  ['.cache/native-source-runtime/KTDXLIB/KTDGXMeshPlayer.cpp',[[366,374,'newborn initialization uses .0001'],[1920,1952,'XSkinAnim matrix position committed during mesh OnFrameMove']]],
  ['.cache/native-source-runtime/KTDXLIB/KTDGXMeshPlayer.h',[[1190,1196,'SetPos writes m_vPos only']]],
];
const sourceFiles=files.map(([path,spans])=>{
  const raw=readFileSync(resolve(root,path)),lines=raw.toString('latin1').split(/(?<=\n)/);
  return {path,bytes:raw.length,sha256:sha(raw),spans:spans.map(([startLine,endLine,meaning])=>{
    const bytes=Buffer.from(lines.slice(startLine-1,endLine).join(''),'latin1');
    return {startLine,endLine,meaning,bytes:bytes.length,sha256:sha(bytes)};
  })};
});
const contract={schema:'rf-trace-mesh-phase-source-v13',referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass:'fixed-V5-source-consumer + target2016 declarations',targetClientMeasured:false,originalClientMeasurementCount:0,
  sourceFiles,unchangedTargetContract:'contracts/rf-dash-zx-source-v12.json',
  implemented:{posedMatrix:'sourcePosedAnchor',pendingMeshPosition:'currentAnchor',
    tracePositionOnly:true,excluded:['TRACE_MATRIX','compiled Archenemy mesh','compiled Shadow mesh']},
  unsupported:['target2016 66Z -> 66ZX callback binding','full target Main and Now/Future update order',
    'full mesh simulation/final-render subframe scheduling','newborn global .0001 and exact create/update phase','target-client near-body helper radius measurement'],
  rule:'Snapshot positions are cached by mesh update; SetPos must never re-pose collision from the newly moved actor in the same damage check.'};
writeFileSync(resolve(root,'contracts/rf-trace-mesh-phase-source-v13.json'),JSON.stringify(contract,null,2)+'\n');
const cases=[];
for(const facing of [-1,1])for(const gap of [0,5,70,80,180,300,400,500,600,800])for(const xDelay of [0,3,12,25])
  cases.push(await observeDashZx({facing,gap,xDelay,position:[0,3080,0],lineId:2,recordFrames:gap===70&&xDelay===3}));
for(const facing of [-1,1])for(const gap of [0,70,180])for(const position of [[2023,2840,0],[1450,2840,0]])
  cases.push(await observeDashZx({facing,gap,xDelay:3,position,lineId:6}));
const f=await dashZxFixture();
const implementationHashes=Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/trace-mesh-phase.mjs',
  'packages/combat-assets/index.mjs','packages/combat-core/rf-profile.json','config/rf-preset.json',
  'artifacts/rf/runtime-pose.json','artifacts/scene/sander-garpai-rock-pvp/collision.json']
  .map(path=>[path,sha(readFileSync(resolve(root,path),'utf8').replace(/\r\n/g,'\n'))]));
const observation={schema:'rf-dash-zx-observations-v13',evidenceClass:'simulation-implementation',targetClientMeasured:false,
  ruleVersions:f.s.versions,implementationHashEncoding:'utf8-normalized-lf',implementationHashes,
  targetClocksUnchanged:{effectStartAnimationTime:.2,damageStartGlobalTime:.15,damageEndGlobalTime:.35},
  warning:'Hit counts diagnose adapter changes, not original-client hit gold or proof of native main-loop equivalence.',cases};
writeFileSync(resolve(root,'reports/rf-dash-zx-observations-v13.json'),JSON.stringify(observation,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,enteredRush:cases.filter(c=>c.enteredRush).length,
  rushHitCases:cases.filter(c=>c.hits.some(h=>h.damage.PHYSIC===3.85)).length,
  touching:cases.filter(c=>c.fixture.gap===70&&c.fixture.xDelay===3&&c.fixture.lineId===2).map(c=>({facing:c.fixture.facing,rushHits:c.hits.filter(h=>h.damage.PHYSIC===3.85).length})),targetClientMeasured:false}));
