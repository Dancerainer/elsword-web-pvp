/** Target trace declarations + actual shared/native pose, mounted weapon and
 * main trail renderer. This is not original-client GPU evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createProfessionAssetCache} from '../../apps/web/load-profession-assets.mjs';
import {createRFWeaponTrails,supportsRavenClawTrail} from '../../apps/web/weapon-trails.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {feedVcCommandInput} from '../../tools/combat/vc-command-input-cases-v5.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/vc-command-presentation-source-v5.json',import.meta.url)));
const vcEffectIndex=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
// Combat intentionally loads only damage meshes. Presentation also needs the
// PT_SKINMESH particles in the complete manifest, as the product cache does.
const vcEffectPoses=Object.fromEntries([...new Set(Object.values(vcEffectIndex.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/vc',path)))]));
const file=url=>resolve('artifacts',new URL(url,'http://fixture').pathname.replace(/^\/assets\//,''));

test('all original basic-command FX declarations preserve their separately extracted source closure',()=>{
  for(const category of ['effectSets','damageEffects'])for(const [name,raw]of Object.entries(source.effectClosure[category]))
    assert.deepEqual(vcProfile[category][name].raw,raw,category+'/'+name);
  for(const [name,template]of Object.entries(source.effectClosure.templates)){
    assert.ok(vcEffectIndex.templates[name],name+' complete effect resource');
    for(const key of ['fields','events','repeated','source','declarationSha256'])assert.deepEqual(vcEffectIndex.templates[name][key],template[key],name+'/'+key);
  }
  assert.equal(source.runtimePathAudit.missing,0);assert.equal(source.runtimePathAudit.caseMismatches,0);
});

async function setup(t){
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('vc-trails-v5',new Vector3(0,32,25),scene);
  const cache=createProfessionAssetCache({data:async url=>JSON.parse(readFileSync(file(url))),
    loadContainer:async(base,name)=>loadPoseContainer(scene,file(base+name)),loadImage:async url=>({src:url})});
  const assets=await cache.load('VC'),body=createActorView(assets.bodyContainer,scene,'vc-display',.01,assets.characterPose);
  const manager=createRFWeaponTrails({scene,profile:vcProfile,localActorId:'vc',
    sampleEndpoints:(_actor,names)=>Object.fromEntries(getActorNativePoints(body,names))});
  const policy=createEffectPresentationPolicy(vcProfile,DEFAULT_EFFECT_QUALITY);
  const clawEnabled=actor=>supportsRavenClawTrail(vcProfile)&&policy.actor(actor).level==='high';
  t.after(()=>{manager.dispose();body.dispose();cache.dispose();scene.dispose();engine.dispose();});
  return {engine,scene,body,manager,assets,clawEnabled};
}

test('all nineteen original VC command trace declarations draw the actual sword or claw in both facings and awakening',async t=>{
  const {scene,body,manager,assets,clawEnabled}=await setup(t);let cases=0;
  for(const [name,row]of Object.entries(source.states)){
    const sword=row.fields.SLASH_TRACE,claw=row.fields.UNIT_SLASH_TRACE0;
    if(!sword&&!claw)continue;
    for(const [key,value]of Object.entries(row.fields))assert.deepEqual(vcProfile.states[name].raw[key],value,name+'/'+key);
    const kind=sword?'sword':'claw',start=sword?sword['1']:claw['2'];
    const endpointNames=sword?['TRACE_START0','TRACE_END0']:['ATTACK_SPHERE1_Lhand1','Bip01_L_Hand'];
    for(const facing of [-1,1])for(const remaining of [0,30]){
      manager.clear();const {a}=vcFixture({facing,position:[-500,3080,0],passives:[]});
      Object.assign(a,{state:name,animationName:row.animationName,animationLoop:false,presentationTransition:null,skillId:null});a.awakening.remaining=remaining;
      for(let frame=0;frame<12;frame++){
        a.animationTime=start+frame/60;assert.equal(sampleAnimation(body,a.animationName,a.animationTime,false),true,name);
        placeActor(body,a);manager.step({actors:[a],dt:1/60,clawEnabled});
      }
      const proof=manager.proof();assert.deepEqual(proof.unsupported,[],name);assert.equal(proof.channels.length,2,name);
      assert.ok(proof.channels.every(channel=>channel.key.includes(':'+kind+':')&&channel.visible&&channel.vertices>2),name);
      const shown=scene.meshes.filter(mesh=>mesh.name.startsWith('rf-trail-')&&mesh.isEnabled());assert.equal(shown.length,4,name);
      assert.ok(shown.every(mesh=>mesh.getTotalIndices()>0&&mesh.getVerticesData('position').every(Number.isFinite)),name);
      const color=shown.find(mesh=>mesh.name.includes(':body:')).getVerticesData('color');
      const expected=remaining?[1,.2,.2]:[1/3,1/3,1];
      for(let c=0;c<3;c++)assert.ok(Math.abs(color[c]-expected[c])<1e-6,name+' source RGB');
      const displayed=getActorNativePoints(body,endpointNames);
      for(const bone of endpointNames){
        const sampled=assets.samplers.effectAnchorSampler({definition:{BONE_NAME:bone}},a).position;
        assert.ok(displayed.has(bone),name+'/'+bone+' actual mounted helper');
        displayed.get(bone).forEach((value,i)=>assert.ok(Math.abs(value-sampled[i])<.002,name+'/'+bone+' rendered/sampler source point'));
      }
      scene.render();cases++;
    }
  }
  assert.equal(cases,76);
});

test('actual ground and aerial cannon input reaches original FX draw geometry without missing closure or binding',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('command-fx-v5',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  let fixture=vcFixture({passives:[],gap:20000});
  const view=await createEffectsView({scene,engine,index:vcEffectIndex,profile:vcProfile,effectPoses:vcEffectPoses,
    effectQuality:DEFAULT_EFFECT_QUALITY,loadout:[],
    samplers:{effectAnchorSampler:(...args)=>fixture.sim.effectAnchorSampler(...args),effectBoneSampler:(...args)=>fixture.sim.effectBoneSampler(...args)}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const observations=[];
  for(const mode of ['xxxx','airzxx','airxxxx'])for(const facing of [-1,1]){
    view.clear();fixture=vcFixture({passives:[],gap:20000,position:[-500*facing,3080,0],facing});
    const {sim,a}=fixture,input=createInputBuffer({sampledLevels:true}),births=new Set(),draws=new Set(),quadDraws=new Set(),states=new Map();sim.drainEvents();
    for(let frame=0;frame<360;frame++){
      feedVcCommandInput(input,sim,a,mode,frame);sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});
      if(!states.has(a.state))states.set(a.state,frame);
      for(const event of sim.drainEvents()){if(event.type==='effectStarted')births.add(event.name);view.event(event,sim.state);}
      view.step(1/60,sim.state);view.render();
      const drawn=view.proof({includeDraws:true}).nativeParticleDraws;
      for(const batch of drawn.batches)quadDraws.add(batch.name);
      for(const sample of drawn.samples){
        assert.ok(sample.meshes.every(mesh=>mesh.world.every(Number.isFinite)),sample.name+' finite bound draw');draws.add(sample.name);
      }
    }
    if(mode==='xxxx'){assert.ok(births.has('RWT_COMBO_X_SHELL'));assert.ok(draws.has('RWT_X_Shell'));}
    if(mode==='airzxx'){
      for(const name of ['RWT_DASH_JUMP_COMBO_ZX','RWT_DASH_JUMP_COMBO_ZXX']){
        assert.ok(births.has(name));
        for(const [key,entry]of Object.entries(source.effectClosure.damageEffects[name]))if(/^PASSIVE_PARTICLE\d+$/.test(key))
          assert.ok([...quadDraws].some(draw=>draw.startsWith('native-particle:'+entry.PARTICLE_NAME+'|')),name+'/'+entry.PARTICLE_NAME+' source passive actually draws');
      }
    }
    if(mode==='airxxxx'){assert.ok(births.has('DAMAGE_EFFECT_DASH_JUMP_X_BULLET_LOOP'));assert.ok(draws.has('RVC_C_dashJumpX_bullet_M01'));}
    assert.deepEqual(view.proof().unsupported,[],mode+' no renderer binding/closure notes');
    observations.push({mode,facing,states:Object.fromEntries(states),draws:[...draws],quadDraws:[...quadDraws]});
  }
  t.diagnostic(JSON.stringify(observations));
});

test('VC projectile commands without original trace fields do not receive invented sword or claw strips',async t=>{
  const {body,manager,clawEnabled}=await setup(t);
  for(const state of ['RWT_COMBO_X','RSI_WEAPON_TAKER_COMBO_XX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX','RVC_DASH_JUMP_COMBO_XX_LOOP']){
    manager.clear();const {a}=vcFixture({passives:[]});Object.assign(a,{state,animationName:vcProfile.states[state].animationName,skillId:null});
    assert.equal(source.states[state]?.fields.SLASH_TRACE,undefined);assert.equal(source.states[state]?.fields.UNIT_SLASH_TRACE0,undefined);
    for(let frame=0;frame<20;frame++){a.animationTime=frame/60;sampleAnimation(body,a.animationName,a.animationTime,false);placeActor(body,a);manager.step({actors:[a],dt:1/60,clawEnabled});}
    assert.equal(manager.proof().channels.length,0,state);
  }
});

test('normal sampled Z-chain input reaches actual displayed sword strips and returns to bounded idle storage',async t=>{
  const {scene,body,manager,clawEnabled}=await setup(t);const observations=[];
  for(const facing of [-1,1]){
    manager.clear();const {sim,a}=vcFixture({passives:[],position:[-500*facing,3080,0],gap:20000,facing});
    sim.drainEvents();const input=createInputBuffer({sampledLevels:true}),seen=new Map();let peakMeshes=0;
    for(let frame=0;frame<360;frame++){
      const at=sim.state.time+.001;
      if(frame<100){if(frame%2===0)input.down('Z',at);else input.up('Z',at);}else input.up('Z',at);
      sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});sim.drainEvents();
      sampleAnimation(body,a.animationName,a.animationTime,a.animationLoop,a.presentationTransition);placeActor(body,a);
      manager.step({actors:[a],dt:1/60,clawEnabled});
      const live=scene.meshes.filter(mesh=>mesh.name.startsWith('rf-trail-')&&mesh.isEnabled());
      peakMeshes=Math.max(peakMeshes,scene.meshes.filter(mesh=>mesh.name.startsWith('rf-trail-')).length);
      if(live.length&&!seen.has(a.state))seen.set(a.state,{frame,animationTime:a.animationTime,drawMeshes:live.length});
    }
    for(const state of ['RSI_COMBO_Z','RSI_COMBO_ZZ','RSI_COMBO_ZZZ','RSI_COMBO_ZZZZ'])assert.ok(seen.has(state),state+' source input/main render');
    assert.equal(a.state,'RSI_WAIT');assert.equal(peakMeshes,4);assert.ok(manager.proof().channels.every(channel=>!channel.visible));
    assert.ok(manager.proof().channels.every(channel=>channel.vertices<=400),'source local vertex cap remains bounded after tail expiry');
    observations.push({facing,firstVisibleByState:Object.fromEntries(seen),peakMeshes});
  }
  t.diagnostic(JSON.stringify(observations));
});

test('repeated actual Z and ZZXX chains keep source-sized buffers and remove every invalid actor mesh',async t=>{
  const {scene,body,manager,clawEnabled}=await setup(t);
  const {sim,a}=vcFixture({passives:[],position:[-500,3080,0],gap:20000});
  sim.drainEvents();const input=createInputBuffer({sampledLevels:true}),cycles=[];let firstClaw=null;
  for(let cycle=0;cycle<12;cycle++){
    const seen=new Set();let peakChannels=0,peakMeshes=0;
    for(let frame=0;frame<240;frame++){
      const at=sim.state.time+.001;
      // Source EventProcess permits Z during first slash, then X before the
      // second-slash .39 boundary and the claw's .6 boundary. Inputs still
      // enter through the same sampled browser buffer and native command WASM.
      const claw=cycle%2===1,key=claw&&a.state!=='RSI_WAIT'&&a.state!=='RSI_COMBO_Z'?'X':'Z';
      input.up(key==='Z'?'X':'Z',at);
      if(frame<100&&frame%2===0)input.down(key,at);else{input.up('Z',at);input.up('X',at);}
      sim.step(1/60,{vc:input.consume(sim.state.time+1/60)},{snapshot:false});sim.drainEvents();
      sampleAnimation(body,a.animationName,a.animationTime,a.animationLoop,a.presentationTransition);placeActor(body,a);
      manager.step({actors:[a],dt:1/60,clawEnabled});const proof=manager.proof();
      assert.ok(proof.channels.every(channel=>channel.vertices<=400),'source local cap');
      peakChannels=Math.max(peakChannels,proof.channels.length);
      peakMeshes=Math.max(peakMeshes,scene.meshes.filter(mesh=>mesh.name.startsWith('rf-trail-')).length);
      if(proof.channels.some(channel=>channel.visible)){seen.add(a.state);if(cycle===1&&a.state==='RSI_COMBO_ZZX'&&!firstClaw)firstClaw={frame,animationTime:a.animationTime};}
    }
    const proof=manager.proof();assert.equal(a.state,'RSI_WAIT');assert.ok(proof.channels.every(channel=>!channel.visible));
    if(cycle%2){assert.ok(seen.has('RSI_COMBO_ZZX'));assert.ok(seen.has('RSI_COMBO_ZZXX'));}
    else assert.ok(seen.has('RSI_COMBO_ZZZZ'));
    assert.ok(peakChannels<=4);assert.ok(peakMeshes<=8);
    cycles.push({cycle,peakChannels,peakMeshes,retainedChannels:proof.channels.length});
  }
  // Default mixed quality retires claw channels after their source fade;
  // the major sword retains its two bounded channels across idle.
  assert.ok(cycles.every(cycle=>cycle.retainedChannels===2));
  assert.ok(cycles.filter(cycle=>cycle.cycle%2===0).every(cycle=>cycle.peakMeshes===4));
  assert.ok(cycles.filter(cycle=>cycle.cycle%2===1).every(cycle=>cycle.peakMeshes===8));
  manager.step({actors:[],dt:1/60,clawEnabled});assert.equal(manager.proof().channels.length,0);
  assert.equal(scene.meshes.filter(mesh=>mesh.name.startsWith('rf-trail-')).length,0);
  t.diagnostic(JSON.stringify({cycles,firstClaw,removedActorChannels:0,removedActorMeshes:0}));
});
