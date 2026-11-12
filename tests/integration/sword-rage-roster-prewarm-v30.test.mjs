import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import {collectEffectTemplates,collectSwordCallbackTemplates,collectSwordCallbackQuadCopies} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const names=['MonsterAngryWind','Counter_Particle01'];
for(const id of ['LK','RS','IS'])test(id+' compiled destruction callbacks are ready without an equipped skill',()=>{
  const index=JSON.parse(readFileSync(new URL('../../artifacts/'+id.toLowerCase()+'/fx/index.json',import.meta.url)));
  const roots=collectEffectTemplates(getProfessionProfile(id),index,[]);
  for(const name of names)assert.ok(roots.has(name),name);
  assert.ok(roots.has('MonsterAngryWind_AttackBox'),'actual damage callback main resource');
  for(const mode of ['vitality','demolition'])for(let i=1;i<=5;i++)
    assert.ok(roots.has(`elswrod_${mode}_end_0${i}`),'first mode exit: '+mode+' end '+i);
  const copies=collectSwordCallbackQuadCopies(getProfessionProfile(id),index,4);
  assert.equal(copies.get('elswrod_vitality_wake_01'),8,'two overlapping source entries per owner');
  assert.equal(copies.get('elswrod_demolition_end_01'),4,'one original exit sequence per owner');
});

test('four LK source mode transitions start and retire without allocating cold End planes',async t=>{
  const source=JSON.parse(readFileSync(new URL('../../artifacts/lk/fx/index.json',import.meta.url))),profile=getProfessionProfile('LK');
  const callbacks=collectSwordCallbackTemplates(profile,source),before=JSON.stringify(source),engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('sword-transition-camera',new Vector3(0,0,10),scene);
  const index={templates:Object.fromEntries([...callbacks].filter(name=>source.templates[name].kind==='particle')
    .map(name=>[name,{...source.templates[name],textures:{},untexturedPlane:true}]))};
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  const sim=createSimulation({profile,map:{sceneId:'source-sword-transitions',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}]},
    preset:{loadout:Array(8).fill(null),passives:[],guildPassives:[]},actors:Array.from({length:4},(_,i)=>({id:'p'+i,professionId:'LK',team:i<2?0:1,x:i*100,y:0,loadout:Array(8).fill(null)}))});
  let view;
  try{
    view=await createEffectsView({scene,engine,index,profile,samplers:{}});await view.prewarmActors(sim.state.actors);
    const initial={meshes:scene.meshes.length,materials:scene.materials.length,slots:view.proof().quadDrawSlots};
    const dispatch=()=>{for(const event of sim.drainEvents())view.event(event,sim.state);};dispatch();
    for(const mode of [-2,2,0]){
      for(const actor of sim.state.actors)sim.prepareWayOfSword(actor.id,mode);dispatch();
      for(let frame=0;frame<180;frame++){sim.step(1/60,{}, {snapshot:false});dispatch();view.step(1/60,sim.state);view.render();}
      assert.deepEqual({meshes:scene.meshes.length,materials:scene.materials.length,slots:view.proof().quadDrawSlots},initial,'mode '+mode);
    }
    assert.equal(view.count,0);assert.equal(view.proof().activeEffectParents,0);
    assert.equal(JSON.stringify(source),before,'original callback declarations unchanged');
  }finally{view?.clear();scene.dispose();engine.dispose();}
});
test('four LK owners prewarm all authored pulse passes; synchronous real entries allocate no additional planes',async t=>{
  const source=JSON.parse(readFileSync(new URL('../../artifacts/lk/fx/index.json',import.meta.url))),engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('rage-prewarm-camera',new Vector3(0,0,10),scene);
  // Source timing/capacity/draw declarations remain exact. Controlled shader
  // readiness and texture-free quads isolate allocation; no GPU claim here.
  const index={templates:Object.fromEntries(names.map(name=>[name,{...source.templates[name],textures:{},untexturedPlane:true}]))};
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});
  const profile=getProfessionProfile('LK'),actors=Array.from({length:4},(_,i)=>({id:'p'+i,professionId:'LK',state:'ESSI_DESTRUCTION_RAGE',stateSerial:1,hp:1,
    x:i*100,y:0,z:0,facing:1,landPosition:[i*100,0,0],loadout:Array(8).fill(null),awakening:{remaining:0}}));
  let view;
  try{
    view=await createEffectsView({scene,engine,index,profile,samplers:{}});await view.prewarmActors(actors);
    const state={time:0,actors,effects:[]},initial={meshes:scene.meshes.length,materials:scene.materials.length,slots:view.proof().quadDrawSlots};
    assert.equal(initial.slots,12,'4 owners times original 1+2 draw passes');
    for(const a of actors)view.event({type:'destructionRageStarted',actorId:a.id,ownerStateSerial:2,time:0,eventId:100+Number(a.id.slice(1)),position:[a.x,80,0],particles:names},state);
    for(let f=0;f<90;f++){state.time+=1/60;view.step(1/60,state);view.render();}
    assert.deepEqual({meshes:scene.meshes.length,materials:scene.materials.length,slots:view.proof().quadDrawSlots},initial);
    assert.equal(view.count,0);assert.equal(view.proof().destructionRage.bursts,4);
    await view.prewarmActors(actors.slice(0,2));assert.equal(view.proof().quadDrawSlots,12,'smaller later roster reuses existing slots');
  }finally{view?.clear();scene.dispose();engine.dispose();}
});
