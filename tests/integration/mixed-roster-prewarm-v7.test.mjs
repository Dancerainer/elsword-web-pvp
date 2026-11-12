import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const json=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const roster=()=>[
  {id:'rf',professionId:'RF',team:0,loadout:[{skillId:24010}]},
  {id:'ally1',professionId:'LK',team:0,loadout:[]},
  {id:'ally2',professionId:'LK',team:0,loadout:[]},
  ...Array.from({length:3},(_,i)=>({id:'enemy'+i,professionId:'LK',team:1,loadout:[]})),
];

test('profession wrapper filters caster loadouts while preserving the complete frozen target roster',async()=>{
  const actors=roster(),calls=[];
  const view=id=>({prewarmActors:async(casters,options)=>calls.push({id,casters,options})});
  const effects=createProfessionEffects({RF:view('RF'),LK:view('LK')});
  await effects.prewarmActors(actors);
  assert.deepEqual(calls.map(({id,casters})=>[id,casters.map(actor=>actor.id)]),[
    ['RF',['rf']],['LK',['ally1','ally2','enemy0','enemy1','enemy2']],
  ]);
  for(const {options}of calls)assert.equal(options.targetActors,actors,'both pools must count the same original roster');
});

test('real RF HIT model pool covers all mixed profession enemies and keeps legacy direct prewarm compatible',async t=>{
  const profile=json('packages/combat-core/rf-profile.json'),indexSource=json('artifacts/rf/fx/index.json');
  const template=indexSource.templates.RF_HitP04;
  const pose=json('artifacts/rf/'+template.poseData);
  // Keep actual target cap/trigger/draw and original damage descendant roots.
  // The source-bound budget is9 contacts*2 medium8 particles*2 draws per enemy.
  assert.deepEqual([template.fields.NumParticles,template.fields.TriggerCount,template.fields.DrawCount],[10,10,2]);
  const damage=profile.damageEffects.DamageEffect_SA_RRF_XCrash_Fire_Damage.raw;
  assert.equal(damage.DAMAGE_DATA.HIT_GAP,.07);assert.equal(damage.DAMAGE_DATA.RE_ATTACK,1);
  const mainName=damage.MAIN_EFFECT_NAME,skillIndex=json('artifacts/rf/skill-fx-v11/index.json');
  const main=skillIndex.templates[mainName]??indexSource.templates[mainName];
  assert.equal(main.fields.LifeTime,.36);
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('mixed-roster-pool',new Vector3(20,32,85),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_base,file,target)=>loadPoseContainer(target,
    fileURLToPath(new URL('../../artifacts/rf/'+file,import.meta.url))));
  const rf=await createEffectsView({scene,engine,profile,index:{templates:{RF_HitP04:template,
    [mainName]:{...main,glb:undefined,fields:{...main.fields,DrawCount:0}}}},effectPoses:{[template.poseData]:pose},
    samplers:{},effectQuality:{level:'medium',particleDivisor:8}});
  try{
    const effects=createProfessionEffects({RF:rf,LK:{prewarmActors:async()=>{}}});
    const actors=roster();await effects.prewarmActors(actors);
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,108,'one RF caster sees all3 LK enemies, not fallback1');
    assert.equal(rf.proof().meshInstances,108);
    await effects.prewarmActors(actors);assert.equal(rf.proof().meshInstances,108,'stable roster reuses the prepared pool');
    actors[1]={...actors[1],professionId:'RF',loadout:[{skillId:24010}]};
    await rf.prewarmActors(actors);
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,216,'legacy one-argument direct use counts all3 enemies for each of the2 selected loadouts');
    await effects.prewarmActors(actors);
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,216,'two RF casters each receive the full opposing3-target budget');
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.rosterActors,2);
    assert.equal(rf.proof().meshInstances,216);
    await rf.prewarmActors(actors.filter(actor=>actor.professionId==='RF'),{targetActors:actors.map(actor=>({...actor,team:undefined}))});
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,360,'unknown target teams conservatively include5 others, excluding cloned self by frozen actorID');
    assert.equal(rf.proof().meshInstances,360);
    await rf.prewarmActors(actors.map(actor=>({...actor,professionId:'RF',loadout:actor.professionId==='RF'?actor.loadout:[]})));
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,360,'published pool capacity retains its previous highwater budget');
    assert.equal(rf.proof().meshInstances,360,'a smaller later demand retains the reusable prepared pool');
    rf.clear();assert.equal(rf.releaseBurstPools(),358);
    assert.equal(rf.performance().fxPoolResident,2,'retire unused roster bursts, retaining the two original draw passes');
    assert.equal(rf.proof().meshPoolBudgets.RF_HitP04.views,2);
    await effects.prewarmActors(roster());
    assert.equal(rf.performance().fxPoolResident,108,'the next real frozen roster recovers its exact original budget');
    t.diagnostic(JSON.stringify({source:'actual RF_HitP04 GLB/pose + frozen XCrash contacts',mixedEnemyCount:3,
      oneRFCasterViews:108,twoRFCasterViews:216,unknownTeamBasicViews:360,gpuMeasured:false}));
  }finally{rf.clear();scene.dispose();engine.dispose();}
});
