import test from 'node:test';
import assert from 'node:assert/strict';
import {commonRecoveryFixture} from '../helpers/common-charge-standup-v8-fixture.mjs';
import {bmSampledFixture,bmFixture,bmProfile} from '../helpers/bm-feedback-fixture-v4.mjs';
import {fixture,cast,steps} from '../helpers/rs-fixture.mjs';
import {make as makeIS} from '../fixtures/is-native-simulation.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
// User policies checked against real 2016 helpers. No original-client gold.
for(const c of ['RF','LK','VC','RS','BM','IS'])for(const facing of [-1,1]){
 test(`${c} 2Z catches a descending airborne target near the authored floor ${facing}`,async()=>{
   const f=await commonRecoveryFixture(c,{facing,gap:70}),{sim,a,b}=f;
   for(const actor of [a,b]){actor.y+=150;actor.grounded=false;actor.lineId=null;actor.vy=-100;}
   sim.enter(b,'RSI_DAMAGE_AIR_FALL');sim.enter(a,'RSI_JUMP_COMBO_Z');
   let caught=false;for(let i=0;i<30;i++){sim.step(1/120,{}, {snapshot:false});if(sim.drainEvents().some(e=>e.type==='hit'&&e.actorId===a.id)){
     assert.equal(b.state,'RSI_DAMAGE_AIR_SMALL');assert.ok(b.vy>0);assert.equal(b.grounded,false);caught=true;break;}}
   assert.ok(caught,'native attack/body helper overlap');
 });
 for(const first of ['LEFT','RIGHT'])test(`${c} ${first} pressed first wins overlap and release restores the other key`,async()=>{
   const f=await commonRecoveryFixture(c,{gap:4000,sampledLevels:true}),second=first==='LEFT'?'RIGHT':'LEFT';
   f.down(first);f.step();f.down(second);f.step();assert.equal(f.a.facing,first==='RIGHT'?1:-1);
   assert.equal(Math.sign(f.a.vx),f.a.facing);f.up(first);f.step();assert.equal(f.a.facing,second==='RIGHT'?1:-1);
 });
 for(const first of ['LEFT','RIGHT'])test(`${c} completed one-packet direction taps retain down-edge order ${first}`,async()=>{
   const f=await commonRecoveryFixture(c,{gap:4000}),second=first==='LEFT'?'RIGHT':'LEFT';f.tap(first);f.tap(second);f.step();f.step();
   assert.equal(f.a.facing,first==='RIGHT'?1:-1);
 });
}
const third='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',landing=third+'_Landing',fourth=third+'Z';
for(const facing of [-1,1]){
 for(const delay of [.3,.89,.95])test(`BM late fourth Z at landing ${delay} ${facing} keeps the instant slash`,()=>{
   const f=bmSampledFixture({facing,passives:[]});f.dashJumpThird();f.wait(landing);f.at(delay);f.press('Z');f.wait(fourth);f.at(.29);
   assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.setName==='EFFECTSET_Dash_Jump_ZZZ_Landing'));
   assert.ok(f.frames.some(r=>r.state===fourth&&r.animationTime>=.162));
 });
 test(`BM fourth Z cancels after authored dash braking ${facing}`,()=>{
   const f=bmSampledFixture({facing});f.sim.enter(f.a,fourth);f.at(.32);const key=facing>0?'RIGHT':'LEFT';f.down(key);f.step();
   assert.equal(f.a.state,fourth);assert.equal(f.a.sourcePendingState.state,'RSI_WAIT');
   f.step();assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.sourcePendingState.state,'RSI_WALK');
   f.step();assert.equal(f.a.state,'RSI_WALK');
 });
 test(`BM fourth-Z edge sampled immediately before the last pose survives crossing the period ${facing}`,()=>{
   const f=bmSampledFixture({facing,passives:[]});f.dashJumpThird();f.wait(landing);f.at(.9);
   f.a.animationTime=.999;f.a.animationStopped=false;f.press('Z');assert.equal(f.a.state,fourth);f.at(.29);
   assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='Damage_Effect_Raven_RST_Dash_Jump_ZZZ_Landing'));
 });
 test(`BM up finisher retains its complete pose when the branch's Up remains held ${facing}`,()=>{
   const f=bmSampledFixture({facing});f.zzz();f.down('UP');f.press('Z');f.wait('RSI_RBM_COMBO_ZZZupZ');f.at(1.06);
   assert.equal(f.a.state,'RSI_RBM_COMBO_ZZZupZ');f.up('UP');f.wait('RSI_WAIT');
 });
 test(`IS second and third air Z reject movement/dash/skill/8Z cancellation ${facing}`,()=>{
   for(const state of ['RSI_DASH_JUMP_COMBO_ZZ','ESSI_ETK_DASH_JUMP_ZZZ']){
     const sim=makeIS({target:false,skillId:21033}),a=sim.actor('is');a.y+=3000;a.grounded=false;a.lineId=null;sim.enter(a,state);
     for(let i=0;i<12;i++)sim.step(1/120,{is:{held:['UP',facing>0?'RIGHT':'LEFT'],pressed:['X','A','DASH'],pureDouble:[facing>0?'RIGHT':'LEFT'],sampledDevice:true}});
     assert.equal(a.state,state);assert.equal(a.skillId,null);
   }
 });
 for(const distance of [-80,0,80,165])test(`RS Storm Blade continuously launches and pulls a close target ${facing}/${distance}`,()=>{
   const f=fixture({skillId:21014,facing,distance}),contacts=[],apply=f.sim.applyParticipantHit.bind(f.sim);
   f.sim.applyParticipantHit=(a,b,d,o)=>{const r=apply(a,b,d,o);if(r.accepted&&a.id==='rs'){contacts.push({time:f.sim.state.time,state:b.state,vy:b.vy,type:d.REACT_TYPE});}return r;};
   cast(f);steps(f.sim,180);assert.ok(contacts.length>=12);assert.ok(contacts.every(r=>r.state.startsWith('RSI_DAMAGE_AIR_FLY_')&&r.vy>0&&r.type===16));
   const downs=f.sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId==='target'&&e.state.startsWith('RSI_DAMAGE_DOWN'));
   assert.equal(downs.length,0,'no near-floor knockdown during the active vortex');
   assert.ok(Math.abs(f.b.x-f.a.x)<100,'continuous pull returns the body toward the source center');
 });
 for(const skillId of [24030,24016])test(`BM shockwave ${skillId} travels in its authored direction and retains knockdown flight ${facing}`,()=>{
   const f=bmFixture({skillId,gap:165,facing,passives:[]}),records=[],apply=f.sim.applyParticipantHit.bind(f.sim);f.sim.rng=()=>.99;
   f.sim.applyParticipantHit=(a,b,d,o)=>{const r=apply(a,b,d,o);if(r.accepted&&a.id==='bm')records.push({state:b.state,vy:b.vy,d});return r;};
   f.sim.step(1/60,{bm:{pressed:['A']}});let travel=false;
   for(let i=0;i<160;i++){f.sim.step(1/60,{});const e=f.sim.state.effects.find(e=>e.mainEffectName==='RST_ShockWave_ProDummy'&&e.active);
     if(e?.sourceShadowMesh&&e.elapsed>.05){travel=true;assert.ok((e.x-e.birthAnchor.position[0])*facing>0);
       if(skillId===24030)assert.ok(e.y<e.birthAnchor.position[1]);else assert.ok(Math.abs(e.y-e.birthAnchor.position[1])<.01);
       const packet=encodeOwnedState(f.sim,'bm',{epoch:1,frameSeq:i+1});validateOwnedState(packet);const peer=bmFixture({skillId,facing});
       validateOwnedReferences(packet,peer.a,bmProfile,peer.map,{actors:peer.sim.state.actors,profiles:peer.sim.profiles});applyOwnedState(peer.sim,'bm',packet);
     }}
   assert.ok(travel);assert.ok(records.length);assert.ok(records.every(r=>r.state.startsWith('RSI_DAMAGE_AIR_FLY_')&&r.vy===r.d.BACK_SPEED_Y));
   assert.ok(f.sim.state.events.some(e=>e.actorId==='target'&&e.state?.startsWith('RSI_DAMAGE_DOWN_')),'unassisted flight ends in knockdown');
 });
}
