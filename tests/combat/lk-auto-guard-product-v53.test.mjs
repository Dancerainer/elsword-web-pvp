/** Accepted only-Roll product override.
 * The target197 strict .01->.1 entry gate and post ordering stay sourced.
 * These are current Web regressions, not original-client measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {runHistoricalExplicitPost} from '../../packages/combat-core/historical-cancel-post-v53.mjs';
import {sourcePostSkillDispatch} from '../../packages/combat-core/common-cancel-post-v53.mjs';
import {sourceCancelProfile} from '../../packages/combat-core/source-cancel-fields-v53.mjs';
import {withSourcePostRequests,applySourceStateRequest} from '../../packages/combat-core/source-state-requests-v53.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),f=Math.fround;
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const endSmall='ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL';
function make({mode3=false}={}){
 const profile=read('packages/combat-core/lk-profile.json'),preset=read('config/lk-preset.json');
 // Current LK rows have no condition3. A synthetic condition on the existing
 // no-state skill isolates the recovered base mode3 path; raw rows stay intact.
 if(mode3)profile.skillCatalog.find(s=>s.skillId===21218).useCondition=3;
 const map={sceneId:'lk-guard-product-regression',lines:[{lineId:0,start:[-4000,0,0],end:[4000,0,0]}]};
 const sim=createSimulation({profile,map,nativeSkillValues,preset:{...preset,passives:[],guildPassives:[],
  loadout:[{skillId:21217},{skillId:21009},{skillId:21218},...Array(5).fill(null)]},
  actors:[{id:'lk',professionId:'LK',team:0,position:[0,0,0],lineId:0,facing:1,passives:[],guildPassives:[]}]});
 const a=sim.actor('lk');a.mp=a.mpMax;sim.drainEvents();return {sim,a,profile};
}
function post(sim,a,key){
 const input={held:new Set([key]),pressed:new Set([key]),released:new Set(),edges:[]};
 return withSourcePostRequests(sim,a,()=>{
  assert.equal(runHistoricalExplicitPost(sim,a,input),true);sourcePostSkillDispatch(sim,a,input,3);
 },{profile:sourceCancelProfile(a,sim.profileFor(a))});
}

test('LK only Roll guard applies to ordinary and sourceMode queries, grounded and airborne',()=>{
 const {sim,a,profile}=make({mode3:true});
 assert.equal(profile.skillCatalog.find(s=>s.skillId===21218).useCondition,3,'synthetic condition isolates the independent mode3 entrance');
 for(const state of Object.keys(profile.states).filter(n=>n.startsWith('ESSI_SI_P_ESK_AUTO_GUARD'))){
  for(const grounded of [true,false])for(const time of [.1,.10001,.4]){
   sim.enter(a,state,'test-guard');a.grounded=grounded;a.animationTime=time;
   for(const sourceMode of [null,1,3]){
    const query=slot=>sim.skillAvailability(a.id,slot,{sourceMode});
    assert.equal(query(0).available,grounded&&sourceMode!==3&&(state!==endSmall||time>f(.1)),`${state}/${grounded}/${time}/${sourceMode}`);
    assert.equal(query(1).available,false,'ordinary attack skill must not bypass only Roll');
    assert.equal(query(2).available,false,'mode3 no-state skill must not bypass only Roll');
   }
  }
 }
});

test('LK END_SMALL real keyboard post rejects ordinary and mode3 non-Roll without MP/CD payment',()=>{
 for(const [key,id]of [['S',21009],['D',21218]]){
  const {sim,a}=make({mode3:key==='D'});sim.enter(a,endSmall,'test-guard');a.animationTime=.2;const mp=a.mp;
  sim.step(1/60,{lk:{pressed:[key],held:[key]}},{snapshot:false});
  assert.equal(a.state,endSmall);assert.equal(a.sourcePendingState,undefined);assert.equal(a.skillId,null);assert.equal(a.mp,mp);
  assert.equal(a.cooldowns[id]??0,0);assert.equal(sim.state.events.some(e=>e.type==='skillStarted'),false);
 }
});

test('LK END_SMALL Roll retains the strict normalized gate and actual pending dispatch pays once',()=>{
 const {sim,a,profile}=make();sim.enter(a,endSmall,'test-guard');const mp=a.mp;
 assert.equal(profile.states[endSmall].raw.SKILL_CANCEL_AFTER,.01,'original raw declaration remains intact');
 a.animationTime=.1;post(sim,a,'A');assert.equal(a.sourcePendingState,undefined);assert.equal(a.mp,mp);
 a.animationTime=.10001;
 sim.step(1/60,{lk:{pressed:['A'],held:['A']}},{snapshot:false});
 assert.equal(a.state,endSmall);assert.equal(a.skillId,null);assert.equal(a.sourcePendingState.skill.skillId,21217);
 assert.equal(a.mp,mp-15);assert.equal(a.cooldowns[21217],3);
 applySourceStateRequest(sim,a);assert.equal(a.state,'ESSI_SI_A_ES_ROLLING');assert.equal(a.skillId,21217);
 assert.equal(a.mp,mp-15);assert.equal(a.cooldowns[21217],3);
});

test('LK END_SMALL original main-end still wins and queues WAIT without dispatching a mode3 non-Roll',()=>{
 const {sim,a}=make({mode3:true});sim.enter(a,endSmall,'test-guard');a.animationStopped=true;const mp=a.mp;
 post(sim,a,'D');assert.equal(a.state,endSmall);assert.equal(a.sourcePendingState.state,'RSI_WAIT');
 assert.equal(a.sourcePendingState.skill.skillId,null);assert.equal(a.mp,mp);assert.equal(a.cooldowns[21218]??0,0);
 assert.equal(a.canNotAttackTime,f(.1));applySourceStateRequest(sim,a);assert.equal(a.state,'RSI_WAIT');
});
