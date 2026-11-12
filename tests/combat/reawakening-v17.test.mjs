import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {awakeningDurationPlan,awakeningCoreReturnPlan,onAwakening} from '../../packages/combat-core/passives.mjs';
import {prepareNasodAttack,launchNasodAttack} from '../../packages/combat-core/nasod-attack.mjs';

const dt=1/60,f=Math.fround;
const source=JSON.parse(readFileSync(new URL('../../reports/rf-awakening-independent-source-v17.json',import.meta.url)));
// Initial charged beads/core are explicit simulation fixtures. Source outputs
// below come from unchanged C++ consumers, never from the JS under test.
function ready(s,{orbs=1,gauge=20,remaining=30,full=false,facing=-1}={}){
  const a=s.actor('rf');Object.assign(a.awakening,{orbs,remaining,full});a.facing=facing;
  a.core.gauge=gauge;s.updateCoreLevel(a);a.core.phase=gauge?'idle':'absent';s.drainEvents();return a;
}
function press(s,b=createInputBuffer(),hold=false){
  b.down('Control',s.state.time+.002);if(!hold)b.up('Control',s.state.time+.004);
  s.step(dt,b.consume(s.state.time+dt),{snapshot:false});return b;
}
function untilApplied(s,type){
  const a=s.actor('rf'),threshold=profile.referenceSemantics.awakening.applyAnimationTime;
  for(let i=0;i<100;i++){
    const prior=a.animationTime,before=s.state.events.length;
    s.step(dt,{}, {snapshot:false});
    const event=s.state.events.slice(before).find(e=>e.type===type);
    if(event){assert.ok(prior<=threshold&&a.animationTime>=threshold,'activation is the original .83 animation crossing');return event;}
    assert.ok(a.animationTime<threshold,'no missing activation after threshold');
  }
  assert.fail('awakening animation never applied');
}

test('independent old seconds consumer rejects interpreting target24405 ratio as .7 added seconds',()=>{
  assert.equal(source.assertionsPassed,43);assert.equal(source.targetClientMeasured,false);
  assert.deepEqual(source.old4409.effectiveSeconds.slice(0,3),[4,7,10]);
  assert.deepEqual(source.target24405.raw.SA_EFFECTIVE_TIME,{'1':.7,'2':.7,'3':.7});
  for(const row of source.cases.filter(c=>c.kind===1)){
    assert.equal(row.added,f(.7));assert.equal(row.left,row.available-1);
    assert.equal(row.savedCount,row.available,'original input captures all available beads before spending one');
  }
  assert.match(source.versionGap,/cannot prove/);
});

test('v18 device Ctrl: initial time scales with beads but every reawakening adds one-bead time at .83; hold/release cannot spend twice',async()=>{
  for(const facing of [-1,1])for(const available of [1,2,3]){
    const initial=await make({passives:[24405]}),a=ready(initial,{orbs:available,remaining:0,gauge:0,facing});
    press(initial);assert.equal(a.awakening.orbs,0);assert.equal(a.awakening.remaining,0);
    const first=untilApplied(initial,'awakeningStarted');
    assert.equal(first.addedSeconds,30*available*f(.7));assert.equal(first.coreGauge,40);
    const s=await make({passives:[24405]}),b=ready(s,{orbs:available,gauge:20,facing}),input=press(s,undefined,true);
    assert.equal(b.awakening.orbs,available-1);assert.equal(b.awakening.pendingAvailableOrbs,available);
    assert.equal(b.core.gauge,20,'input cannot charge the core before its animation event');
    assert.equal(input.down('Control',.03),false,'device repeat suppressed while held');
    const second=untilApplied(s,'reawakenCoreRefill');
    assert.equal(second.orbs,1);assert.equal(second.availableOrbs,available);assert.equal(second.addedSeconds,30*f(.7));
    assert.equal(second.coreGauge,60);assert.equal(second.full,available===3);
    assert.ok(Math.abs(second.duration-(30-second.time+second.addedSeconds))<1e-8,'adds to the then-remaining duration');
    input.up('Control',s.state.time+.002);s.step(dt,input.consume(s.state.time+dt),{snapshot:false});
    frames(s,90);assert.equal(b.awakening.orbs,available-1);
    assert.equal(s.state.events.filter(e=>e.type==='reawakenCoreRefill').length,1);
  }
});

test('user-confirmed +2 levels includes zero/partial charge, all five levels and capped overflow; no forced100',async()=>{
  for(const gauge of [0,20,37,40,60,80,100]){
    const s=await make({passives:[24405]}),a=ready(s,{gauge});press(s);
    const e=untilApplied(s,'reawakenCoreRefill');
    assert.equal(e.coreGaugeBefore,gauge);assert.equal(e.coreGauge,Math.min(gauge+40,100));
    assert.equal(e.coreGaugeAdded,Math.min(40,100-gauge));assert.equal(a.core.level,Math.floor(e.coreGauge/20));
    assert.equal(onAwakening(a.passivePolicy,{alreadyAwakened:true,orbs:1,coreGauge:gauge}).coreGauge,e.coreGauge);
  }
  const s=await make({passives:[24405]}),a=s.actor('rf');
  assert.throws(()=>onAwakening(a.passivePolicy,{alreadyAwakened:true,orbs:1,coreGauge:NaN}));
  assert.throws(()=>awakeningDurationPlan(a.passivePolicy,{orbs:1,availableOrbs:0,baseSeconds:30}));
});

test('reawakening preserves an active flight/request instead of resetting attack state; parry cannot be bypassed by Ctrl',async()=>{
  for(const phase of ['prepare','attack']){
    const s=await make({passives:[24405]}),a=ready(s,{gauge:20});press(s);
    while(a.animationTime<.79)frames(s,1);
    assert.equal(prepareNasodAttack(a.core,'target',[0,0,0]),true);
    if(phase==='attack')launchNasodAttack(a.core,{direction:[1,0,0],facing:a.facing});
    const elapsed=a.core.attackElapsed,animationName=a.core.animationName;
    const e=untilApplied(s,'reawakenCoreRefill');assert.equal(e.coreGauge,60);
    assert.equal(a.core.phase,phase);assert.equal(a.core.targetId,'target');
    assert.ok(a.core.attackElapsed>elapsed);assert.equal(a.core.animationName,animationName,'original request selected AttackN; charge does not restart it');
    assert.deepEqual(a.core.helper.attackTime,phase==='attack'?[0,9999]:[0,0]);
  }
  const s=await make({passives:[24405]}),a=ready(s,{orbs:3,gauge:60});
  s.enter(a,'RSI_PARRYING','fixture-original-parry-state');
  Object.assign(a.core,{phase:'guard',parrying:true,canParry:true,guardRemaining:.5,level:2,gauge:40});
  press(s);assert.equal(a.awakening.orbs,3);assert.equal(a.awakening.pendingOrbs,0);
  assert.equal(s.state.events.some(e=>e.type==='reawakenCoreRefill'),false,'Ctrl is not a global state bypass');
});

test('expiry raw float32 refund exactly matches all 28 independent C++ cases including death/nonowner/caps',()=>{
  for(const c of source.cases.filter(c=>c.kind===4)){
    const plan=awakeningCoreReturnPlan({gauge:c.gauge,hp:c.hpBefore,mp:c.mpBefore,hpMax:800000,mpMax:300,own:c.mode!==3});
    for(const key of ['requestedHp','requestedMp','hp','mp'])assert.equal(plan[key],c[key],`gauge${c.gauge} mode${c.mode} ${key}`);
    assert.equal(plan.restoredHp,c.hp-c.hpBefore);assert.equal(plan.restoredMp,c.mp-c.mpBefore);
  }
  assert.throws(()=>awakeningCoreReturnPlan({gauge:NaN,hp:1,mp:1,hpMax:100,mpMax:300}));
});

test('expiry clears idle/request/flight/shield storage and aura once; emits actual capped returns with frozen position',async()=>{
  for(const phase of ['idle','prepare','attack','guard']){
    const s=await make({passives:[24405]}),a=ready(s,{gauge:37,remaining:dt/2,full:true});
    a.hp=a.hpMax-1;a.mp=a.mpMax-1;
    Object.assign(a.core,{phase,targetId:'target',attackElapsed:.2,delayElapsed:.1,phaseTime:.5,dirSpeed:3600,useManualDir:true,
      unlockRemaining:.06,manualDirDegree:[1,2,3],guardRemaining:.5,parrying:true,canParry:true,helperLive:true,
      attackLevel:2,hit:true,hits:{target:0},hitGaps:{target:1},helper:{attackTime:[0,9999]}});
    frames(s,1);const e=s.state.events.find(e=>e.type==='awakeningEnded');assert.ok(e);
    assert.deepEqual(e.position,[a.x,a.y,a.z]);assert.equal(e.recalledGauge,37);assert.equal(e.recalledLevel,1);
    assert.equal(e.restoredHp,1);assert.equal(e.restoredMp,1);assert.ok(e.requestedHp>1);assert.equal(e.requestedMp,37);
    assert.equal(a.core.gauge,0);assert.equal(a.core.level,0);assert.equal(a.core.phase,'absent');assert.equal(a.core.targetId,null);
    for(const key of ['attackElapsed','delayElapsed','phaseTime','dirSpeed','unlockRemaining','guardRemaining','attackLevel'])assert.equal(a.core[key],0,key);
    for(const key of ['parrying','canParry','helperLive','useManualDir','hit'])assert.equal(a.core[key],false,key);
    assert.deepEqual(a.core.hits,{});assert.deepEqual(a.core.hitGaps,{});assert.deepEqual(a.core.helper.attackTime,[0,0]);
    assert.equal(s.state.effects.some(e=>e.name==='RAVEN_HYPER_AURA'),false);frames(s,3);
    assert.equal(s.state.events.filter(e=>e.type==='awakeningEnded').length,1);
  }
});

test('expiry during pending three-bead reawakening refunds once, then activates new duration/core/aura at .83 and restores120 steps',async()=>{
  const left=await make({passives:[24405]}),a=ready(left,{orbs:3,gauge:60,remaining:.2,full:true});
  a.hp=a.hpMax/2;a.mp=100;press(left);frames(left,15);
  const end=left.state.events.find(e=>e.type==='awakeningEnded');assert.ok(end);assert.equal(end.recalledGauge,60);
  assert.equal(a.awakening.pendingOrbs,1);assert.equal(a.awakening.pendingAvailableOrbs,3);assert.equal(a.core.phase,'absent');
  const right=await make({passives:[24405]});right.restore(JSON.parse(JSON.stringify(left.snapshot())));
  frames(left,120);frames(right,120);assert.deepEqual(left.snapshot(),right.snapshot());
  const start=left.state.events.find(e=>e.type==='reawakenCoreRefill');assert.ok(start);
  assert.equal(start.addedSeconds,30*f(.7));assert.equal(start.coreGauge,40);assert.equal(start.full,true);
  assert.equal(left.state.events.filter(e=>e.type==='awakeningEnded').length,1);
  assert.equal(left.state.events.filter(e=>e.type==='coreAuraStarted').length,1);
});

test('actual three-bead aura stops each original effect identity and Disappear sound on expiry or death animation end',async()=>{
  for(const mode of ['expiry','combat-record-retired','death']){
    const s=await make({passives:[24405]}),a=ready(s,{orbs:3,remaining:0,gauge:0});
    press(s);frames(s,75);
    const ids=a.sourceAwakeningAuraEffectGroup.map(e=>e.id);assert.ok(ids.length);
    for(const id of ids)assert.ok(s.state.events.some(e=>e.type==='effectStarted'&&e.effectId===id),'real aura was presented');
    s.drainEvents();
    if(mode==='combat-record-retired')s.state.effects=s.state.effects.filter(e=>!ids.includes(e.id));
    if(mode==='death'){a.hp=0;frames(s,180);}else{a.awakening.remaining=dt/2;frames(s,1);}
    const ended=s.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId));
    assert.deepEqual(ended.map(e=>e.effectId).sort(),ids.toSorted());
    assert.ok(ended.every(e=>e.reason==='original-stop-effect-set'),'view recognizes immediate StopEffectSet');
    assert.equal(s.state.events.filter(e=>e.type==='sound'&&e.name==='Raven_ElectricAura_Disappear.ogg').length,1);
    assert.equal(s.state.effects.some(e=>ids.includes(e.id)),false);assert.equal(a.sourceAwakeningAuraEffectGroup,undefined);
    const event=s.state.events.find(e=>e.type==='awakeningEnded');assert.ok(event);
    if(mode==='death'){assert.equal(event.reason,'death-animation-end');assert.equal(event.restoredHp,0);assert.equal(event.restoredMp,0);}
    frames(s,3);assert.equal(s.state.events.filter(e=>e.type==='awakeningEnded').length,1);
  }
});
