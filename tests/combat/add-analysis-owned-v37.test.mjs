/** Real owner encoder/validator/receiver, with original declaration catalogs.
 * Synthetic anchors test transport identity, not target2016 hit geometry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {initializeAddSystems} from '../../packages/combat-core/add-systems.mjs';
import {startAddStarfall,startAddShootingChaser,addShootingChaserContact,CHASER_ATTACKER,STARFALL_CARRIER,
 STARFALL_ATTACK_SET} from '../../packages/combat-core/add-analysis-skills.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction,
 mergeOwnedActionActor} from '../../packages/online/owned-state.mjs';
const read=id=>JSON.parse(readFileSync(new URL('../../packages/combat-core/'+id+'-profile.json',import.meta.url)));
const base=read('rf'),mm=read('mm'),ca=read('ca'),lp=read('lp');
const map={sceneId:'analysis-wire-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(id='MM'){
 const profiles={RF:base,MM:mm,CA:ca,LP:lp};
 const sim=createSimulation({profile:base,map,preset:{passives:[],guildPassives:[]},actors:[
  {id:'add',team:0,position:[0,0,0],lineId:0},{id:'enemy',team:1,position:[200,0,0],lineId:0}]});
 const a=sim.actor('add'),b=sim.actor('enemy'),p=profiles[id];
 Object.assign(a,{professionId:id,profileId:p.profileId,stateSerial:7,skillScale:1.5});
 a.loadout=id==='MM'?[{skillId:29016},{skillId:29018}]:[];
 if(id==='MM'||id==='LP')initializeAddSystems(a);
 sim.profiles=profiles;sim.profileFor=actor=>profiles[actor.professionId]??base;
 sim.effectAnchorSampler=(_e,actor)=>({position:[actor.x,actor.y+80,actor.z],facing:actor.facing,rotation:[0,0,0]});
 const context={actors:sim.state.actors,profiles};
 const report=()=>JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:3,frameSeq:10})));
 const check=value=>{const result=validateOwnedState(value);validateOwnedReferences(result,a,p,map,context);return result;};
 return {sim,a,b,p,report,check,receive:value=>applyOwnedState(sim,a.id,check(value))};
}
test('actual Chaser owner snapshot keeps source contacts and remaps only local effect handles without mutating packet',()=>{
 const f=fixture();f.a.skillId=29018;assert.equal(startAddShootingChaser(f.sim,f.a),true);
 const original=f.sim.state.effects.find(e=>e.name===CHASER_ATTACKER);
 addShootingChaserContact(f.sim,f.a,f.b,original,[200,80,0]);const packet=f.report(),saved=structuredClone(packet);
 f.check(packet);f.sim.state.effects=[];f.sim.state.nextEffectId=9000;f.receive(packet);
 const rebuilt=f.sim.state.effects.find(e=>e.networkId===original.id);
 assert.equal(rebuilt.id,9000);assert.equal(f.a.sourceAddNative[0].attackerId,9000);assert.deepEqual(f.a.sourceAddNative[0].handles,[9000]);
 assert.deepEqual(f.a.sourceAddNative[0].records,[{targetId:'enemy',count:1,position:[200,80,0]}]);
 assert.deepEqual(packet,saved);
 const second=f.report();f.check(second);assert.equal(second.actor.sourceAddNative[0].attackerId,second.effects[0].id);
});
test('Starfall full snapshot and critical sample retain both original controller carriers and restore independent IDs',()=>{
 const f=fixture();f.a.skillId=29016;f.a.sourceAdd.formation=true;f.a.sourceAdd.dp=3000;f.a.sourceAdd.mutation=3;
 f.a.awakening.remaining=99999;
 startAddStarfall(f.sim,f.a,{consumeMutation:(a,n)=>{a.sourceAdd.mutation-=n;return n;}});
 const packet=f.report();f.check(packet);
 const action=encodeCriticalAction(packet,{id:1,effectIds:new Set()});
 assert.equal(action.actor.sourceAddNative.length,1);assert.equal(action.effects.filter(e=>e.name===STARFALL_CARRIER).length,2);
 f.check({...packet,actions:[action]});
 f.sim.state.effects=[];f.sim.state.nextEffectId=4000;f.receive(packet);
 assert.deepEqual(f.a.sourceAddNative[0].rows.map(q=>q.carrierId),[4000,4001]);
 assert.deepEqual(f.a.sourceAddNative[0].handles,[4000,4001]);
});
test('static analysis owner references reject foreign career, skill, target, source group, payload keys and wrong existing root ID',()=>{
 const f=fixture();f.a.skillId=29018;startAddShootingChaser(f.sim,f.a);const packet=f.report();
 const alter=[
  ['unknown controller key',p=>p.actor.sourceAddNative[0].unknown=1],
  ['owner as enemy target',p=>p.actor.sourceAddNative[0].targetId='add'],
  ['future source group',p=>p.actor.sourceAddNative[0].group=8],
  ['nonfinite power',p=>p.actor.sourceAddNative[0].power=Infinity],
  ['retention longer than source lifetime',p=>p.actor.sourceAddNative[0].remaining=1.1],
  ['wrong existing carrier root',p=>p.effects[0].name=STARFALL_CARRIER],
  ['effect from a different source group',p=>p.effects[0].ownerStateSerial++],
  ['effect with a different saved power',p=>p.effects[0].powerMultiplier=99],
  ['extra controller handle',p=>p.actor.sourceAddNative[0].handles.push(456)],
  ['attacker outside controller handles',p=>p.actor.sourceAddNative[0].attackerId=77],
  ['unbounded native direction',p=>p.actor.sourceAddNative[0].manualDirDegree=[1e200,0,0]]];
 for(const [label,change] of alter){
  const bad=structuredClone(packet);change(bad);
  assert.throws(()=>f.check(bad),{name:'TypeError',message:/analysis|chaser controller|actor-shape|owner-effect/i},label);
 }
 const old=f.a.loadout;f.a.loadout=[];assert.throws(()=>f.check(packet),/analysis-source/);f.a.loadout=old;
 const foreign=fixture('LP'),bad=foreign.report();bad.actor.sourceAddNative=packet.actor.sourceAddNative;
 assert.throws(()=>foreign.check(bad),/ANALYSIS controller|analysis|actor-shape/);
 const rf=fixture('RF'),other=rf.report();other.actor.sourceAddNative=[];assert.throws(()=>rf.check(other),/add-profession-state/);
});
test('a completed native attacker absent from the collision packet cannot become a guessed receiver-local handle',()=>{
 const f=fixture();f.a.skillId=29018;startAddShootingChaser(f.sim,f.a);const packet=f.report();packet.effects=[];
 f.sim.state.effects=[];f.sim.state.nextEffectId=5000;f.receive(packet);
 assert.deepEqual(f.a.sourceAddNative,[]);assert.equal(f.sim.state.nextEffectId,5000);
});
test('an absent static analysis lifecycle clears the old controller and critical actions cannot inherit a future cast',()=>{
 const f=fixture();f.a.skillId=29018;startAddShootingChaser(f.sim,f.a);const packet=f.report();
 const absent=structuredClone(packet);delete absent.actor.sourceAddNative;absent.effects=[];f.receive(absent);
 assert.equal(f.a.sourceAddNative,undefined);
 const merged=mergeOwnedActionActor(packet.actor,absent.actor);assert.equal(merged.sourceAddNative,undefined);
});
test('MM original target-mesh source IDs and posed anchors remap as one exact set instance',()=>{
 const f=fixture();f.sim.spawnSet(f.a,STARFALL_ATTACK_SET,1);
 const carrier=f.sim.state.effects.find(e=>e.name==='ADD_Star_Fall_Attack_Mesh_Attack');assert.ok(carrier);
 const child=f.sim.state.effects.find(e=>e.sourceBoneTargetMeshId===carrier.id);assert.ok(child);
 for(const e of [carrier,child])Object.assign(e,{active:true,birthAnchor:{position:[40,50,60],facing:1,rotation:[0,0,0]},
  currentAnchor:{position:[41,51,61],facing:1,rotation:[0,0,0]}});
 const packet=f.report();f.check(packet);f.sim.state.effects=[];f.sim.state.nextEffectId=6000;f.receive(packet);
 const local=f.sim.state.effects.find(e=>e.networkId===carrier.id),bound=f.sim.state.effects.find(e=>e.networkId===child.id);
 assert.equal(local.sourceBoneEffectSetId,local.id);assert.equal(bound.sourceBoneTargetMeshId,local.id);
 assert.deepEqual(bound.currentAnchor.position,[41,51,61]);
 const bad=structuredClone(packet);bad.effects.find(e=>e.id===child.id).sourceBoneTargetMeshId=999;
 assert.throws(()=>f.check(bad),/bone-target/);
});
test('MM bone-target registry is never accepted for an LP source even with copied declarations',()=>{
 const f=fixture();f.sim.spawnSet(f.a,STARFALL_ATTACK_SET,1);const packet=f.report();
 const foreign=fixture('LP'),bad=foreign.report();bad.effects=packet.effects;
 const p={...foreign.p,effectSets:{...foreign.p.effectSets,...mm.effectSets},effectTemplates:{...foreign.p.effectTemplates,...mm.effectTemplates}};
 assert.throws(()=>validateOwnedReferences(validateOwnedState(bad),foreign.a,p,map,{actors:foreign.sim.state.actors,profiles:{LP:p}}),/analysis-bone-target/);
});
test('exact declared CA TRACE_MATRIX target bone keeps a16-number matrix through owner roundtrip',()=>{
 const f=fixture('CA'),name='EffectSet_SI_SA_SCA_BLOOD_CUTTER_FX';f.sim.spawnSet(f.a,name,1);
 const e=f.sim.state.effects.find(e=>e.name==='BLOOD_CUTTER_W_P01');assert.ok(e);assert.equal(e.definition.TRACE_MATRIX,1);assert.ok(e.sourceBoneTargetMeshId);
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,20,30,40,1];
 Object.assign(e,{active:true,birthAnchor:{position:[20,30,40],facing:1,rotation:[0,0,0],matrix},
  currentAnchor:{position:[21,31,41],facing:1,rotation:[0,0,0],matrix:[...matrix]},sourcePosedAnchor:{position:[21,31,41],matrix:[...matrix]}});
 const packet=f.report();f.check(packet);f.receive(packet);
 const restored=f.sim.state.effects.find(row=>row.networkId===e.id);assert.deepEqual(restored.currentAnchor.matrix,matrix);
 for(const invalid of [[1,2,3],Array(16).fill(NaN),'matrix']){
  const bad=structuredClone(packet);bad.effects.find(row=>row.id===e.id).currentAnchor.matrix=invalid;
  assert.throws(()=>f.check(bad),/shape|matrix/);
 }
});
test('an undeclared MM TRACE_MORE sibling cannot inject a target matrix',()=>{
 const f=fixture();f.sim.spawnSet(f.a,STARFALL_ATTACK_SET,1);
 const e=f.sim.state.effects.find(e=>e.sourceBoneTargetMeshId&&e.definition.TRACE_MATRIX!==1);assert.ok(e);
 e.birthAnchor={position:[0,0,0],facing:1,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
 assert.throws(()=>f.check(f.report()),/matrix-source/);
});
