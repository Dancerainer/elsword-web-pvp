import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={lines:[{lineId:1,start:[0,0,0],end:[1000,0,0],type:'LT_NORMAL',nativeFields:{ENABLE:true}}]};
test('original DEPT_BONE routes to the parent mesh bone instead of actor origin and preserves inherited power',()=>{
  let called=0;const s=createSimulation({profile,map,actors:[{id:'rf',position:[100,0,0]}],
    effectBoneSampler:(parent,actor,bone)=>{called++;assert.equal(bone,'Dummy01');assert.equal(parent.name,'DamageEffect_SA_RRF_XCrash1');return[10,20,30];}});
  const actor=s.actor('rf'),parent=s.createEffect(actor,{NAME:'DamageEffect_SA_RRF_XCrash1'},
    {birthAnchor:{position:[100,0,0],facing:1}});parent.powerMultiplier=1.2;parent.skillId=24010;
  s.createDamageChildren(parent,actor,'CREATE_DAMAGE_EFFECT0',parent.damage.CREATE_DAMAGE_EFFECT0,0,.01);
  assert.equal(called,1);const child=s.state.effects.find(e=>e.parentEffectId===parent.id);
  assert.equal(child.name,'DamageEffect_SA_RRF_XCrash1_Damage');assert.deepEqual(child.birthAnchor.position,[10,20,30]);
  assert.equal(child.powerMultiplier,1.2);assert.equal(child.skillId,24010);
  s.createDamageChildren(parent,actor,'CREATE_DAMAGE_EFFECT0',parent.damage.CREATE_DAMAGE_EFFECT0,.01,.02);
  assert.equal(called,1);assert.equal(s.state.effects.filter(e=>e.parentEffectId===parent.id).length,1);
});
test('missing original mesh bone keeps the child unsupported, with no actor-position substitute',()=>{
  const s=createSimulation({profile,map,actors:[{id:'rf',position:[100,0,0]}]}),a=s.actor('rf');
  const parent=s.createEffect(a,{NAME:'DamageEffect_SA_RRF_XCrash1'},{birthAnchor:{position:[100,0,0],facing:1}});
  s.createDamageChildren(parent,a,'CREATE_DAMAGE_EFFECT0',parent.damage.CREATE_DAMAGE_EFFECT0,0,.01);
  assert.equal(s.state.effects.length,1);assert.ok(a.unsupported.some(v=>v.id.startsWith('damage-child-position:')));
});
