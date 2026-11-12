/** Real MM resource/controller transitions through the source-event producer.
 * Remaining-time ticks are deliberately not reliable control events. No
 * Native/GPU fixture or execution is installed by this table-based test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {addSkillResourceCost,commitAddSkillResources,advanceAddSystems} from '../../packages/combat-core/add-systems.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const map={sceneId:'playback-generator-v12',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};

test('MM actual select/fire/ready/switch/end emits reliable generator logic without streaming remaining time',()=>{
  const sim=createSimulation({profile,map,networkOwnerId:'source',actors:[
    {id:'source',professionId:'MM',team:0,position:[0,0,0],lineId:0,loadout:[{skillId:29013},{skillId:29017},...Array(6).fill(null)]},
    {id:'target',professionId:'MM',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const actor=sim.actor('source');actor.sourceAdd.dp=8000;actor.mp=actor.mpMax;
  assert.equal(actor.loadout[0].requestedSkillId,29013);
  assert.equal(actor.loadout[0].skillId,29035,'production master-level loadout upgrades the activator');
  assert.equal(actor.loadout[1].skillId,29017,'the switching target must have a supported production executor');
  assert.equal(sim.skill(29035,actor).supported,true);assert.equal(sim.skill(29017,actor).supported,true);
  const producer=createCombatPlaybackProducer({version:1});let frame=0;
  const capture=()=>producer.capture(sim,actor.id,{epoch:1,frameSeq:++frame});
  const initial=capture();assert.equal(initial.playback.start,true);
  const controller=[actor.state,actor.stateSerial,actor.animationName,actor.animationTransitionSerial];
  const validate=action=>{
    const report=encodeOwnedState(sim,actor.id,{epoch:1,frameSeq:action.frameSeq});report.actions=[action];
    validateOwnedReferences(validateOwnedState(report),actor,profile,map,{actors:sim.state.actors,profiles:sim.profiles});
  };
  const commit=id=>{
    const skill=sim.skill(id,actor),plan=addSkillResourceCost(actor,skill,{profile});
    assert.equal(plan.resourceDpInsufficient,false);assert.equal(plan.resourceMpInsufficient,false);
    actor.mp=Math.fround(actor.mp-plan.mpCost);
    commitAddSkillResources(actor,skill,plan,{profile});return plan;
  };
  const expectLogic=(skillId,phase,generation)=>{
    const action=capture();assert.ok(action,'logical generator transition must not await ordinary pose refresh');
    assert.equal(action.playback.start,false,'factory logic must not invent a controller restart');
    assert.deepEqual([action.actor.sourceAdd.generator.skillId,action.actor.sourceAdd.generator.phase,action.actor.sourceAdd.generator.generation],[skillId,phase,generation]);
    assert.deepEqual([actor.state,actor.stateSerial,actor.animationName,actor.animationTransitionSerial],controller);
    validate(action);assert.equal(capture(),null);return action;
  };
  assert.equal(commit(29035).mode,'generator-select');expectLogic(29035,'ready',1);
  const duration=actor.sourceAdd.generator.remaining;
  assert.equal(duration,45,'enhanced activator uses its actual production lifetime');
  for(let i=0;i<30;i++){
    advanceAddSystems(actor,1/60,{profile});actor.animationTime+=1/60;actor.stateTime+=1/60;
    assert.equal(capture(),null,'remaining/animation clock progression must not emit another reliable event');
  }
  assert.ok(actor.sourceAdd.generator.remaining<duration);
  assert.equal(commit(29035).mode,'generator-fire');expectLogic(29035,'firing',1);
  advanceAddSystems(actor,1/60,{profile});expectLogic(29035,'ready',1);
  assert.equal(commit(29017).mode,'generator-switch');expectLogic(29017,'ready',2);
  // Switching back increments generation even when the current controller and
  // ready phase do not change; the selected-skill identity is also reliable.
  assert.equal(commit(29035).mode,'generator-switch');expectLogic(29035,'ready',3);
  advanceAddSystems(actor,actor.sourceAdd.generator.remaining,{profile});
  assert.equal(actor.sourceAdd.generator,null);
  const ended=capture();assert.ok(ended);assert.equal(ended.playback.start,false);
  assert.equal(ended.actor.sourceAdd.generator,null);validate(ended);assert.equal(capture(),null);
});
