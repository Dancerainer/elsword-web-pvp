import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture,tick} from '../helpers/add-fixture.mjs';

// Expected names are original career motion clips, independently selected by
// the source custom-animation path; they are not outputs of the new adapter.
for(const [id,path] of [['LP','APT'],['MM','AAT'],['DE','ATT']]){
 test(`${id} formation uses its original career startup and waiting motion`,()=>{
  const {sim,a,profile}=addFixture(id);a.sourceAdd.dp=8000;
  assert.ok(profile.clips[path+'_Formation_Start']);
  assert.ok(profile.clips[path+'_Formation_Wait']);
  assert.equal(sim.tryAwakening(a),true);
  assert.equal(a.animationName,path+'_Formation_Start');
  tick(sim,2);assert.equal(a.sourceAdd.formation,true);
  assert.equal(a.animationName,path+'_Formation_Wait');
  assert.equal(sim.tryAwakening(a),true);tick(sim,.1);
  assert.equal(a.animationName,'Wait');
 });
 test(`${id} actual awakened Void Breaker selects the authored Hyper voice bank`,()=>{
  const {sim,a,profile}=addFixture(id,{skillId:29027});a.sourceAdd.dp=8000;a.mp=a.mpMax;
  assert.equal(profile.states.ANSI_SA_AN_VOID_BREAKER.raw.SOUND_SET0.USE_HYPER_SOUND,1);
  assert.equal(sim.tryAwakening(a),true);tick(sim,2);
  sim.step(1/60,{add:{held:['A'],pressed:['A']}});
  assert.equal(a.skillId,29027);
  assert.equal(a.soundSet.mode,'HYPER');
  tick(sim,.25);
  assert.ok(sim.state.events.some(e=>e.type==='sound'&&e.actorId==='add'&&e.name==='AddVoice_Void_Breaker01_Hyper.ogg'));
 });
}
