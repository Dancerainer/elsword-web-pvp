/** Every named cancellation field, grouped by identical target action rows.
 * These isolated input probes are current implementation observations only. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cancelAuditFixture} from '../../tests/helpers/cancel-audit-fixture.mjs';
import {captureCancelAuditIdentity} from './cancel-audit-identity.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p)));
const source=read('contracts/all-profession-cancel-source-v1.json'),casts=read('reports/all-profession-cancel-casts-v1.json');
const program=captureCancelAuditIdentity();
const ids=['RF','LK','VC','RS','BM','IS'],fixtures=Object.fromEntries(ids.map(id=>[id,cancelAuditFixture(id)]));
const frozen=Object.fromEntries(ids.map(id=>[id,fixtures[id].sim.snapshot()]));
const fields=['WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX','SKILL_CANCEL_AFTER','SKILL_CANCEL_AFTER_FLY','UPDOWN_CANCEL_AFTER'];
const rows=[];
for(const g of source.groups.filter(g=>g.kind==='command'||g.kind==='skill-or-passive')){
  for(const id of g.professions){
    const f=fixtures[id],sim=f.sim,p=f.profile,state=g.states.find(s=>s.profession===id).state;
    const cast=casts.rows.find(r=>r.profession===id&&r.observed.some(d=>d.sourceState===g.sourceState));
    const skillId=cast?.skillId??p.skillCatalog.find(s=>s.state===g.sourceState)?.skillId;
    const air=/FLY|_AIR|JUMP_COMBO|JUMP_ATTACK|DASH_JUMP|DASHJUMP/.test(g.sourceState)&&!/LANDING|Landing/.test(g.sourceState)&&
      !['RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZZ','ESSI_EIS_DASHJUMP_COMBO_XXX'].includes(g.sourceState);
    const observed=[];
    for(const field of fields)if(Object.hasOwn(g.fields,field)){
      const at=g.fields[field],calls=g.consumers.flatMap(c=>c.calls).filter(c=>c.field===field);
      if(!Number.isFinite(at)||at<0||at>=g.duration*.9){observed.push({field,at,status:at<0?'disabled':'at-or-after-animation-end',sourceCalls:calls.map(c=>c.macro)});continue;}
      for(const point of['before','equal','after']){
        sim.restore(frozen[id]);const a=sim.actor('actor');
        const follow=p.skillCatalog.find(s=>s.supported&&s.state&&s.skillId!==skillId&&s.skillId!==900&&(air?[2,4]:[1,2,5]).includes(s.useCondition));
        sim.configureLoadout([follow?{skillId:follow.skillId}:null,...Array(7).fill(null)],'actor');
        a.mp=a.mpMax;a.awakening.orbs=1;
        if(skillId){const skill=sim.skill(skillId,a);a.skillId=skillId;a.skillScale=1;a.skillContext={key:'S',level:skill.maxLevel,branchId:'none',traitPolicy:null,castStep:0};}
        sim.enter(a,state,'cancel-matrix-isolated-probe');a.grounded=!air;a.lineId=air?null:2;a.y=air?3400:3080;
        a.worldStop=0;a.hitStop=0;a.inputLock=0;a.canNotAttackTime=0;a.canNotJumpTime=0;a.animationBeforeTime=a.animationTime=Math.fround(at)+(point==='before'?-.0001:point==='after'?.0001:0);
        let input={sampledDevice:true,held:[],pressed:[]};
        if(field==='WALK_CANCEL_AFTER')input.held=['RIGHT'];
        if(field==='BWALK_CANCEL_AFTER')input.held=['LEFT'];
        if(field==='DASH_CANCEL_AFTER'){input.held=['RIGHT'];input.pureDouble=['RIGHT'];}
        if(field.startsWith('ATTACK_CANCEL')){input.held=['Z'];if(field.endsWith('_EX'))input.pressed=['Z'];}
        if(field.startsWith('SKILL_CANCEL')){input.held=['A'];input.pressed=['A'];}
        if(field==='UPDOWN_CANCEL_AFTER'){input.held=['UP'];input.pressed=['UP'];}
        sim.drainEvents();sim.step(1e-9,{actor:input},{snapshot:false});
        observed.push({field,at,point,status:'observed',sourceCalls:calls.map(c=>c.macro),state:a.state,skillId:a.skillId,grounded:a.grounded,
          transitions:sim.drainEvents().filter(e=>e.actorId==='actor'&&['stateChanged','skillStarted','skillRejected'].includes(e.type)).map(e=>({type:e.type,state:e.state,reason:e.reason,skillId:e.skillId}))});
      }
    }
    rows.push({profession:id,sourceState:g.sourceState,state,kind:g.kind,sourceGroup:g.id,
      evidence:callsEvidence(g),observed});
  }
}
function callsEvidence(g){return g.consumers.length?'target-declaration+fixed-V5-reference':'target-declaration-without-matching-fixed-V5-EventProcess';}
if(JSON.stringify(program)!==JSON.stringify(captureCancelAuditIdentity()))throw new Error('Program/data/preset changed during matrix recording');
const report={schema:'all-profession-cancel-matrix-v1',targetClientMeasured:false,evidenceClass:'current-web-simulation-isolated-input-matrix',
  program,
  summary:{actionRows:rows.length,uniqueTargetActions:new Set(rows.map(r=>r.sourceGroup)).size,observations:rows.reduce((n,r)=>n+r.observed.filter(o=>o.status==='observed').length,0),
    sourceMissingActions:new Set(rows.filter(r=>r.evidence.endsWith('EventProcess')).map(r=>r.sourceGroup)).size},
  boundary:['Before/equal/after records are current execution, not independent original-client answers.',
    'Aliases and common promotions are grouped by exact target row hashes. All professions still get their own executor input probe.',
    'No matching reference callback does not prove a missing target cancel. Target-only fields, sheath release clocks, unsupported common-cancel flags and source literal skips stay distinct.'],rows};
writeFileSync(resolve(root,'reports/all-profession-cancel-matrix-v1.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
