import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {encodeOwnedState,encodeEffectState,applyOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const slots=['birthAnchor','currentAnchor','sourceDamageAnchor','sourcePosedAnchor','sourceShadowMesh'];
const geometry=value=>{
  if(Array.isArray(value))return value.map(geometry);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['evidence','evidenceClass'].includes(key)).map(([key,v])=>[key,geometry(v)]));
  return value;
};
test('all five profession wires omit local proof strings without mutating live objects or geometry',()=>{
  const effect={id:1,name:'fixture',birthAnchor:{position:[1,2,3],rotation:[0,180,-20],customPosition:true,evidence:'anchor source proof'},
    currentAnchor:{position:[4,5,6],matrix:Array(16).fill(1),evidence:'current source proof'},sourceShadowMesh:{position:[4,5,6],velocity:[2000,0,0],evidenceClass:'mesh source proof'}};
  const original=structuredClone(effect),wire=encodeEffectState(effect,vcProfile);
  assert.deepEqual(effect,original);assert.deepEqual(wire,geometry(original));assert.ok(JSON.stringify(wire).length<JSON.stringify(original).length);
  for(const unitClass of [107,100,101,106,115])assert.deepEqual(encodeEffectState(effect,{target:{unitClass}}),geometry(original));
  assert.deepEqual(effect,original);
});
test('actual Napalm compact transfer preserves original posed collision and 40 subsequent fixed simulation packets',()=>{
  const source=vcFixture({skillId:24022,gap:2500}),full=vcFixture({skillId:24022,gap:2500}),compact=vcFixture({skillId:24022,gap:2500});
  for(let frame=0;frame<180&&!source.sim.state.effects.some(e=>e.sourceShadowMesh);frame++){
    source.sim.step(1/60,{vc:frame===0?{pressed:['A']}:{}},{snapshot:false});source.sim.drainEvents();
  }
  assert.ok(source.sim.state.effects.some(e=>e.sourceShadowMesh));const before=source.sim.snapshot();
  const small=encodeOwnedState(source.sim,'vc',{frameSeq:30}),large=structuredClone(small);
  // Build the full-proof comparison from actual local source objects. Every
  // profession now uses the same projection, so an RF encoder is no longer
  // an independent representation of the earlier metadata-bearing wire.
  for(const effect of large.effects){
    const original=source.sim.state.effects.find(e=>e.id===effect.id);assert.ok(original);
    for(const key of slots)if(Object.hasOwn(original,key))effect[key]=JSON.parse(JSON.stringify(original[key]));
  }
  assert.deepEqual(geometry(large),geometry(small),'only diagnostic text differs before running both real collision paths');
  assert.deepEqual(source.sim.snapshot(),before);assert.ok(JSON.stringify(small).length<JSON.stringify(large).length);
  for(const [fixture,report]of [[full,large],[compact,small]]){
    validateOwnedState(report);validateOwnedReferences(report,fixture.a,vcProfile,fixture.map);applyOwnedState(fixture.sim,'vc',report);fixture.sim.drainEvents();
  }
  for(let frame=0;frame<40;frame++){
    const left=full.sim.state.effects,right=compact.sim.state.effects;assert.equal(left.length,right.length);
    for(let i=0;i<left.length;i++){
      for(const key of slots)assert.deepEqual(geometry(left[i][key]),geometry(right[i][key]));
      assert.deepEqual(full.sim.effectSampler(left[i],full.a),compact.sim.effectSampler(right[i],compact.a));
    }
    for(const fixture of [full,compact]){fixture.sim.step(1/60,{}, {snapshot:false});fixture.sim.drainEvents();}
    assert.deepEqual(geometry(full.sim.snapshot()),geometry(compact.sim.snapshot()));
  }
});
