/** Real input dispatch and source WASM / authored Garpai / original poses.
 * Explicit native scalar inputs are independent of the emitted effect data.
 * Current Web execution, not an original-client measured PvP trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {stopAddFormation} from '../../packages/combat-core/add-systems.mjs';
const projectile='DamageEffect_AAT_Dynamo_Factory_Projectile',explosion='DamageEffect_Drone_Activator_Loop_Explosion';
const expected=Math.fround(1.15); // no-trait Activator level1 getter1 × original SA15[3]
const step=(f,input={})=>f.sim.step(1/60,input,{snapshot:false});
const press=(f,key)=>step(f,{add:{pressed:[key],held:[key]}});
const diagnostic=f=>JSON.stringify({state:f.a.state,animation:f.a.animationTime,mp:f.a.mp,dp:f.a.sourceAdd.dp,
 available:f.sim.skillAvailability(f.a.id,0),effects:f.sim.state.effects.filter(e=>e.ownerId===f.a.id).map(e=>({id:e.id,name:e.name,power:e.powerMultiplier,active:e.active})),
 events:f.sim.state.events.slice(-8),notes:f.sim.state.unsupported.slice(-8)});
function until(f,predicate,frames,label){for(let i=0;i<frames&&!predicate();i++)step(f);assert.ok(predicate(),label+': '+diagnostic(f));}
for(const formed of [false,true])test(`actual Activator input stores29409 once and original DIE child retains it after formation exit=${formed}`,()=>{
 const f=originalAddFixture('MM',{skillId:29013,passives:[29409]});f.a.sourceAdd.dp=8000;f.a.mp=f.a.mpMax;f.b.x=1800;
 // The production maximum-tier tree equips enhanced29035 for requested29013.
 // Both original declarations share this exact native state/factory callback.
 const skillId=29035;assert.equal(f.a.loadout[0].skillId,skillId);
 assert.equal(f.a.loadout[0].level,1);assert.equal(f.a.loadout[0].branchId,'none');
 const equipped=f.profile.skillCatalog.find(s=>s.skillId===skillId);
 assert.equal(equipped.state,'ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR');assert.equal(equipped.powerMultiplier,1);
 assert.equal(f.profile.skillBranches.powerRateTables['1'].values['1'],1);
 until(f,()=>f.sim.skillAvailability(f.a.id,0).available,180,'natural idle permits original input');
 if(formed){press(f,'AWAKEN');until(f,()=>f.a.sourceAdd.formation&&!f.a.sourceAdd.formationPending&&f.sim.skillAvailability(f.a.id,0).available,240,'original .46 awakening event completes');}
 assert.equal(f.sim.skillAvailability(f.a.id,0).mode,'generator-select');press(f,'A');
 assert.equal(f.a.sourceAdd.generator.skillId,skillId);
 until(f,()=>f.sim.skillAvailability(f.a.id,0).available,300,'source generator selection finishes');
 assert.equal(f.sim.skillAvailability(f.a.id,0).mode,'generator-fire');press(f,'A');
 until(f,()=>f.sim.state.effects.some(e=>e.ownerId===f.a.id&&e.name===projectile&&e.active),180,'real .5 factory callback activates original projectile');
 const parent=f.sim.state.effects.find(e=>e.ownerId===f.a.id&&e.name===projectile);assert.ok(parent.sourceShadowMesh);
 assert.equal(parent.powerMultiplier,expected);assert.equal(parent.skillId,skillId);
 // Formation exit and a later unrelated getter are explicit runtime inputs.
 // The parent retains original birth power; no fixture DD is rewritten.
 if(formed)assert.equal(stopAddFormation(f.a,{profile:f.profile,emit:(...args)=>f.sim.emit(...args)}),true);
 f.a.skillScale=7;
 until(f,()=>f.sim.state.effects.some(e=>e.parentEffectId===parent.id&&e.name===explosion),480,'natural projectile death produces authored DIE child');
 const child=f.sim.state.effects.find(e=>e.parentEffectId===parent.id&&e.name===explosion);
 assert.equal(child.powerMultiplier,expected);assert.equal(child.skillId,skillId);assert.equal(child.ownerId,f.a.id);
 assert.ok(f.sim.state.events.some(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===parent.id&&e.effectId===child.id&&e.field==='DIE_DAMAGE_EFFECT0'));
});
