/** Real RF damage declarations with explicit fixed sphere geometry. These are
 * current Web receiver checks, not original-client or WAN measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,encodeEffectState} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'v55-local-effect-phase',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},
    effectSampler:()=>[{kind:'sphere',center:[30,50,0],radius:30}],
    defenderSampler:a=>[{kind:'sphere',center:[a.x,a.y+50,a.z],radius:20}],
    actors:[{id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const a of sim.state.actors){a.inputLock=0;sim.enter(a,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>1);
  const source=sim.actor('remote'),victim=sim.actor('local');
  const effect=sim.createEffect(source,{NAME:'DAMAGE_EFFECT_POWER_ASSAULT'},{clock:'custom',start:0,
    birthAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1}});
  let frame=1;
  function control(stage,{terminal=false}={}){
    const state=encodeEffectState(effect,profile,source);Object.assign(state,{id:400,stage});
    if(terminal)Object.assign(state,{dead:true,endEmitted:true,active:false});
    const action=encodeCriticalAction(encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame}),{id:frame});
    action.effects=[state];action.playback={version:1,start:false,held:[]};
    assert.equal(playback.receiveActions('remote',[action],1,frame),true);
    playback.beforeStep(sim,'local',()=>1);
  }
  function step(count=1){for(let i=0;i<count;i++){
    frame++;playback.beforeStep(sim,'local',()=>1);sim.step(1/60,playback.remoteInputs(sim,'local'),{snapshot:false});playback.afterStep(sim);
  }}
  function moveVictim(x){victim.x=x;victim.landPosition=[x,0,0];}
  control(0);sim.drainEvents();
  return {sim,playback,source,victim,effect,control,step,moveVictim};
}

test('an ahead source NEXT cannot replace the locally visible Power Assault contact stage',()=>{
  const f=fixture();f.step(25);
  assert.equal(f.effect.stage,0);assert.ok(f.effect.animationTime>.4&&f.effect.animationTime<.75);
  const clock=f.effect.animationTime,hp=f.victim.hp;
  f.control(1);
  assert.equal(f.effect.stage,0,'NEXT remains owned by the receiver positive effect clock');
  assert.equal(f.effect.animationTime,clock);assert.equal(f.victim.hp,hp,'receiving control cannot settle damage');
  f.moveVictim(30);f.step();
  const hit=f.sim.state.events.find(e=>e.type==='hit'&&e.targetId==='local');
  assert.ok(hit,'current local geometry enters the real attack window');
  assert.equal(hit.data.REACT_TYPE,profile.damageEffects.DAMAGE_EFFECT_POWER_ASSAULT.raw.DAMAGE_DATA.REACT_TYPE);
  assert.equal(hit.data.RE_ATTACK,1,'early network NEXT cannot remove the repeated contact phase');
});

test('a behind source NEXT cannot rewind a locally completed phase or clear its accepted hit memory',()=>{
  const f=fixture();f.step(48);assert.equal(f.effect.stage,1);
  f.moveVictim(30);f.step();assert.ok(f.victim.hp<50000);
  const receipt={hits:structuredClone(f.effect.hits),hitGaps:structuredClone(f.effect.hitGaps),memory:structuredClone(f.effect.sourceHitMemory2016)},hp=f.victim.hp;
  assert.ok(receipt.memory.length>0);
  f.control(0);
  assert.equal(f.effect.stage,1);
  assert.deepEqual(f.effect.hits,receipt.hits);assert.deepEqual(f.effect.hitGaps,receipt.hitGaps);
  assert.deepEqual(f.effect.sourceHitMemory2016,receipt.memory);assert.equal(f.victim.hp,hp);
  f.step(10);
  assert.equal(f.victim.hp,hp,'the accepted non-repeat finisher cannot be charged again');
  assert.equal(f.sim.state.events.filter(e=>e.type==='hit'&&e.targetId==='local').length,1);
});

test('an early NEXT observation still permits normal collision-then-NEXT advancement on the local clock',()=>{
  const f=fixture();f.step(25);f.control(1);assert.equal(f.effect.stage,0);
  f.step(19);assert.equal(f.effect.stage,0,'local effect has not reached .75 seconds');
  f.step(2);assert.equal(f.effect.stage,1,'ordinary positive simulation owns the transition');
  assert.equal(f.victim.hp,50000,'an out-of-range victim never takes this attack');
});

test('a moved-away victim takes no damage while delayed effect controls and local NEXT finish',()=>{
  const f=fixture();f.moveVictim(30);f.step(10);assert.equal(f.victim.hp,50000,'before original .35 attack window');
  f.moveVictim(2000);f.step(15);f.control(1);f.step(35);
  assert.equal(f.victim.hp,50000);assert.equal(f.victim.x,2000);
  assert.equal(f.sim.state.events.some(e=>e.type==='hit'&&e.targetId==='local'),false);
  assert.equal(f.sim.receiverContactGeometry,undefined);
});

test('a current network terminal still closes the effect without playing a deferred contact',()=>{
  const f=fixture();f.step(25);f.control(1,{terminal:true});
  assert.equal(f.effect.dead,true);f.moveVictim(30);f.step(20);
  assert.equal(f.victim.hp,50000);assert.equal(f.sim.state.events.some(e=>e.type==='hit'&&e.targetId==='local'),false);
});
