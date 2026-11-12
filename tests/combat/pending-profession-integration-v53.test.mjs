/** Simulation regressions for the original pending/apply order and explicit
 * IS product cancellation window. These are not original-client measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {runHistoricalExplicitPost} from '../../packages/combat-core/historical-cancel-post-v53.mjs';
import {sourceCancelProfile} from '../../packages/combat-core/source-cancel-fields-v53.mjs';
import {withSourcePostRequests,requestSourceState,applySourceStateRequest} from '../../packages/combat-core/source-state-requests-v53.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const nativeSkillValues=await instantiateNativeSkillValues(readFileSync(new URL('../../artifacts/native/skill-values.wasm',import.meta.url)));
const map={sceneId:'pending-profession-regression',lines:[{lineId:0,start:[-4000,0,0],end:[4000,0,0]}]};
const keys=(pressed=[])=>({held:new Set(pressed),pressed:new Set(pressed),released:new Set(),edges:[]});
const post=(sim,a,input)=>withSourcePostRequests(sim,a,()=>runHistoricalExplicitPost(sim,a,input),{profile:sourceCancelProfile(a,sim.profileFor(a))});
function make(professionId='IS'){
 const profile=read(`packages/combat-core/${professionId.toLowerCase()}-profile.json`),preset=read(`config/${professionId.toLowerCase()}-preset.json`);
 const sim=createSimulation({profile,map,nativeSkillValues,preset:{...preset,passives:[],guildPassives:[],loadout:[...(professionId==='IS'?[{skillId:21213}]:[null]),...Array(7).fill(null)]},
  actors:[{id:'actor',professionId,team:0,position:[0,0,0],lineId:0,facing:1,passives:[],guildPassives:[]}]});
 sim.drainEvents();return {sim,a:sim.actor('actor'),profile};
}
function exitOnce(sim,a,callback){
 const base=sim.commandsFor.bind(sim);let exits=0;
 sim.commandsFor=actor=>{const original=base(actor);return {runStart:()=>({handled:false}),...original,runEnd:(actor,p)=>{
  if(actor===a&&exits++===0)callback();return original?.runEnd?.(actor,p)??{handled:false};
 }};};return ()=>exits;
}

test('IS shared ZZ keeps the strict .24 skill gate and pays only its successful pending dispatch',()=>{
 const {sim,a}=make();sim.enter(a,'RSI_COMBO_ZZ','test');const before=a.mp;
 a.animationTime=.24;assert.equal(sim.skillAvailability(a.id,0).available,false);
 post(sim,a,keys(['A']));assert.equal(a.sourcePendingState,undefined);assert.equal(a.mp,before);
 a.animationTime=.24001;assert.equal(sim.skillAvailability(a.id,0).available,true);
 post(sim,a,keys(['A']));assert.equal(a.state,'RSI_COMBO_ZZ');assert.equal(a.skillId,null);
 assert.equal(a.sourcePendingState.skill.skillId,21213);assert.ok(a.mp<before);const paid=a.mp,cd=a.cooldowns[21213];
 applySourceStateRequest(sim,a);assert.equal(a.skillId,21213);assert.equal(a.mp,paid);assert.equal(a.cooldowns[21213],cd);
 assert.equal(a.sourcePendingState,undefined);
});

test('IS shared ZZ mature Z and fresh EPT capture both precede the later skill cascade',()=>{
 for(const mature of [false,true]){
  const {sim,a}=make();sim.enter(a,'RSI_COMBO_ZZ','test');a.animationTime=mature?.367:.3;
  a.sourceCommandFlags=mature?2:0;const before=a.mp;
  post(sim,a,keys(mature?['A']:['Z','A']));
  assert.equal(a.mp,before);assert.equal(a.skillId,null);assert.equal(a.cooldowns[21213]??0,0);
  if(mature)assert.equal(a.sourcePendingState.state,'RSI_COMBO_ZZZ');
  else {assert.equal(a.sourcePendingState,undefined);assert.ok(a.sourceCommandFlags&2);}
 }
});

test('source apply normalizes the final exit replacement to sword wait without changing the claimed byte',()=>{
 const {sim,a}=make('LK');sim.prepareWayOfSword(a.id,-2);sim.enter(a,'RSI_COMBO_ZZ','test');
 requestSourceState(sim,a,'RSI_COMBO_X','test-provisional',{clearSkill:true});const claimed=a.sourceStateRequestByte;
 const exits=exitOnce(sim,a,()=>requestSourceState(sim,a,'RSI_WAIT','exit-wait',{clearSkill:true}));
 applySourceStateRequest(sim,a);assert.equal(a.state,'ESSI_SWORD_WAIT');assert.equal(a.animationName,'Wait_W1');
 assert.equal(exits(),1);assert.equal(a.sourceAppliedStateByte,claimed);assert.equal(a.sourceStateRequestByte,(claimed+1)&255);
 assert.equal(a.sourcePendingState.state,'RSI_WAIT');
});

test('fatal final pending redirection clears the restored skill and emits death initialization only once',()=>{
 for(const fatalBeforeExit of [false,true]){
 const {sim,a}=make();sim.enter(a,'RSI_COMBO_ZZ','test');a.animationTime=.3;
 post(sim,a,keys(['A']));assert.equal(a.sourcePendingState.skill.skillId,21213);const paid=a.mp;
 if(fatalBeforeExit)a.hp=0;
 exitOnce(sim,a,()=>{a.hp=0;});applySourceStateRequest(sim,a);
 assert.equal(a.state,'RSI_DIE_FRONT');assert.equal(a.skillId,null);assert.equal(a.skillContext,null);assert.equal(a.skillScale,1);
 assert.equal(a.core.phase,'absent');assert.equal(a.mp,paid);const presentation=a.deathPresentation;
 assert.equal(sim.state.events.filter(e=>e.type==='deathAnimationStarted').length,1);
 requestSourceState(sim,a,'RSI_WAIT','still-fatal',{clearSkill:true});applySourceStateRequest(sim,a);
 assert.equal(a.state,'RSI_DIE_FRONT');assert.equal(a.deathPresentation,presentation);
 assert.equal(sim.state.events.filter(e=>e.type==='deathAnimationStarted').length,1);
 }
});

test('source apply cancels ordered input once against the final destination from exit',()=>{
 for(const finalWait of [true,false]){
  const {sim,a}=make('RF');sim.enter(a,'RSI_COMBO_ZZXX','test');
  a.cancelInput={stage:'pending',commands:['UP','DOWN','Z']};
  requestSourceState(sim,a,finalWait?'RSI_COMBO_X':'RSI_WAIT','test-provisional',{clearSkill:true});
  exitOnce(sim,a,()=>requestSourceState(sim,a,finalWait?'RSI_WAIT':'RSI_COMBO_X','exit-final',{clearSkill:true}));
  applySourceStateRequest(sim,a);
  if(finalWait)assert.deepEqual(a.cancelInput,{stage:'pending',commands:['UP','DOWN','Z']});else assert.equal(a.cancelInput,null);
 }
});
