import {ONLINE_MODES,isOnlineMode} from '../../packages/online/modes.mjs';

/** Account-scoped UI choice; server mode/map availability remains authoritative. */
export function createLobbyModePreference({storage,username}={}){
  const key='webpvp:match-mode:'+String(username??'');
  return {
    read(){try{const value=storage?.getItem(key);return isOnlineMode(value)?value:'2v2';}catch{return '2v2';}},
    save(mode){if(!isOnlineMode(mode))return;try{storage?.setItem(key,mode);}catch{}},
  };
}

export function availableLobbyMode(preferred,flags,maps=[]){
  const start=ONLINE_MODES.indexOf(isOnlineMode(preferred)?preferred:'2v2');
  for(let offset=0;offset<ONLINE_MODES.length;offset++){
    const mode=ONLINE_MODES[(start+offset)%ONLINE_MODES.length];
    if(flags[mode]!==false&&(!maps.length||maps.some(map=>map.enabled!==false&&map.modes?.includes(mode))))return mode;
  }
  return ONLINE_MODES[start];
}
