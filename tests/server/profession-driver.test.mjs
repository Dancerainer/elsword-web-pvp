/** Actual converted target resources + sealed native modules. These are Web
 * integration checks, not measured original-client combat trajectories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {normalize as normalizeSkills} from '../../apps/server/skill-preferences.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),assetRoot=process.env.RF_ASSET_ROOT??path.join(root,'artifacts');
let factoryPromise;
const productionFactory=()=>factoryPromise??=(async()=>{
  // The task's isolated test tree may validate an assembled parent program
  // read-only while all generated artifacts stay in their owning worktree.
  const programRoot=process.env.LK_TEST_PROGRAM_ROOT??root;
  const createFactory=programRoot===root?createBattleDriverFactory:
    (await import(pathToFileURL(path.join(programRoot,'apps/server/battle-driver.mjs')))).createBattleDriverFactory;
  return createFactory({root:programRoot,assetRoot});
})();
const skillConfiguration=professionId=>{
  const profile=getProfessionProfile(professionId),preset=getProfessionPreset(professionId);
  for(const row of profile.skillCatalog){
    try{return normalizeSkills({loadout:[{skillId:row.skillId},...Array(7).fill(null)],branchChoices:{}},profile,preset);}catch{}
  }
  throw Error('Source-supported skill required: '+professionId);
};
const players=()=>['lk','ally','opponent-a','opponent-b'].map((id,index)=>{
  const professionId=index===0?'LK':'RF';
  return {id,username:id,team:index<2?0:1,professionId,unitClass:getProfessionProfile(professionId).target.unitClass,
    ...skillConfiguration(professionId)};
});
async function mixed(t){
  const factory=await productionFactory();assert.equal(typeof factory,'function','complete target resource/native inputs required');
  assert.deepEqual(factory.professions,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true},'complete LK resource closure required');
  const match={id:'mixed-source-driver',mode:'2v2',sceneId:factory.maps[0].id,players:players(),seed:20161010,
    versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
  const events=[],driver=await factory({match,emit:(type,data)=>events.push({type,data}),finish(){}});t.after(()=>driver.stop());
  const report=(id,patch={},hits=[])=>{
    const current=driver.snapshot(),actor=current.snapshot.actors.find(actor=>actor.id===id);
    const profile=getProfessionProfile(actor.professionId);
    const value=encodeOwnedState({state:current.snapshot,profile,profileFor:()=>profile},id,
      {epoch:current.ownership.actors[id].epoch,frameSeq:(current.ownership.actors[id].frameSeq??0)+1});
    Object.assign(value.actor,patch);value.hits=hits;return value;
  };
  const submit=(id,value)=>driver.submitInput(id,{frames:[{held:[],frameSeq:value.frameSeq}],owner:value});
  const start=()=>{for(const player of match.players)driver.ready(player.id);driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');};
  const die=(id,killer='lk',patch={})=>{
    const current=driver.snapshot().snapshot.actors.find(actor=>actor.id===id);
    return submit(id,report(id,{hp:0,deathComplete:true,...patch},[{id:1,attackerId:killer,damage:current.hpMax}]));
  };
  return {factory,match,driver,events,report,submit,start,die};
}

test('actual native mixed driver freezes class-specific profiles, skills, passives, poses, HA cooldowns and accepted owner reports',async t=>{
  const f=await mixed(t),initial=f.driver.snapshot(),lk=initial.snapshot.actors.find(actor=>actor.id==='lk');
  assert.equal(lk.professionId,'LK');assert.equal(lk.profileId,getProfessionProfile('LK').profileId);
  assert.deepEqual(lk.passives,getProfessionPreset('LK').passives);assert.equal(lk.core.phase,'absent');
  assert.deepEqual(lk.wayOfSword,{point:0,state:0});
  assert.deepEqual(lk.loadout.map(slot=>slot&&({skillId:slot.skillId,branchId:slot.branchId})),skillConfiguration('LK').loadout);
  assert.deepEqual(initial.pvp.specialResourcePoolIds,['lk-vigor','lk-destruction']);
  for(const actor of initial.snapshot.actors.filter(actor=>actor.professionId==='RF')){
    assert.equal(actor.profileId,getProfessionProfile('RF').profileId);assert.deepEqual(actor.passives,getProfessionPreset('RF').passives);
    assert.equal(actor.wayOfSword,undefined);assert.ok(!actor.loadout.some(slot=>slot&&lk.loadout.some(other=>other?.skillId===slot.skillId)));
  }
  for(const player of f.match.players)f.driver.ready(player.id);
  const opening=f.driver.snapshot().snapshot.actors.find(actor=>actor.id==='lk'),poses=getProfessionProfile('LK').presentation.pvpPoses.start;
  assert.ok(poses.some(pose=>pose.state===opening.pvpPresentation.state&&pose.animationName===opening.pvpPresentation.animationName));
  assert.equal(opening.cooldowns[21603],180);assert.equal(opening.cooldowns[24600],undefined);assert.equal(opening.cooldowns[24603],undefined);
  for(const actor of f.driver.snapshot().snapshot.actors.filter(actor=>actor.professionId==='RF'))assert.equal(actor.cooldowns[21603],undefined);
  f.driver.tick(10);f.driver.tick(1);assert.equal(f.driver.snapshot().pvp.phase,'fight');
  for(const player of f.match.players)assert.equal(f.submit(player.id,f.report(player.id)).accepted,true);
  const forged=f.report('lk');forged.actor.professionId='RF';assert.throws(()=>f.submit('lk',forged),/invalid-owner-state/);
  const rfSkill=f.match.players.find(player=>player.professionId==='RF').loadout.find(Boolean).skillId;
  assert.throws(()=>f.submit('lk',f.report('lk',{skillId:rfSkill})),/unconfigured-owner-skill/);
  assert.throws(()=>f.submit('ally',f.report('ally',{wayOfSword:{point:100,state:1}})),/invalid-rf-way-of-sword/);
  assert.throws(()=>f.submit('ally',f.report('ally',{sourceLordKnight:{autoGuardCooldown:0}})),/invalid-rf-lord-knight-state/);
  assert.throws(()=>f.submit('lk',f.report('lk',{wayOfSword:{point:4801,state:2}})),/invalid-lk-way-of-sword/);
  assert.throws(()=>f.submit('lk',f.report('lk',{wayOfSwordLimits:{vigor:9600,destruction:-9600}})),/invalid-owner-state/);
  // Legal small packet samples isolate cross-profession reference routing;
  // their empty behavior arrays do not claim a buff effect has been measured.
  const buff=(templateId,sourceActorId,targetActorId)=>({schemaVersion:1,templateId,skillLevel:1,accumulationLimit:1,
    resistance:0,durationMultiplier:1,behaviors:[],finalizers:[],displayer:{},sourceActorId,targetActorId,factorId:null});
  assert.ok(getProfessionProfile('LK').buffTemplates[78]);assert.ok(getProfessionProfile('RF').buffTemplates[31]);
  assert.equal(f.submit('ally',f.report('ally',{buffs:[buff(78,'lk','ally')]})).accepted,true);
  assert.equal(f.submit('lk',f.report('lk',{buffs:[buff(31,'opponent-a','lk')]})).accepted,true);
  assert.throws(()=>f.submit('ally',f.report('ally',{buffs:[buff(999999,'lk','ally')]})),/unknown-owner-buff/);
  const [factorId]=Object.entries(getProfessionProfile('LK').buffFactors).find(([,row])=>
    Number.isSafeInteger(row.raw?.BUFF_TEMPLET_ID)&&row.raw.BUFF_TEMPLET_ID!==78);
  assert.throws(()=>f.submit('ally',f.report('ally',{buffs:[{...buff(78,'lk','ally'),factorId:Number(factorId)}]})),/invalid-owner-buff-factor-template/);
  assert.throws(()=>f.submit('ally',f.report('ally',{buffs:[buff(78,'not-in-roster','ally')]})),/invalid-owner-buff-source/);
  for(const patch of [{unitClass:107},{professionId:'UNKNOWN'},{professionId:'__proto__'}]){
    const match={...f.match,players:f.match.players.map(player=>player.id==='lk'?{...player,...patch}:player)};
    await assert.rejects(f.factory({match,emit(){},finish(){}}),/match-profession-class-mismatch|Unknown profession/);
  }
  for(const field of ['profile','preset','reference']){
    const professions=structuredClone(f.match.versions.professions);professions.LK[field]='0'.repeat(64);
    await assert.rejects(f.factory({match:{...f.match,versions:{...f.match.versions,professions}},emit(){},finish(){}}),/match-profession-version-mismatch/);
  }
  const loadout=f.match.players.find(player=>player.id==='ally').loadout;
  await assert.rejects(f.factory({match:{...f.match,players:f.match.players.map(player=>player.id==='lk'?{...player,loadout}:player)},emit(){},finish(){}}),/not an available profession active skill/);
});

// Current Web revival policy independently established by the existing user
// product policy,
// packages/combat-core/lord-knight.mjs: positive score lead clears sword;
// MP retains its separate lead1 half rule. These are not original2016 gold.
for(const [lead,point,expectedSword,expectedMp] of [
  [1,2400,{point:0,state:0},100],[1,-2400,{point:0,state:0},100],
  [2,2400,{point:0,state:0},0],[2,-2400,{point:0,state:0},0],
])
  test(`actual mixed owner room restores LK sword ${point} to ${expectedSword.point} at revival while leading ${lead}`,async t=>{
    const f=await mixed(t);f.start();f.die('opponent-a');f.die('opponent-b');f.driver.tick(.1);
    assert.deepEqual(f.driver.snapshot().pvp.score,[2,0]);
    if(lead===2){f.driver.tick(10);f.driver.tick(6);f.die('opponent-a');f.driver.tick(.1);assert.deepEqual(f.driver.snapshot().pvp.score,[3,0]);}
    const old=f.report('lk',{hp:0,deathComplete:true,mp:200,wayOfSword:{point,state:Math.sign(point)*2}},
      [{id:1,attackerId:'opponent-a',damage:f.driver.snapshot().snapshot.actors.find(actor=>actor.id==='lk').hpMax}]);
    f.submit('lk',old);f.driver.tick(.1);
    assert.equal(f.driver.snapshot().pvp.score[0]-f.driver.snapshot().pvp.score[1],lead);
    f.driver.tick(30);const revived=f.driver.snapshot(),actor=revived.snapshot.actors.find(actor=>actor.id==='lk');
    assert.equal(actor.hp,actor.hpMax);assert.equal(actor.professionId,'LK');assert.equal(actor.profileId,getProfessionProfile('LK').profileId);
    assert.deepEqual(actor.wayOfSword,expectedSword);assert.equal(actor.mp,expectedMp);
    assert.equal(revived.ownership.actors.lk.epoch,old.epoch+1);
    assert.equal(f.submit('lk',{...old,frameSeq:old.frameSeq+100}).ignored,'old-life');
    assert.deepEqual(f.driver.snapshot().snapshot.actors.find(actor=>actor.id==='lk').wayOfSword,actor.wayOfSword);
    assert.ok(f.events.some(event=>event.type==='state'&&event.data.events?.some(value=>value.type==='respawn'&&value.playerId==='lk')));
  });

// The same pre-existing policy retains the balance without a positive lead,
// but ends active vigor/destruction into charging even at the full balance.
for(const expectedSword of [{point:4800,state:1},{point:-4800,state:-1}])test(`a full retained LK sword balance ${expectedSword.point} ends active and remains a valid new-life owner report`,async t=>{
  const point=expectedSword.point;
  const f=await mixed(t);f.start();
  const old=f.report('lk',{hp:0,deathComplete:true,mp:200,wayOfSword:{point,state:Math.sign(point)*2}},
    [{id:1,attackerId:'opponent-a',damage:f.driver.snapshot().snapshot.actors.find(actor=>actor.id==='lk').hpMax}]);
  f.submit('lk',old);f.driver.tick(.1);assert.deepEqual(f.driver.snapshot().pvp.score,[0,1]);
  f.driver.tick(13);const current=f.driver.snapshot(),actor=current.snapshot.actors.find(actor=>actor.id==='lk');
  assert.deepEqual(actor.wayOfSword,expectedSword);assert.equal(actor.mp,200);assert.equal(actor.hp,actor.hpMax);
  assert.equal(current.ownership.actors.lk.epoch,old.epoch+1);
  assert.equal(f.submit('lk',f.report('lk')).accepted,true);
});

test('actual original global buff catalog is usable from either frozen profession without importing other skills',async t=>{
  const manifest=JSON.parse(await readFile(path.join(assetRoot,'common-buffs/manifest.json'),'utf8'));
  const common=JSON.parse(await readFile(path.join(assetRoot,'common-buffs',manifest.definitionCatalog),'utf8'));
  assert.equal(common.profileId,'target2016-global-buffs-v1');
  const rf=getProfessionProfile('RF'),lk=getProfessionProfile('LK');
  assert.ok(!rf.buffTemplates[78]&&common.buffTemplates[78]);
  assert.ok(!lk.buffTemplates[31]&&common.buffTemplates[31]);
  assert.deepEqual(common.damageEffects,{});assert.equal(common.skillCatalog,undefined);assert.equal(common.states,undefined);
  const f=await mixed(t);f.start();
  const buff=(templateId,sourceActorId,targetActorId)=>({schemaVersion:1,templateId,skillLevel:1,accumulationLimit:1,
    resistance:0,durationMultiplier:1,behaviors:[],finalizers:[],displayer:{},sourceActorId,targetActorId,factorId:null});
  assert.equal(f.submit('ally',f.report('ally',{buffs:[buff(78,'opponent-a','ally')]})).accepted,true);
  assert.equal(f.submit('ally',f.report('ally',{buffs:[buff(31,'lk','ally')]})).accepted,true);
  const before=f.driver.snapshot().snapshot.actors;
  assert.deepEqual(before.find(actor=>actor.id==='lk').passives,getProfessionPreset('LK').passives);
  for(const actor of before.filter(actor=>actor.professionId==='RF'))assert.equal(actor.wayOfSword,undefined);
  const rfSkill=f.match.players.find(player=>player.professionId==='RF').loadout.find(Boolean).skillId;
  assert.throws(()=>f.submit('lk',f.report('lk',{skillId:rfSkill})),/unconfigured-owner-skill/);
  assert.throws(()=>f.submit('ally',f.report('ally',{buffs:[buff(78,'unknown-owner','ally')]})),/invalid-owner-buff-source/);
});
