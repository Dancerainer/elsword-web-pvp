/** Browser display fixture using original meshes/poses and production FX view.
 * Explicit UI supplies lifecycle states; it is not an original-client trace. */
import {Engine,Scene,FreeCamera,Vector3,Color4,SceneLoader,MeshBuilder,StandardMaterial,Color3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {addBattleLifeVisuals} from '../../packages/combat-assets/battle-life.mjs';
import {createSpectatorCamera,spectatorText} from '../../apps/web/spectator-camera.mjs';
import {createLighting,styleCharacter} from '../../apps/web/lighting.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';

const data=async url=>{const r=await fetch(url);if(!r.ok)throw Error(url+': '+r.status);return r.json();};
const canvas=document.querySelector('#life-arena'),scene=new Scene(new Engine(canvas,true,{alpha:false,preserveDrawingBuffer:true})),engine=scene.getEngine();
scene.useRightHandedSystem=true;scene.clearColor=new Color4(.035,.055,.09,1);
const camera=new FreeCamera('display-camera',new Vector3(0,3,18),scene);camera.setTarget(new Vector3(0,1,0));createLighting(scene);
const floor=MeshBuilder.CreateGround('display-ground',{width:100,height:20},scene),floorMaterial=new StandardMaterial('floor',scene);
floorMaterial.diffuseColor=new Color3(.075,.11,.16);floorMaterial.specularColor=Color3.Black();floor.material=floorMaterial;
const life=await data('/assets/battle-life/fx/index.json'),index=addBattleLifeVisuals({schemaVersion:1,referenceVersion:life.referenceVersion,templates:{}},life);
const assets=new Map(),loadingAssets=new Map(),control=document.querySelector('#life-controls'),status=document.querySelector('#life-status'),measurements=document.querySelector('#life-measurements');
const containers=new Map();
function loadContainer(base,file){const url=new URL(base+file,location.href).href;
  if(!containers.has(url))containers.set(url,SceneLoader.LoadAssetContainerAsync(new URL('.',url).href,new URL(url).pathname.split('/').pop(),scene));
  return containers.get(url);
}
const spectator=createSpectatorCamera({random:()=>.75});
let current=null,state=null,scenario='respawn',elapsed=.3,eventId=0,generation=0,preparing=true;
async function load(id){
  if(assets.has(id))return assets.get(id);
  if(loadingAssets.has(id))return loadingAssets.get(id);
  const pending=buildAssets(id).finally(()=>loadingAssets.delete(id));loadingAssets.set(id,pending);return pending;
}
async function buildAssets(id){
  const base='/assets/'+id.toLowerCase()+'/',profile=getProfessionProfile(id),manifest=await data(base+'manifest.json');
  const [container,rawPose]=await Promise.all([loadContainer(base,manifest.runtimeGlb??manifest.glb),data(base+manifest.runtimePose)]);
  const pose=composeCharacterPose(rawPose,rawPose.sharedPose?await data(base+rawPose.sharedPose):null);
  if(manifest.sharedCharacterAnimations?.clips.length)installSharedCharacterAnimations(container,
    await loadContainer(base,manifest.sharedCharacterAnimations.glb),manifest.sharedCharacterAnimations.clips);
  const effectIndex=mergeEffectIndexes({templates:{}},index),effectPoses=Object.fromEntries(await Promise.all([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(async file=>[file,await data(base+file)])));
  const samplers=createNativeSamplers({characterPose:pose,effectIndex,effectPoses,profile});
  const models=Array.from({length:6},(_,i)=>{const v=createActorView(container,scene,id+'-'+i,.01,pose);styleCharacter(v);v.root.setEnabled(false);return v;});
  const fx=await createEffectsView({scene,engine,index,profile,samplers,effectPoses,loadout:[],assetBase:base,effectQuality:FULL_EFFECT_QUALITY});
  const value={profile,models,fx};assets.set(id,value);return value;
}
function actors(id){return Array.from({length:6},(_,i)=>({id:'display-'+i,nickname:['Player','Ally A','Ally B','Opponent A','Opponent B','Opponent C'][i],professionId:id,
  team:i<3?0:1,hp:100,x:i*800,y:0,z:0,facing:1,state:'idle',stateSerial:1,animationName:'Wait',animationTime:0,animationLoop:true,buffs:[],guild:{heroSacrificeFired:false},awakening:{remaining:0}}));}
function draw(){
  const watch=spectator.update({actors:state.actors,players:state.actors,localId:'display-0',enabled:scenario.startsWith('watch-')});
  if(watch.tracking){const target=state.actors.find(a=>a.id===watch.targetId),x=(target?.x??0)*.01;camera.position.set(x,3,18);camera.setTarget(new Vector3(x,1,0));}
  for(let i=0;i<state.actors.length;i++){
    const actor=state.actors[i],view=current.models[i];view.root.setEnabled(!actor.hidden);placeActor(view,actor,.01);
    const p=actor.pvpPresentation;sampleAnimation(view,p?.animationName??actor.animationName,p?.time??actor.animationTime,p?.loop??actor.animationLoop);
  }
  current.fx.render({actors:state.actors});scene.render();
  status.textContent=scenario.startsWith('watch-')?spectatorText(watch):({respawn:'Respawn circle',hero:'Hero’s Sacrifice',chance:'Counterattack · Original hand lightning'})[scenario]+' · '+elapsed.toFixed(2)+' s';
  const value={evidenceClass:'simulation-browser-display-fixture',originalClientMeasured:false,profession:state.actors[0].professionId,scenario,elapsed,
    spectator:watch,camera:camera.position.asArray(),battleLife:current.fx.proof().battleLife,textures:current.fx.proof().textureStatus,activeParticles:current.fx.count};
  measurements.textContent=JSON.stringify(value,null,2);measurements.dataset.metrics=JSON.stringify(value);document.querySelector('#life-ready').textContent='Source models, textures and production effects loaded';
}
async function prepare(){
  const epoch=++generation;
  preparing=true;
  delete measurements.dataset.metrics;document.querySelector('#life-ready').textContent='Loading source models and effects…';
  for(const a of assets.values()){a.fx.clear();for(const m of a.models)m.root.setEnabled(false);}
  const values=new FormData(control),id=values.get('profession'),mode=values.get('scenario'),seconds=Number(values.get('time'));
  const loaded=await load(id);if(epoch!==generation)return;
  scenario=mode;elapsed=seconds;current=loaded;state={actors:actors(id),effects:[]};spectator.reset();
  current.fx.clear();
  if(!scenario.startsWith('watch-'))for(const a of state.actors.slice(1))a.hidden=true;
  const actor=state.actors[0];
  if(scenario==='respawn'){
    const native=current.profile.states.ESSI_START_INTRUDE;
    actor.pvpPresentation={state:id==='LK'?'ESSI_START_INTRUDE':'RSI_START_INTRUDE',animationName:native?.animationName??'RespawnLanding',time:0,loop:false};
    current.fx.event({type:'respawn',playerId:actor.id,eventId:++eventId},state);
  }else if(scenario==='hero'){
    actor.hp=0;actor.state=id==='LK'?'ESSI_DIE_FRONT':'RSI_DIE_FRONT';actor.animationName=current.profile.states[actor.state]?.animationName??'DamageDownFront';actor.animationTime=1.12;actor.animationLoop=false;
    actor.guild.heroSacrificeFired=true;current.fx.event({type:'guildHeroSacrifice',actorId:actor.id,eventId:++eventId},state);
  }else if(scenario==='chance')actor.buffs=[{templateId:57,elapsed:0,finalizers:[{kind:'time',remaining:30},{kind:'hit',remaining:15}]}];
  else{
    // The UI input represents the user's requested camera cases, not damage.
    spectator.update({actors:state.actors,players:state.actors,localId:actor.id});camera.position.set(0,3,18);camera.setTarget(new Vector3(0,1,0));actor.hp=0;
    if(scenario==='watch-enemy'||scenario==='watch-hold')for(const a of state.actors.slice(1,3))a.hp=0;
    if(scenario==='watch-hold')for(const a of state.actors)a.hp=0;
  }
  await current.fx.prewarmActors(state.actors,{targetActors:state.actors});await scene.whenReadyAsync();
  if(epoch!==generation)return;
  if(!scenario.startsWith('watch-'))for(let t=0;t<elapsed-1e-9;){const dt=Math.min(1/60,elapsed-t);t+=dt;
    if(actor.pvpPresentation)actor.pvpPresentation.time=t;else if(scenario==='hero')actor.animationTime=1.12+t*.5;else actor.animationTime=t;
    current.fx.step(dt,state);
  }
  preparing=false;draw();
}
control.addEventListener('change',()=>prepare().catch(error=>{document.querySelector('#life-ready').textContent=error.stack;}));
addEventListener('keydown',event=>{if(preparing||!scenario.startsWith('watch-')||!['KeyZ','KeyX'].includes(event.code)||event.target.matches('input,select'))return;
  event.preventDefault();if(!event.repeat)spectator.cycle(event.code==='KeyZ'?-1:1);draw();});
new ResizeObserver(()=>{engine.resize();if(current&&state&&!preparing)draw();}).observe(canvas);
await prepare();
