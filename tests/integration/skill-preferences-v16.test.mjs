import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillPreferencesClient} from '../../apps/web/skill-preferences.mjs';

const blank=()=>Array(8).fill(null);
const config=(loadout=blank(),branchChoices={})=>({loadout,branchChoices});
const definitions=[
  {id:10,branches:[{id:'left',selectable:true},{id:'right',selectable:true}]},
  {id:11,branches:[{id:'unequipped',supported:false,selectable:true},{id:'disabled',selectable:false}]},
  {id:12,branches:[{id:'unsupported',selectable:true}]},
  {id:13,type:1}, {id:14,template:{m_eActiveSkillUseCondtion:0}},
  {id:15,replacedAtMax:true,maxUpgradeId:10}, {id:18,branches:[]},
];
const supportFor=id=>({supported:id!==12,pvpDisabled:id===18,
  branches:definitions.find(skill=>skill.id===id)?.branches??[]});
const defaults=[{skillId:10,branchId:'none'},{skillId:11,branchId:'none'},null,null,null,null,null,null];
const loadArgs=(username='alice')=>({username,defaults,definitions,supportFor});
const response=preferences=>Response.json({preferences});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(...steps){
  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,...options});const step=steps.shift();
    assert.notEqual(step,undefined,'unexpected request');return typeof step==='function'?step(options):step;};
  return {calls,fetch};
}
const clone=value=>JSON.parse(JSON.stringify(value));

test('profession requests isolate the same account and LK never imports legacy RF traits',async()=>{
  const keys=[],wire=fixture(response(config(defaults)),response(null),options=>response(JSON.parse(options.body)),options=>response(JSON.parse(options.body)));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:key=>{keys.push(key);return '{"10":"right"}';}}});
  const rf=await client.load({...loadArgs(),professionId:'RF'});
  const lk=await client.load({...loadArgs(),professionId:'LK'});
  assert.deepEqual(keys,[]);assert.equal(wire.calls[0].url,'/api/skill-preferences?professionId=RF');assert.equal(wire.calls[1].url,'/api/skill-preferences?professionId=LK');
  assert.equal(JSON.parse(wire.calls[2].body).professionId,'LK');assert.equal(lk.loadout[0].branchId,'none');
  await assert.rejects(client.save(rf),/Account changed/);await client.save(lk);assert.equal(JSON.parse(wire.calls[3].body).professionId,'LK');
});

test('server configuration wins without reading local storage and requests use the HTTP contract',async()=>{
  const slots=blank();slots[4]={skillId:10,branchId:'left'};
  const saved=config(slots,{10:'right',11:'unequipped'});
  const wire=fixture(response(saved),options=>response(JSON.parse(options.body)));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:()=>assert.fail('server wins')}});
  const actual=await client.load(loadArgs());
  assert.deepEqual(actual,{loadout:[null,null,null,null,{skillId:10,branchId:'right'},null,null,null],branchChoices:{10:'right',11:'unequipped'}});
  assert.notEqual(actual,saved);assert.equal(saved.loadout[4].branchId,'left');
  const returned=await client.save(actual);assert.deepEqual(returned,actual);assert.notEqual(returned,actual);
  assert.deepEqual(wire.calls[0],{url:'/api/skill-preferences',method:'GET',credentials:'same-origin',cache:'no-store'});
  assert.deepEqual(wire.calls[1],{url:'/api/skill-preferences',method:'PUT',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,...actual})});
  assert.equal(Object.hasOwn(wire.calls[1].headers,'Origin'),false,'the browser supplies Origin');
});

test('first unconfigured account migrates only its old key and resolves after server confirmation',async()=>{
  const put=deferred(),readKeys=[];
  const wire=fixture(response(null),()=>put.promise);
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:key=>{
    readKeys.push(key);return JSON.stringify({10:'right',11:'unequipped',12:'unsupported',999:'forged'});}}});
  let settled=false;const loading=client.load(loadArgs()).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false);assert.deepEqual(readKeys,['rf-picker-branches-v12:alice']);
  assert.deepEqual(JSON.parse(wire.calls[1].body),{schemaVersion:1,loadout:[{skillId:10,branchId:'right'},
    {skillId:11,branchId:'unequipped'},null,null,null,null,null,null],branchChoices:{10:'right',11:'unequipped'}});
  await assert.rejects(client.save(config()),/Load the current account/);
  put.resolve(response(config(blank(),{11:'unequipped'})));
  assert.deepEqual(await loading,config(blank(),{11:'unequipped'}),'use the server-confirmed normalized result');
});

test('an explicitly saved all-empty bar stays empty and preserves unequipped branches',async()=>{
  const wire=fixture(response(config(blank(),{11:'unequipped'})));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:()=>assert.fail('no migration')}});
  assert.deepEqual(await client.load(loadArgs()),config(blank(),{11:'unequipped'}));
  assert.equal(wire.calls.length,1);
});

test('disabled or corrupt local storage still permits first server save and later server reads',async()=>{
  for(const storage of [undefined,{getItem(){throw Error('SecurityError');}},{getItem:()=>'{bad'},
    {getItem:()=>JSON.stringify(['right'])}]){
    const wire=fixture(response(null),options=>response(JSON.parse(options.body)),response(config()));
    const client=createSkillPreferencesClient({fetch:wire.fetch,storage});
    assert.deepEqual(await client.load(loadArgs()),config(clone(defaults),{10:'none',11:'none'}));
    assert.deepEqual(await client.load(loadArgs()),config());assert.equal(wire.calls.length,3);
  }
});

test('GET failures and malformed responses never become an unconfigured account or cause PUT',async()=>{
  for(const persistDefaults of [true,false])for(const step of [()=>{throw Error('offline');},new Response('',{status:401}),new Response('',{status:500}),
    new Response('{bad',{headers:{'Content-Type':'application/json'}}),Response.json({}),response(undefined),
    response({schemaVersion:2,loadout:blank(),branchChoices:{}}),response({loadout:[],branchChoices:{}})]){
    const wire=fixture(step),client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:()=>assert.fail('GET failed')}});
    await assert.rejects(client.load({...loadArgs(),persistDefaults}),/skill setup|Session expired/i);
    await assert.rejects(client.save(config()),/Load the current account/);assert.equal(wire.calls.length,1);
  }
});

test('read-only first load validates defaults and RF legacy traits without PUT, then activates explicit saving',async()=>{
  for(const professionId of ['RF','LK']){
    const keys=[],wire=fixture(response(null),options=>response(JSON.parse(options.body))),before=clone(defaults);
    const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:key=>{keys.push(key);return '{"10":"right","11":"disabled","999":"forged"}';}}});
    const actual=await client.load({...loadArgs(),professionId,persistDefaults:false});
    assert.equal(wire.calls.length,1);assert.equal(wire.calls[0].method,'GET');assert.deepEqual(defaults,before);
    assert.deepEqual(actual,config([{skillId:10,branchId:professionId==='RF'?'right':'none'},{skillId:11,branchId:'none'},...blank().slice(2)],
      {10:professionId==='RF'?'right':'none',11:'none'}));
    assert.deepEqual(keys,professionId==='RF'?['rf-picker-branches-v12:alice']:[]);
    assert.deepEqual(await client.save(actual),actual);assert.equal(wire.calls.length,2);assert.equal(wire.calls[1].method,'PUT');
    assert.equal(JSON.parse(wire.calls[1].body).professionId,professionId);
  }
});

test('invalid default persistence options reject before issuing a request or activating the client',async()=>{
  for(const persistDefaults of ['false',0,null,{}]){
    const wire=fixture(),client=createSkillPreferencesClient({fetch:wire.fetch});
    await assert.rejects(client.load({...loadArgs(),persistDefaults}),/Invalid default save option/);
    await assert.rejects(client.save(config()),/Load the current account/);assert.equal(wire.calls.length,0);
  }
});

test('failed first migration does not activate the client; a later load retries from GET',async()=>{
  const wire=fixture(response(null),new Response('',{status:503}),response(null),options=>response(JSON.parse(options.body)));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:()=>'{"11":"unequipped"}'}});
  await assert.rejects(client.load(loadArgs()),/save failed/);
  await assert.rejects(client.save(config()),/Load the current account/);
  assert.equal((await client.load(loadArgs())).branchChoices[11],'unequipped');
  assert.deepEqual(wire.calls.map(call=>call.method),['GET','PUT','GET','PUT']);
});

test('safe restore uses current highest supported definitions without moving slot indices',async()=>{
  const source={schemaVersion:1,loadout:[{skillId:15,branchId:'left'},{skillId:10,branchId:'right'},
    {skillId:12,branchId:'unsupported'},{skillId:13},{skillId:14},{skillId:18},{skillId:999},{skillId:11,branchId:'disabled'}],
    branchChoices:{15:'left',10:'right',11:'unequipped',12:'unsupported',13:'none',18:'none',999:'forged'}};
  const before=clone(source),wire=fixture(response(source)),client=createSkillPreferencesClient({fetch:wire.fetch});
  assert.deepEqual(await client.load(loadArgs()),{loadout:[{skillId:10,branchId:'right'},null,null,null,null,null,null,
    {skillId:11,branchId:'unequipped'}],branchChoices:{10:'right',11:'unequipped'}});
  assert.deepEqual(source,before);
});

test('invalid traits restore to none; missing tree traits come from the valid equipped slot',async()=>{
  const slots=blank();slots[0]={skillId:10,branchId:'left'};
  const wire=fixture(response(config(slots,{10:'forged',11:'disabled'})),response(config(slots)));
  const client=createSkillPreferencesClient({fetch:wire.fetch});
  assert.deepEqual(await client.load(loadArgs()),{loadout:[{skillId:10,branchId:'none'},null,null,null,null,null,null,null],
    branchChoices:{10:'none',11:'none'}});
  assert.deepEqual(await client.load(loadArgs()),{loadout:slots,branchChoices:{10:'left'}});
});

test('save takes a full detached snapshot, including choices on unequipped nodes',async()=>{
  const put=deferred(),wire=fixture(response(config()),()=>put.promise);
  const client=createSkillPreferencesClient({fetch:wire.fetch});await client.load(loadArgs());
  const proposal=config(blank(),{11:'unequipped'}),saving=client.save(proposal);
  proposal.loadout[0]={skillId:10,branchId:'right'};proposal.branchChoices[11]='none';
  assert.deepEqual(JSON.parse(wire.calls[1].body),{schemaVersion:1,loadout:blank(),branchChoices:{11:'unequipped'}});
  await assert.rejects(client.save(config()),/is saving/);
  put.resolve(response(config(blank(),{11:'unequipped'})));
  assert.deepEqual(await saving,config(blank(),{11:'unequipped'}));
});

test('save rejection preserves the caller config and allows retry after network or response failure',async()=>{
  for(const failed of [()=>{throw Error('offline');},new Response('',{status:401}),new Response('',{status:500}),
    new Response('{bad'),response(null),response({schemaVersion:2,loadout:blank(),branchChoices:{}})]){
    const wire=fixture(response(config()),failed,options=>response(JSON.parse(options.body)));
    const client=createSkillPreferencesClient({fetch:wire.fetch});await client.load(loadArgs());
    const proposal=config(blank(),{11:'unequipped'}),before=clone(proposal);
    await assert.rejects(client.save(proposal),/skill setup|Session expired/i);assert.deepEqual(proposal,before);
    assert.deepEqual(await client.save(proposal),before);
  }
});

test('switching accounts clears the prior context even if the next GET fails',async()=>{
  const wire=fixture(response(config(blank(),{10:'right'})),new Response('',{status:500}),response(config()));
  const client=createSkillPreferencesClient({fetch:wire.fetch}),alice=await client.load(loadArgs());
  await assert.rejects(client.load(loadArgs('bob')),/load failed/);
  await assert.rejects(client.save(alice),/Load the current account/);
  await client.load(loadArgs('bob'));await assert.rejects(client.save(alice),/Account changed/);
  assert.equal(wire.calls.length,3);
});

test('an old GET result cannot trigger migration or replace a newer account config',async()=>{
  const first=deferred(),wire=fixture(()=>first.promise,response(config(blank(),{11:'unequipped'})));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:()=>assert.fail('stale migration')}});
  const alice=client.load(loadArgs());const rejection=assert.rejects(alice,/Account changed/);
  const bob=await client.load(loadArgs('bob'));first.resolve(response(null));await rejection;
  assert.deepEqual(bob,config(blank(),{11:'unequipped'}));assert.equal(wire.calls.length,2);
});

test('an old save completion cannot be returned as the next account; next save uses its config',async()=>{
  const oldPut=deferred(),wire=fixture(response(config()),()=>oldPut.promise,response(config()),options=>response(JSON.parse(options.body)));
  const client=createSkillPreferencesClient({fetch:wire.fetch});await client.load(loadArgs());
  const oldSave=client.save(config(blank(),{10:'right'})),rejection=assert.rejects(oldSave,/Account changed/);
  const bob=await client.load(loadArgs('bob'));
  assert.deepEqual(await client.save(bob),config(),'a pending prior-account save does not block the new account');
  oldPut.resolve(response(config(blank(),{10:'right'})));await rejection;
  assert.deepEqual(JSON.parse(wire.calls[3].body),{schemaVersion:1,loadout:blank(),branchChoices:{}});
});

test('a prior-account save cleanup cannot release the current account save guard',async()=>{
  const oldPut=deferred(),newPut=deferred();
  const wire=fixture(response(config()),()=>oldPut.promise,response(config()),()=>newPut.promise);
  const client=createSkillPreferencesClient({fetch:wire.fetch});await client.load(loadArgs());
  const aliceSave=client.save(config()),rejection=assert.rejects(aliceSave,/Account changed/);
  const bob=await client.load(loadArgs('bob')),bobSave=client.save(bob);
  oldPut.resolve(response(config()));await rejection;
  await assert.rejects(client.save(bob),/is saving/);
  newPut.resolve(response(config()));assert.deepEqual(await bobSave,config());
  assert.equal(wire.calls.length,4);
});

test('account switch between response parsing and save continuation rejects the stale confirmation',async()=>{
  let bobLoad,client;
  const oldResponse=response(config(blank(),{10:'right'})),read=oldResponse.json.bind(oldResponse);
  oldResponse.json=()=>{
    const parsed=read();parsed.then(()=>queueMicrotask(()=>{bobLoad=client.load(loadArgs('bob'));}));return parsed;
  };
  const wire=fixture(response(config()),oldResponse,response(config()));
  client=createSkillPreferencesClient({fetch:wire.fetch});await client.load(loadArgs());
  await assert.rejects(client.save(config(blank(),{10:'right'})),/Account changed/);
  assert.deepEqual(await bobLoad,config());assert.equal(wire.calls.length,3);
});

test('migration keys are isolated for consecutive new accounts and never rewritten locally',async()=>{
  const keys=[],wire=fixture(response(null),options=>response(JSON.parse(options.body)),response(null),options=>response(JSON.parse(options.body)));
  const client=createSkillPreferencesClient({fetch:wire.fetch,storage:{getItem:key=>{keys.push(key);
    return key.endsWith(':alice')?'{"10":"right"}':'{"11":"unequipped"}';},setItem:()=>assert.fail('server only')}});
  assert.equal((await client.load(loadArgs())).branchChoices[10],'right');
  assert.deepEqual((await client.load(loadArgs('bob'))).branchChoices,{10:'none',11:'unequipped'});
  assert.deepEqual(keys,['rf-picker-branches-v12:alice','rf-picker-branches-v12:bob']);
});
