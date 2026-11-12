import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
const step=(f,input={})=>f.sim.step(1/60,{elesis:input},{snapshot:false});
for(const facing of [-1,1])test(`20 BH ${facing}: repeated freshX produces5 actual downward fireballs from original hand at2MP each`,()=>{
 const f=elesisFixture('BH',{skillId:28018,gap:5000,facing});f.a.skillId=null;f.a.y+=350;f.a.grounded=false;f.a.lineId=null;
 f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SPK_ZX_READY','source-combo');
 for(let i=0;i<150;i++)step(f,{pressed:i%7===0?['X']:[],held:['X']});
 const shots=f.sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_Elesis_SBH_DashJump_Combo_ZX');
 assert.equal(shots.length,5);assert.equal(f.a.sourceElesisCommand.loops,5);assert.ok(shots.every(e=>e.birthAnchor.rotation[2]===-45));
 for(let i=0;i<120;i++)step(f);
 assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.unsupported.length,0);
});
test('14 CA actual persistent sword shield survives recovery, changes stage, applies weakening and stops at11s',()=>{
 const f=elesisFixture('CA',{skillId:28213,gap:100});step(f,{pressed:['A'],held:['A']});
 let persistent;
 for(let i=0;i<240;i++){f.b.x=f.a.x+100;f.b.y=f.a.y;f.b.z=f.a.z;step(f);persistent=f.sim.state.effects.find(e=>e.name==='DamageEffect_SI_A_SDK_INJECTION_STIGMA_Buff')??persistent;}
 assert.equal(f.a.state,'RSI_WAIT');assert.ok(f.a.buffs.some(b=>b.templateId===433));assert.ok(persistent?.active);assert.equal(persistent.stage,1);assert.ok(persistent.hitCount>=3);
 assert.ok(f.b.buffs.some(b=>b.templateId===511&&b.accumulationCount>=2));
 assert.ok(f.b.stats.physicalAttack<f.b.buffBaseStats.physicalAttack);assert.equal(f.b.unsupported.length,0);
 for(let i=0;i<520;i++)step(f);
 assert.ok(!f.a.buffs.some(b=>b.templateId===433));assert.ok(!f.sim.state.effects.some(e=>e.name==='DamageEffect_SI_A_SDK_INJECTION_STIGMA_Buff'));
});
for(const charge of [0,1,3])test(`15 CA dashXZ ${charge}s source charge scales MP5, damage and projectile size`,()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_XZ_CHARGE','source-charge');
 for(let i=0;i<charge*60;i++)step(f,{held:['Z']});
 const actual=f.a.sourceElesisSkills.charge;assert.ok(Math.abs(actual-charge)<.00001);
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_XZ_FIRE','source-release');const before=f.a.mp;step(f);
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_SCA_Dash_Combo_XZ');assert.ok(e);
 assert.ok(Math.abs(before-f.a.mp-5)<.01,'FlushMP takes literal5; later charge vector is a different call');
 assert.ok(Math.abs(e.definition.SCALE_X-(1+charge*.13300000131130219))<.00001);
 assert.ok(Math.abs(e.powerMultiplier-(1+charge*.5))<.00001);
});

// The instance definition is reconstructed from a bounded source charge,
// because static definition objects are intentionally not trusted on wire.
test('15 charged CA wave retains original size through actual owned/critical serialization',async()=>{
 const {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState}=await import('../../packages/online/owned-state.mjs');
 const f=elesisFixture('CA',{skillId:28221,gap:5000}),v=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_XZ_CHARGE','source-charge');for(let i=0;i<60;i++)step(f,{held:['Z']});
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_XZ_FIRE','source-release');step(f);
 const p=validateOwnedState(encodeOwnedState(f.sim,'elesis',{epoch:1,frameSeq:61})),wire=p.effects.find(e=>e.name==='DamageEffect_SCA_Dash_Combo_XZ');assert.ok(wire.sourceElesisCommandCharge>.99);
 validateOwnedReferences(p,v.a,v.profile,v.map,{actors:v.sim.state.actors,profiles:v.sim.profiles});applyOwnedState(v.sim,'elesis',p);
 const e=v.sim.state.effects.find(e=>e.networkId===wire.id);assert.ok(Math.abs(e.definition.SCALE_X-1.133)<.00001);
 const bad=structuredClone(p);bad.actions=[encodeCriticalAction(p,{id:1,effectIds:new Set([wire.id])})];bad.actions[0].effects[0].sourceElesisCommandCharge=4;
 assert.throws(()=>validateOwnedState(bad));
});
