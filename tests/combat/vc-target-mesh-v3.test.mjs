import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {hasVeteranTarget,veteranTargetSets} from '../../packages/combat-core/vc-target-mesh.mjs';
import {encodeOwnedState,validateOwnedReferences,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=f=>{f.sim.step(1/60,{},{snapshot:false});f.sim.drainEvents();};
for(const setName of Object.keys(veteranTargetSets))for(const facing of [-1,1])
test(`Incineration authored mesh bones, receiver and detached tail: ${setName} facing${facing}`,()=>{
  const source=vcFixture({skillId:24023,gap:10000}),target=vcFixture({skillId:24023,gap:10000});
  source.a.facing=facing;source.sim.spawnSet(source.a,setName,vcProfile.enums.EFFECT_SET_TIMER_TYPE.ESTT_CUSTOM);
  let sampled=0,frozen=0,last=new Map();
  for(let i=0;i<170;i++){
    tick(source);const effects=source.sim.state.effects,carrier=effects.find(e=>e.name===veteranTargetSets[setName]);
    const children=effects.filter(e=>hasVeteranTarget(e)&&e.active);
    if(carrier&&children.length){
      for(const child of children){assert.deepEqual(child.currentAnchor.position,source.sim.effectBoneSampler(carrier,source.a,child.definition.BONE_NAME));
        assert.notDeepEqual(child.currentAnchor.position,[source.a.x,source.a.y,source.a.z]);last.set(child.id,structuredClone(child.currentAnchor));}
      const wire=encodeOwnedState(source.sim,'vc',{frameSeq:i});validateOwnedReferences(wire,target.a,vcProfile,target.map);applyOwnedState(target.sim,'vc',wire);
      for(const child of children){const remote=target.sim.state.effects.find(e=>e.networkId===child.id);
        assert.deepEqual(remote.currentAnchor,child.currentAnchor);
        assert.equal(target.sim.state.effects.find(e=>e.id===remote.sourceVeteranTargetId).name,carrier.name);}
      const bad=structuredClone(wire);bad.effects.find(hasVeteranTarget).sourceVeteranTargetId='player';assert.throws(()=>validateOwnedState(bad),/veteran-target/);sampled++;
    }else if(!carrier&&children.length){for(const child of children)assert.deepEqual(child.currentAnchor,last.get(child.id));source.a.x+=300;frozen++;}
  }
  assert.ok(sampled>10);assert.ok(frozen>10);assert.equal(source.sim.state.effects.filter(hasVeteranTarget).length,0);
});
