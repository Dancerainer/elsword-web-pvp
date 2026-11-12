import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {arcLineBasis,nearestLockOnPoint,advanceArcMesh} from '../../packages/combat-core/archenemy-mesh.mjs';
import {arcUsesBindPose,arcEffectPose,sampleEffectBindPose,nativeEffectQuaternion} from '../../packages/combat-assets/effect-transform.mjs';
import {createPoseLibrary,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(read('artifacts/rf/fx/index.json'),read('artifacts/rf/buff-fx/index.json'),read('artifacts/rf/shadow-weapon-fx/index.json'),read('artifacts/rf/skill-fx-v11/index.json')));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(f=>[f,read('artifacts/rf/'+f)]));
const assets={profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses};
async function make(facing=-1){const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:file=>readFileSync(resolve(fixtureRoot,'artifacts/native',file))});
  return createSimulation({profile,map,preset:{...preset,loadout:[{skillId:24008},null,null,null,null,null,null,null]},
    actors:[{id:'rf',team:0,position:[facing<0?2022.98:1858.11,2840,0],lineId:6,facing},
      {id:'target',team:1,position:[facing<0?1942.98:1938.11,2840,0],lineId:6,facing:-facing}],
    ...createNativeSamplers(assets),nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,seed:2016,versions:native.versions});}
async function cast(facing){const s=await make(facing);s.step(1/60,{pressed:['A']},{snapshot:false});
  for(let i=0;i<180;i++)s.step(1/60,{}, {snapshot:false});return s;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('2016 DLL has no initially bound set; original Waiting failure retains real mesh bind helpers',()=>{
  const original=read('reports/rf-archenemy-initial-controller-v12.json');
  assert.deepEqual(original.animations,['Normal']);assert.equal(original.initialTracks.every(x=>x.name===null),true);
  const t=index.templates.Raven_Overtaker_Flying_Impact,library=createPoseLibrary(poses[t.poseData]);
  assert.equal(t.initialAnimation.name,'Waiting');assert.equal(arcUsesBindPose(t,library),true);
  const sampler=createNativeSamplers(assets),anchor={position:[0,0,0],facing:1,rotation:[0,0,90]};
  const e={name:'RAVEN_OVER_TAKER_ARC_ENEMY',damage:profile.damageEffects.RAVEN_OVER_TAKER_ARC_ENEMY.raw,
    sourceArcHandle:1,definition:{},currentAnchor:anchor,animationTime:.7};
  const shapes=sampler.effectSampler(e,{});assert.equal(shapes.length,1);assert.equal(shapes[0].kind,'line');
  // Literal target helper translation: -157.1428985595703 × parent .7 × Size .8 = -88.0000.
  close(shapes[0].start[0],0);close(shapes[0].start[1],(-157.1428985595703+3.0517578125e-05)*0.699999988079071*.8);
  close(shapes[0].end[1],(149.9996337890625+3.0517578125e-05)*0.699999988079071*.8);
  const bind=sampleEffectBindPose(library,compose([0,0,0],[.8,.8,.8],nativeEffectQuaternion([0,0,90])));
  assert.deepEqual(sampler.effectBoneSampler(e,{},'TRACE_START0'),transform(bind.get('TRACE_START0'),[0,0,0]));
});

test('source line basis includes left180, real world line direction and perpendicular Z',()=>{
  assert.deepEqual(arcLineBasis({lineId:3,facing:-1},[{lineId:3,start:[0,0,0],end:[1,0,0]}]),
    {direction:[1,0,0],rotation:[0,180,0],zDirection:[-0,0,1]});
  assert.throws(()=>arcLineBasis({lineId:3,facing:1},[{lineId:3,start:[0,0,0],end:[0,1,0]}]),/unsupported/);
});
test('original lock-on selects nearest owner point and the last tie, rather than first sphere',()=>{
  assert.deepEqual(nearestLockOnPoint([{center:[100,0,0]},{center:[3,0,0]},{start:[-3,0,0]}],[0,0,0],[0,100,0]),[-3,0,0]);
  assert.deepEqual(nearestLockOnPoint([],[0,0,0],[7,100,0]),[7,100,0]);
});
test('mesh consumes prior manual packet, treats Euler left yaw once and tests old lifetime',()=>{
  const e={currentAnchor:{position:[0,0,0],rotation:[0,180,0],facing:-1},initialDirSpeed:3000,lifeTimeSeconds:.35,
    meshLifetimeElapsed:0,animationTime:0};advanceArcMesh(e,.01);close(e.x,-30);close(e.y,0);close(e.z,0);
  e.sourceArcUseManualDir=true;e.sourceArcManualDirDegree=[0,180/Math.PI,0];advanceArcMesh(e,.01);close(e.x,-30);close(e.y,30);
  e.meshLifetimeElapsed=Math.fround(.35);advanceArcMesh(e,.01);assert.equal(e.dead,true);assert.equal(e.endReason,'template-life-time');
});
test('failed LOOP copies initial bind, selects source index0, then samples original Normal keys',()=>{
  const template=index.templates.Raven_Overtaker_Flying_Impact,library=createPoseLibrary(poses[template.poseData]);
  const e={currentAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1},initialDirSpeed:0,lifeTimeSeconds:30,
    animationTime:.4,sourceArcHandle:1,definition:{},damage:profile.damageEffects.RAVEN_OVER_TAKER_ARC_ENEMY.raw};
  advanceArcMesh(e,.05,template);
  assert.equal(e.sourceArcController.animationName,'Normal');assert.equal(e.sourceArcController.time,0);
  assert.equal(arcUsesBindPose(template,library,e),true,'first copied frames precede index0 ChangeAnim');
  advanceArcMesh(e,.65,template);
  assert.equal(arcUsesBindPose(template,library,e),false);const pose=arcEffectPose(template,library,e);
  assert.equal(pose.clipName,'Normal');close(pose.timeSeconds,.65-Math.fround(.1)/2);
  // Independent original DLL GetKeys: Dummy1 Y at .6 = -14.71500015258789.
  // Size .8 scales the original helper world translation; bind Y is near0.
  const shape=createNativeSamplers(assets).effectSampler(e,{})[0];
  assert.ok(Math.abs(shape.start[1]-(-14.71500015258789*.8))<.001);
  assert.equal(arcUsesBindPose({...template,initialAnimation:{name:'Waiting',playback:'XAP_ONE'}},library),false);
});
test('unit follow changes are backed up at current global start and cannot seed manual direction',()=>{
  const e={currentAnchor:{position:[100,20,0],rotation:[0,0,0],facing:1},sourceArcPreviousMeshPosition:[0,0,0],
    initialDirSpeed:0,lifeTimeSeconds:30,meshLifetimeElapsed:0,animationTime:0};
  advanceArcMesh(e,.01);assert.deepEqual(e.sourceArcManualDirDegree,[0,0,0]);
  assert.deepEqual(e.currentAnchor.position,[100,20,0]);
});
test('compiled VectorLockOn vertical/depth component feeds one mesh step and equivalent reflected render basis',async()=>{
  const s=await make(1),dt=.05;
  const result=s.nativeSkills.vectorLockOn({position:[0,0,0],manualDirDegree:[0,0,0],targetPosition:[100,100,100],curveSpeed:1,dt});
  const direction=result.manualDirDegree.map(n=>Math.fround(n*Math.fround(Math.PI/180)));
  assert.ok(direction.every(n=>n>0));
  const e={currentAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1},initialDirSpeed:3000,lifeTimeSeconds:.35,
    meshLifetimeElapsed:0,animationTime:0,sourceArcUseManualDir:true,sourceArcManualDirDegree:result.manualDirDegree};
  advanceArcMesh(e,dt);
  e.currentAnchor.position.forEach((n,i)=>assert.equal(n,Math.fround(Math.fround(direction[i]*3000)*Math.fround(dt))));
  const q=nativeEffectQuaternion(e.currentAnchor.rotation),basis=transform(compose([0,0,0],[1,1,1],q),[1,0,0]),length=Math.hypot(...direction);
  basis.forEach((n,i)=>close(n,direction[i]/length));
  const [x,y,z]=e.currentAnchor.rotation,reflected=nativeEffectQuaternion([-x,-y,z]);
  q.forEach((n,i)=>close(reflected[i],i<2?-n:n));
});

for(const facing of [-1,1])test(`production Archenemy ${facing}: keyboard cast and Z produce actual spear damage with real source helper`,async()=>{
  const s=await cast(facing),a=s.actor('rf');assert.equal(a.sourceArcEnemy.data.length,4);
  const before=s.state.events.length;s.step(1/60,{pressed:['Z']},{snapshot:false});
  for(let i=0;i<150;i++)s.step(1/60,{}, {snapshot:false});
  const events=s.state.events.slice(before),melee=events.filter(e=>e.type==='hit'&&e.actorId==='rf'&&e.origin.skillId!==24008);
  const spear=events.filter(e=>e.type==='hit'&&e.actorId==='rf'&&e.origin.kind==='effect'&&e.origin.skillId===24008);
  assert.ok(events.some(e=>e.type==='stateChanged'&&e.state==='RSI_COMBO_Z'),'actual keyboard Z state');
  assert.ok(melee.length>0,'actual Z (including default Enchant Hand damage producer) must hit; no injection');
  assert.equal(a.sourceArcEnemy.data.length,3);assert.equal(spear.length,1,'real bind helper must produce one spear hit');
  assert.equal(spear[0].data.DAMAGE.MAGIC,4.48,'unresolved761 description never overrides original4.48');
  assert.ok(spear[0].amount>0);assert.ok(events.some(e=>e.type==='effectEnded'&&e.reason==='hit-limit'));
  const json=JSON.parse(JSON.stringify(s.snapshot())),restored=await make(facing);restored.restore(json);
  for(let i=0;i<120;i++){s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(s.snapshot())));
});
test('owned spears clear on source death Start',async()=>{
  const s=await cast(-1),a=s.actor('rf');assert.equal(a.sourceArcEnemy.data.length,4);
  a.hp=0;s.step(1/60,{}, {snapshot:false});assert.equal(a.sourceArcEnemy.data.length,0);
  assert.equal(s.state.effects.some(e=>e.sourceArcHandle),false);
  assert.equal(s.state.events.filter(e=>e.type==='effectEnded'&&e.reason==='original-arc-owner-death').length,4);
});

test('real keyboard-triggered release resets lifetime without disabling global SlashTrace; replay preserves both clocks',async()=>{
  const s=await cast(1);s.step(1/60,{pressed:['Z']},{snapshot:false});let released;
  for(let i=0;i<90&&!released;i++){s.step(1/60,{}, {snapshot:false});released=s.state.effects.find(e=>e.sourceArcHandle&&e.initialDirSpeed===3000);}
  assert.ok(released,'real Z must release a gun before its hit');assert.equal(released.meshLifetimeElapsed,0);
  assert.ok(released.sourceArcGlobalTime>1);assert.equal(released.sourceArcSlashTrace,true);
  const saved=JSON.parse(JSON.stringify(s.snapshot())),restored=await make(1);restored.restore(saved);
  s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});
  const next=s.state.effects.find(e=>e.id===released.id);
  if(next){assert.ok(next.meshLifetimeElapsed<.1);assert.equal(next.sourceArcSlashTrace,true);assert.ok(next.sourceArcGlobalTime>released.sourceArcGlobalTimeBefore);}
  for(let i=0;i<120;i++){s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(JSON.parse(JSON.stringify(restored.snapshot())),JSON.parse(JSON.stringify(s.snapshot())));
});

test('production waiting spears expire at original30s and clear native owned handles',async()=>{
  const s=await cast(-1);for(let i=0;i<132;i++)s.step(.25,{}, {snapshot:false});
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,0);assert.equal(s.state.effects.some(e=>e.sourceArcHandle),false);
});
