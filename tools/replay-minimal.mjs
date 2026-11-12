import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createExperiment} from '../packages/minimal-runtime/experiment.mjs';
const read=async p=>JSON.parse(await readFile(p));
if(!process.argv[2])throw Error('Usage: node tools/replay-minimal.mjs path/to/export.json');
const trace=await read(resolve(process.argv[2]));
assert.equal(trace.schema,'rf-minimal-experiment-v1');
assert.ok(Array.isArray(trace.frames)&&trace.frames.length<=216000,'Trace frame limit exceeded');
const root=new URL('../artifacts/',import.meta.url),binary=p=>readFile(new URL(p,root)),json=async p=>JSON.parse(await binary(p));
const run=await createExperiment({json,binary,mode:trace.mode});
const canonical=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(run.sim.versions,trace.versions,'Requires original frozen program, data and native versions');
assert.deepEqual(canonical(run.sim.snapshot()),trace.initial,'Unrecognized initial conditions');
for(const e of trace.rawEdges)run.enqueue(e.key,e.down,e.time);
for(const frame of trace.frames){
 const targetAttack=frame.inputs['player-2'].pressed.includes('Z');
 const actual=run.step(frame.time,{targetAttack});
 assert.deepEqual(actual.packet,frame.inputs['player-1'],'Device reconstruction diverged');
}
assert.deepEqual(canonical(run.sim.snapshot()),trace.final,'Complete headless state diverged');
assert.deepEqual(canonical(run.device.snapshot()),trace.deviceFinal,'Device queue/locks diverged');
assert.deepEqual(canonical(run.trace().events),trace.events,'Event sequence diverged');
console.log(JSON.stringify({targetClientMeasured:false,mode:trace.mode,steps:trace.frames.length,rawDeviceReplay:true,completeStateEqual:true,eventSequenceEqual:true}));
