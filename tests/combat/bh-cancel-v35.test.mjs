import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisCommands,elesisCommandSkillCancelAllowed} from '../../packages/combat-core/elesis-commands.mjs';
import {elesisSkillEvent} from '../../packages/combat-core/elesis-skills.mjs';
import {BH_SOURCE_FOOT_SUPPORT_STATES,BH_DASH_JUMP_XZ_REATTACK,BH_SKILL_MACRO_ORDER} from '../../packages/combat-core/bh-cancel-data-v35.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/bh-profile.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('../../reports/bh-cancel-audit-v35.json',import.meta.url)));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const empty=()=>Array(8).fill(null);
const keys=(held=[],pressed=[],extra={})=>({held:new Set(held),pressed:new Set(pressed),pureDoubleLeft:false,pureDoubleRight:false,...extra});
const source=state=>profile.states[state]?.sourceState??state;
function actor(state,time=0,facing=1){return {id:'bh',professionId:'BH',state,animationTime:time,animationStopped:false,grounded:true,lineId:0,x:0,y:0,z:0,vx:0,vy:0,facing,passiveSpeed:{x:0,y:0,z:0},sourceCommandFlags:0,sourceElesisCommand:{loops:0,requestedLoops:0},stats:{moveSpeedMultiplier:1},awakening:{orbs:3,remaining:0}};}
function simulation(state,skillId=28220,facing=1){
 const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},preset:{passives:[],guildPassives:[],loadout:empty()},actors:[{id:'bh',professionId:'BH',team:0,x:0,y:0,facing,loadout:empty()}]});
 const a=sim.actor('bh');sim.enter(a,state,'independent-source-cancel-fixture');a.grounded=true;a.lineId=0;a.mp=a.mpMax=300;a.hitStop=a.worldStop=a.inputLock=a.canNotAttackTime=0;
 a.skillId=skillId;a.skillContext={key:'S',level:1,branchId:'none',traitPolicy:null};return {sim,a};
}
test('BH audit covers all current command/skill/recovery states without adding absent timers',()=>{
 assert.deepEqual(original.counts,{profileStates:182,canonicalStates:131,aliases:51,selectableActiveSkills:21,supportedSelectableActiveSkills:20,commandStates:34,activeSkillStates:34,recoveryStates:10,canonicalStatesWithFixedCallback:94,declaredCancelFields:97});
 for(const row of original.inventory)assert.equal(hash(profile.states[row.state].raw),row.targetRawSha256,'independent frozen original declaration '+row.state);
 assert.equal(original.skills.find(s=>s.skillId===900).supported,false);
 assert.equal(original.inventory.filter(r=>r.classifications.jumpCancelField).length,0);
 for(const skill of original.skills)for(const state of skill.states)assert.ok(original.inventory.some(r=>r.state===state),'all active phases covered');
 const alias=profile.states.ESI_DASH_JUMP_COMBO_SPK_XZ_REATTACK,canonical=profile.states.ESI_DASH_JUMP_COMBO_SPK_XZ;
 assert.equal(alias.sourceState,'ESI_DASH_JUMP_COMBO_SPK_XZ');assert.deepEqual(alias.raw,canonical.raw);assert.deepEqual(alias.clip,canonical.clip);
});

// Original ELESIS_KNIGHT numeric fields and independently reviewed macro
// boundaries are the expectation. No tested implementation generates answers.
for(const row of original.inventory.filter(r=>r.kind==='command'&&!/DASH_JUMP|JUMP_ATTACK/.test(r.state))){
 for(const field of ['SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX']){
  const at=row.targetFields[field],end=row.clipDurationSeconds-Math.max(row.clipDurationSeconds/10,.03);
  if(!Number.isFinite(at)||at<0||at>=end)continue;
  for(const facing of [-1,1])test(`BH ${facing} ${row.state} ${field}: original strict boundary ${at}`,()=>{
   for(const [point,time]of [['before',at-.000001],['equal',at],['after',at+.000001]]){
    const a=actor(row.state,time,facing);
    if(field==='SKILL_CANCEL_AFTER'){assert.equal(elesisCommandSkillCancelAllowed(a,profile.states[a.state]),point==='after');continue;}
    const k=field==='WALK_CANCEL_AFTER'?keys([facing===1?'LEFT':'RIGHT']):field==='DASH_CANCEL_AFTER'?keys([],[],{pureDoubleRight:true}):keys([],['Z']);
    const r=elesisCommands.runEvent(a,k,profile),expected=field==='WALK_CANCEL_AFTER'?'ESI_WAIT':field==='DASH_CANCEL_AFTER'?'DASH_REQUEST':'ESI_COMBO_Z';
    assert.equal(r.state===null?null:source(r.state),point==='after'?expected:null);assert.equal(a.facing,facing);
   }
  });
 }
}
for(const facing of [-1,1])for(const state of BH_SOURCE_FOOT_SUPPORT_STATES)test(`BH ${facing} ${state}: disappearing foot support does not erase its callback`,()=>{
 const a=actor(state,.1,facing);a.grounded=false;a.lineId=null;
 const r=elesisCommands.runEvent(a,keys(),profile);assert.equal(r.state,null);assert.equal(r.y,a.y,'no invented immediate -LINE_RADIUS');
});
for(const facing of [-1,1])test(`BH ${facing}: XZ buffered Z still dispatches after leaving a step`,()=>{
 const a=actor('ESI_COMBO_SBH_XZ',.2,facing);a.grounded=false;a.lineId=null;
 assert.deepEqual(profile.states[a.state].raw.EVENT_PROCESS_TIME0,{'1':0,'2':.33,'3':.33});
 let r=elesisCommands.runEvent(a,keys([],['Z']),profile);assert.equal(r.state,null);assert.equal(r.flags&1,1);
 a.sourceCommandFlags=r.flags;a.animationTime=.330001;r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_COMBO_SBH_XZZ');
});
for(const row of original.inventory.filter(r=>r.kind==='active-skill')){
 for(const field of ['DASH_CANCEL_AFTER','WALK_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX']){
  const at=row.targetFields[field],end=row.clipDurationSeconds-Math.max(row.clipDurationSeconds/10,.03);
  if(!Number.isFinite(at)||at<0||at>=end)continue;
  for(const facing of [-1,1])test(`BH ${facing} ${row.state} ${field}: original skill clock ${at}`,()=>{
   for(const [point,time]of [['equal',at],['after',at+.000001]]){
    const {sim,a}=simulation(row.state,row.skillId,facing);a.animationTime=time;
    const k=field==='WALK_CANCEL_AFTER'?keys([facing===1?'LEFT':'RIGHT']):field==='DASH_CANCEL_AFTER'?keys([],[],{pureDoubleRight:true}):keys([],['Z']);
    elesisSkillEvent(sim,a,k);assert.equal(source(a.state),point==='after'?(field==='WALK_CANCEL_AFTER'?'ESI_WAIT':field==='DASH_CANCEL_AFTER'?'ESI_DASH':'ESI_COMBO_Z'):row.state);
    if(field==='WALK_CANCEL_AFTER')assert.equal(a.facing,facing,'source walk cancel does not turn the skill pose');
   }
  });
 }
}
for(const facing of [-1,1])test(`BH ${facing}: Explosive Fist walk macro precedes simultaneous dash and fresh Z`,()=>{
 assert.deepEqual(BH_SKILL_MACRO_ORDER,['SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX']);
 const {sim,a}=simulation('ESI_SI_A_SPK_BIG_BURST',28220,facing);a.animationTime=1.100001;
 elesisSkillEvent(sim,a,keys(['RIGHT'],['Z'],{pureDoubleRight:true}));assert.equal(source(a.state),'ESI_WAIT');assert.equal(a.facing,facing);
});
test('BH empty enhanced skill windows and charge/loop phases do not acquire invented cancellations',()=>{
 for(const row of original.inventory.filter(r=>r.kind==='active-skill'&&!Object.keys(r.targetFields).some(k=>k.includes('CANCEL')))){
  if(row.skillId===900||/DODGE|BLAZING_DANCE|SWORDFIRE|ENDURANCE/.test(row.state))continue; // Explicit phase and landing hosts have separate source ownership.
  const {sim,a}=simulation(row.state,row.skillId);a.animationTime=.02;
  const held=['S','UP','DOWN','LEFT','Z','X']; // Keep the actual Sonic charge key held.
  elesisSkillEvent(sim,a,keys(held,['UP','DOWN'],{pureDoubleRight:true}));assert.equal(a.state,row.state,'absent clock remains closed');
 }
});
test('BH two 668XZ extra Z requests use the same original window and never fabricate a fourth attack',()=>{
 assert.deepEqual(BH_DASH_JUMP_XZ_REATTACK,{sourceState:'ESI_DASH_JUMP_COMBO_SPK_XZ',sourceRuntimeState:'ESI_DASH_JUMP_COMBO_SPK_XZ_REATTACK',additionalAttacks:2,input:'Z',windowField:'EVENT_PROCESS_TIME0'});
 const a=actor('ESI_DASH_JUMP_COMBO_SPK_XZ',.2);a.grounded=false;a.lineId=null;
 elesisCommands.runStart(a,profile);
 for(let i=0;i<3;i++){
  a.animationTime=.2;let r=elesisCommands.runEvent(a,keys([],['Z']),profile);a.sourceCommandFlags=r.flags;
  a.animationTime=.383001;r=elesisCommands.runEvent(a,keys(),profile);a.sourceCommandFlags=r.flags;
  if(i<2){assert.ok(r.state,'source two additional attacks');assert.equal(source(r.state),'ESI_DASH_JUMP_COMBO_SPK_XZ');a.state=r.state;elesisCommands.runStart(a,profile);}
  else assert.equal(r.state,null,'budget of two follow-ups exhausted');
 }
});
test('BH airborne XZ landing and animation end take precedence over an already buffered repeat',()=>{
 for(const repeat of [false,true])for(const landing of [false,true]){
  const state=repeat?'ESI_DASH_JUMP_COMBO_SPK_XZ_REATTACK':'ESI_DASH_JUMP_COMBO_SPK_XZ',a=actor(state,.400001);
  a.sourceElesisCommand.loops=repeat?1:0;a.sourceCommandFlags=1;a.grounded=landing;
  if(!landing)a.animationStopped=true;
  const r=elesisCommands.runEvent(a,keys(),profile);
  assert.equal(source(r.state),landing?'ESI_DASH_JUMP_LANDING':'ESI_JUMP_DOWN');
  assert.equal(a.sourceElesisCommand.loops,repeat?1:0,'terminal frame does not spend a repeat');
 }
});
for(const facing of [-1,1])test(`BH ${facing}: 66XXXZ unsupported footing at its own end requests fall and one radius offset`,()=>{
 const a=actor('ESI_DASH_COMBO_SBH_XXXZ',profile.states.ESI_DASH_COMBO_SBH_XXXZ.clip.durationSeconds,facing);a.grounded=false;a.lineId=null;
 const r=elesisCommands.runEvent(a,keys(),profile);assert.equal(source(r.state),'ESI_JUMP_DOWN');assert.equal(r.y,a.y-profile.referenceSemantics.lineRadius);
});
