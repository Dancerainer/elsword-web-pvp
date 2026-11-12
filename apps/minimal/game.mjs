import {Engine,Scene,Color4,Vector3,FreeCamera,TransformNode,SceneLoader} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {createActorView,sampleAnimation,placeActor} from '../web/actor-presentation.mjs';
import {createLighting,styleCharacter} from '../web/lighting.mjs';
import {createInputStepClock} from '../web/input-step-clock.mjs';
import {createExperiment} from '../../packages/minimal-runtime/experiment.mjs';
const $=s=>document.querySelector(s);
$('#app').innerHTML=`<main><header><div><small>ELSWORD 2016 · RF Experiment 01</small><h1>Input and movement inspector</h1></div><select id="mode" aria-label="Simulation mode"><option value="source">Reference input and movement</option><option value="baseline">Baseline (v13) input and movement</option></select></header>
<section class="stage"><canvas id="arena" tabindex="0" aria-label="RF experiment arena"></canvas><div id="loading">Loading map and character…</div><div class="badges"><span id="mode-label">Reference</span><span>2016 client measurements pending</span></div><div class="gauges"><span id="player-hp"></span><span id="target-hp"></span></div></section>
<nav><button id="reset">Reset</button><button id="pause">Pause</button><button id="step">Advance one frame</button><button id="retaliate">Trigger target attack</button><button id="export">Export trace</button></nav>
<p class="help">Click the arena to play. Use ← → to move, double-tap to dash, ↑ to jump, ↓ to drop and Z for a ground attack. Changing modes restarts the experiment.</p>
<section class="readouts"><article><h2>Current input and state</h2><pre id="state"></pre></article><article><h2>Experiment scope</h2><p>Both modes use the same character, map and stats to compare input sampling and six movement states. Try ground Z attacks and hit reactions here.</p><p>Keyboard input and six movement events use the V5 C++ reference. Physics, state transitions and damage use the candidate implementation. Comparisons with the target 2016 client are pending.</p><p>The experiment includes character animation and map collision. Hit effects and audio are pending.</p></article></section></main>`;
const canvas=$('#arena'),engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
const scene=new Scene(engine);scene.clearColor=new Color4(.08,.1,.14,1);createLighting(scene);
const camera=new FreeCamera('camera',new Vector3(0,30,-12),scene);camera.minZ=.1;camera.maxZ=200;camera.fov=.65;
const json=async p=>{const r=await fetch('/assets/'+p);if(!r.ok)throw Error(p+': '+r.status);return r.json();};
const binary=async p=>{const r=await fetch('/assets/'+p);if(!r.ok)throw Error(p+': '+r.status);return r.arrayBuffer();};
let experiment,views=[],paused=false,targetAttack=false,lastPacket={},busy=true;
const clock=createInputStepClock(),physical=new Set();let origin=performance.now();
function resetClock(){origin=performance.now();clock.rebase(origin/1000);physical.clear();}
const keyMap={ArrowLeft:'LEFT',ArrowRight:'RIGHT',ArrowUp:'UP',ArrowDown:'DOWN',KeyZ:'Z'};
function release(){if(!experiment)return;const now=performance.now()-origin;for(const key of physical)experiment.enqueue(key,false,now);physical.clear();}
canvas.addEventListener('keydown',e=>{const k=keyMap[e.code];if(!k)return;e.preventDefault();if(paused||busy||e.repeat||physical.has(k))return;physical.add(k);experiment.enqueue(k,true,performance.now()-origin);});
canvas.addEventListener('keyup',e=>{const k=keyMap[e.code];if(!k)return;e.preventDefault();if(physical.delete(k))experiment.enqueue(k,false,performance.now()-origin);});
canvas.addEventListener('blur',release);window.addEventListener('blur',release);
canvas.addEventListener('pointerdown',()=>canvas.focus());
async function restart(){busy=true;release();$('#loading').hidden=false;$('#loading').textContent='Initializing comparison…';
 try{experiment=await createExperiment({json,binary,mode:$('#mode').value});lastPacket={};targetAttack=false;paused=false;$('#pause').textContent='Pause';resetClock();
 $('#mode-label').textContent=experiment.mode==='source'?'Reference · C++ input':'Baseline · v13 input';
 $('#loading').hidden=true;busy=false;canvas.focus();}
 catch(e){$('#loading').textContent=e.message;throw e;}}
$('#reset').onclick=restart;$('#mode').onchange=restart;
$('#pause').onclick=()=>{release();paused=!paused;$('#pause').textContent=paused?'Resume':'Pause';clock.rebase(performance.now()/1000);};
function advance(time){const r=experiment.step(time,{targetAttack});targetAttack=false;lastPacket=r.packet;}
$('#step').onclick=()=>{if(!busy){paused=true;$('#pause').textContent='Resume';advance(performance.now()-origin);}};
$('#retaliate').onclick=()=>{targetAttack=true;canvas.focus();};
$('#export').onclick=()=>{if(!experiment)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(experiment.trace())],{type:'application/json'}));a.href=url;a.download='rf-minimal-'+experiment.mode+'-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
try{
 await restart();
 const env=await SceneLoader.LoadAssetContainerAsync('/assets/scene/sander-garpai-rock-pvp/','scene.glb',scene);
 const root=new TransformNode('map',scene);root.scaling.setAll(.01);env.addAllToScene();for(const node of env.rootNodes)node.parent=root;
 const body=await SceneLoader.LoadAssetContainerAsync('/assets/rf/','rf-runtime.glb',scene);
 views=experiment.sim.state.actors.map(a=>{const view=createActorView(body,scene,a.id,.01,experiment.characterPose);styleCharacter(view);return view;});
 resetClock();
 engine.runRenderLoop(()=>{if(busy)return;try{
   const batch=clock.advance(performance.now()/1000,{paused});
   for(const cutoff of batch.cutoffs)advance(Math.max(0,cutoff*1000-origin));
   const actors=experiment.sim.state.actors;
   for(let i=0;i<actors.length;i++){const a=actors[i];sampleAnimation(views[i],a.animationName,a.animationTime,a.animationLoop,a.presentationTransition);placeActor(views[i],a);}
   const a=actors[0];camera.position.set(a.x*.01,a.y*.01+2.9,-12);camera.setTarget(new Vector3(a.x*.01,a.y*.01+1,0));
   $('#player-hp').textContent='RF  '+Math.round(a.hp)+' / '+a.hpMax;$('#target-hp').textContent='Mirror  '+Math.round(actors[1].hp)+' / '+actors[1].hpMax;
   $('#state').textContent=`Frame ${experiment.sim.state.step}   State ${a.state}\nPosition ${a.x.toFixed(2)}, ${a.y.toFixed(2)}   ${a.grounded?'grounded':'airborne'}\nHeld ${(lastPacket.held??[]).join(' ')||'—'}   Pressed ${(lastPacket.pressed??[]).join(' ')||'—'}\nDouble tap ${lastPacket.pureDoubleLeft?'left':lastPacket.pureDoubleRight?'right':'—'}`;
   scene.render();
 }catch(e){busy=true;$('#loading').hidden=false;$('#loading').textContent='Experiment stopped:'+e.message;console.error(e);}});
 window.rfMinimal={snapshot:()=>experiment.sim.snapshot(),trace:()=>experiment.trace(),mode:()=>experiment.mode};
 window.addEventListener('resize',()=>engine.resize());engine.resize();
}catch(e){busy=true;$('#loading').hidden=false;$('#loading').textContent='Loading failed:'+e.message;console.error(e);}
