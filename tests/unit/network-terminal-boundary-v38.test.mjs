/** Actual ownership and playback consumer; only delivery order is controlled.
 * No historical Native step, renderer, WAN or original client is exercised. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {encodeOwnedState,encodeCriticalAction,encodeEffectState} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'terminal-boundary-v38',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const sync=createLocalOwnershipSync({combatPlaybackVersion:1,ownerStatusVersion:1,clock:()=>0});
  const state=()=>({snapshot:sim.snapshot(),owners:{},pvp:{phase:'fight'},ownership:{mode:'local-owner-v1',ownerStatusVersion:1,combatPlaybackVersion:1,
    actors:{remote:{epoch:1,frameSeq:0},local:{epoch:1,frameSeq:0}}}});
  sync.reconcile(sim,state(),'local');sim.drainEvents();
  const action=(id,frame,effects=[],start=false)=>{const report=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame}),value=encodeCriticalAction(report,{id,frameSeq:frame});
    value.effects=effects;value.playback={version:1,start,held:['X','RIGHT']};if(start)Object.assign(value.actor,{state:'RSI_COMBO_Z',stateSerial:900+id,
      animationName:profile.states.RSI_COMBO_Z.animationName,stateTime:0,animationTime:0});return value;};
  const effect=()=>sim.createEffect(sim.actor('remote'),structuredClone(profile.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),
    {setName:'EffectSet_RAVEN_HYPER_AURA',clock:'custom',start:0});
  return {sim,sync,action,effect};
}
test('slow-boundary drain retires queued terminals for a living owner without replaying starts, births or advancing clocks',()=>{
  const f=fixture();f.sync.beforeStep(f.sim,'local');const effect=f.effect();effect.elapsed=.7;effect.hits.local=.3;effect.hitGaps={local:2};
  const state={...encodeEffectState(effect,profile),id:400};f.sync.receiveActions('remote',[f.action(1,1,[state])],1,1);f.sync.beforeStep(f.sim,'local');
  assert.equal(effect.networkId,400);assert.ok(f.sim.state.effects.includes(effect));assert.notEqual(effect.dead,true);
  const terminal={...state,dead:true,endEmitted:true,active:false},birth={...state,id:500};
  f.sync.receiveActions('remote',[f.action(2,2,[birth],true),f.action(3,3,[terminal],true)],1,3);
  const before=structuredClone(f.sim.state.actors),time=f.sim.state.time,frame=f.sync.combatPlaybackDiagnostics.receiver.localFrame,events=f.sim.state.events.length;
  f.sync.beforeTerminalStep(f.sim,'local');
  assert.deepEqual(f.sim.state.actors,before);assert.equal(f.sim.state.time,time);assert.equal(f.sim.state.events.length,events);
  assert.equal(f.sync.combatPlaybackDiagnostics.receiver.localFrame,frame);assert.equal(f.sync.combatPlaybackDiagnostics.receiver.pending,0);
  assert.equal(effect.dead,true);assert.equal(effect.suppressSecondaryDamage,true);assert.equal(effect.elapsed,.7);
  assert.equal(effect.hits.local,.3);assert.equal(effect.hitGaps.local,2);assert.ok(!f.sim.state.effects.some(row=>row.networkId===500));
  assert.deepEqual(f.sync.remoteInputs(f.sim,'local').remote.held,[]);f.sync.clear();
});
test('late slow delivery consumes terminals from a mixed start packet immediately without suppressing another live projectile',()=>{
  const f=fixture();f.sync.beforeStep(f.sim,'local');const first=f.effect(),second=f.effect();
  const a={...encodeEffectState(first,profile),id:400},b={...encodeEffectState(second,profile),id:401};
  f.sync.receiveActions('remote',[f.action(1,1,[a,b])],1,1);f.sync.beforeStep(f.sim,'local');
  const before=structuredClone(f.sim.state.actors),localTime=f.sync.combatPlaybackDiagnostics.receiver.localFrame;
  const mixed=f.action(2,2,[{...a,dead:true,endEmitted:true,active:false},{...b,id:500}],true);
  assert.equal(f.sync.receiveTerminals(f.sim,'remote',[mixed],1,2,'local'),true);
  assert.equal(first.dead,true);assert.equal(first.suppressSecondaryDamage,true);assert.ok(f.sim.state.effects.includes(second));assert.notEqual(second.dead,true);
  assert.ok(!f.sim.state.effects.some(row=>row.networkId===500));assert.deepEqual(f.sim.state.actors,before);
  assert.equal(f.sync.combatPlaybackDiagnostics.receiver.localFrame,localTime);
  assert.equal(f.sync.receiveTerminals(f.sim,'remote',[mixed],1,2,'local'),true);assert.notEqual(second.dead,true);
  f.sync.clear();
});
test('terminal arrival before the first playback step binds the server life and tombstones an unknown birth',()=>{
  const f=fixture(),wire=encodeEffectState(f.effect(),profile);wire.id=900;
  // This fixture-created local prediction predates playback binding; remove it
  // so the wire terminal names an identity with no local birth at all.
  f.sim.state.effects=[];
  const end=f.action(1,1,[{...wire,dead:true,endEmitted:true,active:false}]);
  assert.equal(f.sync.receiveTerminals(f.sim,'remote',[end],1,1,'local'),true);
  assert.equal(f.sync.combatPlaybackDiagnostics.receiver.localFrame,0);
  assert.equal(f.sync.receiveTerminals(f.sim,'remote',[end],0,1,'local'),false);
  assert.equal(f.sync.receiveTerminals(f.sim,'remote',[end],2,1,'local'),false);
  assert.equal(f.sync.receiveTerminals(f.sim,'local',[end],1,1,'local'),false);
  assert.equal(f.sync.receiveTerminals(f.sim,'unknown',[end],1,1,'local'),false);
  f.sync.receiveActions('remote',[f.action(2,2,[wire])],1,2);f.sync.beforeStep(f.sim,'local');
  assert.ok(!f.sim.state.effects.some(row=>row.networkId===900));f.sync.clear();
});
test('malformed terminal batches and legacy rooms never enter the new consumer',()=>{
  const f=fixture();assert.equal(f.sync.receiveTerminals(f.sim,'remote',[{id:1}],1,1,'local'),false);
  const legacy=createLocalOwnershipSync();assert.equal(legacy.receiveTerminals(f.sim,'remote',[],1,1,'local'),false);
  assert.equal(legacy.beforeTerminalStep(f.sim,'local'),0);legacy.clear();f.sync.clear();
});
