import {isElswordProfession,isElesisProfession,isAddProfession} from '../../packages/professions/identity.mjs';
import {createAddHud} from './add-hud.mjs';
import statusHudLayout from '../../contracts/status-hud-source-v33.json' with {type:'json'};
import {ADD_DP_MAX,ADD_MUTATION_MAX,createAddResourcePools} from '../../packages/combat-core/add-systems.mjs';
import {assetUrl,initializeAssetUrls,versionStyleSheetAssets} from './asset-urls.mjs';
import {installActiveMeshCandidates} from './active-mesh-candidates.mjs';
import {createRenderQuality,RENDER_QUALITY_MODES} from './render-quality.mjs';
import {createResourceTimingSummary} from './resource-timing-summary.mjs';
import { Engine, Scene, Color3, Color4, Vector3, Matrix, FreeCamera, Camera, TransformNode, SceneLoader, Tools } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createSimulation } from '../../packages/combat-core/index.mjs';
import {createLordKnightResourcePools} from '../../packages/combat-core/lord-knight.mjs';
import {createElesisResourcePools} from '../../packages/combat-core/elesis-way-of-sword.mjs';
import {installCommonBuffs} from '../../packages/combat-core/buffs.mjs';
import {installAddMoonlightSource} from '../../packages/combat-core/add-moonlight-source-v45.mjs';
import { createNativeSamplers, mergeEffectIndexes } from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes,collectEffectPoseFiles} from '../../packages/combat-assets/effect-indexes.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS,getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {PROFESSIONS,normalizeProfessionId,isRavenProfession} from '../../packages/professions/catalog.mjs';
import {createProfessionSamplers} from '../../packages/combat-assets/profession-samplers.mjs';
import {createProfessionEffects} from './profession-effects.mjs';
import {createProfessionAssetCache,prewarmAllProfessionSkills} from './load-profession-assets.mjs';
import {scheduleRenderPreparation} from './render-preparation.mjs';
import {createProfessionSwitch} from './profession-switch.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from './costume-view.mjs';
import {selectedCostume,costumeCharacter,normalizeCostumePreferences} from '../../packages/professions/costumes.mjs';
import { createActorView, sampleAnimation, placeActor, getActorNativePoints } from './actor-presentation.mjs';
import {createAddSummonView} from './add-summon-view.mjs';
import {createBuffAfterimages} from './buff-afterimages.mjs';
import {setNativeTransparentLayer,setNativeMapTransparentLayers,NATIVE_UNIT_LAYER} from './native-effect-draw-order-v3.mjs';
import {authoredLineBasis,normalTrackingActorPoints} from './camera-line-basis.mjs';
import {advanceNormalCamera} from './camera-follow.mjs';
import {createMapUvScroll} from './map-uv-scroll.mjs';
import {createSpectatorCamera,spectatorText} from './spectator-camera.mjs';
import {createCameraHandoff} from './camera-handoff.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {NATIVE_RUNTIME_VERSION} from '../../packages/native-source/runtime-version.mjs';
import { createRFWeaponTrails,supportsRavenClawTrail } from './weapon-trails.mjs';
import { createLighting, styleCharacter, presentationSettings } from './lighting.mjs';
import {setCharacterWorldLight} from './character-toon-material.mjs';
import {createGroundShadows} from './ground-shadow.mjs';
import {updateWeaponPresentation,sourceActorCameraDistance} from './weapon-presentation.mjs';
import { createMotionInspector } from './motion-inspector.mjs';
import { createPoseAudit } from './pose-audit.mjs';
import { createInputBuffer } from './input-buffer.mjs';
import {recoverAddSecondUp} from './add-second-up-input-v58.mjs';
import {createInputStepClock} from './input-step-clock.mjs';
import {createInputStageTrace} from './input-stage-trace.mjs';
import { createEffectsView } from './effects-view.mjs';
import {DEFAULT_EFFECT_QUALITY,createEffectPresentationPolicy} from '../../packages/effect-runtime/presentation-quality.mjs';
import {styleNasodCore,updateNasodCorePresentation} from './nasod-core-presentation.mjs';
import { createSkillSlot, cleanSkillText, updateSkillSlotAvailability } from './skill-slot.mjs';
import {updateAddGeneratorSkillSlot} from './add-generator-skill-slot.mjs';
import {createSkillSwordCues} from './skill-sword-cues.mjs';
import { opponentGauges, manaBreakGauge, awakeningCountdown } from './hud-values.mjs';
import {createManaBreakRenderClock,manaBreakGuidePositions,updateManaBreakBar} from './mana-break-hud.mjs';
import {bindBattleSkillSlots,createSkillTree,createPickerTooltip,editPickerLoadout,cancelPickerDrag} from './skill-picker.mjs';
import {createPickerDialogController} from './skill-picker-dialog.mjs';
import {placeSkillSlot,quickEquipTarget,choosePickerBranch,applyPickerBranches} from './skill-picker-state.mjs';
import {createSkillPreferencesClient} from './skill-preferences.mjs';
import {createActorRenderClock} from './actor-render-clock.mjs';
import {updateActorArmorPresentation} from './armor-presentation.mjs';
import {updateActorInvulnerabilityPresentation} from './invulnerability-presentation.mjs';
import {createDamageNumbers} from './damage-numbers.mjs';
import {createAwakeningBeadView} from './awakening-bead.mjs';
import {createWayOfSwordHud} from './way-of-sword-hud.mjs';
import {createWayOfSwordParticleView} from './way-of-sword-particles.mjs';
import {createBattleAudio,createBattleAudioControls} from './battle-audio.mjs';
import {createSourceStateAudio} from './source-state-audio-v61.mjs';
import {loadRosterAudio} from './roster-audio-v61.mjs';
import {sourceCameraEye} from './source-audio-distance-v45.mjs';
import {createAudioGestureGate} from './audio-preferences.mjs';
import {createOnlineClient} from './online-client.mjs';
import {createOpeningPoseHandoff} from './opening-pose-handoff.mjs';
import {createOnlineLobby} from './online-lobby.mjs';
import {createInterfaceAudio} from './interface-audio.mjs';
import {createMatchEntry} from './match-entry.mjs';
import {createResultPresentation} from './result-presentation.mjs';
import {createPvpHud} from './pvp-hud.mjs';
import {createKeyBindingTranslator,DEFAULT_KEY_BINDINGS,coreKeyLabel} from '../../packages/input/key-bindings.mjs';
import {createKeyBindingsDialog} from './key-bindings.mjs';
import {createBuffBar} from './buff-bar.mjs';
import {createSampledKeyboardBuffer} from './sampled-keyboard.mjs';
import {createInputPredictionHistory,createLocalOwnershipSync} from './input-prediction.mjs';
import {createPlayerNameplates} from './player-nameplates.mjs';
import {createGuildPanel} from './guild-panel.mjs';
import {createPvpPractice} from './pvp-practice.mjs';
import {PVP_RULE_VERSION} from '../../packages/pvp/index.mjs';
import {createOwnedPresentation} from './owned-presentation.mjs';
import {createRemoteActorClock} from './remote-actor-clock.mjs';
import {createResultReceipt} from './result-receipt.mjs';
import {showAcceptedOnlineResult} from './online-result-view.mjs';
import {createFrameSupervisor} from './frame-supervisor.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
import {loadMapDeclarations,practiceActors as pairedPracticeActors,mapProjection} from './map-runtime.mjs';
import {DEFAULT_SCENE_ID,MAP_NAMES} from '../../packages/online/map-pool.mjs';
import {createWorldColorView} from './world-color.mjs';
import {createHitLighting} from './hit-lighting.mjs';
import {createPoseAudio} from './pose-audio.mjs';
import {preparePracticeTarget,restorePracticeResources} from './practice-resources.mjs';
import {createSkillBarSizeControl} from './skill-bar-size.mjs';
import {createBackgroundFrameRequester} from './background-frame-requester.mjs';
import {createBattleResourcePrefetch,battleBootstrapUrls} from './battle-resource-prefetch.mjs';

export async function startBattle(){
const battleLifetime=new AbortController();
const listenBattleWindow=(type,listener)=>window.addEventListener(type,listener,{signal:battleLifetime.signal});
const assetVersions=await initializeAssetUrls();
const pageInitToken=document.querySelector('#app').dataset?.pageInitToken??null;
const sessionResponse=await fetch('/api/session',{headers:pageInitToken?{'X-RF-Page-Init':pageInitToken}:{}});
if(!sessionResponse.ok)throw Error(`/api/session: HTTP ${sessionResponse.status}`);
const bootSession=await sessionResponse.json();
const lobbyHandoff=globalThis.webpvpLobbyHandoff??null;
const launchIntent=lobbyHandoff?.intent??null;
// Battle boot keeps one local fixture. Ordinary practice adds its mirror only
// when requested, using the already loaded profession's body/pose containers.
const practiceActors=(map,{includeTarget=false}={})=>pairedPracticeActors(map).slice(0,includeTarget?2:1);
let costumePreferences=normalizeCostumePreferences(bootSession.costumes),costumeAssets;
if(pageInitToken)bootSession.pageInitToken=pageInitToken;
let professionId=normalizeProfessionId(bootSession.professionId,{fallback:true}),profession=PROFESSIONS[professionId];
let profile=getProfessionProfile(professionId),preset=getProfessionPreset(professionId);
performance.setResourceTimingBufferSize(10000);
const resourceTimings=createResourceTimingSummary({performance,PerformanceObserver:window.PerformanceObserver});
Tools.PreprocessUrl=assetUrl;
versionStyleSheetAssets(document);
document.body.classList.add('battle-workbench');
const $ = selector => document.querySelector(selector);
const effectPresentationPolicies=Object.fromEntries(Object.entries(PROFESSION_PROFILES).map(([id,p])=>[id,createEffectPresentationPolicy(p,DEFAULT_EFFECT_QUALITY)]));
const actorClawEnabled=actor=>supportsRavenClawTrail(simulation.profileFor(actor))&&
  (effectPresentationPolicies[actor.professionId].actor(actor).level==='high'||actor.professionId==='RF'&&actor.skillId===24010);
document.querySelector('#app').innerHTML = `<main class="workbench">
  <header class="workbench-header"><strong>web pvp · ${profession.id}</strong><span class="workbench-mode">${profession.name} / Match Lobby</span><span class="version-note">Skills and controls</span><button id="logout">Log out</button></header>
  <section class="viewport"><canvas id="arena" tabindex="0" aria-label="${profession.id} battle scene"></canvas>
    <div class="hud-root"><div class="native-hud"><img class="hud-frame" src="/assets/ui/gage_bg.png"><img class="hud-face" src="${professionId==='RF'?'/assets/ui/r_fist_state.png':PROFESSIONS[professionId].assetBase+'ui/portrait-state.png'}"><div class="hud-hp"><img src="/assets/ui/hp.png"></div><div class="hud-mp"><img src="/assets/ui/mp.png"></div><div class="hud-mana-break" role="progressbar" aria-label="Mana break charge" aria-valuemin="0" aria-valuemax="300" aria-valuenow="0" hidden><img src="/assets/ui/mp_active.png" alt=""></div><span class="hud-level-label" hidden>Lv</span><span class="hud-level" hidden></span><div class="hud-name">${profession.name}</div><div class="hud-number hud-hp-number"></div><div class="hud-number hud-mp-number"></div><div class="wake-readout"><span id="wake-orbs">○ ○ ○</span> <span class="wake-gauge"><span></span></span></div><span id="wake-time" aria-label="Awakening time remaining"></span></div>
    <div class="opponent-hud" aria-label="Opponent status"><img class="opponent-frame" src="/assets/ui/party_gage_bg.png" alt=""><img class="opponent-face" src="${profession.portraitUrl}" alt="${profession.name}"><div class="opponent-bar"><img src="/assets/ui/party_hp.png" alt=""></div><div class="opponent-mp"><img src="/assets/ui/party_mp.png" alt=""></div><div class="opponent-name">${profession.id} mirror target</div><span id="target-hp"></span><span id="target-mp"></span></div>
    <div class="skill-bar"></div><div class="help-strip">←← / →→ Dash · ↑ Jump · ↓ Drop · Z / X Attack · Ctrl Awaken · Q W E R / A S D C Skills</div><div class="arena-message" aria-live="polite"></div></div>
    <pre class="audit" hidden></pre><div class="loading-overlay">Loading models and map…</div>
    <section class="skill-picker" role="dialog" aria-label="${profession.id} skill setup" aria-modal="true" hidden>
      <header><strong>Skills · ${profession.label}</strong><span>Enhanced · Max level</span><button id="picker-close" aria-label="Close skill setup">×</button></header>
      <div class="picker-body"><section class="picker-tree-panel"><div class="picker-tree-heading"><span>Active</span><span>Passive</span></div><div class="picker-tree-scroll"><div class="skill-catalog"></div></div></section>
      </div>
      <p class="picker-instructions">Right-click a skill to equip it, drag it to a specific slot, or right-click an equipped slot to clear it.</p><p class="picker-message" role="status"></p>
    </section>
  </section><footer class="tools"><button id="skills">Skill setup</button><button id="guild-skills">Guild skills</button><button id="reset">Reset</button><button id="restore-resources">Restore resources</button><button id="prepare-awakening" title="Set up an awakening test independently of normal charge gain">Prepare awakening</button><button id="target-attack">Target attack</button><button id="pause">Pause</button><button id="export">Export trace</button><button id="audit-toggle">Validation log</button><span class="status">Initializing</span></footer>
</main>`.replace(/src="([^"]+)"/g,(_,url)=>'src="'+assetUrl(url)+'"');
$('.workbench').classList.toggle('entry-loading',Boolean(lobbyHandoff));
let audioStorage=null;try{audioStorage=localStorage;}catch{}
const audioGesture=createAudioGestureGate({target:window});
const battleAudio=createBattleAudio({storage:audioStorage,canPlay:()=>audioGesture.allowed,createAudio:url=>new Audio(assetUrl(url)),onError:event=>recordEvent(event),localActorId:()=>localPlayerId??actorsNow()[0]?.id});
if(typeof lobbyHandoff?.audio?.enabled==='boolean')battleAudio.setEnabled(lobbyHandoff.audio.enabled);
let interfaceAudio=null;
createBattleAudioControls({document,host:$('.tools'),before:$('.status'),player:battleAudio,
  onFocus:()=>inputBuffer.releaseAll(performance.now()/1000),
  onChange:({volume,enabled})=>{interfaceAudio?.setVolume(volume);interfaceAudio?.setEnabled(enabled);}});
createSkillBarSizeControl({document,host:$('.tools'),before:$('.status'),bar:$('.skill-bar'),storage:audioStorage,
  onFocus:()=>inputBuffer.releaseAll(performance.now()/1000)});
const deathPrepare=document.createElement('button');deathPrepare.id='prepare-death';deathPrepare.textContent='Prepare death test';deathPrepare.title='Set the mirror target to 1 HP, then attack to trigger the death sequence.';$('.tools').insertBefore(deathPrepare,$('.status'));
const stepToggle=document.createElement('button');stepToggle.id='frame-inspect';stepToggle.textContent='Frame step';$('.tools').insertBefore(stepToggle,$('.status'));
const stepPanel=document.createElement('section');stepPanel.className='frame-inspector';stepPanel.hidden=true;
stepPanel.innerHTML=`<header><strong>Inspect input and effects by frame</strong><button id="step-close">Close inspector</button></header><p>The web simulation runs at 60 Hz. Step through the simulation clock to inspect trigger frames. Original client traces are pending.</p><label>Input command <select id="step-command"><option value="">No input</option>${['Z','X',...preset.skillKeys,'AWAKEN','LEFT','RIGHT','DOWN','UP'].map(k=>`<option value="${k}">${k}</option>`).join('')}</select></label><label>Step count <input id="step-count" type="number" min="1" max="240" value="1"></label><label class="step-hold-label"><input id="step-held" type="checkbox">Hold key down</label><button id="step-run">Step</button><button id="step-release">Release all keys</button>`;$('.viewport').append(stepPanel);
const swordPrepare=document.createElement('div');swordPrepare.id='sword-test-controls';
swordPrepare.innerHTML='<label>Way of the Sword test state <select id="sword-test-state"><option value="0">Neutral</option><option value="2">Vitality</option><option value="-2">Destruction</option></select></label><button id="prepare-sword">Set sword state</button><small>Set the test state here. Use normal hits to verify resource gain.</small>';stepPanel.append(swordPrepare);
let stepWasPaused=false;
let audioManifest,criticalSoundFile,castDisplayVisuals,castDisplaySourceIndexes=[];
const sourceStateAudio=createSourceStateAudio({player:battleAudio,generationForActor:actorId=>ownsLocalUnit()?ownershipSync.epoch(actorId):0,rawForState:(actorId,state)=>{
  const actor=simulation?.state.actors.find(row=>row.id===actorId);
  return (actor?simulation.profileFor(actor):profile).states[state]?.raw;
}});
function stopSounds(){battleAudio.stop();sourceStateAudio.clear();}
function playSound(name,source=null){return battleAudio.play(name,source);}
const resultPresentation=createResultPresentation({hud:()=>pvpHud,playSound,durationFor:name=>audioManifest?.files?.[name]?.durationSeconds});
const nativeHud=$('.native-hud');
const addHud=createAddHud({document,host:nativeHud});
nativeHud.dataset.professionId=professionId;
const nativeRage=document.createElement('img');nativeRage.className='native-rage';nativeRage.src=assetUrl('/assets/ui/rage.png');nativeHud.append(nativeRage);
for(const [i,ordinaryPoint] of statusHudLayout.awakeningBackgrounds.entries()){
  const ravenThird=i===2&&isRavenProfession(professionId),point=ravenThird?statusHudLayout.ravenThirdBackground:ordinaryPoint;
  const beadPoint=ravenThird?statusHudLayout.ravenThirdBead:statusHudLayout.awakeningBeads[i];
  const bg=document.createElement('img');bg.className='wake-bead-bg';bg.src=assetUrl('/assets/ui/'+(i===2&&isRavenProfession(professionId)?'raven_3_bg':'rage_bg')+'.png');bg.style.left=point[0]+'px';bg.style.top=point[1]+'px';nativeHud.append(bg);
  const bead=document.createElement('img');bead.id='wake-bead-'+i;bead.className='wake-bead';bead.src=assetUrl('/assets/ui/'+(ravenThird?'raven_3':'rage_bead')+'.png');bead.style.left=beadPoint[0]+'px';bead.style.top=beadPoint[1]+'px';nativeHud.append(bead);
}

const canvas = $('#arena');
const pickerTooltip=createPickerTooltip(document,$('.viewport'));
const pickerDialog=createPickerDialogController({keyboardTarget:window,picker:$('.skill-picker'),closeButton:$('#picker-close'),
  openKey:'KeyK',canOpen:()=>active&&!$('#skills').hidden&&!$('#skills').disabled&&!guildPanel.isOpen()&&!keyDialog?.isOpen&&!document.querySelector('.lobby-gm-overlay:not([hidden])'),
  onOpen:()=>{lobby?.show(false);$('#skills').click();},
  isPreparing:()=>slotPreparation,onClose:()=>{
    pickerTooltip.hide();cancelPickerDrag(document);$('.skill-picker').hidden=true;
    inputBuffer.releaseAll(performance.now()/1000);paused=pickerWasPaused;resetDisplayClock();canvas.focus();professionSwitch.flush();if(mode==='lobby')lobby?.show(true);
  }});
$('.picker-tree-scroll').addEventListener('scroll',pickerTooltip.hide);
// The game viewport is opaque. An RGBA canvas accumulates particle alpha,
// causing DESTALPHA passes to erase the scene after ordinary alpha fades.
// Target render-target format/post-processing remains a separate fidelity check.
const engine = new Engine(canvas, true, { alpha: false, preserveDrawingBuffer: false, stencil: true, antialias: true });
// The fixed combat clock runs inside this loop. Electron keeps RAF active with
// backgroundThrottling:false; Babylon must also admit frames after window blur.
engine.renderEvenInBackground=true;
const backgroundFrames=createBackgroundFrameRequester();engine.customAnimationFrameRequester=backgroundFrames;
engine.onDisposeObservable.add(()=>backgroundFrames.dispose());
const scene = new Scene(engine);
// Capture the constructor-default provider before any scene extension. This
// scene's mesh membership is managed through Babylon's public add/remove APIs.
const sceneMeshProvider=scene.getActiveMeshCandidates;
scene.useRightHandedSystem = true; scene.clearColor = new Color4(.12,.16,.24,1);
const meshCandidates=installActiveMeshCandidates(scene,{sceneMeshProvider,appendOnlyMembership:true});
scene.skipPointerMovePicking=true;
const camera = new FreeCamera('fixed-camera', new Vector3(0,30,85), scene);
camera.mode = Camera.PERSPECTIVE_CAMERA; camera.fov = preset.cameraAdapter.verticalFovRadians;
// Normal tracking is retained. State camera callbacks, auto zoom and shake are disabled.
createLighting(scene);
const SCALE = .01;
let frameSupervisor;
let simulation, initialSnapshot, baselineSnapshot, recordingReason='initial-load', paused = false, frame = 0, active = false;
let mode=lobbyHandoff?'loading':'lobby',configurationLocked=false,currentSession,online,lobby,pvpHud,keyDialog,buffBar;
const sessionRequestHeaders=()=>{const token=currentSession?.pageInitToken??pageInitToken;return token?{'X-RF-Page-Init':token}:{};};
let onlineTransportError=null;
let keyBindings=structuredClone(DEFAULT_KEY_BINDINGS),localPlayerId=null,onlineMatch=null,preparingMatch=null,onlineStarting=false,pendingLoadingState=null;
const matchEntry=createMatchEntry({host:$('.workbench'),onReturn:returnToLobby});
const bootLoading=lobbyHandoff?(launchIntent?.match??{id:'free-training-loading',players:[{id:bootSession.username,
  username:bootSession.username,nickname:bootSession.nickname??bootSession.username,professionId,team:1,loadingProgress:0}]}):null;
if(bootLoading){matchEntry.begin(bootLoading,{playerId:bootSession.username});$('.loading-overlay').hidden=true;}
function bootStage(text,percent){
  if(bootLoading){
    matchEntry.stage(bootLoading,text);
    if(Number.isFinite(percent))matchEntry.progress(bootLoading,bootSession.username,percent);
  }else $('.loading-overlay').textContent=text;
}
bootStage('Preparing map and combat assets…',8);
function reportLoading(match,percent){
  if(onlineMatch!==match||mode!=='online')return;
  matchEntry.progress(match,currentSession.username,percent);
  online.loadingProgress(match.id,percent).catch(error=>{if(onlineMatch===match)recordEvent({type:'loading-progress-report-failed',message:error.message});});
}
let onlineFactory,practiceSimulation,practiceSnapshot,authoritativePvp=null,lastServerSequence=-1;
let pvpPractice=null,practiceGeneration=0;
const isPvpMode=()=>mode==='online'||mode==='practice2v2';
const spectatorCamera=createSpectatorCamera();
const cameraHandoff=createCameraHandoff();
const spectatorHint=document.createElement('div');spectatorHint.className='spectator-hud';spectatorHint.hidden=true;
spectatorHint.setAttribute('role','status');$('.hud-root').append(spectatorHint);
let cameraTargetId=null,cameraHeld=false;
const ownedPresentation=createOwnedPresentation();
const remoteActorClock=createRemoteActorClock({captureContacts:true});
const resultReceipts=createResultReceipt();
let battleBootReady=false,pendingEndedReconnect=null;
let presentedResultReceipt=null;
const ownershipSync=createLocalOwnershipSync({presentation:ownedPresentation,remotePresentation:remoteActorClock});let ownershipMode=null;
const ownsLocalUnit=()=>mode==='online'&&ownershipMode==='local-owner-v1';
const usesCombatPlayback=()=>ownsLocalUnit()&&simulation.networkCombatPlaybackVersion===1;
const keyTranslator=createKeyBindingTranslator(keyBindings),remotePackets=new Map();
const remoteDevices=new Map(),remoteHeld=new Map();let resultStartedAt=0;
const prediction=createInputPredictionHistory();let lastServerAt=0,keysWasPaused=false;
function setRemotePacket(id,packet){const prior=remotePackets.get(id);if((packet.frameSeq??0)<(prior?.frameSeq??0))return;remotePackets.set(id,{held:[...packet.held],frameSeq:packet.frameSeq??0});}
function remoteSample(id,prime=false){
  if(!remoteDevices.has(id)){remoteDevices.set(id,createSampledKeyboardBuffer());remoteHeld.set(id,new Set());}
  const device=remoteDevices.get(id),old=remoteHeld.get(id),next=new Set(remotePackets.get(id)?.held??[]);
  for(const key of old)if(!next.has(key))device.up(key,0);for(const key of next)if(!old.has(key))device.down(key,0);
  remoteHeld.set(id,next);return device.consume(Infinity,prime?0:1/60);
}
let rfManifest, mapManifest, uiManifest, skillCatalog;
const professionAssets=new Map();
const professionPreferences=new Map(),professionPracticeViews=new Map();
const professionResourceSessionId=globalThis.crypto?.randomUUID?.()??'boot-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let professionAssetCache,professionPrewarmReady=false,lastProfessionSwitchMs=null,professionEpoch=0;
let commonBuffs,commonBuffVisuals,commonBuffSourceIndexes=[];
let battleLifeVisuals,battleLifeSourceIndexes=[];
let mapEnvironment,mapSceneRoot,mapGeneration=0,simulationSamplers,geometryModule,mapLoading=false;
let selectedPracticeMap=launchIntent?.sceneId??launchIntent?.match?.sceneId??DEFAULT_SCENE_ID;
let currentMapVersions={};
const worldColorView=createWorldColorView({profile,profileFor:actor=>getProfessionProfile(actor.professionId??professionId)});
let loadout=Array(8).fill(null),selectedSlot=0,selectedSkillId=null,pickerWasPaused=false;
let branchChoices={};
let pickerStorage=null;try{pickerStorage=localStorage;}catch{}
let skillPreferences;
const views = new Map(), replay = [], eventLog = [], inputBuffer = createInputBuffer({sampledLevels:true});
// All diagnostics share the same bounded recent-event window, including errors.
function recordEvent(event){eventLog.push(event);if(eventLog.length>250)eventLog.splice(0,eventLog.length-250);}
const hitLighting=createHitLighting({scene,viewFor:id=>views.get(id),mapFor:()=>simulation?.map});
const groundShadows=createGroundShadows({scene,textureUrl:assetUrl('/assets/common-buffs/native-shadow.png'),
  profileFor:actor=>simulation.profileFor(actor),mapFor:()=>simulation.map});
const poseAudio=createPoseAudio({profileFor:actor=>simulation.profileFor(actor),localActorId:()=>localPlayerId??actorsNow()[0]?.id,play:playSound});
const buffAfterimages=createBuffAfterimages({scene,viewFor:id=>views.get(id),localActorId:()=>localPlayerId??actorsNow()[0]?.id});
const inputStepClock=createInputStepClock();
const inputStageTrace=createInputStageTrace();
const secondPressed = [];
let effectsView, weaponTrails, damageNumbers, mapUvScroll, addSummonView;
const actorRenderClock=createActorRenderClock();
const manaBreakRenderClock=createManaBreakRenderClock();
let shownActors=[];
function resetDisplayClock({resetPresentation=false}={}){inputStageTrace.reset();buffAfterimages.clear();if(resetPresentation){addSummonView?.reset();groundShadows.clear();}inputStepClock.rebase(performance.now()/1000);if(simulation){actorRenderClock.reset(actorsNow());manaBreakRenderClock.reset(actorsNow()[0]);shownActors=actorsNow();updateManaBreakHud(actorsNow()[0],1,true);}}
const perf = {steps:0,frames:0,stepMs:[],frameMs:[],poseMs:[],inputMs:[],fxActive:0};
function measure(list,value){list.push(value);if(list.length>300)list.shift();}
function percentile(list,p=.95){if(!list.length)return 0;const sorted=[...list].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*p)];}
const perfOutput=document.createElement('output');perfOutput.id='performance-readout';perfOutput.className='performance-readout';$('.viewport').append(perfOutput);
const renderQuality=createRenderQuality({storage:audioStorage,onChange:resize});
const qualityLabel=document.createElement('label');qualityLabel.className='render-quality';qualityLabel.textContent='Graphics ';
const qualitySelect=document.createElement('select');qualitySelect.id='render-quality';qualitySelect.setAttribute('aria-label','Graphics');
for(const [id,settings]of Object.entries(RENDER_QUALITY_MODES)){const option=document.createElement('option');option.value=id;option.textContent=settings.label;qualitySelect.append(option);}
qualitySelect.value=renderQuality.mode;qualityLabel.append(qualitySelect);$('.tools').append(qualityLabel);
qualitySelect.onchange=()=>{renderQuality.setMode(qualitySelect.value);canvas.focus();};
for(const type of ['keydown','keyup'])qualitySelect.addEventListener(type,event=>event.stopPropagation());
qualitySelect.onfocus=()=>inputBuffer.releaseAll(performance.now()/1000);
// User presentation policy: hit camera shake and screen clear flashes are disabled.
const hud = Object.fromEntries(['.hud-hp','.hud-mp','.hud-mana-break','.hud-hp-number','.hud-mp-number','#wake-orbs','#wake-time','#target-hp','#target-mp','.opponent-bar','.opponent-mp','.tools .status'].map(s=>[s,$(s)]));
const beads=[0,1,2].map(i=>$('#wake-bead-'+i)), wakeGauge=$('.wake-gauge span');
let skillButtons=[], lastHudAt=0, lastPerformanceAt=0;
const manaGuides=document.createElement('div');manaGuides.className='hud-mp-guides';
hud['.hud-mana-break'].after(manaGuides);
let manaGuideMaximum=null;
function updateManaGuides(maximum){
  if(manaGuideMaximum===maximum)return;manaGuideMaximum=maximum;
  manaGuides.replaceChildren(...manaBreakGuidePositions(maximum).map(point=>{
    const image=document.createElement('img');image.src=assetUrl('/assets/ui/mp_100_bar.png');image.alt=`${point.mp} MP`;
    image.style.left=point.left+'px';image.style.top=point.top+'px';return image;
  }));
}
function updateManaBreakHud(actor,alpha,exact=false){
  if(!actor)return;
  updateManaBreakBar(hud['.hud-mana-break'],manaBreakRenderClock.sample(actor,alpha,{exact}),
    {authoritativeCharge:manaBreakGauge(actor).charge});
}
let cameraTracking,nativeRuntime,awakeningBeadView,wayOfSwordHud,wayOfSwordParticles,skillSwordCues;
let motionInspector, nameplates, inspectWasPaused = false;
let characterAudit, coreAudit;
let guildWasPaused=false;
const guildPanel=createGuildPanel({document,host:$('.workbench'),assetUrl,
  onOpen(){
    guildWasPaused=paused;paused=true;resetDisplayClock();stopSounds();
    keyTranslator.releaseAll();inputBuffer.releaseAll(performance.now()/1000);secondPressed.length=0;
    $('#pause').textContent='Resume';
  },
  onClose(){
    inputBuffer.releaseAll(performance.now()/1000);secondPressed.length=0;
    paused=guildWasPaused;resetDisplayClock();$('#pause').textContent=paused?'Resume':'Pause';
    if(active){professionSwitch.flush();queueMicrotask(()=>canvas.focus());}
  }});
$('#guild-skills').onclick=()=>{
  if(!active||mode!=='practice'||currentSession?.role!=='gm'||configurationLocked||slotPreparation||keyDialog?.isOpen||motionInspector?.active||!$('.skill-picker').hidden||!stepPanel.hidden)return;
  guildPanel.open();
};

async function data(url,{signal}={}) { const response = await fetch(assetUrl(url),signal?{signal}:undefined); if (!response.ok) throw Error(`${url}: HTTP ${response.status}`); return response.json(); }
function resize() {
  const ratio=renderQuality.pixelRatio({width:canvas.clientWidth,height:canvas.clientHeight,devicePixelRatio:window.devicePixelRatio});
  engine.setHardwareScalingLevel(1/ratio);
  engine.resize();
}
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
function stateNow() { return simulation.snapshot(); }
function beginRecording(reason){initialSnapshot=stateNow();recordingReason=reason;frame=0;replay.length=0;}
function actorsNow() { const actors=simulation.view().actors;if(!localPlayerId)return actors;const local=actors.find(a=>a.id===localPlayerId);return local?[local,...actors.filter(a=>a!==local)]:actors; }
function say(text) { $('.arena-message').textContent = text; }
function spectatorState(){return spectatorCamera.update({actors:actorsNow(),players:authoritativePvp?.players??actorsNow(),
  localId:localPlayerId??actorsNow()[0]?.id,enabled:isPvpMode()});}
function updateCamera(dt, actor,displayActors=shownActors) {
  const watch=spectatorState();
  spectatorHint.textContent=spectatorText(watch);spectatorHint.hidden=!watch.spectating;
  if(!watch.tracking){cameraHeld=true;return;}
  if(cameraTargetId!==watch.targetId||cameraHeld){cameraTracking=null;cameraTargetId=watch.targetId;cameraHeld=false;}
  actor=displayActors?.find(a=>a.id===watch.targetId)??actorsNow().find(a=>a.id===watch.targetId)??actor;
  if(!actor)return;
  // Lobby restores its retained practice simulation while the latest match's
  // environment may remain loaded. Draw the actor against its own authored
  // map, also during async scene preparation; the asset manifest is separate.
  const presentationMap=simulation.map;
  const c=preset.cameraAdapter, land=presentationMap.worldSettings.find(x=>x.callee==='SetLandHeight')?.arguments[0]??0;
  const points=normalTrackingActorPoints(actor,presentationMap,land,c,{previous:cameraTracking?.lineCamera,dt});
  cameraTracking=advanceNormalCamera(nativeRuntime.camera,points,c,dt,cameraTracking);
  const cameraShown=cameraHandoff.apply(cameraTracking,watch.targetId,dt,{transition:watch.spectating});
  const [x,y,z]=cameraShown.eye,[tx,ty,tz]=cameraShown.target;
  camera.upVector.set(cameraShown.up[0],cameraShown.up[1],-cameraShown.up[2]);
  camera.position.set(x*SCALE,y*SCALE,-z*SCALE);camera.setTarget(new Vector3(tx*SCALE,ty*SCALE,-tz*SCALE));
  for(const shown of displayActors??[]){const view=views.get(shown.id);if(!view)continue;
    const id=shown.professionId??professionId;
    updateWeaponPresentation(view,shown,id,{cameraDistance:sourceActorCameraDistance(view,id,camera.position)});
  }
}

function selectAnimation(actor) {
  if (actor.animationName) return actor.animationName;
  if (actor.animation) return typeof actor.animation === 'string' ? actor.animation : actor.animation.name;
  const actorProfile=simulation.profileFor?.(actor)??profile;
  if (actorProfile.states?.[actor.state]?.animation) return actorProfile.states[actor.state].animation;
  // These are only display-name aliases; they do not set gameplay durations or hit windows.
  return ({ idle:'Wait', walk:'Walk', run:'Dash', dash:'Dash', jump:'JumpUp', fall:'JumpDown',
    awakening:'BoostPower', awaken:'BoostPower', hit:'DamageSmallFront', down:'DamageDownFront',
    standup:'DamageStandUpFront', dead:'Lose' })[actor.state] || actor.state || 'Wait';
}
function setAnimation(view, name, time, loop = false, transition = null, holdFinalFrame = false) {
  if (!sampleAnimation(view, name, time, loop, transition, holdFinalFrame) && !view.missing.has(name)) {
    view.missing.add(name); recordEvent({type:'unsupported-animation',name});
  }
}
async function createView(container, id, sourcePose) {
  const view=createActorView(container, scene, id, SCALE, sourcePose);
  setNativeTransparentLayer(view.meshes,NATIVE_UNIT_LAYER);return view;
}
function presentEvents(events){
  if(!events.length)return;
  const state=simulation.view();
  const display=(stage,fn)=>frameSupervisor?frameSupervisor.presentation(stage,fn):fn();
  display('effect-event-batch',()=>effectsView?.beginEventBatch(state));
  try{for(const event of events){
      recordEvent(event);
      display('effect-events',()=>effectsView?.event(event,state));
      display('world-color-events',()=>worldColorView?.event(event));
      display('hit-light-events',()=>hitLighting.event(event,state));
      display('damage-number-events',()=>damageNumbers?.event(event));
      display('add-resource-events',()=>addHud.event(event,actorsNow()[0]?.id));
      if(event.type==='sound'||event.type==='stateChanged')sourceStateAudio.event(event);
      if(event.type==='skillRejected')say(({ 'empty-slot':'This skill slot is empty','insufficient-mp':'Insufficient MP','cooldown':'Skill on cooldown','state-or-ground-condition':'This skill cannot be used in the current state'})[event.reason]||'Skill did not activate');
    }}finally{display('effect-event-batch',()=>effectsView?.endEventBatch());}
}
function drain(){const events=simulation.drainEvents();if(mode!=='online')presentEvents(events);}
function updateHud(actors) {
  const actor=actors[0];if(!actor)return;
  wayOfSwordHud?.update(actor);
  skillSwordCues?.update(actor);
  const target=isPvpMode()?null:actors[1];
  const hpMax=actor.maxHp ?? actor.hpMax ?? preset.hp ?? profile.maxHp ?? 10000;
  const mpMax=actor.maxMp ?? actor.mpMax ?? preset.mp ?? profile.maxMp ?? 300;
  hud['.hud-hp'].style.width = `${224*Math.max(0,actor.hp/hpMax)}px`;
  hud['.hud-mp'].style.width = `${224*Math.max(0,actor.mp/mpMax)}px`;
  updateManaGuides(mpMax);
  hud['.hud-hp-number'].textContent=`${Math.round(actor.hp)} / ${Math.round(hpMax)}`;
  hud['.hud-mp-number'].textContent=`${Math.round(actor.mp)} / ${mpMax}`;
  const hudLevel=actor.formulaRules?.combatLevel;
  const showHudLevel=Number.isFinite(hudLevel)&&hudLevel>0;
  $('.hud-level-label').hidden=$('.hud-level').hidden=!showHudLevel;
  $('.hud-level').textContent=showHudLevel?String(Math.trunc(hudLevel)):'';
  $('.hud-name').textContent=isPvpMode()?String(authoritativePvp?.players?.find(p=>p.id===actor.id)?.nickname??authoritativePvp?.players?.find(p=>p.id===actor.id)?.name??actor.id):profession.name;
  $('.opponent-hud').hidden=!target;
  $('.opponent-name').textContent=mode==='online'?String(target?.id??''):profession.id+' mirror target';
  const wake=actor.awakening||{};
  addHud.update(actor);
  hud['#wake-orbs'].textContent=[0,1,2].map(i=>i<(wake.orbs||0)?'●':'○').join(' ');
  for(let i=0;i<3;i++)beads[i].style.opacity=i<(wake.orbs||0)?'1':'.12';
  wakeGauge.style.width=`${Math.max(0,Math.min(100,wake.gauge||0))}%`;
  nativeRage.style.clipPath=`inset(${100-Math.max(0,Math.min(100,wake.gauge||0))}% 0 0 0)`;
  const countdown=awakeningCountdown(wake.remaining);
  hud['#wake-time'].textContent=countdown.text;
  hud['#wake-time'].classList.toggle('urgent',countdown.urgent);
  if(target){const gauge=opponentGauges(actor,target);hud['#target-hp'].textContent=gauge.hpText;hud['#target-mp'].textContent=gauge.mpText;
    hud['.opponent-bar'].style.width=`${95*gauge.hpFraction}px`;hud['.opponent-mp'].style.width=`${93*gauge.mpFraction}px`;
    $('.opponent-hud').dataset.opponentMpVisible=String(gauge.showMp);}
  hud['.tools .status'].textContent=`${actor.state} · ${Math.round(actor.x)}, ${Math.round(actor.y)} · ${paused?'Pause':frame+' steps'}`;
  for(const button of skillButtons){
    const availability=simulation.skillAvailability(actor.id,button.dataset.key);
    updateSkillSlotAvailability(button,availability);
    updateAddGeneratorSkillSlot(button,{actor,definition:skillCatalog.skills.find(s=>s.id===Number(button.dataset.skill)),availability});
  }
  buffBar?.update(actor,{mode,profile:simulation.profile});
  pvpHud?.update(authoritativePvp,{actors,localId:localPlayerId});
}
function renderActor(actor,dt=0) {
  const view=views.get(actor.id);if(!view)return;
  if (motionInspector?.active && actor.id === actorsNow()[0].id) actor = motionInspector.actor(actor);
  const presentation=actor.pvpPresentation;
  const name=presentation?.animationName??selectAnimation(actor), t=authoritativePvp?.phase==='result'&&presentation?Math.min(presentation.duration,(performance.now()-resultStartedAt)/1000):presentation?Math.min(presentation.duration,presentation.time+(mode==='online'?(performance.now()-lastServerAt)/1000:0)):actor.animationTime ?? actor.stateTime ?? 0;
  poseAudio.step(actor,t);
  view.openingPoseHandoff??=createOpeningPoseHandoff();
  const opening=view.openingPoseHandoff.sample({phase:authoritativePvp?.phase,presentation,time:t,dt});
  setAnimation(view,name,t, presentation?.loop??actor.animationLoop ?? ['Wait','Walk','Dash'].includes(name),motionInspector?.active?null:opening.override?opening.transition:actor.presentationTransition,Boolean(presentation));
  placeActor(view,actor,SCALE,authoredLineBasis(actor,simulation.map).rendererYawRadians);
  view.costume?.update(actor,dt);
  updateActorArmorPresentation(view,actor,(simulation.profileFor?.(actor)??profile).states[actor.state]?.raw,{showAll:preset.showAllSuperArmorOutlines===true});
  view.root.setEnabled(actor.hidden !== true);
  updateActorInvulnerabilityPresentation(view,actor,{
    roomFightTime:isPvpMode()&&authoritativePvp?.phase==='fight'?authoritativePvp.fightTime:null,
    roomElapsed:mode==='online'&&!paused?Math.max(0,(performance.now()-lastServerAt)/1000):0,
  });
  if(view.core){
    const core=actor.core||{}, enabled=actor.hidden!==true && core.phase && !['absent','inactive','hidden','disabled','dormant'].includes(core.phase);
    view.core.root.setEnabled(Boolean(enabled));
    if(enabled){
      view.core.root.position.set(core.x*SCALE,core.y*SCALE,-core.z*SCALE);
      const rotation=core.rotation;
      if(rotation)view.core.root.rotation.set(-rotation[0]*Math.PI/180,-rotation[1]*Math.PI/180,-rotation[2]*Math.PI/180);
      else view.core.root.rotation.set(0,view.root.rotation.y,0);
      view.core.root.scaling.setAll(SCALE*(core.helper?.scale??1));
      setAnimation(view.core, core.animationName, core.animationTime, core.phase==='idle');
      updateNasodCorePresentation(view.core,{camera,outlineColor:core.helper?.outlineColor});
    }
  }
}
function tick(manual=false,cutoff=Infinity,observationNow=performance.now()) {
  if(!active||mode==='lobby'||slotPreparation||guildPanel.isOpen()||paused&&!manual)return;
  // Practice diagnostics used to retain every input packet for the whole tab
  // lifetime. Rotate before stepping so the new initial snapshot and exported
  // input window still replay exactly. At 60Hz retain at most ten minutes.
  if(mode==='practice'&&replay.length>=36000)beginRecording('automatic-practice-window');
  // Preview sampling at 60Hz; profile evidence does not claim native tick frequency.
  const started=performance.now(),actors=actorsNow();
  const input=recoverAddSecondUp(inputBuffer.consume(manual?Infinity:cutoff),actors[0]);
  const inputActorBefore={id:actors[0].id,state:actors[0].state,stateSerial:actors[0].stateSerial};
  let inputReportFrame=null;
  const inputs={ [actors[0].id]:input };
  if(mode==='online'){
    const fighting=authoritativePvp?.phase==='fight';
    if(fighting&&!ownsLocalUnit()){
      const frameSeq=online.send(input);
      inputReportFrame=frameSeq;
      if(!Number.isSafeInteger(frameSeq)||frameSeq<=0){handleOnlineError(Object.assign(Error('Online input stopped. Reload or sign in again.'),{fatal:true}));return;}
      prediction.record(frameSeq,input);
    }else prediction.clear();
    for(const actor of actors.slice(1)){
      // Owner reports already carry the remote action and clock. Re-consuming
      // a delayed held key here could invent another attack after its release.
      inputs[actor.id]=ownsLocalUnit()?{held:[],pressed:[],released:[]}:remoteSample(actor.id);
    }
    if(authoritativePvp?.phase!=='fight')for(const id of Object.keys(inputs))inputs[id]={held:[],pressed:[],released:[]};
  }else if(secondPressed.length&&actors[1]) inputs[actors[1].id]={held:[],pressed:secondPressed.splice(0),released:[]};
  const phase=authoritativePvp?.phase;
  if(ownsLocalUnit()&&phase==='fight'){
    ownershipSync.beforeStep(simulation,localPlayerId,{now:observationNow});
    // Consumption may free admission space while a reliable peer is waiting.
    // Retry only blocked admissions; newly admitted starts run on the next step.
    online.notifyOwnerCapacity();
  }
  if(ownsLocalUnit()&&phase==='slow')ownershipSync.beforeTerminalStep(simulation,localPlayerId);
  if(usesCombatPlayback()&&phase==='fight')Object.assign(inputs,ownershipSync.remoteInputs(simulation,localPlayerId));
  if(mode==='practice2v2'){
    const value=pvpPractice.step(1/60,input);authoritativePvp=value.pvp;presentEvents(value.events);
    if(value.result){paused=true;resultStartedAt=performance.now();resultPresentation.present(value.result);}
  }else if(mode!=='online'||phase==='fight'||phase==='slow')simulation.step((mode==='online'&&phase==='slow'?(authoritativePvp.timeScale??.2):1)/60,inputs,{snapshot:false}); frame++;
  if(ownsLocalUnit()){
    const events=simulation.drainEvents();presentEvents(events);
    if(phase==='fight'||phase==='slow'){
      const consumedInput=inputs[localPlayerId]??{held:[],pressed:[],released:[]};
      const report=ownershipSync.afterStep(simulation,localPlayerId,events,consumedInput);
      if(report){inputReportFrame=online.send(consumedInput,report);ownershipSync.recordSentFrame(simulation,localPlayerId,inputReportFrame);}
    }
  }else drain();
  const displayStep=(isPvpMode()&&authoritativePvp?.phase==='slow'?(authoritativePvp.timeScale??.2):1)/60;
  if(mode==='practice')replay.push({dt:1/60,inputs});
  frameSupervisor.presentation('effect-clock',()=>effectsView.step(displayStep,simulation.view()));
  frameSupervisor.presentation('world-color-clock',()=>worldColorView.step(simulation.view(),displayStep));
  actorRenderClock.push(actorsNow());manaBreakRenderClock.push(actorsNow()[0]);damageNumbers.step(displayStep);
  if(manual){resetDisplayClock();for(const actor of shownActors)renderActor(actor);weaponTrails?.step({actors:shownActors,dt:1/60});updateCamera(1/60,shownActors[0]);}
  const completedAt=performance.now();
  for(const elapsed of inputStageTrace.record({input,sampledAt:started,completedAt,before:inputActorBefore,after:actorsNow()[0],step:frame,reportFrame:inputReportFrame}))
    measure(perf.inputMs,elapsed);
  measure(perf.stepMs,performance.now()-started);perf.steps++;
}

listenBattleWindow('keydown',event=>{
  if(isPvpMode()&&event.code==='Tab'&&!event.altKey){event.preventDefault();if(!event.repeat)pvpHud.toggle();return;}
  if(!active||mode==='lobby'||paused||slotPreparation||guildPanel.isOpen()||keyDialog?.isOpen||!keyTranslator.translate(event.code)||event.target.matches('input,textarea,select'))return;
  const command=keyTranslator.translate(event.code);
  if(isPvpMode()&&['Z','X'].includes(command)&&spectatorState().spectating){
    event.preventDefault();if(!event.repeat)spectatorCamera.cycle(command==='Z'?-1:1);canvas.focus();return;
  }
  event.preventDefault();const key=keyTranslator.down(event.code);if(!key)return;
  say('');inputBuffer.down(key,performance.now()/1000);canvas.focus();
});
listenBattleWindow('keyup',event=>{if(keyTranslator.translate(event.code))event.preventDefault();const key=keyTranslator.up(event.code);if(!key)return;inputBuffer.up(key,performance.now()/1000);});
listenBattleWindow('blur',()=>{keyTranslator.releaseAll();inputBuffer.releaseAll(performance.now()/1000);});
$('#pause').onclick=()=>{if(!active||slotPreparation||guildPanel.isOpen())return;paused=!paused;resetDisplayClock();$('#pause').textContent=paused?'Resume':'Pause';if(paused){stopSounds();inputBuffer.releaseAll(performance.now()/1000);}};
stepToggle.onclick=()=>{if(!active||slotPreparation||guildPanel.isOpen())return;stepWasPaused=paused;paused=true;resetDisplayClock();inputBuffer.releaseAll(performance.now()/1000);stepPanel.hidden=false;$('#pause').textContent='Resume';};
$('#step-close').onclick=()=>{if(slotPreparation)return;stepPanel.hidden=true;paused=stepWasPaused;resetDisplayClock();$('#pause').textContent=paused?'Resume':'Pause';canvas.focus();};
$('#step-run').onclick=()=>{if(mode!=='practice'||currentSession?.role!=='gm'||!active||!paused||slotPreparation)return;const count=Number($('#step-count').value);if(!Number.isInteger(count)||count<1||count>240)return;const command=$('#step-command').value;if(command){if($('#step-held').checked)inputBuffer.down(command,stateNow().time);else inputBuffer.tap(command,stateNow().time);}for(let i=0;i<count;i++)tick(true);for(const a of actorsNow())renderActor(a);updateHud(actorsNow());effectsView.render();meshCandidates.commitEnabledChanges();scene.render();};
$('#step-release').onclick=()=>{if(mode!=='practice'||currentSession?.role!=='gm'||slotPreparation)return;inputBuffer.releaseAll(stateNow().time);say('Input released. The next step will dispatch the key release.');};
$('#prepare-sword').onclick=()=>{
  if(mode!=='practice'||currentSession?.role!=='gm'||!(isElswordProfession(professionId)||isElesisProfession(professionId))||!active||!paused||slotPreparation)return;
  simulation.prepareWayOfSword(actorsNow()[0].id,Number($('#sword-test-state').value));
  drain();resetDisplayClock();beginRecording('explicit-sword-state-fixture');
  for(const actor of actorsNow())renderActor(actor);updateHud(actorsNow());
  say('Sword state set for testing. Use normal hits to verify charge gain.');
};
$('#reset').onclick=()=>{if(mode!=='practice'||!active||slotPreparation||configurationLocked)return;stopSounds();simulation.restore(baselineSnapshot);resetDisplayClock({resetPresentation:true});effectsView.clear();worldColorView.clear();hitLighting.reset();poseAudio.clear();damageNumbers.clear();weaponTrails?.clear();wayOfSwordParticles?.clear();cameraTracking=null;eventLog.length=0;inputBuffer.clear();secondPressed.length=0;drain();beginRecording('clean-reset');for(const a of actorsNow())renderActor(a);updateCamera(0,actorsNow()[0]);updateHud(actorsNow());say('Test state reset');};
$('#prepare-awakening').onclick=()=>{
  if(mode!=='practice'||!active||slotPreparation||configurationLocked)return;
  if(isAddProfession(professionId)){
    const snapshot=stateNow(),a=snapshot.actors[0];a.sourceAdd.dp=ADD_DP_MAX;a.sourceAdd.mutation=ADD_MUTATION_MAX;simulation.restore(snapshot);
  }
  else if(simulation.prepareAwakening)simulation.prepareAwakening(actorsNow()[0].id);
  else {const snapshot=stateNow();const a=Array.isArray(snapshot.actors)?snapshot.actors[0]:Object.values(snapshot.actors)[0];a.awakening.orbs=3;a.awakening.gauge=0;simulation.restore(snapshot);}
  resetDisplayClock();beginRecording('explicit-three-orb-fixture');
  say(isAddProfession(professionId)?'DP and mutation points are full. Press Ctrl to switch. These test resources are granted directly.':'Three awakening beads are ready. Press Ctrl to awaken. These test beads are granted directly.');updateHud(actorsNow());
};
deathPrepare.onclick=()=>{if(!active||slotPreparation)return;const snapshot=stateNow();if(!snapshot.actors[1])return;snapshot.actors[1].hp=1;simulation.restore(snapshot);resetDisplayClock();beginRecording('death-fixture');updateHud(actorsNow());say('Mirror target set to 1 HP. Attack normally to inspect its death animation.');};
$('#target-attack').onclick=()=>{if(mode!=='practice'||!active||slotPreparation||configurationLocked||!actorsNow()[1])return;secondPressed.push('Z');say('Mirror target used a basic attack');};
$('#restore-resources').onclick=()=>{if(mode!=='practice'||!active||slotPreparation||configurationLocked)return;
  restorePracticeResources(simulation);resetDisplayClock();beginRecording('practice-resources-restored');updateHud(actorsNow());say('Both actors have full MP and all skill cooldowns have reset');};
$('#audit-toggle').onclick=async()=>{
  if(!active)return;
  const panel=$('.audit');panel.hidden=!panel.hidden;
  if(!panel.hidden){let coverage;try{coverage=await data('/api/coverage');}catch{coverage={status:'In development'};}
    panel.textContent=JSON.stringify({coverage,versions:stateNow().versions,ui: {originalAtlas:true,layoutVerified:uiManifest.layoutVerified, eightKeys:true,dynamicCamera:false,skillCutIn:false,swordSkillCues:skillSwordCues?.proof()},
      combat:actorsNow().map(a=>({id:a.id,state:a.state,position:[a.x,a.y,a.z],hp:a.hp,grounded:a.grounded,
        invincible:a.invincible,superArmor:a.superArmor,superArmorNotRed:a.superArmorNotRed,stats:a.stats,
        lineId:a.lineId,velocity:[a.vx,a.vy,a.vz],animationName:a.animationName,animationTime:a.animationTime,
        motionMoveNow:a.motionMoveNow,knockdown:a.knockdown,deathPresentation:a.deathPresentation,hidden:a.hidden,deathComplete:a.deathComplete})),
      camera:{adapter:preset.cameraAdapter,tracking:cameraTracking,eyeGltf:camera.position.asArray()},
      professionResources:professionResourcesProof(),
      nativeExecution:{mode:'compiled-original-cpp',modules:nativeRuntime.manifest.modules,
        referenceCommit:nativeRuntime.manifest.referenceCommit,targetFullClientExecuted:false},
      presentation:collectPresentationProof(),effects:effectsView.proof({includeDraws:true}),mapUvScroll:mapUvScroll?.proof(),damageNumbers:damageNumbers.proof(),weaponTrails:weaponTrails.proof(),
      unresolvedMechanics:profile.referenceSemantics.mechanicBindings,recentEvents:eventLog.slice(-15)},null,2);}
};
$('#export').onclick=async()=>{
  if(!active)return;
  const payload={schemaVersion:1,versions:stateNow().versions,purpose:'current-simulation-trace-not-native-ground-truth',recordingReason,initial:initialSnapshot,inputs:replay,final:stateNow(),events:eventLog};
  try{
    const sessionResponse=await fetch('/api/session',{headers:sessionRequestHeaders()});
    if(!sessionResponse.ok)throw Error('login-required');
    if((await sessionResponse.json()).traceExport==='download'){
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`rf-${Date.now()}.json`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      say('Trace downloaded');return;
    }
    const response=await fetch('/api/traces',{method:'POST',headers:{'Content-Type':'application/json',...sessionRequestHeaders()},body:JSON.stringify(payload)});
    const saved=await response.json();if(!response.ok)throw Error(saved.error);say('Trace saved: '+saved.file);
  }catch(error){say('Failed to save trace: '+error.message);}
};
$('#logout').onclick=async()=>{active=false;resultPresentation.clear();professionSwitch.dispose();closeDiagnostics();guildPanel.dispose();interfaceAudio?.dispose();stopSounds();inputBuffer.clear();awakeningBeadView?.dispose();wayOfSwordParticles?.dispose();wayOfSwordHud?.dispose();addSummonView?.dispose();engine.stopRenderLoop();await fetch('/api/logout',{method:'POST',headers:sessionRequestHeaders()});location.reload();};

function cleanName(name){return cleanSkillText(name).replace(/\s+/g,' ');}
function collectPresentationProof(){
  return {settings:presentationSettings,canvas:{width:engine.getRenderWidth(),height:engine.getRenderHeight(),devicePixelRatio:window.devicePixelRatio},
    actors:(shownActors.length?shownActors:actorsNow()).map((actor,index)=>{const view=views.get(actor.id),shown=motionInspector.active&&index===0?motionInspector.actor(actor):actor;
      const sample=(motionInspector.sourceAudit||characterAudit)(view,shown),core=shown.core;
      return {id:actor.id,sample:view.sample,pose:sample,litMeshes:view.meshes.filter(m=>m.material?.unlit===false).length,
        outlinedMeshes:view.meshes.filter(m=>m.renderOutline&&m.getTotalVertices()).length,armor:view.armorPresentation,
        core:view.core?.root.isEnabled()&&coreAudit?{sample:view.core.sample,pose:coreAudit(view.core,{...core,facing:actor.facing,applyMotionOffset:false,animationLoop:core.phase==='idle'})}:null};})};
}
function supportedSkills(){return profile.skillCatalog || (Array.isArray(profile.skills)?profile.skills:Object.values(profile.skills||{}));}
function supportForProfession(professionId,id){
  const p=getProfessionProfile(professionId),settings=getProfessionPreset(professionId);
  const support=p.skillCatalog.find(s=>Number(s.id??s.skillId)===Number(id));
  return support&&settings.bannedSkillIds?.includes(Number(id))?
    {...support,supported:false,pvpDisabled:true,disabledReason:settings.bannedSkillReasons?.[id]??'Unavailable in PvP'}:support;
}
function supportFor(id){return supportForProfession(professionId,id);}
let pickerDefinitionCache;
function pickerDefinitions(){return pickerDefinitionCache??=skillCatalog.skills.map(s=>({...s,branches:supportFor(s.id)?.branches??s.branches,limitations:supportFor(s.id)?.limitations}));}
function rebuildSlots(){
  $('.skill-bar').replaceChildren(...preset.skillKeys.map((key,i)=>{
    const slot=loadout[i],base=skillCatalog.skills.find(s=>s.id===Number(slot?.skillId));
    const definition=base?{...base,branches:supportFor(base.id)?.branches??base.branches,limitations:supportFor(base.id)?.limitations}:null;
    const button=placeSkillSlot(createSkillSlot(document,{key,slot,definition}),key);
    button.dataset.sharedTooltip='true';
    const inspect=()=>{if(definition)pickerTooltip.skill(definition,button,slot?.branchId);};
    button.onmouseenter=button.onfocus=inspect;button.onmouseleave=button.onblur=pickerTooltip.hide;
    const label=button.querySelector('.slot-key,.skill-key,.key');if(label)label.textContent=coreKeyLabel(key,keyBindings);
    button.setAttribute('aria-keyshortcuts',coreKeyLabel(key,keyBindings));return button;
  }));
  skillButtons=[...document.querySelectorAll('.skill-slot')];
  bindBattleSkillSlots(document,{elements:skillButtons,loadout,
    editable:()=>active&&!slotPreparation&&!configurationLocked&&!professionSwitch.busy&&(mode==='practice'||mode==='lobby'),onEdit:pickerEdit});
}
let pickerRenderedSkillId;
function rebuildPicker(){
  pickerTooltip.hide();
  if(selectedSkillId===null)selectedSkillId=Number(loadout[selectedSlot]?.skillId)||null;
  $('.skill-catalog').replaceChildren(...createSkillTree(document,{definitions:skillCatalog.skills,supportFor,
    grantedLabel:isElswordProfession(professionId)?'Granted by default':'Active by default',
    loadout,applied:actorsNow()[0].passives??preset.passives??[],selectedSkillId,
    branchChoices,onChooseBranch:selectBranch,
    onEquip:quickEquipSkill,
    onHideDetails:pickerTooltip.hide,onInspectBranch:pickerTooltip.trait,
    onInspect:(id,anchor)=>{
      const definition={...pickerDefinitions().find(s=>s.id===id),disabledReason:supportFor(id)?.disabledReason};
      pickerTooltip.skill(definition,anchor,branchChoices[id]??'none');
    }}));
  pickerRenderedSkillId=selectedSkillId;
}
let slotPreparation=false;
async function selectBranch(skillId,branchId){
  if(slotPreparation||configurationLocked||isPvpMode())return;
  const ownerEpoch=professionEpoch;
  try{
    const definition=pickerDefinitions().find(s=>s.id===skillId);
    const previous=branchChoices;branchChoices=choosePickerBranch(branchChoices,definition,branchId);selectedSkillId=skillId;
    const equipped=loadout.some(s=>s?.skillId===skillId);
    const applied=await applyLoadout(applyPickerBranches(loadout,branchChoices,pickerDefinitions()));
    if(ownerEpoch!==professionEpoch)return;
    if(!applied){branchChoices=previous;rebuildPicker();return;}
    if(!equipped)$('.picker-message').textContent='Trait saved. It will apply when the skill is equipped.';
  }catch(error){if(ownerEpoch===professionEpoch)$('.picker-message').textContent=error.message;}
}
async function pickerEdit(operation){
  if(slotPreparation||configurationLocked||isPvpMode())return;
  const ownerEpoch=professionEpoch;
  const previousSlot=selectedSlot,previousSkill=selectedSkillId;
  const hadSkill=Boolean(loadout[operation.target]?.skillId);
  try{
    const next=editPickerLoadout(loadout,operation.type==='equip'?{...operation,branchId:branchChoices[operation.skillId]??'none'}:operation,skillCatalog.skills,supportFor);
    selectedSlot=operation.target;selectedSkillId=Number(next[selectedSlot]?.skillId)||null;
    const applied=await applyLoadout(next);if(ownerEpoch!==professionEpoch)return applied;
    if(applied){if(operation.type!=='remove'||hadSkill)interfaceAudio?.play(operation.type==='remove'?'skillUnequip':'skillEquip');return true;}
    selectedSlot=previousSlot;selectedSkillId=previousSkill;rebuildPicker();return false;
  }catch(error){if(ownerEpoch===professionEpoch){selectedSlot=previousSlot;selectedSkillId=previousSkill;rebuildPicker();$('.picker-message').textContent=error.message;}return false;}
}
async function quickEquipSkill(skillId){
  try{return await pickerEdit({type:'equip',skillId,target:quickEquipTarget(loadout,skillId)});}
  catch(error){$('.picker-message').textContent=error.message;return false;}
}
async function applyLoadout(next){
  if(slotPreparation||configurationLocked)return;
  const previous=structuredClone(actorsNow()[0].loadout);
  try {
    if(!simulation.configureLoadout)throw Error('Combat configuration is unavailable');
    const result=simulation.configureLoadout(next,actorsNow()[0].id);
    if(result===false||result?.ok===false)throw Error(result.reason||'The combat engine rejected this configuration');
    slotPreparation=true;$('.skill-picker').inert=true;
    // Lobby configuration uses the already loaded source libraries. Reserve
    // combat bursts at the existing match/first-practice readiness boundary.
    if(mode!=='lobby')await effectsView.prewarm(result);
    const saved=await skillPreferences.save({loadout:result,branchChoices});
    branchChoices=saved.branchChoices;
    loadout=result;const preferences=professionPreferences.get(professionId);if(preferences)Object.assign(preferences,{loadout:structuredClone(loadout),branchChoices:structuredClone(branchChoices)});
    baselineSnapshot.actors[0].loadout=structuredClone(loadout);if(practiceSnapshot)practiceSnapshot.actors[0].loadout=structuredClone(loadout);beginRecording('loadout-change');$('.picker-message').textContent='Configuration saved · '+preset.skillKeys[selectedSlot]+' · Max level';rebuildSlots();rebuildPicker();return true;
  }catch(error){simulation.configureLoadout(previous,actorsNow()[0].id);rebuildSlots();rebuildPicker();$('.picker-message').textContent=error.message;return false;}
  finally{slotPreparation=false;$('.skill-picker').inert=false;pickerDialog.preparationSettled();professionSwitch.flush();}
}
$('#skills').onclick=()=>{if(!active||slotPreparation||configurationLocked||professionSwitch.busy||guildPanel.isOpen()||!$('.skill-picker').hidden)return;pickerWasPaused=paused;paused=true;resetDisplayClock();stopSounds();inputBuffer.releaseAll(performance.now()/1000);selectedSkillId=Number(loadout[selectedSlot]?.skillId)||null;$('.skill-picker').hidden=false;if(pickerRenderedSkillId!==selectedSkillId)rebuildPicker();};
$('#skills').setAttribute('aria-keyshortcuts','K');$('#skills').title='Skill setup (K)';

const diagnosticIds=['guild-skills','reset','restore-resources','prepare-awakening','prepare-death','target-attack','pause','export','audit-toggle','frame-inspect'];
const practiceControlIds=new Set(['reset','restore-resources','prepare-awakening','target-attack']);
function closeDiagnostics(){guildPanel.close();if(motionInspector?.active)$('#motion-close')?.click();stepPanel.hidden=true;$('.audit').hidden=true;inputBuffer.clear();keyTranslator.releaseAll();}
function updateModeControls(){
  if(returnFlight||battleRetired)configurationLocked=true;
  const practice=mode==='practice',gm=currentSession?.role==='gm';
  $('.workbench').classList.toggle('entry-loading',mode==='loading'||!matchEntry.root.hidden);
  swordPrepare.hidden=!(practice&&gm&&(isElswordProfession(professionId)||isElesisProfession(professionId)));
  $('#sword-test-state').querySelector('[value="2"]').textContent=isElesisProfession(professionId)?'Gale':'Vitality';
  $('#sword-test-state').querySelector('[value="-2"]').textContent=isElesisProfession(professionId)?'Annihilation':'Destruction';
  for(const id of diagnosticIds){const button=$('#'+id);if(button){const allowed=practice&&(gm||practiceControlIds.has(id));button.hidden=!allowed;button.disabled=!allowed||slotPreparation;}}
  $('#guild-skills').hidden=!(practice&&gm)||configurationLocked;$('#guild-skills').disabled=!(practice&&gm)||configurationLocked;
  if(!(mode==='lobby'||practice&&gm)||configurationLocked)guildPanel.close();
  interfaceAudio?.setLobby(mode==='lobby'&&!preparingMatch);
  $('#skills').disabled=configurationLocked||slotPreparation||professionSwitch.busy;
  $('#skills').hidden=isPvpMode();
  if($('#keys')){$('#keys').disabled=configurationLocked||slotPreparation||professionSwitch.busy;$('#keys').hidden=isPvpMode();}
  if($('#lobby')){$('#lobby').disabled=mode==='online'||(configurationLocked&&mode!=='practice2v2');$('#lobby').hidden=mode==='online';}
  const motionButton=document.querySelector('#motion-inspect,.motion-inspect-toggle');if(motionButton)motionButton.hidden=!(practice&&gm);
  perfOutput.hidden=!(practice&&gm);$('.status').hidden=!(practice&&gm);
  motionInspector?.element?.toggleAttribute('hidden',!practice||!gm);
  const matchMode=onlineMatch?.mode??authoritativePvp?.mode??'2v2';
  $('.version-note').textContent=mode==='online'?matchMode+' · Configuration locked':mode==='practice2v2'?'1 player + 3 practice opponents':mode==='practice'?'Practice':'Skills and controls';
  $('.workbench-mode').textContent=profession.name+' / '+(mode==='online'?matchMode+' online match':mode==='practice2v2'?'2v2 practice':mode==='practice'?'Practice':'Match Lobby');
  $('.help-strip').textContent=coreKeyLabel('LEFT',keyBindings)+' / '+coreKeyLabel('RIGHT',keyBindings)+' move (double-tap to dash) · '+coreKeyLabel('UP',keyBindings)+' jump · '+coreKeyLabel('DOWN',keyBindings)+' drop · '+coreKeyLabel('Z',keyBindings)+' / '+coreKeyLabel('X',keyBindings)+' attack · '+coreKeyLabel('AWAKEN',keyBindings)+' awaken · '+preset.skillKeys.map(key=>coreKeyLabel(key,keyBindings)).join(' ')+' skills';
  keyDialog?.setLocked(configurationLocked||slotPreparation||professionSwitch.busy);
  lobby?.setLocked(configurationLocked||slotPreparation);
  $('.help-strip').hidden=isPvpMode();
}
function dismissResultAndReturn(){
  if(presentedResultReceipt)resultReceipts.dismiss(presentedResultReceipt);
  returnToLobby();
}
function returnToLobby(){
  if(lobbyHandoff){void returnToLightLobby();return;}
  presentedResultReceipt=null;
  resultPresentation.clear();
  spectatorCamera.reset();cameraHandoff.reset();spectatorHint.hidden=true;cameraTargetId=null;cameraHeld=false;cameraTracking=null;
  matchEntry.clear();preparingMatch=null;pendingLoadingState=null;
  mapLoading=false;
  worldColorView.clear();
  mapGeneration++;
  practiceGeneration++;pvpPractice?.stop();pvpPractice=null;
  ownershipSync.clear();ownedPresentation.clear();ownershipMode=null;
  closeDiagnostics();prediction.clear();online?.clearMatch();onlineMatch=null;localPlayerId=null;remotePackets.clear();remoteDevices.clear();remoteHeld.clear();lastServerSequence=-1;authoritativePvp=null;
  configurationLocked=false;mode='lobby';paused=true;inputBuffer.clear();keyTranslator.releaseAll();nameplates?.clear();weaponTrails.clear();
  effectsView.clear();effectsView.releaseInactiveBurstPools?.();damageNumbers.clear();
  const practiceIds=new Set(practiceSnapshot.actors.map(actor=>actor.id));
  for(const [id,view]of views){if(practiceIds.has(id))view.root.setEnabled(false);else{views.delete(id);view.dispose();}}
  simulation=practiceSimulation;simulation.restore(practiceSnapshot);baselineSnapshot=structuredClone(practiceSnapshot);
  weaponTrails.setLocalActor(simulation.state.actors[0].id);
  loadout=simulation.actor(simulation.state.actors[0].id).loadout;pvpHud?.clear();
  professionSwitch.flush();
  selectedPracticeMap=currentMapVersions.sceneId;lobby?.setPracticeMap(selectedPracticeMap);
  updateModeControls();lobby?.status({queued:false,available:true});lobby?.show(true);rebuildSlots();updateHud(actorsNow());resetDisplayClock({resetPresentation:true});say('');
  if(onlineTransportError){
    lobby?.error(onlineTransportError.message);say(onlineTransportError.message);
    for(const action of ['queue1v1','queue','queue3v3']){const button=lobby?.root?.querySelector('[data-action="'+action+'"]');if(button)button.disabled=true;}
  }else online?.api('/api/history').then(h=>{if(!onlineTransportError)lobby.history(h);}).catch(e=>{if(!onlineTransportError)lobby.error(e.message);});
}
// A lobby return owns no battle renderer. Capture the current map after all
// actors, shadows and effects are removed, then retire the entire battle scope.
let returnFlight=null,battleRetired=false;
async function returnToLightLobby(){
  if(returnFlight)return returnFlight;
  const wasPaused=paused,wasLocked=configurationLocked;active=false;paused=true;configurationLocked=true;mode='lobby';
  $('.workbench').classList.remove('entry-loading');
  closeDiagnostics();$('.skill-picker').hidden=true;pickerTooltip.hide();
  matchEntry.clear();pvpHud?.clear?.();lobby.setLocked(true);lobby.show(true);
  updateModeControls();lobby.setLocked(true);
  returnFlight=(async()=>{
    // Present the already prepared lobby before transport retirement and
    // resource disposal. Its controls remain locked until the new shell owns
    // the acknowledged page identity; no second session is opened early.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const token=document.querySelector('#app').dataset.pageInitToken;
    const ack=await online.api('/api/online/handoff','POST',{pageInitToken:token});
    if(ack?.ok!==true||typeof ack.pageInitToken!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(ack.pageInitToken))
      throw TypeError('Invalid lobby handoff acknowledgement');
    document.querySelector('#app').dataset.pageInitToken=ack.pageInitToken;
    window.dispatchEvent(new Event('webpvp-page-identity'));
    online.close();online.clearMatch();mapGeneration++;practiceGeneration++;pvpPractice?.stop();
    engine.stopRenderLoop();resizeObserver.disconnect();battleLifetime.abort();
    professionSwitch.dispose();pickerDialog.destroy();keyDialog?.destroy();guildPanel.dispose();
    inputBuffer.clear();keyTranslator.releaseAll();resultPresentation.clear();matchEntry.clear();
    battleAudio.dispose();interfaceAudio?.dispose();audioGesture.dispose();resourceTimings.dispose();
    effectsView.clear();weaponTrails.clear();damageNumbers.clear();hitLighting.clear();
    buffAfterimages.clear();groundShadows.clear();addSummonView?.clear();worldColorView.clear();
    const actorViews=new Set([...views.values(),...[...professionPracticeViews.values()].flatMap(group=>[...group.values()])]);
    for(const view of actorViews){view.root.setEnabled(false);view.core?.root.setEnabled(false);}
    // toDataURL runs in the same turn as render; no preserved drawing buffer,
    // extra WebGL context, model or map container survives in the lobby.
    meshCandidates.commitEnabledChanges();scene.render();const background={sceneId:currentMapVersions.sceneId,url:canvas.toDataURL('image/png')};
    for(const view of actorViews){view.costume?.dispose();view.core?.dispose();view.dispose();}
    views.clear();professionPracticeViews.clear();professionAssets.clear();professionPreferences.clear();
    for(const disposable of [buffBar,pvpHud,addHud,wayOfSwordHud,awakeningBeadView,skillSwordCues,
      wayOfSwordParticles,weaponTrails,groundShadows,buffAfterimages,addSummonView,nameplates,worldColorView]){
      if(disposable?.dispose)disposable.dispose();else disposable?.destroy?.();
    }
    mapUvScroll?.dispose();professionAssetCache.dispose();engine.dispose();battleRetired=true;
    const retirement={sceneDisposed:scene.isDisposed,engineScenes:engine.scenes.length,actorViews:views.size,
      listenersAborted:battleLifetime.signal.aborted,assetCache:professionAssetCache.proof()};
    simulation=null;practiceSimulation=null;nativeRuntime=null;geometryModule=null;
    delete window.rfWorkbench;delete window.webpvpLobbyHandoff;
    const {startLobbyShell}=await import('./lobby-shell.mjs');
    await startLobbyShell({mapBackground:background,battleRetirement:retirement});
    lobby.dispose();
    return true;
  })().catch(error=>{
    console.error('Return to lobby failed',error);
    returnFlight=null;
    if(!battleRetired){active=true;paused=wasPaused;configurationLocked=wasLocked;mode=launchIntent?.kind==='practice2v2'?'practice2v2':'practice';updateModeControls();}
    const panel=document.createElement('section');panel.className='lobby-entry-error';panel.setAttribute('role','alert');
    panel.textContent='Failed to return to lobby: '+error.message;document.querySelector('#app').append(panel);
    returnFlight=null;return false;
  });return returnFlight;
}
function handleOnlineError(error){
  if(returnFlight||battleRetired)return;
  if(error.code==='session-replaced'){active=false;online?.close();stopSounds();engine.stopRenderLoop();location.replace('/?session=replaced');return;}
  if(error.message==='connection-retrying')return;
  const invalidPoll=error.message?.startsWith('invalid-online-poll-');
  const rejectedTransport=error.status===409&&['stream-already-open','poll-cursor-rejected'].includes(error.code);
  if(!error.fatal&&error.status!==401&&!rejectedTransport&&!invalidPoll){lobby?.error(error.message);return;}
  const reason=error.status===401?'Session expired. Please sign in again.':error.status===409?'Connection rejected. Close duplicate pages and reload or sign in again.':invalidPoll?'Match data validation failed. Reload or sign in again.':error.message;
  const next=error.status===401?'Returning to the sign-in screen. You can also log out and sign in again.':'You can practice from the lobby or sign in again.';
  onlineTransportError=Object.assign(Error('Online play stopped: '+reason+'.'+next),{fatal:true,status:error.status,code:error.code});
  online?.close();stopSounds();returnToLobby();
}
async function loadBattleMap(sceneId,versions={}){
  const generation=++mapGeneration;
  const declaration=await loadMapDeclarations(sceneId,versions);
  if(generation!==mapGeneration)return false;
  if(mapEnvironment&&currentMapVersions.sceneId===sceneId&&currentMapVersions.mapCollisionSha256===declaration.map.collision.sha256&&
    currentMapVersions.mapGeometrySha256===declaration.map.geometry.sha256&&JSON.stringify(mapManifest)===JSON.stringify(declaration.map))return true;
  const environment=await SceneLoader.LoadAssetContainerAsync(declaration.root,'scene.glb',scene);
  const root=new TransformNode('original-map-'+sceneId,scene);root.scaling.setAll(SCALE);
  try{
    for(const node of environment.rootNodes)node.parent=root;
    const geometry=geometryModule?await createNativeGeometry({module:geometryModule,map:declaration.map}):null;
    if(generation!==mapGeneration){environment.dispose();root.dispose();return false;}
    worldColorView.setEnvironment(null);mapUvScroll?.dispose();mapEnvironment?.dispose();mapSceneRoot?.dispose();mapEnvironment=environment;mapSceneRoot=root;
    mapManifest=declaration.map;environment.addAllToScene();
    setCharacterWorldLight(scene,mapManifest);
    setNativeMapTransparentLayers(environment.meshes,mapManifest);
    mapUvScroll=createMapUvScroll(environment.meshes,mapManifest);effectsView?.setMap(mapManifest);
    currentMapVersions={sceneId,mapCollisionSha256:mapManifest.collision.sha256,mapGeometrySha256:mapManifest.geometry.sha256};
    worldColorView.setEnvironment(environment);
    if(geometry)nativeRuntime={...nativeRuntime,geometry};
    const projection=mapProjection(mapManifest,preset.cameraAdapter.verticalFovRadians);
    camera.minZ=projection.minZ;camera.maxZ=projection.maxZ;camera.fov=projection.fov;cameraTracking=null;resize();
    if(projection.inferred)recordEvent({type:'map-projection-preview-policy',sceneId,evidence:'explicit viewer projection; native omitted default unmeasured'});
    return true;
  }catch(error){environment.dispose();root.dispose();throw error;}
}
function createPracticeSimulation(id,savedLoadout,{includeTarget=false}={}){
  const p=getProfessionProfile(id),settings=getProfessionPreset(id),assets=professionAssets.get(id);
  // Both the local fixture and its optional mirror use this one profession.
  // Avoid cloning and installing eleven unrelated profiles for each new fixture.
  const next=createSimulation({profile:p,profiles:{[id]:p},presets:{[id]:settings},commonBuffs,map:mapManifest,preset:settings,actors:practiceActors(mapManifest,{includeTarget}).map(actor=>({...actor,professionId:id})),seed:2016,...simulationSamplers,
    nativeGeometry:nativeRuntime.geometry,nativeCommands:nativeRuntime.commands,nativeSkills:nativeRuntime.skills,
    nativeSkillValues:nativeRuntime.skillValues,nativeNasod:nativeRuntime.nasod,nativeCritical:nativeRuntime.critical,nativeManaBreak:nativeRuntime.manaBreak,
    versions:{...nativeRuntime.versions,referenceVersion:assets.manifest.referenceVersion,presetVersion:settings.presetVersion,
      ...currentMapVersions,programVersion:'rf-render-camera-v2',fixtureVersion:'native-adjacent-spawns-opposed-facing-v1'}});
  if(savedLoadout)next.configureLoadout(savedLoadout,next.state.actors[0].id);
  if(next.state.actors.length>1)preparePracticeTarget(next);
  return next;
}
async function loadAllProfessionPreferences(session){
  await Promise.all([...professionAssets].map(async([id,assets])=>{
    const client=createSkillPreferencesClient({fetch:(url,options={})=>fetch(url,{...options,headers:{...options.headers,...sessionRequestHeaders()}}),storage:pickerStorage});
    const defaults=createPracticeSimulation(id).state.actors[0].loadout;
    const supportFor=idValue=>supportForProfession(id,idValue);
    const definitions=assets.catalog.skills.map(s=>({...s,branches:supportFor(s.id)?.branches??s.branches}));
    const preferences=await client.load({username:session.username,professionId:id,persistDefaults:false,
      defaults:{loadout:defaults,branchChoices:{}},definitions,supportFor});
    professionPreferences.set(id,{client,loadout:preferences.loadout,branchChoices:preferences.branchChoices});
  }));
}
async function prepareProfessionPracticeViews(){
  for(const [id,assets]of professionAssets){
    const group=new Map();professionPracticeViews.set(id,group);
    for(const actor of practiceActors(mapManifest)){
      const view=await scheduleRenderPreparation(()=>createView(assets.bodyContainer,'practice-'+id+'-'+actor.id,assets.characterPose));styleCharacter(view);
      if(actor.id===practiceActors(mapManifest)[0].id)publishCostume(view,await prepareActorCostume(view,id,selectedCostume(costumePreferences,id)));
      if(assets.coreContainer)view.core=styleNasodCore(await scheduleRenderPreparation(()=>createView(assets.coreContainer,'practice-'+id+'-'+actor.id+'-core',assets.corePose)));
      group.set(actor.id,view);view.root.setEnabled(false);view.core?.root.setEnabled(false);
    }
  }
  await Promise.all([...professionPracticeViews.values()].flatMap(group=>[...group.values()]).flatMap(view=>
    [...view.meshes,...(view.core?.meshes??[])].filter(mesh=>mesh.material&&mesh.getTotalVertices()>0)
      .map(mesh=>scheduleRenderPreparation(()=>mesh.material.forceCompilationAsync(mesh)))));
}
async function preparePracticeTargetView(){
  const assets=professionAssets.get(professionId),group=professionPracticeViews.get(professionId);
  const target=practiceActors(mapManifest,{includeTarget:true})[1];
  if(!target||!assets||!group)throw Error('Mirror target assets are unavailable');
  let view=group.get(target.id);
  if(!view){
    view=await scheduleRenderPreparation(()=>createView(assets.bodyContainer,'practice-'+professionId+'-'+target.id,assets.characterPose));
    try{
      styleCharacter(view);view.root.setEnabled(false);
      if(assets.coreContainer)view.core=styleNasodCore(await scheduleRenderPreparation(()=>createView(assets.coreContainer,'practice-'+professionId+'-'+target.id+'-core',assets.corePose)));
      view.core?.root.setEnabled(false);
      await Promise.all([...view.meshes,...(view.core?.meshes??[])].filter(mesh=>mesh.material&&mesh.getTotalVertices()>0)
        .map(mesh=>scheduleRenderPreparation(()=>mesh.material.forceCompilationAsync(mesh))));
      group.set(target.id,view);
    }catch(error){view.dispose();throw error;}
  }
  views.set(target.id,view);
}
async function prepareActorCostume(view,id,costumeId){
  costumeAssets??=createCostumeAssetCache(professionAssetCache);
  return prepareCostumeView(view,await costumeAssets.load(id,costumeId),id,scene,child=>{
    styleCharacter(child);setNativeTransparentLayer(child.meshes,NATIVE_UNIT_LAYER);
  });
}
async function selectCostume(costumeId){
  if(mode!=='lobby'||configurationLocked||slotPreparation||professionSwitch.busy)throw Error('Costumes cannot be changed right now');
  const pending=[];slotPreparation=true;updateModeControls();
  try{
    for(const [id,group]of professionPracticeViews){
      if(costumeCharacter(id)!==costumeCharacter(professionId))continue;
      const view=group.get(practiceActors(mapManifest)[0].id);
      pending.push([view,await prepareActorCostume(view,id,costumeId)]);
    }
    const value=await online.api('/api/preferences/costume','POST',{professionId,costumeId});
    costumePreferences=normalizeCostumePreferences(value.costumes);
    for(const [view,appearance]of pending)publishCostume(view,appearance);pending.length=0;
    await hitLighting.prewarm(simulation.state.actors);
    return value;
  }finally{for(const [,appearance]of pending)appearance?.dispose();slotPreparation=false;updateModeControls();professionSwitch.flush();}
}
function rebuildPracticeSimulation({includeTarget=mode==='practice'}={}){
  const savedLoadout=practiceSnapshot?.actors[0]?.loadout??loadout;
  simulation=createPracticeSimulation(professionId,savedLoadout,{includeTarget});
  loadout=simulation.actor(simulation.state.actors[0].id).loadout;
  practiceSimulation=simulation;baselineSnapshot=simulation.snapshot();practiceSnapshot=structuredClone(baselineSnapshot);
  localPlayerId=null;for(const [id,view]of views)view.root.setEnabled(practiceSnapshot.actors.some(actor=>actor.id===id));
  effectsView.clear();damageNumbers.clear();weaponTrails.clear();weaponTrails.setLocalActor(simulation.state.actors[0].id);
  rebuildSlots();beginRecording('practice-map-change');resetDisplayClock({resetPresentation:true});updateCamera(0,actorsNow()[0]);updateHud(actorsNow());
}
function professionResourcesProof(){
  return {bootId:professionResourceSessionId,engineId:professionResourceSessionId+':engine',sceneId:professionResourceSessionId+':scene',
    prewarmReady:professionPrewarmReady,lastSwitchMilliseconds:lastProfessionSwitchMs,...professionSwitch.proof(),
    cache:professionAssetCache?.proof(),professions:Object.fromEntries([...professionAssets].map(([id,assets])=>[id,{
      catalogSkills:assets.catalog.skills.length,effectTemplates:Object.keys(assets.fxIndex.templates).length,
      bodyMeshes:assets.bodyContainer.meshes.length,practiceViews:professionPracticeViews.get(id)?.size??0,
      preferencesReady:professionPreferences.has(id),prewarmed:professionPrewarmReady}]))};
}
function updateProfessionPresentation(){
  nativeHud.dataset.professionId=professionId;
  $('.workbench-header strong').textContent='web pvp · '+profession.id;
  canvas.setAttribute('aria-label',profession.id+' battle scene');
  $('.skill-picker').setAttribute('aria-label',profession.id+' skill setup');
  $('.skill-picker header strong').textContent='Skills · '+profession.label;
  $('.hud-face').src=assetUrl(professionId==='RF'?'/assets/ui/r_fist_state.png':PROFESSIONS[professionId].assetBase+'ui/portrait-state.png');
  $('.opponent-face').src=assetUrl(profession.portraitUrl);$('.opponent-face').alt=profession.name;
  const thirdBackground=nativeHud.querySelectorAll('.wake-bead-bg')[2];
  thirdBackground.src=assetUrl('/assets/ui/'+(isRavenProfession(professionId)?'raven_3_bg':'rage_bg')+'.png');
  beads[2].src=assetUrl('/assets/ui/'+(isRavenProfession(professionId)?'raven_3':'rage_bead')+'.png');
  const thirdPosition=isRavenProfession(professionId)?statusHudLayout.ravenThirdBackground:statusHudLayout.awakeningBackgrounds[2];
  const beadPosition=isRavenProfession(professionId)?statusHudLayout.ravenThirdBead:statusHudLayout.awakeningBeads[2];
  thirdBackground.style.left=thirdPosition[0]+'px';thirdBackground.style.top=thirdPosition[1]+'px';
  beads[2].style.left=beadPosition[0]+'px';beads[2].style.top=beadPosition[1]+'px';
  $('.picker-message').textContent='';$('#sword-test-state').value='0';
}
function publishProfession(id){
  const started=performance.now(),assets=professionAssets.get(id),preferences=professionPreferences.get(id),cachedViews=professionPracticeViews.get(id);
  if(!professionPrewarmReady||!assets||!preferences||!cachedViews?.size)throw Error('Class assets are unavailable');
  // Construct and validate before publishing. All resources, view clones and
  // preferences already belong to this page; no await or fetch in publication.
  const next=createPracticeSimulation(id,preferences.loadout);
  closeDiagnostics();stopSounds();inputBuffer.clear();keyTranslator.releaseAll();secondPressed.length=0;
  effectsView.clear();worldColorView.clear();hitLighting.reset();poseAudio.clear();damageNumbers.clear();weaponTrails.clear();wayOfSwordParticles?.clear();nameplates?.clear();
  const cached=new Set([...professionPracticeViews.values()].flatMap(group=>[...group.values()]));
  for(const view of views.values()){view.root.setEnabled(false);view.core?.root.setEnabled(false);if(!cached.has(view))view.dispose();}
  views.clear();for(const [actorId,view]of cachedViews){views.set(actorId,view);view.root.setEnabled(true);view.core?.root.setEnabled(false);}
  professionEpoch++;professionId=id;profession=PROFESSIONS[id];profile=getProfessionProfile(id);preset=getProfessionPreset(id);
  rfManifest=assets.manifest;skillCatalog=assets.catalog;skillPreferences=preferences.client;
  loadout=structuredClone(next.state.actors[0].loadout);branchChoices=structuredClone(preferences.branchChoices);
  pickerDefinitionCache=undefined;pickerRenderedSkillId=undefined;selectedSlot=0;selectedSkillId=null;
  pickerTooltip.hide();cancelPickerDrag(document);$('.skill-catalog').replaceChildren();
  currentSession.professionId=id;simulation=practiceSimulation=next;baselineSnapshot=next.snapshot();practiceSnapshot=structuredClone(baselineSnapshot);
  localPlayerId=null;remotePackets.clear();remoteDevices.clear();remoteHeld.clear();prediction.clear();ownershipSync.clear();ownedPresentation.clear();
  characterAudit=createPoseAudit(assets.characterPose,{map:()=>simulation.map});coreAudit=assets.corePose?createPoseAudit(assets.corePose,{useDisplayedRoot:true}):null;
  motionInspector.setView(views.get(next.state.actors[0].id),{sourceAudit:characterAudit});
  effectsView.setLocalProfession(id);weaponTrails.setLocalActor(next.state.actors[0].id);
  const projection=mapProjection(mapManifest,preset.cameraAdapter.verticalFovRadians);
  camera.minZ=projection.minZ;camera.maxZ=projection.maxZ;camera.fov=projection.fov;cameraTracking=null;
  updateProfessionPresentation();rebuildSlots();beginRecording('profession-change');resetDisplayClock({resetPresentation:true});
  for(const actor of actorsNow())renderActor(actor);updateCamera(0,actorsNow()[0]);updateHud(actorsNow());drain();updateModeControls();
  lastProfessionSwitchMs=performance.now()-started;
}
const professionSwitch=createProfessionSwitch({current:()=>professionId,
  canCommit:()=>active&&mode==='lobby'&&!configurationLocked&&!slotPreparation&&!keyDialog?.isOpen&&$('.skill-picker').hidden&&!guildPanel.isOpen(),
  prepare:id=>effectsView.prepareProfession(id,practiceActors(mapManifest).map(actor=>({...actor,professionId:id,loadout:professionPreferences.get(id).loadout})),{prepareCombat:false}),
  commit:publishProfession,onBusy:()=>updateModeControls(),onError:error=>lobby?.error('Failed to prepare class effects: '+error.message)});
function observeProfession(id){
  if(!id)return;
  try{professionSwitch.observe(id);}catch(error){lobby?.error('Failed to switch class: '+error.message);recordEvent({type:'profession-switch-error',message:error.message});}
}
async function queueWithConfirmedConfiguration(matchMode){
  if(!active||mode!=='lobby')throw Error('Return to the match lobby and try again');
  if(onlineTransportError)throw onlineTransportError;
  if(slotPreparation||configurationLocked)throw Error('Skill setup is saving or locked');
  const ownerEpoch=professionEpoch;
  slotPreparation=true;updateModeControls();
  try{
    // Initial readonly preparation can restore RF browser traits before their
    // first server write. Confirm the exact current configuration before the
    // queue freezes it, including when the player never opened the picker.
    const saved=await skillPreferences.save({loadout,branchChoices});
    branchChoices=saved.branchChoices;
    const preferences=professionPreferences.get(professionId);
    if(preferences)Object.assign(preferences,{loadout:structuredClone(loadout),branchChoices:structuredClone(branchChoices)});
  }finally{
    slotPreparation=false;updateModeControls();professionSwitch.flush();
  }
  if(ownerEpoch!==professionEpoch||professionSwitch.busy||professionSwitch.proof().pending!==null)throw Error('Available classes have changed. Check your class and queue again.');
  if(!active||mode!=='lobby')throw Error('Page state changed. Return to the match lobby and try again.');
  if(configurationLocked)throw Error('Matchmaking state changed. Check the lobby and try again.');
  if(onlineTransportError)throw onlineTransportError;
  return online.join(matchMode);
}
async function startFreePractice(sceneId=DEFAULT_SCENE_ID){
  if(!active||returnFlight||configurationLocked||slotPreparation||professionSwitch.busy)return;
  const generation=++practiceGeneration;mapLoading=true;configurationLocked=true;paused=true;mode='loading';lobby.show(false);
  const inherited=bootLoading&&matchEntry.waiting(bootLoading);
  const loading=inherited?bootLoading:{id:'practice-loading-'+generation,players:[{id:currentSession.username,nickname:currentSession.nickname??currentSession.username,professionId,team:1,loadingProgress:0}]};
  if(!inherited)matchEntry.begin(loading,{playerId:currentSession.username});
  const base=inherited?88:0;
  const progress=(fraction,text)=>{matchEntry.progress(loading,currentSession.username,base+(100-base)*fraction);matchEntry.stage(loading,text);};
  progress(0,'Preparing free practice…');updateModeControls();
  try{
    if(!await loadBattleMap(sceneId)||generation!==practiceGeneration)return;
    progress(.1,'Preparing practice target…');
    await preparePracticeTargetView();if(generation!==practiceGeneration)return;
    progress(.25,'Preparing skill effects…');
    selectedPracticeMap=sceneId;rebuildPracticeSimulation({includeTarget:true});
    await effectsView.prewarmActors(simulation.state.actors);
    if(generation!==practiceGeneration)return;
    progress(.85,'Preparing summons…');
    await addSummonView?.prewarmActors(simulation.state.actors);
    if(generation!==practiceGeneration)return;
    progress(.95,'Preparing hit effects…');
    await hitLighting.prewarm(simulation.state.actors);
    if(generation!==practiceGeneration)return;
    progress(1,'Ready');
    closeDiagnostics();mode='practice';paused=false;matchEntry.clear();lobby.show(false);say('Practice · '+(MAP_NAMES[sceneId]??sceneId));canvas.focus();
  }catch(error){mode='lobby';matchEntry.clear();lobby.show(true);lobby.error('Failed to load practice map: '+error.message);throw error;}
  finally{if(generation===practiceGeneration){mapLoading=false;configurationLocked=false;updateModeControls();}}
}
async function startPvpPractice(sceneId=selectedPracticeMap){
  if(!active||returnFlight||configurationLocked||slotPreparation||professionSwitch.busy)return;
  const generation=++practiceGeneration;
  closeDiagnostics();practiceSnapshot=structuredClone(baselineSnapshot);
  mode='practice2v2';configurationLocked=true;paused=true;lobby.show(false);updateModeControls();
  inputBuffer.clear();keyTranslator.releaseAll();effectsView.clear();damageNumbers.clear();
  try{
    if(!await loadBattleMap(sceneId)||generation!==practiceGeneration||mode!=='practice2v2')return;
    selectedPracticeMap=sceneId;rebuildPracticeSimulation();
    const exercise=createPvpPractice({localId:currentSession.username,nickname:currentSession.nickname??currentSession.username,
      professionId,specialResourcePools:isElesisProfession(professionId)?createElesisResourcePools():isElswordProfession(professionId)?createLordKnightResourcePools():isAddProfession(professionId)?createAddResourcePools():[],
      loadout:practiceSnapshot.actors[0].loadout,map:mapManifest,
      createSimulation:options=>onlineFactory.create(options)});
    pvpPractice=exercise;simulation=exercise.simulation;localPlayerId=currentSession.username;
    onlineMatch={id:'practice-'+generation,mode:'2v2',seed:exercise.seed,players:exercise.players.map(player=>({...player,costumeId:player.id===currentSession.username?selectedCostume(costumePreferences,professionId):'default'}))};
    authoritativePvp=exercise.state;const context={match:onlineMatch,simulation};
    for(const view of views.values())view.root.setEnabled(false);
    const prepared=await onlineFactory.prepareViews(simulation.state.actors,context);
    if(!prepared||generation!==practiceGeneration||mode!=='practice2v2'){context.releaseUnusedViews?.();return;}
    weaponTrails.setLocalActor(localPlayerId);loadout=simulation.actor(localPlayerId).loadout;
    rebuildSlots();resetDisplayClock({resetPresentation:true});pvpHud.show(true);paused=false;updateModeControls();canvas.focus();say('');
  }catch(error){if(generation===practiceGeneration){returnToLobby();lobby.error('Failed to load 2v2 practice: '+error.message);}throw error;}
}
async function acceptServerState(value){
  if(!onlineMatch||value.matchId!==onlineMatch.id||!value.snapshot)return;
  if(presentedResultReceipt?.matchId===value.matchId)return;
  if(value.sequence<=lastServerSequence||onlineStarting&&value.sequence<=(pendingLoadingState?.sequence??-1))return;
  if(onlineStarting){
    // Loading keeps only the newest room snapshot; it must be applied after
    // preparation rather than marked consumed and silently skipped.
    pendingLoadingState=value;authoritativePvp=value.pvp;lastServerAt=performance.now();return;
  }
  lastServerSequence=value.sequence;
  const incomingOwnership=value.ownership?.mode??null;
  if(ownershipMode==='local-owner-v1'&&incomingOwnership!==ownershipMode)throw new TypeError('room-ownership-downgrade');
  ownershipMode=incomingOwnership;authoritativePvp=value.pvp;lastServerAt=performance.now();
  for(const [id,packet]of Object.entries(value.inputs??{}))if(id!==localPlayerId)setRemotePacket(id,packet);
  const priorPresentation=ownsLocalUnit()?ownedPresentation.capture(simulation,localPlayerId):null;
  if(localPlayerId===null){
    onlineStarting=true;try{
      const preparingMatch=onlineMatch;
      reportLoading(preparingMatch,5);
      if(!await loadBattleMap(preparingMatch.sceneId??DEFAULT_SCENE_ID,preparingMatch.versions)||onlineMatch!==preparingMatch||mode!=='online'||authoritativePvp?.phase==='result')return;
      matchEntry.stage(preparingMatch,'Preparing characters and effects…');
      reportLoading(preparingMatch,35);
      localPlayerId=currentSession.username;
      simulation=onlineFactory(value.snapshot);
      if(ownsLocalUnit())ownershipSync.reconcile(simulation,value,localPlayerId);
      const preparingSimulation=simulation;
      for(const view of views.values())view.root.setEnabled(false);
      const context={match:preparingMatch,simulation:preparingSimulation,onProgress:percent=>reportLoading(preparingMatch,percent)};
      const prepared=await onlineFactory.prepareViews(preparingSimulation.state.actors,context);
      reportLoading(preparingMatch,85);
      if(!prepared||onlineMatch!==preparingMatch||simulation!==preparingSimulation||mode!=='online'||authoritativePvp?.phase==='result'){
        context.releaseUnusedViews?.();return;
      }
      await scene.whenReadyAsync();
      if(onlineMatch!==preparingMatch||simulation!==preparingSimulation||mode!=='online'||authoritativePvp?.phase==='result'){
        context.releaseUnusedViews?.();return;
      }
      const local=simulation.actor(localPlayerId);loadout=local.loadout;rebuildSlots();resetDisplayClock();
      weaponTrails.setLocalActor(localPlayerId);
      matchEntry.stage(preparingMatch,'Confirming match connection…');
      reportLoading(preparingMatch,95);
      const acknowledgement=await online.ready(preparingMatch.id);
      if(acknowledgement?.ended===true){
        resultReceipts.skipEndedReconnect({matchId:preparingMatch.id,playerId:session.username});
        pendingEndedReconnect=preparingMatch.id;
        if(battleBootReady)returnToLobby();return;
      }
      if(onlineMatch!==preparingMatch||simulation!==preparingSimulation||mode!=='online'||authoritativePvp?.phase==='result'){
        context.releaseUnusedViews?.();return;
      }
      if(acknowledgement?.ok!==true)throw Error('Failed to confirm match readiness');
      matchEntry.prepared(preparingMatch);
      matchEntry.progress(preparingMatch,currentSession.username,100);
    }finally{onlineStarting=false;}
    const pending=pendingLoadingState;pendingLoadingState=null;
    if(pending&&pending.matchId===onlineMatch?.id&&pending.sequence>lastServerSequence){await acceptServerState(pending);return;}
  }else if(ownsLocalUnit())ownershipSync.reconcile(simulation,value,localPlayerId);
  else if(authoritativePvp?.phase==='fight')prediction.reconcile(simulation,value.snapshot,localPlayerId,value.inputs??{});
  else{prediction.clear();simulation.restore(value.snapshot);}
  if(value.sequence<lastServerSequence)return;
  if(ownsLocalUnit()&&!usesCombatPlayback())ownedPresentation.consume(simulation,priorPresentation,localPlayerId,ownershipSync.epoch);
  for(const a of simulation.state.actors)if(a.id!==localPlayerId){
    const latest=remotePackets.get(a.id);remotePackets.set(a.id,value.inputs?.[a.id]??{held:[],frameSeq:0});remoteSample(a.id,true);
    if(latest)setRemotePacket(a.id,latest);
  }
  const synchronizedEvents=simulation.drainEvents();if(ownsLocalUnit())presentEvents(synchronizedEvents);
  // The verifier owns hit/effect identities. Deduplicate replayed presentation events.
  const eventState=simulation.view(),hasEvents=(value.events?.length??0)>0;if(hasEvents)effectsView.beginEventBatch(eventState);
  try{for(const event of value.events??[]){
      if(event.eventId!=null&&event.eventId<=onlineFactory.lastEventId)continue;
      if(event.eventId!=null)onlineFactory.lastEventId=event.eventId;
      effectsView.event(event,eventState);worldColorView.event(event);hitLighting.event(event,eventState);damageNumbers.event(event);recordEvent(event);
      if(event.type==='sound'||event.type==='stateChanged')sourceStateAudio.event(event);
    }}finally{if(hasEvents)effectsView.endEventBatch();}
  actorRenderClock.push(actorsNow());manaBreakRenderClock.push(actorsNow()[0]);updateHud(actorsNow());
  if(matchEntry.waiting(onlineMatch)&&matchEntry.admit(onlineMatch,authoritativePvp?.phase)){
    paused=false;pvpHud.show(true);resetDisplayClock({resetPresentation:true});updateModeControls();canvas.focus();
  }
}
async function initializeOnline(session){
  currentSession=session;onlineTransportError=null;practiceSimulation=simulation;practiceSnapshot=structuredClone(baselineSnapshot);
  configurationLocked=Boolean(session.online?.queued||session.online?.matchId||session.online?.match);
  onlineFactory=snapshot=>{
    const actors=snapshot.actors.map(a=>({id:a.id,team:a.team,position:[a.x,a.y,a.z],lineId:a.lineId,facing:a.facing,loadout:a.loadout,professionId:a.professionId,profileId:a.profileId}));
    const next=createSimulation({profile,profiles:PROFESSION_PROFILES,presets:PROFESSION_PRESETS,commonBuffs,map:mapManifest,preset:{...preset,onlineMatch:true},actors,seed:onlineMatch.seed,networkOwnerId:ownsLocalUnit()?currentSession.username:null,observeRemoteDamage:true,...simulationSamplers,
      nativeGeometry:nativeRuntime.geometry,nativeCommands:nativeRuntime.commands,nativeSkills:nativeRuntime.skills,
      nativeSkillValues:nativeRuntime.skillValues,nativeNasod:nativeRuntime.nasod,nativeCritical:nativeRuntime.critical,
      nativeManaBreak:nativeRuntime.manaBreak,versions:snapshot.versions});next.restore(snapshot);return next;
  };
  onlineFactory.create=({players,seed})=>createSimulation({profile,profiles:PROFESSION_PROFILES,presets:PROFESSION_PRESETS,commonBuffs,map:mapManifest,preset:{...preset,onlineMatch:true},actors:players.map(actor=>({...actor,professionId:actor.professionId??professionId})),seed,...simulationSamplers,
    nativeGeometry:nativeRuntime.geometry,nativeCommands:nativeRuntime.commands,nativeSkills:nativeRuntime.skills,
    nativeSkillValues:nativeRuntime.skillValues,nativeNasod:nativeRuntime.nasod,nativeCritical:nativeRuntime.critical,
    nativeManaBreak:nativeRuntime.manaBreak,versions:{...practiceSnapshot.versions,programVersion:'rf-local-pvp-ui-v2',matchRules:PVP_RULE_VERSION}});
  onlineFactory.lastEventId=0;
  onlineFactory.prepareViews=async (actors,context)=>{
    const pending=new Map(),current=()=>onlineMatch===context.match&&simulation===context.simulation&&isPvpMode()&&authoritativePvp?.phase!=='result';
    const published=new Map();
    context.releaseUnusedViews=()=>{
      const keepIds=new Set([...practiceSnapshot.actors.map(actor=>actor.id),...(isPvpMode()?onlineMatch?.players??[]:[]).map(player=>player.id)]);
      const unused=[...published].filter(([id,view])=>views.get(id)===view&&!keepIds.has(id));
      if(unused.length){nameplates?.clear();weaponTrails.clear();}
      for(const [id,view]of unused){views.delete(id);view.dispose();}
      published.clear();
    };
    try{
      await effectsView.prewarmActors(actors);if(!current())return false;
      await addSummonView?.prewarmActors(actors);if(!current())return false;
      context.onProgress?.(55);
      for(const actor of actors){
        if(!current())return false;
        if(views.has(actor.id))continue;
        const assets=professionAssets.get(actor.professionId??professionId);if(!assets)throw Error('Class assets unavailable: '+actor.professionId);
        const view=await createView(assets.bodyContainer,actor.id,assets.characterPose);pending.set(actor.id,view);
        if(!current())return false;
        styleCharacter(view);
        const costumeId=context.match.players?.find(player=>player.id===actor.id)?.costumeId??'default';
        publishCostume(view,await prepareActorCostume(view,actor.professionId??professionId,costumeId));
        if(!current())return false;
        if(assets.coreContainer)view.core=styleNasodCore(await createView(assets.coreContainer,actor.id+'-core',assets.corePose));
        if(!current())return false;
      }
      // No await during publication: a superseded load owns only its pending
      // clones, never an existing practice or newer-match view with the same id.
      for(const [id,view]of pending){if(views.has(id))view.dispose();else{views.set(id,view);published.set(id,view);}}
      context.onProgress?.(85);
      pending.clear();await hitLighting.prewarm(actors);return current();
    }finally{for(const view of pending.values())view.dispose();}
  };
  const [ui,pvpAssets]=await Promise.all([data('/assets/ui/online/manifest.json'),data('/assets/ui/pvp-hud/manifest.json')]);
  if(assetVersions.files['ui/buffs/manifest.json']){
    const shared=await data('/assets/ui/buffs/manifest.json'),records=values=>Object.fromEntries(Object.entries(values??{}).map(([name,record])=>[name,{...record,file:'../buffs/'+record.file}]));
    ui.buffIcons={...ui.buffIcons,...records(shared.buffIcons)};ui.pieces={...ui.pieces,...records(shared.pieces)};
  }
  const statusRecords=values=>Object.fromEntries(Object.entries(values??{}).map(([name,record])=>[name,{...record,file:'../pvp-hud/'+record.file}]));
  ui.buffIcons={...ui.buffIcons,...statusRecords(pvpAssets.buffIcons)};
  const statusPieces=Object.fromEntries(Object.entries(pvpAssets.pieces??{}).filter(([,record])=>record.atlas==='DLG_UI_Common_Texture_Buff').map(([name,record])=>['buff:'+name,record]));
  ui.pieces={...ui.pieces,...statusRecords(statusPieces)};
  buffBar=createBuffBar({host:$('.hud-root'),profile,profileForBuff:buff=>{const source=simulation.actor(buff.sourceActorId);return source?simulation.profileFor(source):simulation.profile;},assets:ui});
  keyDialog=createKeyBindingsDialog({host:$('.workbench'),value:keyBindings,assets:ui,assetBase:'/assets/ui/online/',
    onOpen(){guildPanel.close();keysWasPaused=paused;lobby.show(false);paused=true;inputBuffer.clear();keyTranslator.releaseAll();},
    onClose(){if(mode==='lobby')lobby.show(true);paused=keysWasPaused;resetDisplayClock();professionSwitch.flush();},
    async onSave(config){if(configurationLocked)throw Error('Configuration is locked during matchmaking');
      await online.api('/api/key-preferences','PUT',config);inputBuffer.clear();keyTranslator.setBindings(config);keyBindings=config;rebuildSlots();updateModeControls();}
  });
  pvpHud=createPvpHud({host:$('.viewport'),localId:session.username,onReturn:dismissResultAndReturn,assets:ui,pvpAssets,hudAssets:uiManifest});
  online=createOnlineClient({iceServers:session.rtcIceServers??[],peerMode:session.peerMode??'hybrid',eventTransport:session.onlineEventTransport??'sse',pageInitToken:session.pageInitToken??null,onError:handleOnlineError,onEvent(type,value){
    if(returnFlight||battleRetired)return;
    if(type==='reconnect-ended'){
      resultReceipts.skipEndedReconnect({matchId:value.matchId,playerId:session.username});
      const activeMatchId=onlineMatch?.id??launchIntent?.match?.id;
      if(activeMatchId&&activeMatchId!==value.matchId)return;
      pendingEndedReconnect=value.matchId;
      // initializeOnline may receive this before nameplates/render-loop setup.
      // Complete boot before disposing that scene and mounting the light lobby.
      if(battleBootReady){stopSounds();returnToLobby();}return;
    }
    if(type==='match-preparing'&&mode==='lobby'&&!onlineMatch){
      preparingMatch=value;configurationLocked=true;lobby.show(false);
      interfaceAudio?.matchAccepted(value.id);matchEntry.begin(value,{playerId:session.username});
      matchEntry.stage(value,'Preparing match room…');updateModeControls();return;
    }
    if(type==='match-preparation-ended'&&value.id===preparingMatch?.id){
      preparingMatch=null;matchEntry.clear();
      if(mode==='lobby'){lobby.show(true);lobby.error('Room setup was interrupted. Rejoining the queue…');}
      return;
    }
    if(type==='server-error'&&value.error==='room-worker-unavailable'&&value.matchId===onlineMatch?.id){
      // Only this match was cancelled. Keep the authenticated lobby transport
      // available so the player can queue again without a forced new login.
      stopSounds();returnToLobby();lobby?.error('The room was interrupted. You can queue again from the lobby.');return;
    }
    if(type==='status'){configurationLocked=mapLoading||mode==='practice2v2'||Boolean(value.queued||value.matchId||value.match);updateModeControls();lobby?.status(value);interfaceAudio?.setQueue(value);observeProfession(value.professionId);}
    if(type==='match'){
      preparingMatch=null;
      if(onlineMatch?.id===value.id){
        for(const player of value.players??[]){const previous=onlineMatch.players?.find(p=>p.id===player.id);player.loadingProgress=Math.max(previous?.loadingProgress??0,player.loadingProgress??0);}
        onlineMatch.players=value.players;ownershipSync.setContinuousAuraVersion([1,2].includes(value.continuousAuraVersion)?value.continuousAuraVersion:0);ownershipSync.setOwnerStatusVersion(value.ownerStatusVersion===1?1:0);ownershipSync.setCombatPlaybackVersion(value.combatPlaybackVersion===1?1:0);
        matchEntry.players(onlineMatch);online.refreshMatch(value,session.username);return;
      }
      interfaceAudio?.matchAccepted(value.id);
      closeDiagnostics();practiceSnapshot=structuredClone(baselineSnapshot);
      onlineMatch=value;ownershipSync.clear();ownedPresentation.clear();ownershipMode=null;onlineFactory.lastEventId=0;configurationLocked=true;mode='online';paused=true;lobby.show(false);
      ownershipSync.setContinuousAuraVersion([1,2].includes(value.continuousAuraVersion)?value.continuousAuraVersion:0);ownershipSync.setOwnerStatusVersion(value.ownerStatusVersion===1?1:0);ownershipSync.setCombatPlaybackVersion(value.combatPlaybackVersion===1?1:0);
      pendingLoadingState=null;matchEntry.begin(value,{playerId:session.username});pvpHud.show(false);
      inputBuffer.clear();keyTranslator.releaseAll();online.setMatch(value,session.username);updateModeControls();
    }
    if(type==='state'){
      const receivingMatch=onlineMatch;
      acceptServerState(value).catch(error=>{
        // A rejected map, view or ready request can outlive its battle. It
        // must not stop a healthy lobby, practice session or subsequent match.
        if(!receivingMatch||onlineMatch!==receivingMatch||mode!=='online'||authoritativePvp?.phase==='result')return;
        handleOnlineError(Object.assign(error,{fatal:true}));
      });
    }
    if(type==='input')for(const [id,packet]of Object.entries(value.inputs??{}))if(id!==localPlayerId)setRemotePacket(id,packet);
      if(type==='peer-input')setRemotePacket(value.playerId,value.packet);
      if(type==='owner-actions'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting){
        if(authoritativePvp?.phase==='fight')return ownershipSync.receiveActions(value.playerId,value.actions,value.epoch,value.frameSeq);
        if(authoritativePvp?.phase==='slow')return ownershipSync.receiveTerminals(simulation,value.playerId,value.actions,value.epoch,value.frameSeq,localPlayerId);
      }
    if(type==='owner-motion'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting&&authoritativePvp?.phase==='fight'){
      try{return ownershipSync.receiveMotion(simulation,value.playerId,value.motion,localPlayerId);}
      catch(error){recordEvent({type:'peer-motion-rejected',playerId:value.playerId,message:error.message});return false;}
    }
    if(type==='owner-protection'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting&&authoritativePvp?.phase==='fight'){
      try{return ownershipSync.receiveProtection(simulation,value.playerId,value.status,localPlayerId,value.buffRevision);}
      catch(error){recordEvent({type:'peer-protection-rejected',playerId:value.playerId,message:error.message});return false;}
    }
    if(type==='owner-buffs'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting&&authoritativePvp?.phase==='fight'){
      try{return ownershipSync.receiveBuffs(simulation,value.playerId,value.snapshot,localPlayerId);}
      catch(error){recordEvent({type:'peer-buffs-rejected',playerId:value.playerId,message:error.message});return false;}
    }
    if(type==='owner-status'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting&&authoritativePvp?.phase==='fight'){
      try{return ownershipSync.receiveStatus(simulation,value.playerId,value.status,localPlayerId);}
      catch(error){recordEvent({type:'peer-status-rejected',playerId:value.playerId,message:error.message});return false;}
    }
    if(type==='peer-owned-state'&&ownsLocalUnit()&&localPlayerId!==null&&!onlineStarting&&['fight','slow'].includes(authoritativePvp?.phase)){
      try{const before=ownedPresentation.capture(simulation,localPlayerId);
        const accepted=ownershipSync.receivePeerResult(simulation,value.playerId,value.report,localPlayerId);
        if(accepted.applied&&!usesCombatPlayback())ownedPresentation.consume(simulation,before,localPlayerId,ownershipSync.epoch);
        return accepted;
      }catch(error){recordEvent({type:'peer-state-rejected',playerId:value.playerId,message:error.message});return false;}
    }
    if(type==='resource-delivery'){lobby?.resourceDelivery(value);return;}
    if(type==='peer-owned-state')return false;
    if(type==='disconnect'){
      const id=value.playerId??value.id;
      if(value.matchId===onlineMatch?.id&&onlineMatch.players.some(player=>player.id===id))ownershipSync.disconnect(simulation,id,value.epoch);
      say((id??'Player')+' disconnected');
    }
    if(type==='result'){
      const receipt=resultReceipts.accept(value,{activeMatchId:onlineMatch?.id,playerId:session.username,mode});
      if(receipt){
        presentedResultReceipt={matchId:receipt.matchId,playerId:receipt.playerId};
        closeDiagnostics();paused=true;online.clearMatch();prediction.clear();ownershipSync.clear();
        resultStartedAt=performance.now();authoritativePvp={...authoritativePvp,...receipt.result,phase:'result'};
        // An early result closes admission as well as transport. In-flight map
        // or character preparation must not cover or replace the result HUD.
        mapGeneration++;pendingLoadingState=null;localPlayerId=session.username;
        showAcceptedOnlineResult(receipt,{pvp:authoritativePvp,entry:matchEntry,lobby,hud:pvpHud,presentation:resultPresentation});
      }
    }
  }});
  const mapStatus=await online.api('/api/online/maps');
  lobby=createOnlineLobby({host:$('.viewport'),username:session.username,role:session.role,nickname:session.nickname??session.username,initialStatus:session.online,modes:session.modes??session.online?.modes,maps:mapStatus.maps,defaultSceneId:currentMapVersions.sceneId??selectedPracticeMap,
    resourceDelivery:session.resourceDelivery, onResourceDeliverySave:enabled=>online.api('/api/admin/resource-delivery','POST',{enabled}),
    professionId:session.professionId??professionId,professions:session.professions,professionFlags:session.professionFlags,professionDiagnostics:session.professionDiagnostics,
    costumes:costumePreferences,onCostumeChange:selectCostume,assetUrl,
    onProfessionChange:next=>professionSwitch.select(next,id=>online.api('/api/preferences/profession','POST',{professionId:id})),
    onEffectiveProfessionChange:observeProfession,
    async onProfessionToggle(id,enabled){const state=await online.api('/api/admin/professions');return await online.api('/api/admin/professions','POST',{professions:{...state.professionFlags,[id]:enabled}});},
    async onNicknameSave(nickname){const value=await online.api('/api/nickname-preferences','PUT',{nickname});currentSession.nickname=value.nickname;return value;},
    onSkills(){lobby.show(false);$('#skills').click();},onKeys(){keyDialog.open();},
    onGuild(){if(mode==='lobby'&&!configurationLocked&&!slotPreparation&&!professionSwitch.busy)guildPanel.open();},
    onPractice:sceneId=>startFreePractice(sceneId),
    onPractice2v2:sceneId=>startPvpPractice(sceneId),
    onQueue:queueWithConfirmedConfiguration,async onCancel(){if(onlineTransportError)throw onlineTransportError;const result=await online.cancel();interfaceAudio?.cancelAccepted(result);return result;},
    async onModeChange(matchMode,enabled){if(onlineTransportError)throw onlineTransportError;return await online.api('/api/online/modes','POST',{mode:matchMode,enabled});},
    async onCapacitySave(maxRoomsByMode){if(onlineTransportError)throw onlineTransportError;return await online.setRoomCapacity(maxRoomsByMode);},
    async onMapChange(mapId,enabled){if(onlineTransportError)throw onlineTransportError;return await online.api('/api/online/maps','POST',{mapId,enabled});},
    async onAccountCreate(username,password){return await online.api('/api/admin/accounts','POST',{username,password});}
  });
  const prefs=await online.api('/api/key-preferences');keyBindings=prefs.preferences??prefs.keyBindings??prefs;
  keyTranslator.setBindings(keyBindings);keyDialog.setValue(keyBindings);rebuildSlots();
  const keysButton=document.createElement('button');keysButton.id='keys';keysButton.textContent='Key bindings';keysButton.onclick=()=>keyDialog.open();$('.tools').insertBefore(keysButton,$('.status'));
  const lobbyButton=document.createElement('button');lobbyButton.id='lobby';lobbyButton.textContent='Return to matchmaking';lobbyButton.onclick=()=>{if(presentedResultReceipt){dismissResultAndReturn();return;}if(mode==='online'){say('Return after the results are in. Logging out during a match counts as a disconnect.');return;}if(lobbyHandoff||onlineTransportError||mode==='practice2v2'){returnToLobby();return;}closeDiagnostics();mode='lobby';paused=true;lobby.show(true);professionSwitch.flush();updateModeControls();};$('.tools').insertBefore(lobbyButton,$('.status'));
  const originalSkills=$('#skills').onclick;$('#skills').onclick=()=>{if(configurationLocked)return;originalSkills();};
  $('#picker-close').addEventListener('click',()=>{if(mode==='lobby')lobby.show(true);});
  listenBattleWindow('keydown',event=>{if(event.code==='Escape'&&mode==='lobby')queueMicrotask(()=>{if($('.skill-picker').hidden&&!keyDialog.isOpen)lobby.show(true);});});
  // Every diagnostic handler has a state guard in addition to hidden controls.
  for(const id of diagnosticIds){const button=$('#'+id),callback=button?.onclick;if(button&&callback)button.onclick=(...args)=>{if(mode==='practice'&&(session.role==='gm'||practiceControlIds.has(id)))return callback(...args);};}
  mode=lobbyHandoff?'loading':'lobby';paused=true;lobby.show(mode==='lobby');updateModeControls();
  try{const handedOff=await lobbyHandoff?.release?.();if(handedOff?.pageInitToken){online.setPageInitToken(handedOff.pageInitToken);currentSession.pageInitToken=handedOff.pageInitToken;}
    await online.open();if(!onlineTransportError)lobby.history(await online.api('/api/history'));}
  catch(error){if(!onlineTransportError){handleOnlineError(error);if(!onlineTransportError)throw error;}}
}

let bootResources;
try {
  bootResources=createBattleResourcePrefetch({load:(url,signal)=>data(url,{signal}),urls:battleBootstrapUrls(assetVersions.files)});
  const bootData=bootResources.read;
  [uiManifest,audioManifest]=await Promise.all([bootData('/assets/ui/manifest.json'),bootData('/assets/audio/manifest.json')]);
  Object.assign(audioManifest.files,(await bootData('/assets/audio/pose-v25/manifest.json')).files);
  const feedbackAudio=await bootData('/assets/audio/feedback-v26/manifest.json');Object.assign(audioManifest.files,feedbackAudio.files);
  const interfaceManifest=await bootData('/assets/audio/lobby/manifest.json');
  Object.assign(interfaceManifest.files,{queueStart:feedbackAudio.files['Battle_Atena_Start.ogg'],queueCancel:feedbackAudio.files['Battle_Atena_Fail.ogg'],matchSuccess:feedbackAudio.files['Battle_Atena_Success.ogg'],skillEquip:feedbackAudio.files['Skill_Equip.ogg'],skillUnequip:feedbackAudio.files['Skill_UnEquip.ogg']});
  interfaceAudio=createInterfaceAudio({manifest:interfaceManifest,storage:audioStorage,initialMatchId:lobbyHandoff?.audio?.matchId??null,
    createAudio:url=>new Audio(assetUrl(url)),canPlay:()=>audioGesture.allowed,onError:event=>recordEvent(event)});
  interfaceAudio.setVolume(battleAudio.volume);interfaceAudio.setEnabled(battleAudio.enabled);
  audioManifest.files={...audioManifest.files,...(await bootData('/assets/audio/pvp/manifest.json')).files};
  bootStage('Loading map…',12);
  await loadBattleMap(launchIntent?.sceneId??launchIntent?.match?.sceneId??bootSession.online?.match?.sceneId??DEFAULT_SCENE_ID);
  bootStage('Preparing combat runtime…',24);
  const nativeManifest=await bootData('/assets/native/manifest.json');
  if(nativeManifest.runtimeVersion!==NATIVE_RUNTIME_VERSION)throw Error('This class requires the full versioned native runtime');
  nativeRuntime=await createNativeRuntime({manifest:nativeManifest,map:mapManifest,
    loadBinary:async file=>{const response=await fetch(assetUrl('/assets/native/'+file));if(!response.ok)throw Error(`Native ${file}: HTTP ${response.status}`);return response.arrayBuffer();}});
  geometryModule=await WebAssembly.compile(await (await fetch(assetUrl('/assets/native/'+nativeManifest.modules.geometry.file))).arrayBuffer());
  awakeningBeadView=await createAwakeningBeadView({document,host:nativeHud,loadIndex:async signal=>{const response=await fetch(assetUrl('/assets/ui/awakening-bead/index.json'),{signal});if(!response.ok)throw Error(`HUD awakening bead: HTTP ${response.status}`);return response.json();},
    nativeRandom:nativeRuntime.effectRandom,onUnsupported:e=>recordEvent(e)});
  const swordUiIndex=await bootData('/assets/ui/way-of-sword/index.json');
  const elesisSwordUiIndex=await bootData('/assets/ui/elesis-way-of-sword/index.json');
  wayOfSwordHud=createWayOfSwordHud({document,host:nativeHud,index:swordUiIndex,elesisIndex:elesisSwordUiIndex});
  const swordSkillUiIndex=await bootData('/assets/ui/skill-sword/index.json');
  skillSwordCues=createSkillSwordCues({document,index:swordSkillUiIndex,getSlots:()=>skillButtons,
    getSkill:id=>supportedSkills().find(s=>Number(s.skillId??s.id)===id)});
  bootStage('Loading class models, animations and effects…',35);
  if(assetVersions.files['common-buffs/manifest.json']){
    const manifest=await bootData('/assets/common-buffs/manifest.json');
    commonBuffSourceIndexes=manifest.visualEffectIndexes.map(file=>'/assets/common-buffs/'+file);
    [commonBuffs,commonBuffVisuals]=await Promise.all([bootData('/assets/common-buffs/'+manifest.definitionCatalog),
      Promise.all(commonBuffSourceIndexes.map(file=>bootData(file))).then(indexes=>mergeVisualEffectIndexes(...indexes))]);
  }
  if(assetVersions.files['battle-life/manifest.json']){
    const manifest=await bootData('/assets/battle-life/manifest.json');
    battleLifeSourceIndexes=manifest.visualEffectIndexes.map(file=>'/assets/battle-life/'+file);
    battleLifeVisuals=await bootData(battleLifeSourceIndexes[0]);
  }
  if(assetVersions.files['cast-display/manifest.json']){
    const manifest=await bootData('/assets/cast-display/manifest.json');
    castDisplaySourceIndexes=manifest.visualEffectIndexes.map(file=>'/assets/cast-display/'+file);
    castDisplayVisuals=await bootData(castDisplaySourceIndexes[0]);
  }
  professionAssetCache=createProfessionAssetCache({data,castDisplayVisuals,castDisplaySourceIndexes,commonBuffVisuals,commonBuffSourceIndexes,battleLifeVisuals,battleLifeSourceIndexes,map:()=>mapManifest,onUnsupported:e=>recordEvent(e),
    loadContainer:(base,file)=>SceneLoader.LoadAssetContainerAsync(base,file,scene)});
  // GM flags affect selection, not residency. Only a deployment genuinely
  // lacking the optional LK manifest may omit that profession's resources.
  const launchPlayers=launchIntent?.match?.players??bootSession.online?.match?.players??[];
  const requiredProfessions=new Set([professionId,...launchPlayers.map(p=>normalizeProfessionId(p.professionId,{fallback:true}))]);
  const preparedProfessions=await professionAssetCache.loadAll([...requiredProfessions].filter(id=>assetVersions.files[id.toLowerCase()+'/manifest.json']));
  bootStage('Assembling character and effect models…',52);
  for(const [id,assets]of preparedProfessions)professionAssets.set(id,assets);
  let addUiAssets=null;
  if([...professionAssets.keys()].some(isAddProfession)){
    addUiAssets=await bootData('/assets/ui/add/index.json');addHud.setAssets(addUiAssets);
  }
  const localAssets=professionAssets.get(professionId);
  const swordAssets=professionAssets.get('LK')??professionAssets.get('IS');
  if(swordAssets)wayOfSwordParticles=await createWayOfSwordParticleView({document,host:nativeHud,
    effectIndex:swordAssets.fxIndex,assetBase:swordAssets.base,uiIndex:swordUiIndex,elesisUiIndex:elesisSwordUiIndex,nativeRandom:nativeRuntime.effectRandom,onUnsupported:e=>recordEvent(e)});
  if(!localAssets)throw Error('Class assets are missing: '+professionId);
  rfManifest=localAssets.manifest;skillCatalog=localAssets.catalog;
  const {bodyContainer,characterPose,coreContainer,corePose}=localAssets;
  characterAudit=createPoseAudit(characterPose,{map:()=>simulation.map});if(corePose)coreAudit=createPoseAudit(corePose,{useDisplayedRoot:true});
  ({manifest:audioManifest,criticalSoundFile}=await loadRosterAudio({manifest:audioManifest,professionAssets,data:bootData}));
  battleAudio.configure({manifest:audioManifest,criticalSoundFile});
  const samplers=createProfessionSamplers(Object.fromEntries([...professionAssets].map(([id,a])=>[id,a.samplers])),professionId);
  if(professionAssets.get('MM')?.summons?.apocalypse)addSummonView=createAddSummonView({scene,assets:professionAssets.get('MM').summons,scale:SCALE,styleView:styleCharacter});
  simulationSamplers=samplers;
  const costumeParticleIndex=await bootData('/assets/costumes/particles.json');
  let bootWarmActive=false;const bootWarmFractions=new Map();
  const warmProgress=(id,info)=>{
    if(!bootWarmActive)return;
    const fraction=info.phase==='complete'?1:.8*(info.visitedTemplates/Math.max(1,info.templates))+.2*(info.completedJobs/Math.max(1,info.requestedJobs));
    bootWarmFractions.set(id,Math.max(bootWarmFractions.get(id)??0,Math.min(1,fraction)));
    bootStage('Preparing skills and sounds…',72+14*[...bootWarmFractions.values()].reduce((a,b)=>a+b,0)/professionAssets.size);
  };
  const effectViews=Object.fromEntries(await Promise.all([...professionAssets].map(async([id,a])=>[id,await createEffectsView({scene,engine,index:{...a.fxIndex,templates:{...a.fxIndex.templates,...costumeParticleIndex.templates}},profile:installAddMoonlightSource(installCommonBuffs(structuredClone(a.profile),commonBuffs)),samplers:a.samplers,effectPoses:a.effectPoses,
    prepareResourcesOnly:true,costumeParticleSampler:actor=>views.get(actor.id)?.costume?.particles??[],
    assetBase:a.base,sourceIndexes:a.sourceIndexes,loadout:[],loadContainer:professionAssetCache.loadContainer,nativeRandom:nativeRuntime.effectRandom,effectQuality:DEFAULT_EFFECT_QUALITY,
    localActorId:state=>localPlayerId??state.actors[0]?.id,onPreparationProgress:info=>warmProgress(id,info),onUnsupported:e=>recordEvent(e)})])));
  bootStage('Preparing map effects and damage display…',65);
  let mapEffectsView=null;
  if(assetVersions.files['map-mechanics/index.json']){
    const index=await bootData('/assets/map-mechanics/index.json');
    const poses=Object.fromEntries(await Promise.all([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
      .map(async file=>[file,await bootData('/assets/map-mechanics/'+file)])));
    const mapProfile={target:{},components:{MAX_HYPER_MODE_TIME:0},states:{},skillCatalog:[],effectSets:{},damageEffects:{},
      resourceOnlyTemplates:[...new Set([...index.portalTemplates,...Object.values(index.maps).flatMap(m=>m.ambient.map(o=>o.template))])]};
    mapEffectsView=await createEffectsView({scene,engine,index,profile:mapProfile,samplers:{},effectPoses:poses,environment:true,
      assetBase:'/assets/map-mechanics/',sourceIndexes:['/assets/map-mechanics/index.json'],effectQuality:{level:'high',particleDivisor:1},onUnsupported:e=>recordEvent(e)});
    await mapEffectsView.prewarmMap();
    for(const [name,record]of Object.entries(index.audio))audioManifest.files[name]={...record,file:'../map-mechanics/'+record.file};
    battleAudio.configure({manifest:audioManifest,criticalSoundFile});
  }
  effectsView=createProfessionEffects(effectViews,professionId,{environmentView:mapEffectsView});effectsView.setMap(mapManifest);
  damageNumbers=await createDamageNumbers({scene,manifest:await bootData('/assets/ui/damage-numbers/manifest.json'),onUnsupported:e=>recordEvent(e)});
  bootStage('Preparing skills and sounds…',72);
  bootWarmActive=true;
  await Promise.all([loadAllProfessionPreferences(bootSession),prepareProfessionPracticeViews(),
    prewarmAllProfessionSkills(effectViews,professionAssets),battleAudio.prewarm()]);
  bootWarmActive=false;
  bootResources.close();
  // Source models/materials stay resident for all professions. Reserve full
  // burst pools only for the selected profession; actual matches prepare their
  // frozen roster before ready. Do not allocate twelve hypothetical rosters.
  await scene.whenReadyAsync();professionPrewarmReady=true;
  bootStage('Preparing free practice…',88);
  const preferences=professionPreferences.get(professionId);skillPreferences=preferences.client;
  loadout=preferences.loadout;branchChoices=preferences.branchChoices;
  simulation=createPracticeSimulation(professionId,loadout);
  baselineSnapshot=simulation.snapshot();beginRecording('initial-load');
  for(const [id,view]of professionPracticeViews.get(professionId)){views.set(id,view);view.root.setEnabled(true);}
  weaponTrails=createRFWeaponTrails({scene,profile,profileFor:actor=>simulation.profileFor(actor),scale:SCALE,localActorId:actorsNow()[0].id,
    sampleEndpoints:(actor,names)=>Object.fromEntries(getActorNativePoints(views.get(actor.id),names,SCALE)),
    onUnsupported:detail=>recordEvent({type:'unsupported-weapon-trail',detail})});
  motionInspector=createMotionInspector({host:$('.workbench'),view:views.get(actorsNow()[0].id),sourceAudit:characterAudit,
    canOpen:()=>active&&mode==='practice'&&currentSession?.role==='gm'&&!configurationLocked&&!slotPreparation&&$('.skill-picker').hidden&&!guildPanel.isOpen(),
    onOpen(){inspectWasPaused=paused;paused=true;resetDisplayClock();stopSounds();weaponTrails.clear();say('');inputBuffer.releaseAll(performance.now()/1000);
      for(const id of ['pause','skills','guild-skills','reset','target-attack','prepare-awakening','prepare-death'])$('#'+id).disabled=true;},
    onClose(){paused=inspectWasPaused;resetDisplayClock();for(const id of ['pause','skills','guild-skills','reset','target-attack','prepare-awakening','prepare-death'])$('#'+id).disabled=false;
      $('#pause').textContent=paused?'Resume':'Pause';for(const actor of actorsNow())renderActor(actor);canvas.focus();}});
  const session=bootSession;
  loadout=simulation.configureLoadout(applyPickerBranches(loadout,branchChoices,pickerDefinitions()),actorsNow()[0].id);
  // The initial page enters the lobby. Real roster/loadout burst budgets are
  // awaited by practice startup or onlineFactory.prepareViews before play.
  await hitLighting.prewarm(simulation.state.actors);
  baselineSnapshot.actors[0].loadout=structuredClone(loadout);beginRecording('initial-load');rebuildSlots();
  resetDisplayClock();for(const a of actorsNow())renderActor(a);updateHud(actorsNow());updateCamera(0,actorsNow()[0]);
  battleAudio.setListenerPosition(sourceCameraEye(camera.position,SCALE));drain();
  $('.loading-overlay').remove();active=true;canvas.focus();say('');
  await initializeOnline(session);
  if(addUiAssets)buffBar.setAddAssets(addUiAssets);
  nameplates=createPlayerNameplates({host:$('.viewport')});const nameplateWorld=Matrix.Identity(),nameplatePoint=new Vector3();
  function projectFeet(actor){if(!views.has(actor.id))return null;
    nameplatePoint.set(actor.x*SCALE,actor.y*SCALE,-actor.z*SCALE);
    const point=Vector3.Project(nameplatePoint,nameplateWorld,scene.getTransformMatrix(),camera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));
    const x=point.x*canvas.clientWidth/engine.getRenderWidth(),y=point.y*canvas.clientHeight/engine.getRenderHeight();
    return point.z>=0&&point.z<=1&&x>=0&&x<=canvas.clientWidth&&y>=0&&y<=canvas.clientHeight?{x,y}:null;
  }
  frameSupervisor=createFrameSupervisor({onPresentationFault(proof,error){
    console.warn('Battle presentation frame skipped',proof.stage,proof.count,error);
  },onFault(proof,error){
    active=false;paused=true;inputBuffer.clear();keyTranslator.releaseAll();stopSounds();online?.close();
    console.error('Battle frame stopped',error);
    const panel=document.createElement('div');panel.id='battle-runtime-error';panel.className='battle-runtime-error';panel.setAttribute('role','alert');panel.dataset.proof=JSON.stringify(proof);
    const message=document.createElement('p');message.textContent='Combat paused after a runtime error. Reload or sign in again.';
    const detail=document.createElement('small');detail.textContent=proof.stage+': '+proof.message;
    const reload=document.createElement('button');reload.textContent='Reload';reload.onclick=()=>location.reload();
    const logout=document.createElement('button');logout.textContent='Log out';logout.onclick=()=>$('#logout').click();
    panel.append(message,detail,reload,logout);$('.viewport').append(panel);
  }});
  engine.runRenderLoop(frameSupervisor.wrap(stage=>{const now=performance.now();
    stage('input-clock');
    const {rawDt,dt,cutoffs,alpha}=inputStepClock.advance(now/1000,{paused:paused||slotPreparation||motionInspector.active});
    stage('combat-and-owner-report');
    for(const cutoff of cutoffs)tick(false,cutoff,now);
    const view=frameSupervisor.presentation('actor-pose',()=>{
    const actualActors=actorsNow(),poseStart=performance.now();if(motionInspector.active)motionInspector.update(dt);
    const fixedActors=actorRenderClock.sample(actualActors,alpha,{exact:paused||motionInspector.active});
    // Playback already advances every actor on the same local fixed clock.
    // Render between those completed steps just as in practice; using raw
    // actors here made online movement (including our own) jump at 60 Hz.
    const actors=shownActors=usesCombatPlayback()?fixedActors:ownsLocalUnit()?remoteActorClock.sample(fixedActors,localPlayerId,{now,exact:paused||motionInspector.active}):fixedActors;
    const visualDt=paused?0:dt*(authoritativePvp?.phase==='slow'?(authoritativePvp.timeScale??.2):1);
    for(const actor of actors)renderActor(actor,visualDt);addSummonView?.update(actors);weaponTrails.step({actors,dt:visualDt,clawEnabled:actorClawEnabled});
    buffAfterimages.step(actors,visualDt);
    hitLighting.step(visualDt);
    groundShadows.step(actors);
    return {actualActors,actors,poseStart,visualDt};
    });
    if(!view)return;
    const {actualActors,actors,poseStart,visualDt}=view;
    frameSupervisor.presentation('effects-and-camera',()=>{
    updateCamera(paused?0:dt,actors[0]);battleAudio.setListenerPosition(sourceCameraEye(camera.position,SCALE));
    mapUvScroll?.step(paused||slotPreparation?0:dt*(authoritativePvp?.phase==='slow'?(authoritativePvp.timeScale??.2):1));effectsView.render({actors});damageNumbers.render(paused?1:alpha);measure(perf.poseMs,performance.now()-poseStart);
    });
    frameSupervisor.presentation('scene-render',()=>{
    meshCandidates.commitEnabledChanges();scene.render();inputStageTrace.presented(actors[0],performance.now());motionInspector.afterRender(actors[0]);nameplates.update(actors,{localId:localPlayerId,players:authoritativePvp?.players,projectFeet,visible:isPvpMode()});
    });
    frameSupervisor.presentation('hud-and-diagnostics',()=>{
    awakeningBeadView.render(paused?0:dt,isRavenProfession(professionId)?(actualActors[0]?.awakening?.orbs??0):0);
    wayOfSwordHud.render(paused?0:dt);
    skillSwordCues.render(paused?0:dt);
    wayOfSwordParticles?.render(paused?0:dt,actualActors[0]);
    updateManaBreakHud(actualActors[0],alpha,paused||slotPreparation||motionInspector.active);
    if(now-lastHudAt>80){updateHud(actors);lastHudAt=now;}
    measure(perf.frameMs,rawDt*1000);perf.frames++;perf.fxActive=effectsView.count;
    renderQuality.sample(rawDt*1000,{active:mode!=='lobby'&&!paused&&!slotPreparation&&!motionInspector.active&&!document.hidden});
    if(now-lastPerformanceAt>500){const local=actualActors[0];const report={fixedStepP95Ms:percentile(perf.stepMs),poseP95Ms:percentile(perf.poseMs),frameP95Ms:percentile(perf.frameMs),eventToStepP95Ms:percentile(perf.inputMs),pendingInputs:inputBuffer.pending,effects:perf.fxActive,frames:perf.frames,steps:perf.steps,
      mode,map:mapManifest.sceneId,...effectsView.performance(),worldColor:worldColorView.proof(),hitLighting:hitLighting.proof(),impactCamera:{enabled:false,policy:'user-disabled'},hitFramebuffer:{enabled:false,policy:'user-disabled'},groundShadows:groundShadows.proof(),...effectsView.activity(),
      renderQuality:{...renderQuality.proof(),width:engine.getRenderWidth(),height:engine.getRenderHeight()},meshCandidates:meshCandidates.proof(),
      resourceCache:resourceTimings.snapshot(),backgroundFrames:backgroundFrames.proof(),
      inputStages:inputStageTrace.snapshot(),
      camera:actors[0]?{...authoredLineBasis(actors[0],simulation.map),eye:cameraTracking?.eye,target:cameraTracking?.target}:null,
      local:local?{id:local.id,x:local.x,y:local.y,z:local.z,lineId:local.lineId,lastTouchLineId:local.lastTouchLineId,state:local.state,hp:local.hp,mp:local.mp,awakening:local.awakening.gauge}:null,
      network:mode==='online'?{ownership:ownershipMode,serverAgeMs:Math.round(now-lastServerAt),peers:online.connectivity(),transport:online.performance(),history:ownershipSync.actionDiagnostics,body:ownershipSync.bodyDiagnostics,presentation:remoteActorClock.diagnostics()}:null};
      perfOutput.dataset.metrics=JSON.stringify(report);
      const peerRows=report.network?.peers??[],confirmedPeers=peerRows.filter(peer=>peer.direct&&peer.relaySuppressionEligible).length;
      perfOutput.textContent=`Simulation ${report.fixedStepP95Ms.toFixed(1)}ms · Pose ${report.poseP95Ms.toFixed(1)}ms · FX ${report.effects}`
        +(report.network?` · Direct peers ${confirmedPeers}/${peerRows.length}`:'');
      perfOutput.title=peerRows.map(peer=>`${peer.id}: ${peer.directRoute?'Direct connection':'Relay or unconfirmed route'}, ${peer.dataUsable?'Combat channel ready':'Combat channel reconnecting'}, ${peer.relaySuppressionEligible?'Recent data acknowledged':'Server still supplementing data'}`
        +(Number.isFinite(peer.roundTripTimeMs)?`, RTT ${Math.round(peer.roundTripTimeMs)}ms`:'')).join('\n');
      lastPerformanceAt=now;}
    });
  }));
  // Deliberately read-only diagnostic hook for browser acceptance snapshots.
  window.rfWorkbench={snapshot:()=>simulation.snapshot(),events:()=>structuredClone(eventLog),frameFault:()=>frameSupervisor.proof(),presentationFaults:()=>frameSupervisor.presentationProof(),presentation:collectPresentationProof,camera:()=>({position:camera.position.asArray(),tracking:structuredClone(cameraTracking),dynamic:false,normalTracking:true,adapter:preset.cameraAdapter}),manifest:()=>({rf:rfManifest,map:mapManifest,ui:uiManifest}),mapPresentation:()=>({uv:mapUvScroll?.proof(),activity:effectsView.activity().environment,effects:effectsView.proof({includeDraws:true}).environment})};
  window.rfWorkbench.effectPresentation=()=>effectsView.proof({includeDraws:true});
  window.rfWorkbench.renderSnapshot=()=>({mode,localPlayerId,combatPlayback:usesCombatPlayback(),frame,
    actors:shownActors.map(actor=>({id:actor.id,x:actor.x,y:actor.y,z:actor.z,state:actor.state,
      stateSerial:actor.stateSerial,animationTime:actor.animationTime,meshPosition:views.get(actor.id)?.root.position.asArray()??null})),
    playback:ownershipSync.combatPlaybackDiagnostics});
  battleBootReady=true;
  const endedReconnect=pendingEndedReconnect??lobbyHandoff?.reconnectEnded;
  if(endedReconnect&&(!(onlineMatch?.id??launchIntent?.match?.id)||(onlineMatch?.id??launchIntent?.match?.id)===endedReconnect)){returnToLobby();}
  else if(launchIntent?.kind==='practice'){await startFreePractice(launchIntent.sceneId??DEFAULT_SCENE_ID);bootStage('Ready',100);matchEntry.clear();}
  else if(launchIntent?.kind==='practice2v2'){await startPvpPractice(launchIntent.sceneId??DEFAULT_SCENE_ID);bootStage('Ready',100);matchEntry.clear();updateModeControls();}
} catch(error) {
  bootResources?.close();
  console.error(error);
  active=false;paused=true;
  // Online initialization can fail after the normal loading overlay is removed.
  let overlay=$('.loading-overlay');
  if(!overlay){
    overlay=document.createElement('div');overlay.className='loading-overlay';
    ($('.viewport')??$('#app')??document.body).append(overlay);
  }
  overlay.classList.add('load-error');overlay.setAttribute('role','alert');
  overlay.hidden=false;overlay.style.zIndex='1200';
  overlay.textContent='Loading failed:'+(error?.message??String(error));
  throw error;
}

}
