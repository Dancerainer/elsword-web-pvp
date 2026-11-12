import {createAudioPreferences,audioVolumeGain} from './audio-preferences.mjs';
import firePeaks from '../../contracts/bh-fire-audio-peaks-v45.json' with {type:'json'};
import {sourceSoundGain} from './source-audio-distance-v45.mjs';

// The six Elsword/Elesis active armor casts share one original short cue.
// Keep event count and global preference unchanged; never layer a second play.
const presentationGain=name=>name==='Elsword_Endurance.ogg'?1.3:1;
const voiceVolume=(volume,gain)=>Math.min(1,audioVolumeGain(volume)*gain);

/** Browser presentation only. Prewarm verifies each source without playing or
 * retaining its media player. Playback owns a separate reusable voice pool. */
export function createBattleAudio({createAudio=url=>new Audio(url),storage,canPlay=()=>true,onError=()=>{},localActorId=()=>null}={}){
  const preferences=createAudioPreferences({storage});
  let volume=preferences.volume,enabled=true,manifest=null,criticalSoundFile=null,sequence=0,disposed=false;
  const voices=new Map(),active=new Set(),idle=new Set(),prepared=new Set(),preparations=new Set(),nativeVoices=new Set();
  let prewarmRun=null;
  let listenerPosition=null;
  // Several original fire clips decode above unity (measured up to 1.28).
  // Include their measured PCM peaks as well as simultaneous voice gains.
  // Below that bound every original cue keeps its requested presentation gain.
  // Rebalance on voice edges only; never truncate, restart or drop an event.
  function balanceActive(){
    let total=0;for(const voice of active){voice.spatialGain=sourceSoundGain(voice.source,listenerPosition,localActorId());
      total+=voiceVolume(volume,voice.gain)*voice.spatialGain*voice.peak;}
    const divisor=Math.max(1,total);
    for(const voice of active)voice.audio.volume=voiceVolume(volume,voice.gain)*voice.spatialGain/divisor;
  }
  function unload(audio){
    audio.pause();audio.removeAttribute?.('src');audio.load?.();
  }
  function discard(voice){
    idle.delete(voice);nativeVoices.delete(voice);const wasActive=active.delete(voice);voice.token=++sequence;
    voice.audio.onended=null;voice.audio.onerror=null;
    const pool=voices.get(voice.key),at=pool?.indexOf(voice)??-1;
    if(at>=0)pool.splice(at,1);if(pool&&!pool.length)voices.delete(voice.key);
    try{unload(voice.audio);}catch{}
    if(wasActive)balanceActive();
  }
  // Bound only reusable idle players; simultaneous sounds remain independent.
  function trimIdle(){while(idle.size>64)discard(idle.values().next().value);}
  function release(voice,token){
    if(voice.token!==token||!active.has(voice))return false;
    active.delete(voice);nativeVoices.delete(voice);voice.audio.onended=null;voice.audio.onerror=null;
    idle.delete(voice);idle.add(voice);balanceActive();trimIdle();return true;
  }
  function stop(){
    for(const voice of active){voice.token=++sequence;voice.audio.onended=null;voice.audio.onerror=null;
      try{voice.audio.pause();voice.audio.currentTime=0;}catch{}
      idle.delete(voice);idle.add(voice);}
    active.clear();nativeVoices.clear();trimIdle();
  }
  const urlFor=name=>{const file=manifest?.files?.[name]?.file;
    return file?'/assets/audio/'+file:name==='Critical_Hit.wav'&&criticalSoundFile?'/assets/rf/'+criticalSoundFile:null;};
  const urlKey=url=>new URL(url,'http://battle-audio.local').pathname;
  function warm(url,timeoutMs){
    if(disposed)return Promise.reject(Error('Battle audio disposed'));
    const key=urlKey(url);if(prepared.has(key))return Promise.resolve();
    const audio=createAudio(url);
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const cleanup=()=>{clearTimeout(timer);for(const type of ['loadeddata','canplay','canplaythrough'])audio.removeEventListener?.(type,ready);audio.removeEventListener?.('error',failed);preparations.delete(cancel);};
      const finish=error=>{
        if(done)return;done=true;cleanup();
        // Removing src alone need not reset the underlying media player.
        // load() applies the empty source list and aborts pending media work.
        try{unload(audio);}catch(cleanupError){error??=cleanupError;}
        if(error)reject(error);else {prepared.add(key);resolve();}
      };
      const ready=()=>finish();
      const failed=()=>finish(Error('Sound preload failed: '+url));
      const cancel=error=>finish(error);preparations.add(cancel);
      if(typeof audio.addEventListener!=='function'||typeof audio.load!=='function'){finish(Error('Audio preload API unavailable'));return;}
      for(const type of ['loadeddata','canplay','canplaythrough'])audio.addEventListener(type,ready);
      audio.addEventListener('error',failed);timer=setTimeout(()=>finish(Error('Sound preload timed out: '+url)),timeoutMs);
      audio.preload='auto';if(audio.readyState>=2)finish();else {try{audio.load();}catch(error){finish(error);}}
    });
  }
  return {
    configure(next){manifest=next.manifest;criticalSoundFile=next.criticalSoundFile;},
    get volume(){return volume;},get enabled(){return enabled;},
    setVolume(value){
      volume=preferences.setVolume(value);balanceActive();
      return volume;
    },
    setEnabled(value){enabled=Boolean(value);if(!enabled)stop();return enabled;},
    stop,
    // Match original channel ownership, never a filename shared by another
    // actor or by a separate ordinary cue. Lifecycle callers supply the
    // independently verified native group/condition request.
    stopNativeSounds(actorId,{handleGroup,deleteCondition,beforeStateSerial,beforePresentationSerial}={}){
      if(!nativeVoices.size)return 0;
      if(handleGroup!=='state'&&!(handleGroup==='condition'&&Number.isInteger(deleteCondition)&&deleteCondition>0&&deleteCondition<=5))return 0;
      let stopped=0;
      for(const voice of [...nativeVoices]){
        const source=voice.source,native=source?.sourceNativeSound;
        if(source?.actorId!==actorId||native?.handleGroup!==handleGroup||
          handleGroup==='condition'&&!native.deleteConditions.includes(deleteCondition))continue;
        if(Number.isInteger(beforeStateSerial)&&native.stateSerial>=beforeStateSerial)continue;
        if(Number.isInteger(beforePresentationSerial)&&native.presentationSerial>=beforePresentationSerial)continue;
        const token=voice.token;
        try{voice.audio.pause();voice.audio.currentTime=0;}catch{}
        if(release(voice,token))stopped++;
      }
      return stopped;
    },
    setListenerPosition(position){
      if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw TypeError('Invalid audio listener');
      if(listenerPosition?.every((value,i)=>value===position[i]))return;
      listenerPosition=[...position];balanceActive();
    },
    async prewarm({concurrency=6,timeoutMs=30000}={}){
      if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('Invalid audio preload limits');
      if(disposed)throw Error('Battle audio disposed');
      const urls=[...new Map([...Object.keys(manifest?.files??{}),'Critical_Hit.wav'].map(urlFor).filter(Boolean).map(url=>[urlKey(url),url])).values()];
      const run=async()=>{
        if(disposed)throw Error('Battle audio disposed');
        let cursor=0,failure=null;
        await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},async()=>{
          while(!failure&&cursor<urls.length){
            try{await warm(urls[cursor++],timeoutMs);}catch(error){
              failure??=error;for(const cancel of [...preparations])cancel(failure);
            }
          }
        }));
        if(failure)throw failure;
      };
      // Concurrent callers must not multiply the media-player concurrency.
      const pending=prewarmRun?prewarmRun.then(run,run):run();prewarmRun=pending;
      try{await pending;}finally{if(prewarmRun===pending)prewarmRun=null;}
    },
    dispose(){if(disposed)return;disposed=true;for(const cancel of [...preparations])cancel(Error('Battle audio disposed'));
      stop();for(const pool of [...voices.values()])for(const voice of [...pool])discard(voice);
      voices.clear();idle.clear();nativeVoices.clear();prepared.clear();manifest=null;criticalSoundFile=null;},
    play(name,source=null){
      if(disposed||!enabled||volume===0||!canPlay())return false;
      if(source?.onlyIfLocal&&source.actorId!==localActorId())return false;
      const url=urlFor(name);
      if(!url){onError({type:'unsupported-sound',name});return false;}
      const key=urlKey(url),pool=voices.get(key)??[];let voice=pool.find(v=>!active.has(v));
      try{
        if(!voice){voice={audio:createAudio(url),key,token:0};pool.push(voice);voices.set(key,pool);}
        idle.delete(voice);
        voice.token=++sequence;const token=voice.token;
        voice.gain=presentationGain(name);
        voice.source=source?{...source,sourcePosition:source.sourcePosition?.slice(),soundDistance:source.soundDistance?{...source.soundDistance}:undefined,
          sourceNativeSound:source.sourceNativeSound?{...source.sourceNativeSound,deleteConditions:[...(source.sourceNativeSound.deleteConditions??[])]}:undefined}:null;
        voice.peak=firePeaks.files[name]?.peak??1;
        voice.audio.currentTime=0;active.add(voice);
        if(['state','condition'].includes(voice.source?.sourceNativeSound?.handleGroup))nativeVoices.add(voice);
        balanceActive();
        voice.audio.onended=()=>release(voice,token);
        voice.audio.onerror=()=>{if(release(voice,token)){
          discard(voice);
          onError({type:'sound-decode-error',name});
        }};
        Promise.resolve(voice.audio.play()).catch(error=>{
          if(release(voice,token)){discard(voice);onError({type:'sound-play-denied',name,message:error.message});}
        });
        return true;
      }catch(error){if(voice)discard(voice);onError({type:'sound-play-denied',name,message:error.message});return false;}
    },
    proof(){return {volume,enabled,active:active.size,voices:[...voices.values()].reduce((n,pool)=>n+pool.length,0),idle:idle.size,
      listenerPosition:listenerPosition?.slice()??null,spatialVoices:[...active].filter(voice=>voice.source?.native3D).length,
      preparing:preparations.size,prepared:prepared.size,preparingUrls:preparations.size,preparedUrls:prepared.size,nativeVoices:nativeVoices.size,
      activeGain:[...active].reduce((sum,voice)=>sum+voice.audio.volume,0),
      activePeakGain:[...active].reduce((sum,voice)=>sum+voice.audio.volume*voice.peak,0),mixHeadroom:'sum-of-measured-source-peak-gains-at-most-one'};},
  };
}

export function createBattleAudioControls({document,host,before,player,onFocus=()=>{},onChange=()=>{}}){
  const toggle=document.createElement('button');toggle.id='audio-toggle';toggle.textContent='Game audio: '+(player.enabled?'On':'Off');
  const label=document.createElement('label');label.className='audio-volume';label.textContent='Volume ';
  const input=document.createElement('input');input.type='range';input.id='audio-volume';input.min='0';input.max='100';input.step='1';
  input.setAttribute('aria-label','Game audio volume');input.value=String(player.volume);
  const value=document.createElement('output');value.htmlFor=input.id;value.id='audio-volume-value';value.textContent=String(player.volume);
  label.append(input,value);host.insertBefore(toggle,before);host.insertBefore(label,before);
  toggle.onclick=()=>{player.setEnabled(!player.enabled);toggle.textContent='Game audio: '+(player.enabled?'On':'Off');onChange({volume:player.volume,enabled:player.enabled});};
  input.addEventListener('input',()=>{value.textContent=String(player.setVolume(input.value));onChange({volume:player.volume,enabled:player.enabled});});
  // Preserve native range Arrow/Home/End defaults while isolating combat keys.
  for(const type of ['keydown','keyup'])input.addEventListener(type,event=>event.stopPropagation());
  input.addEventListener('focus',onFocus);
  return {toggle,input,value};
}
