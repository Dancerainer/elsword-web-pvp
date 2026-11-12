import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionSamplers} from '../../packages/combat-assets/profession-samplers.mjs';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
import {effectiveProfessionFlags,selectEnabledProfession} from '../../packages/professions/catalog.mjs';

test('per actor sphere, motion and effect sampling uses that profession and rejects missing libraries',()=>{
  const methods=['collisionSampler','defenderSampler','motionOffsetSampler','effectAnchorSampler','effectSampler','effectBoneSampler','nasodAttackSampler'];
  const fixture=id=>Object.fromEntries(methods.map(key=>[key,(...args)=>({id,key,args})]));
  const samplers=createProfessionSamplers({RF:fixture('RF'),LK:fixture('LK')}),actor={professionId:'LK'},effect={name:'original'};
  assert.equal(samplers.collisionSampler(actor).id,'LK');assert.equal(samplers.defenderSampler(actor).id,'LK');assert.equal(samplers.motionOffsetSampler(actor).id,'LK');
  assert.equal(samplers.effectSampler(effect,actor).id,'LK');assert.equal(samplers.effectAnchorSampler(effect,actor).id,'LK');assert.equal(samplers.effectBoneSampler(effect,actor,'Bip01').id,'LK');
  assert.equal(samplers.collisionSampler({}).id,'RF');assert.throws(()=>samplers.defenderSampler({professionId:'unknown'}),/Missing profession/);
});
test('mixed profession effects route owner events, keep separate clocks and prepare both frozen loadouts',async()=>{
  const calls=[],fixture=id=>({event:(event,state)=>calls.push([id,'event',event.type,state.actors.length]),step:(dt,state)=>calls.push([id,'step',state.actors.map(a=>a.id),state.effects.map(e=>e.id)]),
    render(){},clear(){},prewarm:async slots=>calls.push([id,'slots',slots]),prewarmActors:async actors=>calls.push([id,'prepare',actors.map(a=>a.id)]),cancelDamagedOwner:id2=>calls.push([id,'cancel',id2]),count:id==='RF'?2:3,
    performance:()=>({fxMeshesLive:1,fxEffectQuality:'medium'}),sourceMeshClocks:()=>[],proof:()=>({})});
  const effects=createProfessionEffects({RF:fixture('RF'),LK:fixture('LK')},'LK'),state={actors:[{id:'r',professionId:'RF'},{id:'l',professionId:'LK'}],effects:[{id:4,ownerId:'r'},{id:5,ownerId:'l'}]};
  effects.event({type:'effectStarted',effectId:5,actorId:'l'},state);effects.event({type:'effectEnded',effectId:5},state);
  assert.deepEqual(calls.slice(0,2),[['LK','event','effectStarted',2],['LK','event','effectEnded',2]]);
  effects.step(1/60,state);assert.deepEqual(calls.slice(2,4),[['RF','step',['r'],[4]],['LK','step',['l'],[5]]]);
  await effects.prewarmActors(state.actors);assert.deepEqual(calls.slice(4,6),[['RF','prepare',['r']],['LK','prepare',['l']]]);
  effects.event({type:'hit',actorId:'r',targetId:'l',deleteDamageReactEffects:true},state);assert.deepEqual(calls.slice(6,8),[['RF','cancel','l'],['LK','cancel','l']]);
  assert.equal(effects.count,5);assert.equal(effects.performance().fxMeshesLive,2);
});
test('disabled choice follows effective flags and alloff RF fallback without changing raw GM flags',()=>{
  const flags={RF:false,LK:false};assert.deepEqual(effectiveProfessionFlags(flags),{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.deepEqual(flags,{RF:false,LK:false});
  assert.equal(selectEnabledProfession('LK',flags),'RF');assert.equal(selectEnabledProfession('RF',{RF:false,LK:true}),'LK');
});

test('naturally retired effects release routing records after their independent visuals finish',()=>{
  const parents=new Set(),view={event:e=>parents.add(e.effectId),step(){},hasEffect:id=>parents.has(id),performance:()=>({})};
  const effects=createProfessionEffects({RF:view}),state={actors:[{id:'r',professionId:'RF'}],effects:[]};
  for(let i=0;i<1000;i++)effects.event({type:'effectStarted',actorId:'r',effectId:i},state);
  effects.step(1/60,state);assert.equal(effects.performance().fxEffectOwners,1000,'visual tails still own their routing');
  parents.clear();state.effects=[{id:999,ownerId:'r'}];effects.step(1/60,state);
  assert.equal(effects.performance().fxEffectOwners,1,'a live combat record can emit later particles');
  state.effects=[];effects.step(1/60,state);assert.equal(effects.performance().fxEffectOwners,0);
});
