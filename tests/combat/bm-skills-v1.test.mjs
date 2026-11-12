/** Literal costs/cooldowns come from target2016 SkillTemplet.lua. Runtime
 * traces below validate this implementation; they are not client baselines. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const rows=[[24025,100,6],[24217,20,7],[24026,200,13],[24027,150,10],[24218,30,5],
 [24220,35,4],[24030,200,14],[24028,300,20],[24033,100,7],[24208,20,2],[24209,30,4],
 [24013,300,21],[24014,250,18],[24210,40,6],[24015,175,20],[24016,200,15],[24211,40,7],[24017,100,10],[24604,300,180]];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
for(const [id,mp,cd]of rows)for(const awakened of [false,true])test(`BM ${id} ${awakened?'awakened':'ordinary'} real cast, source cost, hit and recovery`,()=>{
  const {sim,a}=bmFixture({skillId:id,gap:165});
  if(awakened){a.awakening.pendingOrbs=3;a.awakening.pendingAvailableOrbs=3;sim.activateAwakening(a);assert.ok(a.awakening.remaining>0);}
  sim.drainEvents();sim.step(1/60,{bm:{pressed:['A'],held:['A']}});
  const events=sim.drainEvents();
  near(events.find(e=>e.type==='skillStarted').mpCost,mp);near(a.cooldowns[id],cd);
  for(let i=0;i<500;i++){sim.step(1/60,{});events.push(...sim.drainEvents());}
  assert.equal(events.filter(e=>e.type==='skillStarted'&&e.skillId===id).length,1);
  assert.equal(a.skillId,null);assert.equal(a.hidden,false);assert.equal(Boolean(a.skillDisableGravity),false);
  assert.equal(a.state,'RSI_WAIT');assert.ok(events.filter(e=>e.type==='hit').every(e=>Number.isFinite(e.amount)&&e.amount>=0));
  if(id!==24217)assert.ok(events.some(e=>e.type==='hit'&&e.actorId==='bm'&&e.amount>0),'original helpers must produce a real hit');
  assert.deepEqual(sim.state.unsupported.filter(n=>!['fidelity-unverified'].includes(n.id)),[]);
  validateOwnedState(encodeOwnedState(sim,'bm'));
});

test('BM all36 declared branches execute real casts through the shared trait adapter',()=>{
  let count=0;
  for(const skill of bmProfile.skillCatalog.filter(s=>s.topTier&&!s.passive))for(const branch of skill.branches){
    const policy=createSkillTraitPolicy(skill,branch.id),{sim,a}=bmFixture({skillId:skill.skillId,branchId:branch.id,gap:165});
    sim.rng=()=>.99;sim.step(1/60,{bm:{pressed:['A']}});
    const source=rows.find(r=>r[0]===skill.skillId);
    near(sim.state.events.findLast(e=>e.type==='skillStarted').mpCost,source[1]*policy.mpMultiplier);near(a.cooldowns[skill.skillId],source[2]*policy.cooldownMultiplier);
    for(let i=0;i<500;i++){sim.step(1/60,{});sim.drainEvents();}
    assert.equal(a.skillId,null,`${skill.skillId}/${branch.id}`);
    assert.ok(!policy.unsupported.some(s=>s.includes('Unimplemented target trait')));
    validateOwnedState(encodeOwnedState(sim,'bm'));count++;
  }
  assert.equal(count,36);
});

test('WolfFang target miss returns40 MP with both ordinary and Light costs',()=>{
  for(const branchId of ['none','memo-64']){
    const {sim,a}=bmFixture({skillId:24017,branchId,gap:4000});sim.rng=()=>.99;
    sim.step(1/60,{bm:{pressed:['A']}});const events=sim.drainEvents();
    for(let i=0;i<500;i++){sim.step(1/60,{});events.push(...sim.drainEvents());}
    assert.deepEqual(events.filter(e=>e.type==='bmWolfFangRefund').map(e=>e.amount),[40]);
    assert.equal(a.skillId,null);
  }
});

test('BM multi-stage cast snapshots continue identically, including HA hidden lift and Sonic loops',()=>{
  for(const id of [24210,24017,24604]){
    const {sim,a}=bmFixture({skillId:id,gap:165});sim.step(1/60,{bm:{pressed:['A']}});
    for(let i=0;i<45;i++)sim.step(1/60,{});
    const other=bmFixture({skillId:id,gap:165}).sim;other.restore(JSON.parse(JSON.stringify(sim.snapshot())));
    for(let i=0;i<240;i++){sim.step(1/60,{});other.step(1/60,{});}
    assert.deepEqual(other.snapshot(),sim.snapshot(),String(id));assert.equal(a.skillId,null);
  }
});
