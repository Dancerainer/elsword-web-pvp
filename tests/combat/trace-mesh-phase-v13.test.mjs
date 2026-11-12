/** Source buffer equations and production-input regressions; no native gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTraceMeshPose} from '../../packages/combat-core/trace-mesh-phase.mjs';
import {dashZxFixture,dashZxFrame,startDashZx} from '../helpers/authored-command-fixture.mjs';

test('SetPos changes pending position while the already posed mesh and rotation stay frozen',()=>{
  const e={active:true,damage:{},definition:{TRACE:1},
    birthAnchor:{position:[5,10,15],facing:1,rotation:[0,0,25]}};
  advanceTraceMeshPose(e,{},()=>({position:[100,200,300],facing:-1,rotation:[0,180,90]}));
  assert.deepEqual(e.sourcePosedAnchor.position,[5,10,15]);
  assert.deepEqual(e.currentAnchor.position,[100,200,300]);
  assert.deepEqual(e.currentAnchor.rotation,[0,0,25]);assert.equal(e.currentAnchor.facing,1);
  advanceTraceMeshPose(e,{},()=>({position:[400,500,600],facing:-1}));
  assert.deepEqual(e.sourcePosedAnchor.position,[100,200,300]);
  assert.deepEqual(e.currentAnchor.position,[400,500,600]);
});

test('native helper sampler consumes the posed anchor after owner moves, with no instantaneous retrace',async()=>{
  const f=await dashZxFixture(),{s,a}=f;
  const e=s.createEffect(a,{NAME:'Damage_Effect_Raven_ROT_Dash_ZX',TRACE:1,BONE_NAME:'Bip01'},
    {birthAnchor:{position:[10,3080,0],facing:1}});
  s.tickEffects(.01);const before=s.effectSampler(e,a);a.x+=1000;
  assert.deepEqual(s.effectSampler(e,a),before,'CollisionDataCheck reads cached XSkinAnim helper transforms');
});

for(const facing of [-1,1])for(const gap of [70,80,180,500])
test(`actual 66ZX input keeps rush hit after source pose-buffer correction, facing ${facing}, gap ${gap}`,async()=>{
  const f=await dashZxFixture({facing,gap}),{s,a,b}=f;startDashZx(f);
  let mesh;
  for(let i=0;i<180;i++){dashZxFrame(f);mesh??=s.state.effects.find(e=>e.name==='Damage_Effect_Raven_ROT_Dash_ZX');}
  const hits=s.state.events.filter(e=>e.type==='hit'&&e.data.DAMAGE.PHYSIC===3.85);
  assert.equal(hits.length,1,'production regression fixture; RE_ATTACK=0 permits one accepted target');
  assert.ok(mesh);assert.equal(mesh.damage.ATTACK_TIME_START,.15);assert.equal(mesh.damage.ATTACK_TIME_END,.35);
  assert.ok(b.hp<b.hpMax);assert.notEqual(a.state,'RSI_OVER_TAKER_DASH_COMBO_ZX','finite action exit');
});

test('posed and pending anchors survive full JSON snapshot restoration and 120 subsequent frames',async()=>{
  const f=await dashZxFixture();startDashZx(f);
  for(let i=0;i<26;i++)dashZxFrame(f);
  const mesh=f.s.state.effects.find(e=>e.name==='Damage_Effect_Raven_ROT_Dash_ZX');
  assert.ok(mesh.sourcePosedAnchor&&mesh.currentAnchor);
  assert.notDeepEqual(mesh.sourcePosedAnchor.position,mesh.currentAnchor.position);
  const g=await dashZxFixture();g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
  for(let i=0;i<120;i++){dashZxFrame(f);dashZxFrame(g);}
  assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),JSON.parse(JSON.stringify(g.s.snapshot())));
});

test('position-only cache does not replace Arc, Shadow or TRACE_MATRIX consumers',()=>{
  for(const special of [{sourceArcHandle:1},{sourceShadowMesh:{}},{definition:{TRACE:1,TRACE_MATRIX:1}}]){
    const e={active:true,damage:{},definition:{TRACE:1},birthAnchor:{position:[0,0,0]},...special};
    advanceTraceMeshPose(e,{},()=>{throw new Error('must not run position-only consumer');});
    assert.equal(e.sourcePosedAnchor,undefined);
  }
});
