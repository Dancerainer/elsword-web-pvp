import {createAudioPreferences,audioVolumeGain} from './audio-preferences.mjs';

/** Presentation sounds never enter combat, matching or server ledgers. */
export function createInterfaceAudio({manifest,storage,createAudio=url=>new Audio(url),urlFor=file=>'/assets/audio/'+file,
  canPlay=()=>true,target=globalThis.window,document=globalThis.document,onError=()=>{},initialMatchId=null}){
 if(!manifest?.files?.lobby?.file)throw new TypeError('Lobby audio manifest required');
 const preferences=createAudioPreferences({storage}),shots=new Map();
 let volume=preferences.volume,enabled=true,wantedLobby=false,bgm=null,bgmPlaying=false,queued=false,lastCount=null,disposed=false,lastMatch=initialMatchId;
 const gain=()=>enabled?audioVolumeGain(volume):0;
 const source=key=>manifest.files[key]?.file;
 function play(key){
  if(disposed||gain()===0||!canPlay()||!source(key))return false;
  let audio=shots.get(key);if(!audio){audio=createAudio(urlFor(source(key)));audio.preload='auto';shots.set(key,audio);}
  audio.volume=gain();audio.currentTime=0;
  Promise.resolve(audio.play()).catch(error=>onError({type:'interface-sound-denied',key,message:error.message}));
  return true;
 }
 function updateMusic(){
  if(disposed||!wantedLobby||gain()===0){if(bgm){bgm.pause();bgmPlaying=false;}return;}
  if(!canPlay()||bgmPlaying)return;
  if(!bgm){bgm=createAudio(urlFor(source('lobby')));bgm.loop=true;bgm.preload='metadata';}
  bgm.volume=gain()*.65;bgmPlaying=true;
  Promise.resolve(bgm.play()).catch(()=>{bgmPlaying=false;});
 }
 const gesture=event=>{if(event.isTrusted===true)updateMusic();};
 const click=event=>{const button=event.target?.closest?.('button');if(button&&!button.disabled&&!button.closest('[hidden]'))play('click');};
 target?.addEventListener?.('pointerdown',gesture,true);target?.addEventListener?.('keydown',gesture,true);
 document?.addEventListener?.('click',click,true);
 return {play,setLobby(value){wantedLobby=!!value;updateMusic();},
  setQueue(value){const next=!!value?.queued&&!value.matchId&&!value.match;
   const seconds=Math.ceil(value?.queue?.remainingSeconds??Infinity);
   if(next&&!queued)play('queueStart');
   if(next&&seconds>=1&&seconds<=3&&seconds!==lastCount)play('count');
   queued=next;lastCount=next?seconds:null;},
  matchAccepted(id){if(typeof id!=='string'||id===lastMatch)return false;lastMatch=id;queued=false;lastCount=null;return play('matchSuccess');},
  cancelAccepted(value){if(value?.queued!==false||value.matchId||value.match)return false;return play('queueCancel');},
  setVolume(value){volume=preferences.setVolume(value);for(const audio of shots.values())audio.volume=gain();if(bgm)bgm.volume=gain()*.65;updateMusic();return volume;},
  setEnabled(value){enabled=!!value;for(const audio of shots.values())audio.volume=gain();updateMusic();},
  proof:()=>({volume,gain:gain(),enabled,wantedLobby,bgmPlaying,queued,originalSources:Object.keys(manifest.files)}),
  dispose(){disposed=true;target?.removeEventListener?.('pointerdown',gesture,true);target?.removeEventListener?.('keydown',gesture,true);
   document?.removeEventListener?.('click',click,true);for(const audio of [...shots.values(),bgm].filter(Boolean)){audio.pause();audio.removeAttribute?.('src');}shots.clear();bgm=null;bgmPlaying=false;}
 };
}
