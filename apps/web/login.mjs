const app = document.querySelector('#app');
// Original UI click cue; login shares the saved, quiet-at-low-values volume.
let loginClickAudio=null;
app.addEventListener?.('click',event=>{
  const button=event.target?.closest?.('button');
  if(!button||button.disabled||button.closest('[hidden]'))return;
  let value=20;try{const saved=window.localStorage?.getItem('rf-audio-volume-v17');if(saved!==null&&saved!==undefined&&Number.isFinite(Number(saved)))value=Math.max(0,Math.min(100,Number(saved)));}catch{}
  if(value===0||typeof Audio!=='function')return;
  loginClickAudio??=new Audio('/assets/audio/lobby/click.ogg');
  loginClickAudio.volume=(value/100)**2;loginClickAudio.currentTime=0;
  Promise.resolve(loginClickAudio.play()).catch(()=>{});
});
const loginForm=document.querySelector('#login-form'),lastAccountKey='rf-last-login-account-v1';
const passwordFormElement=document.querySelector('#change-password-form');
const passwordForm=passwordFormElement!==loginForm?passwordFormElement:null;
const loginUsername=loginForm.querySelector?.('input[name="username"]');
const passwordUsername=passwordForm?.querySelector?.('input[name="username"]');
const passwordError=passwordForm?document.querySelector('#change-password-error'):null;
const loginStatus=passwordForm?document.querySelector('#login-status'):null;
const showPasswordButton=passwordForm?document.querySelector('#show-change-password'):null;
const backToLoginButton=passwordForm?document.querySelector('#back-to-login'):null;
const restoreAccountButton=passwordForm?document.querySelector('#restore-saved-account'):null;
let accountStorage=null,savedAccount='',view='login',requestBusy=false;
try {
  accountStorage=window.localStorage;
  const saved=accountStorage?.getItem(lastAccountKey);
  if(typeof saved==='string'&&saved){savedAccount=saved;if(loginUsername)loginUsername.value=saved;}
} catch {}
if(restoreAccountButton)restoreAccountButton.hidden=!savedAccount;
function rememberAccount(username){
  // Browser preference only: never store the password or an authentication token.
  if(typeof username!=='string'||!username)return;
  try {accountStorage?.setItem(lastAccountKey,username);} catch {}
}
function clearPasswords(){
  for(const form of [loginForm,passwordForm])for(const input of form?.querySelectorAll?.('input[type="password"]')??[])input.value='';
}
function clearMessages(){
  document.querySelector('#login-error').textContent='';
  if(passwordError)passwordError.textContent='';
  if(loginStatus)loginStatus.textContent='';
}
function setBusy(busy){
  requestBusy=busy;
  for(const form of [loginForm,passwordForm]){
    form?.setAttribute?.('aria-busy',String(busy));
    for(const control of form?.querySelectorAll?.('input, button')??[])control.disabled=busy;
  }
  const loginButton=loginForm.querySelector?.('button');
  if(loginButton)loginButton.disabled=busy;
  if(restoreAccountButton)restoreAccountButton.disabled=busy;
}
function switchView(next,username){
  if(requestBusy||!passwordForm)return;
  clearPasswords();clearMessages();view=next;
  loginForm.hidden=next!=='login';passwordForm.hidden=next!=='change-password';
  showPasswordButton?.setAttribute?.('aria-expanded',String(next==='change-password'));
  const form=next==='login'?loginForm:passwordForm;
  const account=next==='login'?loginUsername:passwordUsername;
  if(account&&typeof username==='string')account.value=username;
  (account?.value?form.querySelector?.('input[type="password"]'):account)?.focus?.();
}
showPasswordButton?.addEventListener('click',()=>switchView('change-password',loginUsername?.value));
backToLoginButton?.addEventListener('click',()=>switchView('login',passwordUsername?.value));
restoreAccountButton?.addEventListener('click',()=>{
  if(requestBusy||!savedAccount)return;
  switchView(view,savedAccount);
});
function passwordChangeMessage(response,result){
  if(response.status===401)return 'Incorrect account or current password.';
  if(response.status===429)return 'Too many attempts. Try again later.';
  if(response.status===403)return 'Request origin verification failed. Reload and try again.';
  if(response.status===503)return 'Could not save the password. Try again later.';
  if(response.status===400)return result?.error==='invalid-new-password'?'The new password must be 6–128 characters.':'Enter a valid account, current password and new password.';
  return 'Could not change the password. Try again later.';
}
passwordForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(requestBusy||view!=='change-password')return;
  const form=event.currentTarget,data=Object.fromEntries(new FormData(form));
  const credentials={username:data.username,oldPassword:data.oldPassword,newPassword:data.newPassword};
  clearMessages();
  if(typeof credentials.newPassword!=='string'||credentials.newPassword.length<6||credentials.newPassword.length>128){
    passwordError.textContent='The new password must be 6–128 characters.';
    form.querySelector('input[name="newPassword"]').focus();return;
  }
  setBusy(true);
  let failureMessage='Connection failed. Try again later.';
  try {
    const response=await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    let result;try {result=await response.json();} catch {}
    failureMessage=passwordChangeMessage(response,result);
    if(!response.ok||result?.ok!==true)throw Error(failureMessage);
    setBusy(false);switchView('login',credentials.username);
    loginStatus.textContent='Password changed. Sign in with your new password.';
  } catch {
    clearPasswords();passwordError.textContent=failureMessage;setBusy(false);
    form.querySelector('input[name="oldPassword"]').focus();
  }
});
// This page identity is a handover marker, never an authentication token.
const pageInitToken=crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),sessionHeaders={'X-RF-Page-Init':pageInitToken};
app.dataset.pageInitToken=pageInitToken;
let heartbeat=null;
function stopHeartbeat(){heartbeat?.stop?.();heartbeat=null;}
// A cached model/shader preparation can block the UI thread beyond the server's
// twenty-second liveness bound. A same-origin worker sends only authenticated
// heartbeats; it never marks a player ready or renews the room's loading limit.
function sessionHeartbeatWorker(){
  let timer=null,pending=false,url=null,pageInitToken=null;
  self.onmessage=event=>{
    pageInitToken=event.data.pageInitToken??pageInitToken;
    if(timer)return;
    url=event.data.url??url;if(!url)return;
    const send=async()=>{
      if(pending)return;pending=true;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      const requestToken=pageInitToken;
      try{const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:requestToken?{'X-RF-Page-Init':requestToken}:{},signal:controller.signal});
        if(response.status===409&&requestToken!==pageInitToken)return;
        if(response.status===401||response.status===409){
          const reason=response.status===401?await response.json?.().catch(()=>({})):null;
          clearInterval(timer);timer=null;self.postMessage({expired:response.status===401,retired:response.status===409,pageInitToken:requestToken,
            ...(reason?.error==='session-replaced'?{replaced:true}:{})});}}
      catch{}finally{clearTimeout(timeout);pending=false;}
    };
    timer=setInterval(send,5000);void send();
  };
}
function beginHeartbeat(){
  if(heartbeat)return;
  const expired=replaced=>{stopHeartbeat();if(replaced)location.replace('/?session=replaced');else location.reload();};
  const fallback=()=>{const owner={stop:()=>clearInterval(timer)};const timer=setInterval(async()=>{const token=app.dataset?.pageInitToken;
    try{const response=await fetch('/api/heartbeat',{method:'POST',headers:token?{'X-RF-Page-Init':token}:{}});if(heartbeat!==owner)return;
      if(response.status===401){const reason=await response.json?.().catch(()=>({}));if(heartbeat===owner)expired(reason?.error==='session-replaced');}
      else if(response.status===409&&token===app.dataset?.pageInitToken)stopHeartbeat();}catch{}},5000);
    heartbeat=owner;};
  try{
    if(typeof Worker!=='function')return fallback();
    const url=URL.createObjectURL(new Blob(['('+sessionHeartbeatWorker.toString()+')()'],{type:'text/javascript'}));
    let worker;try{worker=new Worker(url);}catch(error){URL.revokeObjectURL(url);throw error;}
    const owner={stop(){worker.terminate();URL.revokeObjectURL(url);},updatePageIdentity(){worker.postMessage({pageInitToken:app.dataset.pageInitToken});}};heartbeat=owner;
    worker.onmessage=event=>{if(heartbeat!==owner)return;if(event.data?.expired)expired(event.data.replaced);else if(event.data?.retired&&event.data.pageInitToken===app.dataset?.pageInitToken)stopHeartbeat();};
    worker.onerror=()=>{if(heartbeat===owner){stopHeartbeat();fallback();}};
    worker.postMessage({url:new URL('/api/heartbeat',location.href).href,pageInitToken:app.dataset?.pageInitToken});
  }catch{fallback();}
}
window.addEventListener('pagehide',stopHeartbeat);
window.addEventListener('webpvp-page-identity',()=>{if(heartbeat)heartbeat.updatePageIdentity?.();else beginHeartbeat();});
async function enter() {
  app.innerHTML = '<p class="loading">Loading class, animation and map assets…</p>';
  try {
    const response = await fetch('/api/session', {cache:'no-store',headers:sessionHeaders});
    if (!response.ok){
      const reason=await response.json().catch(()=>({}));
      if(reason.error==='client-program-outdated'){
        stopHeartbeat();await fetch('/api/logout',{method:'POST',headers:sessionHeaders});
      }
      throw Error(reason.message??'Session expired. Reload and sign in again.');
    }
    const session = await response.json();
    if(session.resourceDelivery?.enabled===false&&!session.localResourceClient){
      // Release this rejected web entry so it cannot keep the same account
      // occupied while the player opens the packaged client.
      stopHeartbeat();
      await fetch('/api/logout',{method:'POST',headers:sessionHeaders});
      throw Error('The GM has disabled remote asset downloads. Extract the local client, run Start-Client.bat and sign in with your account.');
    }
    // The first tagged beat must follow the server's identity commit. During
    // a handoff a retired worker may stop before its replacement ACK arrives;
    // that acknowledged identity event above starts its replacement.
    beginHeartbeat();
    const version = session.buildVersion ? '?v=' + encodeURIComponent(session.buildVersion) : '';
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/game/game.css' + version; document.head.append(style);
    await import('/game/game.js' + version);
  }
  catch (error) { const p = document.createElement('p'); p.className = 'load-error'; p.textContent = `Failed to load the arena: ${error.message}\nReload and sign in again. If this persists, share this error with the maintainer.`; app.replaceChildren(p); }
}
loginForm.addEventListener('submit', async event => {
  event.preventDefault();if(requestBusy||view!=='login')return;
  const form = event.currentTarget,credentials=Object.fromEntries(new FormData(form));clearMessages();setBusy(true);
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    if (!response.ok) throw Error(response.status===409?'A newer session has signed in. Use the most recent instance.':response.status === 429 ? 'Too many attempts. Try again later.' : 'Incorrect account or password.');
    rememberAccount(credentials.username);
    if(new URLSearchParams(window.location?.search??'').get('session')==='replaced')window.history?.replaceState?.(null,'',window.location.pathname??'/');
    await enter();
  } catch (error) { document.querySelector('#login-error').textContent = error.message;setBusy(false); }
});
// A same-origin tab shares the replacement's cookie. Do not automatically
// initialize another page and steal that new login back after being kicked.
if(new URLSearchParams(window.location?.search??'').get('session')==='replaced')document.querySelector('#login-error').textContent='Your account signed in elsewhere. This session has ended.';
else if ((await fetch('/api/session',{cache:'no-store',headers:sessionHeaders})).ok) await enter();
