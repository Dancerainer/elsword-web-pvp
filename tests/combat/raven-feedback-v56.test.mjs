/** Current Web regressions using target2016 pose/helper bytes. Source DD
 * expectations are independently authored in CHARACTER_NEXT_CONSUMERS_2016;
 * receipt routing and profession residency are Web defects, not native traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createProfessionSamplers} from '../../packages/combat-assets/profession-samplers.mjs';
import {compactPoseDocument} from '../../packages/combat-assets/compact-pose.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {ownedAttackKey} from '../../packages/online/owned-state.mjs';
import {positionNasodIdle,prepareNasodAttack} from '../../packages/combat-core/nasod-attack.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=file=>compactPoseDocument(JSON.parse(readFileSync(path.join(root,file),'utf8')));
const map={sceneId:'raven-feedback-v56-flat',lines:[{lineId:0,start:[-6000,0,0],end:[6000,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:file=>readFileSync(path.join(root,'artifacts/native',file))});
function assets(id){
 const folder=id.toLowerCase(),profile=read(`packages/combat-core/${folder}-profile.json`),manifest=read(`artifacts/${folder}/manifest.json`);
 const raw=read(`artifacts/${folder}/${manifest.runtimePose}`),pose=composeCharacterPose(raw,raw.sharedPose?read(path.posix.join('artifacts',folder,raw.sharedPose)):null);
 const templates=id==='RF'?read('artifacts/rf/effect-assets.json').templates:read(`artifacts/${folder}/fx/index.json`).templates;
 const core=templates.Raven_NasodBall;
 assert.ok(core?.poseData,'original core template is already deployed for '+id);
 const samplers=createNativeSamplers({profile,characterPose:pose,effectIndex:{templates:{Raven_NasodBall:core}},effectPoses:{[core.poseData]:read(path.posix.join('artifacts',folder,core.poseData))}});
 return {profile,samplers};
}
function make(id,loaded,{facing=1,network=false,gap=150}={}){
 const {profile}=loaded,samplers=createProfessionSamplers({[id]:loaded.samplers},id);
 const sim=createSimulation({profile,map,preset:{passives:[],guildPassives:[],attributes:{hpMax:800000}},networkOwnerId:network?'victim':null,
  actors:[{id:'attacker',professionId:id,team:0,position:[0,0,0],lineId:0,facing},{id:'victim',professionId:id,team:1,position:[gap*facing,0,0],lineId:0,facing:-facing}],
  ...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
 const a=sim.actor('attacker'),b=sim.actor('victim');
 for(const actor of [a,b]){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','v56-fixture');actor.presentationTransition=null;}
 sim.drainEvents();return {sim,a,b};
}
for(const id of ['BM','RF','VC'])test(id+' native two-stage66X retains two separate receiver receipts and authored big hitstun',()=>{
 const loaded=assets(id);
 assert.equal(loaded.profile.states.RSI_DASH_COMBO_X.raw.DAMAGEDATA_CHANGE_TIME,.63);
 assert.equal(loaded.profile.states.RSI_DASH_COMBO_X.raw.DAMAGE_DATA_NEXT.REACT_TYPE,2);
 assert.equal(loaded.profile.states.RSI_DASH_COMBO_X.raw.DAMAGE_DATA_NEXT.STOP_TIME_DEF,.35);
 for(const facing of [-1,1])for(const network of [false,true]){
  const {sim,a,b}=make(id,loaded,{facing,network}),consumer=createRemoteActionConsumer({clock:()=>0});
  if(network)consumer.remember(sim,'victim',()=>1);
  sim.enter(a,'RSI_DASH_COMBO_X','v56-source-action');a.presentationTransition=null;
  a.animationTime=.3;const firstKey=ownedAttackKey(sim.profileFor(a),a);
  sim.checkCharacterAttack(a,.28,.3);const hp=b.hp;
  assert.ok(hp<b.hpMax,id+' first authored helper hits');
  a.animationTime=.7;
  sim.checkCharacterAttack(a,.62,.7);assert.ok(b.hp<hp,id+' second authored helper is not swallowed by the first receipt');
  if(network)assert.notEqual(ownedAttackKey(sim.profileFor(a),a),firstKey);
  const hits=sim.drainEvents().filter(e=>e.type==='hit'&&e.targetId===b.id);
  assert.equal(hits.length,2);assert.deepEqual(hits.map(e=>e.data.DAMAGE.PHYSIC),[1.52,1]);
  assert.equal(hits[1].data.STOP_TIME_DEF,.35);assert.match(b.state,/RSI_DAMAGE_BIG_/);assert.equal(b.sourceStopQueues.hit.at(-1).remaining,Math.fround(.35));
  const after=b.hp;sim.checkCharacterAttack(a,.7,.7);assert.equal(b.hp,after,'same stage still deduplicates');
  consumer.clear();
 }
});
for(const id of ['BM','RF','VC'])test(id+' single-profession residency supplies actual AttackN core helpers, damage and reaction',()=>{
 const loaded=assets(id);
 for(const facing of [-1,1]){
  const {sim,a,b}=make(id,loaded,{facing,gap:150});a.awakening.remaining=10;
  Object.assign(a.core,{phase:'idle',level:2,gauge:40});
  positionNasodIdle(a.core,a,{direction:[1,0,0],rotation:[0,facing<0?180:0,0]},true);
  assert.equal(prepareNasodAttack(a.core,b.id,[0,facing<0?180:0,0]),true);
  assert.ok(sim.nasodAttackSampler(a.core,a).length>0,'actual Attack2 pose contains attack helpers without loading RF');
  for(let i=0;i<100;i++)sim.tickCore(a,1/120);
  const events=sim.drainEvents(),hits=events.filter(e=>e.type==='coreAttackHit');
  assert.ok(hits.length>0,id+' actual moving core hits target');assert.ok(b.hp<b.hpMax);assert.match(b.state,/RSI_DAMAGE_/);
  assert.equal(sim.state.unsupported.some(e=>e.id==='nasod-attack-pose'),false);
 }
});
test('a mixed profession room routes each core through its owner library',()=>{
 const calls=[],samplers=createProfessionSamplers(Object.fromEntries(['BM','RF','VC'].map(id=>[id,{nasodAttackSampler:core=>{calls.push([id,core]);return [id];}}])));
 for(const id of ['BM','RF','VC'])assert.deepEqual(samplers.nasodAttackSampler('core-'+id,{professionId:id}),[id]);
 assert.deepEqual(calls,[['BM','core-BM'],['RF','core-RF'],['VC','core-VC']]);
});
