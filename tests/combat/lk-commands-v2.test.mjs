import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {lordKnightCommands,lkBufferedWindow} from '../../packages/combat-core/lk-commands.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const empty=()=>Array(8).fill(null);
function fixture(facing=1,{wall=false}={}){
  const sim=createSimulation({profile,preset:{guildPassives:[],doubleTapWindowSeconds:.4,loadout:empty()},map:{sceneId:'lk-command-input-fixture',
    lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],beforeLine:wall?-2:-1,nextLine:wall?-2:-1}],spawns:[]},
    actors:[{id:'lk',professionId:'LK',team:0,x:wall?1990:0,y:0,facing,loadout:empty(),awakening:{orbs:3}}]});
  const a=sim.actor('lk'),input=createInputBuffer(),forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';
  const source=()=>profile.states[a.state].sourceState;
  const step=()=>sim.step(1/60,{lk:input.consume(sim.state.time+1/60)});
  const tap=key=>{input.tap(key,sim.state.time+.001);step();};
  const down=key=>{input.down(key,sim.state.time+.001);step();};
  const up=key=>{input.up(key,sim.state.time+.001);step();};
  const wait=(predicate,label,max=240)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),label+'; got '+source()+' @ '+a.animationTime);};
  const state=name=>wait(()=>source()===name,'expected '+name);
  const time=t=>{const serial=a.stateSerial;wait(()=>a.animationTime>=t||a.stateSerial!==serial,'time '+t);assert.equal(a.stateSerial,serial,'state changed before input at '+t);};
  const next=(key,name,at=.04)=>{time(at);tap(key);state(name);};
  const dash=()=>{tap(forward);down(forward);assert.equal(a.state,'RSI_DASH');};
  const jump=()=>{dash();tap('UP');assert.equal(a.state,'RSI_DASH_JUMP');};
  return {sim,a,input,forward,back,source,step,tap,down,up,wait,state,time,next,dash,jump};
}
function zzz(f){f.tap('Z');f.next('Z','ESSI_COMBO_Z2');f.next('Z','ESSI_COMBO_Z3');}
function xx(f){f.tap('X');f.next('X','ESSI_COMBO_X2');}

// Expectations are target2016 state/table literals and independently audited
// fixed SwordMan successors, not recorded output from this executor.
for(const facing of [-1,1]){
  test(`LK ${facing}: actual device ZZZZ, ZZZX, ZZZ forward Z`,()=>{
    for(const [key,front,last]of [['Z',false,'ESSI_COMBO_Z4'],['X',false,'ESSI_COMBO_Z4a'],['Z',true,'ESSI_ELK_ZZZfrontZ']]){
      const f=fixture(facing);zzz(f);f.time(.22);if(front)f.down(f.forward);f.tap(key);f.state(last);
      assert.equal(f.a.facing,facing);assert.ok(f.sim.state.events.filter(e=>e.type==='attackWindow').length>=3);
      f.state('ESSI_WAIT');
    }
  });
  test(`LK ${facing}: actual device XXZ and XXXXX use target branch windows`,()=>{
    const z=fixture(facing);xx(z);z.next('Z','ESSI_COMBO_X3a',.25);z.state('ESSI_WAIT');
    const x=fixture(facing);xx(x);x.next('X','ESSI_ELK_XXX',.25);x.next('X','ESSI_ELK_XXXX',.35);x.next('X','ESSI_ELK_XXXXX',.65);x.state('ESSI_WAIT');
  });
  test(`LK ${facing}: real 66 ZZZ / ZZX / ZXX input routes`,()=>{
    for(const [third,last]of [['Z','ESSI_KNIGHT_DASH_COMBO_Z3'],['X','ESSI_KNIGHT_DASH_COMBO_Z3a']]){
      const f=fixture(facing);f.dash();f.tap('Z');f.next('Z','ESSI_KNIGHT_DASH_COMBO_Z2');f.next(third,last);f.up(f.forward);f.state('ESSI_WAIT');
    }
    const f=fixture(facing);f.dash();f.tap('Z');f.next('X','ESSI_ESK_DASH_COMBO_ZX');f.next('X','ESSI_ESK_DASH_COMBO_ZXX',.3);f.up(f.forward);f.state('ESSI_WAIT');
  });
  test(`LK ${facing}: real 66 XXX input and charge release`,()=>{
    const f=fixture(facing);f.dash();f.tap('X');f.next('X','ESSI_ELK_DASH_COMBO_XX',.3);f.next('X','ESSI_ELK_DASH_COMBO_XXX',.3);f.up(f.forward);f.state('ESSI_WAIT');
    const c=fixture(facing);c.dash();c.tap('X');c.time(.3);c.down('X');c.state('ESSI_ELK_DASH_COMBO_XChargeX');
    for(let i=0;i<20;i++)c.step();assert.equal(c.source(),'ESSI_ELK_DASH_COMBO_XChargeX');c.up('X');c.state('ESSI_ELK_DASH_COMBO_XX');
    assert.equal(c.a.skillScale,1,'no invented charge damage');
  });
  test(`LK ${facing}: real 668 ZZZ spin reaches its actual landing and clears passive X`,()=>{
    const f=fixture(facing);f.jump();for(let i=0;i<4;i++)f.step();f.tap('Z');f.next('Z','ESSI_DASH_JUMP_COMBO_Z2');f.next('Z','ESSI_ESK_DASH_JUMP_ZZZ');
    assert.equal(f.a.passiveSpeed.x,1250);f.state('ESSI_ESK_DASH_JUMP_ZZZ_LANDING');assert.equal(f.a.passiveSpeed.x,0);f.up(f.forward);f.state('ESSI_WAIT');
  });
  test(`LK ${facing}: source668XX selects LK's registered144 table and independent landing latches`,()=>{
    for(const key of ['X','Z',null]){
      const f=fixture(facing);f.jump();for(let i=0;i<4;i++)f.step();f.tap('X');f.next('X','ESSI_KNIGHT_DASH_JUMP_COMBO_X2');if(key)f.tap(key);
      f.state(key==='X'?'ESSI_KNIGHT_DASH_JUMP_COMBO_X3':key==='Z'?'ESSI_COMBO_Z1':'ESSI_DASH_JUMP_COMBO_X2_LANDING');assert.equal(f.a.grounded,true);
    }
  });
  test(`LK ${facing}: backward cancel obeys strict target .288 and preserves old facing`,()=>{
    const f=fixture(facing);zzz(f);f.down(f.back);assert.equal(f.source(),'ESSI_COMBO_Z3');
    f.wait(()=>f.a.sourcePendingState?.state==='RSI_WAIT','backwalk pending');assert.equal(f.a.facing,facing);
    f.state('ESSI_WAIT');assert.equal(f.a.sourcePendingState?.state,'RSI_WALK');f.step();assert.equal(f.source(),'ESSI_WALK');assert.equal(f.a.facing,-facing);
  });
  test(`LK ${facing}: ZZZ 66 cancel accepts device double direction rather than a literal DASH key`,()=>{
    const f=fixture(facing);zzz(f);f.time(.11);f.tap(f.forward);f.down(f.forward);
    assert.equal(f.a.sourcePendingState?.state,'RSI_DASH');f.step();assert.equal(f.a.state,'RSI_DASH');assert.equal(f.a.facing,facing);
  });
  test(`LK ${facing}: jump Z/X remain stopped until landing and Down jump lock is retained`,()=>{
    for(const key of ['Z','X']){
      const f=fixture(facing);f.tap('UP');for(let i=0;i<4;i++)f.step();f.tap(key);f.down('DOWN');
      f.state('ESSI_JUMP_LANDING');assert.ok(f.a.canNotJumpTime>0);f.tap('UP');assert.notEqual(f.a.state,'RSI_JUMP_UP');
    }
  });
}
test('LK source macro rejects exclusive input end and change equality; retained flag changes on the following event',()=>{
  const w={'1':.2,'2':.5,'3':.33};
  assert.equal(lkBufferedWindow(0,0,.1999,true,w).consumed,false);
  assert.equal(lkBufferedWindow(0,0,.5,true,w).consumed,false);
  assert.equal(lkBufferedWindow(1,0,.33,false,w).changed,false);
  assert.deepEqual(lkBufferedWindow(0,0,.4,true,w),{flags:1,changed:false,consumed:true});
  assert.deepEqual(lkBufferedWindow(1,0,.4001,false,w),{flags:0,changed:true,consumed:true});
});
test('LK actual device short Z press during hitstop survives release and follows Z2 once',()=>{
  const f=fixture();f.tap('Z');f.time(.12);f.a.hitStop=.1;f.tap('Z');
  assert.equal(f.source(),'ESSI_COMBO_Z1');f.state('ESSI_COMBO_Z2');
  assert.equal(f.sim.state.events.filter(e=>e.type==='stateChanged'&&e.state==='RSI_COMBO_ZZ').length,1);
  f.state('ESSI_WAIT');assert.ok(!f.sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='RSI_COMBO_ZZZ'));
});
test('LK explicit charge duration is bounded and raw release animation enters without an invented multiplier',()=>{
  const f=fixture();f.dash();f.tap('Z');f.down('X');f.state('ESSI_ESK_DASH_COMBO_ZChargeX');
  // Original post compares model E0 with EPT0.first, not wall stateTime.
  const limit=profile.states.ESSI_ESK_DASH_COMBO_ZChargeX.raw.EVENT_PROCESS_TIME0['1'];
  f.wait(()=>f.a.sourcePendingState?.state==='ESSI_ESK_DASH_COMBO_ZX','charge release pending');
  assert.ok(Math.fround(f.a.animationTime)>=Math.fround(limit));assert.equal(f.source(),'ESSI_ESK_DASH_COMBO_ZChargeX');
  f.step();assert.equal(f.source(),'ESSI_ESK_DASH_COMBO_ZX');assert.equal(f.a.skillScale,1);
});
test('LK wall does not erase combo buffers and terminal state returns to idle',()=>{
  const f=fixture(1,{wall:true});zzz(f);f.next('Z','ESSI_COMBO_Z4',.22);f.state('ESSI_WAIT');assert.ok(f.a.x<=2000);
});
test('LK declared dash and backward cancel thresholds do not use the RF inclusive fallback',()=>{
  const f=fixture(),a=f.a;f.sim.enter(a,'RSI_COMBO_ZZZ','threshold-fixture');
  a.animationTime=.288;const keys={held:new Set(['LEFT']),pressed:new Set()};
  assert.equal(lordKnightCommands.runEvent(a,keys,profile).state,null);
  a.animationTime=.288001;assert.equal(lordKnightCommands.runEvent(a,keys,profile).state,'RSI_WAIT');
});
test('LK command snapshot replays the same flags, device-stop input and movement deterministically',()=>{
  const f=fixture(),g=fixture();f.tap('X');f.time(.1);f.a.hitStop=.1;f.tap('X');f.sim.drainEvents();g.sim.restore(f.sim.snapshot());
  for(let i=0;i<90;i++){f.sim.step(1/60,{});g.sim.step(1/60,{});assert.deepEqual(f.sim.snapshot(),g.sim.snapshot());}
});
test('LK dash Z source movement skip is strictly after .9 and retains its .1 attack lock',()=>{
  const {sim,a}=fixture();sim.enter(a,'RSI_DASH_COMBO_Z','fixture');a.animationTime=.9;
  const keys={held:new Set(['RIGHT']),pressed:new Set()};assert.equal(lordKnightCommands.runEvent(a,keys,profile).state,null);
  a.animationTime=.900001;const result=lordKnightCommands.runEvent(a,keys,profile);
  assert.equal(result.state,'RSI_WAIT');assert.equal(result.canNotAttackTime,Math.fround(.1));
});
test('LK grounded source skill and awakening cancel use target strict threshold, airborne rows without a gate remain blocked',()=>{
  const {sim,a}=fixture();sim.configureLoadout([{skillId:21219},...empty().slice(1)],'lk');sim.enter(a,'RSI_COMBO_ZZZ','fixture');
  a.animationTime=.1;assert.equal(sim.skillAvailability('lk',0).available,false);
  a.animationTime=.100001;assert.equal(sim.skillAvailability('lk',0).available,true);
  const result=lordKnightCommands.runEvent(a,{held:new Set(),pressed:new Set(['AWAKEN'])},profile);assert.equal(result.state,'AWAKEN_REQUEST');
  sim.enter(a,'RSI_DASH_JUMP_COMBO_Z','fixture');a.grounded=false;a.animationTime=.5;assert.equal(sim.skillAvailability('lk',0).available,false);
});
