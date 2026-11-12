import {normalizeNickname,NICKNAME_MAX_LENGTH} from '../../packages/online/nickname.mjs';
import {COSTUMES,selectedCostume,normalizeCostumePreferences} from '../../packages/professions/costumes.mjs';
import {ONLINE_MODES,MODE_CONFIG,DEFAULT_MODE_FLAGS,isOnlineMode} from '../../packages/online/modes.mjs';
import {MAX_ROOMS_PER_MODE,normalizeRoomCapacity} from '../../packages/online/room-capacity.mjs';
import {DEFAULT_SCENE_ID,mapDisplayName} from '../../packages/online/map-pool.mjs';
import {PROFESSION_IDS,PROFESSION_DISPLAY_ORDER,PROFESSIONS,effectiveProfessionFlags,normalizeProfessionId,selectEnabledProfession} from '../../packages/professions/catalog.mjs';
import {createLobbyModePreference,availableLobbyMode} from './lobby-mode-preference.mjs';

export function createOnlineLobby({host,username,role,nickname=username,initialStatus,modes=DEFAULT_MODE_FLAGS,maps=[],defaultSceneId=DEFAULT_SCENE_ID,professionId='RF',professions,professionFlags=professions,professionDiagnostics=[],costumes={},resourceDelivery,onResourceDeliverySave,onCostumeChange,onProfessionChange,onProfessionToggle,onEffectiveProfessionChange,onNicknameSave,onSkills,onKeys,onGuild,onPractice,onPractice2v2,onQueue,onCancel,onModeChange,onCapacitySave,onMapChange,onAccountCreate,assetUrl=url=>url,clock}){
  const document=host.ownerDocument,root=document.createElement('section');root.className='online-lobby';
  const browser=document.defaultView??globalThis;
  let storage=null;try{storage=browser.localStorage;}catch{}
  const modePreference=createLobbyModePreference({storage,username});
  clock??={now:()=>browser.performance.now(),setTimeout:(callback,delay)=>browser.setTimeout(callback,delay),clearTimeout:timer=>browser.clearTimeout(timer)};
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const header=element('header','lobby-heading'),account=element('span','lobby-account');
  header.append(element('strong','lobby-brand','web pvp'),element('span','lobby-subtitle','Battle Lobby'),account);
  const intro=element('p','lobby-intro','Choose your class to prepare for battle.');
  const nicknameRow=element('div','lobby-nickname'),label=element('label',null,'Battle nickname'),input=element('input');
  input.type='text';input.maxLength=NICKNAME_MAX_LENGTH*2;input.setAttribute('aria-label','Battle nickname');input.autocomplete='nickname';label.append(input);
  const save=element('button',null,'Save nickname');save.type='button';save.dataset.action='nickname';
  const hint=element('small',null,`1–${NICKNAME_MAX_LENGTH} characters. Saved automatically before battle.`);nicknameRow.append(label,save,hint);
  const professionRow=element('section','lobby-profession-select'),professionGrid=element('div','lobby-profession-grid'),portraitButtons=new Map();
  professionGrid.setAttribute('role','radiogroup');professionGrid.setAttribute('aria-label','Class');
  for(const id of PROFESSION_DISPLAY_ORDER){
    const button=element('button','lobby-profession-card');button.type='button';button.dataset.action='choose-profession-'+id;button.dataset.professionId=id;
    button.setAttribute('role','radio');button.setAttribute('aria-label',PROFESSIONS[id].label);
    const image=element('img');image.src=assetUrl('/assets/ui/lobby/portraits/'+id.toLowerCase()+'.png');image.alt='';
    button.title=PROFESSIONS[id].name;
    button.append(image,element('span','lobby-profession-marker','◆'));
    portraitButtons.set(id,button);professionGrid.append(button);
  }
  const professionHint=element('small','profession-selection-note','Each class has its own saved skill setup');professionRow.append(element('h2',null,'Choose class'),professionGrid,professionHint);
  const costumeRow=element('section','lobby-costumes'),costumeLabel=element('label',null,'Costume'),costumeSelect=element('select');
  costumeSelect.setAttribute('aria-label','Costume');costumeSelect.dataset.action='costume';
  for(const [id,name]of Object.entries(COSTUMES)){
    const option=element('option',null,name);option.value=id;costumeSelect.append(option);
  }
  costumeLabel.append(costumeSelect);costumeRow.append(costumeLabel);
  costumeSelect.onchange=()=>{const choice=costumeSelect.value;return run('costume',()=>onCostumeChange?.(choice));};
  costumes=normalizeCostumePreferences(costumes);
  const professionControls=element('section','lobby-profession-controls'),professionButtons=new Map();professionControls.hidden=role!=='gm';professionControls.setAttribute('aria-label','GM class availability');
  if(role==='gm'){
    professionControls.append(element('strong',null,'GM class availability'));
    for(const id of PROFESSION_IDS){const button=element('button');button.type='button';button.dataset.action='profession-'+id;button.setAttribute('role','switch');professionButtons.set(id,button);professionControls.append(button);}
  }
  const actions=element('div','lobby-actions'),buttons=new Map(),queueOptions=element('div','lobby-mode-options');
  queueOptions.setAttribute('role','radiogroup');queueOptions.setAttribute('aria-label','Match mode');
  const deliveryControls=element('section','lobby-mode-controls'),deliveryButton=element('button');
  deliveryControls.hidden=role!=='gm';deliveryControls.setAttribute('aria-label','GM remote asset downloads');
  deliveryButton.type='button';deliveryButton.dataset.action='resource-delivery';deliveryButton.setAttribute('role','switch');
  if(role==='gm')deliveryControls.append(element('strong',null,'GM asset delivery'),deliveryButton,element('small',null,'When disabled, players use a local asset pack. Sign-in, matchmaking and battles remain available. Settings persist after restart.'));
  function syncDelivery(value){if(typeof value?.enabled==='boolean'&&(!resourceDelivery||value.revision>=resourceDelivery.revision)){resourceDelivery=value;render();}}
  deliveryButton.onclick=()=>run('resource-delivery',async()=>{const result=await onResourceDeliverySave?.(!resourceDelivery.enabled);syncDelivery(result);status.textContent='Remote asset settings saved';return result;});
  const queueActions={'1v1':'queue1v1','2v2':'queue','3v3':'queue3v3'};
  for(const [action,text]of [['skills','Skill setup'],['keys','Key bindings'],['guild','Guild skills'],['queue1v1','1v1 Duel'],['queue','2v2 Deathmatch'],['queue3v3','3v3 Deathmatch'],['cancel','Cancel matchmaking'],['practice','Free practice'],['practice2v2','2v2 Practice']]){
    const button=element('button',null,text);button.type='button';button.dataset.action=action;
    if(Object.values(queueActions).includes(action)){button.className='lobby-mode-option';button.setAttribute('role','radio');queueOptions.append(button);}
    else if(action!=='cancel')actions.append(button);
    buttons.set(action,button);
  }
  const matchStart=element('button','lobby-match-start','Find match');matchStart.type='button';matchStart.dataset.action='match-start';
  const matchDescription=element('p','lobby-match-description');
  const modeControls=element('section','lobby-mode-controls'),modeButtons=new Map();
  modeControls.setAttribute('aria-label','GM matchmaking controls');modeControls.hidden=role!=='gm';
  if(role==='gm'){
    modeControls.append(element('strong',null,'GM matchmaking'));
    for(const matchMode of ONLINE_MODES){const button=element('button');button.type='button';button.dataset.action='mode-'+matchMode;button.setAttribute('role','switch');modeButtons.set(matchMode,button);modeControls.append(button);}
  }
  let capacityForm=null,capacitySave=null,capacityFeedback=null;
  const capacityInputs=new Map(),capacityUsage=new Map();
  if(role==='gm'){
    capacityForm=element('form','lobby-capacity-controls');capacityForm.setAttribute('aria-label','GM room limits per mode');
    capacityForm.append(element('strong',null,'GM room limits'));
    for(const matchMode of ONLINE_MODES){
      const row=element('label','lobby-capacity-row',matchMode+' limit'),limit=element('input'),usage=element('span','lobby-capacity-usage');
      limit.type='number';limit.min='0';limit.max=String(MAX_ROOMS_PER_MODE);limit.step='1';limit.required=true;limit.value='';
      limit.dataset.action='capacity-'+matchMode;limit.setAttribute('aria-label',matchMode+' room limit');
      usage.dataset.action='capacity-usage-'+matchMode;usage.textContent='Occupied: — / — rooms';
      row.append(limit,usage);capacityForm.append(row);capacityInputs.set(matchMode,limit);capacityUsage.set(matchMode,usage);
    }
    capacitySave=element('button',null,'Save limits');capacitySave.type='submit';capacitySave.dataset.action='capacity-save';
    capacityFeedback=element('p','lobby-capacity-feedback');capacityFeedback.setAttribute('role','status');capacityFeedback.setAttribute('aria-live','polite');
    capacityForm.append(capacitySave,element('small',null,'Set a limit per mode. Zero pauses new rooms. Queued players keep waiting and existing matches continue.'),capacityFeedback);
  }
  const mapRow=element('section','lobby-map-select'),mapLabel=element('label',null,'Practice map'),mapSelect=element('select');
  mapSelect.setAttribute('aria-label','Practice map');mapLabel.append(mapSelect);mapRow.append(mapLabel,element('small',null,'Matchmaking picks a random enabled map. Practice can use any map.'));
  const mapControls=element('section','lobby-map-controls');mapControls.setAttribute('aria-label','GM map availability');mapControls.hidden=role!=='gm';
  if(role==='gm')mapControls.append(element('strong',null,'GM map pool'));
  const mapButtons=new Map();
  let accountForm=null,accountName=null,accountPassword=null,accountCreate=null,accountFeedback=null;
  if(role==='gm'){
    accountForm=element('form','lobby-account-create');accountForm.setAttribute('aria-label','GM player accounts');
    accountForm.append(element('strong',null,'GM player accounts'));
    const nameLabel=element('label',null,'New account'),passwordLabel=element('label',null,'Initial password');
    accountName=element('input','lobby-new-account');accountName.type='text';accountName.name='new-account';accountName.required=true;accountName.maxLength=64;accountName.autocomplete='off';accountName.setAttribute('aria-label','New account');
    accountPassword=element('input','lobby-new-password');accountPassword.type='password';accountPassword.name='new-password';accountPassword.required=true;accountPassword.minLength=6;accountPassword.maxLength=128;accountPassword.autocomplete='new-password';accountPassword.setAttribute('aria-label','Initial password');
    nameLabel.append(accountName);passwordLabel.append(accountPassword);
    accountCreate=element('button',null,'Create player account');accountCreate.type='submit';accountCreate.dataset.action='account-create';
    accountFeedback=element('p','lobby-account-feedback');accountFeedback.setAttribute('role','status');accountFeedback.setAttribute('aria-live','polite');
    accountForm.append(nameLabel,passwordLabel,accountCreate,element('small',null,'Use 1–64 characters for the username and 6–128 for the password. New accounts have player permissions.'),accountFeedback);
  }
  const status=element('p','lobby-status');status.setAttribute('role','status');
  const queueTime=element('p','lobby-queue-time');queueTime.hidden=true;queueTime.setAttribute('aria-label','Time spent in this queue');
  const history=element('section','lobby-history');history.setAttribute('aria-label','Match history');
  const layout=element('div','lobby-layout'),characterPanel=element('section','lobby-character-panel'),matchPanel=element('section','lobby-match-panel');
  characterPanel.append(professionRow,nicknameRow,costumeRow,mapRow,actions);
  matchPanel.append(element('h2',null,'Match settings'),queueOptions,matchDescription,matchStart,buttons.get('cancel'),status,queueTime);
  layout.append(characterPanel,matchPanel);
  const gmEntry=element('button','lobby-gm-entry','GM settings');gmEntry.type='button';gmEntry.dataset.action='gm-open';gmEntry.hidden=role!=='gm';
  const gmOverlay=element('div','lobby-gm-overlay');gmOverlay.hidden=true;gmOverlay.dataset.action='gm-window';
  const gmPanel=element('section','lobby-gm-panel');gmPanel.setAttribute('role','dialog');gmPanel.setAttribute('aria-modal','true');gmPanel.setAttribute('aria-label','GM settings');
  const gmHeader=element('header','lobby-gm-header'),gmClose=element('button','window-close','×');gmClose.type='button';gmClose.dataset.action='gm-close';gmClose.setAttribute('aria-label','Close GM settings');
  gmHeader.append(element('strong',null,'GM settings'),gmClose);
  const gmTabs=element('div','lobby-gm-tabs'),gmPages=new Map(),gmTabButtons=new Map();
  for(const [id,name]of [['match','Matchmaking'],['profession','Classes'],['map','Maps'],['service','Assets and accounts']]){
    const tab=element('button',null,name);tab.type='button';tab.dataset.action='gm-tab-'+id;tab.setAttribute('aria-pressed',String(id==='match'));gmTabs.append(tab);gmTabButtons.set(id,tab);
    const page=element('div','lobby-gm-page');page.dataset.page=id;page.hidden=id!=='match';gmPages.set(id,page);
    tab.onclick=()=>{for(const [key,node]of gmPages)node.hidden=key!==id;for(const [key,node]of gmTabButtons)node.setAttribute('aria-pressed',String(key===id));};
  }
  gmPages.get('match').append(modeControls);gmPages.get('profession').append(professionControls);gmPages.get('map').append(mapControls);gmPages.get('service').append(deliveryControls);
  if(accountForm)gmPages.get('service').append(accountForm);
  gmPanel.append(gmHeader,gmTabs,...gmPages.values());gmOverlay.append(gmPanel);
  header.append(gmEntry);root.append(header,intro,layout,history,gmOverlay);host.append(root);
  if(capacityForm)modeControls.append(capacityForm);
  const closeGm=()=>{gmOverlay.hidden=true;gmEntry.setAttribute('aria-expanded','false');gmEntry.focus?.();};
  gmEntry.setAttribute('aria-haspopup','dialog');gmEntry.setAttribute('aria-expanded','false');
  gmEntry.onclick=()=>{if(role!=='gm'||locked()||busy)return;gmOverlay.hidden=false;gmEntry.setAttribute('aria-expanded','true');gmClose.focus?.();};
  gmClose.onclick=closeGm;
  const keyboard=event=>{
    if(!gmOverlay.hidden&&event.key==='Escape'){event.preventDefault();closeGm();return;}
    if(event.code==='F8'&&!root.hidden&&gmOverlay.hidden&&!locked()&&!busy){event.preventDefault();matchStart.onclick();}
  };
  document.addEventListener?.('keydown',keyboard);
  let saved=nickname??username,serverStatus=initialStatus??{},statusRevision=0,busy=false,intentLocked=false,externalLock=false,disposed=false;
  let professionSelection=null,professionRequest=null,professionSelectionRun=null,professionRevision=0;
  let queued=false,joinedAt=null,elapsedSeconds=0,elapsedAnchor=0,queueTimer=null;
  let modeFlags={...DEFAULT_MODE_FLAGS,...modes},selectedMode=modePreference.read();
  const restoredMode=initialStatus?.match?.mode??(initialStatus?.queued?initialStatus.queue?.mode:null);
  if(isOnlineMode(restoredMode)){selectedMode=restoredMode;modePreference.save(selectedMode);}
  let roomCapacity=null,capacityDirty=false,capacityStatusRevision=0;
  let mapRows=maps,selectedMap=defaultSceneId;
  function syncCapacity(value,{force=false,preserveActive=false}={}){
    if(!value?.maxRoomsByMode)return false;
    let configuration;try{configuration=normalizeRoomCapacity({maxRoomsByMode:value.maxRoomsByMode});}catch{return false;}
    const revision=Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:null;
    // HTTP and SSE can overtake one another. Only the persisted server revision
    // orders settings; room occupancy continues to follow the ordered SSE stream.
    const acceptConfiguration=!roomCapacity||revision!==null&&(roomCapacity.revision===null||revision>=roomCapacity.revision)
      ||revision===null&&roomCapacity.revision===null;
    capacityStatusRevision++;
    roomCapacity={...(acceptConfiguration?{...configuration,revision}:roomCapacity),
      activeRoomsByMode:{...roomCapacity?.activeRoomsByMode,...(!preserveActive?value.activeRoomsByMode:{})}};
    for(const matchMode of ONLINE_MODES){
      const limit=capacityInputs.get(matchMode),active=roomCapacity.activeRoomsByMode[matchMode],maximum=roomCapacity.maxRoomsByMode[matchMode];
      if(limit&&(force||!capacityDirty))limit.value=String(maximum);
      const usage=capacityUsage.get(matchMode);if(usage)usage.textContent='Occupied: '+(Number.isInteger(active)?active:'—')+' / '+maximum+' rooms'+(maximum===0?' · New rooms paused':'');
    }
    return acceptConfiguration;
  }
  let rawProfessions={RF:true,LK:true,...professionFlags},enabledProfessions=effectiveProfessionFlags(rawProfessions);
  // Refresh may boot a frozen profession that GM has since closed. Keep that
  // identity from the authenticated session before any network event arrives.
  let selectedProfession=serverStatus.queued||serverStatus.matchId||serverStatus.match
    ?normalizeProfessionId(serverStatus.professionId??professionId,{fallback:true}):selectEnabledProfession(professionId,rawProfessions);
  function syncProfessions(value,{notify=false}={}){
    if(value?.costumes)costumes=normalizeCostumePreferences(value.costumes);
    if(Array.isArray(value?.professionDiagnostics))professionDiagnostics=value.professionDiagnostics;
    if(value?.professionFlags)rawProfessions={...rawProfessions,...value.professionFlags};
    else if(value?.professions)rawProfessions={...rawProfessions,...value.professions};
    // A profession-only acknowledgement cannot infer resource availability
    // from the GM switches; retain the latest server effective availability.
    if(value?.professions)enabledProfessions=effectiveProfessionFlags(value.professions);
    else if(value?.professionFlags)enabledProfessions=effectiveProfessionFlags(rawProfessions);
    const next=locked()?selectedProfession:selectEnabledProfession(value?.professionId??selectedProfession,enabledProfessions),previous=selectedProfession;selectedProfession=next;
    professionHint.textContent=PROFESSION_IDS.every(id=>rawProfessions[id]===false)?'All classes disabled by the GM. RF is selected by default. Class setups are saved.':'Your class selection and each skill setup are saved to your account.';
    if(notify&&previous!==next)onEffectiveProfessionChange?.(next);
  }
  function syncMaps(next){
    mapRows=next??[];mapRow.hidden=mapRows.length===0;
    mapSelect.textContent='';
    for(const row of mapRows){const option=element('option',null,mapDisplayName(row)+(row.enabled===false?' (matchmaking disabled)':''));option.value=row.id;mapSelect.append(option);}
    if(!mapRows.some(row=>row.id===selectedMap))selectedMap=mapRows[0]?.id??defaultSceneId;
    mapSelect.value=selectedMap;
    if(role==='gm')for(const row of mapRows){
      let button=mapButtons.get(row.id);
      if(!button){button=element('button');button.type='button';button.dataset.action='map-'+row.id;button.setAttribute('role','switch');mapButtons.set(row.id,button);mapControls.append(button);
        button.onclick=()=>run('maps',()=>onMapChange?.(row.id,mapRows.find(m=>m.id===row.id)?.enabled===false));}
      button.textContent=mapDisplayName(row)+': '+(row.enabled===false?'Disabled':'Enabled');button.setAttribute('aria-checked',String(row.enabled!==false));
    }
  }
  mapSelect.onchange=()=>{if(!locked()&&!busy)selectedMap=mapSelect.value;};
  input.value=saved;
  const showAccount=()=>{account.textContent=saved+' · '+(role==='gm'?'GM':'Player account');};
  const locked=()=>Boolean(externalLock||intentLocked||serverStatus.queued||serverStatus.matchId||serverStatus.match);
  const elapsed=()=>elapsedSeconds+(queued?Math.max(0,clock.now()-elapsedAnchor)/1000:0);
  function clearQueueTimer(){if(queueTimer!==null){clock.clearTimeout(queueTimer);queueTimer=null;}}
  function renderQueueTime(){
    queueTime.hidden=!queued;
    if(!queued||disposed){clearQueueTimer();return;}
    const total=elapsed(),seconds=Math.floor(total),minutes=Math.floor(seconds/60);
    queueTime.textContent='Wait time: '+(minutes?minutes+' m '+seconds%60+' s':seconds+' s');
    if(root.hidden){clearQueueTimer();return;}
    if(queueTimer===null){
      queueTimer=clock.setTimeout(()=>{queueTimer=null;renderQueueTime();},Math.max(1,Math.ceil((seconds+1-total)*1000)));
      queueTimer?.unref?.();
    }
  }
  function syncQueue(value){
    const waiting=!!value?.queued&&!value.match&&!value.matchId,queue=value?.queue??{};
    if(!waiting){queued=false;joinedAt=null;elapsedSeconds=0;clearQueueTimer();renderQueueTime();return;}
    const nextJoinedAt=Number.isFinite(queue.joinedAt)?queue.joinedAt:null;
    const newEntry=!queued||joinedAt!==null&&nextJoinedAt!==null&&joinedAt!==nextJoinedAt;
    const authoritative=Number.isFinite(queue.elapsedSeconds)&&queue.elapsedSeconds>=0?queue.elapsedSeconds:null;
    // joinedAt identifies this queue entry; never subtract its wall-clock value
    // from the browser clock. Refreshes seed elapsed from the server, then this
    // page adds only monotonic time. Pool/deadline changes preserve the anchor.
    elapsedSeconds=newEntry?(authoritative??0):Math.max(elapsed(),authoritative??0);
    elapsedAnchor=clock.now();queued=true;joinedAt=nextJoinedAt??joinedAt;clearQueueTimer();renderQueueTime();
  }
  function render(){
    if(disposed)return;
    if(!locked()){
      const next=availableLobbyMode(selectedMode,modeFlags,mapRows);
      if(next!==selectedMode){selectedMode=next;modePreference.save(next);}
    }
    deliveryButton.disabled=busy||!resourceDelivery;
    deliveryButton.textContent='Remote asset downloads: '+(resourceDelivery?.enabled?'Enabled':'Disabled');deliveryButton.setAttribute('aria-checked',String(resourceDelivery?.enabled===true));
    const lock=locked();input.disabled=lock||busy;save.disabled=lock||busy||input.value===saved;
    if(capacityForm){for(const limit of capacityInputs.values())limit.disabled=busy;capacitySave.disabled=busy||!roomCapacity;capacitySave.textContent=busy?'Please wait…':'Save limits';}
    if(accountForm){accountName.disabled=accountPassword.disabled=accountCreate.disabled=lock||busy;accountCreate.textContent=busy?'Please wait…':'Create player account';}
    mapSelect.disabled=lock||busy;
    const displayedProfession=professionSelection??selectedProfession;
    for(const [id,button]of portraitButtons){button.disabled=lock||(busy&&professionRequest===null)||!enabledProfessions[id];button.setAttribute('aria-checked',String(id===displayedProfession));
      button.setAttribute('aria-busy',String(professionSelection!==null&&id===displayedProfession));
      button.title=PROFESSIONS[id].label+(enabledProfessions[id]?'':rawProfessions[id]===false?' · Disabled by GM':' · Assets unavailable');}
    costumeSelect.disabled=lock||busy;costumeSelect.value=selectedCostume(costumes,selectedProfession);
    gmEntry.disabled=lock||busy;if(lock&&!gmOverlay.hidden)closeGm();
    matchStart.disabled=lock||busy||modeFlags[selectedMode]===false;
    matchStart.textContent=serverStatus.queued?'Searching…':busy?'Please wait…':'Find match · F8';
    const spec=MODE_CONFIG[selectedMode];matchDescription.textContent=selectedMode==='1v1'?'Duel · Defeat your opponent to win':selectedMode+' Team Deathmatch · First team to '+spec.scoreLimit+' kills wins';
    for(const [id,button]of professionButtons){const enabled=rawProfessions[id]!==false;button.disabled=busy;button.textContent=PROFESSIONS[id].label+': '+(enabled?'Enabled':'Disabled');button.setAttribute('aria-checked',String(enabled));}
    for(const button of mapButtons.values())button.disabled=busy;
    buttons.get('cancel').hidden=!serverStatus.queued;
    for(const [action,button]of buttons)button.disabled=busy||(lock&&action!=='cancel');
    for(const matchMode of ONLINE_MODES){
      const button=buttons.get(queueActions[matchMode]),enabled=modeFlags[matchMode]!==false;
      button.dataset.mode=matchMode;button.hidden=false;button.disabled||=!enabled;
      button.textContent=matchMode+(matchMode==='1v1'?' Duel':' Deathmatch')+(enabled?'':' · Unavailable');button.title=enabled?'Select '+matchMode+' match':'Unavailable';button.setAttribute('aria-checked',String(matchMode===selectedMode));
      if(mapRows.length&&!mapRows.some(row=>row.enabled!==false&&row.modes?.includes(matchMode))){button.disabled=true;button.title='The GM disabled all maps';}
      const control=modeButtons.get(matchMode);if(control){control.disabled=busy;control.textContent=matchMode+': '+(enabled?'Enabled':'Disabled');control.setAttribute('aria-checked',String(enabled));control.title=enabled?'Disable '+matchMode+' matchmaking':'Enable '+matchMode+' matchmaking';}
    }
    matchStart.disabled||=buttons.get(queueActions[selectedMode]).disabled;
    showAccount();
  }
  function setNickname(value){saved=value?.nickname??value??username;input.value=saved;render();}
  async function persist(){
    if(input.value===saved)return saved;
    const next=normalizeNickname(input.value);
    if(next!==saved){
      if(typeof onNicknameSave!=='function')throw Error('Nickname saving is unavailable');
      const result=await onNicknameSave(next);saved=normalizeNickname(result?.nickname??next);
    }
    input.value=saved;showAccount();return saved;
  }
  async function run(action,callback,matchMode){
    if(disposed||busy||(locked()&&!['cancel','modes','maps','professions'].includes(action))||action==='queue'&&modeFlags[matchMode]===false)return false;
    const revision=statusRevision;
    busy=true;render();
    try{
      if(['nickname','queue','practice2v2'].includes(action))await persist();
      const result=await callback?.(selectedMap);
      if(disposed)return false;
      if(action==='queue'){
        selectedMode=matchMode;modePreference.save(matchMode);
        // A named status/match can overtake the HTTP response. An earlier
        // successful queue response must not revive a queue already exited.
        if(typeof result?.queued==='boolean'&&statusRevision===revision)applyStatus(result);
        else if(statusRevision===revision){serverStatus={...serverStatus,queued:true,queue:{mode:matchMode}};syncQueue(serverStatus);}
        intentLocked=!!serverStatus.queued;
      }
      if(action==='practice2v2'&&root.hidden)intentLocked=true;
      if(action==='cancel'){
        intentLocked=false;
        if(typeof result?.queued==='boolean'&&statusRevision===revision)applyStatus(result);
        else {serverStatus={...serverStatus,queued:false};syncQueue(serverStatus);}
      }
      if(action==='nickname')status.textContent='Nickname saved';
      if(action==='modes'&&statusRevision===revision&&result?.modes){
        if(typeof result.queued==='boolean')applyStatus(result);else{modeFlags={...modeFlags,...result.modes};render();}
      }
      if(action==='maps'&&Array.isArray(result?.maps)&&statusRevision===revision){syncMaps(result.maps);status.textContent='Map pool saved';}
      // A newer server status may already enforce a GM fallback or freeze a
      // queue choice. The earlier HTTP save cannot restore its older flags.
      if(action==='profession'&&result&&statusRevision===revision){syncProfessions(result);status.textContent='Class saved · '+PROFESSIONS[selectedProfession].label;}
      if(action==='costume'&&result){costumes=normalizeCostumePreferences(result.costumes);status.textContent='Costume saved · '+COSTUMES[selectedCostume(costumes,selectedProfession)];}
      if(action==='professions'&&result&&statusRevision===revision){syncProfessions(result,{notify:!locked()});status.textContent='Class settings saved';}
      return result;
    }catch(error){
      if(action==='profession'&&statusRevision!==revision)return false;
      if(error.code==='mode-disabled'&&isOnlineMode(matchMode)){modeFlags[matchMode]=false;status.textContent=matchMode+' · Disabled by GM';}
      else status.textContent=String(error.message??error);
      return false;
    }
    finally{busy=false;render();}
  }
  input.oninput=render;
  for(const limit of capacityInputs.values())limit.oninput=()=>{capacityDirty=true;capacityFeedback.textContent='Unsaved room limits';};
  if(capacityForm)capacityForm.onsubmit=async event=>{
    event?.preventDefault?.();if(disposed||busy||!roomCapacity)return false;
    let configuration;
    try{
      const maxRoomsByMode=Object.fromEntries(ONLINE_MODES.map(matchMode=>{
        const value=String(capacityInputs.get(matchMode).value).trim();if(!/^\d+$/.test(value))throw Error('invalid-room-capacity');
        return [matchMode,Number(value)];
      }));configuration=normalizeRoomCapacity({maxRoomsByMode});
    }catch{capacityFeedback.textContent='Room limits must be whole numbers from 0 to'+MAX_ROOMS_PER_MODE+' .';return false;}
    const stateRevision=capacityStatusRevision;busy=true;render();capacityFeedback.textContent='Saving limits…';
    try{
      if(typeof onCapacitySave!=='function')throw Error('Room limits unavailable');
      const result=await onCapacitySave(configuration.maxRoomsByMode);if(disposed)return false;
      normalizeRoomCapacity({maxRoomsByMode:result?.maxRoomsByMode});
      capacityDirty=false;
      const accepted=syncCapacity(result,{force:true,preserveActive:capacityStatusRevision!==stateRevision});
      capacityFeedback.textContent=accepted?'Room limits saved.':'Showing the latest limits from the server.';
      return result;
    }catch(error){if(!disposed)capacityFeedback.textContent=error.code==='gm-required'?'Only GMs can set room limits.':error.code==='invalid-room-capacity'?'Room limits must be whole numbers from 0 to'+MAX_ROOMS_PER_MODE+' .':'Could not save room limits. Try again later.';return false;}
    finally{busy=false;render();}
  };
  if(accountForm)accountForm.onsubmit=async event=>{
    event?.preventDefault?.();
    if(disposed||busy||locked())return false;
    const nextUsername=accountName.value.trim(),password=accountPassword.value;
    if(!nextUsername||nextUsername.length>64||/[\u0000-\u001f\u007f]/.test(nextUsername)){accountFeedback.textContent='Usernames must have 1–64 characters and cannot contain control characters.';return false;}
    if(password.length<6||password.length>128){accountFeedback.textContent='Passwords must have 6–128 characters, including spaces.';return false;}
    busy=true;accountFeedback.textContent='Creating account…';render();
    try{
      if(typeof onAccountCreate!=='function')throw Object.assign(Error('account-create-unavailable'),{code:'account-create-unavailable'});
      const result=await onAccountCreate(nextUsername,password);
      if(disposed)return false;
      accountName.value='';accountPassword.value='';
      accountFeedback.textContent='Player account '+(result?.username??nextUsername)+' created.';
      return result;
    }catch(error){
      if(disposed)return false;
      const messages={
        'account-exists':'Username taken. Choose another name.',
        'invalid-account':'Enter a valid username and password.',
        'invalid-username':'Usernames must have 1–64 characters and cannot contain control characters.',
        'invalid-password':'Passwords must have 6–128 characters, including spaces.',
        'account-save-failed':'Could not save account. Try again later.',
        'login-required':'Session expired. Sign in again.',
        'gm-required':'Only GMs can add accounts.',
        'origin-denied':'Request origin verification failed. Reload the page and try again.',
        'account-create-unavailable':'Account creation unavailable.',
      };
      accountFeedback.textContent=messages[error?.code]??'Could not create account. Try again later.';return false;
    }finally{busy=false;render();}
  };
  save.onclick=()=>run('nickname');
  function selectProfession(requested){
    if(disposed||locked()||(busy&&professionRequest===null)||!enabledProfessions[requested])return false;
    if(!professionSelectionRun&&requested===selectedProfession)return true;
    // Publish the user's visual choice immediately, but keep the confirmed
    // identity and all match/configuration actions frozen until the POST ends.
    // Rapid choices collapse to the latest target behind one in-flight save.
    professionSelection=requested;status.textContent='Saving class · '+PROFESSIONS[requested].label;
    if(professionSelectionRun){render();return professionSelectionRun;}
    professionRequest=requested;busy=true;render();
    professionSelectionRun=(async()=>{
      let result=true;
      while(professionSelection!==null&&!disposed&&!locked()){
        const target=professionSelection;
        // A queued return to the previous choice still needs its POST: the
        // earlier in-flight request may have persisted a different profession.
        const revision=professionRevision,statusBefore=statusRevision;professionRequest=target;
        try{
          result=await onProfessionChange?.(target);
          if(disposed)return false;
          if(professionRevision===revision&&result){
            // An unrelated map/capacity broadcast is not a rejection of this
            // save. Retain its newer flags while accepting this request's id.
            syncProfessions(statusRevision===statusBefore?result:{professionId:result.professionId??target},{notify:true});
            status.textContent='Class saved · '+PROFESSIONS[selectedProfession].label;
          }
        }catch(error){result=false;if(!disposed&&professionRevision===revision)status.textContent=String(error.message??error);}
        if(professionSelection===target||locked()||!enabledProfessions[professionSelection])professionSelection=null;
        if(professionSelection!==null)status.textContent='Saving class · '+PROFESSIONS[professionSelection].label;
        render();
      }
      return result;
    })().finally(()=>{professionSelection=null;professionRequest=null;professionSelectionRun=null;busy=false;render();});
    return professionSelectionRun;
  }
  for(const [requested,button]of portraitButtons)button.onclick=()=>selectProfession(requested);
  for(const [id,button]of professionButtons)button.onclick=()=>run('professions',()=>onProfessionToggle?.(id,rawProfessions[id]===false));
  const callbacks={skills:onSkills,keys:onKeys,guild:onGuild,practice:onPractice,practice2v2:onPractice2v2,cancel:onCancel};
  for(const [action,callback]of Object.entries(callbacks))buttons.get(action).onclick=()=>run(action,callback);
  for(const matchMode of ONLINE_MODES){
    buttons.get(queueActions[matchMode]).onclick=()=>{if(locked()||busy||modeFlags[matchMode]===false)return false;selectedMode=matchMode;modePreference.save(matchMode);render();return true;};
    const control=modeButtons.get(matchMode);if(control)control.onclick=()=>run('modes',()=>onModeChange?.(matchMode,modeFlags[matchMode]===false));
  }
  matchStart.onclick=()=>matchStart.disabled?false:run('queue',()=>onQueue?.(selectedMode),selectedMode);
  function applyStatus(value){
    if(disposed)return;
    const previousProfession=selectedProfession,previousLock=locked(),previousRequestEnabled=enabledProfessions[professionRequest],
      previousProfessionNotice=serverStatus.queueNotice?.reason==='profession-disabled';
    serverStatus=value??{};if(value?.modes)modeFlags={...modeFlags,...value.modes};if(Array.isArray(value?.maps))syncMaps(value.maps);if(value?.roomCapacity)syncCapacity(value.roomCapacity);statusRevision++;intentLocked=false;syncQueue(serverStatus);
    if(value?.professions||value?.professionFlags||value?.professionId)syncProfessions(value,{notify:!locked()});
    const professionChanged=previousProfession!==selectedProfession||previousLock!==locked()||previousRequestEnabled!==enabledProfessions[professionRequest]
      ||previousProfessionNotice!==(serverStatus.queueNotice?.reason==='profession-disabled');
    if(professionChanged)professionRevision++;
    if((professionChanged&&professionSelection===professionRequest)||locked()||!enabledProfessions[professionSelection])professionSelection=null;
    const queue=value?.queue??{};
    if(value?.queued&&isOnlineMode(queue.mode??value.mode)){selectedMode=queue.mode??value.mode;modePreference.save(selectedMode);}
    render();
    const capacity=value?.roomCapacity?{...value.roomCapacity,...roomCapacity}:null;
    const capacityWait=capacity?.waitingForCapacity
      ?' · Waiting for a free '+selectedMode+' room'+(Number.isInteger(capacity.activeRoomsByMode?.[selectedMode])&&Number.isInteger(capacity.maxRoomsByMode?.[selectedMode])
        ?' · Occupied: '+capacity.activeRoomsByMode[selectedMode]+'/'+capacity.maxRoomsByMode[selectedMode]+' rooms'+(capacity.maxRoomsByMode[selectedMode]===0?' · New rooms paused':''):'')
      :queue.remainingSeconds!=null?' · '+Math.ceil(queue.remainingSeconds)+' s':'';
    status.textContent=value?.queued?'Searching for '+selectedMode+' · '+(queue.size??value.queueSize??0)+' players'+capacityWait:value?.queueNotice?.reason==='room-worker-unavailable'?'The room was interrupted. You can queue again from the lobby.':value?.queueNotice?.reason==='profession-disabled'?'Left queue: the GM disabled your class':value?.queueNotice?.reason==='maps-disabled'?'Left queue: the GM disabled all maps':value?.queueNotice?.reason==='mode-disabled'?(value.queueNotice.mode??selectedMode)+' · Left queue: mode disabled by GM':value?.available===false?'Online assets unavailable':'Ready';
    if(professionSelection!==null)status.textContent='Saving class · '+PROFESSIONS[professionSelection].label;
  }
  syncMaps(maps);syncProfessions({professionId,professions,professionFlags:rawProfessions});
  if(initialStatus)applyStatus(initialStatus);else render();
  return {root,show(value){root.hidden=!value;renderQueueTime();},setPracticeMap(sceneId){if(!mapRows.some(row=>row.id===sceneId))return false;selectedMap=sceneId;mapSelect.value=sceneId;return true;},setNickname,get nickname(){return saved;},get professionId(){return selectedProfession;},
    setLocked(value){const wasLocked=locked();externalLock=!!value;if(!value)intentLocked=false;
      if(wasLocked!==locked()){professionRevision++;if(locked())professionSelection=null;}render();},
    resourceDelivery:syncDelivery,status:applyStatus,history(value){const h=value?.history??value??{};history.textContent='Record: W '+(h.wins??0)+' / L '+(h.losses??0)+' / D '+(h.draws??0)+' K / A / D '+(h.kills??0)+' / '+(h.assists??0)+' / '+(h.deaths??0)+' · Overall KDA '+(h.kdaDisplay??(h.kda===null?'∞':h.kda??0));},
    error(message){status.textContent=message;},dispose(){disposed=true;professionSelection=null;queued=false;clearQueueTimer();document.removeEventListener?.('keydown',keyboard);if(accountPassword)accountPassword.value='';root.hidden=true;root.remove?.();}};
}
