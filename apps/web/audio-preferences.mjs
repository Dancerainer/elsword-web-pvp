export const AUDIO_VOLUME_KEY='rf-audio-volume-v17';
export const DEFAULT_AUDIO_VOLUME=20;

/** More useful low-volume travel, with exact digital silence at zero. */
export function audioVolumeGain(value){const ratio=Math.min(100,Math.max(0,Number(value)||0))/100;return ratio*ratio;}

/** Per-browser volume only; the existing key preserves earlier valid choices. */
export function createAudioPreferences({storage}={}){
  let volume=DEFAULT_AUDIO_VOLUME;
  try {
    const raw=storage?.getItem(AUDIO_VOLUME_KEY);
    if(raw!==null&&raw!==undefined&&String(raw).trim()!==''){
      const saved=Number(raw);
      if(Number.isFinite(saved)&&saved>=0&&saved<=100)volume=Math.round(saved);
    }
  } catch {}
  return {
    get volume(){return volume;},
    setVolume(value){
      if(value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value)))return volume;
      volume=Math.min(100,Math.max(0,Math.round(Number(value))));
      try {storage?.setItem(AUDIO_VOLUME_KEY,String(volume));} catch {}
      return volume;
    },
  };
}

/** Allow existing login activation or the first genuine browser gesture.
 * This does not play a silent clip or queue stale sounds from before activation. */
export function createAudioGestureGate({target=globalThis.window,activation=()=>globalThis.navigator?.userActivation}={}){
  let allowed=false;
  try {allowed=activation()?.hasBeenActive===true;} catch {}
  function dispose(){for(const type of ['pointerdown','keydown'])target?.removeEventListener(type,unlock,true);}
  function unlock(event){if(event.isTrusted!==true)return;allowed=true;dispose();}
  if(!allowed)for(const type of ['pointerdown','keydown'])target?.addEventListener(type,unlock,true);
  return {get allowed(){return allowed;},dispose};
}
