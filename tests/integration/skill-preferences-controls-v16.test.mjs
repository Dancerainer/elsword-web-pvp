import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createInputStepClock} from '../../apps/web/input-step-clock.mjs';
import {createManaBreakRenderClock} from '../../apps/web/mana-break-hud.mjs';
import {createPickerDialogController} from '../../apps/web/skill-picker-dialog.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createMotionInspector} from '../../apps/web/motion-inspector.mjs';
import {createKeyBindingTranslator,normalizeKeyBindings,coreKeyLabel} from '../../packages/input/key-bindings.mjs';
import {createGuildPanel} from '../../apps/web/guild-panel.mjs';
import {createFrameSupervisor} from '../../apps/web/frame-supervisor.mjs';
import {showAcceptedOnlineResult} from '../../apps/web/online-result-view.mjs';
import {isElswordProfession,isElesisProfession,isAddProfession} from '../../packages/professions/identity.mjs';

const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const modeGuards=['isPvpMode','ownsLocalUnit'].map(name=>{
  const declaration=source.match(new RegExp('^const '+name+'=.*;$','m'))?.[0];
  assert.ok(declaration,'production '+name+' guard is present');return declaration;
}).join('\n');
const controls=source.slice(source.indexOf('function tick('),source.indexOf("$('#audit-toggle').onclick="));
const apply=source.slice(source.indexOf('async function applyLoadout('),source.indexOf("$('#skills').onclick="));
const closeSetup=source.slice(source.indexOf('const pickerDialog='),source.indexOf("$('.picker-tree-scroll').addEventListener"));
const guildSetup=source.slice(source.indexOf('let guildWasPaused='),source.indexOf('async function data(url)'));
const modeSetup=source.slice(source.indexOf('const diagnosticIds='),source.indexOf('function returnToLobby(){'));
const clockStep=source.slice(source.indexOf('const {rawDt,dt,cutoffs,alpha}=inputStepClock.advance('),source.indexOf("    const view=frameSupervisor.presentation('actor-pose'"));
const keys=['A','S','D','C','Q','W','E','R'];
const blank=()=>Array(8).fill(null);
const deferred=()=>{let resolve;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};};
function keyEvent(type,code='KeyZ'){
  const event=new Event(type,{cancelable:true});
  Object.defineProperties(event,{code:{value:code},key:{value:code==='Escape'?'Escape':'z'},
    target:{value:{matches:()=>false}}});return event;
}

class GuildElement extends EventTarget {
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};}
  append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}
  setAttribute(name,value){this[name]=value;}
  focus(){this.focused=true;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
}

/** Execute production callbacks; the host records effects and models only external services. */
function fixture(){
  let state={time:0,actors:[{id:'rf',loadout:[{skillId:10,branchId:'none'},...blank().slice(1)],awakening:{orbs:0}},
    {id:'target',hp:100,loadout:blank()}]};
  const elements=new Map([['.skill-picker',{hidden:false,inert:false}],['.picker-message',{textContent:''}],
    ['.workbench',new GuildElement('main')],['#guild-skills',new GuildElement('button')],
    ['#picker-close',new EventTarget()],['#step-count',{value:'2'}],['#step-command',{value:'Z'}],['#step-held',{checked:false}]]);
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{querySelector:child=>$(selector+' '+child)});return elements.get(selector);};
  const calls={restore:0,prepare:0,step:0,clear:0,releaseAll:0,down:0,tap:0,resetClock:0,record:0,settled:0,effectRender:0,sceneRender:0,cameraSteps:0};
  const baseInput=createInputBuffer(),inputBuffer=new Proxy(baseInput,{get(target,key){
    const value=Reflect.get(target,key,target);
    return ['clear','releaseAll','down','tap'].includes(key)?(...args)=>{calls[key]++;return value.apply(target,args);}:value;
  }});
  const pending=deferred(),saved=[],window=new EventTarget(),stepToggle={},deathPrepare={},stepPanel={hidden:false};
  const document=new EventTarget();document.body=new GuildElement('body');document.activeElement=new GuildElement('previous');
  document.createElement=tag=>new GuildElement(tag);
  document.querySelector=$;
  const clock=createInputStepClock();clock.rebase(.8);
  const context={structuredClone,isElswordProfession,isElesisProfession,active:true,paused:true,slotPreparation:false,professionId:'RF',professionPreferences:new Map(),profession:{id:'RF',name:'Reckless Fist',label:'RF · Reckless Fist'},loadout:structuredClone(state.actors[0].loadout),
    isAddProfession,mode:'practice',ownershipMode:null,usesCombatPlayback:()=>false,currentSession:{role:'gm'},configurationLocked:false,keyBindings:normalizeKeyBindings(),
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),coreKeyLabel,keyDialog:null,authoritativePvp:null,onlineMatch:null,
    lobby:{setLocked(value){context.lobbyLocked=value;}},lobbyLocked:false,
    branchChoices:{10:'none'},selectedSlot:0,pickerWasPaused:false,stepWasPaused:false,stepPanel,stepToggle,deathPrepare,swordPrepare:{hidden:true},wayOfSwordParticles:null,wayOfSwordHud:null,
    window,document,$,assetUrl:url=>url,interfaceAudio:null,stage(){},preset:{skillKeys:keys},performance:{now:()=>1000},now:1200,frame:0,replay:[],eventLog:[],secondPressed:[],queueMicrotask,
    actorsNow:()=>state.actors,stateNow:()=>structuredClone(state),baselineSnapshot:structuredClone(state),practiceSnapshot:structuredClone(state),
    simulation:{configureLoadout(value){state.actors[0].loadout=structuredClone(value);return structuredClone(value);},
      restore(value){calls.restore++;state=structuredClone(value);},prepareAwakening(){calls.prepare++;state.actors[0].awakening.orbs=3;},
      step(){calls.step++;state.time+=1/60;},view:()=>state},
    inputBuffer,inputStepClock:clock,inputStageTrace:{record:()=>[]},perf:{lastInput:0,stepMs:[],inputMs:[],steps:0},measure(){},
    effectsView:{async prewarm(){},step(){},render(){calls.effectRender++;},clear(){calls.clear++;}},scene:{render(){calls.sceneRender++;}},worldColorView:{step(){},clear(){}},damageNumbers:{step(){},clear(){calls.clear++;}},
    weaponTrails:{step(){},clear(){calls.clear++;}},actorRenderClock:{push(){}},
    manaBreakRenderClock:createManaBreakRenderClock(),motionInspector:{active:false},perfOutput:{hidden:false},
    stopSounds(){},say(){},drain(){},renderActor(){},updateHud(){},updateCamera(dt){if(dt>0)calls.cameraSteps++;},shownActors:[],cameraTracking:null,
    resetDisplayClock(){calls.resetClock++;},canvas:{focus(){}},pickerTooltip:{hide(){}},cancelPickerDrag(){},
    beginRecording(){calls.record++;},rebuildSlots(){},rebuildPicker(){},createPickerDialogController,createGuildPanel,
    skillPreferences:{async save(config){saved.push(structuredClone(config));await pending.promise;return structuredClone(config);}}};
  context.listenBattleWindow=(...args)=>window.addEventListener(...args);
  $('.workbench').classList={toggle(){}};
  context.matchEntry={root:{hidden:true}};
  context.professionSwitch=createProfessionSwitch({current:()=>context.professionId,canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  context.frameSupervisor=createFrameSupervisor();context.stage=()=>{};context.hitLighting={clear(){},reset(){}};context.poseAudio={clear(){}};
  vm.createContext(context);vm.runInContext(modeGuards+'\n'+closeSetup+'\n'+guildSetup+'\n'+controls+'\n'+apply+'\n'+modeSetup+
    '\nthis.apply=applyLoadout;this.runTick=tick;this.dialog=pickerDialog;this.guildPanel=guildPanel;this.modeControls=updateModeControls;this.closeAll=closeDiagnostics;',context);
  const runClock=()=>vm.runInContext('(function(){'+clockStep+'return {cutoffs,alpha};})()',context);
  return {context,window,document,guildPanel:context.guildPanel,elements,calls,saved,stepPanel,stepToggle,deathPrepare,inputBuffer,runClock,
    state:()=>structuredClone(state),release:()=>pending.resolve()};
}

test('deferred account save rejects all ten external controls including Guild and new keys; Escape closes only after confirmation',async()=>{
  const f=fixture(),next=[{skillId:11,branchId:'none'},...blank().slice(1)],saving=f.context.apply(next);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.saved.length,1);
  assert.equal(f.context.slotPreparation,true);assert.equal(f.elements.get('.skill-picker').inert,true);
  const beforeState=f.state(),beforeCalls={...f.calls};
  for(const element of [f.elements.get('#reset'),f.elements.get('#pause'),f.stepToggle,f.elements.get('#step-close'),
    f.elements.get('#step-run'),f.elements.get('#step-release'),f.elements.get('#prepare-awakening'),f.deathPrepare,
    f.elements.get('#target-attack'),f.elements.get('#guild-skills')])element.onclick();
  assert.equal(f.guildPanel.isOpen(),false);
  f.window.dispatchEvent(keyEvent('keydown'));assert.equal(f.inputBuffer.pending,0);
  assert.deepEqual(f.state(),beforeState);assert.deepEqual(f.calls,beforeCalls);
  assert.equal(f.context.paused,true);assert.equal(f.stepPanel.hidden,false);assert.deepEqual(f.context.secondPressed,[]);
  f.window.dispatchEvent(keyEvent('keydown','Escape'));f.window.dispatchEvent(keyEvent('keyup','Escape'));
  assert.equal(f.elements.get('.skill-picker').hidden,false);assert.equal(f.context.paused,true);
  f.release();assert.equal(await saving,true);
  assert.deepEqual(f.state().actors[0].loadout,next);assert.deepEqual(f.context.loadout,next);
  assert.deepEqual(f.context.baselineSnapshot.actors[0].loadout,next);assert.equal(f.context.slotPreparation,false);
  assert.deepEqual(f.context.practiceSnapshot.actors[0].loadout,next);
  assert.equal(f.elements.get('.skill-picker').hidden,true);assert.equal(f.context.paused,false);
  assert.equal(f.inputBuffer.pending,0);assert.equal(f.calls.record,1);
  f.elements.get('#reset').onclick();assert.equal(f.calls.restore,1);assert.deepEqual(f.state().actors[0].loadout,next);
  f.elements.get('#pause').onclick();assert.equal(f.context.paused,true);f.context.dialog.destroy();
});

test('all nine controls retain their normal idle behavior after the save boundary',async()=>{
  const f=fixture(),saving=f.context.apply([{skillId:11,branchId:'none'},...blank().slice(1)]);
  f.release();assert.equal(await saving,true);f.context.dialog.close();
  assert.equal(f.context.slotPreparation,false);assert.equal(f.context.paused,false);
  f.elements.get('#pause').onclick();assert.equal(f.context.paused,true);
  f.elements.get('#pause').onclick();assert.equal(f.context.paused,false);
  f.stepToggle.onclick();assert.equal(f.context.paused,true);assert.equal(f.context.stepWasPaused,false);
  f.elements.get('#step-close').onclick();assert.equal(f.stepPanel.hidden,true);assert.equal(f.context.paused,false);
  f.context.paused=true;f.elements.get('#step-run').onclick();assert.equal(f.calls.step,2);assert.equal(f.calls.tap,1);
  assert.equal(f.calls.cameraSteps,2,'manual steps advance the displayed camera with simulation time');
  assert.equal(f.calls.effectRender,1);assert.equal(f.calls.sceneRender,1,'manual diagnostics draw without waiting for a background RAF');
  f.context.keyTranslator.down('ArrowRight');f.inputBuffer.down('RIGHT',0);const releases=f.calls.releaseAll;
  f.elements.get('#step-release').onclick();assert.equal(f.calls.releaseAll,releases+1);
  assert.ok(f.inputBuffer.consume().released.includes('RIGHT'));
  f.elements.get('#reset').onclick();assert.equal(f.calls.restore,1);assert.equal(f.state().time,0);
  f.elements.get('#prepare-awakening').onclick();assert.equal(f.calls.prepare,1);assert.equal(f.state().actors[0].awakening.orbs,3);
  f.deathPrepare.onclick();assert.equal(f.state().actors[1].hp,1);assert.equal(f.calls.restore,2);
  f.elements.get('#target-attack').onclick();assert.deepEqual(f.context.secondPressed,['Z']);f.context.dialog.destroy();
});

test('preparing blocks real manual/automatic tick and KeyZ even with paused=false; the render clock creates no cutoffs',()=>{
  const f=fixture();f.context.paused=false;f.context.slotPreparation=true;
  const before=f.state();f.window.dispatchEvent(keyEvent('keydown'));f.context.runTick(true);f.context.runTick(false);
  assert.equal(f.inputBuffer.pending,0);assert.equal(f.calls.down,0);assert.equal(f.calls.step,0);assert.deepEqual(f.state(),before);
  assert.deepEqual(Array.from(f.runClock().cutoffs),[]);assert.equal(f.calls.step,0);f.context.dialog.destroy();
});

test('busy keyup continues to release an existing physical key',()=>{
  const f=fixture();f.context.paused=false;f.window.dispatchEvent(keyEvent('keydown'));
  assert.deepEqual(f.inputBuffer.consume().held,['Z']);f.context.slotPreparation=true;
  f.window.dispatchEvent(keyEvent('keyup'));const released=f.inputBuffer.consume();
  assert.deepEqual(released.held,[]);assert.deepEqual(released.released,['Z']);f.context.dialog.destroy();
});

test('lobby and the key bindings dialog reject new combat keys; keyup still releases a physical hold',()=>{
  const f=fixture();f.context.paused=false;
  f.window.dispatchEvent(keyEvent('keydown'));assert.deepEqual(f.inputBuffer.consume().held,['Z']);
  f.context.mode='lobby';f.context.configurationLocked=true;
  f.window.dispatchEvent(keyEvent('keyup'));assert.deepEqual(f.inputBuffer.consume().released,['Z']);
  const before={...f.calls};f.window.dispatchEvent(keyEvent('keydown'));f.context.runTick(true);f.context.runTick(false);
  assert.deepEqual(f.calls,before);assert.equal(f.inputBuffer.pending,0);assert.equal(f.calls.step,0);
  f.context.mode='practice';f.context.configurationLocked=false;f.context.keyDialog={isOpen:true};
  f.window.dispatchEvent(keyEvent('keydown'));assert.equal(f.inputBuffer.pending,0);assert.deepEqual(f.calls,before);
  f.context.keyDialog.isOpen=false;f.window.dispatchEvent(keyEvent('keydown'));
  assert.deepEqual(f.inputBuffer.consume().held,['Z']);f.context.dialog.destroy();
});

test('real Guild panel releases input, blocks controls, closes on Escape and restores previous pause state',()=>{
  for(const alreadyPaused of [false,true]){
    const f=fixture();f.elements.get('.skill-picker').hidden=true;f.stepPanel.hidden=true;f.context.paused=alreadyPaused;
    f.inputBuffer.down('RIGHT',0);f.inputBuffer.consume();f.context.secondPressed.push('Z');
    f.elements.get('#guild-skills').onclick();assert.equal(f.guildPanel.isOpen(),true);assert.equal(f.context.paused,true);
    assert.deepEqual(f.context.secondPressed,[]);assert.deepEqual(f.inputBuffer.consume().held,[]);
    const before=f.state();f.context.runTick(true);f.context.runTick(false);
    f.elements.get('#pause').onclick();f.stepToggle.onclick();
    assert.deepEqual(f.state(),before);assert.equal(f.context.paused,true);assert.equal(f.stepPanel.hidden,true);
    f.window.dispatchEvent(keyEvent('keydown'));assert.equal(f.calls.down,1,'battle input blocked while Guild is open');
    const escape=keyEvent('keydown','Escape');f.document.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented,true);assert.equal(f.guildPanel.isOpen(),false);
    assert.equal(f.context.paused,alreadyPaused);assert.equal(f.elements.get('#pause').textContent,alreadyPaused?'Resume':'Pause');
    assert.equal(f.calls.resetClock,2);f.guildPanel.dispose();f.context.dialog.destroy();
  }
});

test('Guild panel uses both actual button visibility and a direct handler guard for GM practice, permissions and queue lock',()=>{
  const f=fixture();f.elements.get('.skill-picker').hidden=true;f.stepPanel.hidden=true;
  const button=f.elements.get('#guild-skills');
  for(const [mode,role,locked]of [['lobby','gm',false],['online','gm',true],['practice2v2','gm',true],['practice','player',false],['practice','gm',true]]){
    f.context.mode=mode;f.context.currentSession={role};f.context.configurationLocked=locked;f.context.modeControls();
    assert.equal(f.context.lobbyLocked,locked,'lobby controls follow the production configuration lock');
    assert.equal(button.hidden,true);assert.equal(button.disabled,true);button.onclick();assert.equal(f.guildPanel.isOpen(),false);
  }
  f.context.mode='practice';f.context.currentSession={role:'gm'};f.context.configurationLocked=false;f.context.modeControls();
  assert.equal(button.hidden,false);assert.equal(button.disabled,false);
  f.context.keyDialog={isOpen:true};button.onclick();assert.equal(f.guildPanel.isOpen(),false);f.context.keyDialog=null;
  f.context.paused=false;f.context.keyTranslator.down('KeyZ');f.inputBuffer.down('Z',0);f.inputBuffer.consume();
  button.onclick();assert.equal(f.guildPanel.isOpen(),true);assert.deepEqual(f.inputBuffer.consume().held,[]);
  assert.equal(f.context.keyTranslator.up('KeyZ'),null,'opening Guild releases the translator as well as the sampled device');
  f.context.configurationLocked=true;f.context.modeControls();assert.equal(f.guildPanel.isOpen(),false);
  assert.equal(button.hidden,true);assert.equal(button.disabled,true);assert.equal(f.context.paused,false);
  f.guildPanel.dispose();f.context.dialog.destroy();
});

test('ordinary practice accounts can reset, prepare awakening and request target attacks; code diagnostics and other modes remain guarded',()=>{
  const f=fixture();f.context.currentSession={role:'player'};f.context.mode='practice';f.context.modeControls();
  for(const id of ['reset','prepare-awakening','target-attack']){
    const button=f.elements.get('#'+id);assert.equal(button.hidden,false);assert.equal(button.disabled,false);
  }
  for(const id of ['pause','export','audit-toggle','frame-inspect','prepare-death'])assert.equal(f.elements.get('#'+id).hidden,true);
  f.elements.get('#prepare-awakening').onclick();assert.equal(f.calls.prepare,1);
  f.elements.get('#target-attack').onclick();assert.deepEqual([...f.context.secondPressed],['Z']);
  f.elements.get('#reset').onclick();assert.equal(f.calls.restore,1);
  for(const mode of ['lobby','online','practice2v2']){
    f.context.mode=mode;f.context.modeControls();const before={...f.calls};
    for(const id of ['reset','prepare-awakening','target-attack']){
      const button=f.elements.get('#'+id);assert.equal(button.hidden,true);assert.equal(button.disabled,true);button.onclick();
    }
    assert.equal(f.calls.restore,before.restore);assert.equal(f.calls.prepare,before.prepare);assert.deepEqual([...f.context.secondPressed],[]);
  }
  f.guildPanel.dispose();f.context.dialog.destroy();
});

test('production mode controls display the actual 1v1, 2v2 and 3v3 match while keeping GM diagnostics locked',()=>{
  const f=fixture();f.context.mode='online';f.context.currentSession={role:'gm'};f.context.configurationLocked=true;
  for(const mode of ['1v1','2v2','3v3']){
    f.context.onlineMatch={id:'match-'+mode,mode};f.context.authoritativePvp={mode:'2v2'};f.context.modeControls();
    assert.equal(f.elements.get('.version-note').textContent,mode+' · Configuration locked');
    assert.equal(f.elements.get('.workbench-mode').textContent,'Reckless Fist / '+mode+' online match');
    assert.equal(f.context.lobbyLocked,true);assert.equal(f.elements.get('#guild-skills').hidden,true);assert.equal(f.elements.get('#guild-skills').disabled,true);
  }
  f.context.onlineMatch=null;f.context.authoritativePvp={mode:'1v1'};f.context.modeControls();
  assert.equal(f.elements.get('.workbench-mode').textContent,'Reckless Fist / 1v1 online match','authoritative mode is a fallback during handover');
  f.context.authoritativePvp=null;f.context.modeControls();assert.equal(f.elements.get('.workbench-mode').textContent,'Reckless Fist / 2v2 online match','older snapshots retain the existing default');
  f.guildPanel.dispose();f.context.dialog.destroy();
});

test('production closeDiagnostics and result handler close an open Guild before applying result pause',()=>{
  const f=fixture();f.elements.get('.skill-picker').hidden=true;f.stepPanel.hidden=true;f.context.paused=false;
  f.elements.get('#guild-skills').onclick();assert.equal(f.guildPanel.isOpen(),true);
  f.context.closeAll();assert.equal(f.guildPanel.isOpen(),false);assert.equal(f.context.paused,false);
  f.elements.get('#guild-skills').onclick();
  const calls=[],context=f.context;
  Object.assign(context,{type:'result',value:{matchId:'m',result:{winnerTeam:0}},onlineMatch:{id:'m'},
    matchEntry:{clear(){calls.push('clearEntry');}},
    online:{clearMatch(){calls.push('clearMatch');}},prediction:{clear(){calls.push('clearPrediction');}},
    ownershipSync:{clear(){}},session:{username:'rf'},mapGeneration:0,pendingLoadingState:null,
    resultReceipts:{accept(value){return {...value,playerId:'rf'};}},showAcceptedOnlineResult,
    pvpHud:{clear(){},update(){},show(){}},lobby:{show(){}},
    resultPresentation:{present(result){assert.equal(f.guildPanel.isOpen(),false);calls.push(result.winnerTeam);}},resultStartedAt:0,authoritativePvp:{phase:'fight'}});
  const start=source.indexOf("    if(type==='result'){");assert.ok(start>=0);
  const branch=source.slice(start,source.indexOf('  }});',start));vm.runInContext(branch,context);
  assert.equal(f.guildPanel.isOpen(),false);assert.equal(context.paused,true);assert.equal(context.authoritativePvp.phase,'result');
  assert.deepEqual(calls,['clearMatch','clearPrediction','clearEntry',0]);f.guildPanel.dispose();context.dialog.destroy();
});

test('production logout closes Guild and releases diagnostics before stopping rendering and reloading',async()=>{
  const f=fixture();f.elements.get('.skill-picker').hidden=true;f.stepPanel.hidden=true;f.context.paused=false;
  f.elements.get('#guild-skills').onclick();assert.equal(f.guildPanel.isOpen(),true);
  const calls=[];Object.assign(f.context,{resultPresentation:{clear(){calls.push('result-clear');}},awakeningBeadView:{dispose(){calls.push('beads');}},addSummonView:{dispose(){calls.push('summon');}},engine:{stopRenderLoop(){
    assert.equal(f.guildPanel.isOpen(),false);assert.equal(f.context.active,false);calls.push('stop');}},
    fetch:async(url,options)=>{assert.equal(url,'/api/logout');assert.equal(options.method,'POST');calls.push('logout');},
    location:{reload(){calls.push('reload');}}});
  const handler=source.split('\n').find(line=>line.startsWith("$('#logout').onclick="));assert.ok(handler);
  vm.runInContext(handler,f.context);await f.elements.get('#logout').onclick();
  assert.equal(f.guildPanel.isOpen(),false);assert.equal(f.stepPanel.hidden,true);assert.deepEqual(calls,['result-clear','beads','summon','stop','logout','reload']);
  f.context.dialog.destroy();
});

test('production frame fault stops actual GM manual stepping after a partially applied simulation step',t=>{
  const f=fixture();t.after(()=>{f.guildPanel.dispose();f.context.dialog.destroy();});
  const viewport=new GuildElement('div'),errors=[],calls=[];
  f.elements.set('.viewport',viewport);
  Object.assign(f.context,{createFrameSupervisor,console:{error:(...args)=>errors.push(args)},
    online:{close(){calls.push('close');}},location:{reload(){calls.push('reload');}}});
  const start=source.indexOf('  frameSupervisor=createFrameSupervisor('),end=source.indexOf('  engine.runRenderLoop(frameSupervisor.wrap(',start);
  assert.ok(start>=0&&end>start,'production frame fault handler is present');
  vm.runInContext(source.slice(start,end)+'\nthis.runFaultFrame=frameSupervisor.wrap(stage=>{stage("combat-and-owner-report");tick();});this.frameFault=()=>frameSupervisor.proof();',f.context);
  f.context.paused=false;
  const normalStep=f.context.simulation.step;
  f.context.simulation.step=()=>{normalStep();throw Error('injected-after-partial-step');};
  f.context.runFaultFrame();
  assert.equal(f.calls.step,1);assert.equal(f.state().time,1/60,'the fault follows a real partial state mutation');
  assert.equal(f.context.paused,true);assert.deepEqual(calls,['close']);assert.equal(errors.length,1);
  assert.equal(f.context.frameFault().stage,'combat-and-owner-report');
  assert.equal(f.context.frameFault().message,'injected-after-partial-step');
  assert.equal(viewport.children[0].id,'battle-runtime-error','the actual host displays recovery actions');
  assert.deepEqual(viewport.children[0].children.slice(2).map(button=>button.textContent),['Reload','Log out']);
  f.context.simulation.step=normalStep;
  const before=f.state(),frame=f.context.frame,steps=f.calls.step,taps=f.calls.tap;
  f.elements.get('#step-run').onclick();
  f.context.runTick(true);
  f.context.runFaultFrame();
  f.window.dispatchEvent(keyEvent('keydown'));
  assert.deepEqual(f.state(),before,'manual and automatic entry points retain the stopped state');
  assert.equal(f.context.frame,frame);assert.equal(f.calls.step,steps);assert.equal(f.calls.tap,taps);
  assert.equal(f.inputBuffer.pending,0);assert.equal(f.context.active,false);assert.equal(errors.length,1);
});

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.fields=new Map();this.dataset={};this.hidden=false;this.disabled=false;}
  append(...items){this.children.push(...items);}
  insertBefore(item){this.children.push(item);}
  querySelector(selector){if(!this.fields.has(selector))this.fields.set(selector,new Element(selector));return this.fields.get(selector);}
}
const poseResponse=()=>new Response(gzipSync(JSON.stringify({schemaVersion:1,clips:[],frames:[]})));
function motionFixture(t,{fetch:request,defaultGate=false}={}){
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch,host=new Element('main');
  globalThis.document={createElement:tag=>new Element(tag)};
  const calls={fetch:0,open:0,close:0},view={clips:new Map([['Wait',{}]]),sourceDurations:new Map([['Wait',1]])};
  globalThis.fetch=async(...args)=>{calls.fetch++;assert.equal(args[0],'/assets/rf/pose-tracks.json.gz');return request?request(...args):poseResponse();};
  t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
  const controls=new Map([['.workbench',host],['.skill-picker',{hidden:true}]]);
  const context={active:true,paused:false,slotPreparation:false,guildOpened:false,guildPanel:{isOpen:()=>context.guildOpened},
    inspectWasPaused:false,characterAudit:null,views:new Map([['rf',view]]),actorsNow:()=>[{id:'rf'}],
    mode:'practice',currentSession:{role:'gm'},configurationLocked:false,keyBindings:normalizeKeyBindings(),
    keyTranslator:createKeyBindingTranslator(normalizeKeyBindings()),coreKeyLabel,
    $:selector=>{if(!controls.has(selector))controls.set(selector,{});return controls.get(selector);},
    resetDisplayClock(){},stopSounds(){},weaponTrails:{clear(){}},say(){},inputBuffer:{releaseAll(){}},performance:{now:()=>1000},
    renderActor(){},canvas:{focus(){}},createMotionInspector(options){context.options=options;return {};}};
  const start=source.indexOf('motionInspector=createMotionInspector('),end=source.indexOf('  const session=bootSession;',start);
  assert.ok(start>=0&&end>start,'execute exactly the production motion inspector setup');
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const options=context.options,open=options.onOpen,close=options.onClose;
  options.onOpen=()=>{calls.open++;return open();};options.onClose=()=>{calls.close++;return close();};
  if(defaultGate)delete options.canOpen;
  const inspector=createMotionInspector(options),button=host.querySelector('.tools').children[0],panel=host.querySelector('.viewport').children[0];
  return {context,calls,controls,inspector,button,panel};
}

test('real motion module rejects a busy, visible-picker, open Guild or inactive entry before any fetch',async t=>{
  const f=motionFixture(t);
  f.context.slotPreparation=true;await f.button.onclick();
  f.context.slotPreparation=false;f.controls.get('.skill-picker').hidden=false;await f.button.onclick();
  f.controls.get('.skill-picker').hidden=true;f.context.guildOpened=true;await f.button.onclick();
  f.context.guildOpened=false;f.context.active=false;await f.button.onclick();
  assert.deepEqual(f.calls,{fetch:0,open:0,close:0});assert.equal(f.inspector.active,false);
  assert.equal(f.panel.hidden,true);assert.equal(f.button.disabled,false);
});

test('motion diagnostics require a GM account in practice mode and stay closed in lobby or online',async t=>{
  const f=motionFixture(t);
  for(const [mode,role] of [['lobby','gm'],['online','gm'],['practice','player']]){
    f.context.mode=mode;f.context.currentSession={role};await f.button.onclick();
    assert.equal(f.inspector.active,false);assert.equal(f.panel.hidden,true);
    assert.deepEqual(f.calls,{fetch:0,open:0,close:0});
  }
  f.context.mode='practice';f.context.currentSession={role:'gm'};await f.button.onclick();
  assert.equal(f.inspector.active,true);assert.deepEqual(f.calls,{fetch:1,open:1,close:0});
  f.panel.querySelector('#motion-close').onclick();assert.equal(f.inspector.active,false);
});

test('motion pose fetch finishing during save cannot open; a later idle retry opens and closes normally',async t=>{
  const wait=deferred(),f=motionFixture(t,{fetch:()=>wait.promise}),opening=f.button.onclick();
  assert.equal(f.calls.fetch,1);assert.equal(f.button.disabled,true);f.context.slotPreparation=true;
  wait.resolve(poseResponse());await opening;
  assert.equal(f.inspector.active,false);assert.equal(f.panel.hidden,true);assert.equal(f.calls.open,0);assert.equal(f.button.disabled,false);
  f.context.slotPreparation=false;await f.button.onclick();
  assert.equal(f.inspector.active,true);assert.equal(f.panel.hidden,false);assert.equal(f.context.paused,true);
  assert.equal(f.controls.get('#guild-skills').disabled,true);
  assert.deepEqual(f.calls,{fetch:1,open:1,close:0});assert.equal(f.context.inspectWasPaused,false);
  f.panel.querySelector('#motion-close').onclick();
  assert.equal(f.inspector.active,false);assert.equal(f.panel.hidden,true);assert.equal(f.context.paused,false);assert.equal(f.calls.close,1);
  assert.equal(f.controls.get('#guild-skills').disabled,false);
});

test('motion module retains its default open gate for callers that omit canOpen',async t=>{
  const f=motionFixture(t,{defaultGate:true});f.context.slotPreparation=true;await f.button.onclick();
  assert.equal(f.inspector.active,true);assert.equal(f.calls.open,1);f.panel.querySelector('#motion-close').onclick();
  assert.equal(f.inspector.active,false);assert.equal(f.calls.close,1);
});
