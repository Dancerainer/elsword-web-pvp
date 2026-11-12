import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';

function fixture({auto=true,allow=false}={}){
  const media=[];
  class Media extends EventTarget{
    constructor(url){super();this.url=url;this.src=url;this.plays=0;this.loads=0;this.unloads=0;this.pauses=0;this.readyState=0;}
    load(){if(!this.src){this.unloads++;this.readyState=0;return;}this.loads++;if(auto)queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event('loadeddata'));});}
    play(){this.plays++;return Promise.resolve();}pause(){this.pauses++;}removeAttribute(name){if(name==='src')this.src='';}
  }
  const player=createBattleAudio({canPlay:()=>allow,createAudio:url=>{const audio=new Media(url);media.push(audio);return audio;}});
  player.configure({manifest:{files:{RF:{file:'rf.ogg'},LK:{file:'../lk/audio/lk.ogg'},same:{file:'../audio/rf.ogg'}}},criticalSoundFile:'critical.wav'});
  return {player,media};
}
test('explicit preload verifies every URL without retaining media, playback, gesture activation or volume changes',async()=>{
  const {player,media}=fixture();player.setVolume(0);player.setEnabled(false);
  await Promise.all([player.prewarm(),player.prewarm()]);await player.prewarm();
  assert.equal(media.length,3);assert.ok(media.every(audio=>audio.loads===1&&audio.plays===0&&audio.preload==='auto'));
  assert.equal(player.volume,0);assert.equal(player.enabled,false);assert.equal(player.proof().active,0);
  assert.equal(player.proof().voices,0);assert.equal(player.proof().prepared,3);
  assert.ok(media.every(audio=>audio.src===''&&audio.unloads===1));player.dispose();
});
test('verified sounds use a separate reusable playback pool; concurrent hits remain independent',async()=>{
  const {player,media}=fixture({allow:true});await player.prewarm();assert.equal(player.play('RF'),true);
  const first=media[3];first.onended();
  for(let i=0;i<29;i++){assert.equal(player.play('RF'),true);first.onended();}
  assert.equal(media.length,4);assert.equal(first.plays,30);
  player.play('RF');player.play('RF');assert.equal(media.length,5);player.dispose();
});
test('failed media preparation retries the failed URL and retains only completed verification',async()=>{
  const {player,media}=fixture({auto:false});const pending=player.prewarm({concurrency:1});
  media[0].readyState=2;media[0].dispatchEvent(new Event('loadeddata'));await new Promise(ok=>setImmediate(ok));
  media[1].dispatchEvent(new Event('error'));await assert.rejects(pending,/preload failed/);
  const retry=player.prewarm({concurrency:1});await new Promise(ok=>setImmediate(ok));
  assert.equal(media[0].loads,1);assert.equal(media[2].url,media[1].url);media[2].dispatchEvent(new Event('canplay'));
  await new Promise(ok=>setImmediate(ok));media[3].dispatchEvent(new Event('canplay'));await retry;
  assert.equal(player.proof().voices,0);assert.equal(player.proof().prepared,3);player.dispose();
});
test('disposing an in-flight preload rejects it and releases all retained voices without a late resurrection',async()=>{
  const {player,media}=fixture({auto:false});const pending=player.prewarm();player.dispose();
  await assert.rejects(pending,/disposed/);for(const audio of media)audio.dispatchEvent(new Event('loadeddata'));
  assert.equal(player.proof().voices,0);assert.equal(player.play('RF'),false);await assert.rejects(player.prewarm(),/disposed/);
});
test('a silent media timeout can retry instead of retaining a permanently pending startup promise',async()=>{
  const {player,media}=fixture({auto:false});await assert.rejects(player.prewarm({concurrency:1,timeoutMs:1}),/timed out/);
  assert.equal(player.proof().voices,0);assert.equal(media[0].src,'');player.dispose();
});
