import test from 'node:test';
import assert from 'node:assert/strict';
import {createInterfaceAudio} from '../../apps/web/interface-audio.mjs';
const manifest={files:Object.fromEntries(['lobby','click','queue','count'].map(key=>[key,{file:'lobby/'+key+'.ogg'}]))};
manifest.files.queueStart={file:'feedback-v26/Battle_Atena_Start.ogg'};manifest.files.matchSuccess={file:'feedback-v26/Battle_Atena_Success.ogg'};
function fixture(raw='20',options={}){
 const made=[],listeners=new Map();let allowed=false;
 const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const player=createInterfaceAudio({manifest,storage:{getItem:()=>raw,setItem(){}},target,document:target,canPlay:()=>allowed,...options,
  createAudio:url=>{const media={url,plays:0,pauses:0,play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;}};made.push(media);return media;}});
 return {player,made,listeners,unlock(){allowed=true;listeners.get('pointerdown')({isTrusted:true});}};
}
test('lobby music waits for activation, loops quietly, pauses for battle, and resumes without duplicate players',()=>{
 const f=fixture();f.player.setLobby(true);assert.equal(f.made.length,0);f.unlock();
 assert.equal(f.made.length,1);const bgm=f.made[0];assert.equal(bgm.loop,true);assert.equal(bgm.volume,.2**2*.65);
 f.player.setLobby(true);assert.equal(bgm.plays,1);f.player.setLobby(false);assert.equal(bgm.pauses,1);
 f.player.setLobby(true);assert.equal(bgm.plays,2);assert.equal(f.made.length,1);f.player.dispose();assert.equal(f.listeners.size,0);
});

test('acknowledged match sound survives light-lobby to battle audio ownership transfer',()=>{
 const lobby=fixture();lobby.unlock();assert.equal(lobby.player.matchAccepted('accepted-room'),true);lobby.player.dispose();
 const battle=fixture('20',{initialMatchId:'accepted-room'});battle.unlock();
 assert.equal(battle.player.matchAccepted('accepted-room'),false);assert.equal(battle.made.length,0);
 assert.equal(battle.player.matchAccepted('next-room'),true);assert.equal(battle.made.length,1);assert.equal(battle.made[0].plays,1);
 battle.player.dispose();
});
test('zero remains silent and the existing volume updates active music and button cues',()=>{
 const f=fixture('0');f.player.setLobby(true);f.unlock();assert.equal(f.made.length,0);
 f.player.setVolume(10);assert.equal(f.made[0].volume,.1**2*.65);f.player.play('click');assert.equal(f.made[1].volume,.1**2);
 f.player.setVolume(0);assert.equal(f.made[1].volume,0);assert.equal(f.player.play('click'),false);
 f.player.setVolume(100);f.player.setEnabled(false);assert.equal(f.player.play('click'),false);assert.equal(f.made[1].volume,0);
 f.player.dispose();
});
test('queue start, successful match and last three countdown sounds are deduplicated',()=>{
 const f=fixture();f.unlock();
 f.player.setQueue({queued:false});assert.equal(f.made.length,0);
 f.player.setQueue({queued:true,queue:{remainingSeconds:12}});f.player.setQueue({queued:true,queue:{remainingSeconds:11}});
 assert.equal(f.made.length,1);assert.equal(f.made[0].plays,1);assert.ok(f.made[0].url.endsWith('Battle_Atena_Start.ogg'));
 for(const seconds of [3,2.8,2,1.4,1,0])f.player.setQueue({queued:true,queue:{remainingSeconds:seconds}});
 assert.equal(f.made[1].plays,3);assert.ok(f.made[1].url.endsWith('count.ogg'));
 f.player.setQueue({queued:true,matchId:'room'});f.player.setQueue({queued:true,queue:{remainingSeconds:10}});
 assert.equal(f.made[0].plays,2);f.player.matchAccepted('room');f.player.matchAccepted('room');
 assert.equal(f.made[2].plays,1);assert.ok(f.made[2].url.endsWith('Battle_Atena_Success.ogg'));f.player.dispose();
});
