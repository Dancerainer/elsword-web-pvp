import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {elesisCommands,resolveElesisState} from '../../packages/combat-core/elesis-commands.mjs';
import {lkBufferedWindow} from '../../packages/combat-core/lk-commands.mjs';
import {evaluateHitCritical} from '../../packages/combat-core/critical-hit.mjs';
import {advanceElesisBreakCharge,elesisSwordHitPolicy,elesisSwordCost,elesisSwordCooldown} from '../../packages/combat-core/elesis-way-of-sword.mjs';
const profiles=Object.fromEntries(['GM','BH','CA','RF'].map(id=>[id,JSON.parse(readFileSync(new URL('../../packages/combat-core/'+id.toLowerCase()+'-profile.json',import.meta.url)))]));
const buffPreset=JSON.parse(readFileSync(new URL('../../config/gm-preset.json',import.meta.url)));
const empty=()=>Array(8).fill(null),map={sceneId:'elesis-source-input',lines:[{lineId:0,start:[-20000,0,0],end:[20000,0,0]}]};
const nativeBase=process.env.ELESIS_NATIVE_FIXTURE_ROOT??resolve('.'),native=await createNativeRuntime({manifest:JSON.parse(readFileSync(resolve(nativeBase,'artifacts/native/manifest.json'))),map,loadBinary:name=>readFileSync(resolve(nativeBase,'artifacts/native',name))});
function fixture(id='GM',facing=1,passives=[]){
 const p=profiles[id],sim=createSimulation({profile:p,profiles:{[id]:p,RF:profiles.RF},map,nativeSkillValues:native.skillValues,nativeManaBreak:native.manaBreak,preset:{buffResistances:buffPreset.buffResistances,debuffDurationMultiplier:1,doubleTapWindowSeconds:.4,passives,guildPassives:[],loadout:empty()},presets:{RF:{passives:[],guildPassives:[],loadout:empty()}},actors:[{id:'el',professionId:id,team:0,x:0,y:0,facing,loadout:empty(),awakening:{orbs:3}},{id:'rf',professionId:'RF',team:1,x:10000,y:0,loadout:empty()}]});
 const a=sim.actor('el'),b=sim.actor('rf'),input=createInputBuffer(),forward=facing===1?'RIGHT':'LEFT';
 const source=()=>p.states[a.state].sourceState,step=()=>sim.step(1/60,{el:input.consume(sim.state.time+1/60)});
 const tap=k=>{input.tap(k,sim.state.time+.001);step();},down=k=>{input.down(k,sim.state.time+.001);step();},up=k=>{input.up(k,sim.state.time+.001);step();};
 const until=(predicate,label,max=300)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),label+'; got '+source()+' @ '+a.animationTime);};
 const state=n=>until(()=>source()===n,n),time=t=>{const serial=a.stateSerial;until(()=>a.animationTime>=t||a.stateSerial!==serial,'time '+t);assert.equal(a.stateSerial,serial);};
 const next=(k,n,at=.04)=>{time(at);tap(k);state(n);};
 const dash=()=>{tap(forward);down(forward);assert.equal(a.state,'RSI_DASH');};
 return {p,sim,a,b,source,step,tap,down,up,until,state,time,next,dash,forward};
}
const damage=type=>({DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,ATTACK_TYPE:2,HIT_ADD_MP:8,STOP_TIME_DEF:0,STOP_TIME_ATT:0,WAY_OF_SWORD_TYPE:type});
function zzz(f){f.tap('Z');f.next('Z','ESI_COMBO_ZZ');f.next('Z','ESI_COMBO_ZZZ');}
// All successor/window expectations below are original2016 declarations and
// separately inspected fixed EL callbacks; never recordings of this adapter.
for(const id of ['GM','BH','CA'])for(const facing of [-1,1]){
 test(`${id} ${facing}: device ZZZZ and profession ZZZX`,()=>{
  const z=fixture(id,facing);zzz(z);z.next('Z','ESI_COMBO_ZZZZ',.2);z.state('ESI_WAIT');
  const x=fixture(id,facing);zzz(x);x.next('X',({GM:'ESI_COMBO_SGM_ZZZX',BH:'ESI_COMBO_SBH_ZZZX',CA:'ESI_COMBO_SDK_ZZZX'})[id],.2);x.state('ESI_WAIT');
 });
 test(`${id} ${facing}: device dash ZZ uses its own route and terminates`,()=>{
  const f=fixture(id,facing);f.dash();f.tap('Z');f.next('Z',({GM:'ESI_DASH_COMBO_SSK_ZZ',BH:'ESI_DASH_COMBO_SPK_ZZ',CA:'ESI_DASH_COMBO_SCA_ZZ'})[id]);f.up(f.forward);f.state('ESI_WAIT');
 });
 test(`${id} ${facing}: strict .266 skill/dash cancels and attack buffer survives hitstop`,()=>{
  const f=fixture(id,facing);f.sim.enter(f.a,'RSI_COMBO_ZZZ','source-boundary');
  const keys={held:new Set(),pressed:new Set(['DASH']),pureDoubleLeft:false,pureDoubleRight:false};
  f.a.animationTime=.266;assert.equal(elesisCommands.runEvent(f.a,keys,f.p).state,null);
  f.a.animationTime=.266001;assert.equal(elesisCommands.runEvent(f.a,keys,f.p).state,'DASH_REQUEST');
  const regular=f.p.skillCatalog.find(s=>s.selectable&&s.supported&&!s.passive&&s.type!==6&&s.useCondition===1);
  f.sim.configureLoadout([{skillId:regular.skillId},...empty().slice(1)],'el');f.a.mp=f.a.mpMax;
  f.a.animationTime=.266;assert.equal(f.sim.skillAvailability('el',0).available,false);
  f.a.animationTime=.266001;assert.equal(f.sim.skillAvailability('el',0).available,true);
  const g=fixture(id,facing);g.tap('Z');g.a.hitStop=.1;g.tap('Z');g.state('ESI_COMBO_ZZ');
 });
}
test('CA dash ZZ remembers Z separately from X, and SDK X chain reaches seven X',()=>{
 for(const [key,state]of [['Z','ESI_DASH_COMBO_SCA_ZZZ_START'],['X','ESI_DASH_COMBO_SCA_ZX_START']]){const f=fixture('CA');f.dash();f.tap('Z');f.next('Z','ESI_DASH_COMBO_SCA_ZZ');f.next(key,state);}
 const f=fixture('CA');f.tap('X');for(let i=2;i<=7;i++)f.next('X','ESI_COMBO_SDK_'+'X'.repeat(i),i===2?.06:.12);f.state('ESI_WAIT');
});
test('BH input XXX dash instantiates sourced costs and projectile roots',()=>{
 const f=fixture('BH');f.dash();f.tap('X');f.next('X','ESI_DASH_COMBO_SBH_XX',.12);f.next('X','ESI_DASH_COMBO_SBH_XXX',.12);f.up(f.forward);f.state('ESI_WAIT');
 const names=f.sim.state.events.filter(e=>e.type==='effectSet').map(e=>e.name);
 for(const name of ['EffectSet_Elesis_SBH_Dash_Combo_X','EffectSet_Elesis_SBH_Dash_Combo_XX','EffectSet_Elesis_SBH_Dash_Combo_XXX'])assert.ok(names.includes(name),name);
});
for(const id of ['GM','BH','CA']){
 test(`${id}: Chivalry cannot inherit Elsword MP/damage/automatic rage`,()=>{
  const f=fixture(id);assert.equal('destructionRageRemaining' in f.a,false);
  f.sim.prepareWayOfSword('el',2);assert.equal(f.a.animationName,'Wait_W0');f.a.mp=0;
  f.sim.injectHit({attackerId:'el',targetId:'rf',damageData:damage(1)});assert.equal(f.a.mp,8);
  const points=f.a.wayOfSword.point;f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:damage(1)});assert.equal(f.a.wayOfSword.point,points);
  f.sim.prepareWayOfSword('el',-2);f.a.invincible=false;f.a.forceInvincible=0;f.a.superArmor=false;
  const hit=f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:damage(1)});assert.ok(hit.amount>0);assert.notEqual(f.a.state,'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE');
  assert.deepEqual(elesisSwordHitPolicy(f.a,damage(4)),{damage:1.25,mp:1,forceCritical:true});
  assert.deepEqual(elesisSwordHitPolicy(f.a,damage(6)),{damage:1,mp:1,forceCritical:true});
  f.sim.prepareWayOfSword('el',2);const skill={raw:{m_usWOSType:2}};
  assert.equal(elesisSwordCost(f.a,skill,100),80);assert.ok(Math.abs(elesisSwordCooldown(f.a,skill,10)-6)<.000001);
 });
 test(`${id}: zero-MP full charge absorbs triggering hit, uses real shock carrier and original five-second buff`,()=>{
  const f=fixture(id);f.sim.prepareWayOfSword('el',-2);f.a.mp=0;
  for(let i=0;i<40;i++){f.a.manaBreak.canCharge=true;advanceElesisBreakCharge(f.a,1/60);}
  assert.equal(f.a.sourceElesisBreakCharge,2000);const hp=f.a.hp,knockdown=structuredClone(f.a.knockdown);
  const hit=f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:{...damage(1),FORCE_DOWN:100}});
  assert.equal(hit.amount,0);assert.equal(f.a.hp,hp);assert.equal(f.a.mp,0);assert.deepEqual(f.a.knockdown,knockdown);
  assert.equal(f.p.states[f.a.state].sourceState,'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE');assert.equal(f.a.sourceElesisBreakCharge,0);
  assert.ok(f.a.buffs.some(b=>b.templateId===248&&b.finalizers.some(x=>x.kind==='time'&&x.remaining===5)));assert.ok(!f.a.buffs.some(b=>b.templateId===143));
  assert.ok(f.sim.state.effects.some(e=>e.damage?.DAMAGE_DATA?.NO_DAMAGE===1&&e.damage?.DAMAGE_DATA?.FORCE_FLY===1),'actual NO_DAMAGE shock effect');
  assert.ok(!f.sim.state.events.some(e=>e.type==='destructionRageStarted'));
 });
 test(`${id}: Iron Body no-state cast preserves attack and enhancement counter consumes buff`,()=>{
  const f=fixture(id);f.sim.configureLoadout([{skillId:28218},...empty().slice(1)],'el');f.tap('Z');const state=f.a.state;
  f.tap('A');assert.equal(f.a.state,state);assert.equal(f.a.mp,180);assert.ok(f.a.buffs.some(b=>b.templateId===238));
  f.a.hitStop=0;f.a.superArmor=false;const hit=f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:damage(1)});
  assert.equal(hit.amount,0);assert.equal(f.p.states[f.a.state].sourceState,'ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE_MEMO');assert.ok(!f.a.buffs.some(b=>b.templateId===238));assert.ok(f.a.buffs.some(b=>b.templateId===542));
 });
}
test('Elesis command flags, gauge charge and chained input restore deterministically',()=>{
 const f=fixture('CA'),g=fixture('CA');f.dash();f.tap('Z');f.next('Z','ESI_DASH_COMBO_SCA_ZZ');f.tap('X');f.sim.drainEvents();g.sim.restore(f.sim.snapshot());
 for(let i=0;i<120;i++){f.sim.step(1/60,{});g.sim.step(1/60,{});assert.deepEqual(f.sim.snapshot(),g.sim.snapshot());}
});
for(const id of ['GM','BH','CA']){
 test(`${id}: sampled device attack taps survive freeze without resurrecting directions`,()=>{
  const f=fixture(id);f.tap('Z');f.a.hitStop=.08;
  f.sim.step(1/60,{el:{sampledDevice:true,held:['Z','LEFT'],pressed:['Z','LEFT']}});
  for(let i=0;i<7;i++)f.sim.step(1/60,{el:{sampledDevice:true,held:[],pressed:[]}});
  f.state('ESI_COMBO_ZZ');assert.equal(f.a.facing,1);assert.deepEqual(f.a.pendingPressed,[]);
 });
 test(`${id}: actual held Z charges zero-MP annihilation and releasing clears source charge`,()=>{
  const f=fixture(id);f.sim.prepareWayOfSword('el',-2);f.a.mp=0;
  for(let i=0;i<42;i++)f.sim.step(1/60,{el:{held:['Z']}});
  assert.equal(f.a.sourceElesisBreakCharge,2000);
  f.sim.step(1/60,{el:{held:[]}});f.sim.step(1/60,{el:{held:[]}});assert.equal(f.a.sourceElesisBreakCharge,0);
 });
 test(`${id}: fifth continuous hit adds Gale buff; the1.3s break resets the count`,()=>{
  const f=fixture(id);f.sim.prepareWayOfSword('el',2);
  for(let i=0;i<5;i++){f.b.invincible=false;f.b.forceInvincible=0;f.sim.injectHit({attackerId:'el',targetId:'rf',damageData:damage(1)});}
  assert.equal(f.a.sourceElesisGaleHits,5);assert.ok(f.a.buffs.some(b=>b.templateId===246&&b.accumulationCount===1));
  for(let i=0;i<81;i++)f.step();assert.equal(f.a.sourceElesisGaleHits,0);
 });
 test(`${id}: sourced quick standup X role exists and user no-down policy remains scoped`,()=>{
  const f=fixture(id);f.a.downAttackChoice='X';f.sim.enter(f.a,'RSI_STANDUP_ATTACK_FRONT_NO_DOWN','standup-test');
  assert.equal(f.sim.profileFor(f.a).states[f.a.state].sourceState,'ESI_QUICK_STANDUP_ATTACK_FRONT');assert.equal(f.a.standupAttackNoDown,true);
 });
 test(`${id}: all declared command-buffer limits have inclusive input start, exclusive input end and strict change`,()=>{
  let count=0;for(const [state,d]of Object.entries(profiles[id].states)){
   if(!elesisCommands.handlesEvent({state,professionId:id}))continue;
   for(const [key,w]of Object.entries(d.raw))if(/^EVENT_PROCESS_TIME\d+$/.test(key)){
    assert.equal(lkBufferedWindow(0,0,w['1']-.0001,true,w).consumed,false);
    assert.equal(lkBufferedWindow(0,0,w['1'],true,w).consumed,true);
    assert.equal(lkBufferedWindow(0,0,w['2'],true,w).consumed,false);
    assert.equal(lkBufferedWindow(1,0,w['3'],false,w).changed,false);
    assert.equal(lkBufferedWindow(1,0,w['3']+.0001,false,w).changed,true);count++;
   }
  }assert.ok(count>20);
 });
 test(`${id}: airborne Z/X hold the original stopped attack until landing, then return to WAIT`,()=>{
  for(const key of ['Z','X']){const f=fixture(id);f.tap('UP');for(let i=0;i<5;i++)f.step();f.tap(key);f.down('DOWN');
   f.state('ESI_JUMP_LANDING');assert.ok(f.a.canNotJumpTime>0);f.up('DOWN');f.state('ESI_WAIT');}
 });
 test(`${id}: fresh awakening skill cancel rejects exact threshold and accepts the following instant`,()=>{
  for(const [offset,allowed]of [[0,false],[.0001,true]]){const f=fixture(id),state='ESI_SI_SA_SSK_SPIRAL_BLAST';
   f.a.skillId=f.p.skillCatalog.find(s=>s.state===state).skillId;f.a.skillContext={key:'S',level:1,traitPolicy:null};f.sim.enter(f.a,state,'source-awakening-gate');
   f.a.animationTime=Math.fround(1.85)+offset;f.a.worldStop=f.a.hitStop=f.a.inputLock=0;
   f.sim.processInput(f.a,{held:new Set(),pressed:new Set(['AWAKEN']),pureDoubleLeft:false,pureDoubleRight:false});
   assert.equal(f.a.state!==state,allowed);if(allowed)assert.equal(f.sim.profileFor(f.a).states[f.a.state].sourceState,'ESI_HYPER_MODE');
  }
 });
}
test('28403 uses native passive level for initial Rushing Sword MP; Victorious Sword Dodge is free with1s cooldown',()=>{
 const f=fixture('GM',1,[28403]);f.sim.configureLoadout([{skillId:28219},...empty().slice(1)],'el');
 assert.equal(f.sim.skillAvailability('el',0).mpCost,f.p.skillCatalog.find(s=>s.skillId===28219).mpCost-3);
 f.sim.grantBuff(f.a,f.a,345,1);f.sim.configureLoadout([{skillId:28217},...empty().slice(1)],'el');
 assert.equal(f.sim.skillAvailability('el',0).mpCost,0);assert.equal(f.sim.skillAvailability('el',0).cooldown,1);
});
test('BH Concentration native critical bonus applies only to magical damage',()=>{
 const f=fixture('BH',1,[28407]);f.a.stats.criticalRate=0;
 for(const [type,expected]of [[0,false],[1,true]]){
  const r=evaluateHitCritical(native.critical,{amount:100,attacker:f.a,defender:f.b,data:{DAMAGE_TYPE:type},roll:.01});
  assert.equal(r.critical,expected);if(type===1)assert.equal(r.amount,160);
 }
});

for(const side of ['FRONT','BACK'])for(const forward of [true,false])test(`GM28404 ${side}/${forward}: early direction buffer and strict rolling X gate use original rise states`,()=>{
 const f=fixture('GM',1,[28404]),state='RSI_DAMAGE_DOWN_'+side,key=forward?'RIGHT':'LEFT';f.sim.enter(f.a,state,'quick-rise');
 const keys={held:new Set([key]),pressed:new Set([key])};
 f.a.animationTime=.099;f.sim.processInput(f.a,keys);assert.equal(f.a.downSuccessor,null);
 f.a.animationTime=.1;f.sim.processInput(f.a,keys);f.a.animationTime=.12;f.sim.processInput(f.a,keys);
 f.a.animationTime=.25;f.sim.processInput(f.a,keys);assert.equal(f.a.state,state);
 f.a.animationTime=.2501;f.sim.processInput(f.a,keys);assert.equal(f.a.state,'ESI_STANDUP_ROLLING_'+side+'_'+(forward?'FRONT':'BACK'));
 f.a.animationTime=.1;let r=elesisCommands.runEvent(f.a,{held:new Set(),pressed:new Set(['X'])},f.p);f.a.sourceCommandFlags=r.flags;
 const gate=side==='FRONT'&&!forward?.8:.9;
 f.a.animationTime=Math.fround(gate);r=elesisCommands.runEvent(f.a,{held:new Set(),pressed:new Set()},f.p);assert.equal(r.state,null);
 f.a.animationTime=gate+.0001;r=elesisCommands.runEvent(f.a,{held:new Set(),pressed:new Set()},f.p);assert.equal(r.state,'ESI_QUICK_STANDUP_ATTACK_'+(forward?'BACK':'FRONT')+'_ADVANCED');
 f.sim.enter(f.a,r.state,'rolling-X');assert.equal(f.a.standupAttackNoDown,true);assert.ok(f.a.forceInvincible>=.3);
});
test('ordinary Elesis rolling keeps .33 input gate while advanced mastery modifies both knockdown directions',()=>{
 const ordinary=fixture('BH');ordinary.sim.enter(ordinary.a,'RSI_DAMAGE_DOWN_FRONT','rolling');
 const keys={held:new Set(['LEFT']),pressed:new Set(['LEFT'])};ordinary.a.animationTime=Math.fround(.33);ordinary.sim.processInput(ordinary.a,keys);assert.equal(ordinary.a.downSuccessor,null);
 ordinary.a.animationTime=.3301;ordinary.sim.processInput(ordinary.a,keys);assert.equal(ordinary.a.downSuccessor,'ESI_STANDUP_ROLLING_FRONT_BACK');
 const f=fixture('GM',1,[28404]);f.sim.injectHit({attackerId:'el',targetId:'rf',damageData:{...damage(1),FORCE_DOWN:10}});
 assert.equal(f.sim.state.events.find(e=>e.type==='hit').data.FORCE_DOWN,8.5);
 f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:{...damage(1),FORCE_DOWN:10}});assert.ok(Math.abs(f.a.knockdown.pending-11.5)<.00001);
});
test('28410 target Dark Force scales earned/received points but not the fixed burst cost',()=>{
 const base=fixture('CA'),learned=fixture('CA',1,[28410]);
 for(const f of [base,learned])f.sim.injectHit({attackerId:'el',targetId:'rf',damageData:damage(4)});
 assert.ok(Math.abs(learned.a.wayOfSword.point-base.a.wayOfSword.point*1.5)<.0001);
 for(const f of [base,learned]){f.a.wayOfSword={point:100,state:1};f.sim.injectHit({attackerId:'rf',targetId:'el',damageData:damage(4)});}
 assert.equal(learned.a.wayOfSword.point-100,(base.a.wayOfSword.point-100)*1.5);
 learned.sim.prepareWayOfSword('el',-2);learned.a.sourceElesisBreakCharge=2000;learned.a.invincible=false;learned.a.forceInvincible=0;
 learned.sim.injectHit({attackerId:'rf',targetId:'el',damageData:damage(4)});assert.equal(learned.a.wayOfSword.point,-2550);
});
