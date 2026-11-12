import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisCommands,elesisCommandExternalSkillAllowed} from '../../packages/combat-core/elesis-commands.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/gm-profile.json',import.meta.url)));
const empty=()=>Array(8).fill(null);
const keys=(pressed=[],held=[])=>({pressed:new Set(pressed),held:new Set(held),pureDoubleLeft:false,pureDoubleRight:false});
const source=a=>profile.states[a.state].sourceState??a.state;
function fixture(time,{flag=1,state='RSI_COMBO_ZZZ',skillId=28203,facing=1}={}){
 const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},
  preset:{passives:[],guildPassives:[],loadout:[{skillId},...empty().slice(1)]},
  actors:[{id:'gm',professionId:'GM',team:0,x:0,y:0,facing,awakening:{orbs:3}}]});
 const a=sim.actor('gm');sim.enter(a,state,'source-priority-unit-seed');a.animationTime=time;a.grounded=true;a.lineId=0;
 a.sourceCommandFlags=flag;a.mp=a.mpMax=300;a.hitStop=a.worldStop=a.inputLock=a.canNotAttackTime=0;
 return {sim,a};
}
/** Exactly the common input/command order, without advancing physics twice. */
function dispatch(sim,a,input,context={animationBeforeTime:a.animationTime}){
 const serial=a.stateSerial;sim.processInput(a,input,context);
 if(a.stateSerial!==serial)return;
 const r=elesisCommands.runEvent(a,input,profile,context);sim.applyCommandResult(a,r);
 if(r.state==='AWAKEN_REQUEST')sim.tryAwakening(a);
 else if(r.state==='DASH_REQUEST')sim.enter(a,a.grounded?'RSI_DASH':'RSI_DASH_JUMP','source-priority-unit-result');
 else if(r.state)sim.enter(a,r.state,'source-priority-unit-result');
}
function assertAnytimeCast(sim,a){
 const event=sim.state.events.find(e=>e.type==='skillStarted'&&e.actorId===a.id&&e.skillId===28218);
 assert.ok(event,'independent ASUT_ANYTIME enters the real cast dispatcher');assert.equal(event.mpCost,120);assert.equal(a.mp,180);
 assert.deepEqual(a.sourceElesisEndurance,{upgraded:true,skillId:28218,level:1});
 // This small priority fixture intentionally has no native numericModule.
 // Real native Endurance buff arithmetic is tested by elesis-core-v1.
}
// Expectations are fixed EL ComboZZZEventProcess6401 and independent original
// EVENT_PROCESS_TIME0{.133,.528,.528}, SKILL_CANCEL_AFTER=.266 declarations.
for(const facing of [-1,1]){
 test(`GM ${facing}: mature original ZZZZ flag dispatches before an ordinary skill slot`,()=>{
  const {sim,a}=fixture(.528001,{facing});assert.equal(profile.states[a.state].raw.SKILL_CANCEL_AFTER,.266);
  assert.deepEqual(profile.states[a.state].raw.EVENT_PROCESS_TIME0,{'1':.133,'2':.528,'3':.528});
  const before=structuredClone(a),input=keys(['A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);assert.deepEqual(a,before);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_COMBO_ZZZZ');assert.equal(a.skillId,null);
  assert.ok(!sim.state.events.some(e=>e.type==='skillStarted'),'preempted slot never spends MP or starts its cooldown');assert.equal(a.cooldowns[28203]??0,0);
 });
 test(`GM ${facing}: mature original ZZZZ flag dispatches before fresh awakening`,()=>{
  const {sim,a}=fixture(.528001,{facing});dispatch(sim,a,keys(['AWAKEN']));assert.equal(source(a),'ESI_COMBO_ZZZZ');assert.equal(a.awakening.orbs,3);
 });
 test(`GM ${facing}: an old waiting flag at .3 does not block the already-open .266 skill gate`,()=>{
  const {sim,a}=fixture(.3,{facing}),input=keys(['A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),true);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_SI_A_SSK_POWER_BREAK');assert.equal(a.skillId,28203);
 });
 test(`GM ${facing}: an old waiting flag at .3 permits fresh awakening through the named skill macro`,()=>{
  const {sim,a}=fixture(.3,{facing}),input=keys(['AWAKEN']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),true);
  dispatch(sim,a,input);assert.equal(a.state,'RSI_HYPER_MODE');assert.equal(a.awakening.orbs,0);
 });
 test(`GM ${facing}: first Z inside the source window latches before a simultaneous skill`,()=>{
  const {sim,a}=fixture(.3,{flag:0,facing}),input=keys(['Z','A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_COMBO_ZZZ');assert.equal(a.sourceCommandFlags&1,1);assert.equal(a.skillId,null);
 });
 test(`GM ${facing}: first Z inside the source window latches before simultaneous awakening`,()=>{
  const {sim,a}=fixture(.3,{flag:0,facing}),input=keys(['Z','AWAKEN']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_COMBO_ZZZ');assert.equal(a.sourceCommandFlags&1,1);assert.equal(a.awakening.orbs,3);
 });
 test(`GM ${facing}: source state-change threshold .528 remains strict`,()=>{
  const {sim,a}=fixture(.528,{facing}),input=keys(['A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),true);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_SI_A_SSK_POWER_BREAK');
 });
 test(`GM ${facing}: invalid late fresh Z does not invent a command-priority veto`,()=>{
  const {sim,a}=fixture(.6,{flag:0,facing}),input=keys(['Z','A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),true);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_SI_A_SSK_POWER_BREAK');
 });
 test(`GM ${facing}: end branch precedes ordinary skills even when their named gate is open`,()=>{
  const {sim,a}=fixture(1.3,{flag:0,facing}),input=keys(['A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);
  dispatch(sim,a,input);assert.equal(source(a),'ESI_WAIT');assert.equal(a.cooldowns[28203]??0,0);
 });
 test(`GM ${facing}: independent ANYTIME Endurance survives a mature ordinary command branch`,()=>{
  const {sim,a}=fixture(.528001,{facing,skillId:28218}),input=keys(['A']);assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);
  dispatch(sim,a,input);assertAnytimeCast(sim,a);assert.equal(source(a),'ESI_COMBO_ZZZZ');
 });
 test(`GM ${facing}: independent ANYTIME Endurance does not gain the command skill clock`,()=>{
  const {sim,a}=fixture(.1,{flag:0,facing,skillId:28218});dispatch(sim,a,keys(['A']));assertAnytimeCast(sim,a);assert.equal(source(a),'ESI_COMBO_ZZZ');
 });
}
test('GM repeated source priority probes never consume real flags, increment real spin loops or alias nested memo',()=>{
 const {sim,a}=fixture(.31,{state:'ESI_COMBO_SGM_XX_DOWN_X_LOOP',flag:0});a.sourceElesisCommand={loops:1,requestedLoops:4};
 const before=structuredClone(a),input=keys(['A']);
 for(let i=0;i<5;i++){assert.equal(elesisCommandExternalSkillAllowed(a,input,profile),false);assert.deepEqual(a,before);}
 const r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source({...a,state:r.state}),'ESI_COMBO_SGM_XX_DOWN_X_LOOP');assert.equal(a.sourceElesisCommand.loops,2,'only the single real callback commits one loop');
});
test('GM source priority probe keeps absent timers closed; v45 spin policy opens after original first hit cue',()=>{
 for(const [state,time]of [['ESI_COMBO_X',.2],['ESI_DASH_COMBO_SGM_XX_ATTACK',.3]]){
  const {a}=fixture(time,{state,flag:0});assert.equal(elesisCommandExternalSkillAllowed(a,keys(['A']),profile),false);
 }
 const {a}=fixture(.4,{state:'ESI_DASH_COMBO_SGM_XX_ATTACK',flag:0});
 assert.equal(profile.states[a.state].raw.SKILL_CANCEL_AFTER,999,'frozen source stays separate from user feedback12');
 assert.equal(elesisCommandExternalSkillAllowed(a,keys(['A']),profile),true);
});
