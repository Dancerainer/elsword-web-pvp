/** Reproducible device -> fixed packets -> awakening -> expiry simulation.
 * This trace is current implementation evidence, never native ground truth.
 * RF_FULL_SKILLS_FIXTURE_ROOT may select a read-only full asset input tree.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {make,profile} from '../../tests/helpers/rf-passive-fixture-v12.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createInputStepClock} from '../../apps/web/input-step-clock.mjs';

const dt=1/60,out=resolve(process.argv[2]??'artifacts/proof-awakening-core-v18/simulation');
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const options={passives:[24405],positions:[[2022.98,2840,0],[2400,2840,0]],seed:2016};
const sim=await make(options),a=sim.actor('rf');
// Explicit charged, normally awakened fixture; no claim of original client
// bead acquisition. Every subsequent transition uses only recorded inputs.
Object.assign(a.awakening,{orbs:3,remaining:2,full:false});
a.core.gauge=20;sim.updateCoreLevel(a);a.core.phase='idle';a.hp=a.hpMax/2;a.mp=100;sim.drainEvents();
const input=createInputBuffer(),clock=createInputStepClock();clock.rebase(0);
const devices=[{key:'Control',down:true,time:.012},{key:'Control',down:true,time:.015},
  {key:'Control',down:false,time:.018},{key:'RIGHT',down:true,time:2.3},{key:'RIGHT',down:false,time:2.55},
  {key:'UP',down:true,time:3.1},{key:'UP',down:false,time:3.12}];
const initial=sim.snapshot(),packets=[],events=[],deviceResults=[];let next=0,checkpoint,endedStep;
for(let frame=1;frame<6000;frame++){
  const now=frame*dt;
  while(next<devices.length&&devices[next].time<=now){const e=devices[next++];deviceResults.push({...e,accepted:input[e.down?'down':'up'](e.key,e.time)});}
  for(const cutoff of clock.advance(now).cutoffs){
    const packet=input.consume(cutoff),animationBefore=a.animationTime,timeBefore=sim.state.time;
    sim.step(dt,packet,{snapshot:false});const emitted=sim.drainEvents();events.push(...emitted);
    packets.push({cutoff,dt,input:packet,timeBefore,animationBefore,animationAfter:a.animationTime,events:emitted,
      actor:{state:a.state,orbs:a.awakening.orbs,remaining:a.awakening.remaining,full:a.awakening.full,coreGauge:a.core.gauge,coreLevel:a.core.level,corePhase:a.core.phase,hp:a.hp,mp:a.mp}});
    if(packets.length===12)checkpoint={at:packets.length,snapshot:sim.snapshot()};
    if(!endedStep&&emitted.some(e=>e.type==='awakeningEnded'&&e.actorId==='rf'))endedStep=packets.length;
  }
  if(endedStep&&packets.length>=endedStep+120)break;
}
assert.equal(next,devices.length);assert.ok(endedStep,'natural expiry must occur without mutating remaining time');
assert.equal(deviceResults[1].accepted,false,'held repeat must be suppressed');
const start=events.find(e=>e.type==='reawakenCoreRefill'),end=events.find(e=>e.type==='awakeningEnded');
assert.ok(start&&end);assert.equal(start.availableOrbs,3);assert.equal(start.orbs,1);
assert.equal(start.addedSeconds,30*Math.fround(.7));assert.equal(start.coreGauge,60);assert.equal(start.full,true);
assert.equal(end.recalledGauge,60);assert.equal(end.requestedMp,60);assert.ok(end.restoredHp>0&&end.restoredMp>0);
assert.equal(events.filter(e=>e.type==='awakeningEnded').length,1);
const auraIds=events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_RAVEN_HYPER_AURA').map(e=>e.effectId);
assert.ok(auraIds.length);for(const id of auraIds)assert.ok(events.some(e=>e.type==='effectEnded'&&e.effectId===id&&e.reason==='original-stop-effect-set'));
assert.equal(events.filter(e=>e.type==='sound'&&e.name==='Raven_ElectricAura_Disappear.ogg').length,1);
const final=sim.snapshot();
const trace={schema:'rf-awakening-device-trace-v18',purpose:'current-simulation-trace-not-native-ground-truth',targetClientMeasured:false,
  ruleVersions:initial.versions,fixture:{options,description:'3 available beads, normal awakening remaining2 seconds, core20, halfHP/MP100; initial state is a diagnostic fixture'},
  sourceTiming:profile.referenceSemantics.awakening.applyAnimationTime,deviceResults,initial,checkpoint,packets,final};
mkdirSync(out,{recursive:true});const tracePath=resolve(out,'ctrl-reawaken-expiry.json');
writeFileSync(tracePath,JSON.stringify(trace)+'\n');const stored=JSON.parse(readFileSync(tracePath,'utf8'));
const replay=await make(options);replay.restore(stored.initial);
for(const p of stored.packets){replay.step(p.dt,p.input,{snapshot:false});assert.deepEqual(replay.drainEvents(),p.events);}
assert.deepEqual(replay.snapshot(),stored.final);
const continued=await make(options);continued.restore(stored.checkpoint.snapshot);
const reference=await make(options);reference.restore(stored.initial);
for(const p of stored.packets.slice(0,stored.checkpoint.at+120)){
  reference.step(p.dt,p.input,{snapshot:false});reference.drainEvents();
  if(reference.state.step>stored.checkpoint.snapshot.step){continued.step(p.dt,p.input,{snapshot:false});continued.drainEvents();}
}
assert.deepEqual(continued.snapshot(),reference.snapshot());
const result={schema:'rf-awakening-simulation-result-v18',evidenceClass:trace.purpose,targetClientMeasured:false,
  trace:tracePath,traceSha256:digest(readFileSync(tracePath,'utf8')),packetCount:packets.length,endedStep,
  firstActivation:start,expiry:end,auraIdentityCount:auraIds.length,replayFullEqual:true,restoreContinuationSteps:120,restoreContinuationEqual:true,
  finalSha256:digest(stored.final),checkpointSha256:digest(stored.checkpoint.snapshot)};
writeFileSync(resolve(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
