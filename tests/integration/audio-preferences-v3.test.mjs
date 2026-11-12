import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {createAudioGestureGate,AUDIO_VOLUME_KEY} from '../../apps/web/audio-preferences.mjs';

const manifest={files:{'HitSlash.wav':{file:'HitSlash.wav'}}};
function player(storage,canPlay){
  const media=[],audio=createBattleAudio({storage,canPlay,createAudio:url=>{
    const voice={url,volume:null,currentTime:null,plays:0,play(){this.plays++;return Promise.resolve();},pause(){}};
    media.push(voice);return voice;
  }});
  audio.configure({manifest});return {audio,media};
}

test('existing browser volume is retained, a changed volume persists, and actual media uses the quiet quadratic curve immediately',()=>{
  const values=new Map([[AUDIO_VOLUME_KEY,'73']]),writes=[],storage={getItem:k=>values.get(k)??null,setItem(k,v){writes.push([k,v]);values.set(k,v);}};
  const p=player(storage);assert.equal(p.audio.enabled,true);assert.equal(p.audio.volume,73);
  p.audio.play('HitSlash.wav');assert.equal(p.media[0].volume,.73**2);
  p.audio.setVolume(28);assert.equal(p.media[0].volume,.28**2);assert.equal(p.media[0].plays,1);
  assert.deepEqual(writes,[[AUDIO_VOLUME_KEY,'28']]);assert.equal(player(storage).audio.volume,28);
});

test('saved zero stays muted with an enabled switch and does not download a sound until the volume increases',()=>{
  const p=player({getItem:()=> '0'});assert.equal(p.audio.enabled,true);assert.equal(p.audio.volume,0);
  assert.equal(p.audio.play('HitSlash.wav'),false);assert.equal(p.media.length,0);
  p.audio.setVolume(20);assert.equal(p.audio.play('HitSlash.wav'),true);assert.equal(p.media[0].volume,.2**2);
});

test('empty, malformed, out-of-range or inaccessible saved values fall back to 20 and storage errors do not block playback',()=>{
  for(const raw of [null,'',' ','corrupt','NaN','Infinity','-1','101']){
    const p=player({getItem:()=>raw});assert.equal(p.audio.volume,20);p.audio.play('HitSlash.wav');assert.equal(p.media[0].volume,.2**2);
  }
  const blocked=player({getItem(){throw Error('disabled');},setItem(){throw Error('full');}});
  assert.equal(blocked.audio.volume,20);blocked.audio.setVolume(62);blocked.audio.play('HitSlash.wav');assert.equal(blocked.media[0].volume,.62**2);
});

test('an unactivated page makes no media request, then its first trusted gesture permits the normal action sound without replaying stale events',()=>{
  const listeners=new Map(),target={addEventListener(type,fn,capture){assert.equal(capture,true);listeners.set(type,fn);},removeEventListener(type,fn,capture){assert.equal(capture,true);assert.equal(listeners.get(type),fn);listeners.delete(type);}};
  const gate=createAudioGestureGate({target,activation:()=>({hasBeenActive:false})}),p=player(undefined,()=>gate.allowed);
  assert.equal(p.audio.enabled,true);assert.equal(p.audio.volume,20);
  assert.equal(p.audio.play('HitSlash.wav'),false);assert.equal(p.media.length,0);
  listeners.get('pointerdown')({isTrusted:false});assert.equal(gate.allowed,false);
  listeners.get('keydown')({isTrusted:true});assert.equal(gate.allowed,true);assert.equal(listeners.size,0);
  assert.equal(p.media.length,0,'unlock itself never creates a silent clip or replays an earlier event');
  assert.equal(p.audio.play('HitSlash.wav'),true);assert.equal(p.media.length,1);assert.equal(p.media[0].volume,.2**2);
});

test('an earlier successful login gesture allows sound without requiring a second activation click',()=>{
  const gate=createAudioGestureGate({activation:()=>({hasBeenActive:true}),target:{addEventListener(){assert.fail('already activated pages need no listener');}}});
  const p=player(undefined,()=>gate.allowed);assert.equal(p.audio.play('HitSlash.wav'),true);assert.equal(p.media[0].plays,1);assert.equal(p.media[0].volume,.2**2);
});
