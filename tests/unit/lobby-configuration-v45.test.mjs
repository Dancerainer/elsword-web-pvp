import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLobbyConfiguration} from '../../apps/web/lobby-configuration.mjs';
import {PROFESSIONS} from '../../packages/professions/catalog.mjs';

function fixture(initial={}){
 const saved=new Map(Object.entries(initial)),requests=[],writes=[];let fail=false;
 const configuration=createLobbyConfiguration({username:'isolated-config-test',loadData:async url=>{
  requests.push(url);return JSON.parse(await readFile(new URL('../../artifacts/'+url.slice('/assets/'.length),import.meta.url),'utf8'));
 },fetch:async(url,options={})=>{
  const id=new URL(url,'http://fixture.local').searchParams.get('professionId');
  if(fail)return {ok:false,status:503};
  if(options.method==='PUT'){const value=JSON.parse(options.body);saved.set(id,value);writes.push(value);}
  return {ok:true,json:async()=>({preferences:saved.get(id)??null})};
 }});
 return {configuration,saved,requests,writes,set fail(value){fail=value;}};
}
test('cold MM catalog configuration has no simulation or writes and concurrent reads share one catalog',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.configuration.loadProfession('MM'),f.configuration.loadProfession('MM')]);
 assert.equal(a,b);assert.deepEqual(f.requests,[PROFESSIONS.MM.catalogUrl]);assert.equal(f.writes.length,0);
 assert.deepEqual(a.loadout,Array(8).fill(null));assert.ok(a.supportFor(29035).supported);assert.ok(a.definitions.find(skill=>skill.id===29035).branches.length);
 assert.deepEqual(f.configuration.proof().loadedProfessions,['MM']);assert.equal(f.configuration.proof().modelLoads,0);
});
test('saved base node restores the exact enhanced node and full empty slot representation',async()=>{
 const f=fixture({MM:{schemaVersion:1,loadout:[{skillId:29013},null,null,null,null,null,null,null],branchChoices:{}}});
 const row=await f.configuration.loadProfession('MM');assert.equal(row.loadout[0].skillId,29035);
 await f.configuration.confirm('MM');assert.equal(f.writes.length,1);assert.equal(f.writes[0].professionId,'MM');
 assert.deepEqual(f.writes[0].loadout,[{skillId:29035,branchId:'none'},null,null,null,null,null,null,null]);
});
test('profession switching retains equipped and unequipped traits without leaking them into another profession',async()=>{
 const f=fixture();const mm=await f.configuration.loadProfession('MM');
 const branch=mm.definitions.find(skill=>skill.id===29035).branches.find(branch=>branch.selectable!==false),id=String(branch.branchId??branch.id);
 await f.configuration.save('MM',{loadout:[{skillId:29035,branchId:id},null,null,null,null,null,null,null],branchChoices:{29035:id}});
 const lp=await f.configuration.loadProfession('LP');assert.deepEqual(lp.loadout,Array(8).fill(null));assert.deepEqual(lp.branchChoices,{});
 const again=await f.configuration.loadProfession('MM');assert.equal(again.loadout[0].skillId,29035);assert.equal(again.loadout[0].branchId,id);assert.equal(again.branchChoices[29035],id);
 assert.equal(f.saved.has('LP'),false,'viewing another profession cannot persist defaults');
});
test('failed preference admission never caches an editable profile or persists fallback defaults',async()=>{
 const f=fixture();f.fail=true;await assert.rejects(f.configuration.loadProfession('RF'),/load failed/);
 assert.deepEqual(f.configuration.proof().loadedProfessions,[]);assert.deepEqual(f.configuration.proof().pendingProfessions,[]);assert.equal(f.writes.length,0);
 f.fail=false;const row=await f.configuration.loadProfession('RF');assert.equal(row.loadout.filter(Boolean).length,4);assert.equal(f.writes.length,0);
 await assert.rejects(f.configuration.save('RF',{loadout:[],branchChoices:{}}),/Invalid/);assert.equal(f.writes.length,0);
});
