import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
import {lordKnightSkillEvent} from '../../packages/combat-core/lk-skills.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const base=authoredEquipmentPreset(JSON.parse(readFileSync(new URL('../../config/lk-preset.json',import.meta.url))));
const preset=(id,speed=1)=>({...base,guildPassives:[],attributes:{...base.attributes,animationSpeedMultiplier:speed},
  loadout:[{skillId:id,branchId:'none'},null,null,null,null,null,null,null]});
async function fixture(id,options={}){
  const {speed=1,...rest}=options;
  const f=await lkCommandFixture({...rest,preset:preset(id,speed)});
  f.actor.mp=f.actor.mpMax;f.sim.drainEvents();return f;
}
function cast(f){f.sim.step(1/60,{lk:{pressed:['A'],held:['A']}});return f.sim.drainEvents();}
for(const facing of [-1,1])for(const speed of [1,1.4])test(`Armageddon first hit has original giant sword reach, facing ${facing}, speed ${speed}`,async()=>{
  const f=await fixture(21008,{facing,speed,gap:450});let events=cast(f),hit=null,started=null;
  for(let i=0;i<200&&hit===null;i++){
    f.sim.step(1/60,{});const packet=f.sim.drainEvents();events.push(...packet);
    if(packet.some(e=>e.type==='effectStarted'&&e.name==='ELK_ArmagedonBladeM'))started=f.sim.state.step;
    if(packet.some(e=>e.type==='hit'&&e.actorId==='lk'))hit=f.sim.state.step;
  }
  assert.ok(hit,'450-unit target must be hit by the authored attached sword');
  assert.equal(started,hit,'visible sword and first damage belong to the same simulation packet');
  assert.ok(f.actor.animationTime>=1.68&&f.actor.animationTime<1.72,'independent target2016 ATTACK_TIME0');
  assert.equal(events.filter(e=>e.type==='effectSet'&&e.name==='EffectSet_SA_ELK_ArmagedonBlade').length,1);
  assert.equal(events.filter(e=>e.type==='hit'&&e.actorId==='lk').length,1,'no extra damage origin per sword helper');
  assert.ok(f.actor.buffs.some(b=>b.templateId===322));
  const owned=encodeOwnedState(f.sim,'lk');validateOwnedState(owned);
  const receiver=await fixture(21008,{facing,speed,gap:450});applyOwnedState(receiver.sim,'lk',owned);receiver.sim.tickEffects(0);
  assert.ok(receiver.sim.state.effects.some(e=>e.name==='ELK_ArmagedonBladeM'&&e.active&&!e.dead));
});
test('Armageddon does not manufacture an unbounded hitbox; buff removal retires its display',async()=>{
  const f=await fixture(21008,{gap:1600});let events=cast(f);
  for(let i=0;i<180;i++){f.sim.step(1/60,{});events.push(...f.sim.drainEvents());}
  assert.equal(events.filter(e=>e.type==='hit'&&e.actorId==='lk').length,0);
  assert.ok(f.sim.state.effects.some(e=>e.name==='ELK_ArmagedonBladeM'&&e.active&&!e.dead));
  f.actor.buffs=f.actor.buffs.filter(b=>b.templateId!==322);f.sim.step(1/60,{});
  assert.ok(!f.sim.state.effects.some(e=>e.buffTemplateId===322&&!e.dead));
});
test('Armageddon source end and authored 0.5 attacker stop are retained, including held movement',async()=>{
  const runs=[];
  for(const gap of [100,1600]){
    const f=await fixture(21008,{gap});let events=cast(f),end=null,stoppedFrames=0;const stops=[];
    for(let i=0;i<220&&end===null;i++){
      const before=f.actor.animationTime;
      f.sim.step(1/60,{lk:{held:['RIGHT']}});const packet=f.sim.drainEvents();events.push(...packet);
      if(f.actor.hitStop>0){assert.equal(f.actor.animationTime,before);stoppedFrames++;}
      if(packet.some(e=>e.type==='hit'&&e.actorId==='lk'))stops.push({...f.actor.sourceStopQueues.hit.at(-1)});
      if(f.actor.skillId===null)end=f.sim.state.time;
    }
    assert.ok(end);runs.push({end,endStep:f.sim.state.step,stoppedFrames,stops,hits:events.filter(e=>e.type==='hit'&&e.actorId==='lk').length});
  }
  assert.equal(runs[0].hits,1);assert.equal(runs[1].hits,0);
  assert.deepEqual(runs[0].stops,[{remaining:.5,sourceId:'target'}],'authored STOP_TIME_ATT remains exactly .5');
  assert.deepEqual(runs[1].stops,[]);
  // Original User31f902d0 deducts the whole f32 delta before its gate. The
  // .5 queue blocks29 updates at60Hz; update30 resumes with a full delta.
  assert.deepEqual(runs.map(row=>row.stoppedFrames),[29,0]);
  assert.equal(runs[0].endStep-runs[1].endStep,29);
  assert.ok(Math.abs(runs[1].end-(2.8-.28)/1.3)<2/60,'original period-transition end, authored ANIM_SPEED1.3');
});
test('Sonic skip uses strict animation >1.0 and the source pure-key domain',async()=>{
  const f=await fixture(21011,{gap:1600});cast(f);
  const input=k=>({held:new Set([k]),pressed:new Set()});
  for(const t of [.99,1]){f.actor.animationTime=t;lordKnightSkillEvent(f.sim,f.actor,input('RIGHT'));assert.equal(f.actor.skillId,21011);}
  f.actor.animationTime=1.01;lordKnightSkillEvent(f.sim,f.actor,input('AWAKEN'));assert.equal(f.actor.skillId,21011);
  lordKnightSkillEvent(f.sim,f.actor,input('RIGHT'));assert.equal(f.actor.skillId,null);assert.equal(f.actor.state,'RSI_WAIT');
});
for(const speed of [1,1.4])test(`Sonic held movement releases the recovery at source 1.0, speed ${speed}`,async()=>{
  const f=await fixture(21011,{gap:1600,speed});cast(f);let exit=null;
  for(let i=0;i<150;i++){
    f.sim.step(1/60,{lk:{held:['RIGHT']}});const packet=f.sim.drainEvents();
    if(packet.some(e=>e.type==='state'&&e.reason==='lk-sonic-source-skip'))exit=f.sim.state.time;
    if(f.actor.skillId===null){exit??=f.sim.state.time;break;}
  }
  assert.ok(exit);assert.ok(Math.abs(exit-1/(.85*speed))<2/60);
  f.sim.step(1/60,{lk:{held:['RIGHT']}});assert.ok(['RSI_WALK','RSI_DASH'].includes(f.actor.state));
});
test('Sonic without a cancel key still uses original animation-end successor',async()=>{
  const f=await fixture(21011,{gap:1600});cast(f);let end;
  for(let i=0;i<160;i++){f.sim.step(1/60,{});f.sim.drainEvents();if(f.actor.skillId===null){end=f.sim.state.time;break;}}
  assert.ok(Math.abs(end-(1.5333333333333334-.15333333333333335)/.85)<2/60);
});
