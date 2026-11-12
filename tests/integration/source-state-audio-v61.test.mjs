import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {createSourceStateAudio} from '../../apps/web/source-state-audio-v61.mjs';
import {createOwnedPresentation} from '../../apps/web/owned-presentation.mjs';
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';
import {getSourceExtendedSoundEntries} from '../../packages/combat-core/source-extended-sound-v61.mjs';

const gm=JSON.parse(readFileSync(new URL('../../packages/combat-core/gm-profile.json',import.meta.url)));
const ca=JSON.parse(readFileSync(new URL('../../packages/combat-core/ca-profile.json',import.meta.url)));
function fixture(){
 const media=[],errors=[];let generation=1;
 const player=createBattleAudio({storage:null,localActorId:()=> 'a',onError:error=>errors.push(error),createAudio:url=>{
  const audio={url,volume:0,currentTime:0,plays:0,pauses:0,play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;},removeAttribute(){},load(){}};
  media.push(audio);return audio;
 }});
 const files=Object.fromEntries(['same.ogg','ElesisVoice_Provoke01.ogg','Elesis_Charging01.ogg'].map(name=>[name,{file:name}]));
 player.configure({manifest:{files}});player.setListenerPosition([0,0,0]);
 const router=createSourceStateAudio({player,generationForActor:()=>generation,rawForState:(_id,state)=>gm.states[state]?.raw??{}});
 const state=(serial,state='wait',actorId='a',presentationSerial)=>router.event({type:'stateChanged',actorId,state,stateSerial:serial,
  ...(presentationSerial===undefined?{}:{audioPresentationSerial:presentationSerial})});
 const cue=(serial,handleGroup,deleteConditions=[],name='same.ogg',actorId='a',presentationSerial)=>router.event({type:'sound',actorId,name,
  ...sourceSoundEventMetadata({x:0,y:0,z:0}),sourceNativeSound:{handleGroup,deleteConditions,stateSerial:serial,field:'fixture',
   ...(presentationSerial===undefined?{}:{presentationSerial})}});
 return {player,router,state,cue,media,errors,nextLife(){generation++;}};
}

test('Web state boundary stops state channels and condition 2 while custom Provoke survives until its declared Revenge',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 f.state(1,'ESI_A_SGM_PROVOKE');
 f.cue(1,'condition',[4],'ElesisVoice_Provoke01.ogg');f.cue(1,'condition',[2]);f.cue(1,'state');
 f.state(2);assert.equal(f.player.proof().active,1);assert.equal(f.media[0].pauses,0);
 assert.equal(gm.states.ESI_A_SGM_PROVOKE_REVENGE.raw.CUSTOM_STATE_DELETE_SOUND,1);
 f.state(3,'ESI_A_SGM_PROVOKE_REVENGE');assert.equal(f.player.proof().active,0);assert.equal(f.media[0].pauses,1);
 assert.equal(f.cue(1,'condition',[4],'ElesisVoice_Provoke01.ogg'),false,'late Ready cue cannot restart after its custom clear');
 assert.deepEqual(f.errors,[]);
});

test('duplicate and delayed state receipts cannot stop the current cue or another actor',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 f.state(10);f.cue(10,'state');f.cue(10,'condition',[2]);f.cue(10,'condition',[2],'same.ogg','b');
 assert.equal(f.state(10),false);assert.equal(f.state(9),false);assert.equal(f.player.proof().active,3);
 f.state(11);assert.equal(f.player.proof().active,1,'other actor retains its independent same-file channel');
 f.cue(11,'state');assert.equal(f.cue(10,'state'),false);assert.equal(f.cue(10,'condition',[2]),false);
 assert.equal(f.player.proof().active,2);
 // A new cue can already exist when a delayed boundary is presented. The
 // serial filter must leave this newer instance alone.
 f.cue(20,'state');f.state(12);assert.equal(f.player.proof().active,2);
});

test('new ownership generation and clean reset allow lower serials while closing the old managed voices',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 f.state(40);f.cue(40,'state');f.cue(40,'condition',[4]);
 f.nextLife();assert.equal(f.state(1),true);assert.equal(f.player.proof().active,0);
 assert.equal(f.cue(1,'state'),true);f.player.stop();f.router.clear();
 assert.equal(f.state(0),true);assert.equal(f.cue(0,'state'),true);
});

test('local presentation receipts distinguish a rebased controller from a delayed predicted or future real source serial40',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 f.state(40,'wait','a',7);f.cue(40,'state',[],'same.ogg','a',7);f.cue(40,'condition',[4],'same.ogg','a',7);
 f.cue(40,'condition',[2],'same.ogg','b',7);
 assert.equal(f.state(35,'wait','a',8),true);
 assert.equal(f.player.proof().active,1,'a replaced prediction retires both owned groups, leaving the other actor alone');
 assert.equal(f.cue(35,'state',[],'same.ogg','a',8),true);
 assert.equal(f.state(40,'wait','a',7),false,'a late old predicted boundary cannot clear authority35');
 assert.equal(f.cue(40,'state',[],'same.ogg','a',7),false);
 assert.equal(f.cue(40,'condition',[4],'same.ogg','a',7),false);
 assert.equal(f.player.proof().active,2);
 assert.equal(f.state(40,'wait','a',9),true,'a future real source40 has its own fresh local receipt');
 assert.equal(f.player.proof().active,1);
 assert.equal(f.cue(40,'state',[],'same.ogg','a',9),true);
 assert.equal(f.state(35,'wait','a',8),false);assert.equal(f.state(40,'wait','a',9),false);
 assert.equal(f.cue(35,'state',[],'same.ogg','a',8),false);assert.equal(f.player.proof().active,2);
});

test('a delayed replacement boundary keeps cues already playing in its own or a newer presentation',t=>{
 const f=fixture();t.after(()=>f.player.dispose());f.state(40,'wait','a',7);
 for(const [group,conditions] of [['state',[]],['condition',[2]],['condition',[4]]]){
  f.cue(40,group,conditions,'same.ogg','a',7);
  f.cue(35,group,conditions,'same.ogg','a',8);
 }
 f.cue(36,'state',[],'same.ogg','a',9);
 assert.equal(f.state(35,'wait','a',8),true);
 assert.equal(f.player.proof().active,4,'only the three replaced prediction voices retire');
 assert.deepEqual(f.media.map(audio=>audio.pauses),[1,0,1,0,1,0,0]);
 assert.equal(f.state(35,'wait','a',8),false);assert.equal(f.player.proof().active,4);
});

test('two CA actors keep independent same-file charge cues and only the actor leaving its state is stopped',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 const raw=ca.states.ESI_DASH_COMBO_SCA_XZ_CHARGE.raw;
 const [entry]=getSourceExtendedSoundEntries(raw);assert.equal(entry.name,'Elesis_Charging01.ogg');
 f.state(4);f.cue(4,entry.nativeHandleGroup,entry.deleteConditions,entry.name);
 f.cue(4,entry.nativeHandleGroup,entry.deleteConditions,entry.name,'b');
 assert.equal(f.player.proof().active,2,'independent source requests are not filename-deduplicated');
 f.state(5);assert.equal(f.player.proof().active,1);assert.deepEqual(f.media.map(audio=>audio.plays),[1,1]);
 assert.deepEqual(f.media.map(audio=>audio.pauses),[1,0]);
});

test('malformed presentation stamps and native conditions cannot play a cue or retire a valid current channel',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 f.state(4,'wait','a',10);f.cue(4,'state',[],'same.ogg','a',10);
 for(const invalid of [NaN,-1,1.5,'11',Number.MAX_SAFE_INTEGER+1]){
  assert.equal(f.state(5,'wait','a',invalid),false);
  assert.equal(f.cue(5,'state',[],'same.ogg','a',invalid),false);
 }
 assert.equal(f.cue(5,'unknown',[],'same.ogg','a',11),false);
 assert.equal(f.cue(5,'condition',[6],'same.ogg','a',11),false);
 assert.equal(f.player.proof().active,1);assert.equal(f.media[0].pauses,0);
});

test('V0 owned presentation catches extension fired fields once and emits no old-state boundary during historical collision',()=>{
 const events=[],cues=[],presentation=createOwnedPresentation();
 const local={id:'local'},remote={id:'remote',state:'charge',stateSerial:2,animationTime:.2,fired:['SOUND_PLAY_EX:1'],soundSet:null};
 const profile={states:{charge:{raw:ca.states.ESI_DASH_COMBO_SCA_XZ_CHARGE.raw},loop:{raw:ca.states.SI_SA_SDK_BURNING_PHANTOM_LOOP.raw}}};
 let presentationSerial=0,lastIdentity;
 const sim={state:{actors:[local,remote]},profile,emit:(type,actorId,data)=>events.push({type,actorId,...data}),
  beginSourceAudioState(actor){const identity=actor.state+':'+actor.stateSerial;if(identity!==lastIdentity){lastIdentity=identity;presentationSerial++;}return presentationSerial;},
  sourceExtendedSoundEvent:(actor,entry,serial)=>cues.push({actorId:actor.id,entry,presentationSerial:serial})};
 const before=new Map([['remote',{identity:'previous:1',fired:new Set()}]]);
 presentation.consume(sim,before,'local',()=>1);presentation.consume(sim,before,'local',()=>1);
 assert.equal(events.filter(event=>event.type==='stateChanged').length,1);assert.equal(cues.length,1);
 assert.equal(cues[0].entry.name,'Elesis_Charging01.ogg');
 assert.equal(cues[0].presentationSerial,events[0].audioPresentationSerial);
 remote.state='loop';remote.stateSerial=3;remote.fired=['STATE_SOUND_PLAY0'];
 presentation.consume(sim,new Map([['remote',{identity:'charge:2',fired:new Set(['SOUND_PLAY_EX:1'])}]]),'local',()=>1,()=>0,{historical:true});
 assert.equal(events.length,1,'a delayed historical collision cannot clear current browser voices');
 assert.equal(cues.length,1,'an unseen historical state cannot borrow the current live presentation stamp');
 presentation.consume(sim,new Map(),'local',()=>1);
 assert.equal(events.length,2);assert.equal(cues.length,2);assert.equal(cues[1].entry.name,'Elesis_BurningPhantom2.ogg');
 assert.equal(cues[1].presentationSerial,2,'skipped history does not consume the later legitimate live cue');
});
