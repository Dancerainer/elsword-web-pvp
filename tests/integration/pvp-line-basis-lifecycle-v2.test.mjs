import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {authoredLineBasis,actorWorldQuaternion} from '../../packages/combat-assets/line-basis.mjs';
import {normalTrackingActorPoints} from '../../apps/web/camera-line-basis.mjs';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';
import {createSpectatorCamera,spectatorText} from '../../apps/web/spectator-camera.mjs';
import {createCameraHandoff} from '../../apps/web/camera-handoff.mjs';
import {createOpeningPoseHandoff} from '../../apps/web/opening-pose-handoff.mjs';

const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const map=id=>({...json('artifacts/scene/'+id+'/manifest.json'),...json('artifacts/scene/'+id+'/collision.json')});
const tree=map('ruben-el-tree-stage-pvp'),roof=map('elder-wally-castle-roof-stage4');
const players=[{id:'r0',team:0},{id:'r1',team:0},{id:'b0',team:1},{id:'b1',team:1}];
const versions={referenceVersion:'source-contract',presetVersion:'test',programVersion:'rf-render-camera-v2'};

test('actual PvP revival at an airborne teammate preserves remembered authored yaw and land point, without creating support',()=>{
  const simulation={state:{actors:players.map(p=>({...p,hp:100,hpMax:100,mp:80,mpMax:300,
    x:0,y:0,z:0,grounded:true,deathComplete:false,inputLock:0,forceInvincible:0})),effects:[]}};
  const originals=structuredClone(simulation.state.actors);
  const pvp=new PvpMatch({players,map:tree,versions,seed:12,onRespawn(id){
    const index=simulation.state.actors.findIndex(a=>a.id===id),replacement=structuredClone(originals[index]);
    simulation.state.actors[index]=replacement;return replacement;
  }});
  pvp.start(simulation);pvp.advance(4.5,simulation);
  const actor=id=>simulation.state.actors.find(a=>a.id===id),teammate=actor('r1');
  const rememberedLine=teammate.lineId,land=structuredClone(teammate.landPosition);
  teammate.lineId=null;teammate.grounded=false;teammate.y+=200;
  const expectedYaw=actorWorldQuaternion(teammate,tree);
  actor('r0').hp=0;actor('r0').deathComplete=true;pvp.advance(0,simulation);
  const wait=pvp.player('r0').respawnAt;pvp.advance(wait,simulation);
  const revived=actor('r0');assert.equal(pvp.player('r0').alive,true);
  assert.equal(revived.lineId,null);assert.equal(revived.grounded,false);
  assert.equal(revived.lastTouchLineId,rememberedLine);assert.deepEqual(revived.landPosition,land);
  assert.deepEqual([revived.x,revived.y,revived.z],[teammate.x,teammate.y,teammate.z]);
  assert.deepEqual(actorWorldQuaternion(revived,tree),expectedYaw);
  const event=pvp.drainEvents().find(e=>e.type==='respawn');
  assert.equal(event.lastTouchLineId,rememberedLine);assert.deepEqual(event.landPosition,land);
  assert.equal(event.lineId,null);assert.equal(event.grounded,false);
  assert.doesNotThrow(()=>normalTrackingActorPoints(revived,tree,0,{trackingSeconds:.3,targetTrackingSeconds:0}));
});

const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const returnSource=game.slice(game.indexOf('function returnToLobby(){'),game.indexOf('\nfunction handleOnlineError'));
const cameraSource=game.slice(game.indexOf('function spectatorState('),game.indexOf('\nfunction selectAnimation('));
const renderSource=game.slice(game.indexOf('function renderActor('),game.indexOf('\nfunction tick('));

test('actual game lobby restore and async changed environment draw old practice actor against its own map, not a new smaller map',()=>{
  const spawn=tree.spawns.find(s=>s.kind==='SetTeamStartPos'&&s.lineId===69);assert.ok(spawn);
  const actor={id:'practice',x:spawn.position[0],y:spawn.position[1],z:spawn.position[2],
    lineId:69,lastTouchLineId:69,facing:1,hp:100,state:'RSI_WAIT',animationName:'Wait',animationTime:0,loadout:[]};
  assert.equal(roof.lines.some(l=>l.lineId===69),false,'independent real smaller-map fixture must not contain the practice lane');
  assert.throws(()=>authoredLineBasis(actor,roof),/saved original line/,'reproduce the old global-manifest mismatch');
  const snapshot={actors:[actor]},practice={map:tree,state:structuredClone(snapshot),
    restore(value){this.state=structuredClone(value);},view(){return this.state;},actor(id){return this.state.actors.find(a=>a.id===id);}};
  const root={rotation:{y:0},setEnabled(value){this.enabled=value;}},view={root,meshes:[]},noop=()=>{};
  const camera={upVector:{set:noop},position:{set(x,y,z){this.values=[x,y,z];}},setTarget(value){this.target=value;}};
  const state={structuredClone,lobbyHandoff:null,presentedResultReceipt:null,addSummonView:null,simulation:{map:roof},practiceSimulation:practice,practiceSnapshot:snapshot,baselineSnapshot:{},views:new Map([['practice',view]]),
    matchEntry:{clear(){}},pendingLoadingState:null,
    mapManifest:roof,mapLoading:false,mapGeneration:0,practiceGeneration:0,pvpPractice:null,ownershipSync:{clear:noop},ownedPresentation:{clear:noop},ownershipMode:null,
    closeDiagnostics:noop,prediction:{clear:noop},online:{clearMatch:noop,api:async()=>({})},onlineMatch:{id:'match'},localPlayerId:'r0',
    remotePackets:new Map(),remoteDevices:new Map(),remoteHeld:new Map(),lastServerSequence:0,authoritativePvp:{phase:'result'},configurationLocked:true,mode:'online',paused:false,
    inputBuffer:{clear:noop},keyTranslator:{releaseAll:noop},nameplates:{clear:noop},weaponTrails:{clear:noop,setLocalActor:noop},effectsView:{clear:noop},
    damageNumbers:{clear:noop},worldColorView:{clear:noop},pvpHud:{clear:noop},currentMapVersions:{sceneId:'fixture-map'},lobby:{setPracticeMap:noop,status:noop,show:noop,history:noop,error:noop},onlineTransportError:null,
    updateModeControls:noop,rebuildSlots:noop,updateHud:noop,resetDisplayClock:noop,say:noop,loadout:[],actorsNow:()=>state.simulation.view().actors,isPvpMode:()=>['online','practice2v2'].includes(state.mode),
    camera,preset:{cameraAdapter:{trackingSeconds:.3,targetTrackingSeconds:0}},nativeRuntime:{camera:{}},cameraTracking:null,
    resultPresentation:{clear(){}},cameraHandoff:createCameraHandoff(),spectatorCamera:createSpectatorCamera(),spectatorText,spectatorHint:{hidden:true,textContent:''},cameraTargetId:null,cameraHeld:false,shownActors:[actor],
    normalTrackingActorPoints,authoredLineBasis,advanceNormalCamera(_bridge,points){return {...points,up:[0,1,0]};},
    SCALE:.01,Vector3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}},motionInspector:{active:false},selectAnimation:()=> 'Wait',setAnimation:noop,placeActor:noop,createOpeningPoseHandoff,
    updateActorArmorPresentation:noop,updateActorInvulnerabilityPresentation:noop,profile:{states:{RSI_WAIT:{raw:{}}}},performance:{now:()=>0},resultStartedAt:0,lastServerAt:0};
  state.professionSwitch=createProfessionSwitch({current:()=> 'RF',canCommit:()=>false,commit:()=>assert.fail('no pending profession switch')});
  state.poseAudio={step(){},clear(){}};state.hitLighting={clear(){},reset(){}};
  state.impactCamera={clear(){},advance(){return [0,0,0];}};state.hitFramebuffer={clear(){}};state.updateWeaponPresentation=noop;state.sourceActorCameraDistance=()=>null;state.professionId='RF';
  vm.createContext(state);vm.runInContext(returnSource+'\n'+cameraSource+'\n'+renderSource,state);
  state.returnToLobby();assert.equal(state.mode,'lobby');assert.equal(state.simulation,practice);assert.equal(state.mapManifest,roof);
  assert.doesNotThrow(()=>state.updateCamera(0,practice.state.actors[0]));
  assert.doesNotThrow(()=>state.renderActor(practice.state.actors[0],0));
  assert.ok(camera.position.values.every(Number.isFinite));
  assert.equal(root.rotation.y,authoredLineBasis(actor,tree).rendererYawRadians);
  // The same mismatch also occurs temporarily after a new environment has
  // loaded, while the previous simulation awaits readiness/view preparation.
  state.mode='online';state.onlineStarting=true;state.mapLoading=true;
  assert.doesNotThrow(()=>state.updateCamera(0,practice.state.actors[0]));
  assert.doesNotThrow(()=>state.renderActor(practice.state.actors[0],0));
});
