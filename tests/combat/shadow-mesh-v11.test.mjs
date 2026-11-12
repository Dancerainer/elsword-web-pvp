import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createShadowMesh,stepShadowMesh,refreshShadowMeshLand,allowDieDamageChild} from '../../packages/combat-core/shadow-mesh.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
const f=Math.fround;
const grenade='RVC_C_ShadowBackSlide_grenade_M01_1',diecheck='SHADOW_BURSTER_DIE_CHECK';
const fields={LifeType:'LT_TIME',LifeTime:1.2,MeshType:'X_SKIN_MESH',UseLand:true,ElasticCoeff:.5,ElasticCoeff_X:.5,Gravity:[0,-2000,0]};
const mesh=(extra={})=>createShadowMesh({name:grenade,position:[100,250,0],velocity:[-100,-1000,0],landY:0,fields,...extra});

test('original mesh .125 packet applies old velocity plus half gravity, not particle prepared-packet order',()=>{
  const s=mesh();stepShadowMesh(s,.125);
  // Independent binary32 source equation at .cpp:1675..1684; all products
  // here are exact binary fractions and have literal closed-form answers.
  assert.deepEqual(s.position,[87.5,109.375,0]);assert.deepEqual(s.velocity,[-100,-1250,0]);
  assert.equal(s.nowLifeTime,.125);assert.equal(s.globalTime,.125);assert.equal(s.animationTime,.125);
  const left=mesh({facing:-1});stepShadowMesh(left,.125);assert.deepEqual(left.position,[112.5,109.375,0]);
});
test('source bounce carries its residual displacement and halves mesh animation speed',()=>{
  const s=mesh({position:[100,20,0]});stepShadowMesh(s,.125);
  assert.deepEqual(s.position,[87.5,0,0]);assert.deepEqual(s.velocity,[-50,625,0]);
  assert.deepEqual(s.velocityAccum,[-6.25,78.125,0]);assert.equal(s.animationSpeed,.5);assert.equal(s.animationTime,.0625);
  // .h:1302 + .cpp:1758/1768 residual is retained into the next RunEvent.
  // 0 + 78.125 + 625*.125 + .5*(-2000)*.125^2 = 140.625.
  stepShadowMesh(s,.125);assert.deepEqual(s.position,[75,140.625,0]);assert.deepEqual(s.velocity,[-50,375,0]);
  assert.equal(s.animationTime,.125);
});
test('source inclusive -50 vertical and +/-10 horizontal stop thresholds are preserved',()=>{
  const s=mesh({position:[0,1,0],velocity:[10,-50,0],fields:{...fields,Gravity:[0,0,0]}});
  stepShadowMesh(s,.125);assert.deepEqual(s.position,[1.25,0,0]);assert.deepEqual(s.velocity,[0,0,0]);
  assert.equal(s.elasticX,0);assert.equal(s.animationSpeed,0);assert.equal(s.animationTime,0);
});
test('RunEvent uses rounded global clock delta while gravity still uses elapsed',()=>{
  const s=mesh({position:[0,250,0],velocity:[123,0,0],fields:{...fields,Gravity:[0,0,0]}});
  s.globalTime=1;s.nowLifeTime=1;stepShadowMesh(s,1/60);
  const delta=f(f(1+f(1/60))-1);assert.equal(s.position[0],f(123*delta));
  assert.notEqual(s.position[0],f(123*f(1/60)));
});
test('crash reads old position in next packet, sets life=max, and expiry takes priority',()=>{
  const opts={name:diecheck,position:[100,1,0],velocity:[0,-1000,0],fields:{...fields,LifeTime:.95,CrashLand:true,ElasticCoeff_X:0,Gravity:[0,0,0]}};
  const s=mesh(opts);stepShadowMesh(s,.125);assert.equal(s.position[1],0);assert.equal(s.deathReason,null);
  stepShadowMesh(s,.125);assert.equal(s.deathReason,'template-land-crash');assert.equal(s.nowLifeTime,f(.95));
  const expired=mesh(opts);expired.nowLifeTime=f(.95);expired.position[1]=0;stepShadowMesh(expired,.125);
  assert.equal(expired.deathReason,'template-life-time');assert.throws(()=>stepShadowMesh(expired,.125),/Ended/);
});
test('land query preserves native 30/90 radius and fresh -1 index; no fabricated nearest plane',()=>{
  const calls=[],geometry={land:query=>{calls.push(query);return {found:true,point:[query.position[0],125,0]};}};
  const s=mesh();assert.equal(refreshShadowMeshLand(s,geometry).radius,30);assert.equal(s.landY,125);
  assert.deepEqual(Object.keys(calls[0]).sort(),['position','radius']);
  const crash=mesh({name:diecheck,fields:{...fields,CrashLand:true,ElasticCoeff_X:0}});
  assert.equal(refreshShadowMeshLand(crash,geometry).radius,90);
  const noFallback=refreshShadowMeshLand(s,{land:()=>({found:false,rawPoint:[0,-1,0]})});
  assert.equal(noFallback.supported,false);assert.match(noFallback.reason,/GetNearest_LUA/);assert.equal(s.landY,125);
  refreshShadowMeshLand(crash,{land:()=>({found:false,rawPoint:[0,-1,0]})});assert.equal(crash.landY,-1);
  assert.equal(refreshShadowMeshLand(mesh(),null).supported,false);
});
test('LAND_CRASH_ONLY / LIFE_TIME_ONLY use the original IsDyingByCrash OR truth table',()=>{
  for(const reason of ['template-land-crash','template-life-time','hit-limit']){
    const crash=reason==='template-land-crash';
    assert.equal(allowDieDamageChild({LAND_CRASH_ONLY:1},reason),crash);
    assert.equal(allowDieDamageChild({LIFE_TIME_ONLY:1},reason),!crash);
    assert.equal(allowDieDamageChild({LAND_CRASH_ONLY:1,LIFE_TIME_ONLY:1},reason),true);
    assert.equal(allowDieDamageChild({},reason),true);
  }
});
test('missing source fields, nonfinite vectors, unsupported rotations and corrupt snapshots fail closed',()=>{
  for(const extra of [{landY:undefined},{velocity:[1,NaN,0]},{position:[1,2]},{landY:1e50},{rotation:[0,1,0]},
    {fields:{...fields,LifeTime:0}},{fields:{...fields,Gravity:'random'}},{fields:{...fields,MeshType:'X_MESH'}},
    {events:[{property:'Velocity',start:.1,end:.1,fade:false,value:[0,1,0]}]},{events:[{property:'AniSpeed',start:0,end:0,fade:false,value:2}]}])assert.throws(()=>mesh(extra));
  for(const [key,value] of [['globalTime',NaN],['gravity',[0,Infinity,0]],['animationSpeed',Infinity],['facing',0],['maxLifeTime',-1]]){
    const s=mesh();s[key]=value;assert.throws(()=>stepShadowMesh(s,.125));
  }
  assert.throws(()=>stepShadowMesh(mesh(),0));assert.throws(()=>refreshShadowMeshLand(mesh(),{land:()=>({found:true,point:[0,NaN,0]})}));
});

const project=fileURLToPath(new URL('../../',import.meta.url)),fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
const read=file=>JSON.parse(readFileSync(resolve(file.startsWith('artifacts/')?fixtureRoot:project,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
test('fixed source contract pins complete input bytes, bounded consumer spans and all four target declarations',()=>{
  const contract=read('contracts/rf-shadow-mesh-source-v11.json');assert.equal(contract.targetClientMeasured,false);
  for(const file of contract.referenceFiles){const bytes=readFileSync(resolve(fixtureRoot,'.cache/native-source-runtime',file.relativePath));
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    const lines=bytes.toString('latin1').match(/[^\n]*\n|[^\n]+$/g);
    for(const span of file.fragments){const fragment=Buffer.from(lines.slice(span.start-1,span.end).join(''),'latin1');
      assert.equal(fragment.length,span.bytes);assert.equal(createHash('sha256').update(fragment).digest('hex'),span.sha256);}
  }
  for(const [name,decl] of Object.entries(contract.target.meshDeclarations))assert.deepEqual(decl,profile.effectTemplates[name]);
  for(const [name,decl] of Object.entries(contract.target.damageDeclarations))assert.deepEqual(decl,profile.damageEffects[name]);
});
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const index=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),mergeVisualEffectIndexes(read('artifacts/rf/fx/index.json'),read('artifacts/rf/buff-fx/index.json'),read('artifacts/rf/shadow-weapon-fx/index.json'),read('artifacts/rf/skill-fx-v11/index.json')));
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read('artifacts/rf/'+p)]));
async function make(facing=1){const n=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,
  loadBinary:file=>readFileSync(resolve(fixtureRoot,'artifacts/native',file))});
  const queries=[],geometry={...n.geometry,land:q=>{queries.push(structuredClone(q));return n.geometry.land(q);}};
  const s=createSimulation({profile,map,preset:{...preset,loadout:[{skillId:24217},null,null,null,null,null,null,null]},
    actors:[{id:'rf',team:0,position:[2022.98,2840,0],lineId:6,facing},{id:'target',team:1,position:[1000,2340,0],lineId:8,facing:-facing}],
    ...createNativeSamplers({profile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex:index,effectPoses:poses}),
    nativeGeometry:geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,nativeNasod:n.nasod,nativeCritical:n.critical,versions:n.versions});
  return {s,queries};
}
for(const facing of [1,-1])test(`actual Shadow24217 X facing${facing}: core/render share four-mesh motion; exclusive death successor and JSON resume`,async()=>{
  const {s,queries}=await make(facing),a=s.actor('rf'),visualNotes=[],visual=createEffectRuntime({index,onUnsupported:n=>visualNotes.push(n)});
  const emitterByEffect=new Map(),births=new Map(),ends=new Map(),children=[],savedDamageAnchors=new Map();
  function present(){for(const ev of s.drainEvents()){
    if(ev.type==='effectStarted'&&ev.sourceShadowMesh){const e=s.state.effects.find(e=>e.id===ev.effectId);
      if(e){births.set(e.id,{name:e.mainEffectName,position:[...e.birthAnchor.position],landY:e.sourceDamageLandY});
        const emitter=visual.add(e.mainEffectName,{position:e.birthAnchor.position,facing:e.birthAnchor.facing,
          sourceControl:state=>state.effects.find(x=>x.id===ev.effectId)?.sourceShadowMesh});emitterByEffect.set(e.id,emitter.id);}}
    if(ev.type==='effectEnded'){ends.set(ev.effectId,ev);const emitter=emitterByEffect.get(ev.effectId);if(emitter)visual.stop(emitter,true);}
    if(ev.type==='damageSecondaryCreated'){
      children.push(ev);const parent=births.get(ev.parentEffectId);
      if(parent){assert.deepEqual(ev.position,savedDamageAnchors.get(ev.parentEffectId),'.cpp:1886/5955 previous live CEffect position');
        const child=s.state.effects.find(e=>e.id===ev.effectId);
        if(child?.sourceShadowMeshPending)assert.equal(child.sourceMeshInheritedLandY,Math.min(parent.landY,ev.position[1]),'.cpp:6033 original CEffect birth plane');}
    }
  }visual.step(1/60,s.state);
    for(const e of s.state.effects.filter(e=>e.sourceShadowMesh)){
      assert.deepEqual(e.currentAnchor.position,e.sourceShadowMesh.position);assert.equal(e.animationTime,e.sourceShadowMesh.animationTime);
      savedDamageAnchors.set(e.id,[...e.sourceDamageAnchor.position]);
      const emitter=emitterByEffect.get(e.id),p=[...visual.particles.values()].find(p=>p.emitterId===emitter);
      assert.ok(p);assert.deepEqual(p.position,e.currentAnchor.position);assert.equal(p.meshAnimationTime,e.animationTime);
    }
  }
  function step(input={}){s.step(1/60,input,{snapshot:false});present();}
  step({pressed:['A']});for(let i=0;i<14;i++)step();step({pressed:['X']});assert.equal(a.state,'RSI_SHADOW_STEP_X_UPGRADE');
  for(let i=0;i<8;i++)step();
  const bombNames=[...births.values()].map(v=>v.name).filter(n=>n.startsWith('RVC_C_ShadowBackSlide_grenade_'));
  assert.deepEqual(bombNames.sort(),[1,2,3].map(n=>'RVC_C_ShadowBackSlide_grenade_M01_'+n));
  assert.ok(queries.some(q=>q.radius===30&&!Object.hasOwn(q,'lastLineId')));
  // Snapshot is current simulated state, never an independent target gold.
  const restored=(await make(facing)).s;restored.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<180;i++){step();restored.step(1/60,{}, {snapshot:false});restored.drainEvents();}
  assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(restored.snapshot())));
  assert.ok(queries.some(q=>q.radius===90));assert.ok(queries.filter(q=>q.radius===90).every(q=>!Object.hasOwn(q,'lastLineId')));
  const dieIds=[...births].filter(([,b])=>b.name===diecheck).map(([id])=>id);assert.equal(dieIds.length,3);
  for(const id of dieIds){assert.ok(ends.has(id));const reason=ends.get(id).reason;
    assert.ok(['template-land-crash','template-life-time'].includes(reason));const successors=children.filter(e=>e.parentEffectId===id);
    assert.equal(successors.length,1,'One death reason selects exactly one original declared child');
    assert.equal(successors[0].name,reason==='template-land-crash'?'DAMAGE_EFFECT_SHADOW_BURSTER_Flame_Damage':'DAMAGE_EFFECT_SHADOW_BURSTER_EXPLOSION');
  }
  assert.ok([...ends.values()].some(e=>e.reason==='template-land-crash'));
  assert.equal(visual.count,0);assert.ok(!visualNotes.some(n=>n.id.endsWith(':land')));assert.equal(a.skillId,null);
});

test('shared sampler cardinal facing yaw is consumed once by the bounded Shadow movement basis',()=>{
 for(const facing of [1,-1]){
  const old=mesh({facing}),explicit=mesh({facing,rotation:[0,facing<0?180:0,0]});
  for(let i=0;i<5;i++){stepShadowMesh(old,.125);stepShadowMesh(explicit,.125);assert.deepEqual(explicit,old);}
 }
 assert.throws(()=>mesh({facing:-1,rotation:[0,90,0]}));
 assert.throws(()=>mesh({facing:1,rotation:[0,180,0]}));
});
