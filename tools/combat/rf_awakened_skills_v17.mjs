/** Current keyboard/WASM outputs. Never an original-client oracle. */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {profile} from '../../tests/helpers/rf-passive-fixture-v12.mjs';
import {makeAwakenedSkills,skillsSha256} from '../../tests/helpers/rf-awakened-skills-v17-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createInputStepClock} from '../../apps/web/input-step-clock.mjs';
const dt=1/60,out=resolve(process.argv[2]??'artifacts/proof-awakened-skills-v17/simulation');
mkdirSync(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const rows=[];
for(const skill of profile.skillCatalog.filter(x=>x.topTier&&!x.passive)){
  for(const awakened of [false,true])for(const face of [-1,1]){
    const options={skillId:skill.skillId,positions:face<0?[[2022.98,2840,0],[1858.11,2840,0]]:[[1858.11,2840,0],[2022.98,2840,0]],seed:2016};
    if(skill.skillId===900){
      await assert.rejects(makeAwakenedSkills(options),/Banned skill/);
      rows.push({skillId:900,awakened,face,accepted:false,reason:'same production PvP ban in both modes; no forced cast'});continue;
    }
    const s=await makeAwakenedSkills(options),a=s.actor('rf');a.facing=face;a.awakening.orbs=awakened?1:0;s.drainEvents();
    const initial=s.snapshot(),input=createInputBuffer(),clock=createInputStepClock();clock.rebase(0);
    const castAt=awakened?2.2:.02;
    const devices=[...(awakened?[{key:'Control',down:true,time:.01},{key:'Control',down:false,time:.015}]:[]),
      {key:'A',down:true,time:castAt},{key:'A',down:false,time:castAt+.04}];
    const packets=[],events=[];let next=0,checkpoint,afterRestore;
    for(let frame=1;frame<=Math.ceil((castAt+6)*60);frame++){
      const now=frame*dt;
      while(next<devices.length&&devices[next].time<=now){const d=devices[next++];input[d.down?'down':'up'](d.key,d.time);}
      for(const cutoff of clock.advance(now).cutoffs){
        const packet=input.consume(cutoff);s.step(dt,packet,{snapshot:false});const emitted=s.drainEvents();events.push(...emitted);
        packets.push({cutoff,input:packet,events:emitted,state:a.state,animation:a.animationTime,remaining:a.awakening.remaining});
        if(!checkpoint&&s.state.time>=castAt+.2)checkpoint={at:packets.length,snapshot:s.snapshot()};
        if(checkpoint&&packets.length===checkpoint.at+120)afterRestore=s.snapshot();
      }
    }
    assert.equal(next,devices.length);assert.ok(checkpoint&&afterRestore);
    const cast=events.find(e=>e.type==='skill'&&e.actorId==='rf')??events.find(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.skillId===skill.skillId);
    assert.ok(events.some(e=>e.type==='stateChanged'&&e.actorId==='rf'&&e.state===skill.state),'actual key must reach the target skill state');
    const restored=await makeAwakenedSkills(options);restored.restore(JSON.parse(JSON.stringify(checkpoint.snapshot)));
    for(const p of packets.slice(checkpoint.at,checkpoint.at+120)){restored.step(dt,p.input,{snapshot:false});assert.equal(JSON.stringify(restored.drainEvents()),JSON.stringify(p.events));}
    assert.equal(JSON.stringify(restored.snapshot()),JSON.stringify(afterRestore));
    const trace={schema:'rf-awakened-skill-keyboard-trace-v17',evidenceClass:'current-simulation-not-original-oracle',targetClientMeasured:false,
      options,awakened,face,devices,initial,checkpoint,packets,final:s.snapshot()};
    const filename=`${skill.skillId}-${awakened?'awakened':'normal'}-${face<0?'left':'right'}.json`;
    writeFileSync(resolve(out,filename),JSON.stringify(trace)+'\n');
    rows.push({skillId:skill.skillId,awakened,face,accepted:true,trace:filename,traceSha256:sha(readFileSync(resolve(out,filename))),packetCount:packets.length,
      restoreContinuationSteps:120,restoreContinuationEqual:true,restoreComparison:'serialized JSON; JSON canonicalizes signed zero',
      stateSequence:events.filter(e=>e.type==='stateChanged'&&e.actorId==='rf').map(e=>[e.time,e.state]),
      effects:events.filter(e=>e.type==='effectStarted'&&e.skillId===skill.skillId).map(e=>[e.time,e.name,e.setName]),
      sourceCommands:events.filter(e=>e.type==='originalSkillCommand').map(e=>({time:e.time,name:e.name,hyperMode:e.hyperMode,commandType:e.commandType})),
      hits:events.filter(e=>e.type==='hit'&&e.actorId==='rf'&&e.origin.kind!=='core').map(e=>({time:e.time,amount:e.amount,kind:e.origin.kind,effectName:e.origin.effectName})),
      buffs:events.filter(e=>e.type==='buffApplied').map(e=>({time:e.time,templateId:e.templateId,targetId:e.targetId})),
      unsupported:[...s.state.unsupported,...s.state.actors.flatMap(x=>x.unsupported)]});
  }
  console.log(JSON.stringify({skillId:skill.skillId,scenarios:rows.filter(x=>x.skillId===skill.skillId).length}));
}
const report={schemaVersion:1,evidenceClass:'current-simulation-not-original-oracle',targetClientMeasured:false,skillsSha256,
  highestActiveNodes:20,executedScenarios:rows.filter(x=>x.accepted).length,bannedScenarios:rows.filter(x=>!x.accepted).length,
  fixture:'Garpai adjacent actors; all passives disabled; awake uses device Ctrl then skill A; charged beads are a diagnostic initial fixture',
  rows};
writeFileSync(resolve(out,'matrix.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync('reports/rf-awakened-skills-simulation-v17.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({executedScenarios:report.executedScenarios,bannedScenarios:report.bannedScenarios,matrixSha256:sha(readFileSync(resolve(out,'matrix.json')))}));
