import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {sourceCameraEye,sourceSoundGain} from '../../apps/web/source-audio-distance-v45.mjs';
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';
import {createPoseAudio} from '../../apps/web/pose-audio.mjs';
import gm from '../../packages/combat-core/gm-profile.json' with {type:'json'};

function fixture(){
 const made=[],audio=createBattleAudio({localActorId:()=> 'self',createAudio:url=>{
  const voice={url,currentTime:0,plays:0,volume:0,play(){this.plays++;return Promise.resolve();},pause(){}};made.push(voice);return voice;}});
 audio.configure({manifest:{files:Object.fromEntries(['Slash2.ogg','Elsword_Endurance.ogg','ui.ogg'].map(name=>[name,{file:name}]))}});
 audio.setListenerPosition([0,0,0]);return {audio,made};
}
const source=(x,id='peer',onlyIfLocal=false)=>({actorId:id,...sourceSoundEventMetadata({x,y:0,z:0},onlyIfLocal)});

test('original FMOD near/between/far boundaries use camera worldXYZ and exact linear gain',()=>{
 for(const [x,expected]of [[0,1],[80,1],[2440,.5],[4800,0],[10000,0]])assert.equal(sourceSoundGain(source(x),[0,0,0],'self'),expected);
 assert.equal(sourceSoundGain({...source(0),sourcePosition:[0,1464,1952]},[0,0,0],'self'),.5,'3D diagonal distance2440, not horizontal distance');
 assert.equal(sourceSoundGain(source(2440),[2440,0,0],'self'),1,'camera eye differs from local actor origin');
 assert.deepEqual(sourceCameraEye({x:12,y:34,z:-56},.01),[1200,3400,5600]);
 assert.throws(()=>sourceCameraEye({x:0,y:0,z:0},0),TypeError);
});

test('enemy GM local-only cues never allocate media; ordinary distant sounds play with source gain',()=>{
 const {audio,made}=fixture();assert.equal(audio.play('Slash2.ogg',source(0,'peer',true)),false);assert.equal(made.length,0);
 assert.equal(audio.play('Slash2.ogg',source(2440)),true);assert.equal(made[0].volume,.2**2*.5);
 assert.equal(audio.play('Slash2.ogg',source(10000,'self',true)),true);assert.equal(made[1].volume,.2**2,'local-only2D at any world distance');
 assert.equal(audio.play('ui.ogg'),true);assert.equal(made[2].volume,.2**2,'system/UI sound carries no actor distance');
 audio.dispose();
});

test('moving listener and user volume rebalance active clips without replay and pooled2D clears previous3D source',()=>{
 const {audio,made}=fixture(),event=source(2440);audio.play('Slash2.ogg',event);event.sourcePosition[0]=99999;
 audio.setListenerPosition([2440,0,0]);assert.equal(made[0].volume,.2**2,'voice freezes emission position by value');
 audio.setListenerPosition([7240,0,0]);assert.equal(made[0].volume,0);audio.setVolume(50);
 audio.setListenerPosition([0,0,0]);assert.equal(made[0].volume,.25*.5);assert.equal(made[0].plays,1);
 made[0].onended();audio.play('Slash2.ogg');assert.equal(made.length,1);assert.equal(made[0].volume,.25);
 assert.equal(made[0].plays,2);audio.dispose();
});

test('distance multiplies armor presentation gain and preserves measured mixed voice peak ceiling',()=>{
 const {audio,made}=fixture();audio.play('Elsword_Endurance.ogg',source(2440));assert.equal(made[0].volume,.2**2*1.3*.5);
 audio.setVolume(50);audio.play('Slash2.ogg',source(80));
 assert.ok(Math.abs(made[0].volume/made[1].volume-.65)<1e-12);
 audio.setVolume(100);assert.ok(audio.proof().activePeakGain<=1);audio.dispose();
});

test('actual GM displayed opening passes original onlyIfLocal metadata and filters remote presentation',()=>{
 const calls=[],player=createPoseAudio({profileFor:()=>gm,localActorId:()=> 'self',play:(name,event)=>calls.push({name,event}),random:()=>0});
 const actor={id:'self',x:123,y:456,z:789,pvpPresentation:{state:'ESI_SGM_START'}};
 player.step({...actor,id:'peer'},10);assert.equal(calls.length,0);player.step(actor,10);
 assert.deepEqual(calls.map(row=>row.name),['ElesisVoice_Start4.ogg','Slash2.ogg','NPCRaven_Slash1.ogg']);
 for(const {event}of calls){assert.equal(event.actorId,'self');assert.equal(event.onlyIfLocal,true);assert.equal(event.native3D,false);assert.deepEqual(event.sourcePosition,[123,456,789]);}
});
