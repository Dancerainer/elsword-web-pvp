/** Real core + tiny authored-style line, no Native WASM, poses or renderer.
 * Exercises current Web timing/presentation receipts, not original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import gm from '../../packages/combat-core/gm-profile.json' with {type:'json'};
import ca from '../../packages/combat-core/ca-profile.json' with {type:'json'};
import de from '../../packages/combat-core/de-profile.json' with {type:'json'};
import {encodeOwnedState,validateOwnedState,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(profile=gm){
 const sim=createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[
  {id:'local',team:0,position:[0,0,0],lineId:0},{id:'remote',team:1,position:[5000,0,0],lineId:0}]});
 sim.drainEvents();return sim;
}
// Explicit original declarations, independent from the extension parser.
const cases=[
 [gm,'ESI_A_SGM_PROVOKE',[['SOUND_PLAY_EX:1','ElesisVoice_Provoke01.ogg',.001,'condition',[4]]]],
 [gm,'ESI_DASH_COMBO_SGM_XX_ATTACK',[
  ['SOUND_PLAY_EX:1','Elesis_SGM_XX_Attack1.ogg',.28,'condition',[2]],
  ['SOUND_PLAY_EX:2','ElesisVoice_Shout12.ogg',.43,'condition',[2]]]],
 [ca,'ESI_DASH_COMBO_SCA_XZ_CHARGE',[['SOUND_PLAY_EX:1','Elesis_Charging01.ogg',.1,'condition',[2]]]],
 [ca,'ESI_DASH_JUMP_COMBO_SDK_ZX_CHARGE',[['SOUND_PLAY_EX:1','Elesis_Charging01.ogg',.001,'condition',[2]]]],
 [ca,'SI_SA_SDK_BRANDISH_BREAKER_LOOP',[['STATE_SOUND_PLAY0','Elesis_BrandishiBreaker03.ogg',.01,'state',[]]]],
 [ca,'SI_SA_SDK_BURNING_PHANTOM_LOOP',[['STATE_SOUND_PLAY0','Elesis_BurningPhantom2.ogg',.001,'state',[]]]],
 [de,'ANSI_SA_ATT_VOID_FIELD_LOOP',[['STATE_SOUND_PLAY0','ADD_VOID_FIELD02.ogg',.001,'state',[]]]],
];
const extended=events=>events.filter(event=>event.type==='sound'&&event.actorId==='local'&&event.sourceNativeSound);
for(const [profile,state,expected]of cases)test(`${state}: original extended cues cross their time once with local presentation metadata`,()=>{
 const sim=fixture(profile),a=sim.actor('local');sim.enter(a,state,'audio-runtime-regression');
 assert.equal(a.state,state,'the actual declared state was entered');
 const entered=sim.drainEvents(),boundary=entered.find(event=>event.type==='stateChanged'&&event.actorId===a.id);
 assert.ok(Number.isInteger(boundary?.audioPresentationSerial));assert.deepEqual(extended(entered),[]);
 a.x=123;a.y=40;a.z=12;
 let before=0;const all=[];
 for(const [field,name,time,handleGroup,deleteConditions]of expected){
  const middle=(before+time)/2;
  sim.processStateEvents(a,before,middle);assert.deepEqual(extended(sim.drainEvents()),[],'not before original timer');
  sim.processStateEvents(a,middle,time);const sounds=extended(sim.drainEvents());
  assert.equal(sounds.length,1,field);const sound=sounds[0];all.push(sound);
  assert.equal(sound.field,field);assert.equal(sound.name,name);assert.equal(sound.onlyIfLocal,false);assert.equal(sound.native3D,true);
  assert.deepEqual(sound.sourcePosition,[123,40,12]);assert.equal(sound.soundPositionSource,'unit');
  assert.deepEqual(sound.sourceNativeSound,{handleGroup,deleteConditions,stateSerial:a.stateSerial,
   presentationSerial:boundary.audioPresentationSerial,field,loop:false});
  sim.processStateEvents(a,middle,time);assert.deepEqual(extended(sim.drainEvents()),[],'repeated interval does not refire');before=time;
 }
 sim.processStateEvents(a,0,Math.max(1,before));assert.deepEqual(extended(sim.drainEvents()),[],'overlapping later interval does not duplicate any cue');
 assert.equal(all.length,expected.length);assert.equal(a.sourceAudioPresentationSerial,boundary.audioPresentationSerial);
});

test('real broad frame keeps ordinary sounds before EX rows without time-sorting the native groups',()=>{
 const sim=fixture(),a=sim.actor('local');sim.enter(a,'ESI_A_SGM_PROVOKE','audio-order');sim.drainEvents();
 sim.processStateEvents(a,0,.5);
 const sounds=sim.drainEvents().filter(event=>event.type==='sound'&&event.actorId===a.id);
 assert.deepEqual(sounds.map(event=>event.field),['SOUND_PLAY0','SOUND_PLAY1','SOUND_PLAY_EX:1']);
 assert.deepEqual(sounds.map(event=>event.name),['Slash.ogg','Elesis_Provoke.ogg','ElesisVoice_Provoke01.ogg']);
 assert.equal(sounds[0].sourceNativeSound,undefined);assert.equal(sounds[1].sourceNativeSound,undefined);
});

test('predicted 40, accepted authority 35 and future 40 receive distinct increasing local audio stamps',()=>{
 const sim=fixture(),a=sim.actor('local');a.stateSerial=39;sim.enter(a,'ESI_A_SGM_PROVOKE','predicted');
 assert.equal(a.stateSerial,40);const predicted=a.sourceAudioPresentationSerial;
 assert.equal(sim.beginSourceAudioState(a),predicted,'same identity is idempotent');
 const authority=fixture(),owner=authority.actor('local');owner.stateSerial=34;authority.enter(owner,'ESI_A_SGM_PROVOKE','authority');
 const packet=encodeOwnedState(authority,owner.id,{epoch:1,frameSeq:35});
 applyOwnedState(sim,a.id,validateOwnedState(packet),{effects:false});
 assert.equal(a.stateSerial,35);assert.equal(a.sourceAudioPresentationSerial,predicted,'wire apply preserves receiver counter');
 const admitted=sim.beginSourceAudioState(a);assert.equal(admitted,predicted+1);assert.equal(sim.beginSourceAudioState(a),admitted);
 // The subsequent local controller gets the same numeric stateSerial as an
 // earlier prediction; its intervening accepted identity makes it a new cue.
 a.stateSerial=39;sim.enter(a,'ESI_A_SGM_PROVOKE','future');
 assert.equal(a.stateSerial,40);assert.equal(a.sourceAudioPresentationSerial,admitted+1);
 assert.equal(a.sourceAudioPresentationIdentity,a.state+':40');
 sim.drainEvents();sim.processStateEvents(a,0,.001);
 assert.equal(extended(sim.drainEvents())[0].sourceNativeSound.presentationSerial,admitted+1);
});

test('snapshot restore and identical core state/event input reproduce the same presentation stamps',()=>{
 const sim=fixture(),snapshot=sim.snapshot();
 function replay(){
  const a=sim.actor('local');sim.drainEvents();sim.enter(a,'ESI_A_SGM_PROVOKE','snapshot-replay');sim.processStateEvents(a,0,.001);
  sim.enter(a,'ESI_WAIT','snapshot-replay');
  return {serial:a.sourceAudioPresentationSerial,identity:a.sourceAudioPresentationIdentity,
   events:sim.drainEvents().filter(event=>event.type==='stateChanged'||event.sourceNativeSound).map(event=>({
    type:event.type,state:event.state,stateSerial:event.stateSerial,audioPresentationSerial:event.audioPresentationSerial,
    name:event.name,field:event.field,sourceNativeSound:event.sourceNativeSound}))};
 }
 const first=replay();sim.restore(snapshot);assert.deepEqual(replay(),first);
});

test('actual enter creates a new stamp even when source state and serial repeat, while default receipt is idempotent',()=>{
 const sim=fixture(),a=sim.actor('local');a.stateSerial=39;sim.enter(a,'ESI_A_SGM_PROVOKE','first-enter');
 const first=a.sourceAudioPresentationSerial,identity=a.sourceAudioPresentationIdentity;
 sim.drainEvents();a.stateSerial=39;sim.enter(a,'ESI_A_SGM_PROVOKE','accepted-controller-reenter');
 assert.equal(a.stateSerial,40);assert.equal(a.sourceAudioPresentationIdentity,identity);
 assert.equal(a.sourceAudioPresentationSerial,first+1,'real enter is a fresh playback boundary despite identical source identity');
 const event=sim.drainEvents().find(event=>event.type==='stateChanged'&&event.actorId===a.id);
 assert.equal(event.audioPresentationSerial,first+1);
 assert.equal(sim.beginSourceAudioState(a),first+1,'repeated default V0 receipt does not increment');
});

test('owner/critical encoding omits audio counters and validated malicious fields cannot overwrite receiver ownership',()=>{
 const sender=fixture(),receiver=fixture(),a=receiver.actor('local');
 const before={serial:a.sourceAudioPresentationSerial,identity:a.sourceAudioPresentationIdentity};
 sender.actor('local').sourceAudioPresentationSerial=999;
 sender.actor('local').sourceAudioPresentationIdentity='foreign:999';
 const packet=encodeOwnedState(sender,'local',{epoch:1,frameSeq:1});
 const keys=['sourceAudioPresentationSerial','sourceAudioPresentationIdentity'];
 for(const key of keys)assert.equal(Object.hasOwn(packet.actor,key),false);
 const action=encodeCriticalAction(packet,{id:1});
 for(const key of keys)assert.equal(Object.hasOwn(action.actor,key),false);
 applyOwnedState(receiver,a.id,validateOwnedState(packet),{effects:false});
 assert.equal(a.sourceAudioPresentationSerial,before.serial);assert.equal(a.sourceAudioPresentationIdentity,before.identity);
 const receive=report=>applyOwnedState(receiver,a.id,validateOwnedState(report),{effects:false});
 for(const key of keys){
  const injected=structuredClone(packet);injected.actor[key]=key.endsWith('Serial')?100000:'foreign:100000';
  assert.throws(()=>receive(injected),TypeError,'owner whitelist rejects local-only '+key);
  const critical=structuredClone(packet);critical.actions=[structuredClone(action)];critical.actions[0].actor[key]=injected.actor[key];
  assert.throws(()=>receive(critical),TypeError,'critical whitelist rejects local-only '+key);
  assert.equal(a.sourceAudioPresentationSerial,before.serial);assert.equal(a.sourceAudioPresentationIdentity,before.identity);
 }
});
