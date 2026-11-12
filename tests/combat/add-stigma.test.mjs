import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addTargetSkillEvents} from '../../packages/combat-core/add-target-skills.mjs';
import {addRecastEvents,addRecastResourcePlan,tickAddRecasts} from '../../packages/combat-core/add-recasts.mjs';
import {markAddStigma,returnAddStigma,receiveAddStigmaNotice,flushAddStigmaNotices,validateAddStigmaState,validateAddStigmaNotice} from '../../packages/combat-core/add-stigma.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/de-profile.json',import.meta.url)));
const skill=profile.skillCatalog.find(skill=>skill.skillId===29025);
function fixture(networkOwnerId=null){
 const a={id:'de',professionId:'DE',team:0,hp:100,mp:80,mpMax:330,x:0,y:0,z:0,lineId:1,facing:1,stateSerial:10,
  state:skill.state,skillId:29025,loadout:[{skillId:29025}],sourceAdd:{formation:false,dp:1000},equipmentAttributes:{addDpConsumptionReduction:.5}};
 const b={id:'enemy',professionId:'LK',team:1,hp:100,mp:50,x:200,y:90,z:60,lineId:1,landPosition:[200,0,60],buffs:[],vx:30,vy:40,vz:50};
 const sim={networkOwnerId,networkEpochFor:id=>id==='de'?2:3,state:{actors:[a,b],effects:[],nextEffectId:1,time:0},profileFor:()=>profile,
  map:{lines:[{lineId:1,start:[0,0,0],end:[1000,0,300]}]},events:[],notes:[],hits:[],
  fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},note:(...x)=>sim.notes.push(x),emit:(...x)=>sim.events.push(x),
  spawnSet:(a,setName)=>sim.state.effects.push({id:sim.state.nextEffectId++,ownerId:a.id,setName}),
  grantBuff:(a,b,factor,level)=>{assert.equal(factor,478);assert.equal(level,1);const buff={templateId:440,sourceActorId:a.id,finalizers:[{kind:'time',remaining:6}]};b.buffs=[buff];return buff;},
  effectAnchorSampler:(_,target)=>({position:[target.x,target.y+123,target.z]}),
  createEffect:(a,d,o)=>{const e={...o,definition:d,ownerId:a.id};sim.hits.push(e);return e;}};
 return {sim,a,b};
}
function returnNotice(mark){return {...structuredClone(mark),serial:mark.serial+1,action:'return',remaining:0};}

test('2016 initial scan marks exact authored XYZ for six seconds and keeps original target hit',()=>{
 const {sim,a,b}=fixture();addTargetSkillEvents(sim,a,0,.099);assert.equal(a.sourceAddStigma,undefined);
 addTargetSkillEvents(sim,a,.099,.1);
 assert.deepEqual(a.sourceAddStigma,{skillId:29025,targetId:'enemy',targetEpoch:3,position:[200,90,60],lineId:1,remaining:6,group:10});
 assert.equal(b.buffs[0].templateId,440);assert.equal(sim.state.effects[0].traceActorId,'enemy');
 assert.equal(sim.state.effects[0].traceUnitDieDelete,true);assert.equal(sim.hits[0].definition.NAME,'DamageEffect_ADE_REVERSE_STIGMA_Attack');
 assert.deepEqual(sim.hits[0].birthAnchor.position,[200,213,60]);
 tickAddRecasts(sim,a,6);assert.equal(a.sourceAddStigma,null);assert.equal(a.sourceAddStigmaNotice.action,'clear');assert.equal(b.buffs.length,0);assert.equal(sim.state.effects[0].dead,true);
});

test('2016 marker query requires twenty MP in both modes but native226 bypasses dedicated MP/DP payment',()=>{
 const {sim,a,b}=fixture();markAddStigma(sim,a,b);const initial={mode:'cast',mpCost:100,dpCost:2000,mutationCost:3,cooldown:10};
 let p=addRecastResourcePlan(a,skill,initial,{profile});assert.equal(p.mode,'stigma-return');assert.equal(p.mpCost,0);assert.equal(p.mpRequirement,20);assert.equal(p.dpCost,0);
 assert.equal(p.recastState,'ANSI_SA_ADE_REVERSE_STIGMA_RETURN');assert.equal(p.ignoreCooldown,true);assert.equal(p.mutationCost,0);assert.equal(p.cooldown,0);
 a.mp=19;p=addRecastResourcePlan(a,skill,initial,{profile});assert.equal(p.resourceMpInsufficient,true);
 a.sourceAdd.formation=true;p=addRecastResourcePlan(a,skill,initial,{profile});assert.equal(p.mpCost,0);assert.equal(p.mpRequirement,20);assert.equal(p.dpCost,0);assert.equal(p.resourceMpInsufficient,true);
 a.sourceAdd.dp=0;a.mp=20;p=addRecastResourcePlan(a,skill,initial,{profile});assert.equal(p.resourceDpInsufficient,false);assert.equal(p.resourceMpInsufficient,false);
 a.sourceAddStigma=null;assert.equal(addRecastResourcePlan(a,skill,initial,{profile}),initial);
});

test('qualified return event uses stored airborne XYZ and source Bip01, without ground snap or velocity invention',()=>{
 const {sim,a,b}=fixture();markAddStigma(sim,a,b);b.x=800;b.y=400;b.z=240;
 a.state='ANSI_SA_ADE_REVERSE_STIGMA_RETURN';addRecastEvents(sim,a,0,.099);assert.equal(b.x,800);
 addRecastEvents(sim,a,.099,.1);
 assert.deepEqual([b.x,b.y,b.z],[200,90,60]);assert.deepEqual([b.vx,b.vy,b.vz],[30,40,50]);
 assert.equal(b.lastTouchLineId,1);assert.equal(b.lineId,null);assert.equal(b.grounded,false);assert.deepEqual(b.landPosition,[200,0,60]);
 assert.equal(b.landPosition.length,3);assert.ok(b.landPosition.every(Number.isFinite),'required owner-wire vector remains valid before another tick');
 assert.equal(a.sourceAddStigma,null);assert.equal(a.sourceAddStigmaNotice.action,'return');
 assert.equal(sim.hits[0].definition.NAME,'DamageEffect_ADE_REVERSE_STIGMA_Return');assert.deepEqual(sim.hits[0].birthAnchor.position,[200,213,60]);
 assert.equal(profile.damageEffects.DamageEffect_ADE_REVERSE_STIGMA_Return.raw.DAMAGE_DATA.DAMAGE.MAGIC,1.67);
});

test('invalid target life, dead target or removed authored line cannot restore an old point',()=>{
 for(const mode of ['life','dead','line','missing']){
  const {sim,a,b}=fixture();markAddStigma(sim,a,b);b.x=800;
  if(mode==='life')sim.networkEpochFor=()=>4;if(mode==='dead')b.hp=0;if(mode==='line')sim.map.lines=[];
  if(mode==='missing')sim.state.actors=[a];
  assert.equal(returnAddStigma(sim,a),false,mode);assert.equal(b.x,800);assert.equal(a.sourceAddStigma,null);assert.equal(sim.hits.length,0);
 }
});

test('invincibility prevents initial marking and later transfer, preserving current-position return payload',()=>{
 const {sim,a,b}=fixture();b.invincible=true;assert.equal(markAddStigma(sim,a,b),false);
 b.invincible=false;markAddStigma(sim,a,b);b.forceInvincible=.2;b.x=800;
 assert.equal(returnAddStigma(sim,a),false);assert.equal(b.x,800);assert.equal(a.sourceAddStigmaNotice.action,'clear');
 assert.deepEqual(sim.hits[0].birthAnchor.position,[800,213,60]);
});

test('caster owner never moves remote target; recipient accepts only matching prior mark and current target life',()=>{
 const {sim,a,b}=fixture('de');markAddStigma(sim,a,b);const mark=structuredClone(a.sourceAddStigmaNotice);
 assert.equal(b.buffs.length,0);b.x=800;returnAddStigma(sim,a);assert.equal(b.x,800);
 const recall=structuredClone(a.sourceAddStigmaNotice);sim.networkOwnerId='enemy';
 assert.equal(receiveAddStigmaNotice(sim,a,2,mark,.5),true);assert.equal(b.buffs[0].finalizers[0].remaining,5.5);
 assert.equal(receiveAddStigmaNotice(sim,a,2,recall),true);assert.equal(b.x,200);
 b.x=900;assert.equal(receiveAddStigmaNotice(sim,a,2,recall),false);assert.equal(b.x,900);
});

test('unseen, expired, rewritten, invincible and new-life returns are consumed without teleporting',()=>{
 for(const mode of ['unseen','expired','point','line','group','invincible','life']){
  const {sim,a,b}=fixture('de');markAddStigma(sim,a,b);const mark=structuredClone(a.sourceAddStigmaNotice),recall=returnNotice(mark);
  sim.networkOwnerId='enemy';if(mode!=='unseen')receiveAddStigmaNotice(sim,a,2,mark);
  b.x=800;if(mode==='expired')tickAddRecasts(sim,a,7);if(mode==='point')recall.position[0]++;
  if(mode==='line'){sim.map.lines.push({lineId:2});recall.lineId=2;}
  if(mode==='group')recall.group++;if(mode==='invincible')b.invincible=true;if(mode==='life')sim.networkEpochFor=()=>4;
  assert.equal(receiveAddStigmaNotice(sim,a,2,recall),false,mode);assert.equal(b.x,800);
  b.invincible=false;assert.equal(receiveAddStigmaNotice(sim,a,2,recall),false,mode);
 }
});

test('receipt expiry follows caster effective time, not global time advancing during world stop',()=>{
 const {sim,a,b}=fixture('de');markAddStigma(sim,a,b);const mark=structuredClone(a.sourceAddStigmaNotice),recall=returnNotice(mark);
 sim.networkOwnerId='enemy';receiveAddStigmaNotice(sim,a,2,mark);sim.state.time=20;
 tickAddRecasts(sim,a,0);b.x=800;assert.equal(receiveAddStigmaNotice(sim,a,2,recall),true);assert.equal(b.x,200);
});

test('mark/return receipts survive trusted snapshot restore and defer through roster replacement',()=>{
 const {sim,a,b}=fixture('de');markAddStigma(sim,a,b);const mark=structuredClone(a.sourceAddStigmaNotice),recall=returnNotice(mark);
 sim.networkOwnerId='enemy';sim.deferAddTimeRingNotices=true;
 receiveAddStigmaNotice(sim,a,2,mark);assert.equal(b.buffs.length,0);
 sim.deferAddTimeRingNotices=false;flushAddStigmaNotices(sim);assert.equal(b.buffs.length,1);
 const snapshot=structuredClone(sim.state);sim.state=structuredClone(snapshot);sim.state.actors[1].x=800;
 assert.equal(receiveAddStigmaNotice(sim,sim.state.actors[0],2,recall),true);assert.equal(sim.state.actors[1].x,200);
 const received=structuredClone(sim.state);sim.state=received;sim.state.actors[1].x=900;
 assert.equal(receiveAddStigmaNotice(sim,sim.state.actors[0],2,recall),false);assert.equal(sim.state.actors[1].x,900);
});

test('shared target buff survives another DE mark; clearing one actor removes only its own display',()=>{
 const {sim,a,b}=fixture();markAddStigma(sim,a,b);
 const other={...structuredClone(a),id:'de2',sourceAddStigma:{...structuredClone(a.sourceAddStigma),remaining:4}};sim.state.actors.push(other);
 tickAddRecasts(sim,a,6);assert.equal(b.buffs.length,1);assert.equal(sim.state.effects[0].dead,true);
});

test('strict saved point and notice schemas reject hostile data and foreign ownership',()=>{
 const {sim,a,b}=fixture();markAddStigma(sim,a,b);const context={owner:a,profile,actors:sim.state.actors,map:sim.map};
 validateAddStigmaState(null,context);validateAddStigmaState(a.sourceAddStigma,context);validateAddStigmaNotice(a.sourceAddStigmaNotice,context);
 for(const s of [{...a.sourceAddStigma,remaining:6.01},{...a.sourceAddStigma,lineId:999},
  {...a.sourceAddStigma,targetEpoch:-1},{...a.sourceAddStigma,position:[NaN,0,0]},
  {...a.sourceAddStigma,position:[0,0,0],groundSnap:true},{...a.sourceAddStigma,targetId:'de'}])assert.throws(()=>validateAddStigmaState(s,context));
 assert.throws(()=>validateAddStigmaState(a.sourceAddStigma,{...context,owner:{...a,professionId:'MM'}}));
 assert.throws(()=>validateAddStigmaNotice({...a.sourceAddStigmaNotice,action:'return'},context));
 assert.throws(()=>validateAddStigmaNotice({...a.sourceAddStigmaNotice,serial:0},context));
});

test('disabled authored lines reject marking, references and an already saved recall',()=>{
 for(const disabled of [{enabled:false},{ENABLE:0},{nativeFields:{ENABLE:false}},{nativeFields:{ENABLE:0}},
  {nativeFields:{ENABLE:{symbol:'FALSE'}}},{nativeFields:{ENABLE:{$symbol:'FALSE'}}}]){
  const {sim,a,b}=fixture();markAddStigma(sim,a,b);const state=structuredClone(a.sourceAddStigma);
  Object.assign(sim.map.lines[0],disabled);b.x=800;
  assert.throws(()=>validateAddStigmaState(state,{owner:a,profile,actors:sim.state.actors,map:sim.map}),/disabled/);
  assert.equal(returnAddStigma(sim,a),false);assert.equal(b.x,800);assert.equal(a.sourceAddStigma,null);
  assert.equal(markAddStigma(sim,a,b),false);
 }
});
