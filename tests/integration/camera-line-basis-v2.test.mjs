import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authoredLineBasis,normalTrackingActorPoints} from '../../apps/web/camera-line-basis.mjs';
import {normalTrackingPoints} from '../../apps/web/camera-policy.mjs';
import {advanceNormalCamera} from '../../apps/web/camera-follow.mjs';
import {instantiateNativeCamera} from '../../packages/native-source/camera.mjs';

const near=(actual,expected,epsilon=1e-9)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);
const line=(lineId,start,end)=>({lineId,start,end});
const actor=(overrides={})=>({x:50,y:500,z:20,facing:1,lineId:3,lastTouchLineId:3,...overrides});
const map={lines:[line(3,[0,500,0],[100,500,100]),line(4,[100,500,100],[200,500,100])]};
const land=0,policy={trackingSeconds:.3,targetTrackingSeconds:0};

test('normal camera rotates perpendicular to an authored diagonal in either facing direction',()=>{
  const right=authoredLineBasis(actor(),map),left=authoredLineBasis(actor({facing:-1}),map);
  near(right.yRotationDegrees,-45);near(left.yRotationDegrees,135);
  assert.deepEqual(right.dirVector,left.dirVector);
  near(right.rendererYawRadians,Math.PI/4);near(left.rendererYawRadians,-3*Math.PI/4);
  const a=normalTrackingActorPoints(actor(),map,land,policy),b=normalTrackingActorPoints(actor({facing:-1}),map,land,policy);
  for(let i=0;i<3;i++)near(a.eye[i],b.eye[i]);
  assert.deepEqual(a.target,b.target);
  const offset=a.eye.map((value,i)=>value-[50,500,20][i]);
  near(offset[0]*100+offset[2]*100,0,1e-7);
  near(Math.hypot(offset[0],offset[2]),1500);
});

test('airborne actor retains its remembered authored lane and source eye/look offsets use that 3D direction',()=>{
  const slopedMap={lines:[line(3,[0,400,0],[100,450,-100])]};
  const airborne=actor({lineId:null,y:700});
  const basis=authoredLineBasis(airborne,slopedMap);
  near(basis.yRotationDegrees,45);near(basis.dirVector[1],1/3);
  const points=normalTrackingActorPoints(airborne,slopedMap,0,{...policy,eyeDistance:60,lookDistance:30});
  near(points.target[0],70);near(points.target[1],810);near(points.target[2],0);
  near(points.eye[0],50-1500/Math.sqrt(2)+40);near(points.eye[1],920);near(points.eye[2],20-1500/Math.sqrt(2)-40);
});

test('crossing an actual remembered lane changes desired camera orientation while keeping source tracking timers',async()=>{
  const bytes=await readFile(new URL('../../artifacts/native/camera.wasm',import.meta.url));
  const bridge=await instantiateNativeCamera(bytes);
  const before=normalTrackingActorPoints(actor(),map,land,policy);
  let tracked=advanceNormalCamera(bridge,before,policy,0,null);
  const nextActor=actor({x:150,z:100,lineId:4,lastTouchLineId:4});
  const desired=normalTrackingActorPoints(nextActor,map,land,policy);
  assert.deepEqual(desired.eye,[150,700,-1400]);
  tracked=advanceNormalCamera(bridge,desired,policy,1/60,tracked);
  assert.ok(tracked.eyeSeconds>0);assert.notEqual(tracked.eye[0],desired.eye[0]);
  assert.ok(tracked.eye[0]<before.eye[0]&&tracked.eye[0]>desired.eye[0]);
  for(let frame=0;frame<240;frame++)tracked=advanceNormalCamera(bridge,desired,policy,1/60,tracked);
  near(tracked.eye[0],150,.02);near(tracked.eye[2],-1400,.02);
});

test('flat map output keeps the existing normal camera in both facing directions',()=>{
  const straight={lines:[line(3,[0,500,20],[500,500,20])]};
  for(const facing of [-1,1]){
    const current=actor({facing});
    assert.deepEqual(normalTrackingActorPoints(current,straight,0,policy),normalTrackingPoints({position:[50,500,20],facing,
      yRotationDegrees:facing>0?0:180,dirVector:[1,0,0],land:0},policy));
  }
});

test('missing, zero, vertical and malformed map bases are explicit errors instead of a guessed straight road',()=>{
  assert.throws(()=>authoredLineBasis(actor({lineId:null,lastTouchLineId:null}),map),/saved original line/);
  for(const end of [[0,500,0],[0,600,0]])assert.throws(()=>authoredLineBasis(actor(),{lines:[line(3,[0,500,0],end)]}),/zero\/vertical/);
  assert.throws(()=>authoredLineBasis(actor(),{lines:[line(3,[0,500,0],[1,2,NaN])]}),/finite native vec3/);
  assert.throws(()=>authoredLineBasis(actor({facing:0}),map),/facing/);
});

test('all sixteen real map walking lines produce a perpendicular camera and facing-independent side',async t=>{
  const root=new URL('../../artifacts/scene/',import.meta.url),catalog=JSON.parse(await readFile(new URL('catalog.json',root)));
  assert.equal(catalog.maps.length,16);
  let walkingLines=0,turnedLines=0;
  for(const record of catalog.maps){
    const map=JSON.parse(await readFile(new URL(`${record.sceneId}/collision.json`,root)));
    for(const line of map.lines){
      const dx=line.end[0]-line.start[0],dz=line.end[2]-line.start[2];
      if(!Math.hypot(dx,dz)||/(?:LT_WALL|LT_MONSTER_ROAD)$/.test(line.type??''))continue;
      const current=actor({x:(line.start[0]+line.end[0])/2,y:Math.max(1000,(line.start[1]+line.end[1])/2),
        z:(line.start[2]+line.end[2])/2,lineId:line.lineId,lastTouchLineId:line.lineId});
      const points=normalTrackingActorPoints(current,map,0,policy),reverse=normalTrackingActorPoints({...current,facing:-1},map,0,policy);
      const offset=points.eye.map((value,i)=>value-[current.x,current.y,current.z][i]);
      near(offset[0]*dx+offset[2]*dz,0,1e-5);
      near(Math.hypot(offset[0],offset[2]),1500,1e-9);
      for(let i=0;i<3;i++)near(points.eye[i],reverse.eye[i],1e-9);
      walkingLines++;if(Math.abs(dz)>.001)turnedLines++;
    }
  }
  assert.ok(walkingLines>400);assert.ok(turnedLines>50);
  t.diagnostic(JSON.stringify({maps:catalog.maps.length,walkingLines,turnedLines,targetClientMeasured:false}));
});
