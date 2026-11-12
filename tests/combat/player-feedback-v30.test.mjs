/** Original-data expectations and live web regressions; never native-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {elesisCommands} from '../../packages/combat-core/elesis-commands.mjs';
import {elesisDamageData,elesisAttackTimers} from '../../packages/combat-core/elesis-skills.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {isStandupRolling} from '../../packages/combat-core/standup-policy.mjs';
import {groundedBodyPushPoint} from '../../packages/combat-core/map-mechanics.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:resolve(process.env.ELESIS_ASSET_ROOT??'artifacts')});
const garpai=assets.forScene('sander-garpai-rock-pvp'),runtime=await garpai.createRuntime();
function make(id,selected=garpai,native=runtime,lineId=2,position=[-600,3080,0],extraActors=[]){
 const sim=createSimulation({profile:assets.profiles[id],profiles:assets.profiles,preset:assets.presets[id],presets:assets.presets,map:selected.map,
  actors:[{id:'subject',professionId:id,team:0,position,lineId,loadout:Array(8).fill(null),passives:[],guildPassives:[]},...extraActors],
  commonBuffs:assets.commonBuffs,...native.samplers,nativeGeometry:native.native.geometry,nativeCommands:native.native.commands,nativeSkills:native.native.skills,
  nativeSkillValues:native.native.skillValues,nativeNasod:native.native.nasod,nativeCritical:native.native.critical,nativeManaBreak:native.native.manaBreak});
 const a=sim.actor('subject');return {sim,a,profile:sim.profileFor(a)};
}
const step=(f,n=1,input={})=>{for(let i=0;i<n;i++)f.sim.step(1/60,{[f.a.id]:input},{snapshot:false});};
const until=(f,fn,max=180)=>{for(let i=0;i<max&&!fn();i++)step(f);assert.ok(fn(),f.a.state+' @ '+f.a.animationTime);};
for(const id of Object.keys(assets.profiles))for(const key of ['Z','X','LEFT','RIGHT'])test(`${id} rises through ${key} using its sourced state`,()=>{
 const f=make(id);f.sim.enter(f.a,'RSI_DAMAGE_DOWN_FRONT','down');f.a.animationTime=.7;
 step(f,1,{held:[key],pressed:[key]});until(f,()=>!f.a.state.includes('DAMAGE_DOWN'));
 if(['LEFT','RIGHT'].includes(key)){assert.ok(isStandupRolling(f.a));assert.equal(f.a.invincible,true);}
 else assert.match(f.a.state,/STANDUP_ATTACK/);
 const packet=encodeOwnedState(f.sim,f.a.id,{frameSeq:1});validateOwnedState(packet);validateOwnedReferences(packet,f.a,f.profile,garpai.map);
});
for(const id of Object.keys(assets.profiles))test(`${id} rolling fall clears protection in the same packet`,()=>{
 const f=make(id),name=Object.keys(f.profile.states).find(n=>n.endsWith('STANDUP_ROLLING_FRONT_FRONT'));
 f.sim.enter(f.a,name,'roll');assert.equal(f.a.invincible,true);
 f.a.x=12000;f.a.y=3600;f.a.grounded=false;f.a.lineId=null;f.a.forceInvincible=.2;
 step(f);assert.equal(f.a.state,'RSI_JUMP_DOWN');assert.equal(f.a.forceInvincible,0);assert.equal(f.a.invincible,false);
});
test('Hope bridge pushes preserve both actual crests, and do not extend a floor into a gap',async()=>{
 const selected=assets.forScene('velder-bridge-hope-stage-pvp'),rt=await selected.createRuntime();
 for(const lineId of [4,21]){
  const line=selected.map.lines.find(l=>l.lineId===lineId),x=line.end[0]-10,ratio=(x-line.start[0])/(line.end[0]-line.start[0]);
  const position=[x,line.start[1]+ratio*(line.end[1]-line.start[1]),line.start[2]],other={id:'wall',professionId:'RF',team:1,position:[x+20,1820,line.end[2]],lineId:lineId+1,loadout:Array(8).fill(null)};
  const f=make('RF',selected,rt,lineId,position,[other]);
  for(let i=0;i<80;i++){step(f,1,{held:['RIGHT']});assert.equal(f.a.grounded,true,'crest '+lineId+' frame '+i);}
 }
 const gapLine=selected.map.lines.find(l=>l.nextLine===-1&&l.end[0]>l.start[0]);
 assert.equal(groundedBodyPushPoint({lineId:gapLine.lineId,x:gapLine.end[0]+50,y:gapLine.end[1],z:gapLine.end[2]},selected.map),null);
});
test('LK Auto Guard start and recovery allow only the original Roll',()=>{
 const f=make('LK');f.a.mp=f.a.mpMax;
 for(const state of Object.keys(f.profile.states).filter(n=>n.startsWith('ESSI_SI_P_ESK_AUTO_GUARD'))){
  f.sim.enter(f.a,state,'guard');f.a.animationTime=10;
  for(const skillId of [21217,21009]){f.sim.configureLoadout([{skillId},...Array(7).fill(null)],f.a.id);assert.equal(f.sim.skillAvailability(f.a.id,0).available,skillId===21217,state);}
 }
});
for(const facing of [-1,1])test(`BH ${facing} dash XX consumes facing once`,()=>{
 const f=elesisFixture('BH',{gap:10000,facing});f.sim.enter(f.a,'ESI_DASH_COMBO_SBH_XX','dash');
 const result=elesisCommands.runFuture(f.a,{held:new Set(),pressed:new Set()},f.profile,1/60);
 assert.ok(Math.abs(result.passiveSpeed.x-f.profile.physics.RUN_SPEED*f.a.stats.moveSpeedMultiplier)<.001);
 const before=f.a.x;step(f,10);assert.ok((f.a.x-before)*facing>0);
});
for(const id of ['GM','BH'])test(`${id} XXX and XXZ reset hit receipts and select the launching damage`,()=>{
 const f=elesisFixture(id);
 for(const state of ['RSI_COMBO_XXX','ESI_COMBO_XXZ']){f.sim.enter(f.a,state,'stage');const raw=f.profile.states[state].raw;
  const time=raw.DAMAGE_DATA_CHANGE_TIME;assert.ok(Number.isFinite(time));f.a.hits={target:1};f.a.hitGaps={target:99};f.a.animationTime=time+.001;
  elesisAttackTimers(f.sim,f.a,time-.001,time+.001);assert.deepEqual(f.a.hits,{});
  assert.deepEqual(elesisDamageData(f.sim,f.a,raw.DAMAGE_DATA),raw.DAMAGE_DATA_NEXT);assert.ok(raw.DAMAGE_DATA_NEXT.FORCE_FLY||[3,4].includes(raw.DAMAGE_DATA_NEXT.REACT_TYPE));
 }
});
for(const facing of [-1,1])test(`CA Blood Cutter ${facing} flies independently, hits remotely, restores, and rejects forged carrier`,()=>{
 const f=elesisFixture('CA',{skillId:28023,gap:500,facing}),receiver=elesisFixture('CA',{skillId:28023,gap:500,facing});
 // Original .3 game-frame request delay precedes NPC .01 emission/.1 speed;
 // wait for real travel rather than the old immediate-caster-spawn adapter.
 step(f,1,{pressed:['A']});step(f,45);const e=f.sim.state.effects.find(e=>e.sourceElesisBloodCutter);assert.ok(e);
 const birth=e.sourceElesisBloodCutter.origin[0];assert.ok((e.x-birth)*facing>200);assert.ok(f.b.hp<f.b.hpMax);
 const packet=encodeOwnedState(f.sim,f.a.id,{frameSeq:1});validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map);applyOwnedState(receiver.sim,receiver.a.id,packet);
 const restored=receiver.sim.state.effects.find(e=>e.sourceElesisBloodCutter);assert.deepEqual(restored.currentAnchor.position,e.currentAnchor.position);assert.deepEqual(restored.currentAnchor.rotation,e.currentAnchor.rotation);
 const forged=structuredClone(packet);forged.effects.find(e=>e.sourceElesisBloodCutter).sourceElesisBloodCutter.direction=[3,0,0];assert.throws(()=>validateOwnedState(forged),/blood-cutter/);
 step(f,140);assert.ok(!f.sim.state.effects.some(e=>e.sourceElesisBloodCutter&&!e.dead));
});
for(const facing of [-1,1])test(`Sword Fire ${facing} lands from the actual airborne branch and emits sustained damage`,()=>{
 const f=elesisFixture('BH',{skillId:28034,gap:500,facing});f.sim.enter(f.a,'RSI_JUMP_DOWN','air');f.a.y+=350;f.a.grounded=false;f.a.lineId=null;f.a.vy=-100;
 step(f,1,{pressed:['A']});step(f,259);
 assert.ok(f.sim.state.events.some(e=>e.type==='effectEnded'&&e.name==='DAMAGE_EFFECT_EL_SWORDFIRE_PROJECTILE'&&e.reason==='template-land-crash'));
 assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='DAMAGE_EFFECT_ELESIS_SWORDFIRE_LANDING'));
 assert.ok(f.sim.state.events.filter(e=>e.type==='hit').length>3);assert.ok(f.b.hp<f.b.hpMax);
});
test('GM summoned swords consume the original -90-degree rotation and downward direction speed',()=>{
 const f=elesisFixture('GM',{gap:10000});f.sim.enter(f.a,'ESI_DASH_COMBO_SGM_XX_ATTACK','swords');step(f,35);
 const e=f.sim.state.effects.find(e=>e.mainEffectName==='SGM_Dash_Combo_XX_LOOP'&&e.sourceShadowMesh&&e.elapsed>.04);
 assert.ok(e);assert.ok(e.sourceShadowMesh.position[1]<e.birthAnchor.position[1]);assert.ok(Math.abs(e.sourceShadowMesh.position[0]-e.birthAnchor.position[0])<.01);
});
for(const id of ['RF','BM','VC'])test(`${id} Shadow Step keeps target invincibility until its attack branch`,()=>{
 const f=make(id,garpai,runtime,2,[-600,3080,0],[{id:'enemy',professionId:id,team:1,position:[-300,3080,0],lineId:2,loadout:Array(8).fill(null)}]);
 f.a.mp=f.a.mpMax;f.sim.configureLoadout([{skillId:24217},...Array(7).fill(null)],f.a.id);step(f,1,{pressed:['A']});
 assert.match(f.a.state,/SHADOW_STEP/);const hp=f.a.hp;
 for(let i=0;i<13;i++){assert.equal(f.a.invincible,true);f.sim.injectHit({attackerId:'enemy',targetId:f.a.id,damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,STOP_TIME_ATT:0,STOP_TIME_DEF:0}});assert.equal(f.a.hp,hp);step(f);}
 step(f,1,{pressed:['Z']});assert.match(f.a.state,/SHADOW_STEP_Z/);assert.equal(f.a.invincible,false);
});
test('Raven core requires a front hit outside damage/stun states',()=>{
 const f=make('RF',garpai,runtime,2,[-600,3080,0],[{id:'enemy',professionId:'RF',team:1,position:[-400,3080,0],lineId:2,loadout:Array(8).fill(null)}]),b=f.sim.actor('enemy');
 const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1};
 const ready=state=>{f.sim.enter(f.a,state,'guard-case');f.a.awakening.remaining=60;f.a.core.level=3;f.a.core.gauge=60;f.a.core.phase='idle';f.a.core.helperLive=true;f.a.core.parrying=false;f.a.core.canParry=false;f.a.superArmor=false;f.a.invincible=false;};
 ready('RSI_WAIT');assert.equal(f.sim.canGuard(f.a,b,data,[b.x,b.y,b.z],true),true);
 assert.equal(f.sim.canGuard(f.a,b,data,[b.x,b.y,b.z],false),false);
 for(const state of ['RSI_DAMAGE_GROGGY','RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_BIG_BACK','RSI_JUMP_UP']){ready(state);assert.equal(f.sim.canGuard(f.a,b,data,[b.x,b.y,b.z],true),false,state);}
});
test('BM final ZZZ8Z packet holds authored root instead of wrapping behind the actor',()=>{
 const f=make('BM');f.sim.enter(f.a,'RSI_RBM_COMBO_ZZZupZ','root-end');let previous;
 for(let i=0;i<80;i++){const old=f.a.x;step(f);if(f.a.state==='RSI_JUMP_DOWN'){assert.ok(Math.abs(f.a.x-old)<25);assert.ok(f.a.x>previous);break;}if(f.a.animationTime>.9)previous=f.a.x-1;}
 assert.equal(f.a.state,'RSI_JUMP_DOWN');
});
test('CA third dash Z has its attack and the two subsequent Z stages reset both hit windows',()=>{
 const f=elesisFixture('CA',{gap:10000}),keys={held:new Set(),pressed:new Set(),pureDoubleLeft:false,pureDoubleRight:false};
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZZ','third-z');f.a.animationTime=.2;
 keys.pressed.add('Z');let result=elesisCommands.runEvent(f.a,keys,f.profile);f.a.sourceCommandFlags=result.flags;f.a.animationTime=.31;keys.pressed.clear();
 result=elesisCommands.runEvent(f.a,keys,f.profile);assert.equal(result.state,'ESI_DASH_COMBO_SCA_ZZZ_START');
 for(const state of ['ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']){
  f.sim.enter(f.a,state,'multi-hit');f.a.hits={target:1};f.a.hitGaps={target:1};f.a.animationTime=.201;elesisAttackTimers(f.sim,f.a,.19,.201);
  assert.deepEqual(f.a.hits,{});assert.deepEqual(f.a.hitGaps,{});assert.deepEqual(elesisDamageData(f.sim,f.a,f.profile.states[state].raw.DAMAGE_DATA),f.profile.states[state].raw.DAMAGE_DATA_NEXT);
 }
});
