import test from 'node:test';
import assert from 'node:assert/strict';
import {addKnownDamageData} from '../../packages/combat-core/add-damage-values.mjs';
import {resolveDamageValues} from '../../packages/combat-core/damage-values.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
test('missing original Add DPR symbol omits only its resource consumer and never rewrites raw damage or guesses a rate',()=>{
 const p=PROFESSION_PROFILES.LP,raw=p.damageEffects.DamageEffect_SI_HA_ALP_DOOMS_DAY_Damage_1st.raw.DAMAGE_DATA,before=JSON.stringify(raw);
 assert.equal(resolveDamageValues(raw,p.physics).supported,false);
 const partial=addKnownDamageData(p,raw);assert.equal(partial.gap,'DYNAMO_PARTICLE_RATE_TYPE.DPRT_SPEICAL_ACITVE');
 assert.equal(Object.hasOwn(partial.data,'DYNAMO_PARTICLE_RATE_TYPE'),false);assert.equal(resolveDamageValues(partial.data,p.physics).supported,true);
 assert.equal(partial.data.DAMAGE.MAGIC,2.92);assert.equal(partial.data.REACT_TYPE,2);assert.equal(JSON.stringify(raw),before);
 const corrupt={...raw,BACK_SPEED_X:{$symbol:'UNKNOWN_ATTACK_SPEED'}};
 assert.equal(resolveDamageValues(addKnownDamageData(p,corrupt).data,p.physics).supported,false);
 assert.equal(addKnownDamageData(PROFESSION_PROFILES.RF,raw).data,raw,'other professions retain strict unknown handling');
});
test('actual original LP Dooms Day follows its stun with authored damage phases',()=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29603});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=150;
 for(let i=0;i<420;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 const hits=sim.state.events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.targetId===b.id);
 assert.ok(hits.some(e=>e.amount===0));assert.ok(hits.some(e=>e.amount>0));assert.ok(b.hp<b.hpMax);
 assert.ok(a.unsupported.some(e=>e.id.startsWith('add-source-gap:')&&e.id.includes('DPRT_SPEICAL_ACITVE')));
 assert.equal(a.unsupported.some(e=>e.id.startsWith('damage-values:')),false);
});
