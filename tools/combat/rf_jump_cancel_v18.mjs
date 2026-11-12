/** Real timestamped keyboard prefixes. Their output is simulation evidence,
 * never an original-client expectation or an instruction to change tick Hz.
 */
import {resolveBaselineCommit} from '../baseline-ref.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {dashZxFixture} from './rf_dash_zx_audit.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function jumpPressEdges({facing=1,wait=8,spacing=16,overlap=false,phase=0}={}){
  const fw=facing===1?'RIGHT':'LEFT',bk=facing===1?'LEFT':'RIGHT';
  const down=.081+wait/60,turn=down+spacing/1000,z=turn+spacing/1000;
  const raw=[[.001,fw,true],[.021,fw,false],[.041,fw,true],[.061,'UP',true],
    [down-.001,'UP',false],[down,'DOWN',true],
    [turn+(overlap?.024:0),fw,false],[turn,bk,true],[z,'Z',true],
    [z+.04,'Z',false],[z+.05,'DOWN',false],[z+.06,bk,false]];
  return raw.map(([time,key,down])=>({time:time+phase,key,down})).sort((a,b)=>a.time-b.time);
}
export async function observeJumpPrefix(options={},factory=null){
  const f=await dashZxFixture({facing:options.facing??1,gap:options.gap??110,presetOverride:options.presetOverride});
  if(factory){f.s=factory({...f.s,seed:2016,actors:[{id:'rf',team:0,position:[0,3080,0],lineId:2,facing:options.facing??1},
    {id:'target',team:1,position:[(options.facing??1)*(options.gap??110),3080,0],lineId:2,facing:-(options.facing??1)}]});f.a=f.s.actor('rf');f.b=f.s.actor('target');}
  const b=createInputBuffer(),edges=jumpPressEdges(options),dt=options.dt??1/60;
  const initial=f.s.snapshot(),inputs=[],packets=[],events=[];let at=0;
  f.s.drainEvents();
  for(let step=1;step<=80;step++){
    const cutoff=step*dt;
    while(at<edges.length&&edges[at].time<=cutoff){const edge=edges[at++];(edge.down?b.down:b.up)(edge.key,edge.time);}
    const input=b.consume(cutoff);inputs.push({dt,inputs:input});
    const packetState=f.a.state;
    f.s.step(dt,input,{snapshot:false});const current=f.s.drainEvents().map(e=>e.type==='hit'?{...e,sourcePacketState:packetState}:e);events.push(...current);
    if(step<35)packets.push({step,cutoff,input,state:f.a.state,facing:f.a.facing,position:[f.a.x,f.a.y,f.a.z],
      grounded:f.a.grounded,velocity:[f.a.vx,f.a.vy],animationTime:f.a.animationTime,
      events:current.filter(e=>['stateChanged','hit','landed','dashJumpForcedDown'].includes(e.type))});
  }
  const summary={options,enteredJumpZ:events.some(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state==='RSI_JUMP_COMBO_Z'),
    states:events.filter(e=>e.type==='stateChanged'&&e.actorId==='rf').map(e=>({time:e.time,state:e.state,reason:e.reason})),
    jumpZHits:events.filter(e=>e.type==='hit'&&e.actorId==='rf'&&e.sourcePacketState==='RSI_JUMP_COMBO_Z'&&e.origin?.kind==='character'),
    hpLost:f.b.stats.hpMax-f.b.hp};
  return {f,summary,trace:{schemaVersion:1,purpose:'current-simulation-device-trace-not-original-client',
    ruleVersions:f.s.versions,initial,edges,inputs,packets,final:f.s.snapshot()}};
}
async function replayAndRestore(trace,options){
  const r=await dashZxFixture({facing:options.facing,gap:110,presetOverride:options.presetOverride});r.s.restore(trace.initial);r.s.drainEvents();
  for(const p of trace.inputs){r.s.step(p.dt,p.inputs,{snapshot:false});r.s.drainEvents();}
  assert.deepEqual(JSON.parse(JSON.stringify(r.s.snapshot())),JSON.parse(JSON.stringify(trace.final)));
  const s=await dashZxFixture({facing:options.facing,gap:110,presetOverride:options.presetOverride});s.s.restore(JSON.parse(JSON.stringify(r.s.snapshot())));
  for(let i=0;i<120;i++){const input=i===3?{pressed:['UP'],held:['UP']}:i===8?{pressed:['Z'],held:['Z']}:{},dt=options.dt??1/60;
    r.s.step(dt,input,{snapshot:false});s.s.step(dt,input,{snapshot:false});r.s.drainEvents();s.s.drainEvents();
    assert.deepEqual(JSON.parse(JSON.stringify(r.s.snapshot())),JSON.parse(JSON.stringify(s.s.snapshot())));}
}
async function main(){
  const out=resolve(root,process.argv[2]??'artifacts/proof-jump-v18/keyboard');mkdirSync(out,{recursive:true});
  const baselineCommit=resolveBaselineCommit(root,process.argv[3]);
  const baselineRoot=resolve(root,'.cache/jump-v18-baseline',baselineCommit);
  const files=execFileSync('git',['ls-tree','-r','--name-only',baselineCommit,'packages','contracts'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of files){const path=resolve(baselineRoot,file);mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,execFileSync('git',['show',`${baselineCommit}:${file}`],{cwd:root,maxBuffer:4*1024*1024}));}
  const {createSimulation:baselineFactory}=await import(pathToFileURL(resolve(baselineRoot,'packages/combat-core/index.mjs')));
  const cases=[];
  for(const facing of [-1,1])for(const wait of [0,4,8])for(const spacing of [0,8,16,24]){
    const options={facing,wait,spacing};
    const current=await observeJumpPrefix(options),baseline=await observeJumpPrefix(options,baselineFactory);
    await replayAndRestore(current.trace,options);
    const file=`66824Z-${facing}-${wait}-${spacing}.json`,bytes=JSON.stringify(current.trace)+'\n';writeFileSync(resolve(out,file),bytes);
    cases.push({...current.summary,baseline:baseline.summary,changed:JSON.stringify(current.summary)!==JSON.stringify(baseline.summary),
      trace:{file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),replay:true,restoredSteps:120}});
  }
  for(const facing of [-1,1])for(const phase of [0,.004,.008,.012]){
    const options={facing,wait:8,spacing:16,overlap:true,phase};
    const current=await observeJumpPrefix(options),baseline=await observeJumpPrefix(options,baselineFactory);
    await replayAndRestore(current.trace,options);
    const file=`66824Z-overlap-${facing}-${phase}.json`,bytes=JSON.stringify(current.trace)+'\n';writeFileSync(resolve(out,file),bytes);
    cases.push({...current.summary,baseline:baseline.summary,changed:JSON.stringify(current.summary)!==JSON.stringify(baseline.summary),
      trace:{file,sha256:sha(bytes),bytes:Buffer.byteLength(bytes),replay:true,restoredSteps:120}});
  }
  const manifest=JSON.parse(readFileSync(resolve(root,'artifacts/native/manifest.json')));
  const result={schema:'rf-jump-cancel-observations-v18',baselineCommit,targetClientMeasured:false,target2016MeasuredTraceCount:0,
    m3FidelityAccepted:false,productionStepChanged:false,inputClockChanged:false,sourceProbe:'reports/rf-jump-consumer-source-v18.json',
    implementationHashes:Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/air-direction.mjs','apps/web/input-buffer.mjs'].map(p=>[p,sha(readFileSync(resolve(root,p)))])),
    nativeManifestSha256:sha(readFileSync(resolve(root,'artifacts/native/manifest.json'))),moduleSeal:manifest.seal?.manifestContentSha256??null,
    note:'All schedules are authored input timing, not native recordings. Results are complete current/baseline simulation observations. Source priority keeps same-packet Z before reverse and lower-floor landing before JumpDown input. Early attacks can enter JumpZ but land before .11 attack point; neither threshold nor helper is widened.',cases};
  writeFileSync(resolve(root,'reports/rf-jump-cancel-observations-v18.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({cases:cases.length,changed:cases.filter(c=>c.changed).length,jumpZHitCases:cases.filter(c=>c.jumpZHits.length).length,
    replayed:cases.length,restoredStepsEach:120,out,targetClientMeasured:false}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
