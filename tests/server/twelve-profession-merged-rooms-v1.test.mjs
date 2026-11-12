/** Two real native 3v3 rooms exercise the merged Elesis/Add owner protocol.
 * These are production Web lifecycle tests, not original-client traces.
 * One process, one asset load, sequential rooms; no resource copying.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..'),programRoot=process.env.MERGED_ROOM_PROGRAM_ROOT??root;
const assetRoot=process.env.MERGED_ROOM_ASSET_ROOT??resolve(programRoot,'artifacts');
const load=path=>import(pathToFileURL(resolve(programRoot,path)));
const {createBattleDriverFactory}=await load('apps/server/battle-driver.mjs');
const {getProfessionProfile,getProfessionPreset,PROFESSION_PROFILES,PROFESSION_PRESETS}=await load('packages/professions/profiles.mjs');
const {normalize}=await load('apps/server/skill-preferences.mjs');
const {encodeOwnedState}=await load('packages/online/owned-state.mjs');
const {syncAddAwakening,applyAddTimeRing,applyAddTimeRingToActor}=await load('packages/combat-core/add-systems.mjs');
const {createSimulation}=await import(pathToFileURL(process.env.TIME_RING_CORE_MODULE??resolve(programRoot,'packages/combat-core/index.mjs')));
const tables=[['GM','LK','DE','RF','BH','LP'],['CA','RS','MM','IS','BM','VC']];
const sword=new Set(['LK','RS','IS','GM','BH','CA']),elesis=new Set(['GM','BH','CA']),add=new Set(['LP','MM','DE']);
const ha={RF:[24600,24603],LK:[21603],RS:[21604],IS:[21605],BM:[24604],VC:[24605],GM:[28603],BH:[28604],CA:[28605],LP:[29600,29603],MM:[29601,29604],DE:[29602,29605]};
const baseFields=['hpMax','physicalAttack','magicAttack','physicalDefence','magicDefence'];
const sourceElesisBase={GM:[142080,1810,1443,357,286],BH:[128752,1769,1561,351,293],CA:[135417,1848,1482,323,310]};
const pools=['lk-vigor','lk-destruction','elesis-gale','elesis-annihilation','add-dp','add-mutation'];
let factoryPromise;
const productionFactory=()=>factoryPromise??=createBattleDriverFactory({root:programRoot,assetRoot});
function configuration(id){
  const profile=getProfessionProfile(id),preset=getProfessionPreset(id),required={GM:28009,DE:29213}[id];
  for(const row of required?[profile.skillCatalog.find(s=>s.skillId===required)]:profile.skillCatalog){
    if(!row)continue;
    try{return normalize({loadout:[{skillId:row.skillId},...Array(7).fill(null)],branchChoices:{}},profile,preset);}catch(error){if(required)throw error;}
  }
  throw Error('No source-supported configured skill for '+id);
}
function clientView(snapshot,localId){
  return {state:snapshot,networkOwnerId:localId,profileFor:a=>getProfessionProfile(a.professionId),
    presetFor:a=>getProfessionPreset(a.professionId),emit(){}};
}
async function nativeOwnerClient(snapshot,localId){
  const {addMap:map,addNative:native}=await load('tests/helpers/add-fixture.mjs');
  const sim=createSimulation({profile:PROFESSION_PROFILES.RF,profiles:PROFESSION_PROFILES,presets:PROFESSION_PRESETS,map,
    actors:snapshot.actors,networkOwnerId:localId,versions:snapshot.versions,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak});
  // This fixture imports the server's already sealed owner-frame state into a
  // real combat host. The resulting complete report still passes the driver's
  // production identity/reference validation; this is not a snapshot-parser test.
  sim.state=structuredClone(snapshot);return sim;
}
function assertFrozen(actor,profile,preset){
  assert.equal(actor.profileId,profile.profileId);
  assert.deepEqual(new Set(actor.passives),new Set(preset.passives));
  assert.equal(actor.actorVersions.baseline,profile.target.build);
  assert.equal(actor.actorVersions.preset,preset.presetVersion);
  assert.equal(actor.formulaRules.sourceEquipmentBaseline.profession,actor.professionId);
  for(const field of baseFields)assert.equal(actor.formulaRules.sourceEquipmentBaseline.pvp[field],preset.attributes[field],actor.professionId+' equipment '+field);
  if(elesis.has(actor.professionId)){
    assert.deepEqual(baseFields.map(k=>actor.formulaRules.sourceEquipmentBaseline.pvp[k]),sourceElesisBase[actor.professionId]);
    const model=getProfessionPreset(({GM:'LK',BH:'RS',CA:'IS'})[actor.professionId]);
    for(const option of ['mpMax','hpBonus','damageReduction','criticalRate','mpGainBonus','animationSpeedMultiplier',
      'moveSpeedMultiplier','jumpSpeedMultiplier','skillDamageBonus','additionalAttackRatio','criticalDamageBonus'])
      assert.equal(actor.equipmentAttributes[option],model.attributes[option],actor.professionId+' inherits '+option);
  }
}

for(const [tableIndex,ids]of tables.entries())test(`native merged room ${tableIndex+1}: ${ids.join('/')} owner resources and clean respawn`,{concurrency:false},async t=>{
  const factory=await productionFactory();assert.equal(typeof factory,'function','complete native/resource inputs required');
  for(const id of ids)assert.equal(factory.professions[id],true,JSON.stringify(factory.assetDiagnostics));
  const players=ids.map((professionId,i)=>({id:'room'+tableIndex+'-'+professionId,username:'room'+tableIndex+'-'+professionId,
    team:i<3?0:1,professionId,unitClass:getProfessionProfile(professionId).target.unitClass,...configuration(professionId)}));
  const match={id:'twelve-profession-'+tableIndex,mode:'3v3',players,seed:20161013+tableIndex,sceneId:factory.maps[0].id,
    versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
  const events=[],driver=await factory({match,emit:(type,data)=>events.push({type,data}),finish(){}});
  t.after(()=>driver.stop());
  const currentActor=id=>driver.snapshot().snapshot.actors.find(a=>a.id===id);
  const byProfession=id=>players.find(p=>p.professionId===id);
  const packet=(id,patch={})=>{
    const current=driver.snapshot(),actor=current.snapshot.actors.find(a=>a.id===id);
    const report=encodeOwnedState(clientView(current.snapshot,id),id,
      {epoch:current.ownership.actors[id].epoch,frameSeq:current.ownership.actors[id].frameSeq+1});
    Object.assign(report.actor,patch);return report;
  };
  const submit=(id,report)=>driver.submitInput(id,{frames:[{held:[],frameSeq:report.frameSeq}],owner:report});
  for(const p of players)driver.ready(p.id);
  const initial=driver.snapshot();
  assert.equal(initial.pvp.mode,'3v3');assert.equal(initial.snapshot.versions.nativeSourceCommit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  for(const field of ['geometryRuntime','commandRuntime','skillRuntime'])assert.equal(initial.snapshot.versions[field],'original-cpp-wasm');
  assert.deepEqual(new Set(initial.pvp.specialResourcePoolIds),new Set(pools));
  assert.equal(new Set(initial.pvp.specialResourcePoolIds).size,initial.pvp.specialResourcePoolIds.length);
  for(const p of players){
    const actor=initial.snapshot.actors.find(a=>a.id===p.id),profile=getProfessionProfile(p.professionId),preset=getProfessionPreset(p.professionId);
    assertFrozen(actor,profile,preset);
    for(const key of ['profile','preset','reference'])assert.match(match.versions.professions[p.professionId][key],/^[a-f0-9]{64}$/);
    assert.equal(actor.actorVersions.program,initial.snapshot.versions.program);
    assert.deepEqual(actor.loadout.map(s=>s&&({skillId:s.skillId,branchId:s.branchId})),p.loadout);
    for(const skillId of ha[p.professionId])assert.equal(actor.cooldowns[skillId],180);
    if(profile.presentation?.pvpPoses?.start)assert.ok(profile.presentation.pvpPoses.start.some(pose=>pose.animationName===actor.pvpPresentation.animationName));
    else assert.ok(profile.clips[actor.pvpPresentation.animationName],p.professionId+' source opening clip exists');
    assert.equal(actor.core.phase,'absent');
    if(sword.has(p.professionId))assert.deepEqual(actor.wayOfSword,{point:0,state:0});else assert.equal(actor.wayOfSword,undefined);
    if(elesis.has(p.professionId)){
      assert.equal(actor.sourceElesisBreakCharge,0);assert.ok(actor.sourceElesisSkills);assert.equal(actor.sourceLordKnight,undefined);
      assert.equal(actor.destructionRageRemaining,undefined);
    }
    if(add.has(p.professionId)){
      assert.equal(actor.sourceAdd.dp,0);assert.equal(actor.sourceAdd.mutation,0);assert.equal(actor.awakening.gauge,0);
    }else{assert.equal(actor.sourceAdd,undefined);assert.equal(actor.awakening.gauge,50);}
  }
  driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');
  const preserved=new Map();
  for(const p of players){
    const report=packet(p.id,{mp:200});
    if(sword.has(p.professionId))report.actor.wayOfSword={point:-2400,state:-2};
    if(elesis.has(p.professionId))report.actor.sourceElesisBreakCharge=1000;
    if(add.has(p.professionId)){
      Object.assign(report.actor.sourceAdd,{dp:4001,mutation:5,formation:true,formationPending:false});
      syncAddAwakening({...report.actor,professionId:p.professionId});
      report.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8};
    }else if(!sword.has(p.professionId))Object.assign(report.actor.core,{phase:'idle',gauge:30,level:1});
    assert.equal(submit(p.id,report).accepted,true);
    const accepted=currentActor(p.id);assert.equal(accepted.mp,200);
    if(sword.has(p.professionId))assert.deepEqual(accepted.wayOfSword,report.actor.wayOfSword);
    if(add.has(p.professionId)){assert.deepEqual(accepted.sourceAdd,report.actor.sourceAdd);assert.deepEqual(accepted.sourceAddCombat,report.actor.sourceAddCombat);}
    else if(!sword.has(p.professionId))assert.equal(accepted.core.level,1);
    preserved.set(p.id,{equipmentAttributes:accepted.equipmentAttributes,formulaRules:accepted.formulaRules,actorVersions:accepted.actorVersions});
    const forged=packet(p.id,{equipmentAttributes:{hpMax:1}});assert.throws(()=>submit(p.id,forged),/invalid-owner-state/);
    if(!add.has(p.professionId)){
      const model=currentActor(players.find(v=>add.has(v.professionId)).id).sourceAdd;
      assert.throws(()=>submit(p.id,packet(p.id,{sourceAdd:model})),/invalid-add-profession-state/);
    }else assert.throws(()=>submit(p.id,packet(p.id,{sourceElesisBreakCharge:0})),/invalid-elesis-state/);
  }
  // The DE table exercises both notice delivery metadata and actual owner-side
  // resource capture/revival on GM. The server receives only valid owner state.
  if(byProfession('DE')){
    const recipient=byProfession('GM'),caster=byProfession('DE'),target=currentActor(recipient.id);
    assert.equal(submit(caster.id,packet(caster.id,{x:target.x,y:target.y,z:target.z,landPosition:[target.x,target.y,target.z]})).accepted,true);
    const view=driver.snapshot(),owner=clientView(view.snapshot,caster.id),seal=view.snapshot.actors.find(a=>a.id===caster.id);
    assert.equal(applyAddTimeRing(owner,seal,{skillId:29213}),1);
    const notice=packet(caster.id,{sourceTimeRingNotice:seal.sourceTimeRingNotice,sourceTimeRing:seal.sourceTimeRing});
    assert.equal(submit(caster.id,notice).accepted,true);
    const received=driver.snapshot(),recipientView=await nativeOwnerClient(received.snapshot,recipient.id),a=recipientView.actor(recipient.id),de=recipientView.actor(caster.id);
    assert.equal(applyAddTimeRingToActor(recipientView,de,a),true);
    assert.equal(submit(recipient.id,packet(recipient.id,{sourceTimeRing:a.sourceTimeRing})).accepted,true);
    assert.equal(currentActor(recipient.id).sourceTimeRing.sourceActorId,caster.id);
    a.hp=1;a.mp=0;
    const hit=recipientView.injectHit({attackerId:byProfession('RF').id,targetId:a.id,damageData:{DAMAGE_TYPE:1,DAMAGE:{MAGIC:100},
      ATTACK_TYPE:1,REACT_TYPE:0,IGNORE_DEFENCE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0}});
    assert.equal(hit.accepted,true);assert.equal(a.mp,200);assert.equal(a.sourceTimeRing,null);assert.equal(a.sourceTimeSickness,120);
    assert.equal(a.sourceElesisBreakCharge,0);assert.deepEqual(a.wayOfSword,{point:-2400,state:-1});
    const sealState=driver.snapshot().ownership.actors[a.id],revivedReport=encodeOwnedState(recipientView,a.id,{epoch:sealState.epoch,frameSeq:sealState.frameSeq+1});
    assert.equal(submit(recipient.id,revivedReport).accepted,true);
    assert.equal(currentActor(recipient.id).sourceTimeSickness,120);
  }
  // Freeze failures occur before runtime creation, so these do not load another
  // map/native instance for each intentionally rejected version.
  for(const p of players)for(const field of ['profile','preset','reference']){
    const versions=structuredClone(match.versions);versions.professions[p.professionId][field]='0'.repeat(64);
    await assert.rejects(factory({match:{...match,versions},emit(){},finish(){}}),/profession-version-mismatch/);
  }
  const dead=[];
  for(const p of players){
    const report=packet(p.id,{hp:0,deathComplete:true});
    if(elesis.has(p.professionId))report.actor.sourceElesisBreakCharge=0;
    dead.push([p.id,report]);assert.equal(submit(p.id,report).accepted,true);
  }
  driver.tick(.1);assert.deepEqual(driver.snapshot().pvp.score,[3,3]);driver.tick(24);
  const revived=driver.snapshot();
  for(const p of players){
    const actor=revived.snapshot.actors.find(a=>a.id===p.id),old=dead.find(([id])=>id===p.id)[1],frozen=preserved.get(p.id);
    assert.equal(revived.ownership.actors[p.id].epoch,old.epoch+1);
    assert.equal(actor.hp,actor.hpMax);assert.equal(actor.mp,200,'tied team retains MP');
    assert.deepEqual(actor.equipmentAttributes,frozen.equipmentAttributes);assert.deepEqual(actor.formulaRules,frozen.formulaRules);
    assert.deepEqual(actor.actorVersions,frozen.actorVersions);assertFrozen(actor,getProfessionProfile(p.professionId),getProfessionPreset(p.professionId));
    assert.equal(actor.core.phase,'absent');assert.equal(actor.core.level,0);assert.equal(actor.core.gauge,0);
    if(sword.has(p.professionId))assert.deepEqual(actor.wayOfSword,{point:-2400,state:-1});
    if(elesis.has(p.professionId)){assert.equal(actor.sourceElesisBreakCharge,0);assert.equal(actor.destructionRageRemaining,undefined);}
    if(add.has(p.professionId)){
      assert.equal(actor.sourceAdd.dp,4001);assert.equal(actor.sourceAdd.mutation,5);assert.equal(actor.sourceAdd.formation,false);
      assert.equal(actor.sourceAdd.generator,null);assert.equal(actor.awakening.remaining,0);assert.equal(actor.awakening.gauge,0);
    }
    assert.equal(actor.sourceTimeRing,undefined);assert.equal(actor.sourceTimeSickness,undefined);assert.equal(actor.sourceTimeRingNotice,undefined);
    const expectedState=add.has(p.professionId)?'ANSI_START_INTRUDE':elesis.has(p.professionId)?'ESI_START_INTRUDE':sword.has(p.professionId)?'ESSI_START_INTRUDE':'RSI_START_INTRUDE';
    assert.equal(actor.pvpPresentation.state,expectedState);
    for(const skillId of ha[p.professionId])assert.ok(actor.cooldowns[skillId]>0&&actor.cooldowns[skillId]<180,'remaining opening HA delay');
    assert.equal(submit(p.id,{...old,frameSeq:9999}).ignored,'old-life');
    assert.equal(submit(p.id,packet(p.id)).accepted,true,'new-life owner schema and references round-trip');
  }
  assert.equal(new Set(events.filter(e=>e.type==='state').flatMap(e=>e.data.events??[]).filter(e=>e.type==='respawn').map(e=>e.playerId)).size,6);
});
