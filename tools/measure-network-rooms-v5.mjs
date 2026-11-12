/** Actual local simultaneous-room native peers through a shared wire bottleneck.
 * Production game rules, assets, owner validation and transports execute in
 * distinct processes. No WAN, browser GPU, NAT or kernel packet loss claim. */
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {createCapacityTcpProxy} from './capacity-tcp-proxy-v4.mjs';
import {setCapacityProcessPriority} from './network-capacity-priority.mjs';
import {parseRoomPlan,distribution,summarizeRoomOverlap,summarizeSharedWire,assessMeasurementIntegrity} from './network-room-metrics-v5.mjs';
const toolRoot=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const cut=arg.indexOf('=');if(cut<0||!arg.startsWith('--'))throw Error('Use --name=value');return [arg.slice(2,cut),arg.slice(cut+1)];}));
const percentile=(rows,p)=>{rows=[...rows].sort((a,b)=>a-b);return rows.length?rows[Math.min(rows.length-1,Math.ceil(rows.length*p)-1)]:null;};
const histogram=(rows,edges)=>edges.map((lo,i)=>{const hi=edges[i+1]??null,count=rows.filter(value=>value>=lo&&(hi===null||value<hi)).length;return {lo,hi,count,percent:rows.length?count/rows.length*100:null};});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref();});
const execute=promisify(execFile);
function deliverySegments(row,server){return {
  serverToAcceptMs:server?row.acceptedAtWallMs-server.receivedAtWallMs:null,
  serverResolvedToReaderMs:server&&Number.isFinite(row.sseReadAtWallMs)?row.sseReadAtWallMs-server.resolvedAtWallMs:null,
  readerToProductionDispatchMs:Number.isFinite(row.sseReadAtWallMs)?row.dispatchedAtWallMs-row.sseReadAtWallMs:null,
  productionDispatchCpuMs:Number.isFinite(row.sseDispatchStartedAtWallMs)?row.dispatchedAtWallMs-row.sseDispatchStartedAtWallMs:null,
  partialEventReadMs:Number.isFinite(row.sseFirstReadAtWallMs)?row.sseReadAtWallMs-row.sseFirstReadAtWallMs:null,
  ...(Number.isFinite(row.sseReadAtWallMs)?{sseReadAtWallMs:row.sseReadAtWallMs,sseReadSeq:row.sseReadSeq}: {})};}
async function competition(){if(process.platform!=='win32')return {unavailable:true};try{const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '--test' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],{cwd:toolRoot,windowsHide:true,maxBuffer:1024*1024});return stdout.trim()?JSON.parse(stdout):[];}catch(error){return {error:error.message};}}
async function processCpuSnapshot(){if(process.platform!=='win32')return {unavailable:true};try{const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress"],{cwd:toolRoot,windowsHide:true,maxBuffer:2*1024*1024});return {atWallMs:Date.now(),processes:stdout.trim()?JSON.parse(stdout):[]};}catch(error){return {error:error.message};}}
async function measurementSeal(){const files={};for(const file of ['tools/measure-network-rooms-v5.mjs','tools/network-room-metrics-v5.mjs','tools/capacity-tcp-proxy-v4.mjs','tools/network-room-peer-v5.mjs','tools/network-peer-failure-v5.mjs','tools/network-peer-controls.mjs','tools/http-event-source-peer.mjs','tools/http-event-source-room-v5.mjs','tools/node-online-socket.mjs','tools/network-capacity-priority.mjs','tools/network-direct-route-v5.mjs','tools/network-bound-egress-v5.mjs'])files[file]=createHash('sha256').update(await readFile(path.join(toolRoot,file))).digest('hex');return {files,aggregateSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex')};}
async function sourceSeal(root){const files=['apps/server/dev-server.mjs','apps/server/local-owner-driver.mjs','apps/server/sse-stream.mjs','apps/server/websocket-stream.mjs',
 'packages/online/service.mjs','packages/online/owned-state.mjs','packages/online/owned-relay-delta.mjs','apps/server/owned-socket-room.mjs',
 'apps/web/online-client.mjs','apps/web/input-prediction.mjs','apps/web/online-socket.mjs','packages/combat-core/index.mjs'];
 const result={root,files:{}};for(const file of files){try{result.files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;}}
 result.aggregateSha256=createHash('sha256').update(JSON.stringify(result.files)).digest('hex');
 // Imported combat modules also change after profession merges. Seal the full
 // small production source tree, including not-yet-committed new modules.
 result.runtimeSourceFiles={};async function visit(relative){let entries;try{entries=await readdir(path.join(root,relative),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){const file=relative+'/'+entry.name;if(entry.isDirectory())await visit(file);else if(entry.isFile()&&/\.(?:mjs|js|json|html|css)$/.test(entry.name))result.runtimeSourceFiles[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}}
 for(const relative of ['apps','packages','config'])await visit(relative);
 result.runtimeSourceSha256=createHash('sha256').update(JSON.stringify(result.runtimeSourceFiles)).digest('hex');return result;}
if(args.worker==='server'){
 const config=JSON.parse(await readFile(args.config,'utf8')),moduleFor=relative=>import(pathToFileURL(path.join(config.root,relative)).href);
 const {createDevServer}=await moduleFor('apps/server/dev-server.mjs');
 const credentials=JSON.parse(await readFile(config.accountFile,'utf8')).accounts;
 const ctx=await createDevServer({root:config.root,assetRoot:config.assets,accountRoot:path.join(config.output,'accounts'),credentials:credentials[0],additionalCredentials:credentials.slice(1),createPlayerAccount:false,roomWorkers:config.roomWorkers,roomCapacity:config.roomCapacity});
 const incoming=[],drops=[],samples=[],sockets=new Set(),hitIds=new Map(),ownerCapture=[];let validOwnerReports=0,uniqueVictimHitReceipts=0,firstOwnerAt=null,captureSeen=0,captureBytes=0;
 let profiler,profilePost,profileReady,profileMetadata=null;
 async function startProfile(){if(!config.serverCpuProfile||profileReady)return profileReady;profileReady=(async()=>{const {Session}=await import('node:inspector');profiler=new Session();profiler.connect();
   profilePost=(method,params={})=>new Promise((resolve,reject)=>profiler.post(method,params,(error,value)=>error?reject(error):resolve(value)));
   await profilePost('Profiler.enable');await profilePost('Profiler.setSamplingInterval',{interval:1000});await profilePost('Profiler.start');profileMetadata={startedAtWallMs:Date.now(),samplingIntervalMicroseconds:1000,file:'server.cpuprofile'};})();return profileReady;}
 ctx.server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 const submit=ctx.online.submitInput.bind(ctx.online),disconnect=ctx.online.disconnect.bind(ctx.online);
 ctx.online.submitInput=(id,batch)=>{const receivedAtWallMs=Date.now(),owner=batch.owner?{epoch:batch.owner.epoch,frameSeq:batch.owner.frameSeq,hitIds:(batch.owner.hits??[]).map(hit=>hit.id)}:null;
   if(owner){firstOwnerAt??=receivedAtWallMs;captureSeen++;const age=receivedAtWallMs-firstOwnerAt;
     if(config.capture.seconds>0&&age>=config.capture.afterSeconds*1000&&age<(config.capture.afterSeconds+config.capture.seconds)*1000&&captureSeen%config.capture.every===0&&ownerCapture.length<600&&captureBytes<8*1024*1024){
       const encoded=JSON.stringify({playerId:id,receivedAtWallMs,batch});captureBytes+=Buffer.byteLength(encoded);if(captureBytes<=8*1024*1024)ownerCapture.push(encoded);}}
   const record=value=>{if(owner){incoming.push({playerId:id,epoch:owner.epoch,frameSeq:owner.frameSeq,receivedAtWallMs,resolvedAtWallMs:Date.now(),accepted:value?.accepted,ignored:value?.ignored});
     if(value?.accepted&&!value.ignored){validOwnerReports++;for(const hitId of owner.hitIds.sort((a,b)=>a-b)){const key=id+'/'+owner.epoch;if(hitId>(hitIds.get(key)??-1)){hitIds.set(key,hitId);uniqueVictimHitReceipts++;}}}}
     return value;};
   const value=submit(id,batch);return value&&typeof value.then==='function'?value.then(record):record(value);};
 ctx.online.disconnect=(id,reason)=>{drops.push({playerId:id,reason,atWallMs:Date.now()});return disconnect(id,reason);};
 const loop=monitorEventLoopDelay({resolution:10});loop.enable();let cpu=process.cpuUsage(),last=performance.now(),loopUsage=performance.eventLoopUtilization();
 const timer=setInterval(()=>{const now=performance.now(),usage=process.cpuUsage(cpu),currentLoopUsage=performance.eventLoopUtilization(),loopIntervalUsage=performance.eventLoopUtilization(currentLoopUsage,loopUsage);loopUsage=currentLoopUsage;cpu=process.cpuUsage();samples.push({atWallMs:Date.now(),
   cpuPercent:(usage.user+usage.system)/1000/(now-last)*100,rssBytes:process.memoryUsage().rss,eventLoopP95Ms:loop.percentile(95)/1e6,eventLoopMaxMs:loop.max/1e6,
   eventLoopUtilization:loopIntervalUsage.utilization,eventLoopActiveMs:loopIntervalUsage.active,eventLoopIdleMs:loopIntervalUsage.idle,
   sessions:ctx.sessions.size,staticCache:{...ctx.staticCache.stats},...(ctx.transportDiagnostics?{transport:ctx.transportDiagnostics()}:{})});last=now;loop.reset();},1000);
 await new Promise(resolve=>ctx.server.listen(0,'127.0.0.1',resolve));
 if(config.map){const base='http://127.0.0.1:'+ctx.server.address().port,login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:credentials[0].username,password:credentials[0].password})});
  if(!login.ok)throw Error('Local diagnostic GM login failed '+login.status);const cookie=login.headers.get('set-cookie').split(';')[0],maps=ctx.online.maps(),list=Array.isArray(maps)?maps:maps.maps;
  if(!list.some(row=>row.id===config.map))throw Error('Requested map is not in production pool');
  for(const row of list){const changed=await fetch(base+'/api/online/maps',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({mapId:row.id,enabled:row.id===config.map})});if(!changed.ok)throw Error('Local diagnostic map selection failed '+changed.status);}
  await fetch(base+'/api/logout',{method:'POST',headers:{Origin:base,Cookie:cookie}});
 }
 process.send?.({ready:true,port:ctx.server.address().port});
 process.on('message',async message=>{if(message==='start-profile'){await startProfile();return;}if(message!=='stop')return;clearInterval(timer);loop.disable();
   if(profileReady){await profileReady;const {profile}=await profilePost('Profiler.stop');profileMetadata.stoppedAtWallMs=Date.now();await writeFile(path.join(config.output,'server.cpuprofile'),JSON.stringify(profile)+'\n');profiler.disconnect();}
   if(config.capture.seconds>0)await writeFile(path.join(config.output,'private-owner-samples.json'),'['+ownerCapture.join(',')+']\n',{mode:0o600});
   await writeFile(path.join(config.output,'server.json'),JSON.stringify({incoming,drops,samples,validOwnerReports,uniqueVictimHitReceipts,profileMetadata,capture:{...config.capture,samples:ownerCapture.length,bytes:captureBytes,file:config.capture.seconds>0?'private-owner-samples.json':null},
   ...(ctx.transportDiagnostics?{transport:ctx.transportDiagnostics()}:{})},null,2)+'\n');
   ctx.closeStreams();ctx.online.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>ctx.server.close(resolve));process.disconnect?.();});
}else{
 const root=path.resolve(args.root??toolRoot),assets=path.resolve(args.assets??path.join(toolRoot,'artifacts'));
 const plan=parseRoomPlan(args.rooms??args.mode??'3v3'),{players}=plan,mode=plan.modes.join('+');
 const seconds=Number(args.seconds??180),rate=Number(args['egress-mbps']??10),oneWayMs=Number(args['one-way-ms']??80);
 if(!Number.isFinite(seconds)||seconds<10||seconds>600||!Number.isFinite(rate)||rate<0||!Number.isFinite(oneWayMs)||oneWayMs<0)throw Error('Invalid experiment config');
 const minimumOverlapSeconds=Number(args['minimum-overlap-seconds']??Math.max(0,seconds-15));
 if(!Number.isFinite(minimumOverlapSeconds)||minimumOverlapSeconds<0||minimumOverlapSeconds>seconds)throw Error('Invalid overlap requirement');
 const priorityPolicy=args['process-priority']??'normal',processPriorities=[{name:'proxy-and-coordinator',...setCapacityProcessPriority(priorityPolicy)}];
 const label=args.label??`${mode}-${rate}mbps-${Date.now()}`,output=path.resolve(args.output??path.join(toolRoot,'runtime/network-rooms-v5',label));await mkdir(output,{recursive:true});
 const readyFile=path.join(output,'all-peers-ready.gate');
 try{await readFile(readyFile);throw Error('Output already contains a readiness gate; choose a fresh label');}catch(error){if(error.code!=='ENOENT')throw error;}
 const capture={seconds:Number(args['capture-owner-seconds']??0),afterSeconds:Number(args['capture-owner-after-seconds']??30),every:Number(args['capture-owner-every']??12)};
 if(!Number.isFinite(capture.seconds)||capture.seconds<0||capture.seconds>30||!Number.isFinite(capture.afterSeconds)||capture.afterSeconds<0||!Number.isInteger(capture.every)||capture.every<1)throw Error('Invalid capture config');
 const roomWorkers=args['room-workers']!=='false',roomCapacity={maxRoomsByMode:{'1v1':3,'2v2':3,'3v3':2}};
 const serverCpuProfile=args['server-cpu-profile']==='true';
 const sealBefore=await sourceSeal(root),measurementBefore=await measurementSeal(),competitionBefore=await competition(),processCpuBefore=await processCpuSnapshot(),processCpuSamples=[],hostSamples=[],competitionSamples=[],coordinatorSamples=[];
 const coordinatorLoop=monitorEventLoopDelay({resolution:10});coordinatorLoop.enable();let coordinatorCpu=process.cpuUsage(),coordinatorLast=performance.now(),coordinatorLoopUsage=performance.eventLoopUtilization();
 let previousCpu=os.cpus(),competitionBusy=false,hostTicks=0;
 const hostTimer=setInterval(()=>{const cpus=os.cpus();let idle=0,total=0;for(let i=0;i<cpus.length;i++){const prior=previousCpu[i].times,next=cpus[i].times;idle+=next.idle-prior.idle;for(const key of Object.keys(next))total+=next[key]-prior[key];}previousCpu=cpus;
  hostSamples.push({atWallMs:Date.now(),logicalCpus:cpus.length,totalCpuPercent:total?(1-idle/total)*100:0,freeMemoryBytes:os.freemem()});
  const coordinatorNow=performance.now(),coordinatorUsage=process.cpuUsage(coordinatorCpu),currentLoopUsage=performance.eventLoopUtilization(),loopIntervalUsage=performance.eventLoopUtilization(currentLoopUsage,coordinatorLoopUsage);coordinatorLoopUsage=currentLoopUsage;coordinatorCpu=process.cpuUsage();
  coordinatorSamples.push({atWallMs:Date.now(),cpuPercent:(coordinatorUsage.user+coordinatorUsage.system)/1000/(coordinatorNow-coordinatorLast)*100,rssBytes:process.memoryUsage().rss,eventLoopP95Ms:coordinatorLoop.percentile(95)/1e6,eventLoopMaxMs:coordinatorLoop.max/1e6,eventLoopUtilization:loopIntervalUsage.utilization});coordinatorLast=coordinatorNow;coordinatorLoop.reset();
  if(++hostTicks%10===0&&!competitionBusy){competitionBusy=true;void Promise.all([competition(),processCpuSnapshot()]).then(([processes,cpuSnapshot])=>{competitionSamples.push({atWallMs:Date.now(),processes});processCpuSamples.push(cpuSnapshot);}).finally(()=>{competitionBusy=false;});}},1000);
 const credentials=[{username:'fixture_admin',password:randomBytes(18).toString('base64url'),role:'gm'},
   ...Array.from({length:players},(_,i)=>({username:`capacity-peer-${i}`,password:randomBytes(18).toString('base64url'),role:'player'}))];
 const accountFile=path.join(output,'private-accounts.json'),configFile=path.join(output,'server-config.json');await writeFile(accountFile,JSON.stringify({accounts:credentials}),{mode:0o600});
 await writeFile(configFile,JSON.stringify({root,assets,output,accountFile,serverCpuProfile,roomWorkers,roomCapacity,capture,map:args.map??'sander-garpai-rock-pvp'}));
 const script=fileURLToPath(import.meta.url),logs=new Map(),exits=[],peerProcesses=[];let proxy,serverProcess,profileSignalled=false,readyReleaseTask;const resourceReady=new Map(),peerLifecycle=[];
 function child(file,argv,name){const proc=fork(file,argv,{cwd:toolRoot,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let log='';
   processPriorities.push({name,...setCapacityProcessPriority(priorityPolicy,proc.pid)});
   proc.on('message',message=>{if(!['resources-ready','simulation-started'].includes(message?.type))return;peerLifecycle.push({name,...message});
     if(message.type==='resources-ready'){console.log(name+' resources ready');resourceReady.set(message.playerId,message);if(resourceReady.size===players&&!readyReleaseTask)readyReleaseTask=writeFile(readyFile,'ready\n').then(()=>peerLifecycle.push({type:'all-ready-released',atWallMs:Date.now()}));}});
   proc.stdout.on('data',chunk=>{const text=chunk.toString();log+=text;if(text.includes('peer simulation started')){console.log(name+' started');if(serverCpuProfile&&!profileSignalled){profileSignalled=true;serverProcess.send('start-profile');}}});proc.stderr.on('data',chunk=>{log+=chunk.toString();});
   const exit=new Promise(resolve=>proc.once('exit',(code,signal)=>resolve({name,code,signal})));exits.push(exit);logs.set(name,()=>log);return proc;}
 try{
  serverProcess=child(script,['--worker=server','--config='+configFile],'server');const ready=await Promise.race([new Promise(resolve=>serverProcess.once('message',resolve)),exits[0].then(()=>{throw Error('Server startup failed: '+logs.get('server')());}),deadline(60000).then(()=>{throw Error('Server startup timeout');})]);
  if(!ready?.ready)throw Error('Server did not become ready');
  proxy=await createCapacityTcpProxy({upstreamPort:ready.port,players,egressBytesPerSecond:rate?rate*1e6/8:Infinity,oneWayMs,
    slowPlayer:Number(args['slow-player']??-1),slowBytesPerSecond:Number(args['slow-bytes']??32768)});
  console.log(JSON.stringify({experiment:label,mode,players,seconds,egressMbps:rate,oneWayMs,priorityPolicy,sourceSha256:sealBefore.aggregateSha256,output}));
  const professions=(args.professions??'RF,LK,VC').split(',');for(let i=0;i<players;i++)peerProcesses.push(child(path.join(toolRoot,'tools/network-room-peer-v5.mjs'),[
    '--root='+root,'--assets='+assets,'--base=http://127.0.0.1:'+proxy.ports[i],'--account-file='+accountFile,'--index='+(i+1),
    '--mode='+plan.peerModes[i],'--ready-file='+readyFile,'--skills='+ (args.skills??'cycle'),'--seconds='+seconds,'--profession='+professions[i%professions.length],'--configure-loadout=true',
    '--output='+path.join(output,`peer-${i}.json`)],'peer-'+i));
  if(args['pause-ms']){void(async()=>{while(!logs.get('peer-0')().includes('peer simulation started')){if(peerProcesses[0].exitCode!==null)return;await sleep(250);}
    proxy.setPause({player:Number(args['pause-player']??0),atWallMs:Date.now()+Number(args['pause-after-seconds']??30)*1000,durationMs:Number(args['pause-ms'])});})();}
  const peerExit=await Promise.race([Promise.all(exits.slice(1)),deadline((seconds+190)*1000).then(()=>{throw Error('Peer experiment deadline');})]);
  await readyReleaseTask;await sleep(250);await writeFile(path.join(output,'wire.json'),JSON.stringify(proxy.snapshot(),null,2)+'\n');
  serverProcess.send('stop');await Promise.race([exits[0],deadline(10000)]);
  const peers=[];for(let i=0;i<players;i++)try{peers.push(JSON.parse(await readFile(path.join(output,`peer-${i}.json`),'utf8')));}catch(error){peers.push({playerId:credentials[i+1].username,error:error.message});}
  const server=JSON.parse(await readFile(path.join(output,'server.json'),'utf8')),wire=proxy.snapshot();
  const generation=new Map(peers.flatMap(peer=>peer.generatedReports??[]).map(row=>[`${row.playerId}/${row.epoch}/${row.frameSeq}`,row.generatedAtWallMs]));
  const serverArrival=new Map(server.incoming.filter(row=>row.accepted===true&&!row.ignored).map(row=>[`${row.playerId}/${row.epoch}/${row.frameSeq}`,row]));
  const receiveRows=[],serverRows=[];for(const peer of peers)for(const row of peer.receivedReports??[]){const generatedAt=generation.get(`${row.playerId}/${row.epoch}/${row.frameSeq}`);if(generatedAt!==undefined)
    receiveRows.push({sink:peer.playerId,source:row.playerId,epoch:row.epoch,frameSeq:row.frameSeq,generatedAtWallMs:generatedAt,acceptedAtWallMs:row.acceptedAtWallMs,
      ms:row.acceptedAtWallMs-generatedAt,applied:row.applied,...deliverySegments(row,serverArrival.get(`${row.playerId}/${row.epoch}/${row.frameSeq}`)),
      dispatchToAcceptMs:row.acceptedAtWallMs-(row.dispatchedAtWallMs??row.acceptedAtWallMs)});}
  for(const row of server.incoming){const generatedAt=generation.get(`${row.playerId}/${row.epoch}/${row.frameSeq}`);if(generatedAt!==undefined)serverRows.push(row.receivedAtWallMs-generatedAt);}
  const concurrency=summarizeRoomOverlap({plan,peers,receiveRows,minimumOverlapSeconds}),sharedWire=summarizeSharedWire(wire.bins,concurrency.startWallMs,concurrency.endWallMs);
  const firstFight=concurrency.startWallMs??Infinity,lastFight=concurrency.endWallMs??-Infinity;
  const combatServerSamples=server.samples.filter(row=>row.atWallMs>=firstFight&&row.atWallMs<lastFight);
  const decodedEventTypes={};for(const peer of peers)for(const source of peer.eventSources??[])for(const [type,row]of Object.entries(source.eventTypes??{})){
   const total=decodedEventTypes[type]??={events:0,payloadBytes:0};total.events+=row.events;total.payloadBytes+=row.payloadBytes;}
  const combatBins=wire.bins.filter(row=>row.atWallMs>=firstFight&&row.atWallMs<lastFight),perSecond=new Map();
  for(const row of combatBins){const key=Math.floor(row.atWallMs/1000);perSecond.set(key,(perSecond.get(key)??0)+row.down);}
  const sealAfter=await sourceSeal(root),measurementAfter=await measurementSeal();const result={schema:'network-rooms-v5-real-concurrent-independent-native-peers',label,sourceBefore:sealBefore,sourceAfter:sealAfter,sourceUnchanged:sealBefore.runtimeSourceSha256===sealAfter.runtimeSourceSha256,
    measurementBefore,measurementAfter,measurementUnchanged:measurementBefore.aggregateSha256===measurementAfter.aggregateSha256,
    method:{mode,rooms:plan.modes,players,roomWorkersRequested:roomWorkers,roomCapacityRequested:roomCapacity,capture,secondsRequested:seconds,egressMbps:rate,oneWayMs,professions,priorityPolicy,serverCpuProfile,sharedBottleneck:true,independentProcesses:true,normalGameRules:true,rendered:false,rtc:false,wanMeasured:false,
      observation:'side tables join authenticated source-generated and validated receiver-dispatched epoch/frame IDs using shared-host wall clock; prediction acceptance is additionally marked applied; real compressed TCP stream includes framing but not IP headers or retransmissions',
      limitations:['Local native peers have no browser GPU and no NAT/RTC.','No-IPC legacy baseline explicitly sets room-workers=false; candidate records actual child diagnostics independently of the requested setting.','Optional owner capture adds diagnostic stringify work and is disabled in final capacity runs.','Host CPU and process priority are not the upgraded production 4-vCPU/8-GB VM.','Normal game result or disconnect can end measurement early; actual per-peer duration is explicit.','Kernel buffers exist; application proxy cap cannot reproduce exact cloud NIC/Nginx queue discipline.']},
    peerExit,peerLifecycle,concurrency,sharedWire,activity:{nativeHitEvents:peers.reduce((n,peer)=>n+(peer.stats?.hits??0),0),successfulNativeSkillStarts:peers.reduce((n,peer)=>n+(peer.stats?.skillStarted??0),0),validOwnerReports:server.validOwnerReports,uniqueVictimHitReceipts:server.uniqueVictimHitReceipts},
    decodedEventTypes:{scope:'all receiver SSE data payload UTF-8 bytes including init/reconnect, excludes framing; uncompressed and not wire demand',types:decodedEventTypes},
    host:{samples:hostSamples,processCpuBefore,processCpuSamples,processCpuAfter:await processCpuSnapshot(),competitionBefore,competitionSamples,competitionAfter:await competition(),processPriorities,cpuPercent:distribution(hostSamples.map(row=>row.totalCpuPercent)),coordinatorSamples,
      coordinatorCombatCpuPercent:distribution(coordinatorSamples.filter(row=>row.atWallMs>=firstFight&&row.atWallMs<lastFight).map(row=>row.cpuPercent)),
      coordinatorCombatEventLoopUtilization:distribution(coordinatorSamples.filter(row=>row.atWallMs>=firstFight&&row.atWallMs<lastFight).map(row=>row.eventLoopUtilization)),
      coordinatorCombatEventLoopP95Ms:distribution(coordinatorSamples.filter(row=>row.atWallMs>=firstFight&&row.atWallMs<lastFight).map(row=>row.eventLoopP95Ms))},endToEndMs:distribution(receiveRows.map(row=>row.ms)),generationToServerMs:distribution(serverRows),
    serverToReceiverMs:distribution(receiveRows.map(row=>row.serverToAcceptMs).filter(Number.isFinite)),dispatchToAcceptMs:distribution(receiveRows.map(row=>row.dispatchToAcceptMs)),
    deliverySegments:{scope:'server submit/worker resolution, decompressed fetch-reader completion, synchronous production dispatch and asynchronous owner application; same-host wall clock. Reader timestamps are not kernel arrival.',
      serverWorkerMs:distribution(server.incoming.filter(row=>row.accepted===true&&!row.ignored).map(row=>row.resolvedAtWallMs-row.receivedAtWallMs)),
      serverResolvedToReaderMs:distribution(receiveRows.map(row=>row.serverResolvedToReaderMs)),readerToProductionDispatchMs:distribution(receiveRows.map(row=>row.readerToProductionDispatchMs)),
      productionDispatchCpuMs:distribution(receiveRows.map(row=>row.productionDispatchCpuMs)),partialEventReadMs:distribution(receiveRows.map(row=>row.partialEventReadMs))},
    actuallyAppliedEndToEndMs:distribution(receiveRows.filter(row=>row.applied===true).map(row=>row.ms)),rejectedOrSupersededDeliveries:receiveRows.filter(row=>row.applied===false).length,
    perSink:peers.map(peer=>({playerId:peer.playerId,matchId:peer.matchId,matchMode:peer.matchMode,matchPlayerIds:peer.matchPlayerIds,sceneId:peer.sceneId,versions:peer.versions,seconds:peer.seconds,sourceCadence:peer.sourceCadence,stats:peer.stats,errors:peer.errors,eventSources:peer.eventSources,endToEndMs:distribution(receiveRows.filter(row=>row.sink===peer.playerId).map(row=>row.ms)),
      actuallyAppliedEndToEndMs:distribution(receiveRows.filter(row=>row.sink===peer.playerId&&row.applied===true).map(row=>row.ms)),
      rejectedOrSupersededDeliveries:receiveRows.filter(row=>row.sink===peer.playerId&&row.applied===false).length,
      transport:peer.transport,process:distribution((peer.progress??[]).map(row=>row.process?.cpuPercent).filter(Number.isFinite)),receiveCpuP95Ms:distribution((peer.progress??[]).map(row=>row.receiveCpu?.p95Ms).filter(Number.isFinite))})),
    bins30s:Array.from({length:Math.ceil(seconds/30)},(_,i)=>({endSeconds:(i+1)*30,ageMs:distribution(receiveRows.filter(row=>row.acceptedAtWallMs>=firstFight+i*30000&&row.acceptedAtWallMs<firstFight+(i+1)*30000).map(row=>row.ms))})),
    wire:{...wire.method,totalDownBytes:wire.flows.filter(row=>row.direction==='down').reduce((n,row)=>n+row.bytes,0),combatDownBytesPerSecond:distribution([...perSecond.values()]),combat100msBytes:distribution(combatBins.map(row=>row.down))},
    server:{scope:'whole experiment including initialization/queue; combat fields restrict samples to generated source-report window',
      cpuPercent:distribution(server.samples.map(row=>row.cpuPercent)),eventLoopP95Ms:distribution(server.samples.map(row=>row.eventLoopP95Ms)),eventLoopMaxMs:distribution(server.samples.map(row=>row.eventLoopMaxMs)),rssBytes:distribution(server.samples.map(row=>row.rssBytes)),
      combatCpuPercent:distribution(combatServerSamples.map(row=>row.cpuPercent)),combatCpuHistogram:histogram(combatServerSamples.map(row=>row.cpuPercent),[0,25,50,75,100,125]),
      combatEventLoopUtilization:distribution(combatServerSamples.map(row=>row.eventLoopUtilization)),combatEventLoopUtilizationHistogram:histogram(combatServerSamples.map(row=>row.eventLoopUtilization),[0,.25,.5,.75,.9]),
      combatEventLoopP95Ms:distribution(combatServerSamples.map(row=>row.eventLoopP95Ms)),combatRssBytes:distribution(combatServerSamples.map(row=>row.rssBytes)),
      preCombatRssBytes:distribution(server.samples.filter(row=>row.atWallMs<firstFight).map(row=>row.rssBytes)),
      lastPreCombatRssBytes:server.samples.filter(row=>row.atWallMs<firstFight).at(-1)?.rssBytes??null,
      drops:server.drops,transport:server.transport,profileMetadata:server.profileMetadata,capture:server.capture,
      parentAndChildrenCpuPercent:distribution(combatServerSamples.map(row=>row.cpuPercent+(row.transport?.roomWorkers?.workers??[]).reduce((n,worker)=>n+(worker.cpuPercent??0),0))),
      parentAndChildrenRssBytes:distribution(combatServerSamples.map(row=>row.rssBytes+(row.transport?.roomWorkers?.workers??[]).reduce((n,worker)=>n+(worker.rssBytes??0),0))),
      activeRoomWorkers:distribution(combatServerSamples.map(row=>row.transport?.roomWorkers?.workers?.length??0)),
      roomWorkerSamples:combatServerSamples.filter(row=>row.transport?.roomWorkers).map(row=>({atWallMs:row.atWallMs,...row.transport.roomWorkers}))},
    evidenceFiles:['server.json','wire.json',...peers.map((_,i)=>`peer-${i}.json`)],endToEndRows:receiveRows};
  result.integrity=assessMeasurementIntegrity({concurrency,peers,peerExit,drops:server.drops,sourceUnchanged:result.sourceUnchanged,measurementUnchanged:result.measurementUnchanged});
  result.evidenceSha256={};for(const file of result.evidenceFiles){try{result.evidenceSha256[file]=createHash('sha256').update(await readFile(path.join(output,file))).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;result.evidenceSha256[file]=null;}}
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  if(args.report){const report=path.resolve(args.report);await mkdir(path.dirname(report),{recursive:true});const compact={...result};delete compact.endToEndRows;await writeFile(report,JSON.stringify(compact,null,2)+'\n');}
  console.log(JSON.stringify({output,integrity:result.integrity,sourceUnchanged:result.sourceUnchanged,concurrency:{valid:result.concurrency.valid,seconds:result.concurrency.overlapSeconds,reasons:result.concurrency.reasons,applied:result.concurrency.actuallyAppliedEndToEndMs},sharedWire:{seconds:result.sharedWire.seconds,downBytesPerSecond:result.sharedWire.downBytesPerSecond},endToEndMs:result.endToEndMs,wire:result.wire,server:{combatCpuPercent:result.server.combatCpuPercent,combatEventLoopP95Ms:result.server.combatEventLoopP95Ms,drops:result.server.drops,transportCounts:result.server.transport?Object.fromEntries(Object.entries(result.server.transport).filter(([,value])=>typeof value==='number')):null},peers:result.perSink.map(row=>({id:row.playerId,seconds:row.seconds,hits:row.stats?.hits,skills:row.stats?.skillStarted,errors:row.errors?.length,ageP95:row.endToEndMs.p95}))}));
  if(!result.integrity.passed)process.exitCode=1;
 }finally{clearInterval(hostTimer);coordinatorLoop.disable();for(const proc of peerProcesses)if(proc.exitCode===null)proc.kill();if(proxy)await proxy.close();if(serverProcess?.exitCode===null)serverProcess.kill();
   for(const [name,get]of logs)await writeFile(path.join(output,name+'.log'),get());}
}
