/** Execute production roster, lazy mirror and control boundaries. Web policy
 * expectations come from the player's request, not a target-client replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {practiceActors as pairedPracticeActors} from '../../apps/web/map-runtime.mjs';
import {preparePracticeTarget,restorePracticeResources} from '../../apps/web/practice-resources.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const roster=source.split('\n').find(line=>line.startsWith('const practiceActors='));
const body=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const map={spawns:[{kind:'SetTeamStartPos',position:[0,0,0],lineId:0,facingRight:true},{kind:'SetTeamStartPos',position:[200,0,0],lineId:0,facingRight:false}],
  lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
test('only ordinary practice requests the same-profession9999999HP mirror; online boot keeps its one fixture',()=>{
  const id='RF',c={pairedPracticeActors,createSimulation,getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS,
    commonBuffs:null,mapManifest:map,professionAssets:new Map([[id,{manifest:{referenceVersion:'fixture'}}]]),
    simulationSamplers:{},nativeRuntime:{versions:{}},currentMapVersions:{},preparePracticeTarget};
  vm.createContext(c);vm.runInContext(roster+'\n'+body('function createPracticeSimulation(','async function loadAllProfessionPreferences('),c);
  const boot=c.createPracticeSimulation(id);assert.equal(boot.state.actors.length,1);
  const sim=c.createPracticeSimulation(id,undefined,{includeTarget:true}),[a,b]=sim.state.actors;
  assert.equal(sim.state.actors.length,2);assert.equal(a.professionId,b.professionId);assert.equal(b.hp,9999999);assert.equal(b.hpMax,9999999);
  assert.notEqual(a.hpMax,9999999);a.mp=0;b.mp=1;a.cooldowns={21000:9};b.cooldowns={21000:7};
  const before=sim.snapshot();restorePracticeResources(sim);assert.ok(sim.state.actors.every(a=>a.mp===a.mpMax&&Object.values(a.cooldowns).every(n=>n===0)));
  sim.restore(before);assert.equal(sim.state.actors[0].mp,0);assert.equal(sim.state.time,before.time);
});
test('practice mirror reuses one loaded body/pose, creates no foreign profession and caches the clone',async()=>{
  const own={root:{setEnabled(){}},meshes:[]},group=new Map([['player-1',own]]),views=new Map(group),calls=[];
  const assets={bodyContainer:{body:true},characterPose:{pose:true}},c={pairedPracticeActors,mapManifest:map,professionId:'RF',
    professionAssets:new Map([['RF',assets]]),professionPracticeViews:new Map([['RF',group]]),views,
    scheduleRenderPreparation:fn=>Promise.resolve(fn()),styleCharacter(){},styleNasodCore:x=>x,
    createView(container,name,pose){assert.equal(container,assets.bodyContainer);assert.equal(pose,assets.characterPose);calls.push(name);
      return {root:{setEnabled(){}},meshes:[],dispose(){assert.fail('a published mirror must remain resident');}};}};
  vm.createContext(c);vm.runInContext(roster+'\n'+body('async function preparePracticeTargetView(','async function prepareActorCostume('),c);
  await c.preparePracticeTargetView();await c.preparePracticeTargetView();
  assert.equal(calls.length,1);assert.equal(group.size,2);assert.equal(views.size,2);
});
test('normal-player reset/resource controls execute, while GM-only diagnostics and nonpractice states stay gated',()=>{
  const line=source.split('\n').find(line=>line.includes('button.onclick=(...args)')&&line.includes('practiceControlIds.has(id)'));
  assert.ok(line,'install the real role wrappers');
  for(const role of ['player','gm'])for(const mode of ['practice','online','lobby']){
    const calls=[],ids=['reset','restore-resources','target-attack','prepare-awakening','pause','prepare-death'];
    const controls=new Map(ids.map(id=>[id,{onclick:()=>calls.push(id)}]));
    vm.runInNewContext(line,{diagnosticIds:ids,practiceControlIds:new Set(ids.slice(0,4)),session:{role},mode,$:key=>controls.get(key.slice(1))});
    for(const button of controls.values())button.onclick();
    assert.deepEqual(calls,mode==='practice'?(role==='gm'?ids:ids.slice(0,4)):[]);
  }
});
