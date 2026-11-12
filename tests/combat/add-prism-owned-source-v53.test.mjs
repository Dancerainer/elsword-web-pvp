import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {startAddPrismEndpoints} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';

function packet(id,skillId){
 const f=addFixture(id,{skillId}),{sim,a}=f;
 assert.equal(startAddPrismEndpoints(sim,a,[a.x,a.y,a.z],[a.x+300,a.y,a.z]),true);
 const wire=validateOwnedState(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1}));
 return {...f,wire,context:{actors:sim.state.actors,profiles:sim.profiles}};
}
for(const [id,skillId]of [['LP',29003],['DE',29029]])test(`original ${id} Prism${skillId} endpoint packets retain their equipped-skill source`,()=>{
 const {sim,a,profile,wire,context}=packet(id,skillId);
 assert.equal(wire.actor.sourceAddPrismEndpoints.length,2);
 assert.doesNotThrow(()=>validateOwnedReferences(wire,a,profile,sim.map,context));
});
test('a valid-shaped Maximum-only owner packet cannot inject unconfigured invisible Prism colliders',()=>{
 const {sim,a,profile,wire,context}=packet('DE',29022);
 assert.equal(a.loadout.some(slot=>[29003,29029].includes(slot?.skillId)),false);
 assert.throws(()=>validateOwnedReferences(wire,a,profile,sim.map,context),/unconfigured-owner-prism-endpoints/);
 wire.actor.sourceAddPrismEndpoints=[];
 assert.doesNotThrow(()=>validateOwnedReferences(wire,a,profile,sim.map,context),'empty container retirement needs no invented active cast');
});
