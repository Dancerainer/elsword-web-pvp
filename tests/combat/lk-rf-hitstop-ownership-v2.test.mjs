/** Mixed-profession host regressions. Source flag literals are independent:
 * RF COMBO_XX X=>1; target LK COMBO_X2 EVENT_PROCESS_TIME2 X=>4.
 * Neither short-edge retention adapter is a target-client input recording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const nativeRoot=process.env.LK_NATIVE_FIXTURE_ROOT??root;
const read=path=>JSON.parse(readFileSync(resolve(root,path)));
const profiles={RF:read('packages/combat-core/rf-profile.json'),LK:read('packages/combat-core/lk-profile.json')};
const map={sceneId:'mixed-hitstop-flags',lines:[{lineId:0,start:[-4000,0,0],end:[4000,0,0]}]};
const native=await createNativeRuntime({manifest:JSON.parse(readFileSync(resolve(nativeRoot,'artifacts/native/manifest.json'))),map,
  loadBinary:path=>readFileSync(resolve(nativeRoot,'artifacts/native',path))});
const packet=(pressed=[],released=[])=>({sampledDevice:true,pressed,held:pressed,released});
function make(defaultProfession,rfEnabled,lkEnabled,{defaultEnabled=!rfEnabled}={}){
  const calls=[];
  const commands={...native.commands,runEvent(actor,keys,profile,...args){
    assert.equal(actor.professionId,'RF','LK must never probe Raven callbacks during stop or replay');
    assert.equal(profile.target.unitClass,107,'an LK-default browser must still give RF its own declaration');
    calls.push({id:actor.id,state:actor.state,flags:actor.sourceCommandFlags});
    return native.commands.runEvent(actor,keys,profile,...args);
  }};
  // The actor-specific registry is authoritative. Catch an accidental return
  // to the old global nativeCommands path, even when both bridges are present.
  const globalCommands={...native.commands,runEvent(){throw new Error('Wrong global command bridge selected');}};
  const preset=enabled=>({sampledComboStopLatch:enabled,passives:[],guildPassives:[],loadout:Array(8).fill(null)});
  const sim=createSimulation({profile:profiles[defaultProfession],profiles,map,seed:2016,preset:preset(defaultEnabled),
    presets:{RF:preset(rfEnabled),LK:preset(lkEnabled)},nativeCommands:globalCommands,nativeCommandsByProfession:{RF:commands},
    actors:[{id:'rf',professionId:'RF',team:0,x:-1000,y:0,lineId:0,facing:1},
      {id:'lk',professionId:'LK',team:1,x:1000,y:0,lineId:0,facing:1}]});
  return {sim,calls,rf:sim.actor('rf'),lk:sim.actor('lk')};
}
function freeze(f,state='RSI_COMBO_XX',time=.2){
  for(const a of [f.rf,f.lk]){f.sim.enter(a,state,'independent-hitstop-boundary');a.animationTime=time;a.hitStop=.04;}
  f.calls.length=0;f.sim.drainEvents();
}
function stepBoth(f,input){f.sim.step(1/60,{rf:input,lk:input});}

for(const defaultProfession of ['RF','LK'])for(const rfEnabled of [false,true])for(const lkEnabled of [false,true])
test(`${defaultProfession} default: RF latch ${rfEnabled}, LK diagnostic flag ${lkEnabled} preserves separate XX flags`,()=>{
  const f=make(defaultProfession,rfEnabled,lkEnabled);freeze(f);
  stepBoth(f,packet(['X']));
  assert.equal(f.rf.sourceCommandFlags,0);assert.equal(f.lk.sourceCommandFlags,0,'a frozen packet does not run LK EventProcess');
  assert.equal(f.rf.comboStopInput?.flags??null,rfEnabled?1:null);
  assert.equal(f.lk.comboStopInput,null);assert.deepEqual(f.lk.pendingPressed,['X']);assert.deepEqual(f.rf.pendingPressed,[]);
  assert.equal(f.calls.length,rfEnabled?2:0,'only RF enabled capture performs acceptance/composition probes');
  stepBoth(f,packet([],['X']));stepBoth(f,packet());
  assert.equal(f.rf.sourceCommandFlags,rfEnabled?1:0);assert.equal(f.lk.sourceCommandFlags,4);
  assert.equal(f.rf.comboStopInput,null);assert.equal(f.lk.comboStopInput,null);assert.deepEqual(f.lk.pendingPressed,[]);
  const events=f.sim.drainEvents().filter(e=>e.type.startsWith('comboStopInput'));
  assert.deepEqual(events.map(e=>[e.type,e.actorId]),rfEnabled?[['comboStopInputLatched','rf'],['comboStopInputReplayed','rf']]:[]);
  for(const actor of [f.rf,f.lk]){const wire=encodeOwnedState(f.sim,actor.id);validateOwnedState(wire);
    assert.equal(Object.hasOwn(wire.actor,'comboStopInput'),false,'local device cache remains outside owner projection');}
});

for(const defaultProfession of ['RF','LK'])test(`${defaultProfession} default: invalid LK ZZ X never inherits the valid RF ZZ X bit`,()=>{
  const f=make(defaultProfession,true,true);freeze(f,'RSI_COMBO_ZZ',.1);
  stepBoth(f,packet(['X']));assert.equal(f.rf.comboStopInput.flags,2);assert.equal(f.lk.comboStopInput,null);
  stepBoth(f,packet([],['X']));stepBoth(f,packet());
  assert.equal(f.rf.sourceCommandFlags,2);assert.equal(f.lk.sourceCommandFlags,0);
});

test('mixed stopped snapshot restores in the opposite-default browser and consumes each profession input once',()=>{
  const source=make('RF',true,false),receiver=make('LK',true,false);freeze(source);
  stepBoth(source,packet(['X']));const captured=JSON.parse(JSON.stringify(source.sim.snapshot()));receiver.sim.restore(captured);
  assert.equal(receiver.sim.actor('rf').comboStopInput.flags,1);assert.deepEqual(receiver.sim.actor('lk').pendingPressed,['X']);
  for(let i=0;i<30;i++){
    const input=i===0?packet([],['X']):packet();stepBoth(source,input);stepBoth(receiver,input);
    assert.deepEqual(JSON.parse(JSON.stringify(receiver.sim.snapshot())),JSON.parse(JSON.stringify(source.sim.snapshot())));
  }
  const replay=source.sim.drainEvents().filter(e=>e.type==='comboStopInputReplayed');
  assert.deepEqual(replay.map(e=>e.actorId),['rf']);
});
