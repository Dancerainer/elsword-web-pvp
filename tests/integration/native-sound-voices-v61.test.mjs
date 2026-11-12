import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';

function fixture(){
 const media=[],errors=[];let permitted=true;
 const player=createBattleAudio({storage:null,localActorId:()=> 'a',canPlay:()=>permitted,onError:error=>errors.push(error),createAudio:url=>{
  const audio={url,volume:0,currentTime:0,plays:0,pauses:0,
   play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;},removeAttribute(){},load(){}};
  media.push(audio);return audio;
 }});
 player.configure({manifest:{files:{'same.ogg':{file:'same.ogg'}}}});player.setListenerPosition([0,0,0]);
 const source=(actorId,handleGroup,deleteConditions=[])=>({actorId,...sourceSoundEventMetadata({x:0,y:0,z:0}),
  ...(handleGroup?{sourceNativeSound:{handleGroup,deleteConditions,stateSerial:3,field:'test'}}:{})});
 return {player,media,errors,source,deny(){permitted=false;}};
}

test('native conditions stop their actor channel without stopping another actor or ordinary same-file cue',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 for(const source of [f.source('a','condition',[2]),f.source('b','condition',[2]),f.source('a'),
  f.source('a','condition',[4]),f.source('a','state')])assert.equal(f.player.play('same.ogg',source),true);
 assert.equal(f.player.proof().active,5);assert.equal(f.player.proof().nativeVoices,4);
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'condition',deleteCondition:2}),1);
 assert.equal(f.player.proof().active,4);assert.equal(f.player.proof().nativeVoices,3);
 assert.deepEqual(f.media.map(audio=>audio.pauses),[1,0,0,0,0]);
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'state'}),1);
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'condition',deleteCondition:4}),1);
 assert.equal(f.player.proof().active,2);assert.equal(f.player.proof().nativeVoices,1);
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'condition',deleteCondition:2}),0);
 assert.equal(f.player.stopNativeSounds('a',{}),0);
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'condition',deleteCondition:0}),0);
 assert.deepEqual(f.errors,[]);
});

test('natural end and idle reuse clear native ownership, and stale end callbacks cannot release the reused voice',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 assert.equal(f.player.play('same.ogg',f.source('a','state')),true);
 const ended=f.media[0].onended;
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'state'}),1);
 assert.equal(f.player.proof().nativeVoices,0);
 assert.equal(f.player.play('same.ogg',f.source('a')),true);
 assert.equal(f.media.length,1);assert.equal(f.player.proof().nativeVoices,0);
 ended();assert.equal(f.player.proof().active,1,'the stopped generation cannot end a newer ordinary cue');
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'state'}),0);
 f.media[0].onended();assert.equal(f.player.proof().active,0);
 f.player.play('same.ogg',f.source('b','condition',[2]));f.media[0].onended();
 assert.equal(f.player.proof().nativeVoices,0);assert.equal(f.player.proof().idle,1);
});

test('native voice source owns its condition list and stopping works while muted or playback permission is unavailable',t=>{
 const f=fixture();t.after(()=>f.player.dispose());
 const source=f.source('a','condition',[2]);f.player.play('same.ogg',source);
 source.sourceNativeSound.deleteConditions[0]=4;
 f.player.setVolume(0);f.deny();
 assert.equal(f.player.stopNativeSounds('a',{handleGroup:'condition',deleteCondition:2}),1);
 assert.equal(f.player.proof().active,0);assert.equal(f.player.proof().nativeVoices,0);
 assert.equal(f.media[0].plays,1);assert.deepEqual(f.errors,[]);
});

test('global stop and dispose release all managed ownership and preserve the existing idle bound',()=>{
 const f=fixture();
 for(let i=0;i<70;i++)f.player.play('same.ogg',f.source('a','condition',[2]));
 assert.equal(f.player.proof().nativeVoices,70);
 f.player.stop();assert.equal(f.player.proof().active,0);assert.equal(f.player.proof().nativeVoices,0);
 assert.equal(f.player.proof().voices,64);assert.equal(f.player.proof().idle,64);
 f.player.dispose();assert.equal(f.player.proof().voices,0);assert.equal(f.player.proof().nativeVoices,0);
});
