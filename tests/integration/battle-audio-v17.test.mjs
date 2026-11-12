import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createBattleAudio,createBattleAudioControls} from '../../apps/web/battle-audio.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings} from '../../packages/input/key-bindings.mjs';
const manifest={files:{'HitSlash.wav':{file:'HitSlash.wav'},'Core.ogg':{file:'../rf/core-shield-audio/Core.ogg'}}};
function fixture(storage){
  const made=[],errors=[];
  const player=createBattleAudio({storage,onError:e=>errors.push(e),createAudio:url=>{
    const audio={url,volume:null,currentTime:null,onended:null,onerror:null,plays:0,pauses:0,
      play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;}};made.push(audio);return audio;
  }});
  player.configure({manifest,criticalSoundFile:'critical-fx/Critical_Hit.wav'});return {player,made,errors};
}

test('default20/on is idle until a sound event, and muted/disabled audio never allocates a request',()=>{
  const {player,made}=fixture({getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}});
  assert.equal(player.volume,20);assert.equal(player.enabled,true);assert.equal(made.length,0);
  player.setEnabled(false);assert.equal(player.play('HitSlash.wav'),false);
  player.setEnabled(true);player.setVolume(0);assert.equal(player.play('HitSlash.wav'),false);assert.equal(made.length,0);
  player.setVolume(20);assert.equal(player.play('HitSlash.wav'),true);assert.equal(made[0].volume,.2**2);
});

test('0..100 is persisted, restores valid0, and changes every playing sound live without fading or restarting',()=>{
  const memory=new Map([['rf-audio-volume-v17','0']]),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const {player,made}=fixture(storage);assert.equal(player.volume,0);
  player.setVolume(55);player.setEnabled(true);player.play('HitSlash.wav');player.play('HitSlash.wav');
  assert.equal(made.length,2);player.setVolume(100);assert.ok(made.every(a=>a.volume===.5));
  player.setVolume(0);assert.ok(made.every(a=>a.volume===0&&a.plays===1&&a.pauses===0));
  player.setVolume(64);assert.ok(made.every(a=>a.volume===.64**2));assert.equal(memory.get('rf-audio-volume-v17'),'64');
  assert.equal(fixture(storage).player.volume,64);player.setVolume(101);assert.equal(player.volume,100);
  player.setVolume(-1);assert.equal(player.volume,0);player.setVolume(NaN);assert.equal(player.volume,0);
  assert.equal(fixture({getItem:()=> 'corrupt'}).player.volume,20);
});

test('idle voices are reused, simultaneous hits retain separate voices and original WAV/core/critical paths resolve',()=>{
  const {player,made,errors}=fixture();player.setEnabled(true);
  for(let i=0;i<100;i++){player.play('HitSlash.wav');made[0].onended();}
  assert.equal(made.length,1,'100 completed hits allocate one Audio instead of100');
  player.play('HitSlash.wav');player.play('HitSlash.wav');assert.equal(made.length,2);assert.equal(player.proof().active,2);
  player.play('Core.ogg');player.play('Critical_Hit.wav');
  assert.deepEqual(made.map(a=>a.url),['/assets/audio/HitSlash.wav','/assets/audio/HitSlash.wav',
    '/assets/audio/../rf/core-shield-audio/Core.ogg','/assets/rf/critical-fx/Critical_Hit.wav']);
  player.play('unknown');assert.deepEqual(errors,[{type:'unsupported-sound',name:'unknown'}]);
  player.setEnabled(false);assert.equal(player.proof().active,0);assert.ok(made.every(a=>a.pauses===1&&a.currentTime===0));
});

test('stop/reuse rejects stale asynchronous completion while current errors release the active voice',async()=>{
  const {player,made,errors}=fixture();player.setEnabled(true);player.play('HitSlash.wav');
  const audio=made[0];audio.onended();let reject;
  audio.play=()=>new Promise((_,r)=>reject=r);player.play('HitSlash.wav');
  const oldEnded=audio.onended;player.stop();audio.play=()=>Promise.resolve();player.play('HitSlash.wav');
  oldEnded();reject(Error('old denied'));await Promise.resolve();await Promise.resolve();
  assert.equal(player.proof().active,1);assert.deepEqual(errors,[]);
  audio.onerror();assert.equal(player.proof().active,0);assert.equal(errors[0].type,'sound-decode-error');
  player.play('HitSlash.wav');assert.equal(made.length,2,'failed media leaves the idle pool so a later request can retry');
  assert.equal(player.proof().active,1);
});

test('active-armor cue gets only a local 1.3 gain, tracks live volume, clamps and never doubles playback',()=>{
  const {player,made,errors}=fixture();
  player.configure({manifest:{files:{...manifest.files,'Elsword_Endurance.ogg':{file:'../lk/audio/Elsword_Endurance.ogg'}}}});
  assert.equal(player.play('Elsword_Endurance.ogg'),true);assert.equal(player.play('HitSlash.wav'),true);
  const [armor,ordinary]=made;assert.equal(armor.volume,.2**2*1.3);assert.equal(ordinary.volume,.2**2);
  assert.equal(armor.url,'/assets/audio/../lk/audio/Elsword_Endurance.ogg');
  player.setVolume(50);assert.equal(armor.volume,.25*1.3);assert.equal(ordinary.volume,.25);
  player.setVolume(100);assert.equal(armor.volume,.5);assert.equal(ordinary.volume,.5);
  player.setVolume(0);assert.equal(armor.volume,0);assert.equal(ordinary.volume,0);
  assert.equal(player.play('Elsword_Endurance.ogg'),false);assert.equal(made.length,2);
  player.setVolume(20);assert.equal(armor.volume,.2**2*1.3);
  assert.ok(made.every(audio=>audio.plays===1&&audio.pauses===0),'volume changes never replay a cue');
  player.setEnabled(false);assert.equal(player.proof().active,0);assert.equal(player.play('Elsword_Endurance.ogg'),false);
  player.setEnabled(true);assert.equal(player.play('Elsword_Endurance.ogg'),true);
  assert.equal(made.length,2);assert.equal(armor.plays,2);assert.equal(armor.currentTime,0);assert.equal(armor.volume,.2**2*1.3);
  assert.deepEqual(errors,[]);player.dispose();assert.equal(player.proof().voices,0);
});

test('URL-equivalent pooled aliases reset per-play gain and exact sound identity controls the boost',()=>{
  const {player,made}=fixture();
  player.configure({manifest:{files:{'Elsword_Endurance.ogg':{file:'../lk/audio/Elsword_Endurance.ogg'},
    'plain-alias.ogg':{file:'../lk/audio/Elsword_Endurance.ogg'},
    'Elsword_Endurance_OTHER.ogg':{file:'../lk/audio/Elsword_Endurance.ogg'}}}});
  player.play('Elsword_Endurance.ogg');const audio=made[0];assert.equal(audio.volume,.2**2*1.3);audio.onended();
  player.play('plain-alias.ogg');assert.equal(made.length,1);assert.equal(audio.volume,.2**2);
  player.setVolume(50);assert.equal(audio.volume,.25);audio.onended();
  player.play('Elsword_Endurance_OTHER.ogg');assert.equal(audio.volume,.25);audio.onended();
  player.play('Elsword_Endurance.ogg');assert.equal(made.length,1);assert.equal(audio.volume,.25*1.3);
  assert.equal(audio.plays,4);assert.equal(player.proof().active,1);player.dispose();
});

class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.attributes={};}
  append(...values){this.children.push(...values);}insertBefore(value,before){this.children.splice(this.children.indexOf(before),0,value);}
  setAttribute(key,value){this.attributes[key]=value;}matches(selector){return selector.split(',').includes(this.tagName.toLowerCase());}
}
test('real range input handlers update numeric output and isolate Arrow/Home/End defaults from actual global combat handlers',()=>{
  const {player}=fixture(),document={createElement:tag=>new Element(tag)},host=new Element('footer'),status=new Element('span');host.append(status);
  let releases=0;const controls=createBattleAudioControls({document,host,before:status,player,onFocus:()=>releases++});
  assert.deepEqual([controls.input.min,controls.input.max,controls.input.step,controls.input.value,controls.value.textContent],['0','100','1','20','20']);
  assert.equal(controls.toggle.textContent,'Game audio: On');
  controls.toggle.onclick();assert.equal(player.enabled,false);assert.equal(controls.toggle.textContent,'Game audio: Off');
  controls.toggle.onclick();assert.equal(player.enabled,true);assert.equal(controls.toggle.textContent,'Game audio: On');
  controls.input.value='73';controls.input.dispatchEvent(new Event('input'));assert.equal(player.volume,73);assert.equal(controls.value.textContent,'73');
  controls.input.dispatchEvent(new Event('focus'));assert.equal(releases,1);
  const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
  const modeGuard=source.match(/^const isPvpMode=.*;$/m)?.[0];assert.ok(modeGuard,'production keyboard mode guard is present');
  const start=source.indexOf("listenBattleWindow('keydown',event=>{"),end=source.indexOf("listenBattleWindow('blur'",start);
  assert.ok(start>=0&&end>start,'production global keyboard handlers are present');
  const window=new EventTarget(),pressed=[];
  vm.runInNewContext(modeGuard+'\n'+source.slice(start,end),{window,listenBattleWindow:(...args)=>window.addEventListener(...args),preset:{skillKeys:[]},active:true,paused:false,slotPreparation:false,
    mode:'practice',currentSession:{role:'gm'},configurationLocked:false,keyDialog:null,guildPanel:{isOpen:()=>false},
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),
    inputBuffer:{down:k=>pressed.push(k),up:k=>pressed.push('up:'+k)},performance:{now:()=>0},say(){},perf:{},canvas:{focus(){}}});
  for(const code of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','KeyZ'])for(const type of ['keydown','keyup']){
    const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'code',{value:code});
    controls.input.dispatchEvent(event);if(!event.cancelBubble)window.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false,code+' retains native range default');
  }
  assert.deepEqual(pressed,[]);
  const arena=new Element('canvas'),event=new Event('keydown',{cancelable:true});Object.defineProperties(event,{code:{value:'KeyZ'},target:{value:arena}});
  window.dispatchEvent(event);assert.deepEqual(pressed,['Z']);assert.equal(event.defaultPrevented,true,'battle keyboard remains functional');
});
