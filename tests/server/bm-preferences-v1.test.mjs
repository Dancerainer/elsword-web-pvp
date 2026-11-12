import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createSkillPreferencesStore} from '../../apps/server/skill-preferences.mjs';

// Small authored persistence fixtures. Skill values are not combat evidence.
const accounts=[{username:'fixture-gm',role:'gm'},{username:'blade',role:'player'}];
const profile=(id,unitClass,skillId)=>({profileId:'store-fixture-'+id,target:{unitClass},skillCatalog:[{skillId,unitClass,supported:true,passive:false,topTier:true,branches:[{id:'heavy',selectable:true}]}]});
const preset={presetVersion:'store-fixture',bannedSkillIds:[]};
const configuration=skillId=>({loadout:[{skillId,branchId:'heavy'},...Array(7).fill(null)],branchChoices:{[skillId]:'heavy'}});
async function temporary(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bm-preferences-'));
  t.after(async()=>{assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  return root;
}

test('BM slots, trait choices and selected profession persist independently of RF and LK',async t=>{
  const accountRoot=await temporary(t),store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
  const bm=createSkillPreferencesStore({accountRoot,professionId:'BM',profile:profile('BM',106,24029),preset});
  const rf=createSkillPreferencesStore({accountRoot,profile:profile('RF',107,24025),preset});
  const lk=createSkillPreferencesStore({accountRoot,professionId:'LK',profile:profile('LK',100,21027),preset});
  await rf.save('blade',configuration(24025));await lk.save('blade',configuration(21027));
  const file=path.join(accountRoot,'skill-preferences',createHash('sha256').update('blade').digest('hex')+'.json'),before=await fs.readFile(file,'utf8');
  await bm.save('blade',configuration(24029));await store.saveProfession('blade','BM');
  assert.equal(await fs.readFile(file,'utf8'),before);
  const restarted=createOnlineAccountStore({accountRoot});await restarted.initialize(accounts);assert.equal(restarted.selectedProfession('blade'),'BM');
  assert.deepEqual(await createSkillPreferencesStore({accountRoot,professionId:'BM',profile:profile('BM',106,24029),preset}).load('blade'),configuration(24029));
  assert.deepEqual(await lk.load('blade'),configuration(21027));assert.deepEqual(await rf.load('blade'),configuration(24025));
  await assert.rejects(bm.save('blade',configuration(21027)),/skill/i);
});

test('legacy GM flags remain byte-identical on read and BM stays disabled until explicitly enabled',async t=>{
  const accountRoot=await temporary(t),file=path.join(accountRoot,'online-professions.json');
  // This file shape is the persisted account-store contract.
  const store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);await store.saveProfessions({RF:true,LK:true,VC:true});
  const parsed=JSON.parse(await fs.readFile(file,'utf8'));delete parsed.professions.BM;const bytes=JSON.stringify(parsed);await fs.writeFile(file,bytes);
  const restarted=createOnlineAccountStore({accountRoot});await restarted.initialize(accounts);
  assert.equal(restarted.professionFlags().BM,false);assert.equal(await fs.readFile(file,'utf8'),bytes);
  await restarted.saveProfessions({...restarted.professionFlags(),BM:true});
  assert.equal(restarted.professionFlags().BM,true);
});

test('BM selection requires a complete prepared profession and uses RF fallback without losing saved choice',t=>{
  const driverFactory=()=>{};driverFactory.professions={RF:true,LK:true,VC:true,BM:false};
  const online=createOnlineService({driverFactory,accountStore:{selectedProfession:()=> 'BM',professionFlags:()=>({RF:true,LK:true,VC:true,BM:true})}});t.after(()=>online.close());
  assert.equal(online.status('blade').professionId,'RF');assert.equal(online.status('blade').selectedProfessionId,'BM');
  driverFactory.professions.BM=true;assert.equal(online.status('blade').professionId,'BM');
});
