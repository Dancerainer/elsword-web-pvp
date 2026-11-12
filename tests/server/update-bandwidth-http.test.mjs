import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {sha} from '../../apps/local-client/update-contract.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'update-bandwidth-')),delivery=path.join(root,'updates'),drivers=[];
  await fs.mkdir(path.join(root,'dist'));await fs.writeFile(path.join(root,'dist/game.js'),'new code');
  let clock=100_000;
  const accounts=[{username:'alpha',password:'fixture-a',role:'player'},{username:'beta',password:'fixture-b',role:'player'}];
  const app=await createDevServer({root,clientUpdateRoot:delivery,credentials:accounts[0],additionalCredentials:accounts.slice(1),resourceDeliveryEnabled:false,
    now:()=>clock,driverFactory:args=>{const value={...args,submitInput(){},stop(){}};drivers.push(value);return value;},
    updateBandwidthOptions:{bytesPerSecond:100_000,playerReserveBytesPerSecond:8000,roomReserveBytesPerSecond:20_000,maximumTransfers:2}});
  await listenLoopback(app.server);const origin='http://127.0.0.1:'+app.server.address().port;
  const bytes=randomBytes(300_000),encoded=gzipSync(bytes),hash=sha(encoded);
  const manifest=code=>({schemaVersion:1,remoteOrigin:origin,buildSha256:sha(code),files:{'dist/game.js':sha(code),'assets/blob.bin':sha(bytes)},assets:{'blob.bin':sha(bytes)}});
  const base=manifest('old code');base.files['assets/blob.bin']=sha('old blob');base.assets['blob.bin']=base.files['assets/blob.bin'];
  const target=manifest('new code'),baseId=sha(JSON.stringify(base)),releaseId=sha(JSON.stringify(target));
  await fs.mkdir(path.join(delivery,releaseId,'blobs'),{recursive:true});await fs.mkdir(path.join(delivery,baseId));
  const code=gzipSync('new code');await fs.writeFile(path.join(delivery,releaseId,'blobs',sha(code)+'.gz'),code);
  await fs.writeFile(path.join(delivery,releaseId,'blobs',hash+'.gz'),encoded);
  await fs.writeFile(path.join(delivery,baseId,'catalog.json'),JSON.stringify({manifest:base}));
  await fs.writeFile(path.join(delivery,releaseId,'catalog.json'),JSON.stringify({releaseId,manifest:target,transport:{
    'assets/blob.bin':{bytes:bytes.length,gzipBytes:encoded.length,gzipSha256:hash},'dist/game.js':{bytes:8,gzipBytes:code.length,gzipSha256:sha(code)},
  }}));
  await fs.writeFile(path.join(delivery,'current.json'),JSON.stringify({releaseId,buildSha256:target.buildSha256}));
  t.after(async()=>{app.closeStreams();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));assert.ok(root.startsWith(os.tmpdir()+path.sep));await fs.rm(root,{recursive:true,force:true});});
  const cookies=[];
  for(const account of accounts){const response=await fetch(origin+'/api/login',{method:'POST',body:JSON.stringify(account)});assert.equal(response.status,200);await response.arrayBuffer();cookies.push(response.headers.get('set-cookie').split(';')[0]);}
  const file=origin+'/api/client-update/file?'+new URLSearchParams({base:baseId,release:releaseId,file:'assets/blob.bin'});
  return{app,origin,file,hash,accounts,cookies,drivers,advance:async ms=>{clock+=ms;await app.online.tick();}};
}

async function download(url){
  let resolveHeaders;const headers=new Promise(resolve=>resolveHeaders=resolve),row={bytes:0,chunks:[]};
  row.done=new Promise(resolve=>{
    row.request=http.get(url,response=>{row.response=response;resolveHeaders(response);response.on('data',chunk=>{row.bytes+=chunk.length;row.chunks.push(chunk);});
      response.on('end',()=>resolve(true));response.on('error',()=>resolve(false));});row.request.on('error',()=>resolve(false));
  });await headers;return row;
}

test('real HTTP concurrent downloads share capacity, follow live match state, yield to actual priority traffic and resume after cancellation', {timeout:20_000},async t=>{
  const f=await fixture(t);await pause(1100);
  const samples=[],started=performance.now();
  const sample=phase=>samples.push({phase,elapsedMs:performance.now()-started,receivedBytes:[a.bytes,b.bytes],bandwidth:f.app.transportDiagnostics().updateBandwidth});
  const [a,b]=await Promise.all([download(f.file),download(f.file)]);assert.equal(a.response.statusCode,200);assert.equal(a.response.headers['x-accel-buffering'],'no');
  const rejected=await fetch(f.file);assert.equal(rejected.status,503);assert.equal(rejected.headers.get('retry-after'),'5');await rejected.arrayBuffer();
  await pause(600);assert.ok(a.bytes+b.bytes>0);assert.ok(a.bytes+b.bytes<80_000,'aggregate cap applies across requests');assert.ok(Math.abs(a.bytes-b.bytes)<=8192,'real clients receive bounded fair rounds');
  sample('no-match-shared-download');
  for(const account of f.accounts)await f.app.online.join(account.username,'player',{},'1v1');await f.advance(5000);
  const driver=f.drivers[0];assert.ok(driver);driver.emit('state',{pvp:{phase:'created'}});await pause(50);
  assert.equal(f.app.transportDiagnostics().updateBandwidth.playingRooms,0,'loading template is not a running battle');
  driver.emit('state',{pvp:{phase:'combat'}});await pause(60);
  const active=f.app.transportDiagnostics().updateBandwidth;assert.equal(active.playingRooms,1);assert.equal(active.playingPlayers,2);assert.equal(active.budgetBytesPerSecond,70_000);
  sample('battle-reserve-applied');
  const before=a.bytes+b.bytes;await pause(800);assert.ok(a.bytes+b.bytes-before<=65_000,'live match reserves reduce the combined download rate');
  await Promise.all(Array.from({length:30},async()=>{const response=await fetch(f.origin+'/api/online/status',{headers:{cookie:f.cookies[0]}});assert.equal(response.status,200);await response.arrayBuffer();}));
  await pause(40);assert.equal(f.app.transportDiagnostics().updateBandwidth.paused,true,'real non-download socket output triggers high-pressure pause');
  const paused=a.bytes+b.bytes;await pause(100);assert.equal(a.bytes+b.bytes,paused);
  sample('actual-priority-output-paused-downloads');
  await driver.finish({winnerTeam:0,score:[1,0],reason:'score',players:driver.match.players.map(player=>({id:player.id,kills:0,assists:0,deaths:0}))});
  a.request.destroy();assert.equal(await a.done,false);await pause(1200);
  const recovered=f.app.transportDiagnostics().updateBandwidth;assert.equal(recovered.playingRooms,0);assert.equal(recovered.activeTransfers,1);assert.ok(recovered.budgetBytesPerSecond>=85_000);
  sample('battle-finished-and-one-download-cancelled');
  assert.equal(await b.done,true);assert.equal(sha(Buffer.concat(b.chunks)),f.hash,'pause/resume preserves exact immutable gzip bytes');
  const end=f.app.transportDiagnostics().updateBandwidth;assert.equal(end.bufferedBytes,0);assert.equal(end.reservedTransfers,0);assert.equal(end.cancelled,1);assert.ok(end.pausedTicks>0);
  sample('remaining-download-complete-and-exact-hash');
  if(process.env.RF_UPDATE_BANDWIDTH_EVIDENCE_PATH)await fs.writeFile(process.env.RF_UPDATE_BANDWIDTH_EVIDENCE_PATH,JSON.stringify({
    schemaVersion:1,evidenceClass:'current production application + real loopback HTTP; synthetic battle driver; application socket bytes; no NIC or WAN shaping',
    downloadPayloadSha256:f.hash,exactGzipHashVerified:true,samples,
  },null,2)+'\n');
});
