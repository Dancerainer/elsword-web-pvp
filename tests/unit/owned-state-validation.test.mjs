/** Wire contract and fail-before-mutation regressions; these are not measured
 * native trajectories. Native compatibility is tested by owned-state-native. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState,MAX_OWNER_BYTES} from '../../packages/online/owned-state.mjs';
import {requestActorStop,advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'owned-validation-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const simulation=createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[
    {id:'sender',team:0,position:[0,0,0],lineId:0},{id:'receiver',team:1,position:[1000,0,0],lineId:0}]});
  const report=()=>encodeOwnedState(simulation,'sender',{epoch:1,frameSeq:1});
  const receive=value=>{const verified=validateOwnedState(value);validateOwnedReferences(verified,simulation.actor('sender'),simulation.profile,simulation.map);return applyOwnedState(simulation,'sender',verified);};
  return {simulation,report,receive};
}
test('nested owner actor malformed containers and scalars are rejected before any receiving actor changes',()=>{
  const replacements=[['core',null],['core','abc'],['awakening','abc'],['cooldowns',null],['knockdown',null],
    ['manaBreak',null],['buffs',{}],['buffs',[{}]],['landPosition',[0,0]],['hits',[]],['tapTimes','abc'],
    ['pendingPressed',{}],['buffControls',null],['sourceArcEnemy',{data:{},effects:[]}],['sourceWildCharge',[]]];
  for(const [field,value]of replacements){const f=fixture(),before=f.simulation.snapshot(),report=f.report();report.actor[field]=value;
    assert.throws(()=>f.receive(report),/invalid-owner-actor-shape/,field);assert.deepEqual(f.simulation.snapshot(),before,field);}
  for(const [field,key,value]of [['awakening','orbs',4],['core','gauge','bad'],['knockdown','activated',{}],
    ['manaBreak','charge','bad'],['cooldowns','24025',{}],['core','helper',{attackTime:'bad'}]]){
    const f=fixture(),before=f.simulation.snapshot(),report=f.report();report.actor[field][key]=value;
    assert.throws(()=>f.receive(report),/invalid-owner-actor-shape/,field+'.'+key);assert.deepEqual(f.simulation.snapshot(),before);
  }
});
test('required actor structures cannot be silently omitted and signed native clock residuals remain valid',()=>{
  const f=fixture();for(const field of ['core','awakening','manaBreak','knockdown','buffs','landPosition']){
    const report=f.report();delete report.actor[field];assert.throws(()=>validateOwnedState(report),/invalid-owner-actor-shape/);
  }
  const report=f.report();report.actor.core.guardRemaining=-1e-7;report.actor.animationOneshotTimer=-1e-7;
  report.actor.cooldowns['24025']=-1e-7;assert.doesNotThrow(()=>f.receive(report));
});
test('full and critical owner STOP inputs match the playback projection range before mutation',()=>{
  for(const field of ['hitStop','worldStop']){
    for(const value of [-1,3600.000001,Infinity,NaN]){
      const f=fixture(),before=f.simulation.snapshot(),report=f.report();report.actor[field]=value;
      assert.throws(()=>f.receive(report),/invalid-owner-(?:stop-projection|actor-shape)/);
      assert.throws(()=>validateOwnedReferences(report,f.simulation.actor('sender'),profile,map),/invalid-owner-stop-projection/);
      assert.deepEqual(f.simulation.snapshot(),before);
      const nested=f.report();nested.actions=[encodeCriticalAction(nested,{id:1})];nested.actions[0].actor[field]=value;
      assert.throws(()=>validateOwnedState(nested),/invalid-owner-(?:stop-projection|actor-shape)/);
      assert.deepEqual(f.simulation.snapshot(),before);
    }
    for(const value of [0,3600]){
      const f=fixture(),report=f.report();report.actor[field]=value;
      assert.doesNotThrow(()=>f.receive(report));
    }
  }
});

test('a full owner STOP projection retires prior receiver queues before the next ordinary gate',()=>{
  for(const channel of ['hit','world'])for(const incoming of [0,.5]){
    const f=fixture(),actor=f.simulation.actor('sender'),report=f.report();
    // Both a last zero masking a new positive value, and an old positive
    // reviving a received zero, must be discarded at the Web authority swap.
    requestActorStop(actor,channel,.9,'receiver');
    if(incoming>0)requestActorStop(actor,channel,0,'receiver');
    report.actor[channel==='hit'?'hitStop':'worldStop']=incoming;
    f.receive(report);
    assert.equal(actor.sourceStopQueues,undefined,'a decoded owner projection replaces the local channels');
    assert.equal(advanceActorStops(actor,.25),incoming>.25?0:.25);
    assert.equal(actor[channel==='hit'?'hitStop':'worldStop'],Math.max(0,Math.fround(incoming-.25)));
  }
});
test('effect mutable containers, vectors and clocks have a schema instead of accepting arbitrary JSON',()=>{
  const replacements=[['hits',null],['hitGaps',[]],['childCounts','bad'],['position',[0,0]],['birthAnchor',{position:'bad'}],
    ['currentAnchor',{position:[0,0]}],['deleteConditions',{}],['soundFired',null],['active',{}],['elapsed','bad'],['clock','bad'],['ownerStateSerial','bad']];
  for(const [field,value]of replacements){const f=fixture(),report=f.report();report.effects=[{id:1,name:'wire-fixture',...{[field]:value}}];
    const before=f.simulation.snapshot();assert.throws(()=>f.receive(report),/invalid-owner-effect-shape/,field);assert.deepEqual(f.simulation.snapshot(),before);}
});
test('owner size limits count UTF8 bytes and reject multibyte reports that fit the UTF16 character count',()=>{
  const f=fixture(),report=f.report();report.effects=[{id:1,name:'wire-fixture',payload:Array(70).fill('\uad0e'.repeat(500))}];
  const wire=JSON.stringify(report);assert.ok(wire.length<MAX_OWNER_BYTES);assert.ok(Buffer.byteLength(wire,'utf8')>MAX_OWNER_BYTES);
  assert.throws(()=>validateOwnedState(report),/owner-state-too-large/);
});
test('map support, equipped skill and original buff references are checked before applying a report',()=>{
  const f=fixture(),before=f.simulation.snapshot();
  for(const field of ['lineId','lastTouchLineId','ignoreLineId']){const report=f.report();report.actor[field]=99;assert.throws(()=>f.receive(report),/unknown-owner-line/);}
  const report=f.report();report.actor.skillId=999999;assert.throws(()=>f.receive(report),/unconfigured-owner-skill/);
  const buff={schemaVersion:1,templateId:999999,factorId:null,skillLevel:1,sourceActorId:'sender',targetActorId:'sender',
    accumulationLimit:1,resistance:0,durationMultiplier:1,behaviors:[],finalizers:[{kind:'time',sourceDuration:1,remaining:1}],displayer:{}};
  report.actor.skillId=null;report.actor.buffs=[buff];assert.throws(()=>f.receive(report),/unknown-owner-buff/);
  buff.templateId=Number(Object.keys(f.simulation.profile.buffTemplates)[0]);buff.targetActorId='receiver';assert.throws(()=>f.receive(report),/invalid-owner-buff-target/);
  assert.deepEqual(f.simulation.snapshot(),before);
});

test('public validation detaches nested action samples and effects from both caller and live actor',()=>{
  const f=fixture(),report=f.report(),before=f.simulation.snapshot();
  report.effects=[{id:1,name:'wire-fixture',position:[1,2,3],payload:{clock:4}}];
  report.actions=[{id:1,frameSeq:1,actor:{core:structuredClone(report.actor.core)},
    effects:[{id:2,name:'wire-history',position:[4,5,6],payload:{clock:7}}]}];
  const verified=validateOwnedState(report);
  report.actor.core.gauge=91;report.effects[0].position[0]=92;
  report.actions[0].actor.core.gauge=93;report.actions[0].effects[0].payload.clock=94;
  assert.equal(verified.actor.core.gauge,before.actors[0].core.gauge);
  assert.equal(verified.effects[0].position[0],1);
  assert.equal(verified.actions[0].actor.core.gauge,before.actors[0].core.gauge);
  assert.equal(verified.actions[0].effects[0].payload.clock,7);
  verified.actor.landPosition[0]=95;verified.actions[0].effects[0].position[0]=96;
  assert.deepEqual(f.simulation.snapshot(),before);
  assert.equal(report.actions[0].effects[0].position[0],4);
});

test('recursive action samples retain schema, prototype, tree and UTF8 limits before receiver mutation',()=>{
  const corruptions=[
    action=>{action.actor.core={gauge:'bad'};},
    action=>{action.effects[0].payload=Object.create({inherited:true});},
    action=>{let nested={};action.effects[0].payload=nested;for(let i=0;i<20;i++)nested=nested.next={};},
    action=>{action.effects[0].payload=Array(70).fill('\uad0e'.repeat(500));},
  ];
  for(const corrupt of corruptions){
    const f=fixture(),before=f.simulation.snapshot(),report=f.report();
    report.actions=[{id:1,frameSeq:1,actor:{},effects:[{id:2,name:'wire-history',payload:{}}]}];
    corrupt(report.actions[0]);
    assert.throws(()=>f.receive(report),/invalid-owner-actor-shape|invalid-owner-object|owner-state-too-deep|owner-state-too-large/);
    assert.deepEqual(f.simulation.snapshot(),before);
  }
});
