import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {elesisCommands,elesisCommandSkillCancelAllowed} from '../../packages/combat-core/elesis-commands.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisSkillEvent} from '../../packages/combat-core/elesis-skills.mjs';
import {GM_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY,ELESIS_SOURCE_AIR_COMMAND_END_LANDING} from '../../packages/combat-core/gm-cancel-data-v35.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/gm-profile.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('../../reports/gm-cancel-audit-v35.json',import.meta.url)));
const empty=()=>Array(8).fill(null),keys=(held=[],pressed=[],extra={})=>({held:new Set(held),pressed:new Set(pressed),pureDoubleLeft:false,pureDoubleRight:false,...extra});
function actor(state,time=0,facing=1){return {id:'gm',professionId:'GM',state,animationTime:time,animationStopped:false,grounded:true,lineId:0,x:0,y:0,z:0,vx:0,vy:0,facing,passiveSpeed:{x:0,y:0,z:0},sourceCommandFlags:0,stats:{moveSpeedMultiplier:1},awakening:{orbs:3,remaining:0}};}
const source=n=>profile.states[n]?.sourceState??n;
function simulation(state,{skillId,facing=1}={}){
 const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},preset:{passives:[],guildPassives:[],loadout:empty()},actors:[{id:'gm',professionId:'GM',team:0,x:0,y:0,facing,loadout:empty()}]});
 const a=sim.actor('gm');sim.enter(a,state,'original-cancel-boundary-test');a.grounded=true;a.lineId=0;a.mp=a.mpMax=300;a.hitStop=a.worldStop=a.inputLock=a.canNotAttackTime=0;
 if(skillId){a.skillId=skillId;a.skillContext={key:'S',level:1,branchId:'none',traitPolicy:null};}
 return {sim,a};
}
// Expected windows come from independently parsed target2016 declarations,
// not from current callback execution or an implementation-generated trace.
test('GM audit covers all states and every supported selectable skill, including no-cancel phases',()=>{
 assert.equal(original.summary.profileStates,192);assert.equal(original.summary.uniqueSourceStates,142);
 assert.equal(original.summary.commandStates,41);assert.equal(original.summary.skillStates,41);
 assert.equal(original.summary.skillCatalogEntries,37);assert.equal(original.summary.supportedSelectableCasts,20);
 assert.equal(original.summary.originalCancelFieldMismatches,0);
 assert.ok(original.inventory.some(r=>r.sourceState==='ESI_HA_SGM_SWORD_OF_RELICS'&&Object.keys(r.originalCancelFields).length===0));
 assert.ok(original.inventory.some(r=>r.sourceState==='ESI_DASH_COMBO_SGM_XX_ATTACK'&&r.originalCancelFields.SKILL_CANCEL_AFTER===999));
});
for(const facing of [-1,1]){
 test(`GM ${facing}: buffered XX down-X survives releasing Down before dispatch`,()=>{
  const a=actor('ESI_COMBO_XX',.2,facing),raw=profile.states[a.state].raw;
  assert.deepEqual(raw.EVENT_PROCESS_TIME2,{'1':.1,'2':.271,'3':.271});
  let r=elesisCommands.runEvent(a,keys(['DOWN'],['X']),profile);assert.equal(r.state,null);assert.equal(r.flags&(1<<2),1<<2);
  a.sourceCommandFlags=r.flags;a.animationTime=.271;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null);assert.equal(r.flags&(1<<2),1<<2);
  a.sourceCommandFlags=r.flags;a.animationTime=.271001;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_COMBO_SGM_XX_DOWN_X_START');assert.equal(r.flags&(1<<2),0);
 });
 test(`GM ${facing}: down-X cannot latch before .1 or at the strict input end .271`,()=>{
  for(const time of [.09999,.271]){const a=actor('ESI_COMBO_XX',time,facing),r=elesisCommands.runEvent(a,keys(['DOWN'],['X']),profile);assert.equal(r.flags&(1<<2),0);}
 });
 test(`GM ${facing}: original down-X loop uses queued fresh X count and returns through END`,()=>{
  const a=actor('ESI_COMBO_SGM_XX_DOWN_X_START',.2,facing);
  for(let i=0;i<8;i++)elesisCommands.runEvent(a,keys([],['X']),profile);
  assert.equal(a.sourceElesisCommand.requestedLoops,4);
  a.animationTime=profile.states[a.state].clip.durationSeconds;
  let r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_COMBO_SGM_XX_DOWN_X_LOOP');
  a.state=r.state;
  for(let i=1;i<=4;i++){a.animationTime=profile.states[a.state].clip.durationSeconds;r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),i<4?'ESI_COMBO_SGM_XX_DOWN_X_LOOP':'ESI_COMBO_SGM_XX_DOWN_X_END');}
 });
 test(`GM ${facing}: 668XXX finishing slash survives walking off an edge until its own end`,()=>{
  const a=actor('ESI_DASH_JUMP_COMBO_SSK_XXX',.2,facing);a.grounded=false;a.lineId=null;
  let r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null,'fixed callback has no immediate drop branch');
  a.animationTime=profile.states[a.state].clip.durationSeconds;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_JUMP_DOWN','finisher ends to airborne fall');
 });
 for(const state of GM_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY)test(`GM ${facing}: ${state} keeps its authored recovery after support disappears`,()=>{
  const a=actor(state,.2,facing);a.grounded=false;a.lineId=null;
  let r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null,'fixed callback has no immediate drop branch');
  a.animationTime=profile.states[a.state].clip.durationSeconds;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_WAIT','fixed callback requests WAIT, whose free movement resolves unsupported footing next packet');
 });
 for(const state of ELESIS_SOURCE_AIR_COMMAND_END_LANDING)test(`GM ${facing}: ${state} waits for its own end before landing`,()=>{
  const a=actor(state,.1,facing);a.grounded=true;
  let r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null,'fixed landing predicate requires animation end as well as support');
  a.animationTime=profile.states[a.state].clip.durationSeconds;
  r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_DASH_JUMP_LANDING');
 });
 test(`GM ${facing}: 668XX landing off-foot displacement uses the original 1.5 line radius`,()=>{
  const a=actor('ESI_DASH_JUMP_COMBO_XX_LANDING',.1,facing);a.grounded=false;a.y=1000;
  const r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_JUMP_DOWN');assert.equal(r.y,1000-profile.referenceSemantics.lineRadius*1.5);
 });
}
for(const row of original.inventory.filter(r=>r.category==='command')){
 const state=row.aliases.find(k=>profile.states[k])??row.sourceState;
 for(const field of ['SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX']){
  const at=row.originalCancelFields[field];if(!Number.isFinite(at)||at<0||at>=row.webAnimationEndThreshold)continue;
  if(/DASH_JUMP|JUMP_ATTACK|ROLLING/.test(row.sourceState))continue; // Their landing/startup callback has separate priority cases.
  for(const facing of [-1,1])test(`GM ${facing}: ${row.sourceState} ${field} strict original ${at}`,()=>{
   for(const [point,time]of [['before',at-.000001],['equal',at],['after',at+.000001]]){
    const a=actor(state,time,facing);
    if(field==='SKILL_CANCEL_AFTER'){assert.equal(elesisCommandSkillCancelAllowed(a,profile.states[state]),point==='after');continue;}
    const k=field==='WALK_CANCEL_AFTER'?keys([facing===1?'LEFT':'RIGHT']):field==='DASH_CANCEL_AFTER'?keys([],[],{pureDoubleRight:true}):keys([],['Z']);
    const r=elesisCommands.runEvent(a,k,profile);
    const expected=field==='WALK_CANCEL_AFTER'?'ESI_WAIT':field==='DASH_CANCEL_AFTER'?'DASH_REQUEST':'ESI_COMBO_Z';
    assert.equal(r.state===null?null:source(r.state),point==='after'?expected:null);
    assert.equal(a.facing,facing,'walk macro does not turn the attack pose');
   }
  });
 }
}
const reviewedSkills=[['ESI_SI_A_SSK_POWER_BREAK',28203],['ESI_SI_A_EL_RUSHING_SWORD',28219],['ESI_SI_A_EL_RUSHING_SWORD_2nd',28219],['ESI_SI_A_EL_RUSHING_SWORD_3rd',28219],['ESI_SI_SA_SSK_SPIRAL_BLAST',28026],['ESI_SI_SA_SSK_VICTORIOUS_SWORD',28008]];
for(const [state,skillId]of reviewedSkills)for(const key of ['Z','X'])test(`GM ${state} fresh ${key} attack cancellation uses its original clock`,()=>{
 const at=profile.states[state].raw.ATTACK_CANCEL_AFTER_EX;
 for(const [point,time]of [['equal',at],['after',at+.000001]]){
  const {sim,a}=simulation(state,{skillId});a.animationTime=time;
  elesisSkillEvent(sim,a,keys([key]));assert.equal(a.state,state,'held attack is not a fresh attack edge');
  elesisSkillEvent(sim,a,keys([], [key]));assert.equal(source(a.state),point==='after'?'ESI_COMBO_'+key:state);
 }
});
test('GM DodgeAndSlash slash has no declared fresh attack gate; do not invent one from a callback macro',()=>{
 const state='ESI_SI_A_EL_DODGE_AND_SLASH_ATTACK_Z';assert.equal(profile.states[state].raw.ATTACK_CANCEL_AFTER_EX,undefined);
 for(const key of ['Z','X']){const {sim,a}=simulation(state,{skillId:28217});a.animationTime=.6;elesisSkillEvent(sim,a,keys([], [key]));assert.equal(a.state,state);}
});
for(const facing of [-1,1])test(`GM ${facing}: complete dispatcher retains WALK priority over a late direction-double`,()=>{
 const {sim,a}=simulation('ESI_SI_A_SSK_POWER_BREAK',{skillId:28203,facing});a.animationTime=.600001;
 const forward=facing===1?'RIGHT':'LEFT',input=keys([forward],[forward],{pureDoubleRight:facing===1,pureDoubleLeft:facing===-1});
 const serial=a.stateSerial;sim.processInput(a,input);if(a.stateSerial===serial)elesisSkillEvent(sim,a,input);
 assert.equal(source(a.state),'ESI_WAIT','generic dispatcher must not preempt the original WALK-before-DASH skill callback');assert.equal(a.facing,facing);
});
test('GM charge/loop phases with no original named windows reject invented jump/drop/skill cancels',()=>{
 for(const [state,id]of [['ESI_A_SGM_DRASTIC_CHARGE_LOOP',28206],['ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_CHARGE',28029],['ESI_SI_SA_SSK_EXTINCTION_CHARGE',28033]]){
  const {sim,a}=simulation(state,{skillId:id});a.animationTime=.04;a.sourceElesisSkills={charge:0,loopTime:.1,loops:0,hit:false,judgmentCharge:0};
  elesisSkillEvent(sim,a,keys(['S','UP','DOWN'],['UP','DOWN']));assert.equal(a.state,state);
 }
});
