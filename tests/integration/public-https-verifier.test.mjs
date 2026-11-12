/** Windows HTTPS probe contract tests use an explicit in-memory IWR mock.
 * They never contact a public hostname or use real account credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../',import.meta.url)), script = path.join(root,'scripts/verify-public-https.ps1');
const supported = process.platform === 'win32', build = 'a'.repeat(64);
const quote = value => "'" + value.replaceAll("'","''") + "'";
function ps(code) {return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',"$ErrorActionPreference='Stop'; "+code],{encoding:'utf8',timeout:20000}).trim();}
const mock = `
$script:taskCalls = [Collections.Generic.List[string]]::new()
$script:taskUser = $null
$script:taskSessions = [Collections.Generic.List[object]]::new()
function Invoke-WebRequest {
  param($Uri,$Method,$WebSession,[switch]$UseBasicParsing,$TimeoutSec,$MaximumRedirection,$Headers,$ContentType,$Body)
  if (-not $UseBasicParsing -or $TimeoutSec -ne 20 -or $MaximumRedirection -ne 0 -or $Headers.Origin -ne 'https://fixture.trycloudflare.com') { throw 'Mock HTTP contract mismatch' }
  if ($WebSession -isnot [Microsoft.PowerShell.Commands.WebRequestSession]) { throw 'Missing Windows cookie session' }
  $route = ([Uri]$Uri).PathAndQuery; $script:taskCalls.Add($Method+' '+$route)
  $value = @{ok=$true}
  switch -Wildcard ($route) {
    '/api/login' {
      if ($ContentType -ne 'application/json; charset=utf-8') { throw 'Missing UTF8 JSON' }
      $account = [Text.Encoding]::UTF8.GetString($Body)|ConvertFrom-Json
      $script:taskUser=$account.username; $script:taskSessions.Add($WebSession)
      $cookie = [Net.Cookie]::new('rf_session','fixture-cookie','/','fixture.trycloudflare.com'); $cookie.Secure=$true; $cookie.HttpOnly=$true
      $WebSession.Cookies.Add($cookie)
      if ($script:taskFault -eq 'login') { throw 'fixture login lost response' }
      $value=@{username=$script:taskUser}
    }
    '/api/session' {
      if (-not $WebSession.Cookies.GetCookies([Uri]$Uri)['rf_session'].Secure) { throw 'Secure cookie missing' }
      $role = if ($script:taskUser -eq 'player') { 'player' } else { 'gm' }
      if ($script:taskFault -eq 'role') { $role='wrong' }
      $version=${quote(build)}; if ($script:taskFault -eq 'build') { $version='wrong' }
      $value=@{username=$script:taskUser;role=$role;buildVersion=$version;onlineEventTransport='poll';online=@{available=$true}}
    }
    '/game/game.js' { if ($Method -ne 'HEAD') { throw 'Expected HEAD' } }
    '/api/online/poll/open' { $value=@{connectionId='fixture-connection';cursor=0} }
    '/api/online/poll[?]*' {
      $cursor=1; $id=1; $type='status'
      if ($script:taskFault -eq 'cursor') { $cursor='1' }
      if ($script:taskFault -eq 'event') { $id=0 }
      if ($script:taskFault -eq 'status') { $type='state' }
      $value=@{cursor=$cursor;events=@(@{id=$id;type=$type;data=@{fixture=$true}})}
    }
    '/api/online/poll/close' { if ($script:taskFault -eq 'close') { throw 'fixture close failed' } }
    '/api/logout' { if ($script:taskFault -eq 'logout') { throw 'fixture logout failed' } }
    default { throw 'Unexpected mock route' }
  }
  return [pscustomobject]@{StatusCode=200;Content=($value|ConvertTo-Json -Depth 8 -Compress)}
}
`;
const accounts = "@([pscustomobject]@{username='primary';password='fixture-password'},[pscustomobject]@{username='second';password='fixture-password'},[pscustomobject]@{username='player';password='fixture-password';role='player'})";

test('Windows PS5 parses the standalone HTTPS verifier and preserves certificate verification',{skip:!supported},() => {
  const result = ps(`$taskErrors=$null;[Management.Automation.Language.Parser]::ParseFile(${quote(script)},[ref]$null,[ref]$taskErrors)|Out-Null;if($taskErrors){throw ($taskErrors|Out-String)};. ${quote(script)};${mock};$script:taskFault='';$taskTls=[Net.ServicePointManager]::SecurityProtocol;$taskCallback=[Net.ServicePointManager]::ServerCertificateValidationCallback;$taskResult=Invoke-PublicHttpsVerification 'https://fixture.trycloudflare.com/' ${accounts} ${quote(build)};if([Net.ServicePointManager]::SecurityProtocol -ne $taskTls -or [Net.ServicePointManager]::ServerCertificateValidationCallback -ne $taskCallback){throw 'TLS verification settings changed'};@{result=$taskResult;calls=@($script:taskCalls);sessions=$script:taskSessions.Count}|ConvertTo-Json -Depth 6 -Compress`);
  const value = JSON.parse(result);
  assert.equal(value.result.accountCount,3); assert.equal(value.result.buildVersion,build); assert.equal(value.result.onlineTransportVerified,true);
  assert.equal(value.sessions,3); assert.equal(value.calls.filter(call => call === 'POST /api/logout').length,3);
  assert.equal(value.calls.filter(call => call === 'POST /api/online/poll/open').length,1);
  assert.equal(value.calls.filter(call => call === 'POST /api/online/poll/close').length,1);
  assert.equal(result.includes('fixture-password'),false); assert.equal(result.includes('fixture-cookie'),false);
});

test('account reader mirrors primary/extras/player case-sensitive deduplication and never replaces primary credentials',{skip:!supported},async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'rf-https-accounts-'));
  t.after(async () => {assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)); await rm(directory,{recursive:true,force:true});});
  const put = (file,value) => writeFile(path.join(directory,file),JSON.stringify(value));
  await put('dev-account.json',{username:'primary',password:'keep-primary'});
  await put('dev-accounts.json',{schemaVersion:1,accounts:[{username:'primary',password:'replace-forbidden'},{username:'Primary',password:'case-distinct'},{username:'extra',password:'extra-fixture'}]});
  await put('dev-player-account.json',{username:'extra',password:'player-replace-forbidden',role:'player'});
  const rows = JSON.parse(ps(`. ${quote(script)};@(Read-PublicHttpsAccounts ${quote(directory)})|ConvertTo-Json -Compress`));
  assert.deepEqual(rows.map(row => row.username),['primary','Primary','extra']); assert.equal(rows[0].password,'keep-primary'); assert.equal(rows[2].password,'extra-fixture');
  await put('dev-accounts.json',{schemaVersion:1,accounts:{username:'invalid',password:'fixture'}});
  assert.equal(ps(`. ${quote(script)};try{Read-PublicHttpsAccounts ${quote(directory)}|Out-Null;throw 'Expected invalid config'}catch{if($_.Exception.Message -ne 'Invalid public account configuration.'){throw};'rejected'}`),'rejected');
  await put('dev-accounts.json',{schemaVersion:true,accounts:[]});
  assert.equal(ps(`. ${quote(script)};try{Read-PublicHttpsAccounts ${quote(directory)}|Out-Null;throw 'Expected invalid config'}catch{if($_.Exception.Message -ne 'Invalid public account configuration.'){throw};'rejected'}`),'rejected');
  await writeFile(path.join(directory,'dev-account.json'),'{"password":"fixture-secret-in-damaged-json",');
  const error = ps(`. ${quote(script)};try{Read-PublicHttpsAccounts ${quote(directory)}|Out-Null;throw 'Expected invalid config'}catch{$_.Exception.Message}`);
  assert.equal(error,'Invalid public account configuration.'); assert.equal(error.includes('fixture-secret'),false);
});

test('failed login, role/build, poll cursor/status/event or close/logout always attempts logout and never reports success',{skip:!supported},() => {
  for (const fault of ['login','role','build','cursor','event','status','close','logout']) {
    const result = JSON.parse(ps(`. ${quote(script)};${mock};$script:taskFault=${quote(fault)};$taskFailed=$false;$taskMessage='';try{Invoke-PublicHttpsVerification 'https://fixture.trycloudflare.com' ${accounts} ${quote(build)}|Out-Null}catch{$taskFailed=$true;$taskMessage=$_.Exception.Message};@{failed=$taskFailed;message=$taskMessage;calls=@($script:taskCalls)}|ConvertTo-Json -Depth 5 -Compress`));
    assert.equal(result.failed,true,fault); assert.equal(result.calls.at(-1),'POST /api/logout',fault);
    if (['cursor','event','status','close','logout'].includes(fault)) assert.ok(result.calls.includes('POST /api/online/poll/close'),fault);
    assert.equal(result.message.includes('fixture-password'),false); assert.equal(result.message.includes('fixture-cookie'),false);
  }
});

test('HTTPS URL and expected build validation reject unsafe targets before any mocked network call',{skip:!supported},() => {
  for (const url of ['http://fixture.trycloudflare.com','https://fixture.trycloudflare.com:443','https://fixture.trycloudflare.com/path','https://example.com','https://fixture.trycloudflare.com@evil.example']) {
    assert.equal(ps(`. ${quote(script)};${mock};try{Invoke-PublicHttpsVerification ${quote(url)} ${accounts} ${quote(build)}|Out-Null;throw 'Expected rejected target'}catch{if($_.Exception.Message -ne 'Invalid public HTTPS tunnel URL.'){throw}};if($script:taskCalls.Count){throw 'Unexpected network call'};'rejected'`),'rejected');
  }
});
