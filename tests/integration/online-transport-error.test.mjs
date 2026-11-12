import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createInputPredictionHistory} from '../../apps/web/input-prediction.mjs';
import {createMatchEntry} from '../../apps/web/match-entry.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createSpectatorCamera} from '../../apps/web/spectator-camera.mjs';
import {selectedCostume,costumeCharacter,normalizeCostumePreferences} from '../../packages/professions/costumes.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings,coreKeyLabel} from '../../packages/input/key-bindings.mjs';
import {isElswordProfession,isElesisProfession} from '../../packages/professions/identity.mjs';

const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const eventRecorder=source.match(/^function recordEvent\(event\).*$/m)?.[0];
assert.ok(eventRecorder,'execute the production bounded diagnostic recorder');
const modeGuards=['isPvpMode','ownsLocalUnit'].map(name=>{
  const declaration=source.match(new RegExp('^const '+name+'=.*;$','m'))?.[0];
  assert.ok(declaration,'production '+name+' guard is present');return declaration;
}).join('\n');
const tick=source.slice(source.indexOf('function tick('),source.indexOf("listenBattleWindow('keydown'"));
const controls=source.slice(source.indexOf('const diagnosticIds='),source.indexOf('function returnToLobby(){'));
const lifecycle=source.slice(source.indexOf('function returnToLobby(){'),source.indexOf('\nasync function acceptServerState'));
const accept=source.slice(source.indexOf('async function acceptServerState('),source.indexOf('\nasync function initializeOnline'));
const reportLoading=source.slice(source.indexOf('function reportLoading('),source.indexOf('\nlet onlineFactory,'));
assert.ok(reportLoading.startsWith('function reportLoading(')&&reportLoading.includes('online.loadingProgress('),'execute production loading progress callback');
const stateHandler=source.slice(source.indexOf("    if(type==='state')",source.indexOf('online=createOnlineClient')),source.indexOf("    if(type==='input')",source.indexOf('online=createOnlineClient')));
const callbacks=source.slice(source.indexOf('  lobby=createOnlineLobby('),source.indexOf('  const prefs=await online.api'));
// The published lazy lobby now releases its handoff before online.open().
// Extract the whole initialization tail, including that production ordering.
const startup=source.slice(source.indexOf("  mode=lobbyHandoff?'loading':'lobby';",source.indexOf('async function initializeOnline')),source.indexOf('\n}\n\ntry {',source.indexOf('async function initializeOnline')));
assert.ok(lifecycle.includes('function handleOnlineError(')&&startup.startsWith("  mode=lobbyHandoff?"),'execute production lifecycle and initialization callbacks');
const packet={held:['Z'],pressed:['Z'],released:[],sampledDevice:true,pureDouble:[],oneDouble:[]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

/** The VM executes the actual game callbacks. Only rendering/network services
 * are recorded here; this fixture does not assert original combat behavior. */
function fixture(options={}){
  const frameSeq=Object.hasOwn(options,'frameSeq')?options.frameSeq:2,role=options.role??'player';
  const calls=[],elements=new Map(),element=()=>({classList:{toggle(){}},hidden:false,disabled:false,textContent:'',querySelector:selector=>$(selector),click(){this.onclick?.();}});
  const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const practiceSnapshot={versions:{fixture:'unchanged'},actors:[{id:'practice',loadout:[]}]};
  const practice={state:structuredClone(practiceSnapshot),restore(value){calls.push('restore');this.state=structuredClone(value);},view(){return this.state;},actor(id){return this.state.actors.find(a=>a.id===id);}};
  const battle={state:{actors:[{id:'a',loadout:[]},{id:'b',loadout:[]}]},view(){return this.state;},step(dt,inputs){calls.push(['step',dt,structuredClone(inputs)]);},drainEvents(){return [];},actor(id){return this.state.actors.find(a=>a.id===id);}};
  const practiceView={root:{setEnabled(value){calls.push(['practice-enabled',value]);}},dispose(){assert.fail('practice view must remain reusable');}};
  const battleView={root:{setEnabled(){}},dispose(){calls.push('dispose-online-view');}};
  const prediction=createInputPredictionHistory(),inputBuffer=createInputBuffer({sampledLevels:true}),keyBindings=normalizeKeyBindings(),keyTranslator=createKeyBindingTranslator(keyBindings);
  prediction.record(1,packet);keyTranslator.down('KeyZ');inputBuffer.down('Z',0);
  const lobby={setPracticeMap(){},root:{querySelector:$},show(value){calls.push(['lobby-show',value]);},setLocked(value){calls.push(['lobby-locked',value]);},status(value){calls.push(['lobby-status',value]);},error(message){calls.push(['lobby-error',message]);},history(value){calls.push(['history',value]);}};
  const online={close(){calls.push('close-online');},clearMatch(){calls.push('clear-match');},api:async()=>({}),
    notifyOwnerCapacity(){calls.push(['owner-capacity']);},
    send(input,report){calls.push(['send',structuredClone(input),structuredClone(report)]);return frameSeq;},ready:async()=>{calls.push('ready');},join:async()=>{calls.push('join');},cancel:async()=>{calls.push('cancel');},
    loadingProgress:async(id,percent)=>{calls.push(['loading-progress',id,percent]);}};
  const state={structuredClone,Number,Object,Error,isElswordProfession,isElesisProfession,createProfessionSwitch,assetUrl:url=>url,performance:{now:()=>1000},$,professionId:'RF',professionEpoch:0,
    costumePreferences:normalizeCostumePreferences(),selectedCostume,costumeCharacter,normalizeCostumePreferences,
    professionPreferences:new Map(),branchChoices:{},skillPreferences:{save:async value=>structuredClone(value)},profession:{id:'RF',name:'Reckless Fist',label:'RF · Reckless Fist'},
    // This fixture exercises the retained direct-workbench path. Lazy-shell
    // handoff and receipt/loading clocks have their own production-boundary tests.
    lobbyHandoff:null,presentedResultReceipt:null,addSummonView:null,usesCombatPlayback:()=>false,
    document:{querySelector:$},active:true,mode:'online',paused:false,configurationLocked:true,currentSession:{username:'a',role},
    session:{username:'a',role,online:{modes:options.modeFlags}},onlineTransportError:null,online,lobby,onlineMatch:{id:'m',players:[{id:'a'},{id:'b'}]},localPlayerId:'a',
    authoritativePvp:{phase:'fight'},lastServerSequence:8,lastServerAt:0,onlineStarting:false,pendingLoadingState:null,
    scene:{whenReadyAsync:async()=>{}},
    ownershipMode:options.ownershipMode??null,practiceGeneration:0,pvpPractice:null,mapLoading:false,mapGeneration:0,selectedPracticeMap:'sander-garpai-rock-pvp',currentMapVersions:{sceneId:'sander-garpai-rock-pvp'},DEFAULT_SCENE_ID:'sander-garpai-rock-pvp',MAP_NAMES:{},mapStatus:{maps:[],defaultSceneId:'sander-garpai-rock-pvp'},
    ownershipSync:{clear(){calls.push('clear-ownership');},beforeStep(simulation,id){calls.push(['before-owned-step',simulation,id]);},
      recordSentFrame(simulation,id,sourceFrame){calls.push(['owned-sent-frame',simulation,id,sourceFrame]);},
      afterStep(simulation,id,events){calls.push(['after-owned-step',simulation,id,events]);return options.ownerReport??null;}},
    ownedPresentation:{clear(){calls.push('clear-owned-presentation');}},
    practiceSnapshot,practiceSimulation:practice,simulation:battle,baselineSnapshot:{},loadout:[],
    views:new Map([['practice',practiceView],['a',battleView]]),remotePackets:new Map([['b',{}]]),remoteDevices:new Map([['b',{}]]),remoteHeld:new Map([['b',new Set(['Z'])]]),
    inputBuffer,keyTranslator,keyBindings,coreKeyLabel,prediction,slotPreparation:false,secondPressed:[],
    guildPanel:{isOpen:()=>false,close(){calls.push('close-guild');},dispose(){calls.push('dispose-guild');}},keyDialog:{setLocked(){},open(){}},
    motionInspector:{active:false},stepPanel:{hidden:false},swordPrepare:{hidden:true},wayOfSwordParticles:null,wayOfSwordHud:null,perfOutput:{hidden:false},preset:{skillKeys:['A','S','D','C','Q','W','E','R']},
    nameplates:{clear(){calls.push('clear-nameplates');}},weaponTrails:{clear(){calls.push('clear-trails');},setLocalActor(id){calls.push(['trail-local',id]);}},
    effectsView:{clear(){calls.push('clear-effects');},step(){},async prewarmActors(){}},worldColorView:{clear(){},step(){}},damageNumbers:{clear(){calls.push('clear-numbers');},step(){}},interfaceAudio:null,
    pvpHud:{clear(){calls.push('clear-pvp-hud');},show(){calls.push('show-pvp-hud');}},
    resultPresentation:{clear(){}},cameraHandoff:{reset(){}},spectatorCamera:createSpectatorCamera(),spectatorHint:{hidden:false},cameraTargetId:null,cameraHeld:false,cameraTracking:null,
    stopSounds(){calls.push('stop-sounds');},rebuildSlots(){},updateHud(){},resetDisplayClock(){calls.push('reset-clock');},say(message){$('.arena-message').textContent=message;},
    actorsNow:()=>state.simulation.view().actors,remoteSample:()=>({held:[],pressed:[],released:[],sampledDevice:true}),
    frame:0,replay:[],eventLog:[],drain(){},presentEvents(events){calls.push(['present-owned-events',events]);},actorRenderClock:{push(){}},manaBreakRenderClock:{push(){}},shownActors:[],
    inputStageTrace:{record:()=>[]},perf:{lastInput:0,stepMs:[],inputMs:[],steps:0},measure(){},
    canvas:{focus(){calls.push('focus-battle');}},setRemotePacket(){},createOnlineLobby(options){state.options=options;return lobby;}};
  const doc={createElement(){
    const classes=new Set();
    return {hidden:false,dataset:{},style:{},children:[],
      classList:{toggle(name,force){const enabled=force??!classes.has(name);if(enabled)classes.add(name);else classes.delete(name);return enabled;}},
      setAttribute(name,value){this[name]=value;},
      append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},
      replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}};
  }};
  state.matchEntry=createMatchEntry({host:{ownerDocument:doc,append(){}},onReturn:()=>state.returnToLobby()});
  state.matchEntry.begin(state.onlineMatch);state.matchEntry.prepared(state.onlineMatch);state.matchEntry.admit(state.onlineMatch,'fight');
  state.frameSupervisor={presentation:(_stage,callback)=>callback(),proof:()=>null};state.hitLighting={event(){},clear(){},reset(){},async prewarm(){}};state.poseAudio={clear(){}};
  vm.createContext(state);vm.runInContext(eventRecorder+'\n'+modeGuards+'\n'+reportLoading+'\n'+controls+'\n'+lifecycle+'\n'+tick+'\n'+accept+'\n'+callbacks,state);
  state.dispatchState=vm.runInContext('(value)=>{const type="state";'+stateHandler+'}',state);
  // Renderer/asset preparation is an external dependency of these transport
  // tests; the production async practice and readiness callbacks still run.
  state.loadBattleMap=async()=>true;
  state.preparePracticeTargetView=async()=>{calls.push('prepare-practice-target');};
  state.rebuildPracticeSimulation=()=>{state.simulation=practice;};
  return {state,calls,elements,$,inputBuffer,prediction,keyTranslator,practice,battle};
}

test('actual match startup keeps the battle covered until GPU preparation, ready acknowledgement and newest applied room state',async()=>{
  const f=fixture(),gpu=deferred(),ack=deferred();
  f.state.localPlayerId=null;f.state.paused=true;f.state.matchEntry.begin(f.state.onlineMatch);
  f.state.onlineFactory=()=>f.battle;f.state.onlineFactory.lastEventId=0;
  f.state.onlineFactory.prepareViews=async()=>true;
  f.state.scene.whenReadyAsync=()=>gpu.promise;
  f.state.online.ready=async()=>{f.calls.push('ready');return ack.promise;};
  f.battle.restore=value=>{f.battle.state=structuredClone(value);f.calls.push(['apply-room',value.marker]);};
  const snapshot=marker=>({marker,actors:[{id:'a',loadout:[]},{id:'b',loadout:[]}]});
  const initial=f.state.acceptServerState({matchId:'m',sequence:9,snapshot:snapshot('created'),pvp:{phase:'created'},events:[]});
  for(let n=0;n<10;n++)await Promise.resolve();
  assert.equal(f.state.matchEntry.root.hidden,false);assert.equal(f.state.paused,true);assert.ok(!f.calls.includes('ready'));
  await f.state.acceptServerState({matchId:'m',sequence:10,snapshot:snapshot('old-intro'),pvp:{phase:'intro'},events:[]});
  await f.state.acceptServerState({matchId:'m',sequence:11,snapshot:snapshot('new-intro'),pvp:{phase:'intro'},events:[]});
  assert.equal(f.state.lastServerSequence,9,'queued snapshots are not marked applied');
  gpu.resolve();for(let n=0;n<10;n++)await Promise.resolve();
  assert.ok(f.calls.includes('ready'));assert.equal(f.state.paused,true);assert.equal(f.state.matchEntry.root.hidden,false);
  ack.resolve({ok:true});await initial;
  assert.equal(f.state.lastServerSequence,11);assert.equal(f.state.pendingLoadingState,null);
  assert.equal(f.battle.state.marker,'new-intro');assert.equal(f.state.matchEntry.root.hidden,true);assert.equal(f.state.paused,false);
  assert.equal(f.calls.filter(v=>Array.isArray(v)&&v[0]==='apply-room').length,1,'only newest loading snapshot is applied');
});

test('a local ready acknowledgement cannot reveal a room still waiting for another player',async()=>{
  const f=fixture();f.state.localPlayerId=null;f.state.paused=true;f.state.matchEntry.begin(f.state.onlineMatch);
  f.state.onlineFactory=()=>f.battle;f.state.onlineFactory.prepareViews=async()=>true;
  f.state.online.ready=async()=>({ok:true});
  await f.state.acceptServerState({matchId:'m',sequence:9,snapshot:{actors:[]},pvp:{phase:'created'},events:[]});
  assert.equal(f.state.paused,true);assert.equal(f.state.matchEntry.root.hidden,false);assert.equal(f.state.matchEntry.root.dataset.phase,'waiting');
  f.state.matchEntry.end(f.state.onlineMatch);assert.equal(f.state.matchEntry.root.dataset.phase,'ended');
  f.state.returnToLobby();assert.equal(f.state.matchEntry.root.hidden,true);assert.equal(f.state.pendingLoadingState,null);
});

test('fatal polling/authentication errors stop prediction, release battle resources and show a usable lobby',()=>{
  for(const error of [Object.assign(Error('login-required'),{status:401}),Object.assign(Error('stream-already-open'),{status:409,code:'stream-already-open'}),Error('invalid-online-poll-response'),Object.assign(Error('poll stopped'),{fatal:true})])for(const ownershipMode of [null,'local-owner-v1']){
    const f=fixture({ownershipMode});f.state.handleOnlineError(error);
    assert.equal(f.state.mode,'lobby');assert.equal(f.state.paused,true);assert.equal(f.state.configurationLocked,false);
    assert.equal(f.state.onlineMatch,null);assert.equal(f.state.localPlayerId,null);assert.equal(f.state.authoritativePvp,null);
    assert.equal(f.state.ownershipMode,null);assert.equal(f.state.practiceGeneration,1);
    assert.ok(f.calls.indexOf('clear-ownership')>=0&&f.calls.indexOf('clear-ownership')<f.calls.indexOf('dispose-online-view'));
    assert.ok(f.calls.indexOf('clear-owned-presentation')>=0&&f.calls.indexOf('clear-owned-presentation')<f.calls.indexOf('dispose-online-view'));
    assert.equal(f.prediction.pending,0);assert.deepEqual(f.inputBuffer.consume().held,[]);assert.equal(f.keyTranslator.up('KeyZ'),null);
    for(const name of ['remotePackets','remoteDevices','remoteHeld'])assert.equal(f.state[name].size,0);
    assert.equal(f.state.simulation,f.practice);assert.deepEqual([...f.state.views.keys()],['practice']);
    assert.ok(f.calls.indexOf('clear-nameplates')<f.calls.indexOf('dispose-online-view'));
    assert.ok(f.calls.indexOf('clear-trails')<f.calls.indexOf('dispose-online-view'));
    assert.ok(f.calls.includes('close-online')&&f.calls.includes('stop-sounds'));
    assert.match(f.$('.arena-message').textContent,/Online play stopped.*sign in again/);
    assert.equal(f.calls.find(row=>row[0]==='lobby-error')[1],f.$('.arena-message').textContent);
    for(const action of ['queue1v1','queue','queue3v3'])assert.equal(f.$('[data-action="'+action+'"]').disabled,true);
    assert.equal(f.$('#lobby').hidden,false);assert.equal(f.$('#lobby').disabled,false);
    assert.equal(f.$('#guild-skills').hidden,true);assert.equal(f.$('#guild-skills').disabled,true);
    f.state.tick();f.state.tick(true);assert.ok(!f.calls.some(row=>row[0]==='step'||row[0]==='send'),'both automatic and manual battle sampling stop');
    assert.ok(!f.calls.some(row=>row[0]==='history'),'failed authentication does not launch a history read that can replace the error');
  }
});

test('game lobby callbacks forward selected modes and GM toggles without hardcoded 2v2 labels',async()=>{
  const modeFlags={'1v1':false,'2v2':true,'3v3':false},f=fixture({role:'gm',modeFlags}),requests=[];
  assert.deepEqual(f.state.options.modes,modeFlags,'initial lobby reads persistent mode flags from the actual session.online response');
  f.state.online.join=async mode=>{requests.push({mode});return {queued:true};};
  f.state.online.api=async(url,method,body)=>{requests.push({url,method,body});return {modes:{'3v3':false}};};
  await assert.rejects(f.state.options.onQueue('1v1'),/match lobby/);assert.equal(requests.length,0);
  f.state.mode='lobby';f.state.configurationLocked=false;
  await f.state.options.onQueue('1v1');await f.state.options.onQueue('3v3');await f.state.options.onModeChange('3v3',false);
  assert.equal(requests[0].mode,'1v1');assert.equal(requests[1].mode,'3v3');assert.equal(requests[2].url,'/api/online/modes');assert.equal(requests[2].method,'POST');
  assert.equal(requests[2].body.mode,'3v3');assert.equal(requests[2].body.enabled,false);
  f.state.mode='online';f.state.configurationLocked=true;f.state.onlineMatch.mode='3v3';f.state.updateModeControls();assert.equal(f.$('.version-note').textContent,'3v3 · Configuration locked');assert.equal(f.$('.workbench-mode').textContent,'Reckless Fist / 3v3 online match');
});

test('temporary reconnect and peer negotiation errors preserve the match and prediction',()=>{
  const f=fixture();f.state.handleOnlineError(Error('connection-retrying'));f.state.handleOnlineError(Error('unsupported peer SDP'));
  assert.equal(f.state.mode,'online');assert.equal(f.state.paused,false);assert.equal(f.prediction.pending,1);assert.equal(f.state.onlineTransportError,null);
  assert.ok(!f.calls.includes('close-online'));assert.deepEqual(f.calls.filter(row=>row[0]==='lobby-error'),[['lobby-error','unsupported peer SDP']]);
});

test('a stale upload or peer signal409 does not discard the match before its authoritative result arrives',()=>{
  for(const code of ['match-not-active','input-sequence-rejected','input-rejected']){
    const f=fixture();f.state.handleOnlineError(Object.assign(Error(code),{status:409,code}));
    assert.equal(f.state.mode,'online');assert.equal(f.state.paused,false);assert.equal(f.prediction.pending,1);
    assert.equal(f.state.onlineMatch.id,'m');assert.equal(f.state.onlineTransportError,null);assert.ok(!f.calls.includes('close-online'));
  }
});

test('a stopped send cannot record an undefined or invalid prediction frame or step combat',()=>{
  for(const frameSeq of [undefined,NaN,-1,0,1.5]){
    const f=fixture({frameSeq});assert.doesNotThrow(()=>f.state.tick());
    assert.equal(f.state.mode,'lobby');assert.equal(f.prediction.pending,0);assert.equal(f.state.frame,0);
    assert.ok(!f.calls.some(row=>row[0]==='step'));assert.match(f.$('.arena-message').textContent,/Online input stopped/);
  }
});

test('a valid online frame records the original sampled packet and advances the existing combat step',()=>{
  const f=fixture();f.state.tick();assert.equal(f.prediction.lastRecorded,2);assert.equal(f.prediction.pending,2);assert.equal(f.state.mode,'online');
  const sent=f.calls.find(row=>row[0]==='send')[1],stepped=f.calls.find(row=>row[0]==='step');
  assert.equal(stepped[1],1/60);assert.deepEqual(stepped[2].a,sent);assert.deepEqual(sent.held,['Z']);assert.equal(sent.sampledDevice,true);
  assert.ok(!f.calls.includes('close-online'));
});

test('owner combat consumes only local sampled keys, runs its action consumer and advances without restore or replay',()=>{
  const report={protocol:'local-owner-v1',actor:{state:'fixture'}},f=fixture({ownershipMode:'local-owner-v1',ownerReport:report});
  const originalSimulation=f.state.simulation,originalActors=f.battle.state.actors;
  f.state.remoteSample=()=>assert.fail('owner combat cannot re-consume delayed remote held keys');
  f.battle.restore=()=>assert.fail('an ordinary owner tick cannot roll back the local simulation');
  f.state.tick();
  const before=f.calls.findIndex(row=>row[0]==='before-owned-step'),step=f.calls.findIndex(row=>row[0]==='step'),after=f.calls.findIndex(row=>row[0]==='after-owned-step');
  assert.ok(before>=0&&before<step&&step<after,'critical action consumer runs before the one existing combat step');
  const capacity=f.calls.findIndex(row=>row[0]==='owner-capacity');
  assert.ok(before<capacity&&capacity<step,'released consumer capacity is notified before the existing positive combat step');
  assert.equal(f.calls[before][1],originalSimulation);assert.equal(f.calls[before][2],'a');
  assert.equal(f.calls[after][1],originalSimulation);assert.equal(f.calls[after][2],'a');
  assert.equal(f.calls.filter(row=>row[0]==='step').length,1,'there is no prediction replay in owner mode');
  const expectedPacket={...packet,edges:[{key:'Z',down:true,time:0}]};
  assert.equal(f.calls[step][1],1/60);assert.deepEqual(f.calls[step][2].a,expectedPacket);
  assert.deepEqual(f.calls[step][2].b,{held:[],pressed:[],released:[]},'remote state already contains action, time and fired members');
  assert.deepEqual([...f.state.remoteHeld.get('b')],['Z'],'fixture really includes a delayed remote attack held level');
  assert.equal(f.state.simulation,originalSimulation);assert.equal(f.battle.state.actors,originalActors);
  assert.equal(f.prediction.pending,0);assert.equal(f.prediction.lastRecorded,null);assert.equal(f.state.replay.length,0);
  const sent=f.calls.filter(row=>row[0]==='send');assert.equal(sent.length,1);assert.deepEqual(sent[0][1],expectedPacket);assert.deepEqual(sent[0][2],report);
  const recorded=f.calls.find(row=>row[0]==='owned-sent-frame');assert.equal(recorded[1],originalSimulation);assert.equal(recorded[2],'a');
  assert.equal(recorded[3],2,'victim contact history aliases the actual normalized transport frame, not tick frame 1');
  assert.ok(f.calls.indexOf(recorded)>f.calls.indexOf(sent[0]),'record the source alias after send returns its normalized frame');
  assert.equal(f.state.frame,1);assert.ok(!f.calls.includes('restore'));
});

test('an actor preparation completing after a fatal stream cannot revive the match or send ready',async()=>{
  const f=fixture(),gate=deferred();let context,released=0;
  f.state.localPlayerId=null;f.state.onlineFactory=()=>f.battle;
  f.state.onlineFactory.prepareViews=async(_actors,value)=>{context=value;value.releaseUnusedViews=()=>released++;await gate.promise;return true;};
  const preparing=f.state.acceptServerState({matchId:'m',sequence:9,snapshot:{actors:[]},pvp:{phase:'fight'},inputs:{}});await Promise.resolve();
  for(let n=0;!context&&n<20;n++)await Promise.resolve();assert.equal(f.state.onlineStarting,true);assert.ok(context);
  f.state.handleOnlineError(Object.assign(Error('login-required'),{status:401}));gate.resolve();await preparing;
  assert.equal(released,1);assert.equal(f.state.onlineStarting,false);assert.equal(f.state.mode,'lobby');assert.equal(f.state.simulation,f.practice);
  assert.ok(!f.calls.includes('ready')&&!f.calls.includes('show-pvp-hud'));
});

test('a readiness response after fatal return cannot restore remote inputs or replay old effects and sounds into practice',async()=>{
  const f=fixture(),gate=deferred();let released=0;
  f.state.localPlayerId=null;f.state.onlineFactory=()=>f.battle;f.state.onlineFactory.lastEventId=0;
  f.state.onlineFactory.prepareViews=async(_actors,context)=>{context.releaseUnusedViews=()=>released++;return true;};
  f.state.online.ready=async()=>{f.calls.push('ready');await gate.promise;return null;};
  f.state.effectsView.event=()=>f.calls.push('old-effect');f.state.damageNumbers.event=()=>f.calls.push('old-damage-number');f.state.playSound=()=>f.calls.push('old-sound');
  const preparing=f.state.acceptServerState({matchId:'m',sequence:9,snapshot:{actors:[]},pvp:{phase:'fight'},inputs:{},events:[{eventId:9,type:'sound',name:'old.wav'}]});
  for(let i=0;i<10;i++)await Promise.resolve();assert.ok(f.calls.includes('ready'));
  f.state.handleOnlineError(Object.assign(Error('login-required'),{status:401}));assert.equal(f.state.remotePackets.size,0);
  gate.resolve();await preparing;
  assert.equal(released,1);assert.equal(f.state.mode,'lobby');assert.equal(f.state.simulation,f.practice);assert.equal(f.state.remotePackets.size,0);
  assert.ok(!f.calls.includes('old-effect')&&!f.calls.includes('old-damage-number')&&!f.calls.includes('old-sound'));
});

async function pendingStateFailure(stage){
  const f=fixture(),gate=deferred();f.state.localPlayerId=null;f.state.onlineFactory=()=>f.battle;
  const wait=async()=>{f.calls.push('pending-'+stage);return await gate.promise;};
  f.state.onlineFactory.prepareViews=stage==='views'?wait:async()=>true;
  if(stage==='map')f.state.loadBattleMap=wait;
  if(stage==='ready')f.state.online.ready=wait;
  f.state.dispatchState({matchId:'m',sequence:9,snapshot:{actors:[]},pvp:{phase:'fight'},inputs:{}});
  for(let i=0;!f.calls.includes('pending-'+stage)&&i<40;i++)await Promise.resolve();
  assert.ok(f.calls.includes('pending-'+stage),'production state handler reaches pending '+stage);
  return {...f,gate};
}

test('retired map, view and ready failures preserve the usable lobby and subsequent local practice',async()=>{
  for(const stage of ['map','views','ready'])for(const next of ['lobby','practice']){
    const f=await pendingStateFailure(stage);f.state.returnToLobby();
    if(next==='practice'){
      f.state.loadBattleMap=async()=>true;await f.state.options.onPractice();
      assert.equal(f.state.mode,'practice');
    }
    const restores=f.calls.filter(value=>value==='restore').length;
    f.gate.reject(Error('retired-'+stage+'-failed'));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.state.mode,next);assert.equal(f.state.simulation,f.practice);
    assert.equal(f.state.onlineTransportError,null);assert.equal(f.state.onlineStarting,false);
    assert.equal(f.calls.filter(value=>value==='restore').length,restores,'retired failure cannot restore practice again');
    assert.ok(!f.calls.includes('close-online'));
    if(next==='lobby'){await f.state.options.onQueue('1v1');assert.ok(f.calls.includes('join'),'healthy matchmaking remains usable');}
  }
});

test('retired failures cannot close a replacement battle or overwrite an authoritative result',async()=>{
  for(const stage of ['map','views','ready'])for(const next of ['replacement','result']){
    const f=await pendingStateFailure(stage);
    if(next==='replacement'){
      f.state.returnToLobby();f.state.onlineMatch={id:'next-match',players:[{id:'a'},{id:'b'}]};
      f.state.mode='online';f.state.simulation=f.battle;f.state.authoritativePvp={phase:'fight'};
    }else{f.state.authoritativePvp={phase:'result'};f.state.paused=true;}
    const current=f.state.onlineMatch,phase=f.state.authoritativePvp.phase;
    f.gate.reject(Error('retired-'+stage+'-failed'));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.state.onlineMatch,current);assert.equal(f.state.authoritativePvp.phase,phase);
    assert.equal(f.state.mode,'online');assert.equal(f.state.onlineTransportError,null);
    assert.ok(!f.calls.includes('close-online'));
  }
});

test('map, view and ready failures in the current battle still stop transport and recover to the lobby',async()=>{
  for(const stage of ['map','views','ready']){
    const f=await pendingStateFailure(stage);
    f.gate.reject(Error('current-'+stage+'-failed'));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.state.mode,'lobby');assert.equal(f.state.simulation,f.practice);
    assert.ok(f.calls.includes('close-online'));assert.match(f.state.onlineTransportError.message,new RegExp('current-'+stage+'-failed'));
    await assert.rejects(f.state.options.onQueue('1v1'),new RegExp('current-'+stage+'-failed'));
  }
});

test('the stopped transport refuses queue/cancel, permits local practice, and preserves the error on return',async()=>{
  const f=fixture();f.state.handleOnlineError(Error('invalid-online-poll-response'));const message=f.$('.arena-message').textContent;
  await assert.rejects(f.state.options.onQueue(),/Online play stopped/);await assert.rejects(f.state.options.onCancel(),/Online play stopped/);
  assert.ok(!f.calls.includes('join')&&!f.calls.includes('cancel'));
  await f.state.options.onPractice();assert.equal(f.state.mode,'practice');assert.equal(f.state.paused,false);
  assert.equal(f.$('#guild-skills').hidden,true,'the ordinary account does not gain diagnostic permissions');
  f.state.returnToLobby();assert.equal(f.$('.arena-message').textContent,message);assert.equal(f.$('[data-action="queue"]').disabled,true);
});

test('initial poll rejection remains a visible lobby failure instead of aborting the renderer initialization',async()=>{
  const f=fixture();let history=0;
  f.state.online.open=async()=>{const error=Object.assign(Error('login-required'),{status:401,fatal:true});f.state.handleOnlineError(error);throw error;};
  f.state.online.api=async()=>{history++;return {};};
  await vm.runInContext('(async()=>{'+startup+'})()',f.state);
  assert.equal(history,0);assert.equal(f.state.mode,'lobby');assert.match(f.$('.arena-message').textContent,/Session expired/);
});

test('a fatal transport retains the existing logout/relogin route',async()=>{
  const f=fixture();f.state.handleOnlineError(Object.assign(Error('stream-already-open'),{status:409,code:'stream-already-open'}));
  Object.assign(f.state,{awakeningBeadView:{dispose(){}},engine:{stopRenderLoop(){f.calls.push('stop-render');}},
    fetch:async(url,options)=>{assert.equal(url,'/api/logout');assert.equal(options.method,'POST');f.calls.push('logout');},location:{reload(){f.calls.push('reload');}}});
  const handler=source.split('\n').find(line=>line.startsWith("$('#logout').onclick="));vm.runInContext(handler,f.state);await f.$('#logout').onclick();
  assert.equal(f.state.active,false);assert.ok(f.calls.includes('stop-render'));assert.ok(f.calls.indexOf('logout')<f.calls.indexOf('reload'));
});
