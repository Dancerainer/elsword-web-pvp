/** Native Web simulation/lifecycle regressions, not original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import {make as rfFixture} from '../helpers/rf-passive-fixture-v12.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const hit={DAMAGE:{PHYSIC:.1},DAMAGE_TYPE:0,REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0,FORCE_DOWN:0};
function escape(f){
  f.b.x=f.a.x-100;f.sim.rng=()=>0;
  f.sim.applyHit(f.b,f.a,hit,{kind:'character',powerMultiplier:1});
  assert.equal(f.a.sourceShadowStep.key,null);assert.equal(f.a.skillId,24217);
  return encodeOwnedState(f.sim,'bm',{epoch:1,frameSeq:1});
}
function completed(f){
  let frame=1;
  while(f.a.sourceShadowStep&&frame<120){f.sim.step(1/60,{bm:{held:[]}},{snapshot:false});frame++;}
  assert.equal(Object.hasOwn(f.a,'sourceShadowStep'),false,'actual Shadow lifecycle must end');
  return encodeOwnedState(f.sim,'bm',{epoch:1,frameSeq:frame});
}
const check=(packet,f)=>validateOwnedReferences(packet,f.a,f.profile,f.map);

test('BM passive exit clears coordinator state and full room snapshot without losing frozen eligibility',t=>{
  const owner=bmFixture({skillId:24033,passives:[24410]}),server=bmFixture({skillId:24033,passives:[24410]});
  const players=server.sim.state.actors.map(a=>({id:a.id,team:a.team}));
  const pvp=new PvpMatch({players,map:server.map,mode:'1v1',seed:16,
    versions:{...server.sim.versions,referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
  const driver=createLocalOwnerBattleDriver({match:{id:'bm-escape-lifecycle',players},simulation:server.sim,pvp,manual:true,emit(){},finish(){}});
  t.after(()=>driver.stop());for(const p of players)driver.ready(p.id);driver.tick(10);
  const submit=owner=>driver.submitInput('bm',{frames:[{held:[],frameSeq:owner.frameSeq}],owner});
  const first=escape(owner);assert.equal(submit(first).accepted,true);
  assert.equal(server.a.sourceShadowStep.key,null);
  const last=completed(owner);assert.doesNotThrow(()=>check(last,server));assert.equal(submit(last).accepted,true);
  const state=driver.snapshot(),actor=state.snapshot.actors.find(a=>a.id==='bm');
  assert.doesNotThrow(()=>check({...state.owners.bm,actor},server),'full coordinator snapshot must remain valid after the native escape ends');
  assert.equal(Object.hasOwn(actor,'sourceShadowStep'),false);
  assert.equal(actor.passivePolicy.bladeMaster.escapeChance,server.a.passivePolicy.bladeMaster.escapeChance);
  assert.deepEqual(actor.loadout,server.a.loadout);
});

test('browser compact-room cache retires ended passive escape after authoritative owner update',async t=>{
  const owner=bmFixture({skillId:24033,passives:[24410]}),sources=[],events=[],errors=[];
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,callback){this.listeners.set(type,callback);}close(){}}
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,
    fetch:async()=>({ok:true,json:async()=>({available:true,accepted:true})}),
    onEvent:(type,data)=>events.push({type,data}),onError:error=>errors.push(error)});
  t.after(()=>client.close());await client.open();await client.setMatch({id:'bm-cache',ownership:'local-owner-v1',players:[{id:'me'},{id:'bm'}]},'me');
  const send=(type,data)=>sources[0].listeners.get(type)({data:JSON.stringify(data)});
  const first=escape(owner),saved=structuredClone(owner.a),ownership={mode:'local-owner-v1',actors:{bm:{epoch:1,frameSeq:1}}};
  send('state',{matchId:'bm-cache',snapshot:{actors:[saved]},ownership,owners:{}});
  send('state',{matchId:'bm-cache',snapshotDelta:true,snapshot:{actors:[{id:'bm',pvpDead:false}]},owners:{},ownership});
  assert.equal(events.filter(e=>e.type==='state').at(-1).data.snapshot.actors[0].sourceShadowStep.key,null,
    'a partial room lifecycle packet cannot clear an active owner state');
  const last=completed(owner);send('owned-state',{matchId:'bm-cache',playerId:'bm',report:last});
  send('state',{matchId:'bm-cache',snapshotDelta:true,snapshot:{actors:[{id:'bm',pvpDead:false}]},owners:{},ownership:{...ownership,actors:{bm:{epoch:1,frameSeq:last.frameSeq}}}});
  const actor=events.filter(e=>e.type==='state').at(-1).data.snapshot.actors[0];
  assert.deepEqual(errors,[]);assert.equal(Object.hasOwn(actor,'sourceShadowStep'),false);
  assert.doesNotThrow(()=>check({...last,actor},owner));
  assert.equal(actor.profileId,saved.profileId);assert.deepEqual(actor.passivePolicy,saved.passivePolicy);
});

test('current BM passive escape cannot contaminate an earlier real command action during history validation',()=>{
  const owner=bmFixture({skillId:24217,passives:[24410]});
  const old=encodeOwnedState(owner.sim,'bm',{epoch:1,frameSeq:0});
  const current=escape(owner);current.actions=[encodeCriticalAction(old,{id:1})];
  assert.doesNotThrow(()=>validateOwnedState(current));assert.doesNotThrow(()=>check(current,owner));
  assert.equal(current.actor.sourceShadowStep.key,null,'validation must not mutate the current authoritative actor');
  const last=completed(owner);last.actions=[encodeCriticalAction(current,{id:2,frameSeq:1})];
  assert.doesNotThrow(()=>validateOwnedState(last));assert.doesNotThrow(()=>check(last,owner));
});

test('historical passive Shadow Step still requires the actual passive when the active skill happens to be equipped',()=>{
  const owner=bmFixture({skillId:24217,passives:[24410]}),withoutPassive=bmFixture({skillId:24217,passives:[]});
  const first=escape(owner),last=completed(owner);last.actions=[encodeCriticalAction(first,{id:1})];
  assert.doesNotThrow(()=>check(last,owner));
  assert.throws(()=>check(last,withoutPassive),/unconfigured-owner-passive-shadow-step/);
});

for(const [skillId,active,ended,fields]of [
  [24203,a=>!!a.sourceMegaDrill,a=>!a.sourceMegaDrill,['sourceMegaDrill','sourceMegaDrillNowSupported']],
  [24009,a=>a.sourceWildChargeEffectGroup?.length>0&&Object.hasOwn(a,'skillSuperArmorNotRed'),
    a=>a.state==='RSI_SA_RRF_WILD_CHARGE_DASH',['sourceWildChargeEffectGroup','skillSuperArmorNotRed']],
])test(`RF ${skillId} native skill exit retires deleted owner controls in the coordinator copy`,async()=>{
  const source=await rfFixture({skillId,passives:[],positions:[[2022.98,2840,0],[0,2840,0]]}),receiver=await rfFixture({skillId,passives:[]});
  const actor=source.actor('rf');let frame=0;
  do{source.step(1/60,{rf:{held:['A'],pressed:frame===0?['A']:[]}},{snapshot:false});frame++;}while(!active(actor)&&frame<180);
  assert.ok(active(actor),'real native skill must create its transient controls');
  const first=encodeOwnedState(source,'rf',{epoch:1,frameSeq:frame});applyOwnedState(receiver,'rf',first,{effects:false});
  for(const field of fields)assert.ok(Object.hasOwn(receiver.actor('rf'),field),field+' starts');
  do{source.step(1/60,{rf:{held:[],released:['A']}},{snapshot:false});frame++;}while(!ended(actor)&&frame<480);
  assert.ok(ended(actor),'actual native exit must run');
  const last=encodeOwnedState(source,'rf',{epoch:1,frameSeq:frame});applyOwnedState(receiver,'rf',last,{effects:false});
  for(const field of fields){assert.equal(Object.hasOwn(last.actor,field),false,field+' source ended');
    assert.equal(Object.hasOwn(receiver.actor('rf'),field),false,field+' receiver ended');}
  assert.deepEqual(receiver.actor('rf').loadout,source.actor('rf').loadout);
});
