/** The original2016 declaration distinguishes zero hit-stop, small reaction,
 * projectile Shock launch, and final Hyper launch. Preserve all four facts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defenderHitStopOverride,selectHitReaction} from '../../packages/combat-core/reaction-policy.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
const raw=name=>profile.damageEffects[name].raw.DAMAGE_DATA;
test('formed Conqueror 38% pre hits have zero hit-stop but the original small-damage reaction',()=>{
 const d=raw('DamageEffect_SA_APT_Conqueror_Hyper_Pre');
 assert.equal(d.DAMAGE.MAGIC,.38);assert.equal(d.STOP_TIME_DEF,0);assert.equal(d.REACT_TYPE,1);assert.equal(d.BACK_SPEED_X,-700);
 assert.deepEqual(defenderHitStopOverride(d),{stopTime:0,stop2Time:0});
 const react=selectHitReaction(d,{grounded:true,heightAboveLand:0,attackerUnitHeightAboveLand:0});
 assert.equal(react.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(react.grounded,true);
 assert.equal(react.vy,0);assert.equal(react.localVx,700);
});
test('formed mutation shots retain the same authored Shock as normal projectiles; final blast retains launch',()=>{
 const p=profile.damageEffects.DamageEffect_SA_APT_Conqueror_Projectile.raw;
 const shock='DamageEffect_SA_APT_Conqueror_Projectile_Shock';
 assert.equal(p.HIT_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,shock);assert.equal(p.DIE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,shock);
 for(const [name,coefficient,stop]of [[shock,4.25,.05],['DamageEffect_SA_APT_Conqueror_Hyper',61.05,.2]]){
  const d=raw(name);assert.equal(d.DAMAGE.MAGIC,coefficient);assert.equal(d.STOP_TIME_DEF,stop);assert.equal(d.REACT_TYPE,5);
  assert.equal(selectHitReaction(d,{grounded:true,heightAboveLand:0}).grounded,false);
 }
});
