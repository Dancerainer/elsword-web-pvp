/** Read-only current display-phase evidence; expected motion is not produced here. */
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {vcFixture} from '../../tests/helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {captureActorPresentation,interpolateActorPresentation} from '../../apps/web/actor-render-clock.mjs';
import {createPoseLibrary,sampleLocalTransform,samplePose,compose} from '../assets/character/sample_pose.mjs';
import {feedVcCommandInput} from './vc-command-input-cases-v5.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const posePath='artifacts/vc/source-proof/pose-tracks.json.gz',poseBytes=read(posePath);
const pose=createPoseLibrary(JSON.parse(gunzipSync(poseBytes)));
const isX=a=>a.state.startsWith('RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX');
function inspect(a){
  const root=sampleLocalTransform(pose,a.animationName,a.animationTime,'Bip01');
  const matrices=samplePose(pose,a.animationName,a.animationTime,{rootTranslationOverride:[0,null,0],worldMatrix:compose([a.x,a.y,a.z],[1,1,1],[0,0,0,1])});
  return {state:a.state,animationName:a.animationName,animationTime:a.animationTime,x:a.x,y:a.y,
    localRoot:root.translation,worldBip01Y:matrices.get('Bip01')[13]};
}
const cases=[];
for(const facing of[-1,1]){
  const {sim,a}=vcFixture({position:[facing*-700,3080,0],gap:2500,facing});
  const input=createInputBuffer({sampledLevels:true}),frames=[],boundaries=[];
  for(let frame=0;frame<100;frame++){
    const previous=captureActorPresentation(a),before=isX(previous)?inspect(previous):null;
    feedVcCommandInput(input,sim,a,'airzxx',frame);
    sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});sim.drainEvents();
    if(isX(a)){
      const row={frame,...inspect(a),vx:a.vx,vy:a.vy,animationSpeed:a.animationPlaybackSpeed,
        blend:a.presentationTransition?.enabled,sameState:previous.stateSerial===a.stateSerial};
      if(before){row.worldDeltaY=a.y-previous.y;row.rootDeltaY=row.localRoot[1]-before.localRoot[1];row.bip01DeltaY=row.worldBip01Y-before.worldBip01Y;}
      frames.push(row);
      if(previous.stateSerial!==a.stateSerial)boundaries.push({frame,from:previous.state,to:a.state,before:inspect(previous),
        samples:[0,.25,.5,.75,1].map(alpha=>({alpha,...inspect(interpolateActorPresentation(previous,a,alpha))}))});
    }
  }
  const zxx=frames.filter(r=>r.state.endsWith('ZXX'));
  cases.push({facing,frames,boundaries,summary:{peakBip01Step:zxx.reduce((best,r)=>r.bip01DeltaY>best.bip01DeltaY?r:best,zxx[0]),
    maxSpeedError:Math.max(...frames.map(r=>Math.abs(r.animationSpeed-1.4))),anyBlend:frames.some(r=>r.blend)}});
}
const schedule=JSON.parse(read('contracts/vc-zxx-schedule-source-v5.json'));
const sourcePhase=schedule.cases.filter(r=>r.mode===0&&r.facing===1).map(native=>{
  const current=schedule.cases.find(r=>r.mode===1&&r.facing===1&&r.frame===native.frame);
  const get=r=>({state:['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX'][r.state],
    animationName:['WT_DashJumpComboZX','WT_DashJumpComboZX2'][r.state],animationTime:r.time,x:r.x,y:r.y,z:0});
  const original=inspect(get(native)),immediate=inspect(get(current));
  return {frame:native.frame,source:original,immediate,worldDifference:current.y-native.y,
    rootDifference:immediate.localRoot[1]-original.localRoot[1],bip01Difference:immediate.worldBip01Y-original.worldBip01Y};
});
// Diagnostic only: changing the existing simulation's step is not source/client execution.
const rateSensitivity=[];
for(const hz of[60,75,85]){
  const {sim,a}=vcFixture({position:[0,10000,0],gap:2500});a.grounded=false;a.lineId=null;a.vx=750;a.vy=-100;
  sim.enter(a,'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','step-sensitivity-only');
  const input=createInputBuffer({sampledLevels:true});input.down('X',4/60+.001);input.up('X',5/60+.001);
  let maxX=0,minX=0,maxBip01Step=-Infinity,maxBip01StepTime=null,enteredZxx=null;
  for(let frame=0;frame<hz;frame++){
    const before=inspect(a);sim.step(1/hz,{vc:input.consume(sim.state.time+1/hz)},{snapshot:false});sim.drainEvents();
    const now=inspect(a);maxX=Math.max(maxX,a.x);minX=Math.min(minX,a.x);
    if(a.state.endsWith('ZXX')){
      enteredZxx??=sim.state.time;
      if(now.worldBip01Y-before.worldBip01Y>maxBip01Step){maxBip01Step=now.worldBip01Y-before.worldBip01Y;maxBip01StepTime=a.animationTime;}
    }
  }
  rateSensitivity.push({hz,initial:{x:0,y:10000,vx:750,vy:-100},inputTimes:{xDown:4/60+.001,xUp:5/60+.001},
    enteredZxx,maxX,minX,fullRecoil:maxX-a.x,maxBip01Step,maxBip01StepTime});
}
const report={schema:'vc-zxx-display-phase-v5',evidenceClass:'current-simulation-and-display-adapter-plus-original-key-data',targetClientMeasured:false,
  sourcePose:{path:posePath,sha256:sha(poseBytes)},
  sourceFiles:Object.fromEntries(['.cache/native-source-runtime/X2Lib/X2GUUser.cpp','.cache/native-source-runtime/X2Lib/X2GameUnit.cpp',
    '.cache/native-source-runtime/KTDXLIB/KTDGXSkinAnim.cpp','.cache/native-source-runtime/KTDXLIB/KTDGXSkinAnim.h',
    '.cache/native-source-runtime/KTDXLIB/Always.h','.cache/matrix-source-v18/KTDGObject.h',
    '.cache/clock-source-v16/KTDXLIB/KTDXApp.cpp','.cache/clock-source-v16/X2Lib/X2Main.cpp'].map(p=>[p,sha(read(p))])),
  inputs:Object.fromEntries(['apps/web/actor-render-clock.mjs','packages/combat-core/index.mjs','packages/combat-core/action-animation-speed.mjs'].map(p=>[p,sha(read(p))])),
  boundaries:['Animation keys are independently preserved original conversion keys; full client / GPU / D3DX scheduling are not run.',
    'World Bip01 Y uses source-key hierarchy with consumed XZ; model-scale/body-reform compatibility is separately audited.',
    'Only this reproducible 60Hz physical input prefix and configured animation multiplier 1.4 are sampled.',
    'Source phase comparison uses compiled fixedV5 empty-backlog scheduler rows, not captured target2016 gameplay.'],
  cases,sourcePhase,rateSensitivity,maxBoundedBip01Difference:Math.max(...sourcePhase.map(r=>Math.abs(r.bip01Difference)))};
writeFileSync(new URL('../../reports/vc-zxx-display-phase-v5.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:cases.map(c=>({facing:c.facing,summary:c.summary,
  boundaries:c.boundaries.map(b=>({frame:b.frame,from:b.from,to:b.to,rootSwitchDelta:b.samples.at(-1).localRoot[1]-b.before.localRoot[1],
    interpolationYRange:b.samples.at(-1).y-b.samples[0].y,interpolationXRange:b.samples.at(-1).x-b.samples[0].x}))})),
  rateSensitivity,maxBoundedBip01Difference:report.maxBoundedBip01Difference}));
