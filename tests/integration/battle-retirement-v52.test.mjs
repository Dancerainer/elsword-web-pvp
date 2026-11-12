/** Execute production return, UI locks, event callback and practice entries.
 * Only page I/O/render ownership is mocked; no Native/GPU assets are loaded. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function take(from,to,offset=0){
 const begin=source.indexOf(from,offset),end=source.indexOf(to,begin+from.length);
 assert.ok(begin>=0&&end>begin,'production source boundary: '+from);return source.slice(begin,end);
}
// Only dynamic import is replaced. Admission and lock rules are actual code.
const transaction=take('let returnFlight=null,battleRetired=false;','function handleOnlineError(')
 .replace("await import('./lobby-shell.mjs')",'await loadLobby()');
const controls=take('function updateModeControls(){','function dismissResultAndReturn(){');
const practice=take('async function startFreePractice(','async function acceptServerState(');
const errors=take('function handleOnlineError(','async function loadBattleMap(');
const initialize=source.indexOf('async function initializeOnline(');
const eventStart=source.indexOf('onEvent(type,value){',initialize),eventEnd=source.indexOf('\n  }});',eventStart);
assert.ok(initialize>0&&eventStart>initialize&&eventEnd>eventStart);
const eventCallback='function deliverOnlineEvent(type,value){'+source.slice(eventStart+'onEvent(type,value){'.length,eventEnd)+'\n}';

function fixture({locked=false}={}){
 const calls=[],raf=[],acknowledgements=[],maps=[],nodes=new Map();
 const node=()=>({hidden:false,disabled:false,textContent:'',classList:{add(){},remove(){},toggle(){}},
  setAttribute(){},toggleAttribute(){},querySelector(){return node();}});
 const select=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
 const app={dataset:{pageInitToken:'battle_token_12345'},append:el=>calls.push(['error',el.textContent])};
 const scene={isDisposed:false,render(){assert.ok([...c.views.values()].every(v=>v.root.enabled===false));calls.push('map-render');}};
 const makeView=()=>({root:{enabled:true,setEnabled(value){this.enabled=value;}},dispose(){calls.push('actor-dispose');}});
 const view=makeView(),other=makeView(),cache={disposed:false,dispose(){this.disposed=true;},proof(){return {disposed:this.disposed,containers:0,images:0,professions:0,json:0};}};
 const c={console:{error(){}},Event,active:true,paused:false,configurationLocked:locked,mode:'practice',launchIntent:{kind:'practice'},
  $:select,document:{querySelector:key=>key==='#app'?app:select(key),createElement:node},
  requestAnimationFrame:callback=>{raf.push(callback);return raf.length;},
  online:{api(url,method,body){calls.push(['handoff',url,method,body.pageInitToken]);return new Promise(resolve=>acknowledgements.push(resolve));},
   close(){calls.push('close');},clearMatch(){}},
  window:{dispatchEvent(){calls.push('identity');},rfWorkbench:{},webpvpLobbyHandoff:{}},
  mapGeneration:0,practiceGeneration:0,pvpPractice:{stop(){}},
  engine:{scenes:[scene],stopRenderLoop(){calls.push('stop-loop');},dispose(){calls.push('engine-dispose');scene.isDisposed=true;this.scenes=[];}},scene,
  resizeObserver:{disconnect(){}},battleLifetime:new AbortController(),meshCandidates:{commitEnabledChanges(){calls.push('commit-enabled');}},
  canvas:{focus(){},toDataURL(type){assert.equal(type,'image/png');assert.equal(calls.at(-1),'map-render');return 'data:image/png;base64,mapOnly';}},
  views:new Map([['a',view],['b',other]]),professionPracticeViews:new Map([['RF',new Map([['a',view]])]]),
  professionAssets:new Map([['RF',{}]]),professionPreferences:new Map([['RF',{}]]),professionAssetCache:cache,
  currentMapVersions:{sceneId:'besma-besma-lake-pvpmap'},simulation:{},practiceSimulation:{},nativeRuntime:{},geometryModule:{},
  closeDiagnostics(){calls.push('close-diagnostics');},pickerTooltip:{hide(){}},
  currentSession:{username:'private-retirement-fixture',role:'player'},diagnosticIds:[],practiceControlIds:new Set(),
  swordPrepare:node(),perfOutput:node(),professionId:'RF',profession:{name:'RF'},slotPreparation:false,preparingMatch:null,
  onlineMatch:null,authoritativePvp:null,motionInspector:null,isElswordProfession:()=>false,isElesisProfession:()=>false,
  isPvpMode:()=>false,keyBindings:{},preset:{skillKeys:['A']},coreKeyLabel:key=>key,mapLoading:false,bootLoading:null,
  DEFAULT_SCENE_ID:'besma-besma-lake-pvpmap',selectedPracticeMap:'besma-besma-lake-pvpmap',
  loadBattleMap(sceneId){calls.push(['map-load',sceneId]);return new Promise(resolve=>maps.push(resolve));},
  observeProfession(id){calls.push(['profession-observed',id]);},
  async loadLobby(){return {async startLobbyShell(options){calls.push(['open-lobby',options]);}};}};
 for(const name of ['professionSwitch','guildPanel','lobby','battleAudio','interfaceAudio','audioGesture','resourceTimings',
  'buffBar','pvpHud','addHud','wayOfSwordHud','awakeningBeadView','skillSwordCues','wayOfSwordParticles','nameplates','mapUvScroll'])
  c[name]={dispose(){calls.push('dispose-'+name);}};
 for(const name of ['effectsView','weaponTrails','damageNumbers','hitLighting','buffAfterimages','groundShadows','addSummonView','worldColorView','inputBuffer','resultPresentation','matchEntry'])
  c[name]={clear(){calls.push('clear-'+name);},dispose(){calls.push('dispose-'+name);}};
 Object.assign(c.professionSwitch,{busy:false,flush(){}});c.guildPanel.close=()=>{};
 Object.assign(c.lobby,{locked,shown:false,setLocked(value){this.locked=!!value;calls.push(['lobby-lock',this.locked]);},
  show(value){this.shown=!!value;calls.push(['lobby-show',this.shown]);},status(value){calls.push(['status',value]);}});
 Object.assign(c.interfaceAudio,{setLobby(){},setQueue(value){calls.push(['queue-audio',value]);}});
 Object.assign(c.matchEntry,{root:{hidden:true},waiting(){return false;},begin(){},progress(){},stage(){}});
 c.pickerDialog={destroy(){calls.push('destroy-picker');}};
 c.keyDialog={setLocked(value){this.locked=!!value;},destroy(){calls.push('destroy-keys');}};c.keyTranslator={releaseAll(){}};
 vm.createContext(c);vm.runInContext([transaction,controls,practice,errors,eventCallback].join('\n'),c);
 return {c,calls,view,cache,phase:()=>vm.runInContext('({returning:!!returnFlight,battleRetired})',c),
  async frame(){const callback=raf.shift();assert.ok(callback,'controlled animation frame is pending');callback(16);await Promise.resolve();},
  resolveAck(value){const resolve=acknowledgements.shift();assert.ok(resolve,'handoff reached its real API boundary');resolve(value);},
  resolveMap(value){const resolve=maps.shift();assert.ok(resolve,'actual practice entry reached the map boundary');resolve(value);}};
}
const count=(f,name)=>f.calls.filter(c=>Array.isArray(c)&&c[0]===name).length;
async function reachAck(f){await f.frame();assert.equal(count(f,'handoff'),0,'first RAF alone does not retire transport');await f.frame();assert.equal(count(f,'handoff'),1);}

test('return paints a locked lobby for two RAFs, awaits handoff and releases every battle owner once',async()=>{
 const f=fixture(),pending=f.c.returnToLightLobby(),duplicate=f.c.returnToLightLobby();
 assert.equal(f.c.lobby.shown,true);assert.equal(f.c.lobby.locked,true);assert.equal(f.c.configurationLocked,true);
 assert.equal(count(f,'handoff'),0);assert.equal(f.view.root.enabled,true,'resources stay owned until authenticated acknowledgement');
 await reachAck(f);assert.equal(f.calls.includes('engine-dispose'),false);assert.equal(f.c.lobby.locked,true);
 f.resolveAck({ok:true,pageInitToken:'new_lobby_token_12345'});assert.equal(await pending,true);assert.equal(await duplicate,true);
 assert.equal(count(f,'handoff'),1);assert.equal(f.calls.filter(c=>c==='actor-dispose').length,2,'shared practice/active view disposed once');
 assert.ok(f.calls.indexOf('clear-effectsView')<f.calls.indexOf('map-render'));
 assert.ok(f.calls.indexOf('commit-enabled')<f.calls.indexOf('map-render'));
 const opened=f.calls.find(c=>Array.isArray(c)&&c[0]==='open-lobby')[1];
 assert.equal(opened.mapBackground.sceneId,'besma-besma-lake-pvpmap');assert.match(opened.mapBackground.url,/^data:image\/png/);
 assert.equal(opened.battleRetirement.sceneDisposed,true);assert.equal(opened.battleRetirement.engineScenes,0);
 assert.equal(opened.battleRetirement.assetCache.disposed,true);assert.equal(opened.battleRetirement.listenersAborted,true);
 assert.equal(f.c.views.size,0);assert.equal(f.c.professionAssets.size,0);assert.equal(f.c.window.rfWorkbench,undefined);
 assert.equal(f.c.window.webpvpLobbyHandoff,undefined);assert.equal(f.c.nativeRuntime,null);
 assert.ok(f.calls.findIndex(c=>Array.isArray(c)&&c[0]==='open-lobby')>f.calls.indexOf('engine-dispose'),
  'new shell starts after every battle owner retires');assert.equal(f.phase().battleRetired,true);
});

test('idle status, old practice finally and duplicate free/PvP/return cannot reenter the visible retiring lobby',async()=>{
 const f=fixture();f.c.deliverOnlineEvent('status',{queued:false,available:true,professionId:'RF'});
 assert.equal(count(f,'status'),1,'actual status callback remains live outside retirement');
 const loading=f.c.startFreePractice();assert.equal(count(f,'map-load'),1);
 const pending=f.c.returnToLightLobby(),duplicate=f.c.returnToLightLobby();
 f.c.deliverOnlineEvent('status',{queued:false,available:true,professionId:'RF'});
 f.c.handleOnlineError({fatal:true,status:401,code:'login-required',message:'delayed old error'});
 assert.equal(count(f,'status'),1);assert.equal(f.calls.includes('close'),false,'old errors cannot retire the acknowledged owner early');
 f.resolveMap(false);await loading; // Production finally attempts to unlock.
 assert.equal(f.c.configurationLocked,true);assert.equal(f.c.lobby.locked,true);
 await f.c.startFreePractice();await f.c.startPvpPractice();assert.equal(count(f,'map-load'),1);
 await reachAck(f);await f.c.startFreePractice();await f.c.startPvpPractice();assert.equal(count(f,'map-load'),1);
 assert.equal(f.c.lobby.locked,true);assert.equal(f.view.root.enabled,true);
 f.resolveAck({ok:true,pageInitToken:'new_lobby_token_12345'});assert.equal(await pending,true);assert.equal(await duplicate,true);
 assert.equal(count(f,'handoff'),1);assert.equal(count(f,'open-lobby'),1);
});

for(const locked of [false,true])test(`bad ACK restores original lock=${locked}, retains resources and admits one clean retry`,async()=>{
 const f=fixture({locked}),pending=f.c.returnToLightLobby();await reachAck(f);f.resolveAck({ok:true,pageInitToken:'bad'});
 assert.equal(await pending,false);assert.equal(f.cache.disposed,false);assert.equal(f.view.root.enabled,true);
 assert.equal(f.c.battleLifetime.signal.aborted,false);assert.equal(f.c.mode,'practice');assert.equal(f.c.active,true);
 assert.equal(f.c.paused,false);assert.equal(f.c.configurationLocked,locked);assert.equal(f.c.lobby.locked,locked);
 assert.equal(f.phase().returning,false);assert.equal(count(f,'open-lobby'),0);
 const retry=f.c.returnToLightLobby();await f.frame();await f.frame();assert.equal(count(f,'handoff'),2);
 f.resolveAck({ok:true,pageInitToken:'retry_lobby_token_12345'});assert.equal(await retry,true);assert.equal(count(f,'open-lobby'),1);
});
