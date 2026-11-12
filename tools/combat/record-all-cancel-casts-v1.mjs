/** Whole real casts from WAIT / jump input. This file records the current
 * simulator, and never supplies an original-client regression oracle. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {captureCancelAuditIdentity} from './cancel-audit-identity.mjs';
import {cancelProfiles,cancelAuditFixture} from '../../tests/helpers/cancel-audit-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const root=resolve(import.meta.dirname,'../..'),dt=1/60,heat=new Set([24031,24034,24020,24021,24022,24023,24024]);
const program=captureCancelAuditIdentity();
const rows=[];
for(const [id,p]of Object.entries(cancelProfiles))for(const skill of p.skillCatalog.filter(s=>s.supported&&s.state&&!s.passive&&s.skillId!==900)){
  const variants=['base',...(id==='VC'&&heat.has(skill.skillId)?['overheat']:[]),
    ...(skill.useCondition===2||id==='VC'&&[24218,24221].includes(skill.skillId)?['air']:[]),
    ...(skill.executor==='ShadowStep'?['Z','X']:[]),...(skill.executor==='MegaSlash'||skill.executor==='WildCharge'?['charge']:[]),
    ...(id==='RS'&&skill.executor==='WindBlade'?['enhanced']:[])];
  for(const variant of variants)for(const facing of[-1,1])for(const awake of[false,true]){
    const air=variant==='air'||skill.useCondition===4;
    const follow=p.skillCatalog.find(s=>s.state&&s.supported&&s.skillId!==skill.skillId&&s.skillId!==900&&s.useCondition===2)??
      p.skillCatalog.find(s=>s.state&&s.supported&&s.skillId!==skill.skillId&&s.skillId!==900&&s.useCondition===1);
    const {sim,a,profile}=cancelAuditFixture(id,{skillId:skill.skillId,followSkillId:follow.skillId,facing,awake,
      preset:variant==='air'&&id==='VC'?{passives:[...p.defaultPassiveSkillIds]}:{}}),buffer=createInputBuffer({sampledLevels:true});
    const start=air?5:0,events=[],states=[],observed=[];let started=false,ended=false,followed=false,sent=false;
    for(let i=0;i<1400;i++){
      const time=sim.state.time+.001;
      if(air&&i===0)buffer.down('UP',time);if(air&&i===1)buffer.up('UP',time);
      const press=i===start||variant==='overheat'&&i>start&&i<start+220&&(i-start)%2===0||variant==='enhanced'&&i===start+8;
      const hold=variant==='charge'&&i>=start&&i<start+180;
      if(press||hold)buffer.down('A',time);else buffer.up('A',time);
      if(['Z','X'].includes(variant)){if(i===start+8)buffer.down(variant,time);if(i===start+9)buffer.up(variant,time);}
      // The successor tests the recovered input gate; refill independently of
      // the spent cast MP so a 300-MP skill is not misreported as a cancel bug.
      if(ended&&!sent){
        a.mp=a.mpMax;
        if((a.grounded?[1,2,5]:[2,4]).includes(follow.useCondition)){buffer.down('S',time);sent=true;}
      }else if(sent)buffer.up('S',time);
      sim.step(dt,{actor:buffer.consume(sim.state.time+dt)},{snapshot:false});const es=sim.drainEvents();events.push(...es);
      if(es.some(e=>e.type==='skillStarted'&&e.actorId==='actor'&&e.skillId===skill.skillId))started=true;
      if(es.some(e=>e.type==='skillStarted'&&e.actorId==='actor'&&e.skillId===follow.skillId))followed=true;
      const d=profile.states[a.state];if(states.at(-1)!==a.state){states.push(a.state);observed.push({state:a.state,at:sim.state.time,
        sourceState:d.sourceState??a.state,cancelFields:Object.fromEntries(Object.entries(d.raw).filter(([k])=>k.includes('CANCEL')))});}
      if(started&&i>start+3&&(a.skillId===null||a.animationStopped&&['FlameSword','HazeExplosion'].includes(skill.executor)&&air))ended=true;
      if(followed)break;
    }
    const activations=events.filter(e=>e.type==='overheatActivated'&&e.actorId==='actor').length;
    rows.push({profession:id,skillId:skill.skillId,executor:skill.executor,variant,facing,awake,started,ended,followed,
      heatActivations:activations,passed:started&&ended&&followed&&(variant!=='overheat'||activations>0),states,observed,finalState:a.state});
    if(rows.length%60===0)console.log(JSON.stringify({completed:rows.length,failures:rows.filter(r=>!r.passed).map(r=>[r.profession,r.skillId,r.variant,r.finalState])}));
  }
}
if(JSON.stringify(program)!==JSON.stringify(captureCancelAuditIdentity()))throw new Error('Program/data/preset changed during cast recording');
const report={schema:'all-profession-cancel-casts-v1',evidenceClass:'current-web-simulation-whole-input-casts',targetClientMeasured:false,
  program,
  summary:{skills:new Set(rows.map(r=>r.profession+':'+r.skillId)).size,cases:rows.length,passed:rows.filter(r=>r.passed).length,
    byProfession:Object.fromEntries(Object.keys(cancelProfiles).map(id=>[id,{skills:new Set(rows.filter(r=>r.profession===id).map(r=>r.skillId)).size,cases:rows.filter(r=>r.profession===id).length,passed:rows.filter(r=>r.profession===id&&r.passed).length}]))},rows};
writeFileSync(resolve(root,'reports/all-profession-cancel-casts-v1.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,failures:rows.filter(r=>!r.passed)}));
if(report.summary.passed!==rows.length)process.exitCode=1;
