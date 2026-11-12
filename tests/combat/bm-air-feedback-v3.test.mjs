/** User-reported high dive / physical XX; original2016 effect declarations,
 * authored Garpai collision and original mesh helpers. Simulation, not a client
 * recording. Literal expectations below do not come from a generated trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const third='RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ',landing=third+'_Landing',fourth=third+'Z';
const firstX='DamageEffect_RBM_DashJump_X',secondX='DamageEffect_RST_DashJump_XZ';
function prepareAirX(f){
  const key=f.a.facing>0?'RIGHT':'LEFT';f.press(key);f.down(key);f.step();
  assert.equal(f.a.state,'RSI_DASH');f.press('UP');f.up(key);f.step(5);f.press('X');
  assert.equal(f.a.state,'RSI_DASH_JUMP_COMBO_X');
}

for(const facing of [1,-1]){
  test(`BM high third dive survives held 66/8 and repeated Z until actual floor contact, facing ${facing}`,()=>{
    const f=bmSampledFixture({facing});f.dashJumpThird();
    // Same sampled command, raised to the high-altitude failure condition.
    f.a.y+=4000;f.a.grounded=false;f.a.lineId=null;
    f.down(facing>0?'RIGHT':'LEFT');f.down('UP');f.at(.31);
    f.press('Z');f.step(3);
    assert.equal(f.a.state,third);assert.equal(f.a.grounded,false);
    assert.ok(f.a.vy<0);assert.ok(f.a.passiveSpeed.y<0,'the source dive velocity must execute');
    f.up('UP');f.until(()=>f.a.grounded,'high dive must eventually collide with the map');
    assert.equal(f.a.state,third,'contact queues landing without applying it inside the old post');
    assert.equal(f.a.sourcePendingState?.state,landing);assert.equal(f.a.vy,0);
    f.step();
    assert.equal(f.a.state,landing);assert.equal(f.a.vy,0);
    f.step(3);assert.equal(f.a.state,fourth,'the fourth Z pressed during the dive is buffered until landing');
    assert.ok(!f.frames.some(row=>row.serial>8&&row.state==='RSI_JUMP_COMBO_Z'),'no involuntary 8Z');
  });
  test(`BM third dive retains explicit sampled air66 cancellation, facing ${facing}`,()=>{
    const f=bmSampledFixture({facing});f.dashJumpThird();f.a.y+=4000;f.a.grounded=false;f.a.lineId=null;f.at(.31);
    const key=facing>0?'RIGHT':'LEFT';f.press(key);f.down(key);f.step();
    assert.equal(f.a.state,third);assert.equal(f.a.sourcePendingState?.state,'RSI_DASH_JUMP');
    assert.equal(f.a.grounded,false);f.step();
    assert.equal(f.a.state,'RSI_DASH_JUMP');assert.equal(f.a.grounded,false);
  });
  for(const key of ['X','Z'])test(`BM physical 668X${key} selects the original second slash and both effects, facing ${facing}`,()=>{
    const f=bmSampledFixture({facing,passives:[]});prepareAirX(f);f.at(.21);
    const initial=f.sim.state.effects.find(e=>e.name===firstX);assert.ok(initial?.active);
    assert.equal(initial.definition.BONE_NAME,'Bip01_L_Hand');
    assert.equal(initial.definition.POSITION_OFFSET_X,100);assert.equal(initial.definition.POSITION_OFFSET_Y,-50);
    f.press(key);f.wait('RBM_DASH_JUMP_COMBO_XZ');f.at(.17);
    const slash=f.sim.state.effects.find(e=>e.name===secondX);assert.ok(slash?.active);
    assert.equal(slash.definition.ROTATE_Z,-37.5);assert.equal(slash.start,.15);
    assert.equal(slash.damage.DAMAGE_DATA.DAMAGE.PHYSIC,.86);
    assert.ok(!f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='RAVEN_DASH_JUMP_X'));
    const packet=encodeOwnedState(f.sim,'bm',{epoch:1,frameSeq:50});validateOwnedState(packet);
    const receiver=bmFixture({facing,passives:[],gap:4000});
    validateOwnedReferences(packet,receiver.a,bmProfile,receiver.map,{profiles:receiver.sim.profiles,actors:receiver.sim.state.actors});
    applyOwnedState(receiver.sim,'bm',packet);
    assert.ok(receiver.sim.state.effects.some(e=>e.name===secondX&&e.active));
    f.wait('RSI_WAIT');f.step(60);
    assert.ok(!f.sim.state.effects.some(e=>[firstX,secondX].includes(e.name)),'original mesh lifetimes end both helpers');
  });
  test(`BM second airborne X travels down and actually hits a standing opponent, facing ${facing}`,()=>{
    const f=bmSampledFixture({facing,gap:400,passives:[]});f.sim.rng=()=>.99;
    prepareAirX(f);f.at(.21);f.press('X');f.wait('RBM_DASH_JUMP_COMBO_XZ');f.at(.17);
    const slash=f.sim.state.effects.find(e=>e.name===secondX);assert.ok(slash.sourceShadowMesh?.literalMotion);
    const birth=[...slash.birthAnchor.position],snap=JSON.parse(JSON.stringify(f.sim.snapshot()));
    const other=bmFixture({facing,gap:400,passives:[]}).sim;other.restore(snap);
    f.step(3);for(let i=0;i<3;i++)other.step(1/60,{});
    assert.ok(slash.x*facing>birth[0]*facing);assert.ok(slash.y<birth[1]);
    assert.equal(other.state.effects.find(e=>e.id===slash.id).y,slash.y);
    f.step(90);
    const starts=new Map(f.sim.state.events.filter(e=>e.type==='effectStarted').map(e=>[e.effectId,e.name]));
    const hits=f.sim.state.events.filter(e=>e.type==='hit'&&starts.get(e.origin?.id)===secondX);
    assert.ok(hits.length>0,'original rotated helper must intersect the real standing body');
    assert.ok(hits.every(e=>e.amount>0&&e.data.DAMAGE.PHYSIC===.86&&e.data.REACT_TYPE===2));
    assert.ok(!f.sim.state.events.some(e=>e.actorId===f.b.id&&e.type==='stateChanged'&&/^RSI_DAMAGE_(?:DOWN|AIR_DOWN)/.test(e.state)));
  });
}

test('BM air-X source resource closure includes original first effect, traveling slash and their particle chains',()=>{
  assert.equal(bmProfile.effectSets.EffectSet_RST_DashJump_X.raw.EFFECT0.START_TIME,.2);
  assert.equal(bmProfile.effectSets.EffectSet_RST_DashJump_XZ.raw.EFFECT0.START_TIME,.15);
  assert.equal(bmProfile.damageEffects[firstX].raw.DAMAGE_DATA.REACT_TYPE,2);
  assert.equal(bmProfile.damageEffects[firstX].raw.DAMAGE_DATA.DAMAGE.MAGIC,1.64);
  const template=bmProfile.effectTemplates.RST_DashJump_XZ_ProDummy;
  assert.deepEqual(template.initialVelocity,[3000,0,0]);assert.equal(template.fields.LifeTime,.3);
  for(const name of ['RBM_DashJump_X_AttackBox','RST_DashJump_XZ_ProDummy','RST_DashJumpX_AP01','RuneGuardIce_S05','RST_ShockWave_Pro04','RST_ShockWave_Pro01','RST_ShockWave_Pro02','RST_ShockWave_Pro01D','RST_ShockWave_Pro03']){
    assert.ok(bmProfile.effectTemplates[name],name);assert.equal(bmProfile.effectTemplates[name].unsupported.length,0,name);
  }
});

for(const [skillId,roll,name]of [[24030,.1,'DamageEffect_RST_ShockWave'],[24030,.99,'DamageEffect_RST_ShockWave_Ultimate'],[24016,.99,'DamageEffect_RBM_ShockWave_Cutter']])
for(const facing of [1,-1])test(`BM ${name} retains flight reactions and knocks down without a follow-up, facing ${facing}`,()=>{
  const {sim,a,b}=bmFixture({skillId,passives:[],gap:165,facing});sim.rng=()=>roll;
  sim.step(1/60,{bm:{pressed:['A']}});
  for(let i=0;i<120&&a.skillId;i++)sim.step(1/60,{});
  assert.equal(a.skillId,null);
  const lastHit=sim.state.events.filter(e=>e.type==='hit'&&e.targetId===b.id).at(-1);assert.ok(lastHit);
  for(let i=0;i<240;i++)sim.step(1/60,{});
  assert.equal(b.state,'RSI_WAIT');
  assert.ok(sim.state.events.some(e=>e.actorId===b.id&&e.type==='stateChanged'&&e.state.startsWith('RSI_DAMAGE_AIR_FLY_')));
  assert.ok(sim.state.events.some(e=>e.actorId===b.id&&e.type==='stateChanged'&&/^RSI_DAMAGE_(?:DOWN|AIR_DOWN)/.test(e.state)));
});
