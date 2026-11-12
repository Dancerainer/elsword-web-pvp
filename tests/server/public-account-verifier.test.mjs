import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {readPublicAccounts,verifyPublicAccounts} from '../../tools/verify-public-accounts.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

async function fixture(t,count=6,{player=false}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-account-verify-'));
  const bundle='fixture-bundle';
  const accounts=Array.from({length:count},(_,i)=>({username:'fixture-'+i,role:i===0?'gm':'player',password:'only-local-fixture-'+i}));
  await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/game.js'),bundle);
  await mkdir(path.join(root,'runtime'));
  await writeFile(path.join(root,'runtime/dev-account.json'),'\uFEFF'+JSON.stringify(accounts[0]));
  await writeFile(path.join(root,'runtime/dev-accounts.json'),'\uFEFF'+JSON.stringify({schemaVersion:1,accounts:accounts.slice(1)}));
  const publicOrigin='https://fixture.trycloudflare.com';
  const instance=await createDevServer({root,publicOrigin,credentials:accounts[0],createPlayerAccount:player});
  const cookieRequests=[];
  instance.server.on('request',req=>{if(req.url==='/api/session')cookieRequests.push(Boolean(req.headers.cookie));});
  await listenLoopback(instance.server);
  t.after(async()=>{
    await new Promise(r=>instance.server.close(r));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  });
  const options={url:'http://127.0.0.1:'+instance.server.address().port,publicOrigin,
    accounts:await readPublicAccounts(path.join(root,'runtime')),
    expectedBuildVersion:createHash('sha256').update(bundle).digest('hex')};
  return {root,instance,options,cookieRequests};
}

test('publisher forwards Secure cookie explicitly on loopback and verifies every configured account',async t=>{
  const {instance,options,cookieRequests}=await fixture(t,6);
  const result=await verifyPublicAccounts(options);
  assert.equal(result.accountCount,6);assert.equal(result.buildVersion,options.expectedBuildVersion);
  assert.deepEqual(cookieRequests,[true,true,true,true,true,true]);
  assert.equal(instance.sessions.size,0,'each verification login is logged out');
  assert.deepEqual(Object.keys(result).sort(),['accountCount','buildVersion'],'proof contains no credential or token');
});

test('publisher verifies the sole GM and all ordinary accounts including the generated one',async t=>{
  const {instance,options,cookieRequests}=await fixture(t,2,{player:true});
  assert.equal(options.accounts.length,3);
  assert.deepEqual(options.accounts.filter(account=>account.role==='player').map(account=>account.username),['fixture-1','rf-player']);
  const result=await verifyPublicAccounts(options);
  assert.equal(result.accountCount,3);assert.deepEqual(cookieRequests,[true,true,true]);
  assert.equal(instance.sessions.size,0);assert.deepEqual(Object.keys(result).sort(),['accountCount','buildVersion']);
});

test('optional player file is not required and repeated usernames preserve the first existing credential',async t=>{
  const {root,options}=await fixture(t,2);
  assert.equal(options.accounts.length,2);
  const accountRoot=path.join(root,'runtime'),primary=options.accounts[0],extra=options.accounts[1];
  await writeFile(path.join(accountRoot,'dev-accounts.json'),JSON.stringify({schemaVersion:1,accounts:[{...primary,password:'duplicate-must-not-replace'},extra,extra]}));
  await writeFile(path.join(accountRoot,'dev-player-account.json'),'\uFEFF'+JSON.stringify({...extra,password:'player-must-not-replace',role:'player'}));
  assert.deepEqual(await readPublicAccounts(accountRoot),[primary,extra]);
});

test('an existing malformed player file fails account enumeration instead of silently omitting the ordinary account',async t=>{
  const {root}=await fixture(t,1),file=path.join(root,'runtime/dev-player-account.json');
  await writeFile(file,'{"username":');await assert.rejects(readPublicAccounts(path.join(root,'runtime')),SyntaxError);
  await writeFile(file,JSON.stringify({role:'player'}));
  await assert.rejects(readPublicAccounts(path.join(root,'runtime')),/Invalid public account configuration/);
});

for(const {actual,expected} of [{actual:'gm',expected:'player'},{actual:'player',expected:'gm'}])test(`a ${actual} account receiving unexpected ${expected} permission aborts verification and releases its session`,async t=>{
  const {instance,options}=await fixture(t,1,{player:actual==='player'});
  // Emulate an old deployed service returning stale permissions; the verifier
  // must compare the session role with the configured bootstrap role.
  instance.server.prependListener('request',(req,res)=>{
    if(req.url!=='/api/session')return;
    const end=res.end.bind(res);
    res.end=(body,...args)=>{const packet=JSON.parse(body);packet.role=expected;return end(JSON.stringify(packet),...args);};
  });
  const account=actual==='player'?options.accounts.find(account=>account.role==='player'):options.accounts[0];
  options.accounts=[{...account,role:actual}];
  await assert.rejects(verifyPublicAccounts(options),/Candidate session role mismatch/);
  assert.equal(instance.sessions.size,0);
});

test('legacy sessions without a role field retain verification compatibility',async t=>{
  let logoutCount=0;
  const server=createServer((req,res)=>{
    if(req.url==='/api/login'){
      req.resume();res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'rf_session=legacy_fixture; HttpOnly; Secure'});
      res.end(JSON.stringify({username:'legacy'}));
    }else if(req.url==='/api/session'){
      assert.equal(req.headers.cookie,'rf_session=legacy_fixture');
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({username:'legacy',buildVersion:'legacy-build'}));
    }else if(req.url==='/game/game.js'&&req.method==='HEAD'){
      assert.equal(req.headers.cookie,'rf_session=legacy_fixture');res.writeHead(200);res.end();
    }else if(req.url==='/api/logout'){
      logoutCount++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');
    }else{res.writeHead(404);res.end();}
  });
  await listenLoopback(server);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await verifyPublicAccounts({url:'http://127.0.0.1:'+server.address().port,
    publicOrigin:'https://fixture.trycloudflare.com',accounts:[{username:'legacy',password:'local-fixture',role:'player'}],expectedBuildVersion:'legacy-build'});
  assert.deepEqual(result,{accountCount:1,buildVersion:'legacy-build'});assert.equal(logoutCount,1);
});

test('a wrong candidate build aborts verification and releases its session',async t=>{
  const {instance,options}=await fixture(t,1);
  await assert.rejects(verifyPublicAccounts({...options,expectedBuildVersion:'wrong-candidate'}),/Candidate build version mismatch/);
  assert.equal(instance.sessions.size,0);
});

test('a wrong password aborts with the HTTP status and never advances to an authenticated session',async t=>{
  const {instance,options,cookieRequests}=await fixture(t,1);
  options.accounts[0].password='wrong-fixture-password';
  await assert.rejects(verifyPublicAccounts(options),/login failed: HTTP 401/);
  assert.equal(instance.sessions.size,0);assert.deepEqual(cookieRequests,[]);
});

test('Windows PowerShell 5.1 publisher invocation runs the Node probe and parses its complete proof',async t=>{
  const {root,instance,options}=await fixture(t,2);
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const tool=fileURLToPath(new URL('../../tools/verify-public-accounts.mjs',import.meta.url));
  const command=`$ErrorActionPreference='Stop'
$proof=& ${quote(process.execPath)} ${quote(tool)} ${quote(options.url)} ${quote(options.publicOrigin)} ${quote(path.join(root,'runtime'))} ${quote(options.expectedBuildVersion)}
if($LASTEXITCODE -ne 0){throw 'Node probe failed'}
$result=$proof|ConvertFrom-Json
$result|ConvertTo-Json -Compress
`;
  const child=spawn(shell,['-NoProfile','-NonInteractive','-Command','-'],{stdio:['pipe','pipe','pipe']});
  let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);child.stdin.end(command);
  const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(status,0,error);assert.equal(error,'');
  assert.deepEqual(JSON.parse(output.trim()),{accountCount:2,buildVersion:options.expectedBuildVersion});
  assert.equal(instance.sessions.size,0);
});
