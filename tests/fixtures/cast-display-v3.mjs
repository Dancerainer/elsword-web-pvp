/** Interactive GPU fixture of production casting renderer and original poses.
 * Explicit display state inputs; not an original-client replay or hit golden. */
import {Engine,Scene,FreeCamera,Vector3,Color4,SceneLoader} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {addCastDisplayVisuals} from '../../packages/combat-assets/cast-display.mjs';
import {createLighting,styleCharacter} from '../../apps/web/lighting.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const data=async url=>{const r=await fetch(url);if(!r.ok)throw Error(url+': '+r.status);return r.json();};
const engine=new Engine(document.querySelector('canvas'),true,{alpha:false,preserveDrawingBuffer:true}),scene=new Scene(engine);
scene.useRightHandedSystem=true;scene.clearColor=new Color4(.035,.055,.09,1);createLighting(scene);
const camera=new FreeCamera('cast-camera',new Vector3(0,2,12),scene);camera.setTarget(new Vector3(0,1,0));
const cast=await data('/assets/cast-display/fx/index.json'),cache=new Map();let current=null,state=null,generation=0;
async function load(id){
 if(cache.has(id))return cache.get(id);
 const base='/assets/'+id.toLowerCase()+'/',manifest=await data(base+'manifest.json'),profile=getProfessionProfile(id);
 const container=await SceneLoader.LoadAssetContainerAsync(base,manifest.runtimeGlb??manifest.glb,scene),raw=await data(base+manifest.runtimePose);
 const pose=composeCharacterPose(raw,raw.sharedPose?await data(base+raw.sharedPose):null);
 if(manifest.sharedCharacterAnimations?.clips.length)installSharedCharacterAnimations(container,
  await SceneLoader.LoadAssetContainerAsync(base,manifest.sharedCharacterAnimations.glb,scene),manifest.sharedCharacterAnimations.clips);
 const family=await data(id==='RF'||id==='VC'||id==='BM'?'/assets/rf/awakening-fx/index.json':'/assets/lk/fx/index.json');
 const templates=Object.fromEntries(Object.entries(family.templates).filter(([name])=>/^HyperBoost(?:Right|Left)(?:Black)?$/.test(name)));
 const index=addCastDisplayVisuals({schemaVersion:1,referenceVersion:cast.referenceVersion,templates},cast);
 // These aura texture paths are RF/LK relative; rebase to their actual family.
 for(const t of Object.values(index.templates))if(/^HyperBoost/.test(t.name))for(const texture of Object.values(t.textures??{}))texture.file='../'+(['RF','VC','BM'].includes(id)?'rf/':'lk/')+texture.file;
 const effectIndex=mergeEffectIndexes({templates:{}},index),samplers=createNativeSamplers({profile,characterPose:pose,effectIndex,effectPoses:{}});
 const model=createActorView(container,scene,id+'-cast',.01,pose);styleCharacter(model);model.root.setEnabled(false);
 const fx=await createEffectsView({scene,engine,index,profile,samplers,effectPoses:{},loadout:[],assetBase:base,effectQuality:FULL_EFFECT_QUALITY});
 await fx.prewarmResources([]);const value={profile,model,fx};cache.set(id,value);return value;
}
async function prepare(){
 const epoch=++generation,form=new FormData(document.querySelector('form')),id=form.get('profession'),mode=form.get('scenario'),facing=Number(form.get('facing')),seconds=Number(form.get('time'));
 document.querySelector('#ready').textContent='Loading source models and production renderer…';delete document.querySelector('output').dataset.metrics;
 for(const v of cache.values()){v.model.root.setEnabled(false);v.fx.clear();}
 const value=await load(id);if(epoch!==generation)return;current=value;
 const rows=cast.professions[id].states,name=mode==='awakening'?(['RF','VC','BM'].includes(id)?'RSI_HYPER_MODE':'ESSI_HYPER_MODE'):Object.keys(rows).find(n=>rows[n].lightTimes.length);
 const actor={id:'cast',professionId:id,state:name,stateSerial:1,hp:100,x:0,y:0,z:0,landPosition:[0,0,0],facing,animationName:value.profile.states[name].animationName,animationTime:0,animationLoop:false,awakening:{remaining:mode==='awake-skill'?20:0}};
 state={actors:[actor],effects:[]};value.fx.step(0,state);
 for(let i=0;i<Math.ceil(seconds*120);i++){const dt=Math.min(1/120,seconds-i/120);actor.animationTime+=dt;value.fx.step(dt,state);}
 value.model.root.setEnabled(true);placeActor(value.model,actor,.01);sampleAnimation(value.model,actor.animationName,actor.animationTime,false);
 value.fx.render({actors:state.actors});scene.render();
 const metrics={profession:id,scenario:mode,facing,time:seconds,casting:value.fx.proof().castDisplay,textureStatus:value.fx.proof().textureStatus,activeParticles:value.fx.count,evidenceClass:'web-GPU-display-fixture',originalClientMeasured:false};
 document.querySelector('output').textContent=JSON.stringify(metrics,null,2);document.querySelector('output').dataset.metrics=JSON.stringify(metrics);document.querySelector('#ready').textContent='Production renderer ready';
}
document.querySelector('form').addEventListener('change',()=>prepare().catch(error=>document.querySelector('#ready').textContent=error.stack));
engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());await prepare();
