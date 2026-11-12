/** Lightweight production producer/consumer combination. Fixed synthetic
 * body points isolate world birth intent; no Native/GPU trajectory is claimed.
 * A newer passive checkpoint must not replay an old skill or its pending work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {startAddStarfall,startAddShootingChaser,attackAddStarfallCarrier} from '../../packages/combat-core/add-analysis-skills.mjs';
import {requestBloodCutterCarrier,tickBloodCutterRequests} from '../../packages/combat-core/elesis-blood-cutter.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';

const profiles=Object.fromEntries(['MM','CA'].map(id=>[id,JSON.parse(readFileSync(new URL('../../packages/combat-core/'+id.toLowerCase()+'-profile.json',import.meta.url)))]));
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},worldBone=a=>[a.x,a.y+80,a.z];
function fixture(profession='MM',receiver=false){
 const profile=profiles[profession],skills=profession==='MM'?[29016,29018]:[28023];
 const sim=createSimulation({profile,map,networkOwnerId:receiver?'local':'remote',preset:{passives:[],guildPassives:[]},actors:[
  {id:'remote',professionId:profession,team:0,x:receiver?-300:100,y:0,z:0,facing:receiver?-1:1,lineId:0,
   loadout:[...skills.map(skillId=>({skillId})),...Array(8-skills.length).fill(null)]},
  {id:'local',professionId:profession,team:1,x:600,y:0,z:0,lineId:0,loadout:Array(8).fill(null)}],
  effectAnchorSampler:(_e,a)=>({position:worldBone(a),rotation:[0,a.facing<0?180:0,0],facing:a.facing}),
  effectBoneSampler:e=>[...(e.currentAnchor??e.birthAnchor).position]});
 const a=sim.actor('remote'),local=sim.actor('local');return{sim,a,local,profile};
}
function cast(f,id,state){Object.assign(f.a,{skillId:id,skillScale:1.4,skillContext:{level:1,branchId:'none'}});f.sim.enter(f.a,state,'source-release');}
function action(f,frame=10,start=true){
 const report=validateOwnedState(encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:frame}));
 validateOwnedReferences(report,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
 const result=encodeCriticalAction(report,{id:frame,effectIds:new Set(report.effects.map(e=>e.id))});result.playback={version:1,start,held:[]};return result;
}
function reaction(f,frame=12){
 const report=encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:frame});Object.assign(report.actor,
  {state:'RSI_DAMAGE_AIR_UP',stateSerial:30,animationName:f.profile.states.RSI_DAMAGE_AIR_UP.animationName,
   animationTime:.1,stateTime:.1,animationPlaybackSpeed:1,animationStopped:false,grounded:false,y:200,vy:600,lineId:null,
   hitStop:0,worldStop:0,downForce:false,flyCount:1,lastAttackerFront:true});return encodeOwnedMotion(report,{includeReaction:true});
}
function checkpointThenBirth(receiver,sourceAction){
 const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(receiver.sim,'local',()=>1);
 const local=structuredClone(receiver.local),vitals={hp:receiver.a.hp,mp:receiver.a.mp,dp:receiver.a.sourceAdd?.dp,mutation:receiver.a.sourceAdd?.mutation};
 playback.receiveActions('remote',[sourceAction],1,sourceAction.frameSeq);playback.observeMotion(receiver.sim,'remote',reaction(receiver),'local');
 playback.beforeStep(receiver.sim,'local',()=>1);
 assert.equal(playback.diagnostics.reactionSuperseded,1);assert.equal(playback.diagnostics.expired,0);
 assert.equal(receiver.a.state,'RSI_DAMAGE_AIR_UP');assert.equal(receiver.a.stateSerial,30);
 assert.deepEqual(receiver.local,local);assert.deepEqual({hp:receiver.a.hp,mp:receiver.a.mp,dp:receiver.a.sourceAdd?.dp,mutation:receiver.a.sourceAdd?.mutation},vitals);
 return playback;
}

test('Starfall selected-target blast retains its explicit world birth after a newer passive checkpoint',()=>{
 const source=fixture(),receiver=fixture('MM',true);cast(source,29016,'ANSI_SA_AMM_INSTALLATION_STAR_FALL');
 startAddStarfall(source.sim,source.a);const carrier=source.sim.state.effects.find(e=>e.name==='DAMAGE_EFFECT_Star_Fall_Start_MESH');
 attackAddStarfallCarrier({sim:source.sim,owner:source.a,carrier,target:source.local,power:1.4});
 const packet=action(source),birth=packet.effects.find(e=>e.name==='DAMAGE_EFFECT_Star_Fall_Explode');
 assert.deepEqual(birth.birthAnchor.position,[600,80,0],'independent fixed target body point');
 checkpointThenBirth(receiver,packet);
 const received=receiver.sim.state.effects.find(e=>e.networkId===birth.id);assert.ok(received);
 assert.deepEqual(received.birthAnchor.position,[600,80,0]);assert.equal(received.birthAnchor.customPosition,true);
 assert.equal(receiver.a.sourceAddNative,undefined,'old StateStart/controller must not be replayed to obtain the birth');
});

test('Starfall placed carrier retains its released world position without restoring the old cast',()=>{
 const source=fixture(),receiver=fixture('MM',true);cast(source,29016,'ANSI_SA_AMM_INSTALLATION_STAR_FALL');startAddStarfall(source.sim,source.a);
 const packet=action(source),birth=packet.effects.find(e=>e.name==='DAMAGE_EFFECT_Star_Fall_Start_MESH');
 assert.deepEqual(birth.birthAnchor.position,[100,0,0]);checkpointThenBirth(receiver,packet);
 const received=receiver.sim.state.effects.find(e=>e.networkId===birth.id);assert.deepEqual(received.birthAnchor.position,[100,0,0]);
 assert.equal(received.birthAnchor.customPosition,true);assert.equal(receiver.a.sourceAddNative,undefined);
});

test('Chaser Bip01 release retains its original world point and facing through passive supersession',()=>{
 const source=fixture(),receiver=fixture('MM',true);cast(source,29018,'ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER');startAddShootingChaser(source.sim,source.a);
 const packet=action(source),birth=packet.effects.find(e=>e.name==='DamageEffect_AMM_Shooting_Chaser_Attacker');
 assert.deepEqual(birth.birthAnchor.position,[100,80,0]);assert.equal(birth.birthAnchor.facing,1);checkpointThenBirth(receiver,packet);
 const received=receiver.sim.state.effects.find(e=>e.networkId===birth.id);assert.deepEqual(received.birthAnchor.position,[100,80,0]);
 assert.equal(received.birthAnchor.facing,1);assert.equal(received.birthAnchor.customPosition,true);assert.equal(receiver.a.sourceAddNative,undefined);
});

test('Blood pending is never replayed after passive supersession; an already released carrier keeps its independent origin',()=>{
 const source=fixture('CA'),receiver=fixture('CA',true);cast(source,28023,'SI_SA_SCA_BLOOD_CUTTER');requestBloodCutterCarrier(source.sim,source.a);
 const pending=action(source);assert.ok(pending.actor.sourceElesisBloodCutterRequests?.length);
 const playback=checkpointThenBirth(receiver,pending);assert.equal(receiver.a.sourceElesisBloodCutterRequests,undefined);
 assert.equal(receiver.sim.state.effects.length,0);
 tickBloodCutterRequests(source.sim,source.a,.31);tickBloodCutterRequests(source.sim,source.a,.02);
 const released=action(source,13,false);assert.equal(released.actor.sourceElesisBloodCutterRequests,undefined);
 playback.receiveActions('remote',[released],1,13);
 // The later independent release keeps its ordinary ordered source offset;
 // give that short lane positive effect steps instead of forcing admission.
 for(let i=0;i<8&&!receiver.sim.state.effects.some(e=>e.sourceElesisBloodCutter);i++){
  playback.beforeStep(receiver.sim,'local',()=>1);receiver.sim.tickEffects(1/60);playback.afterStep(receiver.sim);
 }
 const received=receiver.sim.state.effects.find(e=>e.sourceElesisBloodCutter);assert.ok(received);
 assert.deepEqual(received.sourceElesisBloodCutter.origin,[100,0,0]);assert.deepEqual(received.currentAnchor.position,[100,105,0]);
 assert.equal(receiver.a.sourceElesisBloodCutterRequests,undefined);assert.equal(receiver.a.state,'RSI_DAMAGE_AIR_UP');
});

for(const skillId of [29016,29018])test(`already active MM ${skillId} controller survives a passive checkpoint without a new resource or skill action`,()=>{
 const receiver=fixture('MM',true);cast(receiver,skillId,skillId===29016?'ANSI_SA_AMM_INSTALLATION_STAR_FALL':'ANSI_SA_AMM_INSTALLATION_SHOOTING_CHASER');
 if(skillId===29016)startAddStarfall(receiver.sim,receiver.a);else startAddShootingChaser(receiver.sim,receiver.a);
 const before=receiver.a.sourceAddNative[0],resources={mp:receiver.a.mp,dp:receiver.a.sourceAdd.dp,mutation:receiver.a.sourceAdd.mutation};
 const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(receiver.sim,'local',()=>1);
 playback.observeMotion(receiver.sim,'remote',reaction(receiver),'local');playback.beforeStep(receiver.sim,'local',()=>1);
 assert.equal(receiver.a.sourceAddNative[0],before);assert.equal(receiver.a.state,'RSI_DAMAGE_AIR_UP');assert.equal(receiver.a.skillId,null);
 assert.deepEqual({mp:receiver.a.mp,dp:receiver.a.sourceAdd.dp,mutation:receiver.a.sourceAdd.mutation},resources);
});
