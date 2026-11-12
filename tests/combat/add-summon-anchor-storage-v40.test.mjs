import test from 'node:test';
import assert from 'node:assert/strict';
import {updateAddSummonEffectAnchor} from '../../packages/combat-core/add-summons.mjs';

test('NPC trace retains independent birth/current/posed snapshots even with a cached sampler result',()=>{
 const source={position:[10,20,30],rotation:[0,37,-24],facing:1,matrix:Array.from({length:16},(_,i)=>i),extra:{source:'test'}};
 const owner={id:'add',sourceAddSummon:{serial:7,facing:1}},sim={summonPoseSampler:()=>source};
 const effect={sourceAddSummonSerial:7,definition:{BONE_NAME:'Core',TRACE_MATRIX:1}};
 assert.equal(updateAddSummonEffectAnchor(sim,effect,owner),true);
 const birth=structuredClone(effect.birthAnchor),current=effect.currentAnchor,posed=effect.sourcePosedAnchor;
 assert.notEqual(current,effect.birthAnchor);assert.notEqual(current,posed);
 assert.notEqual(current.position,posed.position);assert.notEqual(current.extra,source.extra);
 source.position[0]=100;source.matrix[12]=100;source.extra.source='second';effect.active=true;
 updateAddSummonEffectAnchor(sim,effect,owner);
 assert.deepEqual(effect.birthAnchor,birth,'released original world point stays fixed');
 assert.deepEqual(current,birth,'previous frame does not alias later source or retained destinations');
 assert.deepEqual(posed,birth);assert.equal(effect.currentAnchor.position[0],100);
 assert.equal(effect.currentAnchor.extra.source,'second');assert.equal(source.customPosition,undefined,'sampler-owned source is untouched');
 const latest=structuredClone(effect.currentAnchor);owner.sourceAddSummon=null;
 updateAddSummonEffectAnchor(sim,effect,owner);assert.deepEqual(effect.currentAnchor,latest,'orphan keeps its final independent anchor');
});
