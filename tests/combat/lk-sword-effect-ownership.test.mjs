import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const fx=JSON.parse(readFileSync(new URL('../../contracts/lk-fx-index.json',import.meta.url)));
const map={sceneId:'sword-effect-ownership-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}]};
function fixture(){
  const sim=createSimulation({profile,map,preset:{loadout:Array(8).fill(null),guildPassives:[],passives:[]},
    actors:[{id:'lk',professionId:'LK',team:0,x:0,y:0,loadout:Array(8).fill(null)}]});
  return {sim,a:sim.actor('lk')};
}
function step(sim,count){for(let i=0;i<count;i++)sim.step(1/60,{});}
// Independent literal target2016 EffectSet/Particle declarations: only these
// four members per side are sustained. The entry flashes trigger for .1/.2s.
const bodies=mode=>[1,2,3,4].map(i=>`elswrod_${mode===2?'vitality':'demolition'}_0${i}`);
const liveBody=f=>f.sim.state.effects.filter(e=>bodies(2).includes(e.name)||bodies(-2).includes(e.name));
function wire(f,frameSeq){
  const report=validateOwnedState(JSON.parse(JSON.stringify(encodeOwnedState(f.sim,'lk',{epoch:1,frameSeq}))));
  validateOwnedReferences(report,f.a,profile,map);return report;
}
function assertMapped(f,names){
  assert.deepEqual(liveBody(f).map(e=>e.name).sort(),[...names].sort());
  const group=f.a.sourceWayOfSwordEffectGroup??[];
  assert.deepEqual(group.map(e=>e.name).sort(),[...names].sort());
  for(const entry of group)assert.ok(f.sim.state.effects.some(e=>e.id===entry.id&&e.name===entry.name));
}
for(const mode of [-2,2]){
  test(`sword ${mode}: original particle runtime finishes entry flashes and stops sustained bodies`,()=>{
    const runtime=createEffectRuntime({index:fx,quality:'high'}),set=profile.effectSets[`EffectSet_${mode===2?'Vigor':'Destruction'}Start`].raw;
    for(const [key,entry]of Object.entries(set))if(/^EFFECT\d+$/.test(key))runtime.add(entry.NAME,{position:[0,0,0]});
    for(let i=0;i<120;i++)runtime.step(1/60);
    assert.deepEqual([...runtime.emitters.values()].map(e=>e.name).sort(),bodies(mode).sort());
    assert.ok(runtime.count>0);assert.equal(runtime.notes.size,0);
    for(const id of runtime.emitters.keys())runtime.stop(id);
    for(let i=0;i<120;i++)runtime.step(1/60);
    assert.equal(runtime.emitters.size,0);assert.equal(runtime.count,0);
  });
  test(`sword ${mode}: delayed owner snapshots retain only source sustained bodies and remap every handle`,()=>{
    const owner=fixture(),peer=fixture(),names=bodies(mode);
    for(const name of names)assert.equal(profile.effectTemplates[name].fields.TriggerTime,mode===2?100000000:1000000000);
    owner.sim.prepareWayOfSword('lk',mode);
    // An unrelated receiver identity guarantees this does not accidentally
    // pass by retaining the sender's numeric handles verbatim.
    peer.sim.createEffect(peer.a,{NAME:'Counter_Particle01'});
    for(const [count,seq]of [[30,30],[90,120]]){
      step(owner.sim,count);const report=wire(owner,seq);
      assert.deepEqual(report.effects.map(e=>e.name).sort(),[...names].sort());
      applyOwnedState(peer.sim,'lk',report);assertMapped(peer,names);
      for(const e of peer.sim.state.effects)assert.notEqual(e.id,e.networkId);
      step(peer.sim,3);assertMapped(peer,names);
    }
    assert.ok(!peer.sim.state.effects.some(e=>e.name.includes('_wake_')),'one-shot entry flashes are not held or replayed');
  });
  for(const exit of ['neutral','opposite','death'])test(`sword ${mode}: delayed mapped handles stop on ${exit}`,()=>{
    const owner=fixture(),peer=fixture();owner.sim.prepareWayOfSword('lk',mode);step(owner.sim,120);
    peer.sim.createEffect(peer.a,{NAME:'Counter_Particle01'});
    applyOwnedState(peer.sim,'lk',wire(owner,120));peer.sim.drainEvents();
    const oldIds=peer.a.sourceWayOfSwordEffectGroup.map(e=>e.id);
    if(exit==='death'){owner.a.hp=0;owner.sim.enter(owner.a,'RSI_DIE_FRONT','ownership-death-test');}
    else owner.sim.prepareWayOfSword('lk',exit==='neutral'?0:-mode);
    const locallyEnded=owner.sim.drainEvents().filter(e=>e.type==='effectEnded'&&bodies(mode).includes(e.name));
    assert.deepEqual(locallyEnded.map(e=>e.name).sort(),bodies(mode).sort());
    step(owner.sim,30);applyOwnedState(peer.sim,'lk',wire(owner,150));
    assert.ok(oldIds.every(id=>!peer.sim.state.effects.some(e=>e.id===id)));
    const ended=peer.sim.drainEvents().filter(e=>e.type==='effectEnded'&&oldIds.includes(e.effectId));
    assert.deepEqual(ended.map(e=>e.effectId).sort((a,b)=>a-b),[...oldIds].sort((a,b)=>a-b));
    assertMapped(peer,exit==='opposite'?bodies(-mode):[]);
    step(peer.sim,3);assertMapped(peer,exit==='opposite'?bodies(-mode):[]);
    // Reapplying a newer report neither duplicates bodies nor restarts a tail.
    applyOwnedState(peer.sim,'lk',wire(owner,151));
    assertMapped(peer,exit==='opposite'?bodies(-mode):[]);
  });
}
