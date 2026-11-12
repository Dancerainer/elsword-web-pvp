import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startAddStarfall,tickAddStarfall,startAddShootingChaser,addShootingChaserContact,tickAddShootingChaser,
 initializeAddStardust,activateAddStardust,tickAddStardust,isAddNativeOwnedEffect,validateAddNativeState,
 STARFALL_CARRIER,CHASER_ATTACKER,CHASER_SETS,selectAddStarfallTarget,attackAddStarfallCarrier,tickAddNativeSkills} from '../../packages/combat-core/add-analysis-skills.mjs';
const read=id=>JSON.parse(readFileSync(new URL('../../packages/combat-core/'+id+'-profile.json',import.meta.url)));
const mm=read('mm'),de=read('de');
function fixture(profession='MM'){
 const p=profession==='MM'?mm:de;
 const owner={id:'add',professionId:profession,team:0,hp:100,x:0,y:0,z:0,facing:1,lineId:0,landPosition:[0,0,0],stateSerial:7,skillScale:1.5,
  sourceAdd:{formation:false,mutation:0,dp:3000},loadout:[{skillId:profession==='MM'?29018:29021}]};
 const target={id:'enemy',professionId:'LK',team:1,hp:100,x:200,y:0,z:0};
 const sim={state:{actors:[owner,target],effects:[],nextEffectId:1},map:{lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0]}]},events:[],notes:[],sets:[],
  profileFor:()=>p,emit(type,id,data){this.events.push({type,id,...data});},note(...v){this.notes.push(v);},
  effectAnchorSampler:(_,a)=>({position:[a.x,a.y+80,a.z]}),
  createEffect(a,d,o){const e={id:this.state.nextEffectId++,name:d.NAME,ownerId:a.id,skillId:a.skillId,powerMultiplier:a.skillScale,definition:d,...o};this.state.effects.push(e);return e;},
  spawnSet(a,name){this.sets.push({ownerId:a.id,name,position:[a.x,a.y,a.z]});
   // Dispatcher fixture checks control/ownership, not invented collision.
   const e={id:this.state.nextEffectId++,name:'dispatcher-fixture',ownerId:a.id,setName:name,powerMultiplier:a.skillScale};this.state.effects.push(e);},
  effectBoneSampler:(_e,_a,n)=>[Number(n.match(/\d+$/)[0]),700,0]};
 return {sim,owner,target,p};
}
const spend=(actor,n)=>{const amount=Math.min(n,actor.sourceAdd.mutation);actor.sourceAdd.mutation-=amount;return amount;};
function context(sim,owner,p){return {owner,profile:p,actors:sim.state.actors};}
test('idle static analysis tick never adds a new lifecycle or field to any untouched profession',()=>{
 for(const professionId of ['RF','GM','BH','CA','LP','MM','DE']){
  const owner={id:'idle',professionId,hp:100};tickAddNativeSkills({state:{actors:[owner],effects:[]}},owner,.016);
  assert.equal(Object.hasOwn(owner,'sourceAddNative'),false);
 }
});
test('static analysis source seal includes actual registrar corrections and source-bound native projections',()=>{
 const c=JSON.parse(readFileSync(new URL('../../contracts/add-analysis-consumers-v37.json',import.meta.url)));
 assert.equal(c.originalSha256,'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729');
 assert.equal(c.analysisCaptureSha256,'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba');
 assert.equal(c.targetClientMeasured,false);
 for(const address of ['0x32761d10','0x32761900','0x32763250','0x32762cb0','0x3274e3f0','0x3275a970','0x3275e250']){
  assert.ok(c.functions.some(r=>r.address===address&&typeof r.pseudocode==='string'&&r.evidenceId.startsWith('ev_')));
 }
});
test('Starfall distance is an independently sealed77-byte squared vec3 helper and CRT selector identity is bound',()=>{
 const c=JSON.parse(readFileSync(new URL('../../contracts/add-starfall-selection-source-v37.json',import.meta.url)));
 assert.equal(Buffer.from(c.distanceHelper.bytes,'hex').length,77);
 assert.equal(createHash('sha256').update(Buffer.from(c.distanceHelper.bytes,'hex')).digest('hex'),'2aa07fbb4baf70c71f69fe6fa06ec9db1a86eaf43d47c0fd7fc2e795a2cb7353');
 assert.equal(c.distanceThreshold.value,1000000);assert.equal(c.randomExportBinding.rand.export.name,'rand');
 assert.equal(c.randomExportBinding.rand.observedModuleVA,'0x5f4decba');
 assert.ok(c.stillUnknown.some(n=>n.includes('seed')));assert.equal(c.targetClientMeasured,false);
});
test('Starfall source1e6 squared range includes its boundary and prefers a different target, then falls back to the prior valid target',()=>{
 const {sim,owner,target}=fixture();let calls=0;sim.rng=()=>{calls++;return .99;};
 target.x=1000;assert.equal(selectAddStarfallTarget({sim,owner,lastTargetId:null}),target);assert.equal(calls,1);
 target.x=1000.1;assert.equal(selectAddStarfallTarget({sim,owner,lastTargetId:null}),null);
 target.x=200;const other={...target,id:'other',x:300};sim.state.actors.push(other);
 assert.equal(selectAddStarfallTarget({sim,owner,lastTargetId:target.id}),other);
 other.hp=0;assert.equal(selectAddStarfallTarget({sim,owner,lastTargetId:target.id}),target);
 target.invincible=true;assert.equal(selectAddStarfallTarget({sim,owner,lastTargetId:target.id}),null);
});
test('Starfall emits its actual damage at the chosen posed target, with owner attribution and authored-line ground query',()=>{
 const {sim,owner,target}=fixture();startAddStarfall(sim,owner);const carrier=sim.state.effects[0];
 sim.nativeGeometry={land:()=>({found:true,point:[200,5,0]})};
 assert.equal(attackAddStarfallCarrier({sim,owner,carrier,target,power:1.5}),true);
 const blast=sim.state.effects.find(e=>e.name==='DAMAGE_EFFECT_Star_Fall_Explode');
 assert.deepEqual(blast.birthAnchor.position,[200,5,0]);assert.equal(blast.ownerId,owner.id);assert.equal(blast.skillId,29016);
 assert.equal(sim.events.find(e=>e.type==='addStarfallAttackCreated').targetId,target.id);
});
test('Starfall base source7.4/.5 creates one carrier; strict interval zero never emits',()=>{
 const {sim,owner,target,p}=fixture();assert.equal(startAddStarfall(sim,owner),true);
 assert.equal(owner.sourceAddNative[0].rows.length,1);assert.equal(owner.sourceAddNative[0].rows[0].remaining,Math.fround(7.4));
 let shots=0;const hooks={selectTarget:()=>target,attackCarrier:()=>shots++};
 tickAddStarfall(sim,owner,.5,hooks);assert.equal(shots,0);
 tickAddStarfall(sim,owner,.0001,hooks);assert.equal(shots,1);
 assert.equal(owner.sourceAddNative[0].rows[0].interval,Math.fround(.5));
 validateAddNativeState(owner.sourceAddNative,context(sim,owner,p));
});
test('Starfall three-point formed variant uses two sourced carriers at paired50 offset and half secondary duration',()=>{
 const {sim,owner,p}=fixture();owner.sourceAdd.formation=true;owner.sourceAdd.mutation=3;
 assert.equal(startAddStarfall(sim,owner,{consumeMutation:spend}),true);assert.equal(owner.sourceAdd.mutation,0);
 const r=owner.sourceAddNative[0];assert.deepEqual(r.rows.map(q=>q.remaining),[Math.fround(7.4),Math.fround(3.7)]);
 assert.deepEqual(sim.state.effects.map(e=>e.birthAnchor.position),[[50,0,0],[-50,0,0]]);
 assert.ok(sim.state.effects.every(e=>e.name===STARFALL_CARRIER));validateAddNativeState(owner.sourceAddNative,context(sim,owner,p));
});
test('Starfall insufficient mutation is not consumed and missing target/attachment remains visibly unsupported',()=>{
 const {sim,owner}=fixture();owner.sourceAdd.formation=true;owner.sourceAdd.mutation=2;
 startAddStarfall(sim,owner,{consumeMutation:spend});assert.equal(owner.sourceAdd.mutation,2);assert.equal(owner.sourceAddNative[0].rows.length,1);
 tickAddStarfall(sim,owner,.6);assert.ok(sim.notes.some(n=>n[0]==='add-starfall-selection'));
 assert.equal(sim.state.effects.length,1);
});
test('Starfall repeated same-target callback alternates its skip flag rather than a fabricated fixed hit count',()=>{
 const {sim,owner,target}=fixture();startAddStarfall(sim,owner);let shots=0;
 const hooks={selectTarget:()=>target,attackCarrier:()=>shots++};
 for(let i=0;i<5;i++)tickAddStarfall(sim,owner,.6,hooks);
 assert.equal(shots,3);
 tickAddStarfall(sim,owner,8,hooks);assert.deepEqual(owner.sourceAddNative,[]);assert.equal(sim.state.effects[0].dead,true);
});
test('Starfall owner death clears all carrier handles',()=>{
 const {sim,owner}=fixture();startAddStarfall(sim,owner);owner.hp=0;tickAddStarfall(sim,owner,.1);
 assert.deepEqual(owner.sourceAddNative,[]);assert.ok(sim.events.some(e=>e.type==='effectEnded'&&e.reason==='add-starfall-owner-ended'));
});
test('Chaser retains actual NO_DAMAGE contacts for one second and scales A3 by three units',()=>{
 const {sim,owner,target,p}=fixture();assert.equal(startAddShootingChaser(sim,owner),true);
 const e=sim.state.effects[0];assert.equal(e.name,CHASER_ATTACKER);
 for(let i=0;i<3;i++)assert.equal(addShootingChaserContact(sim,owner,target,e,[200,80,0]),true);
 assert.equal(owner.sourceAddNative[0].records[0].count,3);assert.equal(target.hp,100);
 validateAddNativeState(owner.sourceAddNative,context(sim,owner,p));
 tickAddShootingChaser(sim,owner,.99);assert.deepEqual(sim.sets,[]);
 tickAddShootingChaser(sim,owner,.02);
 // Missing root remains explicit until the separate original-resource closure
 // has been sealed; the control's allocation decision is independently tested.
 const allocations=sim.events.filter(e=>e.type==='addChaserAllocated');
 assert.deepEqual(allocations.map(e=>[e.setName,e.units,e.power]),[[CHASER_SETS[2],3,4.5]]);
 assert.deepEqual(owner.sourceAddNative,[]);assert.equal(e.dead,true);
});
test('Chaser four-unit global budget is not four distinct victims',()=>{
 const {sim,owner,target}=fixture();const second={...target,id:'second',x:300};sim.state.actors.push(second);
 startAddShootingChaser(sim,owner);const e=sim.state.effects[0];
 for(let i=0;i<3;i++)addShootingChaserContact(sim,owner,target,e,[200,80,0]);
 for(let i=0;i<3;i++)addShootingChaserContact(sim,owner,second,e,[300,80,0]);
 tickAddShootingChaser(sim,owner,1);
 assert.deepEqual(sim.events.filter(e=>e.type==='addChaserAllocated').map(e=>[e.targetId,e.units,e.power]),[['enemy',3,4.5],['second',1,1.5]]);
});
test('Chaser only matching actual effect handles can record, and its counter is independent of HP damage',()=>{
 const {sim,owner,target}=fixture();startAddShootingChaser(sim,owner);const e=sim.state.effects[0];
 for(const wrong of [{...e,id:99},{...e,name:'other'},null])assert.equal(addShootingChaserContact(sim,owner,target,wrong,[1,2,3]),false);
 assert.equal(addShootingChaserContact(sim,owner,target,e,[NaN,0,0]),false);
 target.invincible=true;assert.equal(addShootingChaserContact(sim,owner,target,e,[200,80,0]),true,'pre-reaction callback receives this specific observed contact, no claim all invincible paths invoke it');
 assert.equal(target.hp,100);assert.equal(owner.sourceAddNative[0].records[0].count,1);
});
test('Chaser source32775100 assigns the four-unit remainder to the first residual count>=5 record',()=>{
 const {sim,owner,target}=fixture();startAddShootingChaser(sim,owner);const e=sim.state.effects[0];
 for(let i=0;i<5;i++)addShootingChaserContact(sim,owner,target,e,[200,80,0]);
 tickAddShootingChaser(sim,owner,1);const allocation=sim.events.find(e=>e.type==='addChaserAllocated');
 assert.equal(allocation.targetId,target.id);assert.equal(allocation.units,4);assert.equal(allocation.setName,CHASER_SETS[3]);
 assert.equal(sim.notes.some(n=>n[0]==='add-chaser-count-fallback'),false);
});
test('Chaser death and replacement release the saved attacker handle without causing an allocation',()=>{
 const {sim,owner}=fixture();startAddShootingChaser(sim,owner);const old=sim.state.effects[0];
 startAddShootingChaser(sim,owner);assert.equal(old.dead,true);
 owner.hp=0;tickAddShootingChaser(sim,owner,.2);assert.deepEqual(owner.sourceAddNative,[]);
 assert.equal(sim.events.some(e=>e.type==='addChaserAllocated'),false);
});
test('Stardust native initialization consumes up to three mutation and stores a1 accumulator without guessing activation phase',()=>{
 const {sim,owner,p}=fixture('DE');owner.sourceAdd.formation=true;owner.sourceAdd.mutation=3;
 assert.equal(initializeAddStardust(sim,owner,{consumeMutation:spend}),true);const r=owner.sourceAddNative[0];
 assert.equal(r.remaining,Math.fround(2.5+Math.fround(3*.33)));assert.equal(r.accumulator,1);assert.equal(r.active,false);
 assert.deepEqual(sim.state.effects[0].birthAnchor.position,[0,700,0]);assert.equal(owner.sourceAdd.mutation,0);
 tickAddStardust(sim,owner,1);assert.equal(r.remaining,Math.fround(2.5+Math.fround(3*.33)));
 validateAddNativeState(owner.sourceAddNative,context(sim,owner,p));
});
test('Stardust explicit native phase cycles ten original node names and never uses local offsets as world points',()=>{
 const {sim,owner}=fixture('DE');initializeAddStardust(sim,owner);activateAddStardust(sim,owner);
 const nodes=[];sim.effectBoneSampler=(_e,_a,bone)=>{nodes.push(bone);return [1000+nodes.length,2700,40];};
 for(let i=0;i<11;i++)tickAddStardust(sim,owner,.1);
 assert.deepEqual(nodes,[...Array.from({length:10},(_,i)=>'spwan_Dummy0'+(i+1)),'spwan_Dummy01']);
 assert.deepEqual(sim.events.find(e=>e.type==='addStardustBallCreated').position,[1001,2700,40]);
});
test('Stardust long frame produces one ball and resets accumulator to zero, without catch-up while loops',()=>{
 const {sim,owner}=fixture('DE');initializeAddStardust(sim,owner);activateAddStardust(sim,owner);
 tickAddStardust(sim,owner,.6);assert.equal(sim.events.filter(e=>e.type==='addStardustBallCreated').length,1);
 assert.equal(owner.sourceAddNative[0].accumulator,0);
 tickAddStardust(sim,owner,.05);assert.equal(sim.events.filter(e=>e.type==='addStardustBallCreated').length,1);
});
test('Stardust missing original node omits the ball and reports the exact unsupported attachment',()=>{
 const {sim,owner}=fixture('DE');initializeAddStardust(sim,owner);activateAddStardust(sim,owner);sim.effectBoneSampler=()=>null;
 tickAddStardust(sim,owner,.1);assert.equal(sim.events.some(e=>e.type==='addStardustBallCreated'),false);
 assert.ok(sim.notes.some(n=>n[0]==='add-stardust-original-node:spwan_Dummy01'));
});
test('Stardust duration end uses the saved original position and releases attack/rupture/carrier handles',()=>{
 const {sim,owner}=fixture('DE');initializeAddStardust(sim,owner);activateAddStardust(sim,owner);owner.x=900;owner.y=500;
 tickAddStardust(sim,owner,2.5);assert.deepEqual(sim.sets.at(-1).position,[0,0,0]);
 assert.equal(sim.sets.at(-1).name,'EffectSet_ATT_Stardust_Shower_End');assert.deepEqual(owner.sourceAddNative,[]);
 assert.equal(sim.state.effects.filter(e=>e.dead).length,3);
});
test('strict static analysis owner payload rejects wrong career, foreign target, impossible duration, repeated kinds and extra fields',()=>{
 const {sim,owner,p}=fixture();startAddShootingChaser(sim,owner);const original=structuredClone(owner.sourceAddNative);
 assert.equal(isAddNativeOwnedEffect(sim,owner,sim.state.effects[0]),true);validateAddNativeState(original,context(sim,owner,p));
 for(const change of [r=>r.remaining=1.1,r=>r.power=Infinity,r=>r.extra=true,r=>r.targetId=owner.id,r=>r.records=[{targetId:'unknown',count:1,position:[0,0,0]}]]){
  const value=structuredClone(original);change(value[0]);assert.throws(()=>validateAddNativeState(value,context(sim,owner,p)));
 }
 assert.throws(()=>validateAddNativeState([...original,...original],context(sim,owner,p)));
 assert.throws(()=>validateAddNativeState(original,{...context(sim,owner,p),owner:{...owner,professionId:'LP'}}));
});
