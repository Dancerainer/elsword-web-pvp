import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createSkillPreferencesStore, normalize, SkillPreferencesValidationError} from '../../apps/server/skill-preferences.mjs';

const accounts = ['fixture-gm','alpha','beta'].map(username => ({username,role:username==='fixture-gm'?'gm':'player'}));
const skill = (skillId,unitClass) => ({skillId,unitClass,supported:true,passive:false,topTier:true,
  branches:[{id:'heavy',selectable:true}]});
const rf = {profileId:'legal-rf-fixture',target:{unitClass:107},skillCatalog:[skill(24001,107),skill(1001,100)]};
const lk = {profileId:'legal-lk-fixture',target:{unitClass:100},skillCatalog:[skill(1001,100),skill(24001,107)]};
const preset = {presetVersion:'fixture-v1',bannedSkillIds:[]};
const config = id => ({loadout:[{skillId:id,branchId:'heavy'},...Array(7).fill(null)],branchChoices:{[id]:'heavy'}});
const key = username => createHash('sha256').update(username).digest('hex');
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'profession-fixture-'));
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});});
  return root;
}

test('profession validation uses the profile class and rejects another profession even if its row is present',()=>{
  assert.deepEqual(normalize(config(1001),lk,preset),config(1001));
  assert.deepEqual(normalize(config(24001),rf,preset),config(24001));
  for(const [profile,id] of [[rf,1001],[lk,24001]])assert.throws(()=>normalize(config(id),profile,preset),SkillPreferencesValidationError);
});

test('legacy RF bytes survive LK writes and independent slots and traits survive restart',async t=>{
  const accountRoot=await temporary(t),directory=path.join(accountRoot,'skill-preferences');await fs.mkdir(directory);
  const legacy={schemaVersion:1,...config(24001)},file=path.join(directory,key('alpha')+'.json'),bytes=JSON.stringify(legacy);
  await fs.writeFile(file,bytes);
  const rfStore=createSkillPreferencesStore({accountRoot,profile:rf,preset});
  const lkStore=createSkillPreferencesStore({accountRoot,professionId:'LK',profile:lk,preset});
  assert.deepEqual(await rfStore.load('alpha'),config(24001));assert.equal(await lkStore.load('alpha'),null);
  await lkStore.save('alpha',config(1001));assert.equal(await fs.readFile(file,'utf8'),bytes);
  await assert.rejects(lkStore.save('alpha',config(24001)),SkillPreferencesValidationError);
  assert.deepEqual(await createSkillPreferencesStore({accountRoot,professionId:'LK',profile:lk,preset}).load('alpha'),config(1001));
  await rfStore.save('alpha',{loadout:Array(8).fill(null),branchChoices:{24001:'heavy'}});
  assert.deepEqual(await lkStore.load('alpha'),config(1001));assert.equal(await lkStore.load('beta'),null);
  assert.deepEqual((await rfStore.load('alpha')).loadout,Array(8).fill(null));
});

test('old nickname profiles migrate without rewriting and profession and nickname preserve each other on restart',async t=>{
  const accountRoot=await temporary(t),file=path.join(accountRoot,'account-profiles.json');
  const bytes=JSON.stringify({schemaVersion:1,accounts:{[key('alpha')]:{nickname:'\uac26\uac28\uac32'}}});await fs.writeFile(file,bytes);
  let store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
  assert.equal(store.selectedProfession('alpha'),'RF');assert.equal(await fs.readFile(file,'utf8'),bytes);
  await store.saveProfession('alpha','LK');await store.saveNickname('alpha','\uac25\uac28\uac32');
  assert.equal(store.selectedProfession('alpha'),'LK');assert.equal((await store.profile('alpha')).nickname,'\uac25\uac28\uac32');
  await store.saveProfessions({RF:false,LK:false});
  store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
  assert.equal(store.selectedProfession('alpha'),'LK');assert.equal(store.selectedProfession('beta'),'RF');
  assert.equal((await store.profile('alpha')).nickname,'\uac25\uac28\uac32');assert.deepEqual(store.professionFlags(),{RF:false,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  await assert.rejects(store.saveProfession('alpha','LK/../../RF'),RangeError);
  await assert.rejects(store.saveProfessions({RF:false,LK:false,OTHER:true}),/invalid-online-professions/);
});

test('failed profession writes preserve last account and GM choices',async t=>{
  const accountRoot=await temporary(t);let fail=false;
  const fileSystem={...fs,rename:async(source,target)=>{if(fail&&(target.endsWith('account-profiles.json')||target.endsWith('online-professions.json')))
    throw Object.assign(Error('fixture-disk'),{code:'EIO'});return fs.rename(source,target);}};
  const store=createOnlineAccountStore({accountRoot,fileSystem});await store.initialize(accounts);
  await store.saveProfession('alpha','LK');await store.saveProfessions({RF:true,LK:false});fail=true;
  await assert.rejects(store.saveProfession('alpha','RF'),/fixture-disk/);assert.equal(store.selectedProfession('alpha'),'LK');
  await assert.rejects(store.saveProfessions({RF:false,LK:true}),/fixture-disk/);assert.deepEqual(store.professionFlags(),{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
});

function lobby({saveFailure=false,availability}={}){
  let clock=0,flags={RF:true,LK:true};const drivers=[],events=[];
  const factory=async({match})=>{const driver={match,stop(){},submitInput(){}};drivers.push(driver);return driver;};
  if(availability)factory.professions=availability;
  const store={role:name=>name==='fixture-gm'?'gm':'player',selectedProfession:()=> 'LK',professionFlags:()=>({...flags}),
    saveProfessions:async next=>{if(saveFailure)throw Error('disk');flags={...next};return {...flags};},recordMatch:async()=>({recorded:true})};
  const online=createOnlineService({accountStore:store,driverFactory:factory,versions:{program:'fixture'},now:()=>clock,
    emit:(username,type,data)=>events.push({username,type,data}),onlineUsers:()=>['fixture-gm','idle']});
  const add=(username,professionId,extra={})=>online.join(username,'player',{professionId,
    unitClass:professionId==='RF'?107:100,...config(professionId==='RF'?24001:1001),
    professionVersions:{profile:'profile-'+professionId,preset:'preset-'+professionId,reference:'fixture'},...extra},'1v1');
  return {online,drivers,events,add,advance:async ms=>{clock+=ms;await online.tick();}};
}

test('mixed rooms freeze both professions, disabling clears affected queue seats and leaves active rooms immutable',async t=>{
  const f=lobby();t.after(()=>f.online.close());await f.add('alpha','RF');await f.add('beta','LK');await f.advance(5000);
  const frozen=structuredClone(f.drivers[0].match);assert.deepEqual(new Set(frozen.players.map(p=>p.professionId)),new Set(['RF','LK']));
  assert.equal(frozen.versions.professions.RF.profile,'profile-RF');assert.equal(frozen.versions.professions.LK.profile,'profile-LK');
  await f.add('waiting-lk','LK');await f.add('waiting-rf','RF');
  await f.online.setProfessions('fixture-gm',{RF:true,LK:false});
  assert.equal(f.online.isLocked('waiting-lk'),false);assert.equal(f.online.isLocked('waiting-rf'),true);
  assert.equal(f.online.status('waiting-lk').queueNotice.reason,'profession-disabled');
  assert.deepEqual(f.drivers[0].match,frozen);assert.equal(f.online.hasMatch('beta'),true);
  assert.equal(f.online.status('idle').professionId,'RF');assert.equal(f.online.status('idle').selectedProfessionId,'LK');
  await assert.rejects(f.add('disabled','LK'),error=>error.code==='profession-disabled');
  await f.online.setProfessions('fixture-gm',{RF:false,LK:false});
  assert.deepEqual(f.online.status('idle').professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.deepEqual(f.online.status('idle').professionFlags,{RF:false,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.equal(f.online.isLocked('waiting-rf'),true);await f.add('fallback','RF');
  await f.online.setProfessions('fixture-gm',{RF:false,LK:true});assert.equal(f.online.status('idle').professionId,'LK');
  assert.equal(f.online.isLocked('waiting-rf'),false);assert.equal(f.online.isLocked('fallback'),false);
});

test('unavailable LK stays gated; bad class requests, non-GM toggles and failed settings cannot change locks',async t=>{
  const f=lobby({availability:{RF:true,LK:false}});t.after(()=>f.online.close());
  assert.deepEqual(f.online.status('idle').professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});await assert.rejects(f.add('missing','LK'),error=>error.code==='profession-disabled');
  await assert.rejects(f.add('tamper','RF',{unitClass:100}),error=>error.code==='invalid-profession-configuration');
  await assert.rejects(f.add('tamper','OTHER'),error=>error.code==='invalid-profession-request');
  await assert.rejects(f.online.setProfessions('alpha',{RF:false,LK:true}),error=>error.code==='gm-required');
  const failed=lobby({saveFailure:true});t.after(()=>failed.online.close());await failed.add('alpha','LK');
  await assert.rejects(failed.online.setProfessions('fixture-gm',{RF:true,LK:false}),error=>error.code==='profession-settings-unavailable');
  assert.equal(failed.online.isLocked('alpha'),true);assert.equal(failed.online.status('alpha').professions.LK,true);
});

test('a missing production driver cannot advertise LK or discard the saved LK choice',async t=>{
  const store={selectedProfession:()=> 'LK',professionFlags:()=>({RF:true,LK:true})};
  const online=createOnlineService({accountStore:store,driverFactory:null});t.after(()=>online.close());
  const status=online.status('idle');assert.equal(status.available,false);assert.equal(status.professionId,'RF');
  assert.equal(status.selectedProfessionId,'LK');assert.deepEqual(status.professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.deepEqual(status.professionFlags,{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true});
});

test('legacy three-profession settings stay byte-identical with IS off; new stores and explicit GM opt-in enable IS',async t=>{
  const accountRoot=await temporary(t),file=path.join(accountRoot,'online-professions.json');
  const bytes=JSON.stringify({schemaVersion:1,professions:{RF:true,LK:false,VC:true}});await fs.writeFile(file,bytes);
  const store=createOnlineAccountStore({accountRoot});await store.initialize(accounts);
  assert.deepEqual(store.professionFlags(),{RF:true,LK:false,VC:true,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.equal(await fs.readFile(file,'utf8'),bytes);
  await store.saveProfessions({...store.professionFlags(),IS:true});await store.saveProfession('alpha','IS');
  const restarted=createOnlineAccountStore({accountRoot});await restarted.initialize(accounts);
  assert.equal(restarted.selectedProfession('alpha'),'IS');assert.deepEqual(restarted.professionFlags(),{RF:true,LK:false,VC:true,RS:false,BM:false,IS:true,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  const fresh=createOnlineAccountStore({accountRoot:await temporary(t)});await fresh.initialize(accounts);
  assert.deepEqual(fresh.professionFlags(),{RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true,LP:true,MM:true,DE:true});
});

test('IS eight slots and unequipped traits persist separately from LK and legacy RF bytes',async t=>{
  const accountRoot=await temporary(t),isProfile={profileId:'legal-is-fixture',target:{unitClass:112},skillCatalog:[skill(21605,112),skill(24001,107)]};
  const rfStore=createSkillPreferencesStore({accountRoot,profile:rf,preset}),lkStore=createSkillPreferencesStore({accountRoot,professionId:'LK',profile:lk,preset});
  await rfStore.save('alpha',config(24001));await lkStore.save('alpha',config(1001));
  const files=['', 'LK/'].map(prefix=>path.join(accountRoot,'skill-preferences',prefix+key('alpha')+'.json'));
  const previous=await Promise.all(files.map(file=>fs.readFile(file,'utf8')));
  const isStore=createSkillPreferencesStore({accountRoot,professionId:'IS',profile:isProfile,preset});
  const loadout=Array(8).fill(null);loadout[7]={skillId:21605,branchId:'heavy'};
  await isStore.save('alpha',{loadout,branchChoices:{21605:'heavy'}});
  const reopened=createSkillPreferencesStore({accountRoot,professionId:'IS',profile:isProfile,preset});
  assert.deepEqual(await reopened.load('alpha'),{loadout,branchChoices:{21605:'heavy'}});
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file,'utf8'))),previous);
  await assert.rejects(isStore.save('alpha',config(24001)),SkillPreferencesValidationError);
  await isStore.save('alpha',{loadout:Array(8).fill(null),branchChoices:{21605:'heavy'}});
  assert.deepEqual(await reopened.load('alpha'),{loadout:Array(8).fill(null),branchChoices:{21605:'heavy'}});
});
