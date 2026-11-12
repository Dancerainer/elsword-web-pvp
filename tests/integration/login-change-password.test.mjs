import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../apps/web/login.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../../apps/web/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../../apps/web/login.css',import.meta.url),'utf8');
const observed=source.replace("await import('/game/game.js' + version);",'await loadedGame(version);');
const storageKey='rf-last-login-account-v1';

// The fixture takes field names and attributes from the actual login shell.
// FormData excludes disabled inputs, as a browser does during submission.
async function page({saved='previous-player',storageFailure,changeReplies=[{status:200,body:{ok:true}}],changeTransport,session={}}={}){
  let activeElement=null,authenticated=false;
  const entries=new Map(saved==null?[]:[[storageKey,saved]]),writes=[],requests=[],loaded=[],intervals=[];
  const elements=new Map();
  function attributes(markup){
    return Object.fromEntries([...markup.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],match[2]??'']));
  }
  function element(attrs={}){
    return {attrs,id:attrs.id,hidden:'hidden' in attrs,disabled:false,textContent:'',value:attrs.value??'',listeners:new Map(),
      setAttribute(name,value){this.attrs[name]=value;},getAttribute(name){return this.attrs[name]??null;},
      focus(){activeElement=this;},addEventListener(name,callback){this.listeners.set(name,callback);},
      async dispatch(name,event={}){return await this.listeners.get(name)?.({preventDefault(){},currentTarget:this,...event});}};
  }
  for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){
    const attrs=attributes(match[2]);elements.set(attrs.id,element(attrs));
  }
  for(const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)){
    const attrs=attributes(match[1]),form=elements.get(attrs.id);
    form.fields=[...match[2].matchAll(/<input\b([^>]*)>/g)].map(input=>element(attributes(input[1])));
    form.buttons=[...match[2].matchAll(/<button\b([^>]*)>/g)].map(button=>{
      const buttonAttrs=attributes(button[1]);return elements.get(buttonAttrs.id)??element(buttonAttrs);
    });
    form.querySelectorAll=selector=>selector==='input, button'?[...form.fields,...form.buttons]:
      selector==='input[type="password"]'?form.fields.filter(field=>field.attrs.type==='password'):[];
    form.querySelector=selector=>{
      if(selector==='button')return form.buttons[0];
      const named=selector.match(/^input\[name="([^"]+)"\]$/);
      if(named)return form.fields.find(field=>field.attrs.name===named[1])??null;
      if(selector==='input[type="password"]')return form.fields.find(field=>field.attrs.type==='password')??null;
      assert.fail(`Unexpected form selector: ${selector}`);
    };
  }
  const app=elements.get('app');app.dataset={};app.innerHTML='';app.replaceChildren=node=>{app.textContent=node.textContent;};
  const storage={getItem(name){if(storageFailure==='read')throw Error('storage unavailable');return entries.get(name)??null;},
    setItem(name,value){if(storageFailure==='write')throw Error('storage full');writes.push({name,value});entries.set(name,value);}};
  const window={addEventListener(){}};
  Object.defineProperty(window,'localStorage',{get(){if(storageFailure==='access')throw Error('storage unavailable');return storage;}});
  const replies=[...changeReplies];
  const sandbox={window,URLSearchParams,crypto:{randomUUID:()=> 'password-change-page-123'},location:{reload(){}},
    document:{querySelector(selector){const found=elements.get(selector.slice(1));assert.ok(found,`Missing HTML element ${selector}`);return found;},
      createElement:()=>({}),head:{append(){}}},
    FormData:class {constructor(form){return new Map(form.fields.filter(field=>!field.disabled).map(field=>[field.attrs.name,field.value]));}},
    setInterval(fn,delay){intervals.push({fn,delay});return intervals.length;},clearInterval(){},loadedGame:async version=>loaded.push(version),
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(url==='/api/change-password'){
        if(changeTransport)return await changeTransport(url,options);
        const reply=replies.shift();assert.ok(reply,'A password change reply must be supplied');
        if(reply.networkFailure)throw Error('fixture network failure');
        return {ok:reply.status>=200&&reply.status<300,status:reply.status,json:async()=>{
          if(reply.jsonFailure)throw Error('invalid response JSON');return reply.body;
        }};
      }
      if(url==='/api/login'){authenticated=true;return {ok:true,status:200};}
      if(url==='/api/logout'){authenticated=false;return {ok:true,status:200};}
      assert.equal(url,'/api/session');
      return {ok:authenticated,status:authenticated?200:401,json:async()=>({buildVersion:'password-change-fixture',...session})};
    }};
  assert.notEqual(observed,source);
  await new vm.Script('(async()=>{'+observed+'})()').runInNewContext(sandbox);
  const loginForm=elements.get('login-form'),passwordForm=elements.get('change-password-form');
  const loginUsername=loginForm.querySelector('input[name="username"]'),loginPassword=loginForm.querySelector('input[name="password"]');
  const username=passwordForm.querySelector('input[name="username"]'),oldPassword=passwordForm.querySelector('input[name="oldPassword"]'),newPassword=passwordForm.querySelector('input[name="newPassword"]');
  return {elements,loginForm,passwordForm,loginUsername,loginPassword,username,oldPassword,newPassword,entries,writes,requests,loaded,intervals,
    get activeElement(){return activeElement;},
    get error(){return elements.get('change-password-error').textContent;},
    get status(){return elements.get('login-status').textContent;},
    get changeRequests(){return requests.filter(request=>request.url==='/api/change-password');},
    async click(id){return await elements.get(id).dispatch('click');},
    async submitChange(values={}){for(const [name,value] of Object.entries(values))passwordForm.querySelector(`input[name="${name}"]`).value=value;return await passwordForm.dispatch('submit');},
    async submitLogin(account=loginUsername.value,password='private-new-password'){loginUsername.value=account;loginPassword.value=password;return await loginForm.dispatch('submit');},
    passwords(){return [loginPassword.value,oldPassword.value,newPassword.value];},
    controls(){return [...loginForm.querySelectorAll('input, button'),...passwordForm.querySelectorAll('input, button'),elements.get('restore-saved-account')];}};
}

test('the anonymous password change view contains only account, old password and new password with accessible state',async()=>{
  const p=await page();
  assert.deepEqual(p.passwordForm.fields.map(field=>field.attrs.name),['username','oldPassword','newPassword']);
  assert.ok(p.passwordForm.fields.every(field=>'required' in field.attrs));
  assert.equal(p.oldPassword.attrs.autocomplete,'current-password');assert.equal(p.newPassword.attrs.autocomplete,'new-password');
  assert.equal(p.newPassword.attrs.minlength,'6');assert.equal(p.newPassword.attrs.maxlength,'128');
  assert.equal(p.passwordForm.hidden,true);assert.equal(p.loginForm.hidden,false);
  assert.equal(p.passwordForm.getAttribute('aria-labelledby'),'change-password-title');
  assert.equal(p.elements.get('change-password-error').getAttribute('role'),'alert');
  assert.equal(p.elements.get('login-status').getAttribute('role'),'status');
  assert.match(css,/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/i,'hidden controls stay hidden despite button display styles');
  assert.equal(p.requests.length,1);assert.equal(p.requests[0].url,'/api/session');
  assert.equal(p.intervals.length,0);assert.deepEqual(p.loaded,[]);
});

test('switching views and restoring the successful account clear passwords while preserving exact account text',async()=>{
  const p=await page();p.loginUsername.value=' edited-account ';p.loginPassword.value='private-login-password';
  await p.click('show-change-password');
  assert.equal(p.loginForm.hidden,true);assert.equal(p.passwordForm.hidden,false);assert.equal(p.username.value,' edited-account ');
  assert.equal(p.elements.get('show-change-password').getAttribute('aria-expanded'),'true');
  assert.deepEqual(p.passwords(),['','','']);assert.equal(p.activeElement,p.oldPassword);
  p.username.value=' another-account ';p.oldPassword.value='private-old-password';p.newPassword.value='private-new-password';
  await p.click('back-to-login');assert.equal(p.loginUsername.value,' another-account ');assert.deepEqual(p.passwords(),['','','']);
  assert.equal(p.loginForm.hidden,false);assert.equal(p.passwordForm.hidden,true);assert.equal(p.elements.get('show-change-password').getAttribute('aria-expanded'),'false');
  p.loginPassword.value='private-login-password';await p.click('restore-saved-account');
  assert.equal(p.loginUsername.value,'previous-player');assert.deepEqual(p.passwords(),['','','']);
  await p.click('show-change-password');p.username.value='temporary-account';p.oldPassword.value='private-old-password';p.newPassword.value='private-new-password';
  p.elements.get('change-password-error').textContent='previous error';await p.click('restore-saved-account');
  assert.equal(p.username.value,'previous-player');assert.deepEqual(p.passwords(),['','','']);assert.equal(p.error,'');
  assert.equal(p.elements.get('restore-saved-account').hidden,false);assert.deepEqual(p.writes,[]);assert.equal(p.changeRequests.length,0);
});

test('successful password change posts exact strings, clears all passwords and returns to login without persisting secrets',async()=>{
  const p=await page();await p.click('show-change-password');
  const credentials={username:' spaced-player ',oldPassword:'  old😀 password  ',newPassword:'  new😀 password  '};
  await p.submitChange(credentials);
  assert.equal(p.changeRequests.length,1);
  const request=p.changeRequests[0];assert.equal(request.options.method,'POST');assert.equal(request.options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(request.options.body),credentials);
  assert.equal(p.passwordForm.hidden,true);assert.equal(p.loginForm.hidden,false);assert.equal(p.loginUsername.value,credentials.username);
  assert.match(p.status,/Password changed.*new password/);assert.deepEqual(p.passwords(),['','','']);
  assert.ok(p.controls().every(control=>!control.disabled));assert.equal(p.passwordForm.getAttribute('aria-busy'),'false');
  assert.deepEqual(p.writes,[]);assert.equal(p.entries.get(storageKey),'previous-player');assert.equal(p.entries.size,1);
  assert.equal(p.intervals.length,0);assert.deepEqual(p.loaded,[]);
  await p.submitLogin(credentials.username,credentials.newPassword);
  assert.deepEqual(JSON.parse(p.requests.find(request=>request.url==='/api/login').options.body),{username:credentials.username,password:credentials.newPassword});
  assert.deepEqual(p.writes,[{name:storageKey,value:credentials.username}]);assert.deepEqual(p.loaded,['?v=password-change-fixture']);
  assert.ok(p.writes.every(write=>!JSON.stringify(write).includes(credentials.newPassword)));
});

test('ordinary login captures enabled fields before locking controls and keeps the original page initialization contract',async()=>{
  const p=await page();await p.submitLogin(' exact-account ',' exact-password ');
  assert.deepEqual(JSON.parse(p.requests.find(request=>request.url==='/api/login').options.body),{username:' exact-account ',password:' exact-password '});
  assert.deepEqual(p.writes,[{name:storageKey,value:' exact-account '}]);
  const sessions=p.requests.filter(request=>request.url==='/api/session');assert.equal(sessions.length,2);
  assert.ok(sessions.every(request=>request.options.headers['X-RF-Page-Init']==='password-change-page-123'));
  assert.equal(p.intervals.length,1);assert.equal(p.intervals[0].delay,5000);assert.deepEqual(p.loaded,['?v=password-change-fixture']);
});

test('new password limits use exact JavaScript string length including spaces and surrogate pairs',async t=>{
  for(const newPassword of ['short','x'.repeat(129)])await t.test(`reject length ${newPassword.length}`,async()=>{
    const p=await page();await p.click('show-change-password');await p.submitChange({username:'player',oldPassword:'private-old',newPassword});
    assert.equal(p.changeRequests.length,0);assert.match(p.error,/6–128/);assert.equal(p.activeElement,p.newPassword);assert.ok(p.controls().every(control=>!control.disabled));
  });
  for(const newPassword of ['      ','x'.repeat(128),'😀😀😀'])await t.test(`accept exact value of length ${newPassword.length}`,async()=>{
    const p=await page();await p.click('show-change-password');await p.submitChange({username:'player',oldPassword:'private-old',newPassword});
    assert.equal(p.changeRequests.length,1);assert.equal(JSON.parse(p.changeRequests[0].options.body).newPassword,newPassword);assert.match(p.status,/Password changed/);
  });
});

test('pending password change blocks duplicate submissions, login, view switches and account restoration',async()=>{
  let complete;
  const pendingResponse=new Promise(resolve=>{complete=resolve;});
  const p=await page({changeTransport:()=>pendingResponse});await p.click('show-change-password');
  const pending=p.submitChange({username:'changing-player',oldPassword:'private-old',newPassword:'private-new'});
  assert.equal(p.changeRequests.length,1);assert.ok(p.controls().every(control=>control.disabled));
  assert.equal(p.passwordForm.getAttribute('aria-busy'),'true');assert.equal(p.loginForm.getAttribute('aria-busy'),'true');
  // Dispatching directly also checks the guard against synthetic events.
  await p.submitChange();await p.submitLogin();await p.click('back-to-login');await p.click('show-change-password');await p.click('restore-saved-account');
  assert.equal(p.changeRequests.length,1);assert.equal(p.requests.filter(request=>request.url==='/api/login').length,0);
  assert.equal(p.passwordForm.hidden,false);assert.equal(p.username.value,'changing-player');
  complete({ok:true,status:200,json:async()=>({ok:true})});await pending;
  assert.equal(p.loginForm.hidden,false);assert.ok(p.controls().every(control=>!control.disabled));assert.deepEqual(p.passwords(),['','','']);
});

test('server and transport errors show useful messages, clear secrets and allow account restoration and a new attempt',async t=>{
  const cases=[
    [{status:401,body:{error:'invalid-credentials'}},'Incorrect account or current password.'],
    [{status:400,body:{error:'invalid-new-password'}},'The new password must be 6–128 characters.'],
    [{status:400,body:{error:'invalid-password-change'}},'Enter a valid account, current password and new password.'],
    [{status:429,body:{error:'too-many-attempts'}},'Too many attempts. Try again later.'],
    [{status:403,body:{error:'origin-denied'}},'Request origin verification failed. Reload and try again.'],
    [{status:503,body:{error:'password-save-failed'}},'Could not save the password. Try again later.'],
    [{status:500,body:{error:'unexpected'}},'Could not change the password. Try again later.'],
    [{status:200,body:{}},'Could not change the password. Try again later.'],
    [{status:200,jsonFailure:true},'Could not change the password. Try again later.'],
    [{networkFailure:true},'Connection failed. Try again later.']
  ];
  for(const [reply,message] of cases)await t.test(reply.body?.error??(reply.networkFailure?'transport':reply.jsonFailure?'invalid JSON':'missing success'),async()=>{
    const p=await page({changeReplies:[reply,{status:200,body:{ok:true}}]});await p.click('show-change-password');
    await p.submitChange({username:'attempted-player',oldPassword:'private-old',newPassword:'private-new'});
    assert.equal(p.error,message);assert.equal(p.passwordForm.hidden,false);assert.deepEqual(p.passwords(),['','','']);
    assert.ok(p.controls().every(control=>!control.disabled));assert.equal(p.passwordForm.getAttribute('aria-busy'),'false');assert.equal(p.activeElement,p.oldPassword);
    assert.deepEqual(p.writes,[]);assert.equal(p.entries.get(storageKey),'previous-player');
    await p.click('restore-saved-account');assert.equal(p.username.value,'previous-player');assert.equal(p.error,'');
    await p.submitChange({oldPassword:'private-old-again',newPassword:'private-new-again'});
    assert.equal(p.changeRequests.length,2);assert.equal(p.loginForm.hidden,false);assert.equal(p.loginUsername.value,'previous-player');assert.deepEqual(p.passwords(),['','','']);
  });
});

test('missing saved account or unavailable browser storage does not prevent anonymous password changes',async t=>{
  for(const options of [{saved:null},{saved:''},{storageFailure:'access'},{storageFailure:'read'}])await t.test(JSON.stringify(options),async()=>{
    const p=await page(options);assert.equal(p.elements.get('restore-saved-account').hidden,true);
    await p.click('show-change-password');await p.submitChange({username:'player',oldPassword:'private-old',newPassword:'private-new'});
    assert.match(p.status,/Password changed/);assert.deepEqual(p.writes,[]);assert.deepEqual(p.passwords(),['','','']);
  });
});

test('the hidden change-password form cannot submit before the user switches to it',async()=>{
  const p=await page();await p.submitChange({username:'player',oldPassword:'private-old',newPassword:'private-new'});
  assert.equal(p.changeRequests.length,0);assert.equal(p.loginForm.hidden,false);assert.ok(p.controls().every(control=>!control.disabled));
});

test('closed web download entry releases its login and gives local client instructions before importing game code',async()=>{
  const p=await page({session:{resourceDelivery:{enabled:false}}});await p.submitLogin('player');
  assert.deepEqual(p.loaded,[]);assert.equal(p.requests.filter(row=>row.url==='/api/logout').length,1);
  assert.match(p.elements.get('app').textContent,/Start-Client.bat/);
});
test('a verified local client can enter while remote downloads are closed',async()=>{
  const p=await page({session:{resourceDelivery:{enabled:false},localResourceClient:true}});await p.submitLogin('player');
  assert.deepEqual(p.loaded,['?v=password-change-fixture']);assert.equal(p.requests.some(row=>row.url==='/api/logout'),false);
});
