/** Actual production keydown/keyup handler, timestamped device packets; no client goldens. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createKeyBindingTranslator,DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';
import {dashZxFixture,dashZxFrame} from './rf_dash_zx_audit.mjs';
const gameSource=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const marker="listenBattleWindow('keydown'";
const first=gameSource.indexOf(marker),last=gameSource.indexOf("$('#pause').onclick",first);
if(first<0||last<first)throw new Error('Production keyboard block not found');
const handlers=gameSource.slice(first,last);
assert.equal(handlers.indexOf(marker,marker.length),-1,'Battle keyboard block has one keydown registration');
// V52 puts registrations behind the battle lifetime owner. Keep evaluating
// the actual production handlers against this fixture's isolated EventTarget.
const registration="const listenBattleWindow=(...args)=>window.addEventListener(...args);\n";
const modeGuard=gameSource.match(/^const isPvpMode=.*;$/m)?.[0];
assert.ok(modeGuard,'Production PvP keyboard mode guard is present');
export const keyboardHandlerSha256=createHash('sha256').update(handlers.replace(/\r\n/g,'\n')).digest('hex');
export async function observePreinputV19({facing=1,gap=70,tailZ=false,sameRead=false,tailZMode='landing',presetOverride}={}){
 const f=await dashZxFixture({facing,gap,presetOverride}),buffer=createInputBuffer({sampledLevels:true}),frames=[],packets=[],dom=[];
 let clock=0;const keyMap={ArrowLeft:'LEFT',ArrowRight:'RIGHT',ArrowUp:'UP',ArrowDown:'DOWN',KeyZ:'Z',KeyX:'X'};
 const window=new EventTarget();window.matches=()=>false;
 runInNewContext(registration+modeGuard+'\n'+handlers,{window,active:true,mode:'practice',keyDialog:null,guildPanel:{isOpen:()=>false},keyTranslator:createKeyBindingTranslator(DEFAULT_KEY_BINDINGS),paused:false,slotPreparation:false,keyMap,inputBuffer:buffer,
  performance:{now:()=>clock*1000},say:()=>{},perf:{lastInput:0},canvas:{focus(){}}});
 const code=Object.fromEntries(Object.entries(keyMap).map(([c,k])=>[k,c]));
 function edge(key,down,offset=.001){clock=f.s.state.time+offset;const e=new Event(down?'keydown':'keyup',{cancelable:true});Object.defineProperty(e,'code',{value:code[key]});window.dispatchEvent(e);dom.push({key,down,time:clock,prevented:e.defaultPrevented});}
 function step(n=1){for(let i=0;i<n;i++){const p=buffer.consume(f.s.state.time+1/60);packets.push(p);dashZxFrame(f,p);frames.push({step:f.s.state.step,state:f.a.state,animationTime:f.a.animationTime,position:[f.a.x,f.a.y,f.a.z],facing:f.a.facing,cancelInput:JSON.parse(JSON.stringify(f.a.cancelInput??null)),packet:p});}}
 function until(state,max=180){let n=0;while(f.a.state!==state&&n++<max)step();if(f.a.state!==state)throw Error('Preinput state not reached '+state);}
 function press(key,n=1){edge(key,true);step(n);edge(key,false);step();}
 press('Z',2);press('Z',2);until('RSI_COMBO_ZZ');while(f.a.hitStop>0||f.a.worldStop>0)step();
 press('X');until('RSI_COMBO_ZZX');press('X');until('RSI_COMBO_ZZXX');while(f.a.hitStop>0||f.a.worldStop>0)step();
 const inputStart=f.s.state.step;
 edge('UP',true);
 if(sameRead){edge('UP',false,.002);edge('DOWN',true,.003);edge('DOWN',false,.004);edge('X',true,.005);step();}
 else{step();edge('UP',false);edge('DOWN',true,.002);step();edge('DOWN',false);edge('X',true,.002);step();}
 edge('X',false);step();
 for(let i=0;i<150&&f.a.state!=='RSI_JUMP_COMBO_X';i++)step();
 const airXReached=f.a.state==='RSI_JUMP_COMBO_X';
 if(tailZ&&airXReached){if(tailZMode==='landing')for(let i=0;i<150&&!f.a.grounded;i++)step();press('Z');}
 step(120);const events=f.s.drainEvents();
 return {fixture:{facing,gap,presetOverride,tailZ,sameRead,tailZMode,sampled:true},evidenceClass:'node-EventTarget-production-DOM-handler-current-runtime',targetClientMeasured:false,keyboardHandlerSha256,
  versions:f.s.versions,inputStart,airXReached,dom,packets,frames,events,stateChanges:events.filter(e=>e.actorId==='rf'&&e.type==='stateChanged'),hits:events.filter(e=>e.actorId==='rf'&&e.type==='hit'),snapshot:JSON.parse(JSON.stringify(f.s.snapshot()))};
}
export async function observeDoubleCancelV19({facing=1,gap=70,stepFrames=1,overlap=true,sampled=true,releaseFrames=1,holdLast=true,presetOverride}={}){
 const f=await dashZxFixture({facing,gap,presetOverride}),buffer=createInputBuffer({sampledLevels:sampled}),frames=[],packets=[],dom=[];
 const forward=facing===1?'RIGHT':'LEFT',back=facing===1?'LEFT':'RIGHT';let clock=0;
 const keyMap={ArrowLeft:'LEFT',ArrowRight:'RIGHT',KeyZ:'Z',KeyX:'X'};
 const window=new EventTarget();window.matches=()=>false;
 runInNewContext(registration+modeGuard+'\n'+handlers,{window,active:true,mode:'practice',keyDialog:null,guildPanel:{isOpen:()=>false},keyTranslator:createKeyBindingTranslator(DEFAULT_KEY_BINDINGS),paused:false,slotPreparation:false,keyMap,inputBuffer:buffer,
  performance:{now:()=>clock*1000},say:()=>{},perf:{lastInput:0},canvas:{focus(){}}});
 const code=Object.fromEntries(Object.entries(keyMap).map(([c,k])=>[k,c]));
 function edge(key,down,offset=.001){clock=f.s.state.time+offset;const event=new Event(down?'keydown':'keyup',{cancelable:true});
  Object.defineProperty(event,'code',{value:code[key]});window.dispatchEvent(event);dom.push({key,down,time:clock,prevented:event.defaultPrevented});}
 function step(n=1){for(let i=0;i<n;i++){const packet=buffer.consume(f.s.state.time+1/60);packets.push(packet);dashZxFrame(f,packet);
  frames.push({step:f.s.state.step,state:f.a.state,animationTime:f.a.animationTime,facing:f.a.facing,vx:f.a.vx,
   hitStop:f.a.hitStop,worldStop:f.a.worldStop,position:[f.a.x,f.a.y,f.a.z],pendingPressed:[...f.a.pendingPressed],packet});}}
 function until(state,max=180){let i=0;while(f.a.state!==state&&i++<max)step();if(f.a.state!==state)throw new Error('State not reached '+state);}
 function press(key,n=1){edge(key,true);step(n);edge(key,false);step();}
 press('Z',2);press('Z',2);until('RSI_COMBO_ZZ');
 while(f.a.hitStop>0||f.a.worldStop>0)step();
 edge('X',true);step();edge('X',false);until('RSI_COMBO_ZZX');const xStep=f.s.state.step;
 press(forward,stepFrames);edge(forward,true);step(stepFrames);
 if(overlap){edge(back,true);step(stepFrames);
  // 4 is sampled while 6 is still held. The release/repress of 6 is wholly
  // between the following two Reads, so the original one6 lock stays set.
  edge(forward,false);edge(back,false,.002);edge(forward,true,.003);step(stepFrames);
 }else{edge(forward,false);edge(back,true,.002);step(stepFrames);edge(back,false);edge(forward,true,.002);step(stepFrames);}
 const final6={state:f.a.state,facing:f.a.facing,step:f.s.state.step};
 if(!holdLast){edge(forward,false);step(releaseFrames);}else step(releaseFrames);
 edge('Z',true);step();const secondZStart=f.a.state;edge('Z',false);step();press('Z',2);
 edge(forward,false);edge(back,false);let zzReached=false;for(let i=0;i<90;i++){step();if(f.a.state==='RSI_COMBO_ZZ')zzReached=true;}
 const events=f.s.drainEvents();
 return {fixture:{facing,gap,presetOverride,stepFrames,overlap,sampled,releaseFrames,holdLast},evidenceClass:'node-EventTarget-production-DOM-handler-current-runtime',targetClientMeasured:false,
  keyboardHandlerSha256,versions:f.s.versions,dom,packets,frames,xStep,final6,secondZStart,zzReached,
  stateChanges:events.filter(e=>e.actorId==='rf'&&e.type==='stateChanged'),hits:events.filter(e=>e.type==='hit'&&e.actorId==='rf'),events,snapshot:JSON.parse(JSON.stringify(f.s.snapshot()))};
}
export async function verifyDoubleCancelReplay(r){
 const f=await dashZxFixture(r.fixture),g=await dashZxFixture(r.fixture);
 for(const p of r.packets)dashZxFrame(f,p);
 assert.deepEqual(JSON.parse(JSON.stringify(f.s.drainEvents())),JSON.parse(JSON.stringify(r.events)));
 assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),r.snapshot);
 g.s.restore(JSON.parse(JSON.stringify(f.s.snapshot())));
 for(let i=0;i<120;i++){dashZxFrame(f,{});dashZxFrame(g,{});assert.deepEqual(JSON.parse(JSON.stringify(f.s.snapshot())),JSON.parse(JSON.stringify(g.s.snapshot())));}
 return {fullPackets:r.packets.length,eventsAndSnapshotIdentical:true,jsonRestorePackets:120};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const rows=[];for(const facing of [-1,1])for(const gap of [70,1500])for(const stepFrames of [1,2,3])for(const overlap of [false,true])for(const holdLast of [false,true])for(const sampled of [false,true]){
  const row=await observeDoubleCancelV19({facing,gap,stepFrames,overlap,holdLast,sampled});row.replay=await verifyDoubleCancelReplay(row);rows.push(row);}
 const out=process.argv[2]??'artifacts/proof-double-cancel-v19/observations.json';mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify({schema:'rf-double-cancel-device-v19',targetClientMeasured:false,rows},null,2)+'\n');
 console.log(JSON.stringify({out,rows:rows.length,normalZZ:rows.filter(r=>r.zzReached).length,sourceNormalZZ:rows.filter(r=>r.fixture.sampled&&r.zzReached).length,legacyNormalZZ:rows.filter(r=>!r.fixture.sampled&&r.zzReached).length}));
}
