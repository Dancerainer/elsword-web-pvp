/** Full actual production casts; measurements are web simulation evidence.
 * The target declarations and pinned-source literal are preserved separately.
 * No cast is injected into a recovery state and no renderer is required.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcProductionFixture} from '../../tests/helpers/vc-production-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const root=new URL('../../',import.meta.url),dt=1/60;
const read=p=>readFileSync(new URL(p,root));
const profile=JSON.parse(read('packages/combat-core/vc-profile.json'));
const sha=p=>createHash('sha256').update(read(p)).digest('hex');
const supported=profile.skillCatalog.filter(s=>s.supported&&!s.passive&&s.skillId!==900);
const heatSkills=new Set([24031,24034,24020,24021,24022,24023,24024]);
const free=new Set(['RSI_WAIT','RSI_WALK','RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_JUMP_LANDING']);
const rows=[];
for(const skill of supported)for(const hot of[false,...(heatSkills.has(skill.skillId)?[true]:[])])for(const facing of[-1,1]){
  const variants=skill.skillId===24217?['base','Z','X']:['base',...([24218,24221].includes(skill.skillId)?['air']:[])];
  for(const variant of variants){
    const nextSkill=skill.skillId===24218?24221:24218;
    const f=vcProductionFixture({actor:{facing,position:[-700*facing,3080,0]},preset:{loadout:[{skillId:skill.skillId},{skillId:nextSkill},...Array(6).fill(null)]}});
    const {sim,a}=f,buffer=createInputBuffer({sampledLevels:true});
    const air=skill.skillId===24031||variant==='air',start=air?5:0;
    const events=[],states=[],observed=[];let started=false,ended=false,followSent=false,followSucceeded=false;
    for(let i=0;i<1100;i++){
      const time=sim.state.time+.001;
      if(air&&i===0)buffer.down('UP',time);if(air&&i===1)buffer.up('UP',time);
      if(i===start||hot&&i>start&&i<start+220&&(i-start)%2===0)buffer.down('A',time);else buffer.up('A',time);
      if(variant==='Z'||variant==='X'){
        if(i===start+8)buffer.down(variant,time);if(i===start+9)buffer.up(variant,time);
      }
      if(ended&&!followSent){buffer.down('S',time);followSent=true;}
      else if(followSent)buffer.up('S',time);
      sim.step(dt,{vc:buffer.consume(sim.state.time+dt)},{snapshot:false});const es=sim.drainEvents();events.push(...es);
      if(es.some(e=>e.type==='skillStarted'&&e.actorId==='vc'&&e.skillId===skill.skillId))started=true;
      if(es.some(e=>e.type==='skillStarted'&&e.actorId==='vc'&&e.skillId===nextSkill))followSucceeded=true;
      const state=profile.states[a.state],gate=sim.skillAvailability('vc',1);
      if(states.at(-1)!==a.state){states.push(a.state);observed.push({state:a.state,startedAt:sim.state.time,firstAvailable:null,
        targetCancelFields:Object.fromEntries(Object.entries(state.raw).filter(([k])=>k.includes('CANCEL'))),duration:state.clip.durationSeconds});}
      if(started&&!followSent&&gate.available&&!observed.at(-1).firstAvailable)observed.at(-1).firstAvailable={time:sim.state.time,animationTime:a.animationTime,grounded:a.grounded};
      if(started&&i>start+3&&(free.has(a.state)||a.animationStopped&&[24218,24221].includes(skill.skillId)&&variant==='air'))ended=true;
      if(followSent&&i>start+3){if(followSucceeded)break;}
    }
    const heatActivations=events.filter(e=>e.type==='overheatActivated'&&e.actorId==='vc').length;
    rows.push({skillId:skill.skillId,facing,hot,variant,started,ended,followSucceeded,heatActivations,states,observed,
      finalState:a.state,finalHp:a.hp,initialHpMax:a.hpMax});
  }
}
const report={schema:'vc-cancel-audit-v8',evidenceClass:'current-web-simulation-actual-native-runtime',targetClientMeasured:false,
  sourceScope:{target2016:profile.sources.raven,profileSha256:sha('packages/combat-core/vc-profile.json'),
    fixedV5RavenSha256:sha('.cache/native-source-runtime/X2Lib/X2GURaven.cpp'),
    hazeStandLiteral:{threshold:.93,file:'X2Lib/X2GURaven.cpp',lines:[18159,18176],evidenceClass:'fixedV5-source-candidate'},
    airZX66:{threshold:.42,evidenceClass:'user-requested-current-adapter',heightRule:'After an earlyZX66 cancellation, suppress fresh positiveY lifts only in DashJump/airZ/ZX. Full firstZXX/X/skills retain their source motion.'}},
  program:{coreSha256:sha('packages/combat-core/index.mjs'),commandsSha256:sha('packages/combat-core/vc-commands.mjs'),skillCancelsSha256:sha('packages/combat-core/vc-air-skills.mjs')},
  notes:['Zero original2016-client dynamic recordings. Target named fields and fixedV5 literals are different evidence.',
    'Rows observe every full cast before issuing a fresh legal follow-up skill. Observed firstAvailable is current-implementation evidence, not the expected original answer.',
    'Independent threshold expectations and real66/Z/X inputs live in tests/combat/vc-cancel-v8.test.mjs.',
    'Fields absent from target declarations are not assigned guessed early windows. Normal/overheat recovery clips remain distinct.'],
  summary:{skills:supported.length,cases:rows.length,passed:rows.filter(r=>r.started&&r.ended&&r.followSucceeded&&(!r.hot||r.heatActivations>0)).length},rows};
writeFileSync(new URL('reports/vc-cancel-audit-v8.json',root),JSON.stringify(report,null,2)+'\n');
const failures=rows.filter(r=>!r.started||!r.ended||!r.followSucceeded||r.hot&&!r.heatActivations);
console.log(JSON.stringify({summary:report.summary,failures:failures.map(r=>({skillId:r.skillId,hot:r.hot,variant:r.variant,facing:r.facing,started:r.started,ended:r.ended,followSucceeded:r.followSucceeded,heatActivations:r.heatActivations,states:r.states}))}));
if(failures.length)process.exitCode=1;
