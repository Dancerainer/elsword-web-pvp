import {assetUrl,initializeAssetUrls,versionStyleSheetAssets} from './asset-urls.mjs';
import {PROFESSIONS,normalizeProfessionId} from '../../packages/professions/catalog.mjs';
import {DEFAULT_SCENE_ID} from '../../packages/online/map-pool.mjs';
import {normalizeCostumePreferences} from '../../packages/professions/costumes.mjs';
import {DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';
import {createOnlineClient} from './online-client.mjs';
import {createOnlineLobby} from './online-lobby.mjs';
import {createLobbyConfiguration} from './lobby-configuration.mjs';
import {createLobbyConfigurationPanel} from './lobby-configuration-panel.mjs';
import {createKeyBindingsDialog} from './key-bindings.mjs';
import {createGuildPanel} from './guild-panel.mjs';
import {createInterfaceAudio} from './interface-audio.mjs';
import {createAudioGestureGate} from './audio-preferences.mjs';
import {createBattleAudioControls} from './battle-audio.mjs';
import {createSkillBarSizeControl} from './skill-bar-size.mjs';
import {createMatchEntry} from './match-entry.mjs';
import {createLobbyHandoffRelease} from './lobby-handoff.mjs';
import {createResultReceipt} from './result-receipt.mjs';

/** Lobby keeps the authenticated connection during dynamic battle preparation.
 * Just before opening the replacement, battle awaits release(): the server
 * atomically retires the current page's old transports and acknowledges it.
 * A long model/map load therefore does not create an offline lease gap. */
export async function startLobbyShell({document=globalThis.document,window=globalThis.window,fetch:request=globalThis.fetch,
 loadBattle=()=>import('./game.mjs').then(module=>module.startBattle()),mapBackground=null,battleRetirement=null}={}){
 const app=document.querySelector('#app');if(!app)throw Error('Lobby host missing');
 await initializeAssetUrls(request);versionStyleSheetAssets(document);
 let pageInitToken=app.dataset?.pageInitToken;
 if(typeof pageInitToken!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(pageInitToken)){
  const bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);
  pageInitToken='lobby_'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');app.dataset.pageInitToken=pageInitToken;
 }
 const response=await request('/api/session',{headers:pageInitToken?{'X-RF-Page-Init':pageInitToken}:{}});
 if(!response.ok)throw Error('/api/session: HTTP '+response.status);
 const session=await response.json();
 let professionId=normalizeProfessionId(session.professionId,{fallback:true}),costumes=normalizeCostumePreferences(session.costumes),
  keyBindings=structuredClone(DEFAULT_KEY_BINDINGS),queued=Boolean(session.online?.queued||session.online?.matchId||session.online?.match),
  transitioning=false,released=false,failure=null,transitionPromise=null,lobby=null,keyDialog=null,configPanel=null,guildPanel=null,preparingMatch=null;
 const events=[];let storage=null;try{storage=window.localStorage;}catch{}
 const resultReceipts=createResultReceipt({storage});
 const data=async url=>{const value=await request(assetUrl(url));if(!value.ok)throw Error(url+': HTTP '+value.status);return value.json();};
 document.body.classList.add('battle-workbench','light-lobby');
 app.innerHTML='<main class="workbench lobby-shell"><header class="workbench-header"><strong>web pvp</strong><span class="workbench-mode">Match Lobby</span><span class="version-note">Skills and controls</span><button id="logout">Log out</button></header><section class="viewport lobby-shell-viewport" aria-label="Battle Lobby"><img class="lobby-static-map" alt="" aria-hidden="true"></section><footer class="tools"><span class="lobby-shell-status" role="status">Connecting to lobby…</span></footer></main>';
 const workbench=app.querySelector('.workbench'),host=workbench.querySelector('.viewport'),tools=workbench.querySelector('.tools'),status=tools.querySelector('.lobby-shell-status');
 const background=host.querySelector('.lobby-static-map');background.src=mapBackground?.url??assetUrl('/assets/ui/lobby/default-map-v45.png');
 background.onerror=()=>{background.hidden=true;};
 const canEdit=()=>!released&&!transitioning&&!queued&&!failure;
 const showLobby=()=>{if(!released&&!transitioning)lobby?.show(true);};
 const syncHeader=()=>{workbench.querySelector('.workbench-header strong').textContent='web pvp · '+PROFESSIONS[professionId].id;};syncHeader();
 const gate=createAudioGestureGate({target:window});
 const [audioManifest,feedbackAudio,ui,keyPreferences,mapStatus]=await Promise.all([
  data('/assets/audio/lobby/manifest.json'),data('/assets/audio/feedback-v26/manifest.json'),data('/assets/ui/online/manifest.json'),
  data('/api/key-preferences'),data('/api/online/maps')]);
 Object.assign(audioManifest.files,{queueStart:feedbackAudio.files['Battle_Atena_Start.ogg'],queueCancel:feedbackAudio.files['Battle_Atena_Fail.ogg'],
  matchSuccess:feedbackAudio.files['Battle_Atena_Success.ogg'],skillEquip:feedbackAudio.files['Skill_Equip.ogg'],skillUnequip:feedbackAudio.files['Skill_UnEquip.ogg']});
 const audio=createInterfaceAudio({manifest:audioManifest,storage,canPlay:()=>gate.allowed,target:window,document,
  createAudio:url=>new window.Audio(assetUrl(url)),onError:event=>events.push(event)});audio.setLobby(true);
 let soundEnabled=true;
 createBattleAudioControls({document,host:tools,before:status,player:{get volume(){return audio.proof().volume;},get enabled(){return soundEnabled;},
  setVolume:value=>audio.setVolume(value),setEnabled(value){soundEnabled=!!value;audio.setEnabled(value);}}});
 const configuration=createLobbyConfiguration({username:session.username,fetch:(url,options={})=>request(url,{...options,headers:{...options.headers,'X-RF-Page-Init':pageInitToken}}),storage,loadData:data});
 const matchEntry=createMatchEntry({host:workbench,onReturn:()=>window.location.reload()});
 function closePanels(){configPanel?.close();keyDialog?.close();guildPanel?.close();}
 function closeLocal(){
  if(released)return false;released=true;
  online.close();lobby?.dispose();configPanel?.dispose();keyDialog?.destroy();guildPanel?.dispose();audio.dispose();gate.dispose();
  document.body.classList.remove('light-lobby');window.removeEventListener('pagehide',pagehide);return true;
 }
 const release=createLobbyHandoffRelease({requestHandoff:()=>online.api('/api/online/handoff','POST',{pageInitToken}),
  acceptToken:token=>{app.dataset.pageInitToken=token;if(window.webpvpLobbyHandoff)window.webpvpLobbyHandoff.pageInitToken=token;
    window.dispatchEvent(new window.Event('webpvp-page-identity'));},
  closeLocal,isClosed:()=>released});
 function pagehide(){closeLocal();}
 window.addEventListener('pagehide',pagehide,{once:true});
 function beginPreparation(value){
  if(preparingMatch?.id===value.id)return;
  preparingMatch=value;queued=true;closePanels();lobby?.setLocked(true);lobby?.show(false);
  workbench.classList.add('entry-loading');
  audio.setLobby(false);audio.matchAccepted(value.id);
  matchEntry.begin(value,{playerId:session.username});matchEntry.stage(value,'Preparing match room…');
  status.textContent='Preparing match room…';
 }
 function handoff(intent){
  if(released)return Promise.resolve(false);if(transitionPromise)return transitionPromise;
  transitioning=true;closePanels();lobby?.setLocked(true);lobby?.show(false);audio.setLobby(false);
  workbench.classList.add('entry-loading');
  if(intent.match)audio.matchAccepted(intent.match.id);
  const loading=intent.match??{id:'local-practice-loading',mode:intent.kind,players:[{id:session.username,username:session.username,nickname:session.nickname??session.username,
   professionId,team:1,loadingProgress:0}]};
  matchEntry.begin(loading,{playerId:session.username});matchEntry.stage(loading,'Loading class models and map…');
  status.textContent='Preparing to enter battle…';
  window.webpvpLobbyHandoff={intent,audio:{volume:audio.proof().volume,enabled:soundEnabled,matchId:intent.match?.id??null},release};
  transitionPromise=loadBattle().then(()=>true).catch(error=>{
   events.push({type:'battle-entry-failed',message:error.message});
   // A partially evaluated battle module may already own a new DOM. Expose a
   // recoverable reload action without replaying another import/session lease.
   const alert=document.createElement('section');alert.className='lobby-entry-error';alert.setAttribute('role','alert');
   const text=document.createElement('p');text.textContent='Failed to load combat assets: '+error.message;
   const reload=document.createElement('button');reload.textContent='Return to lobby';reload.onclick=()=>window.location.reload();alert.append(text,reload);app.append(alert);return false;
  });return transitionPromise;
 }
 const online=createOnlineClient({fetch:request,iceServers:session.rtcIceServers??[],peerMode:session.peerMode??'hybrid',
  eventTransport:session.onlineEventTransport??'sse',pageInitToken,WebSocket:window.WebSocket,EventSource:window.EventSource,
  RTCPeerConnection:window.RTCPeerConnection,onError:error=>{
   if(error.code==='session-replaced'){online.close();window.location.replace('/?session=replaced');return;}
   if(released||transitioning)return;events.push({type:'online-error',message:error.message});
   if(error.message==='connection-retrying'){status.textContent='Reconnecting…';return;}
   failure=error;lobby?.setLocked(true);keyDialog?.setLocked(true);lobby?.error('Lobby connection failed: '+error.message);
  },onEvent(type,value){
   if(type==='reconnect-ended'&&!released){
    resultReceipts.skipEndedReconnect({matchId:value.matchId,playerId:session.username});
    const activeMatchId=window.webpvpLobbyHandoff?.intent?.match?.id??preparingMatch?.id??session.online?.match?.id;
    if(activeMatchId&&activeMatchId!==value.matchId)return;
    session.online={...session.online,match:null,matchId:null,queued:false};
    if(transitioning){if(window.webpvpLobbyHandoff)window.webpvpLobbyHandoff.reconnectEnded=value.matchId;return;}
    online.clearMatch();preparingMatch=null;queued=false;matchEntry.clear();workbench.classList.remove('entry-loading');
    audio.setLobby(true);keyDialog?.setLocked(false);lobby?.setLocked(false);lobby?.status({queued:false,available:true});showLobby();
    status.textContent='Match ended. You are back in the lobby.';return;
   }
   if(released||transitioning)return;
   if(type==='match-preparing'){beginPreparation(value);return;}
   if(type==='match-preparation-ended'&&value.id===preparingMatch?.id){
    preparingMatch=null;matchEntry.clear();workbench.classList.remove('entry-loading');audio.setLobby(true);lobby?.show(true);
    lobby?.error('Room setup was interrupted. Rejoining the queue…');return;
   }
   if(type==='status'){
    queued=Boolean(value?.queued||value?.matchId||value?.match);lobby?.status(value);if(!preparingMatch)audio.setQueue(value);keyDialog?.setLocked(queued);
    if(value?.professionId){const next=normalizeProfessionId(value.professionId,{fallback:true});
     if(next!==professionId)configPanel?.close({force:true});professionId=next;session.professionId=professionId;syncHeader();}
    if(value?.match)void handoff({kind:'online',match:value.match});
   }
   if(type==='match'){audio.matchAccepted(value.id);void handoff({kind:'online',match:value});}
   if(type==='resource-delivery')lobby?.resourceDelivery(value);
   if(type==='room-aborted'){queued=false;showLobby();lobby?.error('The room was interrupted. You can queue again from the lobby.');}
  }});
 configPanel=createLobbyConfigurationPanel({document,host,configuration,getProfessionId:()=>professionId,
  canEdit:()=>canEdit()&&!keyDialog?.isOpen&&!guildPanel?.isOpen(),getKeyBindings:()=>keyBindings,
  onSound:key=>audio.play(key),onOpen:()=>lobby?.show(false),onClose:showLobby,onError:error=>lobby?.error('Failed to load skill setup: '+error.message)});
 createSkillBarSizeControl({document,host:tools,before:status,bar:configPanel.root.querySelector('.skill-bar'),storage});
 keyBindings=keyPreferences.preferences??keyPreferences.keyBindings??keyPreferences;
 keyDialog=createKeyBindingsDialog({host:workbench,value:keyBindings,assets:ui,assetBase:'/assets/ui/online/',
  onOpen(){guildPanel?.close();lobby?.show(false);},onClose:showLobby,
  async onSave(value){if(!canEdit())throw Error('Configuration is locked during matchmaking');await online.api('/api/key-preferences','PUT',value);keyBindings=value;}});
 keyDialog.setLocked(queued);
 guildPanel=createGuildPanel({document,host:workbench,assetUrl,onOpen:()=>lobby?.show(false),onClose:showLobby});
 async function confirmConfiguration(){if(!canEdit()||configPanel.busy)throw Error('Skill setup is saving or locked');
  const selected=professionId;await configuration.confirm(selected);
  if(!canEdit()||professionId!==selected)throw Error('Class changed. Review your setup and try again.');return selected;}
 lobby=createOnlineLobby({host,username:session.username,role:session.role,nickname:session.nickname??session.username,
  initialStatus:session.online,modes:session.modes??session.online?.modes,maps:mapStatus.maps,defaultSceneId:mapBackground?.sceneId??mapStatus.defaultSceneId??DEFAULT_SCENE_ID,
  professionId,professions:session.professions,professionFlags:session.professionFlags,professionDiagnostics:session.professionDiagnostics,
  costumes,assetUrl,resourceDelivery:session.resourceDelivery,
  onResourceDeliverySave:enabled=>online.api('/api/admin/resource-delivery','POST',{enabled}),
  async onProfessionChange(id){if(!canEdit()||configPanel.busy)throw Error('Classes cannot be changed right now');
   return online.api('/api/preferences/profession','POST',{professionId:id});},
  onEffectiveProfessionChange(id){if(released||transitioning)return;const next=normalizeProfessionId(id,{fallback:true});
   if(next!==professionId)configPanel?.close({force:true});professionId=next;session.professionId=professionId;syncHeader();},
  async onCostumeChange(costumeId){if(!canEdit())throw Error('Costumes cannot be changed right now');const value=await online.api('/api/preferences/costume','POST',{professionId,costumeId});
   costumes=normalizeCostumePreferences(value.costumes);session.costumes=costumes;return value;},
  async onProfessionToggle(id,enabled){const state=await online.api('/api/admin/professions');return online.api('/api/admin/professions','POST',{professions:{...state.professionFlags,[id]:enabled}});},
  async onNicknameSave(nickname){const value=await online.api('/api/nickname-preferences','PUT',{nickname});session.nickname=value.nickname;return value;},
  onSkills:()=>configPanel.open(),onKeys:()=>keyDialog.open(),onGuild:()=>{if(canEdit()&&!configPanel.busy)guildPanel.open();},
  async onPractice(sceneId){await confirmConfiguration();return handoff({kind:'practice',sceneId});},
  async onPractice2v2(sceneId){await confirmConfiguration();return handoff({kind:'practice2v2',sceneId});},
  async onQueue(mode){await confirmConfiguration();const value=await online.join(mode);
   queued=Boolean(value?.queued||value?.matchId||value?.match);keyDialog?.setLocked(queued);return value;},
  async onCancel(){if(failure)throw failure;const value=await online.cancel();
   queued=Boolean(value?.queued||value?.matchId||value?.match);keyDialog?.setLocked(queued);audio.cancelAccepted(value);return value;},
  onModeChange:(mode,enabled)=>online.api('/api/online/modes','POST',{mode,enabled}),
  onCapacitySave:limits=>online.setRoomCapacity(limits),onMapChange:(mapId,enabled)=>online.api('/api/online/maps','POST',{mapId,enabled}),
  onAccountCreate:(username,password)=>online.api('/api/admin/accounts','POST',{username,password})});
 workbench.querySelector('#logout').onclick=async()=>{if(transitioning)return;await online.api('/api/logout','POST');closeLocal();window.location.assign('/');};
 window.webpvpLobby={proof:()=>({mode:transitioning||preparingMatch?'loading':'lobby',professionId,modelLoads:0,nativeRuntimeLoads:0,
  background:{sceneId:mapBackground?.sceneId??mapStatus.defaultSceneId??DEFAULT_SCENE_ID,kind:mapBackground?'retired-map-image':'default-image'},battleRetirement,
  configuration:configuration.proof(),onlineConnected:!released,transitioning,released,preparingMatchId:preparingMatch?.id??null}),events:()=>structuredClone(events)};
 await online.open();if(!transitioning&&!released){status.textContent='';lobby.history(await online.api('/api/history'));}
 if(session.online?.match&&!transitioning)void handoff({kind:'online',match:session.online.match});
 return {configuration,lobby,configPanel,keyDialog,guildPanel,online,handoff,release};
}

