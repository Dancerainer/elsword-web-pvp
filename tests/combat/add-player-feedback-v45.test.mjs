import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {ADD_BONE_TARGETS,ADD_ANALYSIS_BONE_TARGETS} from '../../packages/combat-core/lk-effect-set-targets.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
import {addNasodRequest} from '../../packages/combat-core/add-nasod.mjs';
import {validateAddLockOn} from '../../packages/combat-core/add-lock-on.mjs';
import {bindAddPulseFront2016} from '../../packages/combat-core/add-pulse-cannon-2016.mjs';
import {updateIonBlackHole} from '../../packages/combat-core/black-hole.mjs';
import {validateAddMoonlightState,startAddMoonlight} from '../../packages/combat-core/add-moonlight-v45.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
const cast=(sim,frames=300,hold=100)=>{for(let i=0;i<frames;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i<hold?['A']:[]}});};
const keys=(pressed=[],held=pressed)=>({held:new Set(held),pressed:new Set(pressed),pureDoubleRight:false,pureDoubleLeft:false});
const hits=(sim,id)=>sim.state.events.filter(e=>e.type==='hit'&&e.actorId===id&&e.amount>0);

test('MM and LP feedback bindings choose the sole original BONE_TRACE_TARGET_MESH, with original converted pose',()=>{
 for(const [id,names,table]of [
  ['MM',['EffectSet_SI_SA_AAT_Psionic_Generator_Start','EffectSet_SI_SA_AAT_Phantom_Seeker_Start','EffectSet_SI_SA_AAT_Phantom_Seeker_Fire1','EffectSet_SI_SA_AAT_Phantom_Seeker_Fire2','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock'],ADD_ANALYSIS_BONE_TARGETS],
  ['LP',['EffectSet_SI_SA_ALP_Psychic_Storm_Start','EffectSet_SI_SA_ALP_Psychic_Storm_Loop'],ADD_BONE_TARGETS],
 ]){const {profile}=originalAddFixture(id);for(const name of names){
   const rows=Object.values(profile.effectSets[name].raw).filter(r=>r?.BONE_TRACE_TARGET_MESH===1);
   assert.equal(rows.length,1);assert.equal(rows[0].NAME,table[name]);
   const main=profile.damageEffects[table[name]]?.raw.MAIN_EFFECT_NAME??table[name];
   assert.equal(profile.effectTemplates[main].fields.MeshType,'X_SKIN_MESH');assert.ok(profile.effectTemplates[main].poseData);
  }}
});

test('Psionic Generator delayed original Dummy02 explosion deals damage after caster recovery and retires',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29014});a.mp=a.mpMax;a.sourceAdd.dp=8000;cast(sim);
 const hit=hits(sim,a.id).find(e=>e.origin?.skillId===29014);assert.ok(hit);
 const born=sim.state.events.find(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AAT_Psionic_Generator_Explosion');assert.ok(born?.birthAnchor?.position);
 assert.ok(b.hp<b.hpMax);assert.equal(sim.state.effects.some(e=>e.setName==='EffectSet_SI_SA_AAT_Psionic_Generator_Start'),false);
 assert.ok(!a.unsupported.some(e=>e.id.startsWith('effect-bone-birth:')));
});

test('Phantom Seeker original main and homing sub both hit; unknown slash appearance does not erase scalar damage',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29015});a.mp=a.mpMax;cast(sim);
 const started=sim.state.events.filter(e=>e.type==='effectStarted'),ids=new Set(started.filter(e=>e.name==='DamageEffect_AAT_Phantom_Seeker_Projectile_Sub').map(e=>e.effectId));
 assert.ok(hits(sim,a.id).some(e=>ids.has(e.origin?.id)));assert.ok(b.hp<b.hpMax);
 assert.ok(!a.unsupported.some(e=>e.id.startsWith('damage-values:')||e.id.startsWith('effect-bone-birth:')));
});

test('original Pulse Cannon LOT6 steers upward using its curve2 and native vector kernel',()=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29006});Object.assign(b,{x:200,y:3300,z:0});a.skillId=29006;
 const e=sim.createEffect(a,{NAME:'DamageEffect_SA_APT_Pulse_Cannon_Projectile'},
  {birthAnchor:{position:[0,3180,0],facing:1,rotation:[0,0,0]}});
 // Original default PvP selector is strictly150<distance<300. The manual
 // factory fixture must also supply the actual owner ONLY_FRONT snapshot.
 const distance=Math.hypot(200,3300-3180);assert.ok(distance>150&&distance<300);bindAddPulseFront2016(e,a,sim.map);
 for(let i=0;i<8;i++)sim.tickEffects(1/60);
 assert.equal(e.sourceAddLockOn.targetId,b.id);assert.ok(e.sourceAddLockOn.manualDirDegree[1]>0);
 assert.ok(e.sourceShadowMesh.position[1]>3180);assert.equal(e.damage.LOCK_ON_DATA.CURVE_SPEED,2);
 validateAddLockOn(e,sim.profileFor(a),a,sim.state.actors);
 const forged={...e,skillId:29008};assert.throws(()=>validateAddLockOn(forged,sim.profileFor(a),a,sim.state.actors),/auto-lock-on-source/);
});

test('unmarked C4 automatically acquires an eligible body within the original700 range',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29211});a.skillId=29211;Object.assign(b,{x:600,y:3400,z:0});
 const e=sim.createEffect(a,{NAME:'DamageEffect_AMM_Countdown_Bomb_Projectile'},
  {birthAnchor:{position:[0,3180,0],facing:1,rotation:[0,0,0]}});
 for(let i=0;i<24;i++)sim.tickEffects(1/60);
 assert.equal(e.sourceAddMarkedDrone,undefined);assert.equal(e.sourceAddLockOn?.targetId,b.id);
 validateAddLockOn(e,sim.profileFor(a),a,sim.state.actors);
});

for(const id of ['LP','MM','DE'])test(`${id} second dash-jump Z retains its authored X branch`,()=>{
 const {a,profile}=originalAddFixture(id);Object.assign(a,{state:'ANSI_DASH_JUMP_COMBO_ZZ',grounded:false,animationTime:.1,sourceCommandFlags:0});
 const first=addCommands.runEvent(a,keys(['X']),profile);assert.equal(first.state,null);a.sourceCommandFlags=first.flags;a.animationTime=.43;
 assert.equal(addCommands.runEvent(a,keys(),profile).state,`ANSI_${{LP:'APT',MM:'AAT',DE:'ATT'}[id]}_DASH_JUMP_COMBO_ZX`);
});

for(const id of ['LP','MM','DE'])test(`${id} 8Z forward movement uses original walk speed and Down consumes extra gravity`,()=>{
 const {a,profile}=originalAddFixture(id);Object.assign(a,{state:'RSI_JUMP_COMBO_Z',grounded:false,vx:0,vy:0});
 const future=addCommands.runFuture(a,keys([],['RIGHT','DOWN']),profile,1/60);
 assert.equal(future.vx,Math.fround(Math.fround(profile.physics.WALK_SPEED)*Math.fround(a.stats.moveSpeedMultiplier)));
 assert.equal(future.vy,Math.fround(-Math.fround(profile.physics.G_ACCEL/60)));
 assert.equal(addCommands.runFuture(a,keys([],['LEFT']),profile,1/60).vx,0,'fixed source only accepts the current facing direction');
});

test('formed Conqueror shares its source EventProcess NA callback inventory',()=>{
 const {a,profile}=originalAddFixture('LP',{skillId:29008});a.sourceAdd.formation=true;Object.assign(a,{state:'ANSI_SA_APT_CONQUEROR_HYPER',animationTime:1,sourceAddCombat:{pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:'target'}});
 const state=profile.states[a.state];assert.equal(addNasodRequest(a,state,profile,keys(['Z'])),null);a.animationTime=1.74;
 assert.equal(addNasodRequest(a,state,profile,keys()),'ANSI_COMBO_NASOD_ARMOR_READY');
});

test('normal Conqueror releases twelve original declared projectiles at its qualified source offset',()=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29008});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1500;cast(sim,170,1);
 const shots=sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_SA_APT_Conqueror_Projectile');
 assert.equal(shots.length,12);assert.ok(shots.every(e=>e.birthAnchor.position[0]>a.x+100));
 assert.ok(!a.unsupported.some(e=>e.id.startsWith('damage-lock-on:')));
});

test('Quicksilver original only-hit black hole pulls accepted enemies without pulling unrelated targets',()=>{
 const {sim,a,b,profile}=originalAddFixture('LP');const raw=profile.damageEffects.DamageEffect_ALP_Quicksilver_Accel_Blackhole.raw;
 const e={id:99,skillId:29011,name:'DamageEffect_ALP_Quicksilver_Accel_Blackhole',active:true,dead:false,damage:raw,currentAnchor:{position:[500,3080,0]},hits:{}};
 Object.assign(b,{x:250,y:3080,z:0});assert.equal(updateIonBlackHole(e,a,[a,b],1/60),true);assert.deepEqual(b.blackHoleDisplacement,[0,0,0]);
 e.hits[b.id]=1;updateIonBlackHole(e,a,[a,b],1/60);assert.ok(b.blackHoleDisplacement[0]>0);assert.equal(b.sourceBlackHoleCanPass,true);
});

test('Void Field holds beyond one second, consumes additional MP and releases at the source five-second cap',()=>{
 const {sim,a}=originalAddFixture('DE',{skillId:29023});a.mp=360;a.mpMax=360;cast(sim,140,999);
 assert.equal(sim.profileFor(a).states[a.state].sourceState,'ANSI_SA_ATT_VOID_FIELD_LOOP');const before=a.mp;
 tick(sim,60,{add:{held:['A']}});assert.ok(a.mp<before-20);
 tick(sim,220,{add:{held:['A']}});assert.notEqual(sim.profileFor(a).states[a.state].sourceState,'ANSI_SA_ATT_VOID_FIELD_LOOP');
});

test('Moonlight continues after cast recovery, periodically grants the original stacked target debuff and survives owned transport',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29024});const profile=sim.profileFor(a);a.mp=a.mpMax;cast(sim,250,1);
 assert.equal(a.sourceAddCombat.moonlight.period,1);assert.ok(sim.state.events.some(e=>e.type==='addMoonlightPulse'));
 assert.ok(b.buffs.some(b=>b.templateId===439));validateAddMoonlightState(a.sourceAddCombat.moonlight,{owner:a,profile});
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:250}))),state=validateOwnedState(raw);
 validateOwnedReferences(state,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,state);
 assert.ok(sim.actor(a.id).sourceAddCombat.moonlight);
 for(const mutation of [{...a.sourceAddCombat.moonlight,period:.1},{...a.sourceAddCombat.moonlight,skillId:29022}])
  assert.throws(()=>validateAddMoonlightState(mutation,{owner:a,profile}),/Moonlight/);
});

function formed(fixture){fixture.a.sourceAdd.dp=8000;fixture.a.sourceAdd.formation=true;fixture.a.mp=fixture.a.mpMax;fixture.sim.step(1/60,{});return fixture;}

test('actual LP Z → ZZ → ZZZ → ZZZZ then fresh Z catches its launched target with the original recovery window and bones',()=>{
 const {sim,a,b,profile}=formed(originalAddFixture('LP'));b.x=115;
 const sent=new Set(),states=[];let freshZ=false;
 for(let frame=0;frame<240;frame++){
  const s=profile.states[a.state],prefix=['ANSI_COMBO_Z','ANSI_COMBO_ZZ','ANSI_COMBO_ZZZ'].includes(s.sourceState);
  const press=frame===0||prefix&&!sent.has(a.stateSerial)&&a.animationTime>s.raw.EVENT_PROCESS_TIME0['1']+.03||
   s.sourceState==='ANSI_COMBO_ZZZZ'&&!sent.has(a.stateSerial)&&a.animationTime>.5;
  if(press){sent.add(a.stateSerial);if(s.sourceState==='ANSI_COMBO_ZZZZ'){freshZ=true;assert.ok(a.animationTime<s.raw.EVENT_PROCESS_TIME0['2']);}}
  sim.step(1/60,{add:{pressed:press?['Z']:[],held:press?['Z']:[]}});if(states.at(-1)!==a.state)states.push(a.state);
 }
 assert.ok(freshZ);assert.deepEqual(states.slice(0,7),['RSI_COMBO_Z','RSI_COMBO_ZZ','RSI_COMBO_ZZZ','RSI_COMBO_ZZZZ','ANSI_COMBO_NASOD_ARMOR_READY','ANSI_COMBO_NASOD_ARMOR_ATTACK','ANSI_COMBO_NASOD_ARMOR_LANDING']);
 const pursuit=sim.state.events.find(e=>e.type==='addNasodPursuitAttempt');assert.equal(pursuit?.targetId,b.id);assert.ok(pursuit.position[1]>pursuit.from[1]+100);
 const catchIds=new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AN_Nasod_Armor_CatchingAttack_Loop').map(e=>e.effectId));
 assert.ok(sim.state.events.some(e=>e.type==='hit'&&catchIds.has(e.origin?.id)),'the original catch mesh must actually touch the launched body');
 assert.deepEqual(a.unsupported,[]);
});

test('formed Conqueror launch beyond the discarded500 guard pursues and continues identically after a snapshot',()=>{
 const first=formed(originalAddFixture('LP',{skillId:29008}));first.b.x=950;
 const {sim,a,profile}=first;let requested=false;
 for(let frame=0;frame<125;frame++){
  const pressZ=!requested&&profile.states[a.state].sourceState==='ANSI_SA_APT_CONQUEROR_HYPER'&&a.animationTime>.2;
  if(pressZ)requested=true;sim.step(1/60,{add:{pressed:frame===0?['A']:pressZ?['Z']:[],held:frame===0?['A']:pressZ?['Z']:[]}});
 }
 assert.equal(a.state,'ANSI_COMBO_NASOD_ARMOR_READY');assert.equal(a.sourceAddCombat.nasodTargetId,first.b.id);
 assert.ok(Math.hypot(first.b.x-a.x,first.b.y-a.y)>500);
 const second=originalAddFixture('LP',{skillId:29008});second.sim.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 tick(sim,110);tick(second.sim,110);assert.deepEqual(second.sim.snapshot(),sim.snapshot());
 const attempt=sim.state.events.find(e=>e.type==='addNasodPursuitAttempt');assert.ok(attempt?.resolved);
 assert.ok(attempt.position[0]>attempt.from[0]+400,'a legal captured target must not resolve from the old caster position');
});

test('a captured knocked-down protected target still receives a pursuit attempt without bypassing its damage protection',()=>{
 const {sim,a,b}=formed(originalAddFixture('LP'));b.x=800;b.forceInvincible=2;sim.enter(b,'RSI_DOWN','feedback-down');
 a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1,nasodTargetId:b.id};
 const before=b.hp;sim.enter(a,'ANSI_COMBO_NASOD_ARMOR_ATTACK','feedback-down-pursuit');tick(sim,8);
 assert.equal(sim.state.events.find(e=>e.type==='addNasodPursuitAttempt')?.targetId,b.id);assert.equal(b.hp,before);
});

test('Ultimate Fury original three drones survive birth, acquire a target, deal beam damage and all expire',()=>{
 const {sim,a,b}=originalAddFixture('MM',{skillId:29017});a.sourceAdd.dp=8000;a.mp=a.mpMax;sim.step(1/60,{});
 for(let frame=0;frame<840;frame++)sim.step(1/60,{add:{pressed:[0,201].includes(frame)?['A']:[],held:[0,201].includes(frame)?['A']:[]}});
 const beams=new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AMM_Ultimate_Fury_Dynamo_Dummy_Attack').map(e=>e.effectId));
 assert.ok(beams.size>0);assert.ok(hits(sim,a.id).some(e=>beams.has(e.origin?.id)));assert.ok(b.hp<b.hpMax);
 assert.equal(sim.state.effects.some(e=>e.sourceAddFury),false,'no immortal unbound drones remain after the original active duration');
});

for(const id of ['LP','MM','DE'])test(`${id} actual 88Z cancels levitation into a forward/down source Z packet`,()=>{
 const {sim,a}=originalAddFixture(id);sim.step(1/60,{});const states=[];
 for(let frame=0;frame<16;frame++){
  const input=frame===0||frame===8?{pressed:['UP'],held:['UP']}:frame===10?{pressed:['Z'],held:['Z','RIGHT','DOWN']}:frame>10?{held:['RIGHT','DOWN']}:{};
  sim.step(1/60,{add:input});states.push(a.state);
 }
 assert.equal(states[8],'ANSI_LEVITATION_WAIT');assert.equal(states[10],'RSI_JUMP_COMBO_Z');
 assert.ok(a.x>30&&a.y<3295&&a.vy<0);assert.equal(a.sourceAddMovement.levitationAvailable,false);
});

test('Maximum Strike prepared orbs remember an actual later Moonlight mark and the released original shot tracks that recipient',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29022});a.sourceAdd.dp=8000;a.mp=a.mpMax;b.x=1400;
 a.loadout[1]={skillId:29024,requestedSkillId:29024,branchId:'none',level:1};sim.step(1/60,{});
 cast(sim,110,1);a.mp=a.mpMax;tick(sim,1,{add:{pressed:['S'],held:['S']}});tick(sim,199);
 assert.equal(a.sourceAddCombat.maximumStrike.targetId,null);assert.equal(a.sourceAddCombat.moonlight.period,1);
 b.x=300;tick(sim,80);
 const markIds=new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_MOONLIGHT_RHAPSODY_Debuff').map(e=>e.effectId));
 assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.amount===0&&markIds.has(e.origin?.id)));
 assert.equal(a.sourceAddCombat.maximumStrike.targetId,b.id);assert.ok(a.sourceAddCombat.maximumStrike.lastHitAgo<2);
 tick(sim,1,{add:{pressed:['A'],held:['A']}});
 const shot=sim.state.effects.find(e=>e.name==='DamageEffect_ATT_Maximum_Strike_Bullet_Attack');assert.equal(shot?.sourceAddLockOn?.targetId,b.id);
 assert.equal(sim.state.events.filter(e=>e.type==='addMaximumStrikeFired').at(-1).targetId,b.id);
});

test('MM actual ZZZX retains its independently declared common hit while the absent small-Fury enhancement remains separate',()=>{
 const {sim,a,b,profile}=originalAddFixture('MM');a.sourceAdd.dp=8000;b.x=115;sim.step(1/60,{});const sent=new Set(),states=[];
 for(let frame=0;frame<150;frame++){
  const s=profile.states[a.state],third=s.sourceState==='ANSI_COMBO_ZZZ',key=third?'X':'Z',w=s.raw['EVENT_PROCESS_TIME'+(third?1:0)];
  const press=frame===0||['ANSI_COMBO_Z','ANSI_COMBO_ZZ','ANSI_COMBO_ZZZ'].includes(s.sourceState)&&!sent.has(a.stateSerial)&&a.animationTime>w['1']+.03;
  if(press)sent.add(a.stateSerial);sim.step(1/60,{add:{pressed:press?[key]:[],held:press?[key]:[]}});states.push(a.state);
 }
 assert.ok(states.includes('ANSI_COMBO_ZZZX'));
 const ids=new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AN_Combo_ZZZX').map(e=>e.effectId));
 assert.ok(hits(sim,a.id).some(e=>ids.has(e.origin?.id)));
 assert.equal(sim.state.events.some(e=>e.type==='effectStarted'&&e.name.includes('Ultimate_Fury')),false,'no fabricated installation-skill beam substitutes for a missing command enhancement');
});

test('actual Quicksilver dash carries a contacted opponent using its original black-hole movement packets',()=>{
 const {sim,a,b,profile}=originalAddFixture('LP',{skillId:29011});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=200;sim.step(1/60,{});
 const source=profile.damageEffects.DamageEffect_ALP_Quicksilver_Accel_Blackhole.raw.BLACKHOLE_DATA,trace=[];
 for(let frame=0;frame<45;frame++){
  sim.step(1/60,{add:{pressed:frame===0?['A']:[],held:frame===0?['A']:[]}});
  if(b.blackHoleDisplacement?.some(n=>n!==0))trace.push({actorX:a.x,targetX:b.x,delta:[...b.blackHoleDisplacement]});
 }
 assert.ok(trace.length>10);assert.ok(trace.at(-1).actorX>1000&&trace.at(-1).targetX>1000);
 for(const row of trace)assert.ok(Math.hypot(...row.delta)<=source.DRAGGING_SPEED/60+.001,'movement consumes the original source dragging speed');
 assert.deepEqual(a.unsupported,[]);
});

test('Moonlight observed mutation variant never spends a foreign resource or overwrites a received same-group clock',()=>{
 const {sim,a}=originalAddFixture('DE',{skillId:29024,networkOwnerId:'target'});sim.networkCombatPlaybackVersion=1;
 a.sourceAdd.formation=true;a.sourceAdd.mutation=1;const resources={mp:a.mp,dp:a.sourceAdd.dp,mutation:a.sourceAdd.mutation};let called=0;
 assert.equal(startAddMoonlight(sim,a,{consumeMutation:()=>{called++;return 1;}}),true);
 assert.equal(a.sourceAddCombat.moonlight.period,Math.fround(.66));assert.equal(called,0);
 assert.deepEqual({mp:a.mp,dp:a.sourceAdd.dp,mutation:a.sourceAdd.mutation},resources);
 a.sourceAddCombat.moonlight.accumulator=.25;const events=sim.state.events.length;a.sourceAdd.mutation=0;
 assert.equal(startAddMoonlight(sim,a,{consumeMutation:()=>{throw new Error('foreign debit');}}),true);
 assert.equal(a.sourceAddCombat.moonlight.accumulator,.25);assert.equal(a.sourceAddCombat.moonlight.period,Math.fround(.66));assert.equal(sim.state.events.length,events);
});
