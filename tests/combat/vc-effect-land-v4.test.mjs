import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {createLiteralMesh,followLiteralMeshLine,stepShadowMesh,refreshShadowMeshLand} from '../../packages/combat-core/shadow-mesh.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,applyOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const name='Raven_Harpoon_Spear_Shell_MEMO',template=vcProfile.effectTemplates[name];
const mesh=(position=[100,150,0],facing=1)=>createLiteralMesh({name,fields:template.fields,events:template.events,
  velocity:[100,0,0],position,landY:0,rotation:[0,facing<0?180:0,0],facing});
const line={lineId:0,start:[-1000,0,0],end:[1000,0,0],attributes:{}};
const geometry=await createNativeGeometry({bytes:readFileSync(new URL('../../artifacts/native/geometry.wasm',import.meta.url)),map:{lines:[line]}});

test('FollowLine uses original CanDown with NEW inclusive150 and MUST strict200 bounds',()=>{
  for(const [height,snap,stop] of [[150,true,false],[151,false,false],[200,false,false],[201,false,true]]){
    const m=mesh([100,height,0]);
    assert.equal(followLiteralMeshLine(m,{FOLLOW_LINE:1,FOLLOW_LINE_NEW:1,MUST_ON_LINE:1},geometry,[line]).supported,true);
    assert.equal(m.position[1],snap?0:height);assert.equal(!!m.followEndPending,stop);
    if(stop){assert.deepEqual(m.velocity,[0,0,0]);assert.equal(m.dirSpeed,0);}
  }
  const out=mesh([3000,50,0]);followLiteralMeshLine(out,{FOLLOW_LINE:1,MUST_ON_LINE:1},geometry,[line]);
  assert.equal(out.followEndPending,true);
});

test('native three dimensional line yaw drives both next mesh displacement and visual rotation',async()=>{
  const bent={...line,start:[-1000,0,-1000],end:[1000,0,1000]};
  const g=await createNativeGeometry({bytes:readFileSync(new URL('../../artifacts/native/geometry.wasm',import.meta.url)),map:{lines:[bent]}});
  for(const facing of [-1,1]){
    const m=mesh([100,50,100],facing);m.gravity=[0,0,0];m.dirSpeed=0;
    followLiteralMeshLine(m,{FOLLOW_LINE:1},g,[bent],{initial:true});
    assert.equal(m.rotation[1],facing===1?-45:135);
    const before=[...m.position];stepShadowMesh(m,.125,[]);
    assert.ok((m.position[0]-before[0])*facing>0);
    assert.ok(Math.abs((m.position[0]-before[0])-(m.position[2]-before[2]))<.0001);
  }
});

test('crash land retains full native coordinate and freezes it across the dying packet',()=>{
  const m=mesh([100,150,0]);m.crashLand=true;
  refreshShadowMeshLand(m,geometry);assert.equal(m.landPosition[1],0);
  const saved=[...m.landPosition];m.position=[3000,-200,100];m.deathReason='template-land-crash';
  refreshShadowMeshLand(m,{land:()=>{throw Error('A dying frame must not requery land');}});
  assert.deepEqual(m.landPosition,saved);
});

test('Harpoon DIE position4 uses saved XYZ, default parent axes, and rejects negative ground',()=>{
  const {sim,a}=vcFixture({skillId:24031,gap:20000});
  const effect=sim.createEffect(a,{NAME:'RAVEN_HARPOON_SPEAR_SHELL_Ultimate'},
    {birthAnchor:{position:[9,900,17],rotation:[0,180,0],facing:-1}});
  effect.sourceShadowMesh={landPosition:[125,300,75]};effect.sourceDamageAnchor={position:[500,650,900],rotation:[0,135,0],facing:-1};
  effect.endReason='template-land-crash';sim.createSecondaryDamage(effect,a,'DIE_DAMAGE_EFFECT');
  const children=sim.state.effects.filter(e=>e.parentEffectId===effect.id);
  assert.equal(children.length,4);
  for(let i=0;i<children.length;i++){
    const declaration=effect.damage['DIE_DAMAGE_EFFECT'+i];
    assert.deepEqual(children[i].birthAnchor.position,[125,300+(declaration.OFFSET_Y??0),75]);
    assert.deepEqual(children[i].birthAnchor.rotation,[0,135,0]);
  }
  const before=sim.state.effects.length;effect.sourceShadowMesh.landPosition=[0,-1,0];
  sim.createSecondaryDamage(effect,a,'DIE_DAMAGE_EFFECT');assert.equal(sim.state.effects.length,before);
});

test('actual Harpoon live shell and nonliteral descendants preserve new ground state across ownership transfer',()=>{
  const local=vcFixture({skillId:24031,gap:20000}),remote=vcFixture({skillId:24031,gap:20000});
  local.a.y+=450;local.a.grounded=false;local.a.lineId=null;local.sim.enter(local.a,'RSI_JUMP_DOWN','explicit-air-fixture');
  let shell=0,descendant=0;
  for(let i=0;i<240;i++){
    local.sim.step(1/60,i===0?{pressed:['A']}: {},{snapshot:false});local.sim.drainEvents();
    const wire=encodeOwnedState(local.sim,'vc',{frameSeq:i});
    validateOwnedReferences(wire,remote.a,vcProfile,remote.map);applyOwnedState(remote.sim,'vc',wire);remote.sim.drainEvents();
    for(const source of wire.effects){
      const target=remote.sim.state.effects.find(e=>e.networkSourceId===source.id||e.id===source.id);
      if(source.sourceShadowMesh?.landPosition){shell++;assert.deepEqual(target.sourceShadowMesh.landPosition,source.sourceShadowMesh.landPosition);}
      if(source.sourceFollowLine){descendant++;assert.deepEqual(target.sourceFollowLine,source.sourceFollowLine);}
    }
    if(wire.effects.some(e=>e.sourceFollowLine)){
      const bad=structuredClone(wire);bad.effects.find(e=>e.sourceFollowLine).sourceFollowLine.position[0]=NaN;
      assert.throws(()=>validateOwnedState(bad),/follow-line/);
    }
  }
  assert.ok(shell>0&&descendant>0,'both specialized and ordinary mesh paths transmitted');
});
