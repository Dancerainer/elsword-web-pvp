/** Offline diagnostic fixtures, never performance acceptance evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),script=fileURLToPath(new URL('../../tools/cloud-network-rooms-v5.mjs',import.meta.url));
const save=(directory,name,value)=>writeFile(path.join(directory,name),JSON.stringify(value));
async function fixture(t){
 const output=await mkdtemp(path.join(tmpdir(),'cloud-room-summary-test-'));t.after(()=>rm(output,{recursive:true,force:true}));
 const players=Array.from({length:6},(_,i)=>'p'+i),seal={rawSha256:'stable'},tools={sha256:'tools'};
 await save(output,'experiment.json',{rooms:'3v3',players:6,seconds:10,professions:['RF','LK','VC','RS','BM'],remoteToolsVerified:true,launcherUnchanged:true,
  localPriorityPolicy:'above-normal',accountFile:'private-must-not-be-repeated',ports:[1,2,3,4,5,6]});
 await save(output,'local-final.json',{sourceBefore:seal,sourceAfter:seal,sourceUnchanged:true,measurementBefore:tools,measurementAfter:tools,measurementUnchanged:true,resourcesAfter:{unchanged:true},
  processPriorities:['ssh-forwarding-coordinator','native-peer-coordinator',...players.map((_,i)=>'peer-'+i)].map((name,i)=>({name,pid:100+i,policy:'above-normal',beforePriority:0,requestedPriority:-7,actualPriority:-7})),
  peerExit:players.map(id=>({name:id,code:0}))});
 await save(output,'cloud-before.json',{source:seal});
 await save(output,'cloud-final.json',{sourceAfter:seal,sourceUnchanged:true,measurementBefore:tools,measurementAfter:tools,measurementUnchanged:true,resourcesAfter:{unchanged:true},
  reason:'requested',currentReleaseNow:'fixed',fixedRelease:'fixed',errors:[]});
 await save(output,'server.json',{incoming:[{accepted:true,receivedAtWallMs:900000,resolvedAtWallMs:900003},{accepted:true,receivedAtWallMs:910000,resolvedAtWallMs:910005}],
  samples:[{atWallMs:905000,cpuPercent:30,rssBytes:1000,eventLoopP95Ms:7,transport:{roomWorkers:{workers:[{cpuPercent:10,rssBytes:500}]}}}],drops:[],validOwnerReports:2});
 await save(output,'tunnel.json',{bins:[{atWallMs:2000,down:1000,up:100}],errors:[]});
 for(const id of players)await save(output,`peer-${id.slice(1)}.json`,{playerId:id,matchId:'one',matchMode:'3v3',requestedMode:'3v3',matchPlayerIds:players,errors:[],
  generatedReports:[1000,8000,12000].map((at,i)=>({playerId:id,epoch:1,frameSeq:i+1,generatedAtWallMs:at})),
  receivedReports:players.filter(p=>p!==id).flatMap(playerId=>[1000,8000].map((at,i)=>({playerId,epoch:1,frameSeq:i+1,acceptedAtWallMs:at+100,applied:true}))),stats:{hits:1,skillStarted:1}});
 return output;
}
test('cloud summary uses same-Windows-host delivery time and cloud-local CPU independently',async t=>{
 const output=await fixture(t),{stdout}=await execute(process.execPath,[script,'--role=summary','--output='+output]);
 const result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.equal(result.integrity.passed,true);assert.equal(result.actuallyAppliedEndToEndMs.mean,100);
 assert.equal(result.cloudServer.parentAndRoomCpuPercent.mean,40);assert.equal(result.cloudServer.parentAndRoomRssBytes.mean,1500);
 assert.equal(result.cloudServer.workerRpcMs.mean,4);assert.equal(result.concurrency.observedRooms['3v3'],1);
 assert.equal(result.cloudBefore,undefined);assert.equal(result.localFinal,undefined);
 assert.ok(!JSON.stringify(result).includes('private-must-not-be-repeated'));assert.ok(!stdout.includes('private-must-not-be-repeated'));
 assert.ok(result.method.limitations.some(row=>row.includes('one encrypted TCP')));
 assert.equal(result.method.sshDataTransports,'1');assert.equal(result.method.sshTotalConnectionCount,1);
 assert.equal(result.method.localPriorityPolicy,'above-normal');assert.equal(result.localProcessPriorities.length,8);
 assert.ok(result.localProcessPriorities.every(row=>row.actualPriority===-7));assert.ok(result.method.cloudPriorityPolicy.includes('unchanged'));
});
test('per-player SSH topology is distinct from legacy single-transport results and must match its receipt',async t=>{
 const output=await fixture(t),file=path.join(output,'experiment.json'),config=JSON.parse(await readFile(file,'utf8'));
 Object.assign(config,{sshDataTransports:'players',sshDataTransportCount:6,sshControlTransportSeparate:true});await writeFile(file,JSON.stringify(config));
 await save(output,'tunnel.json',{bins:[],errors:[],topology:{dataTransportCount:6,controlSharesDataTransport:false}});
 await execute(process.execPath,[script,'--role=summary','--output='+output]);
 let result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.equal(result.integrity.passed,true);assert.equal(result.method.sshDataTransports,'players');assert.equal(result.method.sshTotalConnectionCount,7);
 assert.equal(result.method.sshControlTransportSeparate,true);assert.ok(result.method.limitations.some(row=>row.includes('per-player head-of-line')));
 assert.ok(!result.method.limitations.some(row=>row.includes('one encrypted TCP connection')));
 await save(output,'tunnel.json',{bins:[],errors:[],topology:{dataTransportCount:1,controlSharesDataTransport:true}});
 await assert.rejects(execute(process.execPath,[script,'--role=summary','--output='+output]),error=>error.code===1);
 result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.ok(result.integrity.failures.includes('ssh-data-topology-mismatch'));
});
test('cloud summary rejects denied or missing local priority receipts without running game peers',async t=>{
 const output=await fixture(t),file=path.join(output,'local-final.json'),local=JSON.parse(await readFile(file,'utf8'));
 local.processPriorities[2]={...local.processPriorities[2],error:'Priority access denied',actualPriority:0};
 local.processPriorities.pop();await writeFile(file,JSON.stringify(local));
 await assert.rejects(execute(process.execPath,[script,'--role=summary','--output='+output]),error=>error.code===1);
 const result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.ok(result.integrity.failures.includes('local-above-normal-priority-not-confirmed'));
 assert.equal(result.localProcessPriorities[2].error,'Priority access denied');assert.equal(result.localProcessPriorities[2].actualPriority,0);
});
test('cloud summary fails closed on SSH forwarding errors and source/tool drift',async t=>{
 const output=await fixture(t);await save(output,'tunnel.json',{bins:[],errors:[{message:'SSH channel failed'}]});
 const file=path.join(output,'cloud-final.json'),cloud=JSON.parse(await readFile(file,'utf8'));
 cloud.sourceUnchanged=false;cloud.measurementUnchanged=false;cloud.resourcesAfter.unchanged=false;cloud.currentReleaseNow='changed';await writeFile(file,JSON.stringify(cloud));
 await assert.rejects(execute(process.execPath,[script,'--role=summary','--output='+output]),error=>error.code===1);
 const result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 for(const failure of ['production-source-changed-during-run','measurement-tools-changed-during-run','combat-resources-changed-during-run','ssh-forwarding-errors','public-release-changed-during-run'])assert.ok(result.integrity.failures.includes(failure));
});

test('direct public route needs verified lifecycle and transfer; absence of wire measurement is not zero',async t=>{
 const output=await fixture(t),file=path.join(output,'experiment.json'),config=JSON.parse(await readFile(file,'utf8'));
 Object.assign(config,{dataTransport:'direct-nginx',sshDataTransports:null,sshDataTransportCount:0,sshControlTransportSeparate:true});
 await writeFile(file,JSON.stringify(config));await rm(path.join(output,'tunnel.json'));
 const route={installed:{phase:'active'},removed:{phase:'removed',exactMarkerRemoved:true,routeFileDisabled:true,markerResiduePresent:false},
  verified:{installed:{diagnosticMarkerPresent:true},removed:{diagnosticMarkerPresent:false}}};
 await save(output,'direct-route.json',route);await save(output,'transfer.json',{complete:true,files:[{verified:true}]});
 await execute(process.execPath,[script,'--role=summary','--output='+output]);
 let result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.equal(result.integrity.passed,true);assert.equal(result.sharedWire,null);assert.equal(result.method.realPublicNginx,true);
 assert.equal(result.method.realSshWan,false);assert.equal(result.method.sshDataTransportCount,0);assert.equal(result.method.sshTotalConnectionCount,1);
 route.verified.removed.diagnosticMarkerPresent=true;await save(output,'direct-route.json',route);
 await save(output,'transfer.json',{complete:false,files:[{verified:false}]});
 await assert.rejects(execute(process.execPath,[script,'--role=summary','--output='+output]),error=>error.code===1);
 result=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
 assert.ok(result.integrity.failures.includes('direct-route-lifecycle-not-confirmed'));
 assert.ok(result.integrity.failures.includes('diagnostic-transfer-not-verified'));
});
