import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commonRecoveryFixture,receivedStrike,beginDown} from '../helpers/common-charge-standup-v8-fixture.mjs';
import {queueStandupAttack,standupHitPolicy,validStandupAttackChoice,validStandupAttackNoDown} from '../../packages/combat-core/standup-policy.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';

const row=(p,k)=>JSON.parse(readFileSync(new URL(`../../packages/combat-core/${p.toLowerCase()}-profile.json`,import.meta.url))).states[k];
const stepUntil=(f,p,max=240)=>{for(let i=0;i<max&&!p();i++)f.step();assert.ok(p(),`${f.a.state} @ ${f.a.animationTime}`);};
const source=f=>f.sim.profileFor(f.a).states[f.a.state].sourceState??f.a.state;

for(const state of ['ESSI_ESK_DASH_COMBO_ZChargeX','ESSI_ELK_DASH_COMBO_XChargeX'])test(`LK ${state} raw CAN_MANA_BREAK=0 forbids voluntary green and a real hit enables it`,async()=>{
  assert.equal(row('LK',state).raw.CAN_MANA_BREAK,0);
  const f=await commonRecoveryFixture('LK',{gap:2500});f.a.mp=300;
  // Deliberately retain a pre-entry CommonEvent latch: it must not add even
  // the first green packet when the command starts charging.
  f.a.manaBreak.canCharge=true;f.a.manaBreak.charge=50;f.sim.enter(f.a,state,'diagnostic-charge-start');
  f.down('X');for(let i=0;i<25;i++)f.step();
  assert.equal(source(f),state);assert.equal(f.a.manaBreak.charge,0);assert.equal(f.a.manaBreak.canCharge,false);
  assert.equal(receivedStrike(f).accepted,true);for(let i=0;i<12;i++)f.step();
  assert.ok(f.a.manaBreak.charge>0,'received damage re-enables held-key Mana Break');
  f.up('X');for(let i=0;i<3;i++)f.step();assert.equal(f.a.manaBreak.charge,0);
});

for(const state of ['RVC_DASH_COMBO_ZZZ','RVC_DASH_COMBO_ZZZPushZ_READY','RVC_DASH_COMBO_ZZZPushZ'])test(`VC ${state} holds Z for its command without charging Mana Break, then received damage restores green`,async()=>{
  const f=await commonRecoveryFixture('VC',{gap:2500});f.a.mp=300;
  f.a.manaBreak.canCharge=true;f.a.manaBreak.charge=80;f.sim.enter(f.a,state,'diagnostic-held-command');
  f.down('Z');for(let i=0;i<8;i++)f.step();assert.equal(f.a.manaBreak.charge,0);
  assert.equal(receivedStrike(f).accepted,true);for(let i=0;i<8;i++)f.step();assert.ok(f.a.manaBreak.charge>0);
});

test('VC complete 66ZZ held-Z input reaches flamethrower with zero green in all three command-owned hold states',async()=>{
  const f=await commonRecoveryFixture('VC',{gap:2500});f.a.mp=300;
  f.tap('RIGHT');f.step();f.down('RIGHT');f.step();assert.equal(f.a.state,'RSI_DASH');
  f.tap('Z');f.step();f.up('RIGHT');f.step();f.down('Z');f.step();
  stepUntil(f,()=>source(f)==='RVC_DASH_COMBO_ZZ');
  f.up('Z');f.step();f.down('Z');f.step();
  const states=new Set();
  for(let i=0;i<160;i++){
    f.step();states.add(source(f));
    if(['RVC_DASH_COMBO_ZZZ','RVC_DASH_COMBO_ZZZPushZ_READY','RVC_DASH_COMBO_ZZZPushZ'].includes(source(f)))assert.equal(f.a.manaBreak.charge,0);
  }
  assert.ok(states.has('RVC_DASH_COMBO_ZZZPushZ'));f.up('Z');
});

for(const profession of ['RF','LK','VC','RS','BM','IS'])for(const facing of [-1,1])for(const down of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING']){
  test(`${profession}/${facing}/${down}: X rise deals an actual helper collision hit without knocking down even a full gauge`,async()=>{
    const gap=20;
    const f=await commonRecoveryFixture(profession,{facing,gap});beginDown(f,down);
    stepUntil(f,()=>f.a.animationTime>.66);f.tap('X');f.step();
    assert.equal(f.a.state,down,'choice waits until down animation ends');
    assert.equal(f.a.downAttackChoice,'X');
    f.b.knockdown.now=f.b.knockdown.max;f.b.knockdown.lastDamageSeconds=-10;
    const events=[];
    for(let i=0;i<150;i++){f.step();events.push(...f.sim.drainEvents());}
    const hits=events.filter(e=>e.type==='hit'&&e.actorId===f.a.id&&e.targetId===f.b.id&&e.origin.kind==='character');
    assert.ok(hits.length>0,'converted helper/body collision must accept the standup attack');
    assert.ok(hits.every(e=>e.data.REACT_TYPE===2&&e.data.FORCE_DOWN===0));
    assert.equal(events.some(e=>e.type==='knockdownTriggered'&&e.actorId===f.b.id),false);
    assert.equal(events.some(e=>e.type==='stateChanged'&&e.actorId===f.b.id&&/DAMAGE_(?:AIR_)?DOWN/.test(e.state)),false);
    assert.equal(f.a.standupAttackNoDown,false,'choice clears after recovery');
  });
}

for(const profession of ['RF','LK','VC','RS','BM','IS'])test(`${profession}: early X tap is ignored, sustained X waits for the choice window, Z and ordinary rise remain intact`,async()=>{
  const early=await commonRecoveryFixture(profession,{gap:2500});beginDown(early);early.tap('X');early.step();assert.equal(early.a.downAttackChoice,null);
  const held=await commonRecoveryFixture(profession,{gap:2500});beginDown(held);held.down('X');held.step();assert.equal(held.a.downAttackChoice,null);
  stepUntil(held,()=>held.a.downAttackChoice==='X');assert.equal(held.a.state,'RSI_DAMAGE_DOWN_FRONT');
  const z=await commonRecoveryFixture(profession,{gap:['RF','BM'].includes(profession)?0:20});beginDown(z);stepUntil(z,()=>z.a.animationTime>.66);z.tap('Z');z.step();
  stepUntil(z,()=>z.a.state==='RSI_STANDUP_ATTACK_FRONT');assert.equal(z.a.standupAttackNoDown,false);
  for(let i=0;i<90;i++)z.step();
  assert.ok(z.sim.state.events.some(e=>e.type==='hit'&&e.actorId===z.a.id&&e.data.REACT_TYPE===3),'Z remains an original down hit');
  const wait=await commonRecoveryFixture(profession,{gap:2500});beginDown(wait);stepUntil(wait,()=>wait.a.state==='RSI_DAMAGE_STANDUP_FRONT');
});

for(const profession of ['RF','LK','VC','RS','BM','IS'])test(`${profession}: actual sampled keyboard held X on a real received down hit queues non-down recovery at the permitted boundary`,async()=>{
  const f=await commonRecoveryFixture(profession,{gap:20,sampledLevels:true});
  assert.equal(receivedStrike(f,{REACT_TYPE:3}).accepted,true);assert.match(f.a.state,/RSI_DAMAGE_DOWN_/);
  f.down('X');f.step();assert.equal(f.a.downAttackChoice,null);
  stepUntil(f,()=>f.a.downAttackChoice==='X');
  assert.ok(f.a.animationTime>.66);assert.match(f.a.state,/RSI_DAMAGE_DOWN_/);
  stepUntil(f,()=>f.a.standupAttackNoDown);
  assert.equal(f.a.state,'RSI_STANDUP_ATTACK_FRONT_NO_DOWN');
  f.up('X');f.step();const events=[];for(let i=0;i<110;i++){f.step();events.push(...f.sim.drainEvents());}
  assert.ok(events.some(e=>e.type==='hit'&&e.actorId===f.a.id&&e.data.REACT_TYPE===2));
});

for(const mode of ['zx','xx'])test(`LK ${mode}: sampled 66${mode.toUpperCase()} charge gesture holds X with zero green until a received strike`,async()=>{
  const f=await commonRecoveryFixture('LK',{gap:2500,sampledLevels:true});f.a.mp=300;
  f.down('RIGHT');f.step();f.up('RIGHT');f.step();f.down('RIGHT');f.step();assert.equal(f.a.state,'RSI_DASH');
  f.down(mode==='zx'?'Z':'X');f.step();f.up(mode==='zx'?'Z':'X');f.step();
  stepUntil(f,()=>f.a.animationTime>.32);
  f.down('X');f.step();const state=mode==='zx'?'ESSI_ESK_DASH_COMBO_ZChargeX':'ESSI_ELK_DASH_COMBO_XChargeX';
  stepUntil(f,()=>source(f)===state);for(let i=0;i<20;i++)f.step();assert.equal(f.a.manaBreak.charge,0);
  assert.equal(receivedStrike(f).accepted,true);for(let i=0;i<8;i++)f.step();assert.ok(f.a.manaBreak.charge>0);
});

test('VC sampled 66ZZZ held-Z gesture keeps the actual flamethrower green bar empty',async()=>{
  const f=await commonRecoveryFixture('VC',{gap:2500,sampledLevels:true});f.a.mp=300;
  f.down('RIGHT');f.step();f.up('RIGHT');f.step();f.down('RIGHT');f.step();
  f.down('Z');f.step();f.up('Z');f.step();f.down('Z');f.step();
  stepUntil(f,()=>source(f)==='RVC_DASH_COMBO_ZZ');f.up('Z');f.step();f.down('Z');f.step();
  stepUntil(f,()=>source(f)==='RVC_DASH_COMBO_ZZZPushZ');
  assert.equal(f.a.manaBreak.charge,0);for(let i=0;i<15;i++)f.step();assert.equal(f.a.manaBreak.charge,0);
});

for(const profession of ['RF','LK','VC','RS','BM','IS'])for(const facing of [-1,1])test(`${profession}/${facing}: original non-down back rise turns over once and ends with .3s temporary protection`,async()=>{
  const f=await commonRecoveryFixture(profession,{facing,gap:2500});beginDown(f,'RSI_DAMAGE_DOWN_BACK');
  stepUntil(f,()=>f.a.animationTime>.66);f.tap('X');f.step();stepUntil(f,()=>f.a.state==='RSI_STANDUP_ATTACK_BACK_NO_DOWN');
  assert.equal(f.a.animationName,['LK','RS','IS'].includes(profession)?'SI_A_EL_GET_CHANCE_BACK':'SI_A_RF_GET_CHANCE_BACK');assert.equal(f.a.facing,facing);
  stepUntil(f,()=>f.a.state==='RSI_WAIT');assert.equal(f.a.facing,-facing);
  assert.equal(f.a.forceInvincible,.3);assert.equal(f.a.showInvincible.remaining,.3);
  assert.equal(f.a.invincible,true);assert.equal(receivedStrike(f).accepted,false);
  for(let i=0;i<20;i++)f.step();assert.equal(f.a.facing,-facing);assert.equal(f.a.forceInvincible,0);assert.equal(f.a.invincible,false);
});

test('standup scopes only character hits, validates choices, and refuses too-early queueing',()=>{
  const data={REACT_TYPE:3,FORCE_DOWN:-40};const a={state:'RSI_STANDUP_ATTACK_FRONT',standupAttackNoDown:true};
  assert.equal(standupHitPolicy(a,data,{kind:'effect'}).data,data);assert.equal(standupHitPolicy(a,data,{kind:'core'}).data,data);
  assert.equal(standupHitPolicy({...a,state:'RSI_COMBO_Z'},data,{kind:'character'}).data,data);
  for(const v of [null,'X','Z'])assert.equal(validStandupAttackChoice(v),true);
  for(const v of [undefined,'A',true,0])assert.equal(validStandupAttackChoice(v),false);
  assert.equal(validStandupAttackNoDown(false),true);assert.equal(validStandupAttackNoDown(1),false);
  assert.equal(queueStandupAttack({state:'RSI_DAMAGE_DOWN_FRONT',animationTime:.66},'X'),false);
});

test('X choice and active non-down rise survive JSON/owned-state transfer; malformed choices are rejected',async()=>{
  const f=await commonRecoveryFixture('VC',{gap:2500});beginDown(f);stepUntil(f,()=>f.a.animationTime>.66);f.tap('X');f.step();
  const target=await commonRecoveryFixture('VC',{gap:2500});const report=encodeOwnedState(f.sim,f.a.id,{frameSeq:1});
  validateOwnedState(report);applyOwnedState(target.sim,target.a.id,report);assert.equal(target.a.downAttackChoice,'X');
  stepUntil(f,()=>f.a.standupAttackNoDown);
  target.sim.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));assert.equal(target.sim.actor(target.a.id).standupAttackNoDown,true);
  const active=encodeOwnedState(f.sim,f.a.id,{frameSeq:2});validateOwnedState(active);
  const bad=structuredClone(active);bad.actor.downAttackChoice='Q';assert.throws(()=>validateOwnedState(bad));
  const flag=structuredClone(active);flag.actor.standupAttackNoDown=1;assert.throws(()=>validateOwnedState(flag));
});
