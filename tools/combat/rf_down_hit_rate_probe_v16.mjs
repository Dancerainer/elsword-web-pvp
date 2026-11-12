/** Bounded step-size sensitivity; no change to production clock/attack window. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {downHitFixture} from './rf_down_hit_audit_v16.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const deviceEvents=[{key:'DOWN',down:true,time:.0001},{key:'Z',down:true,time:.0501},{key:'Z',down:false,time:.0801}];
const candidateTimes=[.110001,.113,.116,.117,.1191666667,.13];

export async function rateProbe({facing=1,gap=20,attackSpeed=1.3,hz=60}={}){
  if(![60,75,80,85,120,144].includes(hz)||![1,1.3].includes(attackSpeed)||![0,20].includes(gap)||![-1,1].includes(facing))
    throw new TypeError('Invalid bounded rate-sensitivity fixture');
  const f=await downHitFixture({facing,gap,attackSpeed}),{s,a,b}=f,samples=[],packets=[];
  const original=s.checkCharacterAttack.bind(s);let fixedPositionPoseQueries=null;
  s.checkCharacterAttack=(actor,before,after)=>{
    if(actor===a&&actor.state==='RSI_JUMP_COMBO_Z'){
      const raw=s.profile.states[actor.state].raw,shapes=s.collisionSampler(a,{raw}),targets=s.defenderSampler(b);
      const overlap=shapes.some(x=>targets.some(t=>s.hitPoint(x,t)));
      const sample={time:s.state.time,before,animationTime:after,active:after>.11&&after<100,overlap,
        position:[a.x,a.y,a.z],targetPosition:[b.x,b.y,b.z],targetState:b.state,
        priorHit:Object.hasOwn(a.hits,b.id),shapes,targets};
      samples.push(sample);
      if(hz===60&&sample.active&&fixedPositionPoseQueries===null){
        // Query a clone at alternative animation times while preserving this
        // exact packet's physical positions/radii. Never feed these into hits.
        fixedPositionPoseQueries={evidenceClass:'counterfactual-pose-only-sensitivity',time:s.state.time,
          position:[...sample.position],targetPosition:[...sample.targetPosition],
          sourceAnimationTime:after,queries:candidateTimes.map(animationTime=>{
            const query=s.collisionSampler({...a,animationTime},{raw});
            return {animationTime,overlap:query.some(x=>targets.some(t=>s.hitPoint(x,t))),shapes:query};
          })};
      }
    }
    return original(actor,before,after);
  };
  let next=0;const held=new Set();
  for(let i=0;i<hz;i++){
    const cutoff=(i+1)/hz,edges=[];
    while(next<deviceEvents.length&&deviceEvents[next].time<=cutoff+1e-12){
      const edge=deviceEvents[next++];edges.push(edge);
      if(edge.down)held.add(edge.key);else held.delete(edge.key);
    }
    const packet={held:[...held],pressed:edges.filter(e=>e.down).map(e=>e.key),
      released:edges.filter(e=>!e.down).map(e=>e.key),edges};
    packets.push({cutoff,...packet});s.step(1/hz,packet,{snapshot:false});
  }
  const events=s.drainEvents();
  return {facing,gap,attackSpeed,hz,deviceEvents,packets,
    firstActive:samples.find(x=>x.active)??null,activeOverlaps:samples.filter(x=>x.active&&x.overlap).length,
    preActiveOverlaps:samples.filter(x=>!x.active&&x.overlap).length,
    hits:events.filter(x=>x.type==='hit'&&x.actorId===a.id&&x.origin?.kind==='character').map(x=>({time:x.time,amount:x.amount})),
    stateChanges:events.filter(x=>x.actorId===a.id&&x.type==='stateChanged'),fixedPositionPoseQueries,samples};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cases=[];
  for(const facing of [-1,1])for(const gap of [0,20])for(const attackSpeed of [1,1.3])for(const hz of [60,75,80,85,120,144])
    cases.push(await rateProbe({facing,gap,attackSpeed,hz}));
  const paths=['tools/combat/rf_down_hit_rate_probe_v16.mjs','packages/combat-core/index.mjs',
    'packages/combat-assets/index.mjs','packages/combat-core/rf-profile.json','config/rf-preset.json',
    'artifacts/rf/runtime-pose.json','artifacts/scene/sander-garpai-rock-pvp/collision.json','artifacts/native/manifest.json'];
  const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
  const record={schema:'rf-down-hit-rate-sensitivity-v16',evidenceClass:'current-simulation-observations',
    targetClientMeasured:false,originalClientMeasurementCount:0,deviceEvents,inputHashes:hashes,
    method:'Equivalent device timestamps; only public step dt changes. Counterfactual pose queries use clones and never authorize/inject a hit.',
    limits:['Different dt also changes input-consumption cutoffs and Euler physics integration.',
      'Target logical simulation cadence has not been verified; no global clock, damage gate or helper change is justified by this probe.'],cases};
  const path=resolve(root,'artifacts/proof-v16/down-hit-rate-sensitivity.json');
  mkdirSync(resolve(root,'artifacts/proof-v16'),{recursive:true});writeFileSync(path,JSON.stringify(record,null,2)+'\n');
  const summary={...record,cases:cases.map(({samples,packets,firstActive,fixedPositionPoseQueries,...rest})=>({...rest,
    consumedDeviceEdges:packets.filter(p=>p.edges.length).map(p=>({cutoff:p.cutoff,edges:p.edges})),
    firstActive:firstActive?{time:firstActive.time,animationTime:firstActive.animationTime,position:firstActive.position,
      targetPosition:firstActive.targetPosition,overlap:firstActive.overlap}:null,
    fixedPositionPoseQueries:fixedPositionPoseQueries?{...fixedPositionPoseQueries,
      queries:fixedPositionPoseQueries.queries.map(({shapes,...q})=>q)}:null})),
    privateObservation:{path:'artifacts/proof-v16/down-hit-rate-sensitivity.json',bytes:readFileSync(path).length,
      sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}};
  writeFileSync(resolve(root,'reports/rf-down-hit-rate-sensitivity-v16.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({cases:cases.length,byRate:[60,75,80,85,120,144].map(hz=>({hz,
    hitCases:cases.filter(c=>c.hz===hz&&c.hits.length).length,cases:cases.filter(c=>c.hz===hz).length})),
    privateObservation:summary.privateObservation,targetClientMeasured:false}));
}
