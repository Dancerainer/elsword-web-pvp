import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {instantiateNativeCamera} from '../../packages/native-source/camera.mjs';
import {advanceNormalCamera} from '../../apps/web/camera-follow.mjs';
import {normalTrackingActorPoints} from '../../apps/web/camera-line-basis.mjs';
import {createCameraHandoff} from '../../apps/web/camera-handoff.mjs';
import {createSpectatorCamera,spectatorText} from '../../apps/web/spectator-camera.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createKeyBindingTranslator,DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';
const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const cameraSource=game.slice(game.indexOf('function spectatorState('),game.indexOf('\nfunction selectAnimation('));
const keyboardSource=game.slice(game.indexOf("listenBattleWindow('keydown'"),game.indexOf("$('#pause').onclick"));
const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
async function fixture(){
  const map={...json('artifacts/scene/ruben-el-tree-stage-pvp/manifest.json'),...json('artifacts/scene/ruben-el-tree-stage-pvp/collision.json')};
  const spawn=map.spawns.find(p=>p.lineId===69),actors=Array.from({length:6},(_,i)=>({id:'p'+i,team:i<3?0:1,hp:100,
    x:spawn.position[0]+i*1000,y:spawn.position[1],z:spawn.position[2],facing:1,lineId:69,lastTouchLineId:69}));
  const players=actors.map(a=>({id:a.id,team:a.team,alive:true,connected:true,nickname:a.id})),listeners=new Map();
  const state={simulation:{map,view:()=>({actors})},actorsNow:()=>actors,authoritativePvp:{players},localPlayerId:'p0',isPvpMode:()=>true,
    cameraHandoff:createCameraHandoff(),spectatorCamera:createSpectatorCamera({random:()=>.9}),spectatorText,spectatorHint:{hidden:true,textContent:''},cameraTargetId:null,cameraHeld:false,shownActors:structuredClone(actors),
    cameraTracking:null,nativeRuntime:{camera:await instantiateNativeCamera(readFileSync(new URL('../../artifacts/native/camera.wasm',import.meta.url)))},
    preset:{cameraAdapter:{trackingSeconds:.3,targetTrackingSeconds:0}},normalTrackingActorPoints,advanceNormalCamera,SCALE:.01,
    Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}},camera:{upVector:{set(){}},position:{set(...value){this.value=value;}},setTarget(value){this.target=value;}},
    active:true,mode:'online',paused:false,slotPreparation:false,guildPanel:{isOpen:()=>false},keyDialog:{isOpen:false},
    pvpHud:{toggle(){}},keyTranslator:createKeyBindingTranslator(DEFAULT_KEY_BINDINGS),inputBuffer:createInputBuffer({sampledLevels:true}),
    performance:{now:()=>0},perf:{lastInput:0},say(){},canvas:{focus(){}},window:{addEventListener:(type,fn)=>listeners.set(type,fn)}};
  state.listenBattleWindow=(type,listener)=>listeners.set(type,listener);
  state.impactCamera={clear(){},advance(){return [0,0,0];}};state.hitFramebuffer={clear(){}};
  state.views=new Map();state.professionId='RF';
  vm.createContext(state);vm.runInContext(cameraSource+'\n'+keyboardSource,state);
  const press=(code,repeat=false)=>{let prevented=false;listeners.get('keydown')({code,repeat,target:{matches:()=>false},preventDefault(){prevented=true;}});return prevented;};
  const kill=id=>{Object.assign(actors.find(a=>a.id===id),{hp:0,hidden:true,deathComplete:true});players.find(p=>p.id===id).alive=false;};
  return {state,actors,players,press,kill};
}
test('production camera selects a living teammate after disappearance and Z/X never enter the combat input buffer',async()=>{
  const f=await fixture(),s=f.state;s.updateCamera(0,f.actors[0]);f.kill('p0');s.updateCamera(1/60,f.actors[0]);
  assert.equal(s.cameraTargetId,'p1');assert.equal(s.spectatorHint.hidden,false);
  const points=normalTrackingActorPoints(s.shownActors[1],s.simulation.map,0,s.preset.cameraAdapter);
  assert.ok(Math.abs(s.cameraTracking.eye[0]-points.eye[0])<.001,'init jumps instead of retaining the dead owner .3s track');
  const snapshot=structuredClone(f.actors);assert.equal(f.press('KeyX'),true);s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraTargetId,'p2');
  f.press('KeyX',true);s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraTargetId,'p2','repeat is one physical press');
  f.press('KeyZ');s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraTargetId,'p1');
  assert.deepEqual(s.inputBuffer.consume(Infinity).pressed,[]);assert.deepEqual(f.actors,snapshot);
});
test('production camera locks random enemy, freezes every axis when everyone dies, and jumps back after local revival',async()=>{
  const f=await fixture(),s=f.state;s.updateCamera(0,f.actors[0]);for(const id of ['p0','p1','p2'])f.kill(id);
  s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraTargetId,'p5');assert.equal(s.spectatorCamera.view().kind,'enemy');
  f.press('KeyZ');f.press('KeyX');s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraTargetId,'p5');
  const position=[...s.camera.position.value],target=structuredClone(s.camera.target);
  for(const id of ['p3','p4','p5'])f.kill(id);s.shownActors[5].x+=3000;s.shownActors[5].y-=1000;
  s.updateCamera(1/60,f.actors[0]);assert.equal(s.cameraHeld,true);assert.deepEqual(s.camera.position.value,position);assert.deepEqual({...s.camera.target},target);
  f.actors[0].hp=100;f.players[0].alive=true;s.updateCamera(1/60,f.actors[0]);
  assert.equal(s.cameraTargetId,'p0');assert.equal(s.cameraHeld,false);assert.equal(s.spectatorHint.hidden,true);
  f.press('KeyX');assert.deepEqual(s.inputBuffer.consume(Infinity).pressed,['X'],'revived owner regains its original combat keyboard');
});
