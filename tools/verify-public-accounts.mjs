import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const readJson=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
export async function readPublicAccounts(accountRoot){
  const primary=await readJson(path.join(accountRoot,'dev-account.json'));
  let extra=[];
  try{
    const config=await readJson(path.join(accountRoot,'dev-accounts.json'));
    if(config.schemaVersion!==1||!Array.isArray(config.accounts))throw Error('Invalid public account configuration');
    extra=config.accounts;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let player=[];
  try{player=[await readJson(path.join(accountRoot,'dev-player-account.json'))];}
  catch(error){if(error.code!=='ENOENT')throw error;}
  // Preserve the primary/explicit credential when files repeat a username;
  // the generated player file must not replace an existing account.
  const accounts=new Map();
  for(const account of [primary,...extra,...player]){
    if(typeof account?.username!=='string'||!account.username.length
      ||typeof account.password!=='string'||!account.password.length)throw Error('Invalid public account configuration');
    if(!accounts.has(account.username))accounts.set(account.username,{...account,role:account.role==='gm'?'gm':'player'});
  }
  return [...accounts.values()];
}

/** Validate loopback origin without PowerShell 5.1's HTTP Cookie header
 * filtering. The Secure cookie remains intact for actual HTTPS visitors;
 * this explicit header belongs only to our authenticated deployment probe. */
export async function verifyPublicAccounts({url,publicOrigin,accounts,expectedBuildVersion}){
  let verified=0;
  const request=(resource,options={})=>fetch(url+resource,{...options,signal:AbortSignal.timeout(15000)});
  for(const account of accounts){
    const response=await request('/api/login',{method:'POST',headers:{Origin:publicOrigin,'Content-Type':'application/json'},body:JSON.stringify(account)});
    if(!response.ok)throw Error('Candidate account login failed: HTTP '+response.status);
    if((await response.json()).username!==account.username)throw Error('Candidate account identity mismatch');
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    if(!/^rf_session=[A-Za-z0-9_-]+$/.test(cookie??''))throw Error('Candidate login session cookie missing');
    let failure=null;
    try{
      const sessionResponse=await request('/api/session',{headers:{Cookie:cookie}});
      if(!sessionResponse.ok)throw Error('Candidate session failed: HTTP '+sessionResponse.status);
      const session=await sessionResponse.json();
      if(session.username!==account.username)throw Error('Candidate session identity mismatch');
      // Legacy services did not expose role. When present, verify the actual
      // session permission rather than merely trusting the credential file.
      if(Object.hasOwn(session,'role')&&session.role!==(account.role==='gm'?'gm':'player'))throw Error('Candidate session role mismatch');
      if(session.buildVersion!==expectedBuildVersion)throw Error('Candidate build version mismatch');
      const gameResponse=await request('/game/game.js',{method:'HEAD',headers:{Cookie:cookie}});
      if(!gameResponse.ok)throw Error('Candidate game access failed: HTTP '+gameResponse.status);
      verified++;
    }catch(error){failure=error;}
    try{
      const logout=await request('/api/logout',{method:'POST',headers:{Origin:publicOrigin,Cookie:cookie}});
      if(!logout.ok)throw Error('Candidate logout failed: HTTP '+logout.status);
    }catch(error){failure??=error;}
    if(failure)throw failure;
  }
  return {accountCount:verified,buildVersion:expectedBuildVersion};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [url,publicOrigin,accountRoot,expectedBuildVersion]=process.argv.slice(2);
  if(!url||!publicOrigin||!accountRoot||!expectedBuildVersion)
    throw Error('Usage: node tools/verify-public-accounts.mjs URL PUBLIC_ORIGIN ACCOUNT_ROOT BUILD_SHA256');
  const result=await verifyPublicAccounts({url,publicOrigin,accounts:await readPublicAccounts(accountRoot),expectedBuildVersion});
  // Account passwords, session tokens and per-account names never enter logs.
  console.log(JSON.stringify(result));
}
