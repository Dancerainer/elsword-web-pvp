import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createCombatPlaybackProducer,combatPlaybackEffectSignature} from '../../packages/online/combat-playback.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'v55-producer-phase',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'source',seed:2016,preset:{passives:[],guildPassives:[]},
    actors:[{id:'source',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'target',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const source=sim.actor('source'),producer=createCombatPlaybackProducer({version:1});
  producer.capture(sim,'source',{epoch:1,frameSeq:1});
  const effect=sim.createEffect(source,{NAME:'DAMAGE_EFFECT_POWER_ASSAULT'},{clock:'custom',start:0});
  const birth=producer.capture(sim,'source',{epoch:1,frameSeq:2});
  assert.ok(birth.effects.some(e=>e.id===effect.id));
  return {sim,source,producer,effect};
}

test('a local NEXT-only change emits no reliable control and does not encode a source report',()=>{
  const f=fixture(),before=f.producer.diagnostics;
  f.effect.stage=1;
  const action=f.producer.capture(f.sim,'source',{epoch:1,frameSeq:3,getReport:()=>{throw Error('phase-only encoded a report');}});
  assert.equal(action,null);assert.equal(f.producer.diagnostics.controls,before.controls);
  assert.equal(f.producer.diagnostics.actions,before.actions);
});

test('logical effect edits still emit controls with the full canonical state after local NEXT changes',()=>{
  const f=fixture();f.effect.stage=1;
  assert.equal(f.producer.capture(f.sim,'source',{epoch:1,frameSeq:3}),null);
  f.effect.powerMultiplier=1.25;
  const changed=f.producer.capture(f.sim,'source',{epoch:1,frameSeq:4});
  assert.equal(changed.playback.start,false);assert.equal(changed.effects.length,1);
  assert.equal(changed.effects[0].id,f.effect.id);assert.equal(changed.effects[0].powerMultiplier,1.25);
  assert.equal(changed.effects[0].stage,1,'the full validated state contract still contains its source stage');
  f.effect.damage.ATTACK_TIME_START=.4;
  assert.equal(f.producer.capture(f.sim,'source',{epoch:1,frameSeq:5}).effects[0].id,f.effect.id);
});

test('STOP edges and actual terminals remain reliable when a same-frame generic NEXT changes',()=>{
  const f=fixture();f.effect.stage=1;f.source.hitStop=.1;
  const stop=f.producer.capture(f.sim,'source',{epoch:1,frameSeq:3});
  assert.ok(stop);assert.equal(stop.actor.hitStop,.1);assert.equal(stop.playback.start,false);
  assert.deepEqual(stop.effects,[],'the stop does not copy an unrelated clock-only effect');
  f.effect.dead=true;
  const terminal=f.producer.capture(f.sim,'source',{epoch:1,frameSeq:4});
  assert.equal(terminal.effects[0].id,f.effect.id);assert.equal(terminal.effects[0].dead,true);
});

// Signature-only checks name explicit logical controls; they do not claim
// original-client execution or synthesize gameplay expectations for a skill.
test('typed Phantom, aura and command phases remain distinct reliable effect controls',()=>{
  const original={name:'signature-fixture',stage:0,sourcePhantomSword:true,sourcePhantomAttackSerial:3,
    sourceContinuousAura:{version:1,revision:2,phase:'active'},
    sourceAddQuicksilverLink:{phase:'travel',group:5},sourceAddLockOn:{targetId:'one'},
    sourceAddMaximumStrike:{index:0,group:8}};
  const signature=combatPlaybackEffectSignature(original),clockOnly=structuredClone(original);clockOnly.stage=1;
  assert.equal(combatPlaybackEffectSignature(clockOnly),signature);
  for(const mutate of [e=>e.sourcePhantomAttackSerial++,e=>e.sourceContinuousAura.revision++,
    e=>e.sourceContinuousAura.phase='ended',e=>e.sourceAddQuicksilverLink.phase='impact',
    e=>e.sourceAddLockOn.targetId='two',e=>e.sourceAddMaximumStrike.index++]){
    const effect=structuredClone(original);mutate(effect);
    assert.notEqual(combatPlaybackEffectSignature(effect),signature);
  }
});
