import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cast,steps,profile} from '../helpers/rs-fixture.mjs';
import {observeRemoteDamage} from '../../packages/combat-core/observed-damage.mjs';
const blade='DamageEffect_SA_ERS_LunaBlade',explosion='DamageEffect_SA_ERS_LunaBlade_ExposionFinal';
const burns=f=>f.sim.state.events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98);
test('frozen2016 Luna declares two1784% damage stages, explosion factor117 and12x original50-unit box',()=>{
  for(const name of [blade,explosion])assert.equal(profile.damageEffects[name].raw.DAMAGE_DATA.DAMAGE.MAGIC,17.84);
  assert.deepEqual(profile.damageEffects[explosion].raw.DAMAGE_DATA.BUFF_FACTOR_ID,{'1':117});
  assert.equal(profile.buffFactors['117'].raw.BEHAVIOR.BBT_CHANGE_NOW_MP_PER_SECOND.PERCENT['1'],-.3);
  const box=profile.effectTemplates.SA_ERS_LunaBlade_ExposionFinal_AttackBox_02;
  assert.equal(box.fields.MeshName,'DummyAttackBox_50x50x50.X');assert.deepEqual(box.initialSize,[12,12,12]);
});
test('real Luna blade settles first; V62 shared cast quota leaves explosion reaction with one MP burn total',()=>{
  const f=fixture({skillId:21017,facing:-1});cast(f);steps(f.sim,200);
  const names=new Map(f.sim.state.events.filter(e=>e.type==='effectStarted').map(e=>[e.effectId,e.name]));
  const hits=f.sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='rs');
  assert.deepEqual(hits.map(e=>names.get(e.origin.id)),[blade,explosion]);
  assert.equal(burns(f).length,1);for(const e of burns(f))assert.ok(Math.abs(e.delta+f.b.mpMax*.3)<.001);
  for(const e of burns(f)){assert.equal(e.drawText,true);assert.equal(e.resourceNumber.resource,'mp');assert.equal(e.resourceNumber.style,'red');assert.equal(e.resourceNumber.percent,-30);assert.ok(e.resourceNumber.position.every(Number.isFinite));}
  assert.equal(hits[1].hp,hits[0].hp,'V62 per-cast quota consumes HP on the first blade contact');
  assert.equal(hits[1].amount,0);assert.ok(hits[0].amount>0);
  assert.equal(hits[0].data.REACT_TYPE,2);assert.equal(hits[1].data.REACT_TYPE,2);
  assert.equal(f.sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===f.b.id&&e.reason==='hit-reaction').length,2,
    'both actual blade and zero-HP explosion enter their ordinary hit reactions');
});
test('real standalone explosion tickEffects at1HP deals lethal damage; original living-target factor gate does not burn the dead',()=>{
  const f=fixture({skillId:21017,distance:300});f.a.skillId=21017;f.a.skillScale=1;f.b.hp=1;f.b.mp=f.b.mpMax;
  const effect=f.sim.createEffect(f.a,{NAME:explosion},{birthAnchor:{position:[f.a.x,f.a.y,0],facing:1,rotation:[0,0,0]}});
  const contact=()=>f.sim.state.events.find(e=>e.type==='hit'&&e.origin.id===effect.id&&e.targetId===f.b.id);
  for(let i=0;i<60&&!contact();i++)steps(f.sim,1);
  const hit=contact();assert.ok(hit,'original helper reaches the actual .185 attack window');
  assert.ok(hit.amount>0);assert.equal(hit.hp,0);assert.equal(f.b.hp,0);assert.equal(f.b.death,true);
  assert.equal(hit.data.NO_DAMAGE,undefined);assert.equal(hit.data.REACT_TYPE,2);
  steps(f.sim,60);assert.equal(f.b.hp,0);assert.equal(burns(f).length,0);
  assert.equal(f.sim.state.events.filter(e=>e.type==='hit'&&e.origin.id===effect.id&&e.targetId===f.b.id).length,1);
});
test('attacker observer displays the one declared red MP loss without changing remote MP',()=>{
  const f=fixture({skillId:21017,facing:-1,networkOwnerId:'rs'});cast(f);const mp=f.b.mp;steps(f.sim,200);
  const rows=f.sim.state.events.filter(e=>e.type==='observedBuffMpChanged');assert.equal(rows.length,1);
  for(const e of rows){assert.equal(e.presentationOnly,true);assert.ok(Math.abs(e.delta+f.b.mpMax*.3)<.001);}
  assert.equal(f.b.mp,mp);
});
test('third-party observed contact emits red MP text in an isolated copy without changing any gameplay state',()=>{
  const f=fixture({skillId:21017});f.a.skillId=21017;
  const effect=f.sim.createEffect(f.a,{NAME:explosion}),before=f.sim.snapshot();
  const result=observeRemoteDamage(f.sim,f.a,f.b,profile.damageEffects[explosion].raw.DAMAGE_DATA,{kind:'effect',id:effect.id,skillId:21017});
  assert.equal(result.accepted,true);assert.equal(f.sim.state.events.filter(e=>e.type==='observedBuffMpChanged').length,1);
  const after=f.sim.snapshot();for(const s of [before,after]){delete s.events;delete s.nextEventId;delete s.localRuneLunaHitReceipts;}assert.deepEqual(after,before);
});
for(const distance of [300,900])test(`isolated original explosion box at${distance}: V62 first-stage HP/MP only inside helpers`,()=>{
  const f=fixture({skillId:21017,distance});f.a.skillId=21017;f.a.skillScale=1;f.b.mp=f.b.mpMax;
  f.sim.createEffect(f.a,{NAME:explosion},{birthAnchor:{position:[f.a.x,f.a.y,0],facing:1,rotation:[0,0,0]}});
  const hp=f.b.hp;steps(f.sim,55);
  assert.equal(burns(f).length,distance===300?1:0);
  if(distance===300)assert.ok(f.b.hp<hp);else assert.equal(f.b.hp,hp);
  if(distance===300)assert.ok(Math.abs(burns(f)[0].delta+f.b.mpMax*.3)<.001);
});
