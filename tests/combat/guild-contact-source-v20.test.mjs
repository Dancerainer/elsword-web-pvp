import test from 'node:test';
import assert from 'node:assert/strict';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';
import {initializeGuildSkills} from '../../packages/combat-core/guild-skills.mjs';

test('target2016 guild509 callback follows an accepted contact and retains the actual3% Buff pipeline',async()=>{
  const s=await make({passives:[]}),a=s.actor('rf'),b=s.actor('target');
  for(const owner of [a,b])initializeGuildSkills(owner,{passiveIds:[509]});
  s.rng=()=>0;
  b.invincible=true;
  assert.equal(s.injectHit({attackerId:a.id,targetId:b.id,damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE:1}}).accepted,false);
  assert.equal(a.buffs.length,0);assert.equal(b.buffs.length,0);b.invincible=false;
  for(const REACT_TYPE of [1,7]){
    assert.equal(s.injectHit({attackerId:a.id,targetId:b.id,damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE}}).accepted,true);
    assert.equal(a.buffs.some(v=>v.templateId===57),true);assert.equal(b.buffs.some(v=>v.templateId===57),true);
  }
  // Existing Buff merge still controls repeats, independently of Miss status.
  const before=[a.hp,b.hp];assert.deepEqual(s.processGuildMiss(a.id,b.id),[]);
  assert.deepEqual([a.hp,b.hp],before);assert.equal(a.stats.criticalRate,100);assert.equal(b.stats.criticalRate,100);
  assert.deepEqual(s.processGuildMiss(a.id,b.id),[],'active original buff is not refreshed');
});

test('RT_DUMMY accepted damage may trigger original guild508 recovery; NO_DAMAGE and sensor may not',async()=>{
  const s=await make({passives:[]}),a=s.actor('rf'),b=s.actor('target');
  initializeGuildSkills(b,{passiveIds:[508]});s.rng=()=>0;
  const hit=data=>s.injectHit({attackerId:a.id,targetId:b.id,damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE:7,...data}});
  hit({NO_DAMAGE:true});assert.equal(b.guild.recovery.pulses,0);
  hit({REACT_TYPE:6});assert.equal(b.guild.recovery.pulses,0);
  hit({});assert.equal(b.guild.recovery.pulses,3);
  assert.ok(s.state.events.some(e=>e.type==='guildRecoveryTriggered'&&e.actorId===b.id));
});
