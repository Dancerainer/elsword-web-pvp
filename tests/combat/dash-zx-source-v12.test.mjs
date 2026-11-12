/** Target declarations + fixed-V5 equations, never observed hit-count gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {attackerIsFront} from '../../packages/combat-core/reaction-policy.mjs';
import {dashZxProfile as profile,dashZxFixture,dashZxFrame,startDashZx} from '../../tools/combat/rf_dash_zx_audit.mjs';

test('66ZX retains target SP2a, authored root and both independent source clocks',()=>{
  const raw=profile.states.RSI_OVER_TAKER_DASH_COMBO_ZX.raw;
  assert.equal(raw.ANIM_NAME,'SP2a_PowerAssault');assert.equal(raw.ANIM_SPEED,1.75);
  assert.equal(raw.APPLY_ANIM_MOVE,undefined,'absent uses explicit fixed-V5 default, not a forced override');
  assert.deepEqual(raw.SPEED_TIME0,{'1':900,'2':0,'3':.25,'4':1});
  assert.deepEqual(raw.CAN_PASS_UNIT_TIME1,{'1':.2,'2':1});
  const e=profile.effectSets.EffectSet_RF_DASH_ZX.raw.EFFECT0;
  assert.equal(e.START_TIME,.2);assert.equal(e.BONE_NAME,'Bip01');assert.equal(e.TRACE,1);
  const d=profile.damageEffects.Damage_Effect_Raven_ROT_Dash_ZX.raw;
  assert.equal(d.USE_GLOBAL_TIME,1);assert.equal(d.ATTACK_TIME_START,.15);assert.equal(d.ATTACK_TIME_END,.35);
  assert.equal(d.DAMAGE_DATA.RE_ATTACK,0);assert.equal(d.DAMAGE_DATA.ARRANGED_FLY,1);
});

test('ARRANGED_FLY uses source direction equality for all victim facings and both sides of the damage mesh',()=>{
  for(const damageDirectionRight of [false,true])for(const isRight of [false,true])for(const x of [-500,500]){
    assert.equal(attackerIsFront([0,0,0],[x,0,0],[1,0,0],isRight,{arrangedFly:true,damageDirectionRight}),damageDirectionRight!==isRight);
  }
  assert.throws(()=>attackerIsFront([0,0,0],[1,0,0],[1,0,0],true,{arrangedFly:true}),/explicit native damage direction/);
  assert.equal(attackerIsFront([0,0,0],[500,0,0],[1,0,0],true,{arrangedFly:false,damageDirectionRight:false}),true);
});

for(const facing of [-1,1])test(`production 66ZX hit obeys source 2075 knock direction after crossing, facing ${facing}`,async()=>{
  const f=await dashZxFixture({facing,gap:500}),{s,b}=f;startDashZx(f);
  let impact;
  for(let i=0;i<180;i++){
    dashZxFrame(f);impact=s.state.events.find(e=>e.type==='hit'&&e.data.DAMAGE.PHYSIC===3.85);
    if(impact)break;
  }
  assert.ok(impact,'production helper intersection setup; not a source hit-count claim');
  assert.equal(b.vx,2075*facing,'literal ARRANGED_FLY equality branch + victim local/world basis');
  assert.equal(b.vy,1700);assert.equal(b.lastAttackerFront,true);
  assert.equal(impact.origin.damageDirectionRight,facing===1);
});

test('traced effect keeps FollowLineRight from creation even if owner later turns',async()=>{
  const f=await dashZxFixture(),{s,a,b}=f;b.facing=1;
  const e=s.createEffect(a,{NAME:'Damage_Effect_Raven_ROT_Dash_ZX'},{birthAnchor:{position:[b.x,b.y,b.z],facing:1}});
  // A controlled overlap isolates DamageReact's source direction consumer.
  // Collision/clock traversal is checked by the actual-input cases above.
  s.tickEffects(.01);assert.equal(e.damageDirectionRight,true);
  a.facing=-1;s.effectSampler=()=>s.defenderSampler(b);
  s.tickEffects(.15);
  assert.equal(b.lastAttackerFront,false);assert.equal(b.vx,2075);
});

test('a delayed EffectSet captures FollowLineRight at mesh birth rather than definition queueing',async()=>{
  const f=await dashZxFixture(),{s,a}=f;
  const e=s.createEffect(a,{NAME:'Damage_Effect_Raven_ROT_Dash_ZX'},{clock:'custom',start:.2});
  assert.equal(e.facing,1);a.facing=-1;s.tickEffects(.1);assert.equal(e.active,false);
  assert.equal(e.damageDirectionRight,undefined);s.tickEffects(.1);
  assert.equal(e.active,true);assert.equal(e.damageDirectionRight,false);
});

test('core guard consumes the same arranged direction branch even when mesh position indicates the opposite side',async()=>{
  for(const facing of [-1,1]){
    const f=await dashZxFixture({facing}),{s,a,b}=f;b.facing=-1;
    b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);b.core.phase='idle';
    const e=s.createEffect(a,{NAME:'Damage_Effect_Raven_ROT_Dash_ZX'},
      {birthAnchor:{position:[b.x+facing*500,b.y,b.z],facing}});
    s.effectSampler=()=>s.defenderSampler(b);s.tickEffects(.16);
    const hit=s.state.events.find(event=>event.type==='hit'&&event.origin.id===e.id);
    assert.ok(hit);assert.equal(hit.guarded,facing===1,'V5 ARRANGED_FLY overrides the position-based front test before native guard');
  }
});

test('66X remains its separate two-stage attack and is never mislabeled as 66ZX',async()=>{
  const f=await dashZxFixture({gap:500}),{a,s}=f;
  dashZxFrame(f,{pressed:['RIGHT'],held:['RIGHT']});dashZxFrame(f,{released:['RIGHT']});dashZxFrame(f,{pressed:['RIGHT'],held:['RIGHT']});
  dashZxFrame(f,{pressed:['X'],held:['RIGHT','X']});
  assert.equal(a.state,'RSI_DASH_COMBO_X');for(let i=0;i<150;i++)dashZxFrame(f);
  assert.equal(s.state.events.filter(e=>e.type==='effectStarted'&&e.name==='Damage_Effect_Raven_ROT_Dash_ZX').length,0);
  assert.ok(s.state.events.some(e=>e.type==='characterDamageDataChanged'&&e.clearHitUnits));
});
