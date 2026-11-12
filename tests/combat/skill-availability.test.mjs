import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {evaluateSkillAvailability} from '../../packages/combat-core/skill-availability.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
const fixtureRoot=process.env.RF_SKILL_AVAILABILITY_FIXTURE_ROOT??process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const make=(skillId=24027,branchId='none')=>createSimulation({profile,map,preset:{...preset,
  loadout:[{skillId,branchId},null,null,null,null,null,null,null]},
  actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},
    {id:'target',team:1,position:[1858.11,2840,0],lineId:6,facing:1}]});
const input=key=>({pressed:new Set([key]),held:new Set(),released:new Set()});
const cast=(sim,key='A')=>sim.processInput(sim.actor('rf'),input(key));
const available=sim=>sim.skillAvailability('rf','A');

// Literal target declaration MP/CD and MEMO parameters, not recorded casts.
for(const [id,branch,mp,cd] of [[24027,'none',150,10],[24027,'memo-21',120,10],
  [24025,'memo-17',120,6],[24218,'memo-22',21,7.5],[24026,'memo-13',200,19.5],
  [24217,'memo-18',14,7]])test(`shared query/cast ${id} ${branch}: exact MP threshold and cooldown`,()=>{
  const s=make(id,branch),a=s.actor('rf');a.mp=mp-.001;
  assert.equal(available(s).reason,'insufficient-mp');cast(s);
  assert.equal(a.skillId,null);assert.equal(a.mp,mp-.001);
  a.mp=mp;const query=available(s),before=s.snapshot();
  assert.equal(query.available,true);assert.equal(query.mpCost,mp);assert.equal(query.cooldown,cd);
  assert.deepEqual(s.snapshot(),before,'query does not mutate actor, input, events or RNG');
  cast(s);assert.equal(a.skillId,id);assert.equal(a.mp,0);assert.equal(a.cooldowns[id],cd);
  const event=s.state.events.find(e=>e.type==='skillStarted');
  assert.equal(event.mpCost,mp);assert.equal(event.cooldown,cd);
  assert.deepEqual(event.traitPolicy,query.traitPolicy);
});

test('cooldown and insufficient MP follow the same rejection priority; zero CD releases immediately',()=>{
  const s=make(),a=s.actor('rf');a.cooldowns[24027]=.01;a.mp=149;
  assert.equal(available(s).reason,'insufficient-mp');cast(s);
  assert.equal(s.state.events.at(-1).reason,'insufficient-mp');
  a.mp=150;assert.equal(available(s).reason,'cooldown');cast(s);
  assert.equal(s.state.events.at(-1).reason,'cooldown');
  a.cooldowns[24027]=0;assert.equal(available(s).available,true);
});

test('RF ground-only Flame Sword remains unavailable in air; Guardian Strike accepts both',()=>{
  for(const [id,airAllowed] of [[24218,false],[24006,true]]){
    const s=make(id),a=s.actor('rf');assert.equal(available(s).available,true);
    s.enter(a,'RSI_JUMP_UP','availability-fixture');a.grounded=false;
    assert.equal(available(s).available,airAllowed);cast(s);
    assert.equal(a.skillId,airAllowed?id:null);
    if(!airAllowed)assert.equal(s.state.events.find(e=>e.type==='skillRejected').reason,'state-or-ground-condition');
  }
});

test('strict source dash-Z .9 and enabled parry macro .3 boundaries match the keyboard consumer',()=>{
  for(const [state,threshold] of [['RSI_DASH_COMBO_Z',.9],['RSI_PARRYING',.3],['RSI_PARRYING_SMALL',.3]]){
    const s=make(),a=s.actor('rf');s.enter(a,state,'availability-fixture');
    a.animationTime=threshold-.0001;assert.equal(available(s).available,false);cast(s);assert.equal(a.skillId,null);
    a.animationTime=threshold;
    // GUUser.h SKILL_CANCEL_AFTER uses strict binary32 >. The enabled
    // SKILL_CANCEL_BY_HYPER_MODE branch applies to Parry as well.
    assert.equal(available(s).available,false);a.animationTime=threshold+.0001;
    assert.equal(available(s).available,true);cast(s);assert.equal(a.skillId,24027);
  }
});

test('forced landing uses the existing inclusive period/6 lock, and pending ground/drop transitions reject casting',()=>{
  const s=make(),a=s.actor('rf');s.enter(a,'RSI_DASH_JUMP_POWER_LANDING','availability-fixture');
  const threshold=profile.states.RSI_DASH_JUMP_POWER_LANDING.clip.durationSeconds/6;
  a.animationTime=threshold;assert.equal(available(s).available,false);cast(s);assert.equal(a.skillId,null);
  a.animationTime=threshold+.0001;assert.equal(available(s).available,true);
  for(const state of ['RSI_JUMP_DOWN','RSI_DASH_JUMP']){
    s.enter(a,state,'availability-fixture');a.grounded=true;assert.equal(available(s).available,false);
  }
  s.enter(a,'RSI_WAIT','availability-fixture');a.grounded=false;assert.equal(available(s).available,false);
});

test('death, stun input-block, input lock and frozen time reject without consuming keyboard edges',()=>{
  for(const [fields,reason] of [[{hp:0},'dead'],[{inputLock:.1},'input-blocked'],
    [{buffControls:{inputBlock:true}},'input-blocked'],[{hitStop:.1},'time-stopped'],[{worldStop:.1},'time-stopped']]){
    const s=make(),a=s.actor('rf');Object.assign(a,fields);const keys=input('A'),before=s.snapshot();
    assert.equal(available(s).reason,reason);assert.deepEqual(s.snapshot(),before);
    s.processInput(a,keys);assert.equal(a.skillId,null);assert.equal(keys.pressed.has('A'),true);
    assert.equal(a.mp,before.actors[0].mp);assert.equal(s.state.events.filter(e=>e.type==='skillStarted').length,0);
  }
  const s=make(),a=s.actor('rf');a.hitStop=2/60;
  s.step(1/60,{pressed:['A']},{snapshot:false});assert.ok(a.pendingPressed.includes('A'));
  s.step(1/60,{}, {snapshot:false});s.step(1/60,{}, {snapshot:false});
  assert.equal(a.skillId,24027,'display state does not disable pre-input buffering');
});

test('PvP-disabled stale slot cannot cast; empty slots are explicit',()=>{
  const s=make(),a=s.actor('rf');a.loadout[0]={skillId:900,branchId:'none',level:2};
  assert.equal(available(s).reason,'pvp-disabled');cast(s);assert.equal(a.skillId,null);
  assert.equal(s.state.events.at(-1).reason,'pvp-disabled');
  assert.equal(s.skillAvailability('rf','Q').reason,'empty-slot');
  assert.equal(s.skillAvailability('rf',4).key,'Q');
  assert.throws(()=>s.skillAvailability('rf','Z'),RangeError);
});

test('same-key Shadow return stays available with zero MP and active CD, pays once, and survives JSON restore',()=>{
  const s=make(24217),a=s.actor('rf');a.mp=20;cast(s);
  assert.equal(a.state,'RSI_SI_A_RF_SHADOW_STEP');assert.equal(a.mp,0);assert.equal(a.cooldowns[24217],7);
  assert.deepEqual({...available(s),traitPolicy:undefined},{available:true,reason:null,mode:'shadow-return',
    slot:0,key:'A',skillId:24217,mpCost:0,cooldown:0,cooldownRemaining:7,traitPolicy:undefined,displayUnavailable:false,displayReason:null,
    resourceMpInsufficient:false,resourceCooldownRemaining:0});
  const snapshot=JSON.parse(JSON.stringify(s.snapshot())),b=make(24217);b.restore(snapshot);
  assert.deepEqual(available(s),available(b));cast(s);cast(b);
  assert.equal(a.state,'RSI_SHADOW_BACK_SLIDE_UPGRADE');assert.equal(a.mp,0);assert.equal(a.cooldowns[24217],7);
  assert.equal(a.sourceShadowStep.returnUsed,true);assert.equal(available(s).available,false);
  assert.deepEqual(available(s),available(b));
  assert.equal(s.state.events.filter(e=>e.type==='skillStarted').length,1,'return is not a second skill cast');
  s.restore(snapshot);assert.equal(available(s).mode,'shadow-return','availability derives from restored state');
  const restored=s.actor('rf');restored.hitStop=.1;assert.equal(available(s).reason,'time-stopped');
  restored.hitStop=0;assert.equal(available(s).available,true);
});

test('Shadow original triggering key remains a return route even when a paused loadout changes',()=>{
  const s=make(24217);cast(s);const a=s.actor('rf');
  s.configureLoadout([null,{skillId:24027},null,null,null,null,null,null]);
  assert.equal(available(s).mode,'shadow-return');assert.equal(available(s).cooldownRemaining,7);cast(s);
  assert.equal(a.state,'RSI_SHADOW_BACK_SLIDE_UPGRADE');
  assert.equal(s.skillAvailability('rf','S').reason,'state-or-ground-condition');
});

test('pure evaluator works without a Simulation or browser dependency',()=>{
  const s=make(),actor=s.snapshot().actors[0];
  assert.deepEqual(evaluateSkillAvailability({actor,profile,preset,slot:'A'}),available(s));
});

test('legacy ground-only display metadata remains compatible while actual cast, MP and CD restrictions remain',()=>{
  const s=make(24218),a=s.actor('rf');s.enter(a,'RSI_JUMP_UP','availability-fixture');a.grounded=false;
  assert.equal(available(s).available,false);assert.equal(available(s).displayUnavailable,false);
  cast(s);assert.equal(a.skillId,null);assert.equal(s.state.events.find(e=>e.type==='skillRejected').reason,'state-or-ground-condition');
  a.mp=0;assert.equal(available(s).displayReason,'insufficient-mp');assert.equal(available(s).displayUnavailable,true);
  a.mp=300;a.cooldowns[24218]=.01;assert.equal(available(s).displayReason,'cooldown');
  a.cooldowns[24218]=0;s.enter(a,'RSI_JUMP_READY','availability-fixture');
  assert.equal(available(s).available,false);assert.equal(available(s).displayUnavailable,false);
  s.enter(a,'RSI_COMBO_Z','availability-fixture');a.grounded=true;
  assert.equal(available(s).displayUnavailable,true,'legacy query metadata is retained; v17 HUD uses resource fields');
});

test('fourth saved slot becomes C without changing its skill/branch data; F no longer casts it',()=>{
  const s=make(),a=s.actor('rf');s.configureLoadout([null,null,null,{skillId:24027,branchId:'memo-21'},null,null,null,null]);
  const before=structuredClone(a.loadout);assert.equal(s.skillAvailability('rf','C').slot,3);
  assert.throws(()=>s.skillAvailability('rf','F'),RangeError);
  cast(s,'F');assert.equal(a.skillId,null);assert.deepEqual(a.loadout,before);
  cast(s,'C');assert.equal(a.skillId,24027);assert.equal(a.mp,a.mpMax-120);assert.deepEqual(a.loadout,before);
});
