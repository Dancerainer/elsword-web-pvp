/** Description-based V58 project rule, separately from the unresolved original
 * formed local10 input. Exercise the production command-event admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../packages/combat-core/lp-profile.json' with {type:'json'};
import {addSkillEvent} from '../../packages/combat-core/add-skills.mjs';

function fixture({mp=100,count=3,formed=true,held=true,provider}={}){
 const actor={id:'lp',professionId:'LP',state:'ANSI_SA_APT_PULSE_CANNON_LOOP',skillId:29034,
  animationTime:1,animationStopped:true,sourceAddCombat:{pulseCount:count},skillContext:{key:'Q'},
  sourceAdd:{formation:formed,dp:1000},mp},requests=[],notes=[],events=[];
 const sim={profileFor:()=>profile,skill:()=>profile.skillCatalog.find(s=>s.skillId===29034),
  enter(a,n){requests.push(n);a.state=n;},note(...args){notes.push(args);},emit(...args){events.push(args);},
  ...(provider?{addPulseMaintenanceInput:provider}:{})};
 const input={held:new Set(held?['Q']:[]),pressed:new Set()};
 return {actor,sim,input,requests,notes,events};
}
for(const formed of [false,true])test(`V58 Pulse description pays25MP for one additional held round, formed=${formed}`,()=>{
 const f=fixture({formed});assert.equal(addSkillEvent(f.sim,f.actor,f.input),true);
 assert.deepEqual(f.requests,['ANSI_SA_APT_PULSE_CANNON_LOOP']);assert.equal(f.actor.mp,75);
 assert.equal(f.actor.sourceAdd.dp,1000,'unknown original DP argument is never replaced by a guessed DP debit');
});
test('V58 formed Pulse permits exactly four additional25MP admissions with MP equality',()=>{
 const f=fixture();for(let i=0;i<4;i++)addSkillEvent(f.sim,f.actor,f.input);
 assert.equal(f.requests.length,4);assert.ok(f.requests.every(n=>n==='ANSI_SA_APT_PULSE_CANNON_LOOP'));
 assert.equal(f.actor.sourceAddCombat.pulseCount,7);assert.equal(f.actor.mp,0);assert.equal(f.actor.sourceAdd.dp,1000);
 addSkillEvent(f.sim,f.actor,f.input);assert.equal(f.requests.at(-1),'ANSI_SA_APT_PULSE_CANNON_FINISH');
});
test('formed Pulse does not add a round or erase remaining MP below25',()=>{
 const f=fixture({mp:24.999});addSkillEvent(f.sim,f.actor,f.input);
 assert.deepEqual(f.requests,['ANSI_SA_APT_PULSE_CANNON_FINISH']);assert.equal(f.actor.mp,24.999);assert.equal(f.actor.sourceAdd.dp,1000);
});
test('formed release after mandatory fourth loop stops without an extra payment',()=>{
 const f=fixture({held:false});addSkillEvent(f.sim,f.actor,f.input);
 assert.deepEqual(f.requests,['ANSI_SA_APT_PULSE_CANNON_FINISH']);assert.equal(f.actor.mp,100);
});
test('formed release before fourth completion retains the mandatory source loop without payment',()=>{
 const f=fixture({held:false,count:1});addSkillEvent(f.sim,f.actor,f.input);
 assert.deepEqual(f.requests,['ANSI_SA_APT_PULSE_CANNON_LOOP']);assert.equal(f.actor.mp,100);
});
test('an explicit original formed DP provider remains authoritative and never silently falls back after rejection',()=>{
 const f=fixture({provider:()=>({dpArgument:1000})});addSkillEvent(f.sim,f.actor,f.input);
 assert.deepEqual(f.requests,['ANSI_SA_APT_PULSE_CANNON_FINISH']);assert.equal(f.actor.mp,100);assert.equal(f.actor.sourceAdd.dp,1000);
});
