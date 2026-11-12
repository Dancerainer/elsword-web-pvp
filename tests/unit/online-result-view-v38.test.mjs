import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createResultReceipt} from '../../apps/web/result-receipt.mjs';
import {createResultPresentation} from '../../apps/web/result-presentation.mjs';
import {createPvpHud} from '../../apps/web/pvp-hud.mjs';
import {createMatchEntry} from '../../apps/web/match-entry.mjs';
import {showAcceptedOnlineResult} from '../../apps/web/online-result-view.mjs';

class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.style={};this.dataset={};this.attributes={};this.hidden=false;this.className='';this._text='';
    this.classList={toggle:(name,enabled)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));if(enabled)values.add(name);else values.delete(name);this.className=[...values].join(' ');}};}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this._text='';this.append(...nodes);}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const packet={matchId:'match-1',result:{mode:'1v1',winnerTeam:0,score:[4,1],players:[
  {id:'self',nickname:'Local',team:0,kills:4,assists:1,deaths:1},{id:'opponent',nickname:'Opponent',team:1,kills:1,assists:0,deaths:4}]}};
const source=await readFile(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
function block(from,to){const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,'game wiring boundary exists');return source.slice(start,end);}
const resultHandler=block("    if(type==='result'){",'\n  }});');
const stateHandler=block('async function acceptServerState(value){','\nasync function initializeOnline(session){');

function fixture({recovered=false,admitted=false}={}){
  const document={createElement:tag=>new Element(tag,document)},host=new Element('main',document),callbacks=new Map();let nextTimer=0,returned=0;
  const timers={setTimeout(fn){const id=++nextTimer;callbacks.set(id,fn);return id;},clearTimeout(id){callbacks.delete(id);}};
  const storageValues=new Map(),storage={getItem:key=>storageValues.get(key)??null,setItem:(key,value)=>storageValues.set(key,value)};
  const receipts=createResultReceipt({storage}),match={id:'match-1',players:structuredClone(packet.result.players)};
  const entry=createMatchEntry({host,onReturn(){throw Error('loading return must not remain visible after settlement');}});
  if(!recovered){entry.begin(match,{playerId:'self'});if(admitted){entry.prepared(match);entry.admit(match,'fight');}}
  const hud=createPvpHud({host,localId:'unknown',timers,onReturn(){receipts.dismiss(context.presentedResultReceipt);returned++;}});hud.show(false);
  const presentation=createResultPresentation({hud:()=>hud,playSound(){},durationFor:()=>0,timers});
  let lobbyVisible=recovered;
  const context={resultReceipts:receipts,presentedResultReceipt:null,onlineMatch:recovered?null:match,session:{username:'self'},mode:recovered?'lobby':'online',
    closeDiagnostics(){},paused:false,online:{clearMatch(){},ready:async()=>({ok:true})},prediction:{clear(){}},ownershipSync:{clear(){}},
    performance:{now:()=>123},resultStartedAt:null,authoritativePvp:recovered?null:{phase:'fight'},mapGeneration:1,pendingLoadingState:{sequence:2},localPlayerId:null,
    showAcceptedOnlineResult,matchEntry:entry,lobby:{show(value){lobbyVisible=value;}},pvpHud:hud,resultPresentation:presentation};
  vm.createContext(context);vm.runInContext('globalThis.receiveResult=(type,value)=>{'+resultHandler+'\n};',context);
  return {context,entry,hud,receipts,storage,storageValues,callbacks,returned:()=>returned,lobbyVisible:()=>lobbyVisible,
    flush(){for(const [id,callback]of callbacks){callbacks.delete(id);callback();}}};
}

for(const settings of [{recovered:false,admitted:false},{recovered:false,admitted:true},{recovered:true}])
test('game result event exposes the result roster and clears loading for '+JSON.stringify(settings),()=>{
  const f=fixture(settings);f.context.receiveResult('result',packet);
  assert.equal(f.context.paused,true);assert.equal(f.entry.root.hidden,true);assert.equal(f.hud.root.hidden,false);assert.equal(f.lobbyVisible(),false);
  assert.equal(f.context.localPlayerId,'self');assert.equal(f.context.authoritativePvp.phase,'result');assert.equal(f.context.pendingLoadingState,null);
  assert.equal(f.context.mapGeneration,2);assert.equal(f.storageValues.size,0,'showing does not acknowledge');
  f.flush();assert.match(f.hud.root.textContent,/Local/);assert.match(f.hud.root.textContent,/Opponent/);
  const result=descendants(f.hud.root).find(node=>node.className==='pvp-result');assert.equal(result.hidden,false);
  const button=descendants(result).find(node=>node.tagName==='button');assert.ok(button);button.onclick();assert.equal(f.returned(),1);
  assert.equal(createResultReceipt({storage:f.storage}).accept(packet,{playerId:'self'}),null,'actual HUD return acknowledges the account');
  f.context.receiveResult('result',structuredClone(packet));assert.equal(f.callbacks.size,0,'duplicate delivery cannot reopen a dismissed result');
});

for(const stage of ['map','views','scene','ready'])test('early result terminates actual game preparation while awaiting '+stage,async()=>{
  const f=fixture(),gate=deferred(),waiting=deferred(),calls={simulation:0,ready:0,released:0};
  const local={id:'self',loadout:{}},simulation={state:{actors:[local]},actor:()=>local};
  const wait=async name=>{if(name!==stage)return true;waiting.resolve();await gate.promise;return true;};
  Object.assign(f.context,{onlineStarting:false,lastServerSequence:-1,lastServerAt:0,ownershipMode:null,currentSession:{username:'self'},DEFAULT_SCENE_ID:'scene',
    ownsLocalUnit:()=>false,setRemotePacket(){},reportLoading(){},loadBattleMap:()=>wait('map'),views:new Map(),simulation,
    scene:{whenReadyAsync:()=>wait('scene')},loadout:null,rebuildSlots(){},resetDisplayClock(){},weaponTrails:{setLocalActor(){}},
    onlineFactory:Object.assign(()=>{calls.simulation++;return simulation;},{prepareViews:async(_,context)=>{context.releaseUnusedViews=()=>calls.released++;return wait('views');}})});
  f.context.online.ready=async()=>{calls.ready++;await wait('ready');return {ok:true};};
  vm.runInContext(stateHandler,f.context);
  const pending=f.context.acceptServerState({matchId:'match-1',sequence:1,snapshot:{actors:[local]},pvp:{phase:'fight'}});
  await waiting.promise;f.context.receiveResult('result',packet);gate.resolve();await pending;
  assert.equal(f.entry.root.hidden,true);assert.equal(f.hud.root.hidden,false);assert.equal(f.context.authoritativePvp.phase,'result');assert.equal(f.context.onlineStarting,false);
  assert.equal(calls.simulation,stage==='map'?0:1);assert.equal(calls.ready,stage==='ready'?1:0);assert.equal(calls.released,stage==='map'?0:1);
  await f.context.acceptServerState({matchId:'match-1',sequence:99,snapshot:{actors:[local]},pvp:{phase:'fight'}});
  assert.equal(f.context.authoritativePvp.phase,'result','a callback already queued before transport close cannot rewind the result');
  assert.equal(f.context.lastServerSequence,1);
});
