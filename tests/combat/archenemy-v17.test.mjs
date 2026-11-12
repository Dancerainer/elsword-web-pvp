import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPoseLibrary,sampleLocalTransform} from '../../tools/assets/character/sample_pose.mjs';
import {initializeArcStartMesh,advanceArcStartMesh,ARC_START_MESH_NAMES} from '../../packages/combat-core/archenemy-mesh.mjs';
import {canTriggerArchenemy} from '../../packages/combat-core/nasod-attack.mjs';
import {makeArc,read,starts,poses,samplers} from '../helpers/archenemy-v17-fixture.mjs';
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=v=>JSON.parse(JSON.stringify(v));

test('four actual target Start X files and original DLL period/key evidence are frozen independently',()=>{
  const request=read('reports/rf-archenemy-start-d3dx-sources-v17.json');
  const manifest=read('reports/rf-archenemy-start-d3dx-keyframes-v17.json');
  const raw=readFileSync(new URL('../../'+manifest.artifact.path,import.meta.url));
  assert.equal(hash(raw),manifest.artifact.sha256);assert.equal(raw.length,manifest.artifact.bytes);
  assert.equal(manifest.fullClientExecuted,false);assert.equal(manifest.dll.sha256,request.dllSha256);
  const periods=[.8999999761581421,.7666666507720947,.5333333611488342,.4000000059604645];
  for(const [i,source] of request.sources.entries()){
    assert.equal(source.actualLoaderHresult,'0x00000000');
    if(existsSync(source.source))assert.equal(hash(readFileSync(source.source)),source.sourceSha256);
    const t=starts.templates[ARC_START_MESH_NAMES[i]],pose=poses[t.poseData];
    assert.equal(t.fields.PlayCount,1);assert.equal(t.initialAniSpeed,1.4);assert.deepEqual(t.initialSize,[1.2,1.2,1.2]);
    assert.equal(t.animationClips[0].durationSeconds,periods[i]);assert.equal(t.animationClips[0].ticksPerSecond,4800);
    assert.deepEqual(pose.unsupportedTracks,[]);assert.equal(pose.clips[0].nativeD3dxKeys,true);
    const lib=createPoseLibrary(pose),bone=`Dummy0${i+4}`;
    const initial=sampleLocalTransform(lib,'Normal',0,bone),rear=sampleLocalTransform(lib,'Normal',1/3,bone);
    // Independent original DLL translation outputs, not generated expectations.
    [-41.801506,[29.9824753,29.5130615,33.6914063,31.3890152][i],97.95658]
      .forEach((n,k)=>close(initial.translation[k],n,1e-4));
    assert.ok(rear.translation[0]<-100&&rear.translation[2]<10);
    assert.ok(initial.scale.some(v=>Math.abs(v)<1e-8),'original zero scale at spawn is retained');
  }
});

test('Start global/animation clocks preserve speed ramp, lagged Anim .05 event and next-packet ONE death',()=>{
  const t=starts.templates[ARC_START_MESH_NAMES[3]];
  const e={birthAnchor:{position:[1,2,3],rotation:[0,0,0],facing:1}};
  initializeArcStartMesh(e,t);
  assert.equal(e.sourceArcGlobalTime,Math.fround(.0001));assert.ok(e.animationTime<1e-6);
  advanceArcStartMesh(e,.05,t);assert.equal(e.sourceArcSlashTrace,false);
  advanceArcStartMesh(e,.05,t);assert.equal(e.sourceArcSlashTrace,false,'RunEvent consumes previous SkinAnim time');
  advanceArcStartMesh(e,.05,t);assert.equal(e.sourceArcSlashTrace,true);
  assert.deepEqual(e.currentAnchor.position,[1,2,3],'source bones move, instance does not fly/attach');
  while(!e.sourceArcStartEndPending)advanceArcStartMesh(e,.01,t);
  assert.equal(e.dead,undefined);advanceArcStartMesh(e,.01,t);
  assert.equal(e.dead,true);assert.equal(e.endReason,'original-mesh-play-end');
});

for(const facing of [-1,1])test(`keyboard Archenemy ${facing}: four hand-side Start animations precede four waiting spears, JSON resumes every phase`,async()=>{
  const s=await makeArc(facing),a=s.actor('rf');s.step(1/60,{pressed:['A']},{snapshot:false});
  let savedAtStart=false;const samples=[];
  for(let i=0;i<180;i++){
    s.step(1/60,{}, {snapshot:false});
    for(const e of s.state.effects.filter(e=>e.sourceArcStartMesh)){
      assert.equal(e.damage,null);assert.equal(e.sourceArcPose.animationLoop,false);
      const bone=`Dummy0${ARC_START_MESH_NAMES.indexOf(e.name)+4}`;
      samples.push({name:e.name,time:e.sourceArcGlobalTime,position:samplers.effectBoneSampler(e,a,bone),facing});
      assert.deepEqual(samplers.effectBoneSampler(e,{...a,x:a.x+500,y:a.y+200},bone),samples.at(-1).position,
        'Start stays at its birth transform when the owner leaves');
    }
    if(!savedAtStart&&s.state.effects.some(e=>e.sourceArcStartMesh&&e.sourceArcGlobalTime>.05)){
      const restored=await makeArc(facing);restored.restore(json(s.snapshot()));
      for(let k=0;k<5;k++){s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
      assert.deepEqual(json(restored.snapshot()),json(s.snapshot()));savedAtStart=true;
    }
  }
  assert.ok(savedAtStart);
  const born=s.state.events.filter(e=>e.type==='effectStarted'&&e.sourceArcStartMesh);
  assert.deepEqual(born.map(e=>e.name),ARC_START_MESH_NAMES);
  const meshCommands=s.state.events.filter(e=>e.type==='originalSkillCommand'&&e.commandType==='mesh');
  assert.equal(meshCommands.length,4);meshCommands.map(e=>e.animationTime).forEach((v,i)=>close(v,[.6666,.8,1,1.1333][i],.02));
  const waits=s.state.events.filter(e=>e.type==='effectStarted'&&e.sourceArcMesh);
  assert.equal(waits.length,4);assert.ok(waits[0].time>born[3].time);
  assert.equal(a.sourceArcEnemy.data.length,4);assert.equal(s.state.effects.some(e=>e.sourceArcStartMesh),false);
  assert.equal(s.state.events.filter(e=>e.type==='effectEnded'&&e.reason==='original-mesh-play-end').length,4);
  for(const name of ARC_START_MESH_NAMES){const values=samples.filter(x=>x.name===name),first=values[0],last=values.at(-1);
    assert.ok(first.position&&last.position);assert.ok((last.position[0]-first.position[0])*facing<-70,'native keys travel to rear');}
  const saved=await makeArc(facing);saved.restore(json(s.snapshot()));
  s.step(1/60,{pressed:['Z']},{snapshot:false});saved.step(1/60,{pressed:['Z']},{snapshot:false});
  for(let i=0;i<150;i++){s.step(1/60,{}, {snapshot:false});saved.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(json(saved.snapshot()),json(s.snapshot()));
  assert.equal(s.state.events.filter(e=>e.type==='hit'&&e.origin?.kind==='effect'&&e.origin.skillId===24008).length,1);
  assert.equal(a.sourceArcEnemy.data.length,3);
  a.hp=0;s.step(1/60,{}, {snapshot:false});assert.equal(a.sourceArcEnemy.data.length,0);
  assert.equal(s.state.effects.some(e=>e.sourceArcHandle),false);
});

test('unchanged source trigger exclusions reject special, Nasod core and awakening aura',()=>{
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:1},{kind:'character'}),false);
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:0},{kind:'core'}),false);
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:0},{kind:'effect'},{name:'RAVEN_HYPER_AURA'}),false);
  assert.equal(canTriggerArchenemy({ATTACK_TYPE:0},{kind:'character'}),true);
});
