/** User feedback7/8/10/11: real2016 helpers and production preset. Literal
 * source timings/coefficients and user-corrected behavior are independent of
 * the observed traces. No original-client dynamic baseline is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {hasVisibleSuperArmor} from '../../apps/web/armor-presentation.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';

const dt=1/60,near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
const wolf='SI_SA_RBM_WOLF_FANG_HIT';
const middle='DAMAGE_EFFECT_RSI_HA_RBM_EXTREM_BLADE_DAMAGE';
const final='DAMAGE_EFFECT_RSI_HA_RBM_EXTREM_BLADE_FINAL_DAMAGE';
const incoming={DAMAGE_TYPE:0,ATTACK_TYPE:0,HIT_TYPE:1,REACT_TYPE:2,DAMAGE:{PHYSIC:1},BACK_SPEED_X:100};

for(const facing of [1,-1])test(`Wolf Fang confirmed slash is invincible and has no armor-only red edge facing${facing}`,()=>{
  const {sim,a,b}=bmFixture({skillId:24017,passives:[],gap:165,facing});
  sim.rng=()=>.99;sim.step(dt,{bm:{pressed:['A']}});
  for(let i=0;i<180&&a.state!==wolf;i++)sim.step(dt,{});
  assert.equal(a.state,wolf,'actual grab must enter the slash');
  assert.deepEqual(bmProfile.states[wolf].raw.INVINCIBLE,{'1':0,'2':100});
  let protectedFrames=0;
  while(a.state===wolf&&protectedFrames<180){
    const hp=a.hp;
    assert.equal(a.invincible,true);
    assert.equal(hasVisibleSuperArmor(a,bmProfile.states[wolf].raw,{showAll:true}),false);
    assert.equal(sim.applyHit(b,a,incoming,{kind:'fixture'}).accepted,false);
    assert.equal(a.hp,hp);protectedFrames++;sim.step(dt,{});
  }
  assert.ok(protectedFrames>10&&protectedFrames<180);
  for(let i=0;i<180&&a.skillId;i++)sim.step(dt,{});
  assert.equal(a.skillId,null);assert.equal(a.invincible,false);
  assert.equal(sim.applyHit(b,a,incoming,{kind:'fixture'}).accepted,true,'protection must end after recovery');
});

test('Fatal Wound grants one bleeding stack per real cast, selects its matching display, and caps at three',()=>{
  const {sim,a,b}=bmFixture({skillId:24208,passives:[],gap:165});sim.rng=()=>.99;
  for(let cast=1;cast<=4;cast++){
    for(const [actor,x]of [[a,0],[b,165]]){
      actor.x=x;actor.y=3080;actor.z=0;actor.vx=actor.vy=0;actor.grounded=true;actor.lineId=2;actor.landPosition=[x,3080,0];
      sim.enter(actor,'RSI_WAIT','fixture-between-independent-casts');
    }
    a.mp=a.mpMax;a.cooldowns[24208]=0;sim.drainEvents();sim.step(dt,{bm:{pressed:['A']}});
    const events=sim.drainEvents();
    for(let i=0;i<180&&a.skillId;i++){sim.step(dt,{});events.push(...sim.drainEvents());}
    assert.equal(a.skillId,null);
    assert.equal(events.filter(e=>e.type==='buffApplied'&&e.templateId===99&&e.targetId===b.id).length,1);
    const buff=b.buffs.find(row=>row.templateId===99),count=Math.min(cast,3);
    assert.equal(buff.accumulationCount,count);
    // Original factor146: -(1738+1479)/2*.5, multiplied by the stack count.
    near(buff.behaviors.find(row=>row.kind==='hpInterval').value,-804.25*count);
    const names=[...new Set(sim.state.effects.filter(e=>e.ownerId===b.id&&e.buffTemplateId===99&&!e.dead).map(e=>e.setName))];
    assert.deepEqual(names,[`EffectSet_DEBUFF_BLEEDING_0${count}`]);
  }
});

for(const [skillId,roll,name]of [[24030,.1,'DamageEffect_RST_ShockWave'],[24030,.99,'DamageEffect_RST_ShockWave_Ultimate'],[24016,.99,'DamageEffect_RBM_ShockWave_Cutter']])
for(const facing of [1,-1])test(`Shockwave ${name} preserves airborne follow-up reactions and all damage stages facing${facing}`,()=>{
  // The tilted Divider travels down30degrees. At450 its last contact can be
  // the .2 crossing packet, whose collision still uses the old DD. A standing
  // target at800 stays in the real helper through the next eligible hit;
  // Cutter's horizontal helper retains its existing450-distance fixture.
  const gap=name==='DamageEffect_RBM_ShockWave_Cutter'?450:800;
  const {sim,a,b}=bmFixture({skillId,passives:[],gap,facing});sim.rng=()=>roll;
  const observed=[],stages=[];const apply=sim.applyParticipantHit;
  sim.applyParticipantHit=function(attacker,target,data,origin){
    const effect=this.state.effects.find(e=>e.id===origin?.id),airborne=!target.grounded;
    const result=apply.call(this,attacker,target,data,origin);
    if(result.accepted&&effect?.name===name)observed.push({airborne,react:data.REACT_TYPE,state:target.state,vy:target.vy,grounded:target.grounded});
    return result;
  };
  sim.step(dt,{bm:{pressed:['A']}});
  for(let i=0;i<180;i++){
    sim.step(dt,{});
    for(const e of sim.state.effects)if(e.name===name&&e.active)stages.push({time:e.elapsed,stage:e.stage});
  }
  assert.ok(observed.some(row=>row.react===5&&!row.grounded),'source first hit launches');
  const followups=observed.filter(row=>row.react===2&&row.airborne);
  assert.ok(followups.length>0,'actual traveling helper must hit after the source .2 stage change');
  assert.ok(followups.every(row=>row.state.startsWith('RSI_DAMAGE_AIR_FLY_')&&!row.grounded&&row.vy>0));
  assert.ok(stages.some(row=>row.time>=.2&&row.time<.4&&row.stage===1));
  assert.ok(stages.some(row=>row.time>=.4&&row.stage===2),'the .4 source change must consume DAMAGE_DATA_NEXT2');
});

for(const facing of [1,-1])test(`Extreme Blade middle hits occur before the final slash with frozen pre-lift anchors facing${facing}`,()=>{
  const {sim,a}=bmFixture({skillId:24604,passives:[],gap:165,facing});sim.rng=()=>.99;
  const starts=new Map(),hits=[];let finishTime=null;
  sim.step(dt,{bm:{pressed:['A']}});
  for(let i=0;i<360;i++){
    sim.step(dt,{});
    for(const e of sim.drainEvents()){
      if(e.type==='effectStarted')starts.set(e.effectId,e);
      if(e.type==='stateChanged'&&e.actorId===a.id&&e.state==='RSI_HA_RBM_EXTREM_BLADE_ATTACK_FINISH')finishTime=e.time;
      if(e.type==='hit'&&e.actorId===a.id)hits.push(e);
    }
  }
  const byName=name=>hits.filter(e=>starts.get(e.origin?.id)?.name===name&&e.amount>0);
  const middleHits=byName(middle),finalHits=byName(final);
  assert.ok(middleHits.length>1,'the source .07 repeated middle damage must be real, not deferred to the final hit');
  assert.equal(finalHits.length,1);
  assert.ok(middleHits[0].time<finalHits[0].time);
  assert.notEqual(finishTime,null);assert.ok(middleHits.some(e=>e.time<finishTime));
  const readyHelper=[...starts.values()].find(e=>e.name==='DAMAGE_EFFECT_RSI_HA_RBM_EXTREM_BLADE_BLACKHOLE_DAMAGE');
  assert.ok(readyHelper.time<middleHits[0].time,'READY 1.16 event must not migrate into the finishing animation');
  assert.ok(middleHits.every(e=>e.data.DAMAGE.PHYSIC===4.43));
  assert.equal(finalHits[0].data.DAMAGE.PHYSIC,46.5);
  assert.equal(a.skillId,null);assert.equal(a.hidden,false);assert.equal(a.sourceBladeMaster.extremeLifted,false);
  assert.deepEqual(sim.state.unsupported.filter(row=>row.id!=='fidelity-unverified'),[]);
});

for(const facing of [1,-1])test(`Black-hole command keeps four real slashes and final blast, then stops its original set facing${facing}`,()=>{
  const f=bmSampledFixture({gap:150,passives:[],facing}),{sim,a}=f;sim.rng=()=>.99;
  f.blackHole();
  for(let count=2;count<=5;count++){
    f.at(.4);
    if(count<5){const serial=a.stateSerial;f.press('Z');f.until(()=>a.stateSerial>serial);}
  }
  validateOwnedState(encodeOwnedState(sim,a.id));
  f.wait('RBM_COMBO_ZZZX_EXPLOSION');f.wait('RSI_WAIT');f.step(120);
  const events=sim.state.events,starts=new Map(events.filter(e=>e.type==='effectStarted').map(e=>[e.effectId,e]));
  const hits=events.filter(e=>e.type==='hit'&&e.actorId===a.id);
  const slashes=hits.filter(e=>e.origin?.state==='RBM_COMBO_ZZZXZ');
  assert.equal(slashes.length,4);assert.ok(slashes.every(e=>e.data.DAMAGE.PHYSIC===1.56));
  const blasts=hits.filter(e=>starts.get(e.origin?.id)?.name==='RBM_BLACKHOLE_EXPLOSION');
  assert.equal(blasts.length,1);assert.equal(blasts[0].data.DAMAGE.MAGIC,5.2);
  const stopped=events.find(e=>e.type==='effectEnded'&&e.name==='RBM_BLACKHOLE');
  assert.equal(stopped.reason,'original-stop-effect-set');
  assert.ok(stopped.time>=blasts[0].time);
  assert.ok(hits.filter(e=>starts.get(e.origin?.id)?.name==='RBM_BLACKHOLE').every(e=>e.time<=stopped.time));
  assert.deepEqual(a.sourceBladeMaster.blackHoleEffectIds,[]);
  assert.ok(!sim.state.effects.some(e=>e.setName==='EffectSet_RBM_BLACKHOLE'));
});

test('Black-hole retained set survives a serialized continuation and expires after a real cancel',()=>{
  const f=bmSampledFixture({gap:150,passives:[]}),{sim,a}=f;f.blackHole();
  sim.drainEvents(); // Compare continuation events, not optional undefined keys in old in-memory history.
  const other=bmFixture({gap:150,passives:[]}).sim;other.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  for(const instance of [sim,other]){
    const actor=instance.actor('bm');instance.enter(actor,'RSI_WAIT','fixture-real-cancel');
    for(let i=0;i<120;i++)instance.step(dt,{});
  }
  assert.deepEqual(other.snapshot(),sim.snapshot());
  assert.equal(a.sourceBladeMaster.blackHoleRemaining,0);
  assert.deepEqual(a.sourceBladeMaster.blackHoleEffectIds,[]);
  assert.ok(!sim.state.effects.some(e=>e.setName==='EffectSet_RBM_BLACKHOLE'));
});
