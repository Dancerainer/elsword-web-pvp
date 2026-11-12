/** Execute production page boundaries with controlled I/O. These checks cover
 * residency, roster and transport admission, not original-client combat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {normalizeProfessionId} from '../../packages/professions/catalog.mjs';
import {getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {practiceActors as pairedPracticeActors} from '../../apps/web/map-runtime.mjs';
import {createMatchEntry} from '../../apps/web/match-entry.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function block(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start+' production boundary');return source.slice(a,b);}
const practiceDefinition=source.match(/^const practiceActors=.*;$/m)?.[0];assert.ok(practiceDefinition);
const rosterLoad=block('  const launchPlayers=','  for(const [id,assets]of preparedProfessions)');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

for(const [label,professionId,launchIntent,bootSession,expected]of [
 ['free practice','LP',{kind:'practice'}, {},['LP']],
 ['offline2v2','BH',{kind:'practice2v2'}, {},['BH']],
 ['1v1 actual roster','RF',{kind:'online',match:{players:[{professionId:'RF'},{professionId:'CA'}]}},{},['RF','CA']],
 ['3v3 unique actual roster','GM',{kind:'online',match:{players:['GM','LP','CA','LP','RF','GM'].map(professionId=>({professionId}))}},{},['GM','LP','CA','RF']],
 ['restored room','MM',null,{online:{match:{players:[{professionId:'MM'},{professionId:'DE'}]}}},['MM','DE']],
])test('lazy battle loads only required professions: '+label,async()=>{
 const calls=[],c={professionId,launchIntent,bootSession,normalizeProfessionId,Set,
  assetVersions:{files:Object.fromEntries(Object.keys(PROFESSION_PROFILES).map(id=>[id.toLowerCase()+'/manifest.json',{}]))},
  professionAssetCache:{async loadAll(ids){calls.push([...ids]);return new Map();}}};
 vm.createContext(c);await vm.runInContext('(async()=>{'+rosterLoad+'})()',c);
 assert.deepEqual(calls,[expected]);
});

test('actual practice construction has one authored actor and does not prepare a missing mirror',()=>{
 const mapManifest={...JSON.parse(readFileSync(new URL('../../artifacts/scene/sander-garpai-rock-pvp/collision.json',import.meta.url)))},calls=[];
 const c={pairedPracticeActors,getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS,mapManifest,
  professionAssets:new Map([['LP',{manifest:{referenceVersion:'source2016'}}]]),commonBuffs:{},nativeRuntime:{versions:{}},simulationSamplers:{},currentMapVersions:{},
  createSimulation(options){calls.push(options);return {state:{actors:options.actors},configureLoadout(loadout,id){calls.push({loadout,id});}};},
  preparePracticeTarget(){assert.fail('single-player training must not dereference a second actor');}};
 vm.createContext(c);vm.runInContext(practiceDefinition+'\n'+block('function createPracticeSimulation(', '\nasync function loadAllProfessionPreferences('),c);
 const loadout=[{skillId:29002}],sim=c.createPracticeSimulation('LP',loadout);
 assert.equal(sim.state.actors.length,1);assert.equal(sim.state.actors[0].id,'player-1');assert.equal(sim.state.actors[0].professionId,'LP');
 assert.deepEqual(sim.state.actors[0].position,mapManifest.spawns.find(s=>s.kind==='SetTeamStartPos').position);
 assert.deepEqual(calls[1],{loadout,id:'player-1'});
});

test('actual one-actor practice tick never fabricates or dereferences a mirror input',()=>{
 const steps=[],actor={id:'player-1'},c={active:true,mode:'practice',slotPreparation:false,paused:false,
  guildPanel:{isOpen:()=>false},replay:[],performance:{now:()=>1000},inputBuffer:{consume:()=>({held:[],pressed:[],released:[]})},
  actorsNow:()=>[actor],secondPressed:['Z'],ownsLocalUnit:()=>false,usesCombatPlayback:()=>false,isPvpMode:()=>false,
  authoritativePvp:null,simulation:{step(dt,inputs){steps.push(inputs);},view:()=>({actors:[actor]})},frame:0,drain(){},
  frameSupervisor:{presentation(_name,callback){callback();}},effectsView:{step(){}},worldColorView:{step(){}},actorRenderClock:{push(){}},
  manaBreakRenderClock:{push(){}},damageNumbers:{step(){}},inputStageTrace:{record:()=>[]},perf:{lastInput:0,inputMs:[],stepMs:[],steps:0},measure(){}};
 vm.createContext(c);vm.runInContext(block('function tick(',"\nlistenBattleWindow('keydown'"),c);c.tick();
 assert.equal(steps.length,1);assert.deepEqual(Object.keys(steps[0]),['player-1']);assert.equal(c.replay.length,1);
});

test('actual death diagnostic safely ignores a missing second training actor',()=>{
 const deathPrepare={},c={active:true,slotPreparation:false,deathPrepare,stateNow:()=>({actors:[{id:'player-1',hp:100}]}),
  simulation:{restore(){assert.fail('no mirror exists');}}};
 vm.createContext(c);vm.runInContext(block('deathPrepare.onclick=',"\n$('#target-attack')"),c);
 assert.doesNotThrow(()=>deathPrepare.onclick());
});

test('actual single-actor HUD hides the opponent and never samples absent opponent gauges',()=>{
 const elements=new Map(),element=()=>({style:{},dataset:{},classList:{toggle(){}}}),$=key=>{if(!elements.has(key))elements.set(key,element());return elements.get(key);};
 const hud=Object.fromEntries(['.hud-hp','.hud-mp','.hud-hp-number','.hud-mp-number','#wake-orbs','#wake-time','.tools .status'].map(key=>[key,$(key)]));
 const c={$,hud,wayOfSwordHud:null,skillSwordCues:null,isPvpMode:()=>false,preset:{hp:100,mp:300},profile:{},profession:{id:'LP',name:'LP'},
  updateManaGuides(){},addHud:{update(){}},beads:Array.from({length:3},()=>element()),wakeGauge:element(),nativeRage:element(),
  awakeningCountdown:()=>({text:'',urgent:false}),mode:'practice',paused:false,frame:0,skillButtons:[],buffBar:null,pvpHud:null,
  opponentGauges(){assert.fail('no opponent exists');}};
 vm.createContext(c);vm.runInContext(block('function updateHud(', '\nfunction renderActor('),c);
 c.updateHud([{id:'player-1',hp:100,mp:300,x:0,y:0,state:'RSI_WAIT'}]);assert.equal($('.opponent-hud').hidden,true);
});

test('direct battle fixture retains its scene without a lobby handoff',async()=>{
 const calls=[],noop=()=>{},clear={clear:noop},actor={id:'player-1',loadout:[]};
 const sim={state:{actors:[actor]},restore:noop,actor:()=>actor};
 const c={lobbyHandoff:null,online:{close(){assert.fail('retain authenticated transport');},clearMatch(){calls.push('clear-match');},api:async()=>({})},
  location:{reload(){assert.fail('no navigation on return');}},resultPresentation:clear,spectatorCamera:{reset:noop},cameraHandoff:{reset:noop},spectatorHint:{},
  matchEntry:clear,worldColorView:clear,mapGeneration:0,practiceGeneration:0,pvpPractice:null,ownershipSync:clear,ownedPresentation:clear,
  closeDiagnostics:noop,prediction:clear,remotePackets:new Map(),remoteDevices:new Map(),remoteHeld:new Map(),inputBuffer:clear,keyTranslator:{releaseAll:noop},
  nameplates:clear,weaponTrails:{clear:noop,setLocalActor:noop},effectsView:clear,damageNumbers:clear,views:new Map(),
  practiceSnapshot:{actors:[actor]},practiceSimulation:sim,simulation:sim,structuredClone,pvpHud:clear,professionSwitch:{flush:noop},
  currentMapVersions:{sceneId:'besma-besma-lake-pvpmap'},lobby:{setPracticeMap:id=>calls.push(id),status:noop,show:show=>calls.push(show),history:noop},
  updateModeControls:noop,rebuildSlots:noop,updateHud:noop,actorsNow:()=>[actor],resetDisplayClock:noop,say:noop,onlineTransportError:null};
 vm.createContext(c);vm.runInContext(block('function returnToLobby(){','\nfunction handleOnlineError('),c);c.returnToLobby();
 await settle();assert.deepEqual(calls,['clear-match','besma-besma-lake-pvpmap',true]);
 assert.equal(c.mode,'lobby');assert.equal(c.paused,true);assert.equal(c.simulation,sim);assert.equal(c.selectedPracticeMap,'besma-besma-lake-pvpmap');
});

class Element{
 constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';
  this.classList={toggle:(name,enabled)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));if(enabled)values.add(name);else values.delete(name);this.className=[...values].join(' ');}};}
 append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}}
 setAttribute(name,value){this.attributes[name]=String(value);}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
function entryFixture(){const document={createElement:tag=>new Element(tag,document)},host=new Element('main',document);return createMatchEntry({host});}
for(const [label,players]of [
 ['single local player',[{id:'self',professionId:'LP',team:1}]],
 ['1v1',[{id:'self',professionId:'RF',team:0},{id:'peer',professionId:'CA',team:1}]],
 ['3v3',Array.from({length:6},(_,i)=>({id:'p'+i,professionId:'RF',team:i<3?0:1}))],
])test('real loading cards contain only '+label,()=>{
 const entry=entryFixture(),match={id:'room',players};entry.begin(match,{playerId:players[0].id});
 const cards=descendants(entry.root).filter(n=>n.className.split(' ').includes('match-loading-player'));
 assert.equal(cards.length,players.length);assert.deepEqual(cards.map(c=>c.dataset.playerId).sort(),players.map(p=>p.id).sort());
 assert.ok(cards.every(c=>!c.className.split(' ').includes('empty')));
 assert.ok(cards.every(c=>!c.children[0].src.endsWith('/empty.png')));
 assert.equal(entry.admit(match,'intro'),false,'cards do not bypass real preparation');
 entry.prepared(match);assert.equal(entry.admit(match,'intro'),true);
});
test('real loading roster removes departed cards and moves the same player between teams without duplication',()=>{
 const entry=entryFixture(),match={id:'room',players:[{id:'self',team:0},{id:'peer',team:1}]};entry.begin(match,{playerId:'self'});
 const initial=descendants(entry.root).find(n=>n.dataset.playerId==='self');
 match.players=[{id:'self',team:1}];entry.players(match);
 const cards=descendants(entry.root).filter(n=>n.className.split(' ').includes('match-loading-player'));
 assert.equal(cards.length,1);assert.equal(cards[0],initial);assert.equal(cards[0].parent.className,'match-loading-team match-loading-blue');
 assert.equal(entry.progress(match,'peer',80),false);
});

function onlineInitializationFixture(stage){
 const gate=deferred(),calls=[],elements=new Map(),element=()=>({hidden:false,dataset:{},style:{},onclick(){},remove(){},insertBefore(){},addEventListener(){}});
 const $=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const old={open:true};
 const c={$,structuredClone,PROFESSION_PROFILES,PROFESSION_PRESETS,baselineSnapshot:{actors:[{id:'player-1'}]},simulation:{},profile:{},preset:{},
  commonBuffs:{},mapManifest:{},currentMapVersions:{sceneId:'retained-fixture-scene'},nativeRuntime:{},simulationSamplers:{},assetVersions:{files:{}},
  async data(url){calls.push('data:'+url);if(stage==='ui')await gate.promise;return {pieces:{},buffIcons:{}};},
  createBuffBar:()=>({}),createKeyBindingsDialog:()=>({setValue(){}}),createPvpHud:()=>({}),uiManifest:{},dismissResultAndReturn(){},
  createOnlineClient(){return {async api(url){calls.push('api:'+url);
   if(stage==='maps'&&url==='/api/online/maps'||stage==='keys'&&url==='/api/key-preferences')await gate.promise;
   return {};},setPageInitToken(token){calls.push('new-token:'+token);},async open(){assert.equal(old.open,false);calls.push('new-open');}};},
  createOnlineLobby:()=>({history(){calls.push('history');},show(value){calls.push('show:'+value);}}),assetUrl:url=>url,handleOnlineError(error){throw error;},
  costumePreferences:{},selectCostume(){},observeProfession(){},queueWithConfirmedConfiguration(){},
  professionId:'LP',professionSwitch:{},keyTranslator:{setBindings(){}},rebuildSlots(){},diagnosticIds:[],updateModeControls(){},
  keyBindings:{},listenBattleWindow(){},window:{addEventListener(){}},document:{createElement:element},active:false,canvas:{focus(){}},say(){},
  lobbyHandoff:{async release(){calls.push('old-release');if(stage==='handoff')await gate.promise;old.open=false;
   if(stage==='handoff')return {ok:true,pageInitToken:'fresh_battle_token_123'};}},session:{username:'self',professionId:'LP'},onlineTransportError:null};
 vm.createContext(c);vm.runInContext(block('async function initializeOnline(session){','\n\ntry {'),c);
 const tail=block("  $('.loading-overlay').remove();active=true;",'  if(addUiAssets)');
 const ready=vm.runInContext('(async()=>{'+tail+'})()',c);return {c,calls,gate,old,ready};
}
for(const stage of ['ui','maps','keys'])test('lazy handoff retains the original lease while awaiting '+stage,async()=>{
 const f=onlineInitializationFixture(stage);await settle();
 assert.ok(f.calls.includes(stage==='ui'?'data:/assets/ui/online/manifest.json':stage==='maps'?'api:/api/online/maps':'api:/api/key-preferences'),'production callback reaches selected dependency');
 assert.equal(f.old.open,true,'slow UI/map/preferences requests must not consume the 2.5-second disconnect grace');
 assert.ok(!f.calls.includes('new-open'));f.gate.resolve();await f.ready;
 assert.equal(f.calls.filter(c=>c==='old-release').length,1);assert.ok(f.calls.indexOf('old-release')<f.calls.indexOf('new-open'));
});

test('production battle awaits server handoff ACK then installs its rotated token before opening',async()=>{
 const f=onlineInitializationFixture('handoff');await settle();
 assert.ok(f.calls.includes('old-release'));assert.equal(f.old.open,true);assert.ok(!f.calls.includes('new-open'));
 f.gate.resolve();await f.ready;
 assert.ok(f.calls.indexOf('new-token:fresh_battle_token_123')<f.calls.indexOf('new-open'));
 assert.equal(f.c.currentSession.pageInitToken,'fresh_battle_token_123');
});
