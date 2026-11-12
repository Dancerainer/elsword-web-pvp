import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {createPoseLibrary,samplePose,compose,transform} from '../../tools/assets/character/sample_pose.mjs';

const identity=compose([0,0,0],[1,1,1],[0,0,0,1]);
const channel=(a,b)=>({times:[0,1],values:[a,b]});
const track=(name,x)=>({frame_name:name,translation:channel([x,2,3],[x+10,5,8]),scale:channel([1,1,1],[2,1,1]),rotation:channel([0,0,0,1],[0,0,0,1])});
const pose={schemaVersion:1,frames:[{name:'Bip01',parent:null,nativeRowMatrix:identity},
  {name:'COLLISION_SPHERE1_body',parent:0,nativeRowMatrix:identity},{name:'ATTACK_SPHERE1_hand',parent:0,nativeRowMatrix:identity}],
  helpers:[{name:'COLLISION_SPHERE1_body',nativeStoredBoundingRadius:7},{name:'ATTACK_SPHERE1_hand',nativeStoredBoundingRadius:3}],
  clips:[{name:'idle',durationSeconds:1,tracks:[track('Bip01',4),track('COLLISION_SPHERE1_body',5),track('ATTACK_SPHERE1_hand',9)]},
    {name:'other',durationSeconds:1,tracks:[track('Bip01',40),track('ATTACK_SPHERE1_hand',19)]}]};
const template={name:'mesh',poseData:'mesh.json',initialAnimation:{name:'idle',playback:'XAP_ONE'},initialSize:[1,1,1],initialVelocity:[0,0,0],events:[]};
const make=()=>createNativeSamplers({characterPose:pose,effectIndex:{templates:{mesh:template}},effectPoses:{'mesh.json':pose},profile:{target:{}}});
const actor=(id='a')=>({id,x:10,y:20,z:30,facing:1,animationName:'idle',animationTime:0,animationLoop:false});

test('private character storage preserves source matrices, transitions and independent returned contact shapes',()=>{
  const s=make(),a=actor(),library=createPoseLibrary(pose),saved=[];
  for(const facing of [1,-1])for(const time of [0,.125,.5,1])for(const clear of [true,false]){
    Object.assign(a,{facing,animationTime:time,consumeRootTranslation:clear});
    const reference=samplePose(library,'idle',time,{worldMatrix:compose([10,20,30],[1,1,1],facing===1?[0,0,0,1]:[0,1,0,0]),rootTranslationOverride:clear?[0,null,0]:null});
    const shape=s.defenderSampler(a)[0],matrix=reference.get('COLLISION_SPHERE1_body');
    assert.deepEqual(shape.center,transform(matrix,[0,0,0]));assert.equal(shape.radius,7*Math.hypot(...matrix.slice(0,3)));
    saved.push({shape,value:structuredClone(shape)});
  }
  a.animationName='other';a.animationTime=.3;a.presentationTransition={enabled:true,durationSeconds:1,elapsedSeconds:.5,fromName:'idle',fromTime:.1,fromSpeed:1,fromLoop:false};
  const previous=s.defenderSampler(a);a.presentationTransition.elapsedSeconds=.75;
  assert.notDeepEqual(s.defenderSampler(a),previous,'old-track clock and weight invalidate the pose');
  const before=s.actorSamplingStats();s.collisionSampler(a);s.defenderSampler(a);
  assert.equal(s.actorSamplingStats().evaluations,before.evaluations);assert.equal(s.actorSamplingStats().reused,before.reused+2);
  assert.equal(s.actorSamplingStats().buffers,1,'one buffer despite many source clocks');
  const b=actor('b');b.x=800;s.defenderSampler(b);assert.equal(s.actorSamplingStats().buffers,2);
  for(const {shape,value}of saved)assert.deepEqual(shape,value,'later sampling cannot mutate a previously returned shape');
});

test('effect bone matrices and traced actor anchors remain independent across cache hits and future clocks',()=>{
  const s=make(),a=actor(),e={name:'mesh',definition:{},elapsed:0,animationTime:0,birthAnchor:{position:[0,0,0],facing:1,rotation:[0,0,0]}};
  const first=s.effectBoneMatrixSampler(e,a,'ATTACK_SPHERE1_hand'),saved=[...first];
  first[12]=999;assert.deepEqual(s.effectBoneMatrixSampler(e,a,'ATTACK_SPHERE1_hand'),saved,'public outputs do not mutate the cache');
  const held=s.effectBoneMatrixSampler(e,a,'ATTACK_SPHERE1_hand');e.animationTime=.5;e.birthAnchor.position[0]=20;
  const next=s.effectBoneMatrixSampler(e,a,'ATTACK_SPHERE1_hand');assert.notDeepEqual(next,held);assert.deepEqual(held,saved);
  const anchor=s.effectAnchorSampler({definition:{BONE_NAME:'ATTACK_SPHERE1_hand',TRACE_MATRIX:1}},a),old=structuredClone(anchor);
  a.x=400;a.animationTime=.75;s.defenderSampler(a);assert.deepEqual(anchor,old,'a persisted effect birth anchor is never a borrowed matrix');
  const second={...e,birthAnchor:{...e.birthAnchor,position:[1000,0,0]}};
  s.effectBoneMatrixSampler(second,a,'ATTACK_SPHERE1_hand');assert.deepEqual(s.effectBoneMatrixSampler(e,a,'ATTACK_SPHERE1_hand'),next);
});
