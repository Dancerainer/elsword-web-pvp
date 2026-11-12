/** Timestamped current-runtime observations, never original-client answers. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {dashZxFixture,dashZxFrame} from './rf_dash_zx_audit.mjs';

export async function observeDoubleCancel({facing=1,overlap=false,gap=1500,stepFrames=1,releaseFrames=6}={}) {
  const f=await dashZxFixture({facing,gap}),b=createInputBuffer(),frames=[],packets=[];
  if(process.env.RF_DOUBLE_CANCEL_BASELINE_MODULE){
    const {Simulation}=await import(process.env.RF_DOUBLE_CANCEL_BASELINE_MODULE);
    Object.setPrototypeOf(f.s,Simulation.prototype);
  }
  const initialSnapshot=JSON.parse(JSON.stringify(f.s.snapshot()));
  const forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  function step(n=1){for(let i=0;i<n;i++){const input=b.consume(f.s.state.time+1/60);packets.push(input);dashZxFrame(f,input);
    frames.push({step:f.s.state.step,time:f.s.state.time,state:f.a.state,facing:f.a.facing,
      animationTime:f.a.animationTime,held:input.held,pressed:input.pressed,released:input.released,position:[f.a.x,f.a.y,f.a.z]});}}
  function edge(key,down,offset=.001){b[down?'down':'up'](key,f.s.state.time+offset);}
  function tap(key){b.tap(key,f.s.state.time+.001);step(stepFrames);}
  function until(state,max=180){let i=0;while(f.a.state!==state&&i++<max)step();if(f.a.state!==state)throw new Error('State not reached: '+state);}
  tap('Z');tap('Z');until('RSI_COMBO_ZZ');tap('X');until('RSI_COMBO_ZZX');
  const xStep=f.s.state.step;
  tap(forward);edge(forward,true);step(stepFrames);
  if(overlap){edge(back,true);step(stepFrames);edge(forward,false);step();edge(forward,true);step(stepFrames);}
  else{edge(forward,false);edge(back,true,.002);step(stepFrames);edge(back,false);edge(forward,true,.002);step(stepFrames);}
  const final6={state:f.a.state,facing:f.a.facing,step:f.s.state.step,held:[...frames.at(-1).held]};
  // Finish the directional gesture, then perform real new ZZ, not a dash-Z endpoint.
  edge(back,false);edge(forward,false);step(releaseFrames);
  tap('Z');const secondZStart=f.a.state;tap('Z');
  let zzReached=false;for(let i=0;i<90;i++){step();if(f.a.state==='RSI_COMBO_ZZ')zzReached=true;}
  const events=f.s.drainEvents();
  return {fixture:{facing,overlap,gap,stepFrames,releaseFrames},ruleVersions:f.s.versions,initialSnapshot,xStep,final6,secondZStart,zzReached,events,
    stateChanges:events.filter(v=>v.actorId==='rf'&&v.type==='stateChanged').map(v=>({step:v.step,time:v.time,state:v.state,reason:v.reason,facing:v.facing})),
    hits:events.filter(v=>v.type==='hit'&&v.actorId==='rf').map(v=>({time:v.time,state:v.state,origin:v.origin,amount:v.amount})),
    frames,packets,snapshot:JSON.parse(JSON.stringify(f.s.snapshot()))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cases=[];for(const facing of [-1,1])for(const overlap of [false,true])for(const stepFrames of [1,2,3])for(const releaseFrames of [0,1,6])for(const gap of [70,1500])
    cases.push(await observeDoubleCancel({facing,overlap,stepFrames,releaseFrames,gap}));
  if(process.argv.includes('--verify-replay'))for(const c of cases){
    const f=await dashZxFixture(c.fixture),g=await dashZxFixture(c.fixture);
    for(const packet of c.packets)dashZxFrame(f,packet);
    assert.deepEqual(JSON.parse(JSON.stringify(f.s.drainEvents())),JSON.parse(JSON.stringify(c.events)));
    assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),c.snapshot);
    g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
    for(let i=0;i<120;i++){dashZxFrame(f,{});dashZxFrame(g,{});
      assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),JSON.parse(JSON.stringify(g.s.snapshot())));}
    c.replay={fullPackets:c.packets.length,fullStateAndEventsIdentical:true,jsonRestorePackets:120};
  }
  const out=process.argv[2]??'artifacts/proof-double-cancel-v18/observations.json';mkdirSync(resolve(out,'..'),{recursive:true});
  writeFileSync(out,JSON.stringify({schema:'rf-double-cancel-observations-v18',evidenceClass:'current-simulation-device-adapter',targetClientMeasured:false,cases},null,2)+'\n');
  console.log(JSON.stringify({out,cases:cases.length,final6Dash:cases.filter(c=>c.final6.state==='RSI_DASH').length,newNormalZZ:cases.filter(c=>c.zzReached).length,
    fullReplays:cases.filter(c=>c.replay?.fullStateAndEventsIdentical).length}));
}
