/** Real mixed LK/IS recipient playback with explicit complete matrix inputs.
 * Matrices are dependency inputs, not measurements of an original client. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
const read=id=>JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)));
const profiles={LK:read('LK'),IS:read('IS')},map={sceneId:'v56-mixed-sheath',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,5,50,0,1];
function make(){return createSimulation({profile:profiles.LK,profiles,map,networkOwnerId:'lk',preset:{passives:[],guildPassives:[]},
 actors:[{id:'lk',professionId:'LK',team:0,position:[2000,0,0],lineId:0,loadout:Array(8).fill(null)},
 {id:'is',professionId:'IS',team:1,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)}]});}
for(const [following,sampleHand] of [[true,true],[true,false],[false,true]])
test(`valid IS sheath births retain complete visual anchors beside LK: following=${following} sampler=${sampleHand}`,()=>{
 const source=make(),receiver=make(),actor=source.actor('is'),playback=createRemoteCombatPlayback({clock:()=>0});
 const localAnchor={position:[30,60,0],rotation:[0,180,0],facing:-1,matrix:[...matrix]};localAnchor.matrix[12]=30;localAnchor.matrix[13]=60;
 if(sampleHand)receiver.effectAnchorSampler=({definition})=>definition.BONE_NAME==='Dummy2_Lhand'?structuredClone(localAnchor):null;
 playback.bind(receiver,'lk',()=>1);
 for(let frame=1;frame<=2;frame++){
  const anchor={position:[5,50,0],rotation:[0,0,0],facing:1,matrix:[...matrix]},effect=source.createEffect(actor,{NAME:'ElswordSheath02'},{birthAnchor:structuredClone(anchor)});
  Object.assign(effect,{sourceISSheath:true,sourceISSheathFollowing:following,sourcePosedAnchor:structuredClone(anchor),currentAnchor:structuredClone(anchor)});
  const report=encodeOwnedState(source,'is',{epoch:1,frameSeq:frame});
  const action=encodeCriticalAction(report,{id:frame,effectIds:new Set([effect.id])});action.playback={version:1,start:false,held:[]};
  report.actions=[action];validateOwnedState(report);validateOwnedReferences(report,actor,source.profileFor(actor),map,{actors:source.state.actors,profiles:source.profiles});
  assert.equal(playback.receiveActions('is',[action],1,frame),true);
  assert.doesNotThrow(()=>playback.beforeStep(receiver,'lk',()=>1));
  assert.doesNotThrow(()=>encodeOwnedState(receiver,'is',{epoch:1,frameSeq:frame}),'a valid remote visual must retain its required complete local anchors');
  const received=receiver.state.effects.find(e=>e.ownerId==='is'&&e.networkId===effect.id);
  assert.ok(received);assert.equal(received.damage,null,'the fallback matrix can never become remote damage authority');
  assert.deepEqual(received.sourcePosedAnchor,following&&sampleHand?localAnchor:anchor);
  assert.deepEqual(received.currentAnchor,received.sourcePosedAnchor);
 }
});
test('a forged LK sheath or an incomplete source matrix remains rejected',()=>{
 const sim=make(),a=sim.actor('is'),anchor={position:[5,50,0],rotation:[0,0,0],facing:1,matrix:[...matrix]},
  e=sim.createEffect(a,{NAME:'ElswordSheath02'},{birthAnchor:structuredClone(anchor)});
 Object.assign(e,{sourceISSheath:true,sourceISSheathFollowing:true,sourcePosedAnchor:structuredClone(anchor),currentAnchor:structuredClone(anchor)});
 const report=encodeOwnedState(sim,'is',{epoch:1,frameSeq:1}),bad=structuredClone(report);bad.effects[0].currentAnchor.matrix=[];
 assert.throws(()=>validateOwnedState(bad),/invalid-owner-is-sheath/);
 const wrong=structuredClone(report);delete wrong.actor.sourceInfinitySword;
 assert.throws(()=>validateOwnedReferences(wrong,sim.actor('lk'),sim.profileFor(sim.actor('lk')),map,{actors:sim.state.actors,profiles:sim.profiles}),/invalid-owner-is-sheath/);
});
