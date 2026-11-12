/** Read-only declaration audit. The extracted source input is separate from
 * production profiles and simulation output; no original client is run. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const option=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--target-cache'))throw new TypeError('--target-cache is required');
const cache=path.resolve(option('--target-cache'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const original=read(path.join(cache,'add-declarations.json'));
if(digest(fs.readFileSync(original.source.path))!==original.source.sha256)throw new TypeError('Target2016 Add source hash changed');
const reference=read('contracts/add-reference-consumers-v1.json');
const component=original.globals.INIT_COMPONENT.USE_DP_BY_NASOD_BARRIER;
const originalState=original.globals.ANSI_DP_BARRIER_ACTIVE;
const fields=['POSSIBLE_NASOD_BARRIER','POSSIBLE_NASOD_BARRIER_BY_UNIT_CLASS'];
const stateRows=Object.entries(original.globals).filter(([,raw])=>raw&&typeof raw==='object'&&fields.some(k=>Object.hasOwn(raw,k)))
  .map(([name,raw])=>({name,fields:Object.fromEntries(fields.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]])),sourcePc:original.locations[name]}));
const profiles={};
for(const id of ['lp','mm','de']){
  const p=read('packages/combat-core/'+id+'-profile.json');
  if(p.components.USE_DP_BY_NASOD_BARRIER!==component)throw new TypeError(id+' barrier cost differs from target');
  if(JSON.stringify(p.states.ANSI_DP_BARRIER_ACTIVE.raw)!==JSON.stringify(originalState))throw new TypeError(id+' barrier state differs from target');
  const states=[...new Set(Object.values(p.states).map(s=>s.sourceState))];
  for(const name of states)for(const key of fields)if(JSON.stringify(p.states[name].raw[key])!==JSON.stringify(original.globals[name][key]))throw new TypeError(id+'/'+name+'/'+key+' differs from target');
  profiles[id]={unitClass:p.target.unitClass,profileSha256:digest(fs.readFileSync('packages/combat-core/'+id+'-profile.json')),
    declarationStates:stateRows.filter(s=>states.includes(s.name)).map(s=>s.name)};
}
const methods=['CommonStateStartFuture','IsPossibleChangeNasodBarrier','NasodBarrierActiveStateStartFuture','NasodBarrierActiveEventProcess','DamageReact'];
const consumers=methods.map(name=>{const row=reference.methods.find(m=>m.method===name);if(!row)throw new TypeError('Missing barrier reference '+name);return row;});
const report={schemaVersion:1,id:'add-barrier-v2',targetClientMeasured:false,targetSource:original.source,rawCharge:component,
  originalState,originalStatePc:original.locations.ANSI_DP_BARRIER_ACTIVE,stateRows,profiles,
  referenceSource:reference.source,referenceConsumers:consumers,
  boundaries:['2016 supplies eligibility fields, class122 restriction, raw DP charge1000 and original barrier action/effect set.',
    'The reaction order and temporary100-percent reduction are qualified fixed-reference consumers; no target executable trajectory is available.',
    'Shared source defence-bypass and additional-attack stages retain their own order. The barrier is not represented as unconditional zero final damage.',
    'The original state is not itself eligible for another barrier. StateStart owns option-aware DP conversion; peer restoration does not repeat StateStart.']};
const destination=process.argv.includes('--report')?option('--report'):'contracts/add-barrier-source-v2.json';
fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({rawCharge:component,stateRows:stateRows.length,careers:Object.keys(profiles)}));
