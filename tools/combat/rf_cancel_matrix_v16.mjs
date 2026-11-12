/** Full RF cancel inventory and deterministic current-host observations.
 * Source contracts never use these observations as original-client answers.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame,dashZxProfile as profile} from './rf_dash_zx_audit.mjs';
const read=p=>JSON.parse(readFileSync(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const out=resolve(process.argv[2]??'artifacts/proof-input-v16');mkdirSync(out,{recursive:true});
const old=read('reports/rf-all-combo-source-audit-v9.json').rows.filter(r=>r.presentAtBaseline);
assert.equal(old.length,32);
const target=read('.cache/declarations-v11/raven-declarations.json');
const recovery=read('contracts/rf-combo-recovery-source-v11.json');
assert.equal(hash(readFileSync(target.source.path)),target.source.sha256);
const sources=[{path:'.cache/native-source-runtime/X2Lib/X2GURaven.cpp',commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',kind:'fixed-V5-reference-not2016'},
  {path:'.cache/reference-combat-fixes-v11/X2GURaven.cpp',commit:'a1bcdabf39ee1699873b587b40cedefcce61c7f0',kind:'2026-reconstructed-2015-reference-not2016'}]
  .map(s=>({...s,bytes:readFileSync(s.path)}));
for(const [i,s] of sources.entries()){s.sha256=hash(s.bytes);s.text=s.bytes.toString('latin1');
  assert.equal(s.sha256,i===0?'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237':recovery.sourceSha256,'Pinned cancel source bytes');}
function bodyRecord(s,record){
  const {name,startLine,endLine}=record;
  const text=s.text.split('\n').slice(startLine-1,endLine).join('\n'),body=Buffer.from(text,'latin1');
  assert.ok(text.includes('::'+name+'('),'Pinned audited function range '+name);
  return {name,source:s.kind,sourceCommit:s.commit,firstLine:startLine,
    lastLine:endLine,sha256:hash(body),priorContractFunctionSha256:record.sha256,
    byteRangeRule:'inclusive audited source lines; final newline excluded, original CR retained',bytes:body.length,
    inputs:[...new Set(text.match(/m_InputData\.(?:one|pure)\w+/g)??[])],
    branchExpressions:text.split(/\r?\n/).filter(l=>/GetNowAnimationTime|CANCEL_AFTER|CAN_\w+_CANCEL|SKIP_POINT|ELSE_IF_STATE_CHANGE_ON_|StateChange\(/.test(l))
      .map(l=>l.replace(/\/\/.*$/,'').trim()).filter(Boolean),
    compiledBinding:s===sources[0]?'selected-method-only-native-runtime':'selected-XX-recovery-methods-only'};
}
function device(f,record=false){
  const b=createInputBuffer(),inputs=[];
  const step=()=>{const input=b.consume(f.s.state.time+1/60);if(record)inputs.push({dt:1/60,inputs:input});dashZxFrame(f,input);f.s.drainEvents();};
  return {b,inputs,step,tap(k){b.tap(k,f.s.state.time+.001);step();},down(k){b.down(k,f.s.state.time+.001);step();}};
}
const rows=[];
const prompt={WALK_CANCEL_AFTER:'forward',BWALK_CANCEL_AFTER:'back',DASH_CANCEL_AFTER:'double',
  UPDOWN_CANCEL_AFTER:'UP',ATTACK_CANCEL_AFTER:'Z',SKILL_CANCEL_AFTER:'Q'};
for(const base of old){
  const state=base.state,def=profile.states[state],raw=def.raw;
  const fields=Object.fromEntries(Object.entries(raw).filter(([k])=>k.includes('CANCEL')||k.startsWith('EVENT_PROCESS_TIME')));
  const declarations=target.globals[state];
  for(const [k,v] of Object.entries(fields))assert.deepEqual(v,declarations?.[k],`${state}.${k} target declaration`);
  const row={state,input:base.input,targetSourcePc:def.sourcePc,targetFields:fields,clipPeriod:def.clip.durationSeconds,
    target2016Consumer:'not-acquired; do not infer a native binding from a field name',
    sourceMethods:[...base.sourceMethods.map(m=>bodyRecord(sources[0],m)),
      ...recovery.functions.filter(m=>m.name===state+'_EventProcess'||m.name===state+'_FrameMove'||m.name===state+'_FrameMoveFuture').map(m=>bodyRecord(sources[1],m))],
    currentAdapters:[],observations:[],gaps:[]};
  for(const facing of [-1,1]){
    const f=await dashZxFixture({facing,gap:1500});
    // Q is empty in the default internal fixture. Equip a real supported
    // ground/air skill so a missing slot cannot masquerade as a cancel miss.
    f.a.loadout[4]={...f.a.loadout[2]};
    row.nativeEvent=f.n.commands.handlesEvent({state});
    row.nativeFuture=f.n.commands.handlesFuture({state});
    const baseline=f.s.snapshot();
    for(const [field,value] of Object.entries(fields)){
      if(!prompt[field])continue;
      const endAt=def.clip.durationSeconds-Math.max(def.clip.durationSeconds/10,.03);
      if(value<0||value>=endAt){if(facing===-1)row.observations.push({field,value,status:value<0?'negative-disabled-by-source-macro':'point-beyond-native-animation-end',endAt});continue;}
      for(const phase of ['early','equal','late'])for(const held of [false,true]){
        f.s.restore(baseline);f.s.drainEvents();const a=f.a=f.s.actor('rf'),d=device(f);
        const forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
        let key=prompt[field]==='forward'?forward:prompt[field]==='back'?back:prompt[field]==='double'?forward:prompt[field];
        if(prompt[field]==='double'){d.tap(key);d.step();}
        f.s.enter(a,state,'cancel-matrix-injected-state');
        if(/JUMP/.test(state)&&!/LAND/i.test(state)){a.grounded=false;a.lineId=null;a.y+=1000;}
        a.animationTime=phase==='early'?Math.max(0,value-.001):phase==='equal'?value:value+.001;
        a.animationSpeedOverride=0;a.animationSpeedRamp=null;
        const clock=a.animationTime;held?d.b.down(key,f.s.state.time+.001):d.b.tap(key,f.s.state.time+.001);
        const input=d.b.consume(f.s.state.time+1/60);f.s.drainEvents();dashZxFrame(f,input);
        const events=f.s.drainEvents(),after=a.state,nextInput=held?{held:[key]}:{};
        dashZxFrame(f,nextInput);const continuation=a.state;f.s.drainEvents();
        row.observations.push({field,value,facing,phase,held,clock,input,
          after,continuation,reason:events.findLast(e=>e.type==='stateChanged'&&e.actorId==='rf')?.reason??null,
          skillRejection:events.findLast(e=>e.type==='skillRejected'&&e.actorId==='rf')?.reason??null,
          note:events.filter(e=>e.type==='unsupported'&&e.actorId==='rf').map(e=>e.key??e.id??e.message)});
      }
    }
  }
  if(state==='RSI_COMBO_ZZX'){
    row.currentAdapters.push('selected BWALK target .35 + strict fixed macro candidate -> WAIT; native double retains V5 unconditional branch');
    row.gaps.push('target DASH_CANCEL_AFTER=.35 conflicts with acquired V5 unconditional pureDouble; target EventProcess and macro insertion order unknown');
  }
  if(state==='RSI_COMBO_ZZXX'){
    row.currentAdapters.push('existing ordered82 candidate consumes target UPDOWN=.6; fixed Event uses pure-key skip >.7');
    row.gaps.push('target UPDOWN field reader/order absent; remaining raw .6 horizontal/dash points are not automatically added over native callback');
  }
  if(!row.nativeEvent)row.currentAdapters.push('existing JS state-qualified raw cancel/buffer adapter; not a matching target native Event');
  if(row.nativeEvent&&Object.keys(fields).some(k=>k.endsWith('CANCEL_AFTER')))row.gaps.push('native callback owns execution; raw cancel field presence alone does not prove equivalent field consumption');
  if(raw.USE_COMMON_CANCEL_AFTER)row.gaps.push('target USE_COMMON_CANCEL_AFTER consumer unavailable; do not apply every generic field over the original Event');
  if(row.sourceMethods.some(m=>m.source.startsWith('2026')))row.gaps.push('later reconstructed source is independent version reference, not target2016 consumer proof');
  rows.push(row);
}
const traces=[];
async function traceCase(kind,facing,variant){
  const f=await dashZxFixture({facing,gap:1500}),d=device(f,true),initial=f.s.snapshot();f.s.drainEvents();
  const forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  const until=state=>{for(let i=0;i<180&&f.a.state!==state;i++)d.step();assert.equal(f.a.state,state);};
  if(kind==='ZZX6646'){
    d.tap('Z');d.tap('Z');until('RSI_COMBO_ZZ');d.tap('X');until('RSI_COMBO_ZZX');
    d.tap(forward);variant==='held'?d.down(forward):d.tap(forward);assert.equal(f.a.state,'RSI_DASH');
    d.b.up(forward,f.s.state.time+.001);d.b.tap(back,f.s.state.time+.002);d.step();assert.equal(f.a.state,'RSI_DASH_END');
    d.down(forward);assert.equal(f.a.state,'RSI_DASH');d.tap('Z');assert.equal(f.a.state,'RSI_DASH_COMBO_Z');
  }else{
    d.tap(forward);d.down(forward);d.tap('UP');
    for(let i=0;i<(variant==='late'?3:0);i++)d.step();
    d.b.tap('DOWN',f.s.state.time+.001);d.b.up(forward,f.s.state.time+.002);d.b.down(back,f.s.state.time+.003);d.step();
    d.tap('Z');assert.equal(f.a.state,'RSI_JUMP_COMBO_Z');
  }
  for(let i=0;i<120;i++)d.step();
  const trace={schemaVersion:1,purpose:'current-simulation-trace-not-native-ground-truth',
    recordingReason:`v16 CLI device-clock ${kind} facing${facing} ${variant}`,versions:f.s.versions,
    initial:JSON.parse(JSON.stringify(initial)),inputs:d.inputs,final:JSON.parse(JSON.stringify(f.s.snapshot()))};
  const file=`${kind}-${facing}-${variant}.json`,data=JSON.stringify(trace)+'\n';writeFileSync(resolve(out,file),data);
  traces.push({file,sha256:hash(data),bytes:Buffer.byteLength(data),steps:trace.inputs.length});
}
for(const facing of [-1,1])for(const variant of ['tap','held'])await traceCase('ZZX6646',facing,variant);
for(const facing of [-1,1])for(const variant of ['early','late'])await traceCase('66824Z',facing,variant);
const matrix={schema:'rf-all-cancel-matrix-v16',evidenceClass:'source-static-audit + current-simulation-observation',
  targetClientMeasured:false,target2016MeasuredTraceCount:0,m3FidelityAccepted:false,states:rows.length,
  originalSourceProbe:'reports/rf-direction-consumer-source-v16.json',
  fixedSourceInventory:sources.map(({path,commit,kind,sha256,bytes})=>({path,commit,kind,sha256,size:bytes.length})),
  targetDeclaration:{...target.source,readOnlySourceHashChecked:true},
  inputContract:'Edge times are simulation seconds + .001/.002/.003; consume cutoff is next1/60 packet. Repeated same-key presses use existing web per-key adapter; one-frame tap directional-held and stop pending input remain candidates.',
  fixtureContract:'Matrix injects the audited state and freezes its animation clock at before/equal/after authored points, on real Garpai geometry with production samplers/native modules; Q is explicitly equipped with existing ShadowStep24217,20MP,ground/air,CD0. It is a reachability probe, not a legitimate prefix or original trace. Published real prefix traces below do not inject state or change clocks.',
  mainGap:'Initial sampled cache only had X2Main.h. Fixed X2Main.cpp and production clock callers were subsequently acquired under rf-down-hit-rate-source-v16, without proving the target2016 OnePureDouble/CmdEvent/device macro selection. Game OnFrameMove2723 KeyProcess call and User Future/Event/Push/Pop/Now ordering reviewed; JS immediate StateChange remains a host boundary.',
  traces,rows};
writeFileSync('reports/rf-all-cancel-matrix-v16.json',JSON.stringify(matrix,null,2)+'\n');
console.log(JSON.stringify({states:rows.length,probes:rows.reduce((n,r)=>n+r.observations.filter(o=>o.phase).length,0),traces:traces.length,out,targetClientMeasured:false}));
