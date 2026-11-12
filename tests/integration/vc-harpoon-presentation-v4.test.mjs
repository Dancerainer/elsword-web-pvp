/** Full Harpoon causal/render chain. Expectations come from the independently
 * frozen Lua/mesh declarations, never from a saved current-simulation trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createPoseLibrary,samplePose,transform} from '../../tools/assets/character/sample_pose.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/vc-harpoon-source-v4.json',import.meta.url)));
const vcEffectIndex=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const vcEffectPoses=Object.fromEntries([...new Set(Object.values(vcEffectIndex.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/vc',path)))]));
const shell='Raven_Harpoon_Spear_Shell_MEMO',stone='RWT_SA_HARPOON_SPEAR_Stone';
const addFlame='Mesh_Harpoon_Spear_Shell_Explosion_Add_Flame';
const near=(actual,expected,tolerance=1e-4)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance,JSON.stringify({actual,expected})));
// Independent expanded D3DX yaw/pitch/roll reference, not the implementation's
// xCrashMeshTransform or nativeEffectQuaternion under test.
const turn=(p,[pitch,yaw,roll])=>{const [x,y,z]=[pitch,yaw,roll].map(n=>n*Math.PI/180);
  const a=p[0]*Math.cos(z)-p[1]*Math.sin(z),b=p[0]*Math.sin(z)+p[1]*Math.cos(z);
  const c=b*Math.sin(x)+p[2]*Math.cos(x);return [a*Math.cos(y)+c*Math.sin(y),b*Math.cos(x)-p[2]*Math.sin(x),-a*Math.sin(y)+c*Math.cos(y)];};

test('Harpoon configuration preserves the full original Ultimate chain and native mesh periods',()=>{
  assert.equal(source.targetClientMeasured,false);
  assert.deepEqual(source.missingTemplates,['RWT_SA_HARPOON_SPEAR_Lightning01']);
  for(const [name,state] of Object.entries(source.states))assert.deepEqual(vcProfile.states[name].raw,state.raw,name);
  for(const [name,row] of Object.entries(source.damageEffects))assert.deepEqual(vcProfile.damageEffects[name].raw,row.raw,name);
  for(const [name,row] of Object.entries(source.templates)){
    assert.deepEqual(vcEffectIndex.templates[name].fields,row.fields,name);
    assert.deepEqual(vcEffectIndex.templates[name].events,row.events,name);
  }
  for(const name of ['RAVEN_HARPOON_SPEAR_SHELL_Ultimate','RAVEN_HARPOON_SPEAR_SHELL_OVERHEAT_Ultimate'])
    assert.deepEqual([0,1,2,3].map(i=>source.damageEffects[name].raw['DIE_DAMAGE_EFFECT'+i].POSITION_TYPE),[4,4,4,4]);
  assert.equal(source.templates[shell].animationClips[0].durationSeconds,0.4333333373069763);
  assert.equal(source.templates[shell].fields.SetLandHeightOnStart,undefined);
  assert.equal(source.templates.RWT_SA_HARPOON_SPEAR_EXPLOSION_Ultimate.fields.LifeTime,1);
  assert.equal(source.templates.RWT_SA_HARPOON_SPEAR_EXPLOSION_MEMO.fields.LifeTime,1.3);
});

test('actual Harpoon impact and stone helpers use original dynamic mesh size and rotation in render and collision',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('harpoon-helper-v4',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  const f=vcFixture({passives:[]}),names=['RWT_SA_HARPOON_SPEAR_ASSAULT',stone];
  const index={...vcEffectIndex,templates:Object.fromEntries(names.map(name=>[name,vcEffectIndex.templates[name]]))};
  const profile={...vcProfile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:vcEffectPoses,samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  for(const name of names)for(const facing of [-1,1])for(const time of [.02,.05,.099]){
    view.clear();const damageName=name===stone?'RAVEN_HARPOON_SPEAR_SHELL_STONE':'RAVEN_HARPOON_SPEAR_SHELL_IMPACT';
    const row=source.templates[name],library=createPoseLibrary(vcEffectPoses[row.poseData]),local=samplePose(library,'Normal',time);
    const anchor={position:[700,3100,25],rotation:[0,facing<0?180:0,0],facing};
    const e={id:9001,name:damageName,ownerId:f.a.id,definition:{},damage:vcProfile.damageEffects[damageName].raw,
      mainEffectName:name,birthAnchor:anchor,currentAnchor:anchor,sourceSkillMeshControl:true,elapsed:time,meshLifetimeElapsed:time,animationTime:time};
    const size=name===stone?[.3,.6,.45]:time<=.033?[1.2+.8*(time-.01)/.023,2*(time-.01)/.023,1.2+.8*(time-.01)/.023]:Array(3).fill(2+.3*(time-.033)/.567);
    const angle=name===stone?[0,anchor.rotation[1]+90,0]:[0,anchor.rotation[1],20];
    const vector=p=>turn(p.map((n,i)=>n*size[i]),angle),point=p=>vector(p).map((n,i)=>n+anchor.position[i]);
    const state={actors:[f.a],effects:[e]};
    view.event({type:'effectStarted',effectId:e.id,name:damageName,actorId:f.a.id,definition:{},birthAnchor:anchor},state);
    view.step(time,state);view.render();
    const root=scene.transformNodes.find(node=>node.name.startsWith('fx-'+name+'-')&&node.name.endsWith('-world')&&node.isEnabled());
    assert.ok(root,name+' actual render root');
    const shapes=f.sim.effectSampler(e,f.a);assert.equal(shapes.length,2,name+' original attack helpers');
    for(const shape of shapes){
      const helper=library.helpers.find(h=>h.name===shape.source.helper),matrix=local.get(helper.name),p=transform(matrix,[0,0,0]);
      near(shape.center,point(p));near(f.sim.effectBoneSampler(e,f.a,helper.name),point(p));
      const expectedRadius=(helper.nativeStoredBoundingRadius??helper.geometryBoundingSphereCandidate.radius)*Math.hypot(...vector(matrix.slice(0,3)));
      assert.ok(Math.abs(shape.radius-expectedRadius)<1e-4,name+' original transformed X radius');
      const rendered=Vector3.TransformCoordinates(new Vector3(p[0],p[1],-p[2]),root.computeWorldMatrix(true)).asArray();
      near(rendered,point(p).map((n,i)=>n*.01*(i===2?-1:1)),1e-4);
    }
  }
});

test('actual normal/overheat Harpoon in both directions draws its shell, four die children and repeating fire',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('harpoon-v4',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  let fixture=vcFixture();
  const profile=vcProfile;
  const view=await createEffectsView({scene,engine,index:vcEffectIndex,profile,effectPoses:vcEffectPoses,
    effectQuality:{level:'medium',particleDivisor:8},loadout:[{skillId:24031}],
    samplers:{effectAnchorSampler:(...a)=>fixture.sim.effectAnchorSampler(...a),effectBoneSampler:(...a)=>fixture.sim.effectBoneSampler(...a)}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  for(const heat of [false,true])for(const facing of [-1,1]){
    view.clear();fixture=vcFixture({skillId:24031,passives:[],position:[-600*facing,3080,0],gap:20000,facing});
    const {sim,a}=fixture;a.y+=450;a.grounded=false;a.lineId=null;sim.enter(a,'RSI_JUMP_DOWN','explicit-air-test-fixture');sim.drainEvents();
    await view.prewarmActors(sim.state.actors);
    const preparedMeshes=view.proof().meshInstances;
    const rootName=heat?'RAVEN_HARPOON_SPEAR_SHELL_OVERHEAT_Ultimate':'RAVEN_HARPOON_SPEAR_SHELL_Ultimate';
    const rootRaw=source.damageEffects[rootName].raw,children=[],births=[],drawn=new Set(),shellTimes=new Set();
    let shellId=null,transparent=0,opaque=0,stoneRotation=0,flameScale=0;
    for(let frame=0;frame<480;frame++){
      sim.step(1/60,frame===0||heat&&frame<120&&frame%2===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
      for(const event of sim.drainEvents()){
        if(event.type==='effectStarted'){births.push(event.name);if(event.name===rootName)shellId=event.effectId;}
        if(event.type==='damageSecondaryCreated'&&event.parentEffectId===shellId)children.push(event);
        view.event(event,sim.state);
      }
      view.step(1/60,sim.state);view.render();
      assert.equal(view.proof().meshInstances,preparedMeshes,`equipped source burst must not clone meshes on combat frame ${frame}; heat=${heat} facing=${facing}`);
      const proof=view.proof({includeDraws:true}).nativeParticleDraws;
      for(const sample of proof.samples){
        drawn.add(sample.name);assert.ok(sample.meshes.every(mesh=>mesh.world.every(Number.isFinite)),sample.name);
        if(sample.name===shell){
          if(sample.age<.05){assert.deepEqual(sample.color,[0,0,0,0]);transparent++;}
          else {assert.deepEqual(sample.color,[1,1,1,1]);opaque++;}
        }
        if(sample.name===stone){assert.deepEqual(sample.rotate,[0,90,0]);stoneRotation++;}
        if(sample.name===addFlame){assert.deepEqual(sample.size,[.63,.63,.63]);flameScale++;}
      }
      for(const clock of view.sourceMeshClocks())if(clock.name===shell){
        const live=sim.state.effects.find(effect=>effect.id===clock.effectId);
        assert.equal(clock.animationTime,live.sourceShadowMesh.animationTime);shellTimes.add(clock.animationTime);
      }
    }
    const label=`heat=${heat} facing=${facing}`;
    assert.deepEqual(children.map(child=>child.field).sort(),['DIE_DAMAGE_EFFECT0','DIE_DAMAGE_EFFECT1','DIE_DAMAGE_EFFECT2','DIE_DAMAGE_EFFECT3'],label);
    for(const child of children)assert.equal(child.name,rootRaw[child.field].DAMAGE_EFFECT_NAME);
    assert.ok(transparent>0&&opaque>0&&shellTimes.size>3,label+' original shell colors and advancing clip');
    assert.ok(stoneRotation>0&&flameScale>0,label+' source stone yaw and additional flame scale');
    for(const name of [shell,stone,addFlame,'Raven_HarpoonSpearFireP2','Raven_HarpoonSpearFireP3'])assert.ok(drawn.has(name),label+' actual visible mesh: '+name);
    const branch=rootRaw.DIE_DAMAGE_EFFECT3.DAMAGE_EFFECT_NAME,raw=source.damageEffects[branch].raw;
    // Native carrier LT_TIME=1 permits events at0,.13,...,.91: eight, despite
    // the separate maximum count10 and LOOP_END_TIME1.3 declaration.
    assert.equal(births.filter(name=>name===raw.CREATE_DAMAGE_EFFECT1.DAMAGE_EFFECT_NAME).length,8,label+' repeated source flame births');
    assert.equal(births.filter(name=>name===raw.CREATE_DAMAGE_EFFECT2.DAMAGE_EFFECT_NAME).length,8,label+' repeated source stone births');
    assert.equal(births.filter(name=>name===raw.CREATE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME).length,1,label+' global-time0.81 finish');
    assert.deepEqual(a.unsupported.filter(note=>/^damage-(secondary|child)-/.test(note.id)),[],label+' actor notes must be checked, not only global notes');
  }
  // Deliberately rotate the actual source carrier between presentation packets.
  // This isolates native SetParticleData semantics from map-following movement;
  // the core's authored-map/cached-land regression is tested separately.
  view.clear();fixture=vcFixture({skillId:24031,passives:[],gap:20000});fixture.sim.drainEvents();
  const carrier=fixture.sim.createEffect(fixture.a,{NAME:'RAVEN_HARPOON_SPEAR_SHELL_EXPLOSION_Sub_Damage_Ultimate'},
    {birthAnchor:{position:[0,3080,0],facing:1,rotation:[0,0,0]}});
  fixture.sim.tickEffects(0);for(const e of fixture.sim.drainEvents())view.event(e,fixture.sim.state);
  let first=null;
  for(let frame=0;frame<30&&!first;frame++){
    view.step(1/60,fixture.sim.state);view.render();first=view.proof({includeDraws:true}).nativeParticleDraws.samples.find(p=>p.name==='Raven_HarpoonSpearFireP3');
  }
  assert.ok(first,'actual source P3 emitted before the turn');assert.deepEqual(first.visualRotation,[0,0,0]);
  carrier.currentAnchor.rotation=[0,90,0];view.step(1/60,fixture.sim.state);view.render();
  const afterTurn=view.proof({includeDraws:true}).nativeParticleDraws.samples.find(p=>p.name==='Raven_HarpoonSpearFireP3');
  assert.deepEqual(afterTurn.axis,[0,90,0],'existing source Trace=true particle updates its movement axis');
  assert.deepEqual(afterTurn.visualRotation,[0,0,0],'existing source particle retains visual AddRotate from birth');
  let newRotated=false;
  for(let frame=0;frame<20&&!newRotated;frame++){
    view.step(1/60,fixture.sim.state);view.render();
    newRotated=view.proof({includeDraws:true}).nativeParticleDraws.samples.some(p=>p.name==='Raven_HarpoonSpearFireP3'&&p.visualRotation[1]===90);
  }
  assert.ok(newRotated,'new actual source P3 particles copy the changed sequence AddRotate');
  t.diagnostic('NullEngine actual causal/render lifecycles only; no original-client GPU comparison');
});
