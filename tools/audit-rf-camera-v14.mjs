import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {instantiateNativeCamera} from '../packages/native-source/camera.mjs';
import {normalTrackingPoints} from '../apps/web/camera-policy.mjs';
import {advanceNormalCamera} from '../apps/web/camera-follow.mjs';
import {createActorRenderClock} from '../apps/web/actor-render-clock.mjs';
import {createInputStepClock} from '../apps/web/input-step-clock.mjs';

const wasm=readFileSync(new URL('../artifacts/native/camera.wasm',import.meta.url));
const preset=JSON.parse(readFileSync(new URL('../config/rf-preset.json',import.meta.url)));
const dimensions={width:1280,height:720,verticalFovRadians:Math.PI/4};
const fixedSeconds=1/60;
const speed=725*(1+(preset.attributes.moveSpeedMultiplier-1)*.5);
const policy=preset.cameraAdapter;
const normalPoints=a=>normalTrackingPoints({position:[a.x,a.y,a.z],facing:a.facing,
  yRotationDegrees:a.facing>0?0:180,dirVector:[1,0,0],land:2000},policy);
const actor=(x=0)=>({id:'RF',x,y:2840,z:0,facing:1,state:'RSI_DASH',stateSerial:1,
  animationName:'Dash',animationTime:0,animationTransitionSerial:1});
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=a=>{const length=Math.hypot(...a);return a.map(x=>x/length);};

/** Independent analytical perspective projection, native LH/Y-up.
 * Only used to quantify candidate traces; it is not a D3D rasterization claim.
 */
function horizontalPixel(point,camera){
  const forward=normalized(sub(camera.target,camera.eye));
  const right=normalized(cross(camera.up,forward));
  const offset=sub(point,camera.eye),depth=dot(offset,forward);
  return dimensions.width/2+dot(offset,right)*dimensions.height/(2*Math.tan(dimensions.verticalFovRadians/2)*depth);
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const deviation=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)));};
const differences=a=>a.slice(1).map((x,i)=>x-a[i]);
const maxAbs=a=>Math.max(...a.map(Math.abs));

function previousV13(bridge,points,dt,previous){
  if(!previous)return bridge.init(points);
  bridge.setTracking({...points,eyeSeconds:policy.trackingSeconds,targetSeconds:policy.targetTrackingSeconds});
  const state=bridge.advance(dt);
  return bridge.point({eye:[points.eye[0],state.eye[1],state.eye[2]],
    target:[points.target[0],state.target[1],state.target[2]],up:state.up});
}
function originalNative(bridge,points,dt,previous){
  if(!previous)return bridge.init(points);
  bridge.setTracking({...points,eyeSeconds:.3,targetSeconds:0});
  return bridge.advance(dt);
}

async function measure(hz){
  const bridges=await Promise.all(Array.from({length:4},()=>instantiateNativeCamera(wasm)));
  const versions=['v12Native','v13Direct','v14Native','currentInsteadOfShownDiagnostic'];
  const states=Array(4).fill(null),frames=[];
  const display=createActorRenderClock(),packets=createInputStepClock();
  let current=actor(),tick=0;display.reset([current]);packets.rebase(0);
  for(let frame=0;frame<=hz*4;frame++){
    const time=frame/hz,{dt,cutoffs,alpha}=packets.advance(time);
    for(const cutoff of cutoffs){tick++;current=actor(speed*cutoff);current.animationTime=tick*fixedSeconds*1.3;display.push([current]);}
    const shown=display.sample([current],alpha)[0],points=normalPoints(shown);
    states[0]=originalNative(bridges[0],points,dt,states[0]);
    states[1]=previousV13(bridges[1],points,dt,states[1]);
    states[2]=advanceNormalCamera(bridges[2],points,policy,dt,states[2]);
    states[3]=originalNative(bridges[3],normalPoints(current),dt,states[3]);
    assert.deepEqual(states[2],states[0],'v14 must retain the entire native state, not just coordinates');
    frames.push({time,dt,tick,alpha,currentX:current.x,shownX:shown.x,
      cameras:Object.fromEntries(versions.map((version,i)=>[version,{
        eye:states[i].eye,target:states[i].target,eyeSeconds:states[i].eyeSeconds,
        actorCenterOffsetPixels:horizontalPixel([shown.x,shown.y+100,shown.z],states[i])-dimensions.width/2,
        backgroundX:horizontalPixel([0,2940,0],states[i]),lagNative:shown.x-states[i].target[0]}]))});
  }
  const steady=frames.filter(f=>f.time>=3),metrics={};
  for(const version of versions){
    const values=steady.map(f=>f.cameras[version]),delta=differences(values.map(v=>v.backgroundX));
    metrics[version]={meanActorCenterOffsetPixels:mean(values.map(v=>v.actorCenterOffsetPixels)),
      actorCenterOffsetStdPixels:deviation(values.map(v=>v.actorCenterOffsetPixels)),
      backgroundFrameDeltaStdPixels:deviation(delta),backgroundFrameDeltaMaxPixels:maxAbs(delta),
      meanLagNative:mean(values.map(v=>v.lagNative))};
  }
  assert.deepEqual(metrics.v14Native,metrics.v12Native);
  const expectedLag=speed*(.3-1/hz);
  assert.ok(Math.abs(metrics.v14Native.meanLagNative-expectedLag)<.1,
    'steady native lag agrees with the independently derived v*(Time-dt), within float accumulation');
  if(hz>60)assert.ok(metrics.currentInsteadOfShownDiagnostic.actorCenterOffsetStdPixels>
    metrics.v14Native.actorCenterOffsetStdPixels*10,'reading current would leave a measurable tick oscillation');
  return {hz,metrics,frames};
}

async function impulse(hz){
  const bridges=await Promise.all([instantiateNativeCamera(wasm),instantiateNativeCamera(wasm)]);
  const initial=normalPoints(actor());let v13=bridges[0].init(initial),v14=bridges[1].init(initial);
  const background=[0,2940,0],before13=horizontalPixel(background,v13),before14=horizontalPixel(background,v14);
  const points=normalPoints(actor(100));
  v13=previousV13(bridges[0],points,1/hz,v13);v14=advanceNormalCamera(bridges[1],points,policy,1/hz,v14);
  assert.equal(v13.target[0],100);assert.equal(v13.eyeSeconds,0);
  assert.equal(v14.target[0],Math.fround(Math.fround(100/Math.fround(.3))*Math.fround(1/hz)));
  return {hz,impulseNative:100,v13BackgroundFirstFramePixels:horizontalPixel(background,v13)-before13,
    v14BackgroundFirstFramePixels:horizontalPixel(background,v14)-before14,
    v13TrackingSeconds:v13.eyeSeconds,v14TrackingSeconds:v14.eyeSeconds};
}

export async function auditCamera(){
  assert.equal(policy.horizontalFollow,'nativeTracking');
  const trajectories=await Promise.all([60,90,120,144,165].map(measure));
  const impulses=await Promise.all([60,90,120,144,165].map(impulse));
  const source=readFileSync(new URL('../apps/web/game.mjs',import.meta.url),'utf8');
  assert.match(source,/const fixedActors=actorRenderClock\.sample\(actualActors,alpha,/);
  assert.match(source,/const actors=shownActors=ownsLocalUnit\(\)\?remoteActorClock\.sample\(fixedActors,localPlayerId,\{now,exact:paused\|\|motionInspector\.active\}\):fixedActors/);
  assert.match(source,/for\(const actor of actors\)renderActor\(actor,/);
  assert.match(source,/updateCamera\(paused\?0:dt,actors\[0\]\)/);
  const report={schema:'rf-camera-display-audit-v14',evidenceClass:'simulation-implementation/synthetic-display-trajectories',
    targetClientMeasured:false,sourceContract:'contracts/rf-camera-source-v14.json',
    cameraModuleSha256:createHash('sha256').update(wasm).digest('hex'),fixedSeconds,dimensions,
    speedNativePerSecond:speed,speedEvidence:'725 fixed V5 run speed; user30% FinalOption/0.5 source candidate',
    sameDisplayedActorWiring:true,sourceNativeStatesExactlyEqual:true,
    rows:trajectories.map(({hz,metrics})=>({hz,metrics})),impulses,
    privateArtifacts:[{file:'artifacts/proof-camera-v14/synthetic-trajectories.json',
      sha256:createHash('sha256').update(JSON.stringify(trajectories)+'\n').digest('hex'),
      bytes:Buffer.byteLength(JSON.stringify(trajectories)+'\n')}],
    limitations:['Synthetic motion is not a target2016 input trace','Analytical projection does not prove D3D rasterization',
      'Original .3s follow intentionally leaves speed-dependent lag; no new center offset or tracking constant added']};
  return {report,trajectories};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {report,trajectories}=await auditCamera();
  const folder=new URL('../artifacts/proof-camera-v14/',import.meta.url);mkdirSync(folder,{recursive:true});
  writeFileSync(new URL('synthetic-trajectories.json',folder),JSON.stringify(trajectories)+'\n');
  writeFileSync(new URL('../reports/rf-camera-display-v14.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({rows:report.rows.map(r=>({hz:r.hz,...r.metrics.v14Native})),impulses:report.impulses}));
}
