/** An owner must not turn a forged recipient notice into another attack when
 * its independently remembered original source explicitly forbids Moonlight. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {rememberAddMoonlightOrigins,receiveAddMoonlightNotice,validateAddMoonlightNotice} from '../../packages/combat-core/add-moonlight-receipts-v45.mjs';
for(const [label,name,check]of [
 ['NO_DAMAGE Moonlight field','DamageEffect_MOONLIGHT_RHAPSODY_Debuff',d=>d.NO_DAMAGE===1||d.NO_DAMAGE===true],
 ['native trigger7 Moonlight explosion','DAMAGE_EFFECT_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_1',d=>d.ATTACK_TRIGGER_TYPE===7],
])test('known original '+label+' cannot be laundered through a typed defender notice',()=>{
 const {sim,a,b}=originalAddFixture('DE',{skillId:29024});
 sim.networkOwnerId=a.id;sim.networkEpochFor=()=>1;
 const definition=sim.profileFor(a).damageEffects[name];assert.ok(definition);assert.ok(check(definition.raw.DAMAGE_DATA));
 const e=sim.createEffect(a,{NAME:name});assert.ok(e);rememberAddMoonlightOrigins(sim,a);
 const proof=sim.state.localOwnerAddMoonlightOrigins.find(r=>r.effectId===e.id);assert.ok(proof,'the real locally created source identity is known');
 const notice={serial:1,receipts:[{serial:1,attackerId:a.id,attackerEpoch:1,kind:'effect',effectId:e.id,
  stateSerial:e.ownerStateSerial,state:null,stack:3,position:[b.x,b.y,b.z]}]};
 assert.equal(validateAddMoonlightNotice(notice,{owner:b,actors:sim.state.actors}),true,'this is a well-formed receipt, not a malformed-envelope rejection');
 const before=sim.state.effects.length;
 assert.equal(receiveAddMoonlightNotice(sim,b,1,notice,{powerFor:()=>({power:1,hyperMode:false})}),false);
 assert.equal(sim.state.effects.length,before,'original ineligible source cannot produce offensive effects');
});
