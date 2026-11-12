import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {defenderHitStopOverride,attackerHitStopOverride,selectHitReaction,forceDownContribution} from '../../packages/combat-core/reaction-policy.mjs';
import {makeGuardian,observeGuardian} from '../helpers/guardian-reaction-v17.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const source=read('contracts/rf-guardian-reaction-source-v17.json'),profile=read('packages/combat-core/rf-profile.json');
const data=source.targetDamageClosure.find(v=>v.name==='DamageEffect_SA_ROT_GuardianStrike').raw;
const basic=()=>createSimulation({profile,map:{sceneId:'independent-reaction-source-v17',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0],type:'LT_NORMAL'}]},
  actors:[{id:'rf',team:0,x:0,y:0,facing:1},{id:'target',team:1,x:300,y:0,facing:-1,attributes:{animationSpeedMultiplier:1.3}}]});

test('independent 2016 closure uses BIG then FLY with zero stops and no explicit FORCE_DOWN',()=>{
  assert.equal(source.targetClientMeasured,false);assert.equal(source.targetGoldenTraces,0);
  assert.equal(data.DAMAGE_DATA.REACT_TYPE,source.targetEnums.RT_BIG_DAMAGE);
  assert.equal(data.DAMAGE_DATA_NEXT.REACT_TYPE,source.targetEnums.RT_FLY);
  for(const block of [data.DAMAGE_DATA,data.DAMAGE_DATA_NEXT]){
    assert.equal(block.STOP_TIME_ATT,0);assert.equal(block.STOP_TIME_DEF,0);
    assert.equal('FORCE_DOWN' in block,false);assert.equal(forceDownContribution(block),0);
  }
  assert.deepEqual(source.targetStateHyperDeclarations,['RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE']);
  assert.ok(source.legacyGuardianDamageDeclarations.some(v=>v.name.endsWith('_HYPER')));
  assert.equal(source.targetDamageClosure.length,4);
  assert.equal(selectHitReaction(data.DAMAGE_DATA_NEXT,{grounded:true,fromFront:true}).state,'RSI_DAMAGE_AIR_FLY_FRONT');
});

test('defender cache reset and positive/zero STOP requests remain separate; SA and Dummy preserve older stop',()=>{
  for(const old of [0,.2,.9])for(const stop of [0,.1,.8]){
    const s=basic(),b=s.actor('target');b.worldStop=old;b.hitStop=.7;
    s.injectHit({attackerId:'rf',targetId:'target',damageData:{...data.DAMAGE_DATA,STOP_TIME_DEF:stop}});
    assert.equal(b.worldStop,0);assert.equal(b.hitStop,0);
    assert.deepEqual(b.sourceStopQueues.hit.at(-1),{remaining:Math.fround(stop),sourceId:'rf'});
    assert.deepEqual(b.sourceStopQueues.world.at(-1),{remaining:0,sourceId:'rf'});
    assert.equal(b.presentationTransition.enabled,false);
  }
  for(const options of [{type:0},{type:7},{type:2,superArmor:true}]){
    const s=basic(),b=s.actor('target');b.worldStop=.9;b.hitStop=.7;b.superArmor=options.superArmor??false;
    assert.equal(defenderHitStopOverride({REACT_TYPE:options.type,STOP_TIME_DEF:0},{superArmor:b.superArmor}),null);
    s.injectHit({attackerId:'rf',targetId:'target',damageData:{...data.DAMAGE_DATA,REACT_TYPE:options.type,STOP_TIME_DEF:0}});
    assert.equal(b.worldStop,.9);assert.equal(b.hitStop,.7);assert.equal(b.state,'RSI_WAIT');
  }
  for(const type of [11,12]){
    assert.equal(defenderHitStopOverride({REACT_TYPE:type,STOP_TIME_DEF:0}),null);
    assert.deepEqual(defenderHitStopOverride({REACT_TYPE:type,STOP_TIME_DEF:.2}),{stopTime:.2,stop2Time:0});
  }
  // NO_DAMAGE damage flag suppresses HP but is not RT_NO_DAMAGE enum.
  assert.deepEqual(defenderHitStopOverride({REACT_TYPE:2,NO_DAMAGE:1,STOP_TIME_DEF:0}),{stopTime:0,stop2Time:0});
});

test('owner ordinary AttackResult resets caches and appends STOP; recovery/buff/core paths are bounded',()=>{
  for(const kind of ['character','effect','fixture'])for(const stop of [0,.1,.8]){
    const s=basic(),a=s.actor('rf');a.worldStop=.9;a.hitStop=.7;
    s.applyHit(a,s.actor('target'),{...data.DAMAGE_DATA,STOP_TIME_ATT:stop},{kind});
    assert.equal(a.hitStop,0);assert.equal(a.worldStop,0);
    assert.deepEqual(a.sourceStopQueues.hit.at(-1),{remaining:Math.fround(stop),sourceId:'target'});
    assert.deepEqual(a.sourceStopQueues.world.at(-1),{remaining:0,sourceId:'target'});
  }
  for(const kind of ['character','effect'])for(const type of [0,10])assert.equal(attackerHitStopOverride({REACT_TYPE:type},{kind}),null);
  for(const value of [{INCREASE_MP:1},{DAMAGE_TYPE:6}])assert.equal(attackerHitStopOverride({...data.DAMAGE_DATA,...value},{kind:'effect'}),null);
  assert.equal(attackerHitStopOverride(data.DAMAGE_DATA,{kind:'core'}),null);
  assert.equal(attackerHitStopOverride({...data.DAMAGE_DATA,STOP_TIME_ATT:.1,STOP_TIME_ATK:.2}).stopTime,.1,'target precedence remains unproven; preserve old alias fallback');
  for(const [kind,type] of [['character',0],['character',10],['effect',0],['core',2],['character',6]]){
    const s=basic(),a=s.actor('rf');a.worldStop=.9;a.hitStop=.7;
    s.applyHit(a,s.actor('target'),{...data.DAMAGE_DATA,REACT_TYPE:type,STOP_TIME_ATT:.1},{kind});
    assert.equal(a.hitStop,.7);assert.equal(a.worldStop,.9,'source exclusions and unexpanded core/manual paths retain existing stop');
  }
});

test('v24 same-state ordinary rehit re-enters with no blend and caps positive incoming speed',()=>{
  const s=basic(),b=s.actor('target');
  s.injectHit({attackerId:'rf',targetId:'target',damageData:data.DAMAGE_DATA});
  s.advanceAnimation(b,profile.states[b.state],.15);
  assert.ok(Math.abs(b.animationTime-.15)<1e-12);assert.equal(b.animationPlaybackSpeed,1);
  const serial=b.stateSerial;
  s.injectHit({attackerId:'rf',targetId:'target',damageData:data.DAMAGE_DATA});
  assert.equal(b.state,'RSI_DAMAGE_BIG_FRONT');assert.equal(b.stateSerial,serial+1);assert.equal(b.animationTime,0);
  assert.equal(b.presentationTransition.enabled,false);assert.equal(b.animationSpeedRamp,null);
  s.advanceAnimation(b,profile.states[b.state],1/60);assert.ok(Math.abs(b.animationTime-1/60)<1e-12);
});

test('unheld FLY landing/down is separate from an existing full cumulative KD override',()=>{
  for(const fromFront of [true,false]){
    const s=basic(),a=s.actor('rf'),b=s.actor('target');b.facing=fromFront?-1:1;
    s.injectHit({attackerId:a.id,targetId:b.id,damageData:data.DAMAGE_DATA_NEXT});
    assert.equal(b.state,fromFront?'RSI_DAMAGE_AIR_FLY_FRONT':'RSI_DAMAGE_AIR_FLY_BACK');
    assert.equal(b.grounded,false);assert.equal(b.vy,250);assert.equal(b.knockdown.now,0);
    for(let i=0;i<100&&!b.grounded;i++)s.step(1/60,{}, {snapshot:false});
    assert.equal(b.state,'RSI_DAMAGE_DOWN_FRONT');
    assert.equal(s.state.events.some(e=>e.type==='knockdownTriggered'),false);
  }
  const s=basic(),b=s.actor('target');b.knockdown.now=b.knockdown.max;
  s.injectHit({attackerId:'rf',targetId:'target',damageData:data.DAMAGE_DATA});
  assert.equal(b.state,'RSI_DAMAGE_DOWN_FRONT');assert.ok(s.state.events.some(e=>e.type==='knockdownTriggered'));
});

test('generic directChange controller matches15 original-DLL outputs independently of the v24 hurt policy',()=>{
  const dll=read('reports/rf-guardian-direct-clock-dll-v17.json');assert.equal(dll.fullClientExecuted,false);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../tools/native/d3dx-reaction-clock-v17-probe.cs',import.meta.url))).digest('hex'),dll.probeSourceSha256);
  for(const old of [0,.65,1,1.3,2]){
    const s=basic(),b=s.actor('target');b.animationPlaybackSpeed=old;
    // The DLL experiment measures generic track interpolation, not the user
    // hurt cap. Keep its literal source clip and1.3 target; exercise the generic
    // controller as a non-hurt action so the original evidence is unchanged.
    b.state='RSI_COMBO_Z';
    s.startAnimationTransition(b,profile.states.RSI_DAMAGE_BIG_FRONT,{directChange:true});
    b.animationTime=0;
    let time=0;
    for(const row of dll.rows.filter(v=>Math.abs(v.initialSpeed-old)<1e-6)){
      s.advanceAnimation(b,profile.states.RSI_DAMAGE_BIG_FRONT,row.controllerTime-time);time=row.controllerTime;
      assert.ok(Math.abs(b.animationTime-row.track0.Position)<1e-6);
      assert.ok(Math.abs(b.animationPlaybackSpeed-row.track0.Speed)<1e-6);
      assert.equal(row.track0.Weight,1);assert.equal(b.presentationTransition.enabled,false);
    }
  }
});

for(const facing of [-1,1])for(const fromFront of [false,true])for(const awakened of [false,true])
test(`actual A cast each accepted Guardian hit obeys source reactions: facing${facing} front${fromFront} awake${awakened}`,async()=>{
  const run=await observeGuardian({facing,fromFront,awakened});assert.ok(run.hits.length>2);
  const ordinary=run.hits.filter(h=>h.damage.REACT_TYPE===2),last=run.hits.find(h=>h.damage.REACT_TYPE===5);
  assert.ok(ordinary.length>1);assert.ok(last,'actual helpers must reach a final FLY in this fixture');
  for(const h of ordinary){
    assert.equal(h.after.state,fromFront?'RSI_DAMAGE_BIG_FRONT':'RSI_DAMAGE_BIG_BACK');
    assert.equal(h.after.stateSerial,h.before.stateSerial+1);assert.equal(h.after.animationTime,0);
    assert.equal(h.after.blendEnabled,false);assert.equal(h.after.hitStop,0);assert.equal(h.after.worldStop,0);
    assert.equal(h.after.knockdown.now,0);
  }
  assert.ok(ordinary[0].before.worldStop>0,'first actual hit interrupts the source skill freeze');
  assert.ok(ordinary[1].before.animationTime>.1,'received action must advance between real hits');
  assert.equal(last.after.state,fromFront?'RSI_DAMAGE_AIR_FLY_FRONT':'RSI_DAMAGE_AIR_FLY_BACK');
  assert.equal(last.after.grounded,false);assert.equal(last.after.velocity[1],250);assert.equal(last.after.knockdown.now,0);
  assert.ok(run.transitions.some(v=>v.state==='RSI_DAMAGE_DOWN_FRONT'&&v.reason==='hit-ground'));
  assert.ok(run.samples.some(v=>v.animationTime>0&&v.animationName.startsWith('DamageBig')));
});

test('JSON restored same-state clocks, stops, KD reserve and actual helper sequence continue identically',async()=>{
  const a=await makeGuardian(),b=await makeGuardian();a.step(1/60,{rf:{pressed:['A'],held:['A']}},{snapshot:false});
  for(let i=0;i<49;i++){a.step(1/60,{}, {snapshot:false});a.drainEvents();}
  assert.equal(a.actor('target').state,'RSI_DAMAGE_BIG_FRONT');b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  for(let i=0;i<230;i++){
    a.step(1/60,{}, {snapshot:false});b.step(1/60,{}, {snapshot:false});
    assert.deepEqual(JSON.parse(JSON.stringify(a.drainEvents())),JSON.parse(JSON.stringify(b.drainEvents())));
    assert.deepEqual(JSON.parse(JSON.stringify(a.snapshot())),JSON.parse(JSON.stringify(b.snapshot())));
  }
});

test('ordinary direct rehit retains original burn identity/finalizer and source head anchor',async()=>{
  const s=await makeGuardian(),a=s.actor('rf'),b=s.actor('target');
  const fire=profile.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR;
  s.grantBuff(a,b,fire,1);assert.equal(b.buffs[0].templateId,37);
  const before=structuredClone(b.buffs[0]);
  for(let i=0;i<2;i++)s.injectHit({attackerId:'rf',targetId:'target',damageData:data.DAMAGE_DATA});
  assert.deepEqual(b.buffs[0],before);
  const event=s.state.events.find(e=>e.type==='hit');assert.ok(event.damageNumber?.position.every(Number.isFinite));
  const hp=b.hp;s.advanceActorBuffs(b,1);assert.ok(b.hp<hp);
  assert.equal(b.buffs[0].templateId,37);assert.equal(b.state,'RSI_DAMAGE_BIG_FRONT');
});

for(const facing of [-1,1])test(`actual zero action-speed bonus keeps source hit reactions, facing${facing}`,async()=>{
  const run=await observeGuardian({facing,speed:1});
  const hits=run.hits.filter(h=>h.damage.REACT_TYPE===2);
  assert.ok(hits.length>1);assert.ok(hits[1].before.animationTime>.1);
  assert.ok(hits.every(h=>h.after.worldStop===0&&!h.after.blendEnabled));
  assert.equal(run.hits.at(-1).after.state,'RSI_DAMAGE_AIR_FLY_FRONT');
  assert.ok(run.transitions.some(v=>v.state==='RSI_DAMAGE_DOWN_FRONT'&&v.reason==='hit-ground'));
});
