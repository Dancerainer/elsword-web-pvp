import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
const observed=source.replace("await import('/game/game.js' + version);",'await loadedGame(version);');
const key='rf-last-login-account-v1';

async function page({saved='previous-player',loginStatus=200,storageFailure,networkFailure=false}={}){
  const app={dataset:{},innerHTML:''},username={value:'rf-tester'},password={value:''},button={disabled:false},error={textContent:''};
  const entries=new Map(saved==null?[]:[[key,saved]]),writes=[],requests=[],listeners=new Map(),loaded=[];
  const storage={getItem(name){if(storageFailure==='read')throw Error('storage disabled');return entries.get(name)??null;},
    setItem(name,value){if(storageFailure==='write')throw Error('quota exceeded');writes.push({name,value});entries.set(name,value);}};
  const window={addEventListener(){}};
  Object.defineProperty(window,'localStorage',{get(){if(storageFailure==='access')throw Error('storage disabled');return storage;}});
  const form={querySelector(selector){return selector==='button'?button:selector==='input[name="username"]'?username:null;},
    addEventListener(name,callback){listeners.set(name,callback);}};
  let authenticated=false;
  const sandbox={window,crypto:{randomUUID:()=> 'account-memory-page-123'},location:{reload(){}},
    document:{querySelector(selector){return selector==='#app'?app:selector==='#login-error'?error:form;},
      createElement:()=>({}),head:{append(){}}},
    FormData:class {constructor(){return new Map([['username',username.value],['password',password.value]]);}},
    setInterval(){return 1;},clearInterval(){},loadedGame:async version=>loaded.push(version),
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(url==='/api/login'){
        if(networkFailure)throw Error('network unavailable');
        authenticated=loginStatus===200;return {ok:authenticated,status:loginStatus};
      }
      return {ok:authenticated,status:authenticated?200:401,json:async()=>({buildVersion:'memory-fixture'})};
    }};
  await new vm.Script('(async()=>{'+observed+'})()').runInNewContext(sandbox);
  return {username,password,button,error,entries,writes,requests,loaded,
    async submit(account='new-player'){username.value=account;password.value='private-test-password';await listeners.get('submit')({preventDefault(){},currentTarget:form});}};
}

test('login restores the last successful browser account ahead of the page default without restoring a password',async()=>{
  const p=await page();assert.equal(p.username.value,'previous-player');assert.equal(p.password.value,'');assert.deepEqual(p.writes,[]);
  for(const saved of [null,'']){const fresh=await page({saved});assert.equal(fresh.username.value,'rf-tester');assert.equal(fresh.password.value,'');}
});

test('successful login stores only its account and the next page restores it',async()=>{
  const p=await page();await p.submit();
  assert.deepEqual(p.writes,[{name:key,value:'new-player'}]);assert.equal(p.entries.size,1);
  assert.deepEqual(p.loaded,['?v=memory-fixture']);
  assert.deepEqual(JSON.parse(p.requests.find(r=>r.url==='/api/login').options.body),{username:'new-player',password:'private-test-password'});
  assert.ok(p.writes.every(w=>!JSON.stringify(w).includes('private-test-password')));
  const next=await page({saved:p.entries.get(key)});assert.equal(next.username.value,'new-player');assert.equal(next.password.value,'');
});

test('wrong credentials, duplicate login, rate limits and transport errors keep the previous successful account',async t=>{
  for(const options of [{loginStatus:401},{loginStatus:409},{loginStatus:429},{networkFailure:true}]){
    await t.test(JSON.stringify(options),async()=>{const p=await page(options);await p.submit();assert.equal(p.entries.get(key),'previous-player');assert.deepEqual(p.writes,[]);assert.equal(p.loaded.length,0);assert.equal(p.button.disabled,false);assert.ok(p.error.textContent);});
  }
});

test('blocked localStorage access, read errors and full storage never block authentication or game entry',async t=>{
  for(const storageFailure of ['access','read','write']){
    await t.test(storageFailure,async()=>{const p=await page({storageFailure});await p.submit();assert.deepEqual(p.loaded,['?v=memory-fixture']);assert.equal(p.error.textContent,'');});
  }
});
