import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion,validateOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const map={sceneId:'motion-fixture-v38',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){
  const sim=createSimulation({profile,map,networkOwnerId:'local',seed:2016,preset:{passives:[],guildPassives:[]},actors:[
    {id:'remote',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
    {id:'local',team:1,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}
  sim.networkCombatPlaybackVersion=1;
  const playback=createRemoteCombatPlayback({clock:()=>sim.state.time*1000});playback.bind(sim,'local',()=>1);
  const report=(frame,fields={})=>{const value=encodeOwnedState(sim,'remote',{epoch:1,frameSeq:frame});Object.assign(value.actor,fields);return value;};
  const reaction=(frame,state='RSI_DAMAGE_AIR_UP',fields={})=>{const r=report(frame,{state,stateSerial:30,animationName:profile.states[state].animationName,
    animationTime:.1,stateTime:.1,animationPlaybackSpeed:1,animationStopped:false,grounded:false,y:200,vy:600,lineId:null,
    hitStop:0,worldStop:0,downForce:false,flyCount:1,lastAttackerFront:true,...fields});return encodeOwnedMotion(r,{includeReaction:true});};
  const step=()=>{playback.beforeStep(sim,'local',()=>1);sim.step(1/60,{...playback.remoteInputs(sim,'local'),local:{held:[],pressed:[],released:[]}});playback.afterStep(sim);};
  return {sim,playback,report,reaction,step};
}
test('v2 passive reaction checkpoint bypasses blocked controls, cannot alter local vitals or create damage',()=>{
  const f=fixture(),local=structuredClone(f.sim.actor('local')),motion=f.reaction(20);
  assert.ok(motion.reaction);assert.equal(encodeOwnedMotion(f.report(21)).reaction,undefined,'v1 encoding remains unchanged');
  assert.equal(f.playback.observeMotion(f.sim,'remote',motion,'local'),true);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').state,'RSI_DAMAGE_AIR_UP');assert.equal(f.sim.actor('remote').stateTime,.1);
  assert.equal(f.sim.actor('remote').y,200);assert.deepEqual(f.sim.actor('local'),local);assert.equal(f.sim.state.effects.length,0);
  for(const state of ['RSI_COMBO_Z','RSI_DAMAGE_REVENGE'])assert.throws(()=>validateOwnedMotion({...motion,reaction:{...motion.reaction,state}}),/reaction/);
  assert.throws(()=>validateOwnedMotion({...motion,reaction:{...motion.reaction,hp:0}}),/reaction/);
});
test('old reliable reaction or pre-hit attack cannot rewind a newer owner checkpoint',()=>{
  const f=fixture(),old=encodeCriticalAction(f.report(10,{state:'RSI_COMBO_Z',stateSerial:20,animationName:profile.states.RSI_COMBO_Z.animationName}),{id:10});
  old.playback={version:1,start:true,held:['X']};
  f.playback.receiveActions('remote',[old],1,10);f.playback.observeMotion(f.sim,'remote',f.reaction(20),'local');f.step();
  assert.equal(f.sim.actor('remote').state,'RSI_DAMAGE_AIR_UP');assert.equal(f.playback.diagnostics.reactionSuperseded,1);
  assert.equal(f.sim.state.effects.length,0);assert.deepEqual(f.playback.remoteInputs().remote.held,[]);
  const before=f.sim.actor('remote').animationTime;f.playback.observeMotion(f.sim,'remote',f.reaction(21),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.ok(f.sim.actor('remote').animationTime>=before,'same controller clock never rewinds');
});
test('newer reliable attack wins over a delayed passive checkpoint, and new life discards checkpoint floor',()=>{
  const f=fixture(),attack=encodeCriticalAction(f.report(40,{state:'RSI_COMBO_Z',stateSerial:40,animationName:profile.states.RSI_COMBO_Z.animationName}),{id:40});attack.playback={version:1,start:true,held:[]};
  f.playback.receiveActions('remote',[attack],1,40);f.step();
  const before=structuredClone(f.sim.actor('remote'));
  assert.equal(f.playback.observeMotion(f.sim,'remote',f.reaction(30),'local'),false);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').state,'RSI_COMBO_Z');assert.equal(f.playback.diagnostics.reactionCheckpoints,0);
  for(const field of ['x','y','vx','vy','grounded','lineId'])assert.equal(f.sim.actor('remote')[field],before[field],field);
  f.playback.reset('remote',2);assert.equal(f.playback.observeMotion(f.sim,'remote',f.reaction(41),'local'),false);
});
test('a queued motion checkpoint cannot overwrite a newer controller consumed in the same step',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.reaction(30,'RSI_DAMAGE_SMALL_FRONT',{grounded:true,y:0,vy:0,lineId:0}),'local');
  const action=encodeCriticalAction(f.report(40,{state:'RSI_JUMP_COMBO_X',stateSerial:40,animationName:profile.states.RSI_JUMP_COMBO_X.animationName,grounded:false,vy:600}),{id:40});
  action.playback={version:1,start:true,held:[]};f.playback.receiveActions('remote',[action],1,40);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').state,'RSI_JUMP_COMBO_X');assert.equal(f.sim.actor('remote').grounded,false);assert.equal(f.sim.actor('remote').vy,600);
});
test('three fresh separated motion endpoints release a stale crossing without dragging the local actor',()=>{
  const f=fixture();f.sim.actor('local').x=100;const local=structuredClone(f.sim.actor('local'));
  for(const frame of [1,4,7]){const motion=encodeOwnedMotion(f.report(frame,{x:250,vx:0}));f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);}
  assert.equal(f.playback.diagnostics.motionCrossingRecovered,1);assert.equal(f.sim.actor('remote').x,250);assert.deepEqual(f.sim.actor('local'),local);
  const duplicate=encodeOwnedMotion(f.report(7,{x:-250}));assert.equal(f.playback.observeMotion(f.sim,'remote',duplicate,'local'),false);
});
test('overlapping endpoint and alternating sides never authorize body crossing recovery',()=>{
  const f=fixture();f.sim.actor('local').x=100;
  for(let frame=1;frame<=24;frame+=3){f.playback.observeMotion(f.sim,'remote',encodeOwnedMotion(f.report(frame,{x:frame%2?105:250})),'local');f.playback.beforeStep(f.sim,'local',()=>1);}
  assert.equal(f.playback.diagnostics.motionCrossingRecovered,0);assert.ok(f.sim.actor('remote').x<100);
});
test('air checkpoint uses bounded passive gravity only; stop clocks prevent projection',()=>{
  for(const stopped of [false,true]){
    const f=fixture();f.playback.observeMotion(f.sim,'remote',f.reaction(1),'local');f.playback.beforeStep(f.sim,'local',()=>1);
    for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
    f.playback.observeMotion(f.sim,'remote',f.reaction(5,'RSI_DAMAGE_AIR_UP',{hitStop:stopped?1:0}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
    assert.equal(f.playback.diagnostics.airMotionProjected,stopped?0:1);if(!stopped)assert.ok(f.sim.actor('remote').vy<600);
  }
});
test('partial hit-stop is aged once together with bounded passive air projection',()=>{
  const f=fixture();f.playback.observeMotion(f.sim,'remote',f.reaction(1),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  for(let i=0;i<12;i++)f.playback.beforeStep(f.sim,'local',()=>1);
  f.playback.observeMotion(f.sim,'remote',f.reaction(5,'RSI_DAMAGE_AIR_UP',{hitStop:.05,worldStop:.025}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(f.sim.actor('remote').hitStop,0);assert.equal(f.sim.actor('remote').worldStop,0);assert.ok(f.sim.actor('remote').vy<600);
});
test('passive StateStart cannot debit owner MP or overwrite independently received Buff/protection',async()=>{
  const read=url=>JSON.parse(readFileSync(new URL(url,import.meta.url)));
  const nativeMap={...read('../../artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('../../artifacts/scene/sander-garpai-rock-pvp/collision.json')};
  const native=await createNativeRuntime({manifest:read('../../artifacts/native/manifest.json'),map:nativeMap,
    loadBinary:file=>readFileSync(new URL('../../artifacts/native/'+file,import.meta.url))});
  const f=fixture(),actor=f.sim.actor('remote');f.sim.nativeManaBreak=native.manaBreak;
  actor.mp=300;Object.assign(actor.manaBreak,{active:true,pendingCost:120,charge:120});
  Object.assign(actor,{invincible:true,superArmor:true,superArmorNotRed:true,skillSuperArmorNotRed:true,forceInvincible:.8});
  const protectedBefore=structuredClone({buffs:actor.buffs,buffControls:actor.buffControls,showInvincible:actor.showInvincible});
  f.playback.observeMotion(f.sim,'remote',f.reaction(10,'RSI_DAMAGE_DOWN_FRONT',{grounded:true,y:0,vy:0,lineId:0}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(actor.mp,300);assert.equal(actor.hp,50000);assert.equal(actor.manaBreak.active,false,'native state cleanup actually executed');
  assert.equal(actor.invincible,true);assert.equal(actor.superArmor,true);assert.equal(actor.skillSuperArmorNotRed,true);assert.equal(actor.forceInvincible,.8);
  assert.deepEqual({buffs:actor.buffs,buffControls:actor.buffControls,showInvincible:actor.showInvincible},protectedBefore);
});
test('fresh walking motion replaces a stale wait controller without waiting for ordered start',()=>{
  const f=fixture(),motion=encodeOwnedMotion(f.report(10,{state:'RSI_WALK',stateSerial:10,animationName:profile.states.RSI_WALK.animationName,
    stateTime:.2,animationTime:.2,vx:466,animationPlaybackSpeed:1}),{held:['RIGHT'],includeReaction:true});
  assert.ok(motion.locomotion);f.playback.observeMotion(f.sim,'remote',motion,'local');f.step();
  assert.equal(f.sim.actor('remote').state,'RSI_WALK');assert.ok(f.sim.actor('remote').vx>100);
  assert.equal(f.playback.diagnostics.locomotionCheckpoints,1);
});
test('first checkpoint for an already reached passive phase does not re-enter or rewind its native clock',()=>{
  const f=fixture(),actor=f.sim.actor('remote');
  f.playback.observeMotion(f.sim,'remote',f.reaction(10,'RSI_DAMAGE_AIR_UP',{stateSerial:4}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  f.sim.enter(actor,'RSI_DAMAGE_AIR_FALL','native-passive-transition');
  Object.assign(actor,{stateSerial:5,stateTime:2/60,animationTime:2/60});
  const motion=f.reaction(11,'RSI_DAMAGE_AIR_FALL',{stateSerial:5,stateTime:0,animationTime:0});
  f.playback.observeMotion(f.sim,'remote',motion,'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(actor.stateTime,2/60);assert.equal(actor.animationTime,2/60);assert.equal(actor.stateSerial,5);
});
test('fresh independent projectiles survive superseded caster state; state-bound births stay retired',()=>{
  for(const deletes of [[],[0],[1],[2],[5]]){
    const f=fixture(),sender=fixture(),remote=f.sim.actor('remote');
    const effect=sender.sim.createEffect(sender.sim.actor('remote'),{TYPE:'DT_NORMAL',NAME:'DamageEffect_ELK_Wind_Slicer_Projectile'},{deleteConditions:deletes});
    const source=sender.report(10);source.effects=source.effects.filter(row=>row.id===effect.id);
    assert.equal(source.effects.length,1);
    const action=encodeCriticalAction(source,{id:10,effectIds:new Set([effect.id])});action.playback={version:1,start:true,held:[]};
    assert.equal(action.effects.length,1);
    f.playback.receiveActions('remote',[action],1,10);f.playback.observeMotion(f.sim,'remote',f.reaction(20),'local');f.playback.beforeStep(f.sim,'local',()=>1);
    assert.equal(f.sim.state.effects.filter(row=>!row.dead).length,deletes.some(value=>[1,2,5].includes(value))?0:1,'delete flags '+deletes);
    assert.equal(remote.state,'RSI_DAMAGE_AIR_UP');
  }
});
test('a confirmed passive controller cannot return through motion or reliable start after Native leaves it',()=>{
  const f=fixture(),actor=f.sim.actor('remote');
  f.playback.observeMotion(f.sim,'remote',f.reaction(10,'RSI_DAMAGE_AIR_UP',{stateSerial:4}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  f.sim.enter(actor,'RSI_DAMAGE_AIR_FALL','native-apex');Object.assign(actor,{stateTime:.2,animationTime:.2,y:180,vy:-120});f.playback.afterStep(f.sim);
  assert.equal(f.playback.observeMotion(f.sim,'remote',f.reaction(11,'RSI_DAMAGE_AIR_UP',{stateSerial:4,y:220,vy:600}),'local'),false);
  const action=encodeCriticalAction(f.report(12,{state:'RSI_DAMAGE_AIR_UP',stateSerial:4,animationName:profile.states.RSI_DAMAGE_AIR_UP.animationName,vy:600}),{id:12});
  action.playback={version:1,start:true,held:[]};f.playback.receiveActions('remote',[action],1,12);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(actor.state,'RSI_DAMAGE_AIR_FALL');assert.equal(actor.stateSerial,5);assert.equal(actor.animationTime,.2);assert.equal(actor.y,180);assert.equal(actor.vy,-120);
  // Local prediction serials are not source authority. A genuinely new source
  // hit must remain eligible even after this observer has predicted farther.
  f.sim.enter(actor,'RSI_DAMAGE_DOWN_FRONT','native-landing');f.sim.enter(actor,'RSI_WAIT','native-finished');assert.equal(actor.stateSerial,7);
  assert.equal(f.playback.observeMotion(f.sim,'remote',f.reaction(13,'RSI_DAMAGE_AIR_UP',{stateSerial:5}),'local'),true);f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(actor.state,'RSI_DAMAGE_AIR_UP');assert.equal(actor.stateSerial,5);
  f.playback.reset('remote',2);f.playback.bind(f.sim,'local',()=>2);
  assert.equal(f.playback.observeMotion(f.sim,'remote',{...f.reaction(1,'RSI_DAMAGE_AIR_UP',{stateSerial:4}),epoch:2},'local'),true);
});
test('forward source state time cannot rewind an independently advanced passive animation clock',()=>{
  const f=fixture(),actor=f.sim.actor('remote');f.playback.observeMotion(f.sim,'remote',f.reaction(10),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  Object.assign(actor,{stateTime:.1167,animationTime:.10219298});
  f.playback.observeMotion(f.sim,'remote',f.reaction(11,'RSI_DAMAGE_AIR_UP',{stateTime:.1333,animationTime:.10166667}),'local');f.playback.beforeStep(f.sim,'local',()=>1);
  assert.equal(actor.stateTime,.1333);assert.equal(actor.animationTime,.10219298);
});
