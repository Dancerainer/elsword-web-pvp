/** Simulated finite MediaPlayer resource, independent of the implementation's
 * voice map. Source removal alone deliberately does not free a player. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';

function fixture(count,{auto=true,limit=40}={}){
  const media=[],decoded=[],errors=[];let resident=0,peak=0;
  class Media extends EventTarget{
    constructor(url){super();if(resident>=limit)throw Error('Simulated MediaPlayer limit');
      this.url=this.src=url;this.attached=true;this.plays=0;this.pauses=0;this.readyState=0;resident++;peak=Math.max(peak,resident);media.push(this);}
    load(){
      if(!this.src){if(this.attached){this.attached=false;resident--;}this.readyState=0;return;}
      if(auto)queueMicrotask(()=>this.decoded());
    }
    decoded(){this.readyState=2;decoded.push(this.url);this.dispatchEvent(new Event('loadeddata'));}
    pause(){this.pauses++;}removeAttribute(name){if(name==='src')this.src='';}
    play(){this.plays++;return Promise.resolve();}
  }
  const player=createBattleAudio({createAudio:url=>new Media(url),onError:error=>errors.push(error)});
  player.configure({manifest:{files:Object.fromEntries(Array.from({length:count},(_,i)=>['s'+i,{file:'sound-'+i+'.ogg'}]))}});
  return {player,media,decoded,errors,get resident(){return resident;},get peak(){return peak;},automatic(){auto=true;}};
}

test('1097 sources all reach loadeddata while concurrent callers retain at most six MediaPlayers',async()=>{
  const f=fixture(1097);f.player.setEnabled(false);f.player.setVolume(0);
  await Promise.all([f.player.prewarm(),f.player.prewarm(),f.player.prewarm()]);
  assert.equal(f.media.length,1097);assert.equal(new Set(f.decoded).size,1097);
  assert.equal(f.decoded.length,1097);assert.equal(f.peak,6);assert.equal(f.resident,0);
  assert.ok(f.media.every(media=>media.plays===0&&media.src===''));
  assert.equal(f.player.proof().prepared,1097);assert.equal(f.player.proof().voices,0);
  assert.equal(f.player.proof().preparedUrls,1097);assert.equal(f.player.proof().preparingUrls,0);
  assert.equal(f.player.proof().preparing,0);assert.deepEqual(f.errors,[]);f.player.dispose();
});

test('one failed decoder cancels every pending worker, rejects startup and permits a complete retry',async()=>{
  const f=fixture(20,{auto:false});const run=f.player.prewarm({concurrency:3});
  assert.equal(f.resident,3);f.media[1].dispatchEvent(new Event('error'));
  await assert.rejects(run,/Sound preload failed: .*sound-1/);
  assert.equal(f.resident,0);assert.equal(f.media.length,3);assert.equal(f.player.proof().prepared,0);
  for(const media of f.media)media.decoded();
  assert.equal(f.player.proof().prepared,0,'late events cannot resurrect cancelled verification');
  f.automatic();await f.player.prewarm({concurrency:3});
  assert.equal(f.player.proof().prepared,20);assert.equal(f.media.length,23);assert.equal(f.resident,0);f.player.dispose();
});

test('timeout and dispose reset the underlying resource and queued prewarms cannot allocate after disposal',async()=>{
  const timeout=fixture(3,{auto:false});
  await assert.rejects(timeout.player.prewarm({timeoutMs:1}),/timed out/);
  assert.equal(timeout.resident,0);assert.equal(timeout.player.proof().prepared,0);timeout.player.dispose();
  const f=fixture(20,{auto:false}),first=f.player.prewarm({concurrency:3}),second=f.player.prewarm();
  const results=Promise.allSettled([first,second]);f.player.dispose();
  assert.ok((await results).every(result=>result.status==='rejected'&&/disposed/.test(result.reason.message)));
  assert.equal(f.resident,0);assert.equal(f.media.length,3);
  for(const media of f.media)media.decoded();
  assert.equal(f.player.proof().prepared,0);assert.equal(f.player.proof().preparing,0);
});

test('65 overlapping sounds all play; completion bounds the idle pool and evicts the least recently used voice',()=>{
  const f=fixture(66,{limit:100});
  for(let i=0;i<65;i++)assert.equal(f.player.play('s'+i),true);
  assert.equal(f.player.proof().active,65);assert.equal(f.resident,65);
  assert.ok(f.media.every(media=>media.plays===1&&media.pauses===0),'no active sound is truncated');
  for(const media of [...f.media])media.onended();
  assert.equal(f.player.proof().idle,64);assert.equal(f.player.proof().voices,64);assert.equal(f.resident,64);
  assert.equal(f.media[0].attached,false);assert.ok(f.media.slice(1).every(media=>media.attached));
  f.player.play('s1');f.media[1].onended(); // Move the oldest retained voice to most recent.
  f.player.play('s65');f.media.at(-1).onended();
  assert.equal(f.media[1].attached,true);assert.equal(f.media[2].attached,false);
  assert.equal(f.player.proof().idle,64);f.player.dispose();assert.equal(f.resident,0);
});

test('stop bounds all newly idle voices; decode failure and denied playback release their media resource',async()=>{
  const f=fixture(65,{limit:100});for(let i=0;i<65;i++)f.player.play('s'+i);
  f.player.stop();assert.equal(f.player.proof().active,0);assert.equal(f.player.proof().idle,64);assert.equal(f.resident,64);
  f.player.play('s1');f.media[1].onerror();assert.equal(f.media[1].attached,false);
  f.player.play('s2');const denied=f.media[2];denied.onended();denied.play=()=>Promise.reject(Error('denied'));
  f.player.play('s2');await Promise.resolve();await Promise.resolve();assert.equal(denied.attached,false);
  assert.deepEqual(f.errors.map(error=>error.type),['sound-decode-error','sound-play-denied']);
  f.player.dispose();assert.equal(f.resident,0);
});
