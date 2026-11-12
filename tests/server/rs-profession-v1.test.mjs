/** Actual local target resource integration; not original-client measurement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {normalize,createSkillPreferencesStore} from '../../apps/server/skill-preferences.mjs';

const config=id=>normalize({loadout:({RF:[24027,24203],LK:[21027,21026],VC:[24034,24021],RS:[21027,21220]})[id].map(skillId=>({skillId})).concat(Array(6).fill(null)),branchChoices:{}},getProfessionProfile(id),getProfessionPreset(id));
test('RS and LK keep separate saved configurations even for shared Elsword skill IDs',async t=>{
 const accountRoot=await mkdtemp(resolve(os.tmpdir(),'rs-slots-'));
 t.after(async()=>{assert.ok(accountRoot.startsWith(resolve(os.tmpdir())+'/')||accountRoot.startsWith(resolve(os.tmpdir())+'\\'));await rm(accountRoot,{recursive:true,force:true});});
 const options=id=>({accountRoot,professionId:id,profile:getProfessionProfile(id),preset:getProfessionPreset(id)});
 const rs=createSkillPreferencesStore(options('RS')),lk=createSkillPreferencesStore(options('LK'));
 await rs.save('same-player',config('RS'));await lk.save('same-player',config('LK'));
 assert.deepEqual(await createSkillPreferencesStore(options('RS')).load('same-player'),config('RS'));
 assert.deepEqual(await createSkillPreferencesStore(options('LK')).load('same-player'),config('LK'));
 assert.throws(()=>normalize({loadout:[{skillId:21603},...Array(7).fill(null)],branchChoices:{}},getProfessionProfile('RS'),getProfessionPreset('RS')),/available|skill|Skill/);
});

test('four-profession owner room freezes RS source/preset/program and validates its own sword, skills and HA',async t=>{
 const root=resolve(import.meta.dirname,'../..'),factory=await createBattleDriverFactory({root,assetRoot:root+'/artifacts'});
 assert.deepEqual(factory.professions,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true});
 const players=['RS','LK','VC','RF'].map((professionId,i)=>({id:'p'+i,username:'p'+i,team:i<2?0:1,
  professionId,unitClass:getProfessionProfile(professionId).target.unitClass,...config(professionId)}));
 const match={id:'rs-mixed',mode:'2v2',players,seed:20161011,sceneId:factory.maps[0].id,
  versions:{...factory.versions,...factory.mapVersions(factory.maps[0].id)}};
 const driver=await factory({match,emit(){},finish(){}});t.after(()=>driver.stop());
 for(const player of players)driver.ready(player.id);
 const before=driver.snapshot(),rs=before.snapshot.actors.find(a=>a.id==='p0');
 assert.equal(rs.professionId,'RS');assert.equal(rs.core.phase,'absent');assert.deepEqual(rs.wayOfSword,{point:0,state:0});
 assert.equal(rs.cooldowns[21604],180);assert.equal(rs.cooldowns[21603],undefined);
 assert.ok(getProfessionProfile('RS').presentation.pvpPoses.start.some(p=>p.animationName===rs.pvpPresentation.animationName));
 assert.notEqual(factory.versions.professions.RS.profile,factory.versions.professions.LK.profile);
 assert.notEqual(factory.versions.professions.RS.preset,factory.versions.professions.LK.preset);
 driver.tick(10);driver.tick(1);assert.equal(driver.snapshot().pvp.phase,'fight');
 const packet=(id,seq)=>{const s=driver.snapshot(),actor=s.snapshot.actors.find(a=>a.id===id);
  return encodeOwnedState({state:s.snapshot,profileFor:()=>getProfessionProfile(actor.professionId)},id,{epoch:s.ownership.actors[id].epoch,frameSeq:seq});};
 for(const player of players){const value=packet(player.id,1);assert.equal(driver.submitInput(player.id,{frames:[{held:[],frameSeq:1}],owner:value}).accepted,true);}
 const submit=owner=>driver.submitInput('p0',{frames:[{held:[],frameSeq:owner.frameSeq}],owner});
 const valid=packet('p0',2);valid.actor.wayOfSword={point:2400,state:2};assert.equal(submit(valid).accepted,true);
 const forged=packet('p0',3);forged.actor.state='ESSI_SA_ELK_SONIC_BLADE';assert.throws(()=>submit(forged),/unknown-owner-action/);
 const badSword=packet('p0',3);badSword.actor.wayOfSword={point:4801,state:2};assert.throws(()=>submit(badSword),/way-of-sword/);
 const versions=structuredClone(match.versions);versions.professions.RS.profile='0'.repeat(64);
 await assert.rejects(factory({match:{...match,versions},emit(){},finish(){}}),/profession-version-mismatch/);
});
