/** Disclosed receiver-time regressions, not original-client timing evidence.
 * Optional RF_START_AGE_IMPLEMENTATION_ROOT makes the same assertions a red
 * check against an immutable pre-fix checkout. No expected result is sampled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,encodeEffectState} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
const root=process.env.RF_START_AGE_IMPLEMENTATION_ROOT;
const {createRemoteCombatPlayback}=await import(root?pathToFileURL(resolve(root,'apps/web/remote-combat-playback.mjs')):
  new URL('../../apps/web/remote-combat-playback.mjs',import.meta.url));
const base=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url))),dt=1/60;
function fixture(){
  const profile=structuredClone(base);
  profile.states.TEST_ATTACK={animationName:'Wait',raw:{ANIM_NAME:'Wait',ANIM_SPEED:1,PLAY_TYPE:2,APPLY_ANIM_MOVE:0,
    ATTACK_TIME0:{1:.12,2:.22},DAMAGE_DATA:structuredClone(base.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA)}};
  const sim=createSimulation({profile,seed:2016,networkOwnerId:'local',preset:{passives:[],guildPassives:[]},
    map:{sceneId:'start-age-disclosed',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    collisionSampler:a=>[{kind:'sphere',center:[a.x+30,50,0],radius:30}],
    defenderSampler:a=>[{kind:'sphere',center:[a.x,a.y+50,a.z],radius:20}],actors:[
      {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'local',team:1,position:[4000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const a of sim.state.actors){a.inputLock=0;sim.enter(a,'RSI_WAIT','disclosed-fixture');}sim.drainEvents();
  let now=0,epoch=1;const playback=createRemoteCombatPlayback({clock:()=>now});playback.bind(sim,'local',()=>epoch);
  const report=frame=>encodeOwnedState(sim,'remote',{epoch,frameSeq:frame});
  const action=(frame,{start=true,held=[],effects=[]}={})=>{const a=encodeCriticalAction(report(frame),{id:frame});
    Object.assign(a.actor,{state:'TEST_ATTACK',stateSerial:100+frame,animationName:'Wait',animationPlaybackSpeed:1,animationSpeedRamp:null});
    a.playback={version:1,start,held};a.effects=effects;return a;};
  const before=()=>playback.beforeStep(sim,'local',()=>epoch),step=()=>{
    before();sim.step(dt,playback.remoteInputs(sim,'local'),{snapshot:false});playback.afterStep(sim);now+=1000/60;};
  return {sim,playback,report,action,before,step,setNow:v=>now=v,setEpoch:v=>epoch=v,
    witness:(frame)=>playback.observeSource('remote',epoch,frame),
    receive:(a,envelope=a.frameSeq)=>playback.receiveActions('remote',[a],epoch,envelope),
    motion:frame=>playback.observeMotion(sim,'remote',encodeOwnedMotion(report(frame),{held:[]}),'local')};
}
for(const elapsed of [0,.001])test(`strict age threshold: source16/action1 plus ${elapsed}ms receipt silence`,()=>{
  const f=fixture();f.witness(16);f.setNow(elapsed);f.receive(f.action(1));f.before();
  assert.equal(f.playback.diagnostics.starts,elapsed===0?1:0);assert.equal(f.playback.diagnostics.expired,elapsed===0?0:1);
});
for(const evidence of ['source','motion','full-state','action-envelope'])test(`${evidence} receipt age prevents the known 700ms replayed attack window`,t=>{
  const f=fixture();f.setNow(271.8154667);
  if(evidence==='motion')f.motion(16);
  else if(evidence==='full-state')f.playback.observeState(f.sim,'remote',f.report(16),'local');
  else if(evidence==='action-envelope')f.playback.receiveActions('remote',[],1,16);
  else f.witness(16);
  f.setNow(400);f.sim.actor('local').x=30;const hp=f.sim.actor('local').hp;
  f.setNow(700);f.receive(f.action(1,{held:['Z'],effects:[{id:99,dead:true,endEmitted:true}]}));
  const trace=[];for(let i=0;i<15;i++){f.step();trace.push({i,state:f.sim.actor('remote').state,phase:f.sim.actor('remote').stateTime,hp:f.sim.actor('local').hp});}
  t.diagnostic(JSON.stringify({evidence,trace,diagnostics:f.playback.diagnostics}));
  assert.equal(f.sim.actor('local').hp,hp,'old source window must not hit a later arrival');assert.equal(f.playback.diagnostics.starts,0);
  assert.equal(f.playback.diagnostics.expired,1);assert.equal(f.playback.diagnostics.owners.remote.tombstones,1);
  assert.deepEqual(f.playback.remoteInputs().remote.held,[]);
});
test('equal/older source or duplicate envelope never refresh the witness receipt',()=>{
  const f=fixture();f.witness(16);f.setNow(400);f.witness(16);f.witness(12);
  f.playback.receiveActions('remote',[],1,16);f.receive(f.action(15));f.before();
  assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.expired,1);
});
test('reanchoring to a newer source frame cannot revive an already expired old Start',()=>{
  const f=fixture();f.setNow(271);f.witness(16);f.setNow(743);f.witness(22);
  f.receive(f.action(15));f.before();assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.expired,1);
});
test('a queued old Start retains expiration through a newer anchor',()=>{
  const f=fixture();f.witness(16);f.setNow(300);f.receive(f.action(15));f.setNow(400);f.witness(22);f.before();
  assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.expired,1);
  assert.equal(f.playback.diagnostics.expiredWitnessedStarts,1);assert.equal(f.playback.diagnostics.expiredAdditionalAge,0);
});
test('long source pause expires only witnessed frames and accepts the genuinely new frame',()=>{
  const f=fixture();f.witness(16);f.setNow(10000);f.receive(f.action(17));f.before();
  assert.equal(f.playback.diagnostics.starts,1);assert.equal(f.playback.diagnostics.expired,0);
  assert.equal(f.playback.diagnostics.owners.remote.expiredStartThroughFrame,16);
});
test('new life and clear discard the old life witness; old epochs cannot renew it',()=>{
  const f=fixture();f.witness(16);f.setNow(1000);f.before();f.setEpoch(2);
  f.playback.reset('remote',2);assert.equal(f.playback.observeSource('remote',1,999),false);
  f.receive(f.action(1));f.before();assert.equal(f.playback.diagnostics.starts,1);
  f.playback.clear();f.playback.bind(f.sim,'local',()=>2);f.setNow(2000);f.receive(f.action(2));f.before();
  assert.equal(f.playback.diagnostics.starts+f.playback.diagnostics.adoptedStarts,1);
});
test('without an earlier witness the first receipt does not invent an absolute age',()=>{
  const f=fixture();f.setNow(700);f.receive(f.action(1));f.before();assert.equal(f.playback.diagnostics.starts,1);
});
test('new silence evidence does not discard a non-Start control or its release/terminal',()=>{
  const f=fixture();f.witness(16);f.setNow(700);f.receive(f.action(15,{start:false,held:['RIGHT'],effects:[{id:99,dead:true,endEmitted:true}]}));
  f.before();assert.equal(f.playback.diagnostics.played,1);assert.equal(f.playback.diagnostics.expired,0);
  assert.deepEqual(f.playback.remoteInputs().remote.held,['RIGHT']);assert.equal(f.playback.diagnostics.owners.remote.tombstones,1);
});
test('later non-Start snapshots cannot revive an expired controller or birth, but a fresh Start can hit',()=>{
  const producer=fixture(),f=fixture(),source=producer.sim.actor('remote');source.stateSerial=101;
  const effect=producer.sim.createEffect(source,structuredClone(base.effectSets.EffectSet_RAVEN_HYPER_AURA.raw.EFFECT0),
    {setName:'EffectSet_RAVEN_HYPER_AURA',clock:'custom',start:0}),state=encodeEffectState(effect,base);
  state.id=400;assert.equal(state.ownerStateSerial,101);
  f.witness(16);f.setNow(700);f.sim.actor('local').x=30;const hp=f.sim.actor('local').hp;
  f.receive(f.action(1,{effects:[state]}));f.step();
  const later=f.action(22,{start:false,effects:[state,{...state,id:401}]});later.actor.stateSerial=101;f.receive(later);
  for(let i=0;i<15;i++)f.step();
  assert.equal(f.sim.actor('local').hp,hp);assert.equal(f.sim.state.effects.length,0);
  assert.equal(f.playback.diagnostics.starts,0);assert.equal(f.playback.diagnostics.births,0);
  assert.equal(f.playback.diagnostics.owners.remote.tombstones,2);
  f.receive(f.action(23));for(let i=0;i<15;i++)f.step();
  assert.equal(f.playback.diagnostics.starts,1);assert.ok(f.sim.actor('local').hp<hp,'a newer valid Start retains current-time collision');
});
test('source age evidence is isolated by owner',()=>{
  const f=fixture();f.sim.state.actors.push({...structuredClone(f.sim.actor('remote')),id:'other',x:-1000});
  f.witness(16);f.setNow(700);f.receive(f.action(1));
  f.playback.receiveActions('other',[f.action(1)],1,1);f.before();
  assert.equal(f.playback.diagnostics.expiredWitnessedStarts,1);assert.equal(f.playback.diagnostics.starts,1);
  assert.equal(f.playback.diagnostics.owners.remote.controller,null);assert.equal(f.playback.diagnostics.owners.other.controller,101);
});
test('clear then a new simulation with the same owner and epoch accepts a low source frame',()=>{
  const old=fixture(),next=fixture();old.witness(99);old.setNow(1000);old.before();old.playback.clear();
  old.playback.bind(next.sim,'local',()=>1);old.playback.receiveActions('remote',[next.action(1)],1,1);
  old.playback.beforeStep(next.sim,'local',()=>1);assert.equal(old.playback.diagnostics.starts,1);
  assert.equal(old.playback.diagnostics.owners.remote.expiredStartThroughFrame,-1);
});
