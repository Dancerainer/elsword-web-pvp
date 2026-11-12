/** Original declarations plus qualified fixed EL callback ordering. Ordinary
 * source-host integration uses the actual Garpai map, without Native/WASM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisSkillEvent,elesisSkillExternalSkillAllowed} from '../../packages/combat-core/elesis-skills.mjs';
const root=resolve(import.meta.dirname,'../..'),assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const profiles=Object.fromEntries(['GM','BH','CA'].map(id=>[id,read(resolve(root,`packages/combat-core/${id.toLowerCase()}-profile.json`))]));
const map={...read(resolve(assets,'scene/sander-garpai-rock-pvp/manifest.json')),...read(resolve(assets,'scene/sander-garpai-rock-pvp/collision.json'))};
const input=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed),pureDoubleLeft:false,pureDoubleRight:false});
const state=(f)=>f.profile.states[f.a.state]?.sourceState??f.a.state;
function fixture(id,currentId,currentState,time,{nextId,facing=1,hit=false}={}){
 const profile=profiles[id],row=profile.skillCatalog.find(s=>s.skillId===currentId);
 nextId??=({GM:28219,BH:28209,CA:28216})[id];
 if(nextId===currentId)nextId=28203;
 const slots=[{skillId:currentId},{skillId:nextId},...Array(6).fill(null)];
 const sim=createSimulation({profile,map,seed:2016,preset:{passives:[],guildPassives:[],loadout:slots},
  actors:[{id:'actor',professionId:id,team:0,position:[0,3080,0],lineId:2,facing,passives:[],guildPassives:[],loadout:slots}]});
 const a=sim.actor('actor');sim.enter(a,currentState,'independent-fixed-source-priority-fixture');
 a.grounded=true;a.lineId=2;a.mp=a.mpMax;a.cooldowns={};a.hitStop=a.worldStop=a.inputLock=a.canNotAttackTime=a.canNotJumpTime=0;
 a.skillId=currentId;a.skillScale=1;a.skillContext={key:'A',level:row.maxLevel,branchId:'none',traitPolicy:null};
 a.sourceElesisSkills={charge:0,loopTime:0,loops:0,hit,dodges:0,rushes:0,mpPaid:row.mpCost,stigmaCooldown:0,chivalryTime:0};
 a.awakening.orbs=1;a.awakening.remaining=0;a.animationTime=time;a.animationBeforeTime=time;a.animationStopped=false;
 sim.drainEvents();return {sim,a,profile,nextId};
}
// Common input precedes class EventProcess in the web host. Exercise both
// production boundaries at the same source clock, without executing a fake
// animation or advancing time to manufacture a desired original expectation.
function dispatch(f,keys){const serial=f.a.stateSerial;f.sim.processInput(f.a,keys);if(f.a.stateSerial===serial)elesisSkillEvent(f.sim,f.a,keys);return f.sim.drainEvents();}
function noIncomingSkill(events,id){assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,0);}

test('priority fixture uses original Garpai geometry and source windows, without pretending Native execution',()=>{
 assert.ok(map.lines.length>1);assert.ok(map.lines.some(l=>l.lineId===2));
 assert.equal(profiles.GM.states.ESI_SI_A_SSK_POWER_BREAK.clip.durationSeconds,1.2);
 assert.equal(profiles.GM.states.ESI_SI_A_SSK_POWER_BREAK.raw.SKILL_CANCEL_AFTER,.533);
 assert.equal(profiles.BH.states.ESI_SI_A_SBH_FLAME_SWORD.raw.SKILL_CANCEL_AFTER,.522);
 assert.deepEqual(profiles.CA.states.SI_A_SCA_SHADE_SCRATCH.raw.EVENT_PROCESS_TIME0,{'1':.26,'2':1,'3':.26});
 assert.equal(profiles.CA.states.SI_A_SCA_SHADE_SCRATCH.raw.SKILL_CANCEL_AFTER,.6);
});
// EL8818: animation end precedes the SKILL macro. End threshold here is the
// already-qualified no-AniXET default (1.2-.12), not Lua TRANSITION.
for(const facing of [-1,1])for(const key of ['S','AWAKEN'])test(`GM ${facing}: Power Break end is not stolen by ${key}`,()=>{
 const f=fixture('GM',28203,'ESI_SI_A_SSK_POWER_BREAK',1.080001,{facing});
 const k=input([], [key]);assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const events=dispatch(f,k);assert.equal(state(f),'ESI_WAIT');noIncomingSkill(events,f.nextId);
 assert.equal(f.a.awakening.remaining,0);assert.equal(f.a.awakening.orbs,1,'end wins before awakening macro');
});
// EL10903: successful red-lotus strike chooses FINISH before both end and
// SKILL. Using .600001 also makes the ordinary .522 skill gate otherwise open.
for(const facing of [-1,1])for(const key of ['S','AWAKEN'])test(`BH ${facing}: successful Flame Sword follow-up precedes ${key}`,()=>{
 const f=fixture('BH',28210,'ESI_SI_A_SBH_FLAME_SWORD',.600001,{facing,hit:true});
 const k=input([], [key]);assert.equal(f.sim.skillAvailability(f.a.id,1).available,true,'resource/state gate alone would allow incoming skill');
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const events=dispatch(f,k);assert.equal(state(f),'ESI_SI_A_SBH_FLAME_SWORD_FINISH');assert.equal(f.a.skillId,28210);
 noIncomingSkill(events,f.nextId);assert.equal(f.a.awakening.orbs,1);
});
for(const hit of [false,true])test(`BH hit=${hit}: the external-skill query is pure`,()=>{
 const f=fixture('BH',28210,'ESI_SI_A_SBH_FLAME_SWORD',.600001,{hit}),before=structuredClone(f.a),effects=f.sim.state.effects.length;
 const allowed=elesisSkillExternalSkillAllowed(f.sim,f.a,input([],['S']));assert.equal(allowed,!hit);
 assert.deepEqual(f.a,before);assert.equal(f.sim.state.effects.length,effects);
});
test('BH a miss keeps the already-open skill gate available instead of inventing a hit follow-up',()=>{
 const f=fixture('BH',28210,'ESI_SI_A_SBH_FLAME_SWORD',.600001);
 const events=dispatch(f,input([],['S']));assert.equal(state(f),'ESI_SI_A_SBH_FIREWORKS');assert.equal(f.a.skillId,28209);
 assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===28209).length,1);
});
// CA EL8040 is explicitly a 2026 reconstructed control-flow reference. The
// .26..1 clock comes independently from the original2016 target declaration.
for(const facing of [-1,1])for(const pressedX of [false,true])for(const key of ['S','AWAKEN'])test(`CA ${facing}: ${pressedX?'fresh':'held'} X owns its Shade Scratch window before ${key}`,()=>{
 const f=fixture('CA',28214,'SI_A_SCA_SHADE_SCRATCH',.600001,{facing});
 const k=input(pressedX?[]:['X'],pressedX?['X',key]:[key]);
 assert.equal(f.sim.skillAvailability(f.a.id,1).available,true,'original .6 skill gate is open');
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const events=dispatch(f,k);assert.equal(state(f),'SI_A_SCA_SHADE_SCRATCH_ATTACK');assert.equal(f.a.skillId,28214);
 noIncomingSkill(events,f.nextId);assert.equal(f.a.awakening.orbs,1);
});
for(const [time,expected]of [[.259999,true],[.26,false],[.600001,false]])test(`CA Shade Scratch X boundary ${time}: independent target window`,()=>{
 const f=fixture('CA',28214,'SI_A_SCA_SHADE_SCRATCH',time),k=input(['X'],['S']);
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),expected);
 if(time<.26)assert.equal(f.sim.skillAvailability(f.a.id,1).available,false,'priority permission does not fabricate an early .6 skill gate');
});
test('CA no own X request leaves an already-open skill slot available',()=>{
 const f=fixture('CA',28214,'SI_A_SCA_SHADE_SCRATCH',.600001),k=input([],['S']);
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),true);
 const events=dispatch(f,k);assert.equal(state(f),'SI_A_SCA_ASSAULT_STRIKE');assert.equal(f.a.skillId,28216);
 assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===28216).length,1);
});
for(const key of ['S','AWAKEN'])test(`CA Shade Scratch own end takes precedence over X and ${key}`,()=>{
 const f=fixture('CA',28214,'SI_A_SCA_SHADE_SCRATCH',1),k=input(['X'],[key]);
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const events=dispatch(f,k);assert.equal(state(f),'ESI_WAIT');noIncomingSkill(events,f.nextId);assert.equal(f.a.awakening.orbs,1);
});
// EL7017: repeat-current-key arm occurs before the ordinary SKILL macro.
for(const facing of [-1,1])test(`GM ${facing}: Rushing Sword same-key repeat precedes the other skill slot`,()=>{
 const f=fixture('GM',28219,'ESI_SI_A_EL_RUSHING_SWORD',.266001,{nextId:28203,facing});
 const k=input([],['A','S']);assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const events=dispatch(f,k);assert.equal(state(f),'ESI_SI_A_EL_RUSHING_SWORD_2nd');assert.equal(f.a.sourceElesisSkills.rushes,1);
 assert.equal(f.a.skillId,28219);noIncomingSkill(events,28203);
});
for(const id of ['GM','BH','CA'])test(`${id}: supported Endurance ANYTIME entrance remains independent of class end priority`,()=>{
 const current=({GM:[28203,'ESI_SI_A_SSK_POWER_BREAK',1.080001],BH:[28210,'ESI_SI_A_SBH_FLAME_SWORD',.600001],CA:[28214,'SI_A_SCA_SHADE_SCRATCH',.600001]})[id];
 const f=fixture(id,...current,{nextId:28218,hit:id==='BH'}),k=input(id==='CA'?['X']:[],['S']);
 assert.equal(profiles[id].skillCatalog.find(s=>s.skillId===28218).useCondition,3);
 assert.equal(profiles[id].skillCatalog.find(s=>s.skillId===28218).mpCost,120);
 assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 const oldMp=f.a.mp;
 f.sim.processInput(f.a,k);const events=f.sim.drainEvents();
 assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===28218).length,1,'common ANYTIME entrance is not swallowed by the earlier class branch');
 assert.equal(oldMp-f.a.mp,120,'the original common entrance pays its independent skill cost');
 assert.equal(f.a.sourceElesisEndurance.skillId,28218);
 // No Native numeric module is supplied by this ordinary priority fixture;
 // real buff grant/lifetime remains covered by the independent Native suite.
});
test('obsolete ANYTIME 28201 passes the priority exception but retains its unsupported availability',()=>{
 const f=fixture('GM',28203,'ESI_SI_A_SSK_POWER_BREAK',1.080001);
 const row=profiles.GM.skillCatalog.find(s=>s.skillId===28201);assert.equal(row.useCondition,3);assert.equal(row.supported,false);
 // Do not force configureLoadout to equip an unavailable skill. This tests
 // the existing common gate against a stale received slot record only.
 f.a.loadout[1]={skillId:28201,requestedSkillId:28201,branchId:'none',level:row.maxLevel};
 const k=input([],['S']);assert.equal(elesisSkillExternalSkillAllowed(f.sim,f.a,k),false);
 f.sim.processInput(f.a,k);const events=f.sim.drainEvents();
 assert.equal(events.filter(e=>e.type==='skillRejected'&&e.skillId===28201&&e.reason==='unsupported-skill').length,1);
 assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===28201).length,0);
});
