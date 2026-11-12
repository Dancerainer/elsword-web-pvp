/** CA source-bound cancellation adapters; no original-client dynamic gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {elesisCommands,elesisCommandSkillCancelAllowed} from '../../packages/combat-core/elesis-commands.mjs';
import {elesisSkillEvent} from '../../packages/combat-core/elesis-skills.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {evaluateSkillAvailability} from '../../packages/combat-core/skill-availability.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/ca-profile.json',import.meta.url)));
const audit=JSON.parse(readFileSync(new URL('../../reports/ca-cancel-audit-v35.json',import.meta.url)));
const keys=(held=[],pressed=[],extra={})=>({held:new Set(held),pressed:new Set(pressed),pureDoubleLeft:false,pureDoubleRight:false,...extra});
const source=n=>profile.states[n]?.sourceState??n;
function actor(state,time=0,facing=1,grounded=true){return {id:'ca',professionId:'CA',state,animationTime:time,animationStopped:false,grounded,lineId:grounded?0:null,x:0,y:0,z:0,vx:0,vy:0,facing,passiveSpeed:{x:0,y:0,z:0},sourceCommandFlags:0,stats:{moveSpeedMultiplier:1},awakening:{orbs:3,remaining:0}};}
function fixture(state,{skillId,facing=1}={}){
 const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},preset:{passives:[],guildPassives:[],loadout:Array(8).fill(null)},actors:[{id:'ca',professionId:'CA',team:0,x:0,y:0,facing,loadout:Array(8).fill(null)}]});
 const a=sim.actor('ca');sim.enter(a,state,'ca-original-window-regression');a.grounded=true;a.lineId=0;a.mp=a.mpMax=1000;a.hitStop=a.worldStop=a.inputLock=a.canNotAttackTime=0;
 if(skillId){a.skillId=skillId;a.skillContext={key:'S',level:1,branchId:'none',traitPolicy:null};}return{sim,a};
}
test('CA complete original inventory covers every state and all20 supported selectable casts',()=>{
 assert.deepEqual(audit.summary,{profileStates:190,uniqueSourceStates:140,commandStates:47,skillStates:35,skillCatalogEntries:37,supportedSelectableCasts:20,originalCancelFieldMismatches:0});
 assert.equal(audit.inventory.length,140);assert.ok(audit.inventory.every(r=>r.originalDeclarationPresent));
 assert.ok(audit.skills.filter(s=>s.disposition==='supported-cast').every(s=>s.stateCoverage.length));
 assert.deepEqual(audit.inventory.find(r=>r.sourceState==='ESI_COMBO_SDK_ZZZX').originalCancelFields.COMBO_GUIDE,{'1':'Z','2':'ZZZX'});
});
for(const facing of [-1,1]){
 test(`CA ${facing}: ZZZX buffers original native X, not guide-category Z`,()=>{
  const n='ESI_COMBO_SDK_ZZZX',a=actor(n,.2,facing);let r=elesisCommands.runEvent(a,keys([],['Z']),profile);assert.equal(r.flags&1,0);assert.equal(r.state,null);
  r=elesisCommands.runEvent(a,keys([],['X']),profile);assert.equal(r.flags&1,1);a.sourceCommandFlags=r.flags;a.animationTime=.7;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null);a.sourceCommandFlags=r.flags;a.animationTime=.700001;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_COMBO_SDK_ZZZXX');
 });
 test(`CA ${facing}: shared66ZZ window keeps separateX0/Z1 flags andX priority`,()=>{
  for(const [key,flag,next]of [['X',0,'ESI_DASH_COMBO_SCA_ZX_START'],['Z',1,'ESI_DASH_COMBO_SCA_ZZZ_START']]){
   const a=actor('ESI_DASH_COMBO_SCA_ZZ',.1,facing);let r=elesisCommands.runEvent(a,keys([],[key]),profile);assert.equal(r.flags&(1<<flag),1<<flag);a.sourceCommandFlags=r.flags;a.animationTime=.3;
   r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null);a.sourceCommandFlags=r.flags;a.animationTime=.300001;
   assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),next);
  }
  const a=actor('ESI_DASH_COMBO_SCA_ZZ',.300001,facing);a.sourceCommandFlags=3;
  assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),'ESI_DASH_COMBO_SCA_ZX_START');
 });
 test(`CA ${facing}: original2016 668XX retains X beyond the historical.5 field until landing`,()=>{
  const a=actor('ESI_DASH_JUMP_COMBO_SDK_XX',.1,facing,false);let r=elesisCommands.runEvent(a,keys([],['X']),profile);assert.equal(r.state,null);assert.equal(r.flags&1,1);
  a.sourceCommandFlags=r.flags;for(const time of [.5,.500001,1]){a.animationTime=time;assert.equal(elesisCommands.runEvent(a,keys(),profile).state,null);}
  a.animationStopped=true;assert.equal(elesisCommands.runEvent(a,keys(),profile).state,null);a.grounded=true;
  assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),'ESI_DASH_JUMP_COMBO_SDK_XXX');
  // The2026 reconstruction's window remains in the frozen raw audit, while
  // actual event semantics now follow contracts/ca-commands-native-v58.json.
  const z=actor('ESI_DASH_JUMP_COMBO_SDK_XX',.2,facing,false);assert.equal(elesisCommands.runEvent(z,keys([],['Z']),profile).state,null);
 });
 test(`CA ${facing}: sourceSDK chain resolves unsupported footing only at animation end`,()=>{
  for(const n of ['ESI_COMBO_SDK_XX','ESI_COMBO_SDK_XXXXXXX','ESI_DASH_JUMP_COMBO_SDK_XXX']){
   const a=actor(n,.01,facing,false);assert.equal(elesisCommands.runEvent(a,keys(),profile).state,null);
   a.animationTime=profile.states[n].clip.durationSeconds;const r=elesisCommands.runEvent(a,keys(),profile);
   assert.equal(source(r.state),'ESI_JUMP_DOWN');assert.equal(r.y,a.y-profile.referenceSemantics.lineRadius*1.5);
  }
 });
 test(`CA ${facing}: dash66ZZ/ZZZ stopped callback selects original WAIT or LOOP END without early foot query`,()=>{
  for(const n of ['ESI_DASH_COMBO_SCA_ZZ','ESI_DASH_COMBO_SCA_ZZZ_START','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']){
   const a=actor(n,.01,facing,false);assert.equal(elesisCommands.runEvent(a,keys(),profile).state,null);a.animationTime=profile.states[n].clip.durationSeconds;
   a.animationStopped=true;
   assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),n.includes('_LOOP_')?'ESI_DASH_COMBO_SCA_ZZZ_END':'ESI_WAIT');
  }
 });
}
// Expectations below are the original declaration fields in the independent
// audit. Gates that cannot precede the clip's current end are disclosed there,
// rather than converted into invented early cancellation values.
for(const row of audit.inventory.filter(r=>r.category==='command'))for(const[field,at]of Object.entries(row.originalCancelFields)){
 if(!['SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX'].includes(field)||!Number.isFinite(at)||at<0||at>=row.webAnimationEndThreshold)continue;
 const n=row.aliases.includes(row.sourceState)?row.sourceState:row.aliases[0];
 // Dedicated hold and landing consumers have independent cases above/below.
 if(/CHARGE|ZX_LOOP|JUMP_ATTACK|STANDUP|DASH_JUMP_COMBO_SDK_XX$/.test(n))continue;
 for(const facing of [-1,1])test(`CA ${facing}: ${row.sourceState} original ${field}=${at} strict boundary`,()=>{
  for(const[point,time]of [['before',at-.000001],['equal',at],['after',at+.000001]]){
   const a=actor(n,time,facing,!/DASH_JUMP_COMBO/.test(n)||n==='ESI_DASH_JUMP_COMBO_SDK_XXX');
   if(field==='SKILL_CANCEL_AFTER'){assert.equal(elesisCommandSkillCancelAllowed(a,profile.states[n]),point==='after');continue;}
   const k=field==='WALK_CANCEL_AFTER'||field==='BWALK_CANCEL_AFTER'?keys([facing===1?'LEFT':'RIGHT']):field==='DASH_CANCEL_AFTER'?keys([],[],{pureDoubleRight:true}):keys([],['Z']);
   const r=elesisCommands.runEvent(a,k,profile),expected=/WALK/.test(field)?'ESI_WAIT':field==='DASH_CANCEL_AFTER'?'DASH_REQUEST':'ESI_COMBO_Z';
   assert.equal(r.state===null?null:source(r.state),point==='after'?expected:null);assert.equal(a.facing,facing,'walk macro keeps source facing');
  }
 });
}
test('CA all active/SA/HA slot types obey the same original command skill gate',()=>{
 const row=audit.inventory.find(r=>r.sourceState==='ESI_COMBO_SDK_XXXX'),n=row.sourceState,at=row.originalCancelFields.SKILL_CANCEL_AFTER;
 const candidates=[6,14,15,16,13].map(type=>profile.skillCatalog.find(s=>s.type===type&&s.supported&&s.selectable&&!s.passive&&![28201,28218].includes(s.skillId)));
 assert.ok(candidates.every(Boolean));const {a}=fixture(n);
 for(const skill of candidates){a.loadout[0]={skillId:skill.skillId,level:skill.maxLevel,branchId:'none'};
  for(const[point,time]of [['before',at-.000001],['equal',at],['after',at+.000001]]){a.animationTime=time;const available=evaluateSkillAvailability({actor:a,profile,slot:0});assert.equal(available.available,point==='after',JSON.stringify({type:skill.type,id:skill.skillId,point,reason:available.reason}));}
 }
});
for(const row of audit.inventory.filter(r=>r.category==='skill')){
 const skillId=row.skillIds.find(id=>profile.skillCatalog.some(s=>s.skillId===id&&s.supported&&s.selectable&&!s.passive));
 if(!skillId)continue;
 const state=row.aliases.includes(row.sourceState)?row.sourceState:row.aliases[0];
 for(const[field,at]of Object.entries(row.originalCancelFields)){
  if(!['SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX'].includes(field)||!Number.isFinite(at)||at<0||at>=row.webAnimationEndThreshold)continue;
  for(const facing of [-1,1])test(`CA skill ${facing}: ${state} original ${field}=${at}`,()=>{
   for(const[point,time]of [['before',at-.000001],['equal',at],['after',at+.000001]]){
    const {sim,a}=fixture(state,{skillId,facing});a.animationTime=time;
    if(field==='SKILL_CANCEL_AFTER'){
     a.loadout[0]={skillId:skillId===28215?28213:28215,level:1,branchId:'none'};
     const query=evaluateSkillAvailability({actor:a,profile,slot:0});assert.equal(query.available,point==='after',JSON.stringify({state,point,reason:query.reason}));continue;
    }
    const input=/WALK/.test(field)?keys([facing===1?'LEFT':'RIGHT']):field==='DASH_CANCEL_AFTER'?keys([],[],{pureDoubleRight:true}):keys([],['Z']);
    elesisSkillEvent(sim,a,input);
    const expected=/WALK/.test(field)?'ESI_WAIT':field==='DASH_CANCEL_AFTER'?'ESI_DASH':'ESI_COMBO_Z';
    assert.equal(source(a.state),point==='after'?expected:row.sourceState,JSON.stringify({state,point,field}));
   }
  });
 }
}
for(const trigger of ['pressed','held'])test(`CA Shade Scratch uses EVENT_PROCESS_TIME0 for ${trigger}X`,()=>{
 for(const[time,expected]of [[.259999,false],[.26,true],[.260001,true],[.8,true]]){
  const {sim,a}=fixture('SI_A_SCA_SHADE_SCRATCH',{skillId:28214});a.animationTime=time;
  elesisSkillEvent(sim,a,trigger==='held'?keys(['X']):keys([],['X']));assert.equal(a.state,expected?'SI_A_SCA_SHADE_SCRATCH_ATTACK':'SI_A_SCA_SHADE_SCRATCH');
 }
});
test('CA skill macro priority retainsWALK beforeDASH when both windows open',()=>{
 const {sim,a}=fixture('SI_A_SCA_SHADE_SCRATCH_ATTACK',{skillId:28214});a.animationTime=.7;
 elesisSkillEvent(sim,a,keys(['LEFT'],[],{pureDoubleRight:true}));assert.equal(source(a.state),'ESI_WAIT');assert.equal(a.facing,1);
});
test('CA Ejection attack ends throughJUMP_LANDING or original1.5radius airborne fall',()=>{
 for(const grounded of [true,false]){const {sim,a}=fixture('SI_SA_SDK_EJECTION_BUSTER_ATTACK',{skillId:28035});a.grounded=grounded;a.lineId=grounded?0:null;a.animationTime=profile.states[a.state].clip.durationSeconds;const y=a.y;
  elesisSkillEvent(sim,a,keys());assert.equal(source(a.state),grounded?'ESI_JUMP_LANDING':'ESI_JUMP_DOWN');if(!grounded)assert.equal(a.y,y-profile.referenceSemantics.lineRadius*1.5);
 }
});
test('CA no original named gates are invented in charge/HA/self-cost loop states',()=>{
 for(const[state,id,held]of [['SI_SA_SDK_EJECTION_BUSTER_CHARGE',28035,['S']],['SI_HA_SCA_FATE_SMASHER',28605,['S']],['SI_SA_SDK_BRANDISH_BREAKER_LOOP',28022,['S']],['SI_SA_SDK_BURNING_PHANTOM_LOOP',28021,['S']]]){
  const {sim,a}=fixture(state,{skillId:id});a.animationTime=.04;a.sourceElesisSkills={charge:0,loopTime:.1,loops:0,hit:false,judgmentCharge:0};a.hp=a.hpMax*.15;
  elesisSkillEvent(sim,a,keys([...held,'UP','DOWN'],['UP','DOWN']));assert.equal(a.state,state);
 }
});
for(const stop of ['hitStop','worldStop'])test(`CA freshX survives ${stop} without advancing original animation gate`,()=>{
 const {sim,a}=fixture('ESI_COMBO_SDK_ZZZX');a.animationTime=Math.fround(.2);a[stop]=.1;
 sim.step(1/60,{ca:{pressed:['X'],held:['X']}},{snapshot:false});assert.equal(a.animationTime,Math.fround(.2));
 for(let i=0;i<12;i++)sim.step(1/60,{}, {snapshot:false});assert.equal(a.sourceCommandFlags&1,1,'first resumed command packet retains fresh input');
});

for(const facing of [-1,1])for(const n of ['ESI_COMBO_SDK_ZZZX','ESI_COMBO_SDK_ZZZXX'])test(`CA ${facing}: original native ${n} resolves lost footing before end and input`,()=>{
 for(const time of [.01,profile.states[n].clip.durationSeconds]){
  const a=actor(n,time,facing,false);a.sourceCommandFlags=1;const r=elesisCommands.runEvent(a,keys([],['X']),profile);
  assert.equal(source(r.state),'ESI_JUMP_DOWN');assert.equal(r.y,a.y-30,'original double32fe9c68 is30, not reconstructed1.5radius');
 }
});
