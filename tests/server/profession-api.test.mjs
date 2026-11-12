import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {normalize as normalizeSkills} from '../../apps/server/skill-preferences.mjs';
import {getProfessionProfile,getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {loopbackFetch as fetch} from '../helpers/loopback-fetch.mjs';

const origin='https://profession-fixture.invalid';
const accounts=['fixture-gm','alpha','beta'].map((username,index)=>({username,role:index===0?'gm':'player',password:'fixture-password-'+username}));
const key=username=>createHash('sha256').update(username).digest('hex');
for(const costumeId of ['imperial','denif','evilTracer1'])test(`${costumeId} persists for four characters and freezes into an ordinary match`,async t=>{
  const f=await fixture(t);let a=await f.login(1),b=await f.login(2);
  for(const professionId of ['LK','RF','GM','MM'])assert.equal((await f.request('/api/preferences/costume',{
    cookie:a,method:'POST',body:{professionId,costumeId}})).status,200);
  await f.restart();a=await f.login(1);b=await f.login(2);
  const session=(await f.request('/api/session',{cookie:a})).json;
  assert.deepEqual(session.costumes,{elsword:costumeId,raven:costumeId,elesis:costumeId,add:costumeId});
  assert.equal(session.costumeId,costumeId);
  for(const cookie of [a,b])assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'1v1'}})).status,200);
  await f.advance(5000);assert.equal(f.matches[0].players.find(p=>p.id==='alpha').costumeId,costumeId);
  assert.equal(f.matches[0].players.find(p=>p.id==='beta').costumeId,'default');
  assert.equal((await f.request('/api/preferences/costume',{cookie:a,method:'POST',body:{professionId:'RF',costumeId:'default'}})).status,409);
});
for(const id of ['GM','BH','CA'])test(`${id} ordinary account persists an independent skill tree, Elesis costume and frozen match identity`,async t=>{
  const f=await fixture(t,{driverProfessions:{RF:true,LK:true,GM:true,BH:true,CA:true}});
  let a=await f.login(1),b=await f.login(2);const config=configuration(id);
  assert.equal((await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:id}})).status,200);
  assert.equal((await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:config})).status,200);
  assert.equal((await f.request('/api/preferences/costume',{cookie:a,method:'POST',body:{professionId:id,costumeId:'officer'}})).status,200);
  assert.equal((await f.request('/api/admin/professions',{cookie:a,method:'POST',body:{professions:{RF:true,LK:true}}})).status,403,'GM career never grants GM administration');
  await f.restart();a=await f.login(1);b=await f.login(2);
  const session=(await f.request('/api/session',{cookie:a})).json;
  assert.equal(session.professionId,id);assert.equal(session.costumeId,'officer');assert.equal(session.costumes.elesis,'officer');
  assert.equal(session.costumes.elsword,'default');assert.equal(session.costumes.raven,'default');
  assert.deepEqual((await f.request('/api/skill-preferences',{cookie:a})).json.preferences,{loadout:config.loadout,branchChoices:config.branchChoices});
  for(const cookie of [a,b])assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'1v1'}})).status,200);
  await f.advance(5000);const player=f.matches[0].players.find(p=>p.id==='alpha');
  assert.equal(player.professionId,id);assert.equal(player.unitClass,getProfessionProfile(id).target.unitClass);
  assert.equal(player.costumeId,'officer');
  assert.deepEqual(player.loadout,config.loadout);
  for(const key of ['profile','preset','reference'])assert.match(f.matches[0].versions.professions[id][key],/^[a-f0-9]{64}$/);
});
function configuration(professionId){
  const profile=getProfessionProfile(professionId),preset=getProfessionPreset(professionId);
  for(const row of profile.skillCatalog){
    const branch=row.branches?.find(branch=>branch.selectable!==false)?.id??'none';
    try{return {schemaVersion:1,professionId,...normalizeSkills({loadout:[{skillId:row.skillId,branchId:branch},...Array(7).fill(null)],
      branchChoices:{[row.skillId]:branch}},profile,preset)};}catch{}
  }
  throw Error('Profession fixture needs at least one available source-supported skill: '+professionId);
}

test('IS API saves its own eight slots, restores selected profession and freezes IS/LK versions before a GM closure',async t=>{
  const f=await fixture(t,{driverProfessions:{RF:true,LK:true,VC:true,IS:true}});
  let gm=await f.login(0),a=await f.login(1),b=await f.login(2);
  const configs=Object.fromEntries(['RF','LK','VC','IS'].map(id=>[id,configuration(id)]));
  for(const [id,config] of Object.entries(configs)){
    const response=await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:config});assert.equal(response.status,200,id);
  }
  assert.equal((await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'IS'}})).status,200);
  await f.restart();gm=await f.login(0);a=await f.login(1);b=await f.login(2);
  assert.equal((await f.request('/api/session',{cookie:a})).json.professionId,'IS');
  for(const [id,config] of Object.entries(configs)){
    const response=await f.request('/api/skill-preferences?professionId='+id,{cookie:a});assert.equal(response.status,200);
    assert.deepEqual(response.json.preferences,{loadout:config.loadout,branchChoices:config.branchChoices});
  }
  assert.equal((await f.request('/api/preferences/profession',{cookie:b,method:'POST',body:{professionId:'LK'}})).status,200);
  assert.equal((await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}})).status,200);
  assert.equal((await f.request('/api/online/queue',{cookie:b,method:'POST',body:{mode:'1v1'}})).status,200);
  await f.advance(5000);assert.equal(f.matches.length,1);
  const frozen=structuredClone(f.matches[0]),is=frozen.players.find(player=>player.id==='alpha');
  assert.equal(is.professionId,'IS');assert.equal(is.unitClass,112);assert.deepEqual(is.loadout,configs.IS.loadout);
  for(const id of ['IS','LK'])for(const field of ['profile','preset','reference'])assert.match(frozen.versions.professions[id][field],/^[a-f0-9]{64}$/);
  assert.notEqual(frozen.versions.professions.IS.profile,frozen.versions.professions.LK.profile);
  assert.equal((await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{RF:true,LK:true,VC:true,IS:false}}})).status,200);
  assert.deepEqual(f.matches[0],frozen);assert.equal((await f.request('/api/session',{cookie:a})).json.professionId,'IS');
  assert.equal((await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:configs.IS})).status,409);
});
async function fixture(t,{seed,professions,driverProfessions}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'profession-api-')),accountRoot=path.join(root,'accounts');
  await mkdir(accountRoot);await seed?.(accountRoot);
  let instance,base,clock=1000;const matches=[];
  const start=async()=>{
    const driverFactory=({match})=>{matches.push(match);return {submitInput(){},ready(){},disconnect(){},stop(){},snapshot:()=>null};};
    if(professions||driverProfessions)driverFactory.professions=professions??driverProfessions;
    instance=await createDevServer({root,accountRoot,credentials:accounts[0],additionalCredentials:accounts.slice(1),publicOrigin:origin,
      now:()=>clock,driverFactory});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+instance.server.address().port;
  };
  const stop=async()=>{if(!instance)return;const current=instance;instance=null;current.closeStreams();await new Promise(resolve=>current.server.close(resolve));};
  t.after(async()=>{await stop();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
  await start();
  const request=async(route,{cookie,method='GET',body}={})=>{
    const response=await fetch(base+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:response.status,json:await response.json(),headers:response.headers};
  };
  const login=async(index)=>{const response=await request('/api/login',{method:'POST',body:accounts[index]});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  return {root,accountRoot,matches,request,login,restart:async()=>{await stop();await start();},
    advance:async ms=>{clock+=ms;await instance.online.tick();},get instance(){return instance;}};
}

test('actual RF and LK skill APIs keep legacy RF bytes and persist selected profession and independent configurations after restart',async t=>{
  const rf=configuration('RF'),lk=configuration('LK'),legacy=JSON.stringify({schemaVersion:1,loadout:rf.loadout,branchChoices:rf.branchChoices});
  const f=await fixture(t,{seed:async accountRoot=>{await mkdir(path.join(accountRoot,'skill-preferences'));await writeFile(path.join(accountRoot,'skill-preferences',key('alpha')+'.json'),legacy);}});
  let cookie=await f.login(1);const other=await f.login(2),file=path.join(f.accountRoot,'skill-preferences',key('alpha')+'.json');
  assert.equal((await f.request('/api/preferences/profession',{cookie})).json.professionId,'RF');
  assert.deepEqual((await f.request('/api/skill-preferences?professionId=RF',{cookie})).json.preferences,{loadout:rf.loadout,branchChoices:rf.branchChoices});
  assert.equal((await f.request('/api/preferences/profession',{cookie,method:'POST',body:{professionId:'LK'}})).status,200);
  assert.equal((await f.request('/api/skill-preferences?professionId=LK',{cookie})).json.preferences,null);
  const saved=await f.request('/api/skill-preferences',{cookie,method:'PUT',body:lk});assert.equal(saved.status,200);
  assert.equal(await readFile(file,'utf8'),legacy);assert.equal((await f.request('/api/preferences/profession',{cookie:other})).json.professionId,'RF');
  await f.request('/api/nickname-preferences',{cookie,method:'PUT',body:{nickname:'\uac0d\uac17\uac28\uac32'}});
  await f.restart();cookie=await f.login(1);
  const session=await f.request('/api/session',{cookie});assert.equal(session.json.professionId,'LK');assert.equal(session.json.nickname,'\uac0d\uac17\uac28\uac32');
  assert.deepEqual((await f.request('/api/skill-preferences',{cookie})).json.preferences,saved.json.preferences);
  assert.equal((await f.request('/api/preferences/profession',{cookie,method:'POST',body:{professionId:'RF'}})).status,200);
  assert.deepEqual((await f.request('/api/skill-preferences',{cookie})).json.preferences,{loadout:rf.loadout,branchChoices:rf.branchChoices});
  assert.equal(await readFile(file,'utf8'),legacy);
});

test('profession routes reject anonymous access, spoofed identities, invalid classes and cross-profession skills without overwriting',async t=>{
  const f=await fixture(t),cookie=await f.login(1),other=await f.login(2),lk=configuration('LK'),rf=configuration('RF');
  for(const route of ['/api/preferences/profession','/api/admin/professions','/api/skill-preferences?professionId=LK'])assert.equal((await f.request(route)).status,401);
  for(const body of [{professionId:'UNKNOWN'},{professionId:100},{professionId:null},{professionId:'LK',username:'beta'},[]])
    assert.equal((await f.request('/api/preferences/profession',{cookie,method:'POST',body})).status,400);
  assert.equal((await f.request('/api/skill-preferences?professionId=UNKNOWN',{cookie})).status,400);
  assert.equal((await f.request('/api/preferences/profession',{cookie,method:'POST',body:{professionId:'LK'}})).status,200);
  assert.equal((await f.request('/api/skill-preferences',{cookie,method:'PUT',body:lk})).status,200);
  assert.equal((await f.request('/api/skill-preferences',{cookie,method:'PUT',body:{...rf,professionId:'LK'}})).status,400);
  assert.equal((await f.request('/api/skill-preferences',{cookie,method:'PUT',body:{...lk,professionId:null}})).status,400);
  assert.deepEqual((await f.request('/api/skill-preferences',{cookie})).json.preferences,{loadout:lk.loadout,branchChoices:lk.branchChoices});
  assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'1v1',professionId:'RF'}})).status,400);
  assert.equal((await f.request('/api/admin/professions',{cookie,method:'POST',body:{professions:{RF:true,LK:false}}})).status,403);
  assert.equal((await f.request('/api/preferences/profession',{cookie:other})).json.professionId,'RF');
});

test('GM closures unlock disabled queue seats, all-off returns RF and both choices survive a server restart',async t=>{
  const f=await fixture(t);let gm=await f.login(0),player=await f.login(1);
  await f.request('/api/preferences/profession',{cookie:player,method:'POST',body:{professionId:'LK'}});
  assert.equal((await f.request('/api/online/queue',{cookie:player,method:'POST',body:{mode:'1v1'}})).status,200);
  assert.equal((await f.request('/api/preferences/profession',{cookie:player,method:'POST',body:{professionId:'RF'}})).status,409);
  assert.equal((await f.request('/api/skill-preferences',{cookie:player,method:'PUT',body:configuration('LK')})).status,409);
  for(const body of [{professions:{RF:true,LK:1}},{professions:{RF:true}},{professions:{RF:true,LK:false,OTHER:false}},[]])
    assert.equal((await f.request('/api/admin/professions',{cookie:gm,method:'POST',body})).status,400);
  const disabled=await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{RF:true,LK:false}}});assert.equal(disabled.status,200);
  const status=(await f.request('/api/online/status',{cookie:player})).json;assert.equal(status.locked,false);assert.equal(status.queueNotice.reason,'profession-disabled');
  assert.equal(status.professionId,'RF');assert.equal(status.selectedProfessionId,'LK');
  assert.equal((await f.request('/api/preferences/profession',{cookie:player,method:'POST',body:{professionId:'LK'}})).status,409);
  await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{RF:false,LK:false}}});
  assert.deepEqual((await f.request('/api/preferences/profession',{cookie:player})).json.professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.equal((await f.request('/api/online/queue',{cookie:player,method:'POST',body:{mode:'1v1'}})).status,200);
  await f.restart();gm=await f.login(0);player=await f.login(1);
  const restored=(await f.request('/api/session',{cookie:player})).json;
  assert.deepEqual(restored.professionFlags,{RF:false,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.equal(restored.professionId,'RF');assert.equal(restored.selectedProfessionId,'LK');
  await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{RF:true,LK:true}}});
  assert.equal((await f.request('/api/preferences/profession',{cookie:player})).json.professionId,'LK');
});

test('the queue selects only the authenticated saved profession and freezes a mixed match despite later GM changes',async t=>{
  const f=await fixture(t),gm=await f.login(0),a=await f.login(1),b=await f.login(2),lk=configuration('LK'),rf=configuration('RF');
  await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'LK'}});
  await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:lk});await f.request('/api/skill-preferences',{cookie:b,method:'PUT',body:rf});
  for(const cookie of [a,b])assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'1v1'}})).status,200);
  await f.advance(5000);assert.equal(f.matches.length,1);
  const frozen=structuredClone(f.matches[0]),alpha=frozen.players.find(player=>player.id==='alpha'),beta=frozen.players.find(player=>player.id==='beta');
  assert.equal(alpha.professionId,'LK');assert.equal(alpha.unitClass,100);assert.deepEqual(alpha.loadout,lk.loadout);
  assert.equal(beta.professionId,'RF');assert.equal(beta.unitClass,107);assert.deepEqual(beta.loadout,rf.loadout);
  assert.ok(/^[a-f0-9]{64}$/.test(frozen.versions.professions.LK.profile));assert.notEqual(frozen.versions.professions.LK.profile,frozen.versions.professions.RF.profile);
  assert.equal((await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'RF'}})).status,409);
  await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{RF:true,LK:false}}});
  assert.deepEqual(f.matches[0],frozen);assert.equal((await f.request('/api/online/status',{cookie:a})).json.match.players.find(player=>player.id==='alpha').professionId,'LK');
});

test('page reload boots the frozen queued and matched profession after GM reopens the saved choice',async t=>{
  const f=await fixture(t),gm=await f.login(0),a=await f.login(1),b=await f.login(2);
  const toggle=professions=>f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions}});
  await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'LK'}});
  await toggle({RF:true,LK:false});await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}});
  await toggle({RF:true,LK:true});
  let session=(await f.request('/api/session',{cookie:a})).json;
  assert.equal(session.professionId,'RF');assert.equal(session.selectedProfessionId,'LK');assert.equal(session.online.queued,true);
  assert.equal((await f.request('/api/skill-preferences',{cookie:a})).json.professionId,'RF');
  await f.request('/api/online/queue',{cookie:a,method:'DELETE'});
  assert.equal((await f.request('/api/session',{cookie:a})).json.professionId,'LK');
  await toggle({RF:true,LK:false});await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}});
  await f.request('/api/online/queue',{cookie:b,method:'POST',body:{mode:'1v1'}});await f.advance(5000);
  await toggle({RF:false,LK:true});session=(await f.request('/api/session',{cookie:a})).json;
  assert.equal(session.professionId,'RF');assert.equal(session.selectedProfessionId,'LK');assert.equal(session.professions.RF,false);
  assert.equal(session.online.match.players.find(player=>player.id==='alpha').professionId,'RF');assert.equal(session.online.locked,true);
});
test('costumes persist per character without changing career, nickname or skills; authenticated matching freezes appearance',async t=>{
  const f=await fixture(t);let a=await f.login(1),b=await f.login(2);
  assert.equal((await f.request('/api/preferences/costume')).status,401);
  const save=(professionId,costumeId)=>f.request('/api/preferences/costume',{cookie:a,method:'POST',body:{professionId,costumeId}});
  for(const costumeId of [null,'../officer','__proto__',123])assert.equal((await save('RF',costumeId)).status,400);
  assert.equal((await save('unknown','officer')).status,400);
  assert.equal((await save('IS','officer')).status,200,'IS shares Elsword costume preferences');
  assert.equal((await save('RF','officer')).status,200);
  assert.equal((await save('LK','solace')).status,200);
  assert.equal((await save('VC','nasod')).status,200,'Raven preference is shared with VC');
  await f.request('/api/nickname-preferences',{cookie:a,method:'PUT',body:{nickname:'\uac27\uac37\uac2c\uac3a'}});
  await f.restart();a=await f.login(1);b=await f.login(2);
  const session=(await f.request('/api/session',{cookie:a})).json;
  assert.deepEqual(session.costumes,{elsword:'solace',raven:'nasod',add:'default'});assert.equal(session.costumeId,'nasod');assert.equal(session.professionId,'RF');assert.equal(session.nickname,'\uac27\uac37\uac2c\uac3a');
  assert.equal((await f.request('/api/preferences/costume',{cookie:b})).json.costumeId,'default');
  assert.equal((await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}})).status,200);
  assert.equal((await save('RF','royal')).status,409);
  await f.request('/api/online/queue',{cookie:b,method:'POST',body:{mode:'1v1'}});await f.advance(5000);
  const status=(await f.request('/api/online/status',{cookie:a})).json;
  assert.equal(status.match.players.find(player=>player.id==='alpha').costumeId,'nasod');
  assert.equal(status.match.players.find(player=>player.id==='beta').costumeId,'default');
  assert.equal((await save('RF','default')).status,409);
});

test('RS costumes share the account Elsword choice and freeze separately from another LK player',async t=>{
  const f=await fixture(t,{professions:{RF:true,LK:true,VC:true,RS:true,BM:true}});let a=await f.login(1),b=await f.login(2);
  const save=(professionId,costumeId)=>f.request('/api/preferences/costume',{cookie:a,method:'POST',body:{professionId,costumeId}});
  assert.equal((await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'RS'}})).status,200);
  const skills=configuration('RS');
  const saved=await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:skills});assert.equal(saved.status,200);
  for(const costumeId of ['officer','nasod','royal','solace']){
    const result=await save('RS',costumeId);assert.equal(result.status,200);
    assert.equal(result.json.professionId,'RS');assert.equal(result.json.costumeId,costumeId);
    assert.deepEqual(result.json.costumes,{elsword:costumeId,raven:'default',add:'default'});
  }
  assert.equal((await save('LK','nasod')).json.costumeId,'nasod','LK changes the same account Elsword selection');
  await f.restart();a=await f.login(1);b=await f.login(2);
  const session=(await f.request('/api/session',{cookie:a})).json;
  assert.equal(session.professionId,'RS');assert.equal(session.costumeId,'nasod');
  assert.deepEqual((await f.request('/api/skill-preferences',{cookie:a})).json.preferences,saved.json.preferences);
  await f.request('/api/preferences/profession',{cookie:b,method:'POST',body:{professionId:'LK'}});
  assert.equal((await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1',costumeId:'royal'}})).status,400);
  assert.equal((await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}})).status,200);
  assert.equal((await save('LK','default')).status,409,'queued RS locks the shared character preference');
  await f.request('/api/online/queue',{cookie:b,method:'POST',body:{mode:'1v1'}});await f.advance(5000);
  const status=(await f.request('/api/online/status',{cookie:a})).json;
  const player=status.match.players.find(player=>player.id==='alpha'),opponent=status.match.players.find(player=>player.id==='beta');
  assert.equal(player.professionId,'RS');assert.equal(player.costumeId,'nasod','match uses the authenticated saved choice');
  assert.equal(player.costumeVersion,'costumes-2016-v1');
  assert.equal(opponent.professionId,'LK');assert.equal(opponent.costumeId,'default','another account has its own choice');
});

test('BM shares Raven costume storage, preserves its skill configuration and freezes appearance in the match',async t=>{
  const f=await fixture(t,{professions:{RF:true,LK:true,VC:true,RS:true,BM:true}}),gm=await f.login(0);let a=await f.login(1),b=await f.login(2);
  const flags=(await f.request('/api/admin/professions',{cookie:gm})).json.professionFlags;
  assert.equal((await f.request('/api/admin/professions',{cookie:gm,method:'POST',body:{professions:{...flags,BM:true}}})).status,200);
  const skill=configuration('BM');
  assert.equal((await f.request('/api/preferences/profession',{cookie:a,method:'POST',body:{professionId:'BM'}})).status,200);
  assert.equal((await f.request('/api/skill-preferences',{cookie:a,method:'PUT',body:skill})).status,200);
  const save=(professionId,costumeId)=>f.request('/api/preferences/costume',{cookie:a,method:'POST',body:{professionId,costumeId}});
  assert.equal((await save('BM','officer')).status,200);
  const updated=await save('VC','royal');assert.equal(updated.json.professionId,'BM');assert.equal(updated.json.costumeId,'royal');
  assert.equal((await save('LK','solace')).status,200);
  await f.restart();a=await f.login(1);b=await f.login(2);
  const session=(await f.request('/api/session',{cookie:a})).json;
  assert.equal(session.professionId,'BM');assert.equal(session.costumeId,'royal');assert.deepEqual(session.costumes,{raven:'royal',elsword:'solace',add:'default'});
  assert.deepEqual((await f.request('/api/skill-preferences?professionId=BM',{cookie:a})).json.preferences,{loadout:skill.loadout,branchChoices:skill.branchChoices});
  await f.request('/api/online/queue',{cookie:a,method:'POST',body:{mode:'1v1'}});
  assert.equal((await save('RF','nasod')).status,409,'shared character cannot bypass the BM queue lock');
  await f.request('/api/online/queue',{cookie:b,method:'POST',body:{mode:'1v1'}});await f.advance(5000);
  const player=(await f.request('/api/online/status',{cookie:a})).json.match.players.find(player=>player.id==='alpha');
  assert.equal(player.professionId,'BM');assert.equal(player.costumeId,'royal');assert.equal(player.costumeVersion,'costumes-2016-v1');
  assert.equal((await save('BM','default')).status,409);
});
