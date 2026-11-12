import test from 'node:test';
import assert from 'node:assert/strict';
import {createEffectRenderState,createEffectRenderOffsets,offsetEffectPosition} from '../../apps/web/effect-render-anchors.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {ARMAGEDDON_SET,ARMAGEDDON_SWORD} from '../../packages/combat-core/lk-effect-set-targets.mjs';

const template=(name,fields={})=>({name,kind:'particle',fields:{NumParticles:8,Lifetime:10,...fields},events:[],repeated:{},unsupported:[],textures:{}});
test('attachment correction follows source Trace semantics and preserves independent particles and clocks',()=>{
  const runtime=createEffectRuntime({index:{templates:{plain:template('plain'),traced:template('traced',{Trace:true})}}});
  const anchor=state=>state.actors[0].position,state={actors:[{position:[100,20,30]}]},shown={actors:[{position:[40,45,10]}]};
  const fixed={position:[100,20,30]},attached={...fixed,anchor,trace:true};
  const following=runtime.emitParticle('plain',attached);
  const templateFollowing=runtime.emitParticle('traced',{...fixed,anchor});
  const worldTrail=runtime.emitParticle('plain',{...fixed,anchor});
  const impact=runtime.emitParticle('traced',fixed);
  const controlled=runtime.emitParticle('traced',{...attached,sourceControl:()=>({position:[300,0,0],velocity:[0,0,0],nowLifeTime:0,animationTime:0})});
  const child=runtime.emitParticle('traced',{...fixed,parentParticleId:following.id});
  const worldChild=runtime.emitParticle('plain',{...fixed,parentParticleId:following.id});
  const before=[...runtime.particles.values()].map(p=>({id:p.id,position:[...p.position],age:p.age}));
  const offset=createEffectRenderOffsets(runtime,shown);
  for(const p of [following,templateFollowing,child])assert.deepEqual(offset(p),[-60,25,-20]);
  for(const p of [worldTrail,impact,controlled,worldChild])assert.equal(offset(p),null);
  assert.deepEqual(offsetEffectPosition(following.position,offset(following)),[40,45,10]);
  assert.deepEqual([...runtime.particles.values()].map(p=>({id:p.id,position:[...p.position],age:p.age})),before);
  assert.equal(createEffectRenderOffsets(runtime,null)(following),null);
  assert.equal(createEffectRenderOffsets(runtime,state)(following),null);
  runtime.emitters.get(following.emitterId).options.anchor=null;
  assert.equal(createEffectRenderOffsets(runtime,shown)(following),null,'detached AutoDie particles keep their source world position');
});

test('mesh follow uses a displayed anchor without changing its emitted position',()=>{
  const mesh={...template('mesh'),kind:'mesh',fields:{LifeType:'LT_TIME',LifeTime:2}};
  const runtime=createEffectRuntime({index:{templates:{mesh}}});
  const emitter=runtime.add('mesh',{position:[10,0,0],follow:true,anchor:()=>[20,0,0]});
  const particle=runtime.particles.get([...emitter.particles][0]);
  assert.deepEqual(createEffectRenderOffsets(runtime,{actors:[]})(particle),[10,0,0]);
  assert.deepEqual(particle.position,[10,0,0]);assert.equal(particle.age,0);
});

test('saved owner TRACE mesh output translates once while source phase, clocks and independent controls retain their values',()=>{
  const base={id:1,ownerId:'remote',damage:{},definition:{TRACE_MORE:1},elapsed:.2,animationTime:.1,
    sourcePosedAnchor:{position:[30,40,50],rotation:[0,180,0]},currentAnchor:{position:[35,40,50],rotation:[0,180,0]}};
  const independent=[{sourceTargetMeshId:12},{sourceArcHandle:1},{sourceShadowMesh:{}},{sourceSkillMeshControl:true},{sourceXCrashMeshClock:true}];
  const effects=[base,...independent.map((extra,i)=>({...base,...extra,id:i+2}))];
  const state={actors:[{id:'remote',x:100,y:20,z:0}],effects},before=structuredClone(state);
  const shown=[{id:'remote',x:40,y:45,z:10}],display=createEffectRenderState(state,shown);
  assert.deepEqual(display.effects[0].sourcePosedAnchor.position,[-30,65,60]);
  assert.deepEqual(display.effects[0].currentAnchor.position,[-25,65,60]);
  assert.deepEqual(display.effects[0].sourcePosedAnchor.rotation,[0,180,0]);
  assert.equal(display.effects[0].elapsed,.2);assert.equal(display.effects[0].animationTime,.1);
  for(let i=1;i<effects.length;i++)assert.strictEqual(display.effects[i],effects[i]);
  assert.deepEqual(state,before);assert.notStrictEqual(display.effects[0].sourcePosedAnchor,state.effects[0].sourcePosedAnchor);
  assert.equal(createEffectRenderState(state),null);
});

test('LK target-mesh children sample the displayed cast pose and keep dead-target tails frozen',()=>{
  const cast=(ownerId,id,dead=false)=>({id,ownerId,setName:ARMAGEDDON_SET,name:ARMAGEDDON_SWORD,
    sourceBoneEffectSetId:id,active:true,dead,elapsed:2,animationTime:1.8,
    definition:{TRACE_MATRIX:1,TRACE_USER_TARGET_FORCE:1,BONE_NAME:'Dummy1_Rhand'},
    currentAnchor:{position:[100,20,0],facing:1}});
  const child=(ownerId,id,target,bone)=>({id,ownerId,setName:ARMAGEDDON_SET,name:'ELK_ArmagedonBladeP01',
    sourceBoneEffectSetId:target,sourceBoneTargetMeshId:target,active:true,dead:false,elapsed:2,
    definition:{TRACE:1,...(bone?{BONE_NAME:bone}:{})},currentAnchor:{position:[110,20,0],facing:1}});
  const effects=[cast('remote',1),child('remote',2,1,'Dummy02'),child('remote',3,1),
    cast('other',4),child('other',5,4,'Dummy03'),cast('remote',6,true),child('remote',7,6,'Dummy02'),
    child('other',8,1,'Dummy02')];
  const state={actors:[{id:'remote',x:100,y:20,z:0,facing:1},{id:'other',x:200,y:30,z:0,facing:1}],effects};
  const before=structuredClone(state),calls=[];
  const actors=[{id:'remote',x:40,y:45,z:10,facing:-1},{id:'other',x:250,y:30,z:0,facing:1}];
  const samplers={effectAnchorSampler:(_,actor)=>({position:[actor.x,actor.y,actor.z],facing:actor.facing}),
    effectBoneSampler:(mesh,actor,bone)=>{calls.push([mesh.id,actor.id,bone,mesh.animationTime]);
      return [actor.x+(bone==='Dummy02'?10:20)*actor.facing,actor.y+5,actor.z];}};
  const display=createEffectRenderState(state,actors,samplers);
  assert.deepEqual(display.effects[1].currentAnchor.position,[30,50,10]);
  assert.deepEqual(display.effects[2].currentAnchor.position,[40,45,10],'mesh-origin child uses its displayed carrier');
  assert.deepEqual(display.effects[4].currentAnchor.position,[270,35,0]);
  assert.deepEqual(display.effects[6].currentAnchor,effects[6].currentAnchor,'dead carrier keeps the saved world anchor');
  assert.deepEqual(display.effects[7].currentAnchor,effects[7].currentAnchor,'foreign cast never supplies a bone');
  assert.deepEqual(calls,[[1,'remote','Dummy02',1.8],[4,'other','Dummy03',1.8]]);
  assert.deepEqual(state,before,'presentation sampling does not change combat state or effect clocks');
  assert.strictEqual(createEffectRenderState(state,actors).effects[1],effects[1]);
});
