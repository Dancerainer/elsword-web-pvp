/** Isolated cloud-capacity bridge. Invoked only by measure-cloud-rooms-v5.py.
 * Never binds a public listener or changes a production release/account.
 * Existing measured server and peer tools execute unchanged in child processes. */
import {readFile,writeFile,readdir,realpath,rm,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {parseRoomPlan,distribution,summarizeRoomOverlap,summarizeSharedWire,assessMeasurementIntegrity} from './network-room-metrics-v5.mjs';
import {setCapacityProcessPriority} from './network-capacity-priority.mjs';
import {createPrivateApiResolver,peerFinishGrace} from './network-direct-route-v5.mjs';
import {sealDispatcher} from './network-bound-egress-v5.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');if(i<3||!arg.startsWith('--'))throw Error('Use --name=value');return [arg.slice(2,i),arg.slice(i+1)];}));
const self=fileURLToPath(import.meta.url),execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
const save=async(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const output=path.resolve(args.output??'.');
const deadlines=new Set();
function timeout(ms,label){return new Promise((_,reject)=>{const t=setTimeout(()=>{deadlines.delete(t);reject(Error(label));},ms);deadlines.add(t);});}
function clearDeadlines(){for(const t of deadlines)clearTimeout(t);deadlines.clear();}
async function sourceSeal(root){
 const files={};async function visit(relative){
  for(const entry of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
   const file=relative+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Linked production source: '+file);
   if(entry.isDirectory())await visit(file);else if(entry.isFile()&&/\.(?:mjs|js|json|html|css)$/.test(file)){
    const bytes=await readFile(path.join(root,file));files[file]={bytes:bytes.length,sha256:sha(bytes),canonicalSha256:sha(bytes.toString('utf8').replaceAll('\r\n','\n'))};
   }
  }
 }
 for(const directory of ['apps','packages','config','contracts'])await visit(directory);
 const file='tools/assets/character/sample_pose.mjs',bytes=await readFile(path.join(root,file));
 files[file]={bytes:bytes.length,sha256:sha(bytes),canonicalSha256:sha(bytes.toString('utf8').replaceAll('\r\n','\n'))};
 return {files,rawSha256:sha(JSON.stringify(files))};
}
async function toolSeal(root){
 const files={};for(const file of ['cloud-network-rooms-v5.mjs','measure-network-rooms-v5.mjs','network-room-metrics-v5.mjs',
  'capacity-tcp-proxy-v4.mjs','network-capacity-priority.mjs','network-room-peer-v5.mjs','network-peer-controls.mjs',
  'http-event-source-peer.mjs','http-event-source-room-v5.mjs','node-online-socket.mjs','network-peer-failure-v5.mjs','network-direct-route-v5.mjs','network-bound-egress-v5.mjs']){
  try{files['tools/'+file]=sha(await readFile(path.join(root,'tools',file)));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 for(const name of ['cloud-rooms-nginx-v5.py','cloud-rooms-collect-v5.py']){
  try{files['scripts/'+name]=sha(await readFile(path.join(root,'scripts',name)));}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return {files,sha256:sha(JSON.stringify(files))};
}
async function inspect(root,assets){
 const source=await sourceSeal(root),{fingerprintHostProgram}=await import(pathToFileURL(path.join(root,'packages/combat-assets/program-fingerprint.mjs')).href);
 const {loadServerCombatAssets}=await import(pathToFileURL(path.join(root,'packages/combat-assets/server-assets.mjs')).href);
 const loaded=await loadServerCombatAssets({root,assetRoot:assets});
 return {root,assets,source,hostProgram:await fingerprintHostProgram({root}),versions:loaded.versions,
  resources:loaded.fingerprints.resources,professions:loaded.professions,assetDiagnostics:loaded.assetDiagnostics,maps:loaded.maps,
  bundleSha256:sha(await readFile(path.join(root,'dist/game.js'))),node:process.version,platform:process.platform};
}
async function verifyResources(root,assets,inventory){
 const actual=[],changed=[];
 for(const row of inventory.files){
  const relative=row.file.startsWith('assets/')?row.file.slice(7):row.file;
  if(!relative||relative.includes('\\')||relative.includes(':')||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid sealed resource path');
  const bytes=await readFile(path.join(row.file.startsWith('assets/')?assets:root,relative));
  const value={file:row.file,bytes:bytes.length,sha256:sha(bytes)};actual.push(value);
  if(value.bytes!==row.bytes||value.sha256!==row.sha256)changed.push(row.file);
 }
 return {checkedFiles:actual.length,unchanged:changed.length===0,changed,
  expectedFilesSha256:sha(JSON.stringify(inventory.files)),actualFilesSha256:sha(JSON.stringify(actual)),
  scope:'Exact consumed headless combat resource closure, including native binaries and pose data; browser-only display files are outside this seal'};
}
if(args.role==='inspect'){
 send(await inspect(path.resolve(args.root),path.resolve(args.assets)));clearDeadlines();
}else if(args.role==='cloud'){
 // The Python launcher creates and uploads only this random private directory.
 if(process.platform!=='linux'||!/^\/tmp\/rf-cloud-rooms-[a-f0-9]{24}$/.test(output)||await realpath(output)!==output
  ||path.dirname(path.dirname(self))!==output)throw Error('Unrecognized private cloud output directory');
 let config,server=null,serverExit=null,stopping=null,ready=false,lastHeartbeat=performance.now(),closed=false;
 const measurementBefore=await toolSeal(output);
 const children=new Set(),hostSamples=[];let previous=os.cpus(),heartbeatTimer,hostTimer,lifeTimer;
 const killChildren=signal=>{for(const child of children){try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')send({type:'cleanup-error',message:e.message});}}};
 async function probe(root,assets){
  const pending=execute(process.execPath,[self,'--role=inspect','--root='+root,'--assets='+assets],{detached:true,maxBuffer:16*1024*1024,timeout:120000});
  children.add(pending.child);
  try{const {stdout}=await pending;return JSON.parse(stdout);}finally{children.delete(pending.child);}
 }
 async function cleanup(){
  if(closed)return;closed=true;killChildren('SIGKILL');clearInterval(heartbeatTimer);clearInterval(hostTimer);clearTimeout(lifeTimer);clearDeadlines();
  if(await realpath(output)!==output)throw Error('Private output identity changed');
  await rm(output,{recursive:true,force:false});
  await new Promise(resolve=>process.stdout.write(JSON.stringify({type:'cleaned',output})+'\n',resolve));process.exit(0);
 }
 async function stop(reason='requested',erase=false){
  if(!stopping)stopping=(async()=>{
   clearInterval(hostTimer);clearTimeout(lifeTimer);
   if(server&&server.exitCode===null){try{server.send('stop');}catch{}await Promise.race([serverExit,sleep(15000)]);}
   killChildren('SIGTERM');await sleep(250);killChildren('SIGKILL');
   let sourceAfter=null,measurementAfter=null,currentReleaseNow=null,resourcesAfter=null;const errors=[];
   try{sourceAfter=config?await sourceSeal(config.root):null;}catch(e){errors.push(e.message);}
   try{measurementAfter=await toolSeal(output);}catch(e){errors.push(e.message);}
   try{currentReleaseNow=await realpath('/opt/rf-pvp/current');}catch(e){errors.push(e.message);}
   try{resourcesAfter=config?await verifyResources(config.root,config.assets,config.before.resources):null;}catch(e){errors.push(e.message);}
   await save(path.join(output,'cloud-final.json'),{reason,sourceAfter,resourcesAfter,hostSamples,atWallMs:Date.now(),errors,
    currentReleaseNow,fixedRelease:config?.root,measurementBefore,measurementAfter,
    measurementUnchanged:measurementBefore.sha256===measurementAfter?.sha256,
    sourceUnchanged:!!sourceAfter&&sourceAfter.rawSha256===config.before.source.rawSha256});
   clearDeadlines();send({type:'stopped',reason});
  })();
  try{await stopping;}finally{if(erase)await cleanup();}
 }
 async function start(value){
  if(config||closed)throw Error('Cloud already initialized');
  const root=await realpath('/opt/rf-pvp/current');
  if(root!==value.expectedRelease||!/^\/opt\/rf-pvp\/releases\/[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/.test(root))throw Error('Active release differs from requested deployed release');
  const assets=path.join(root,'artifacts');if(await realpath(assets)!==assets)throw Error('Cloud artifacts must belong to the fixed release');
  if(!/^[a-f0-9]{64}$/.test(value.expectedBuildSha256)||sha(await readFile(path.join(root,'dist/game.js')))!==value.expectedBuildSha256)throw Error('Deployed browser SHA differs');
  const before=await probe(root,assets);if(closed||stopping)return;
  if(before.assetDiagnostics.length||['RF','LK','VC','RS','BM'].some(id=>!before.professions[id]))throw Error('Published professions are incomplete');
  config={root,assets,before};await save(path.join(output,'cloud-before.json'),before);
  send({type:'inspected',before});
 }
 async function launch(value){
  if(!config||server||stopping)throw Error('Cloud not ready for launch');
  const {players}=parseRoomPlan(value.rooms);if(![4,6,12].includes(players))throw Error('Cloud tool permits only 4, 6 or 12 peers');
  if(!Number.isInteger(value.seconds)||value.seconds<10||value.seconds>600)throw Error('Invalid cloud duration');
  const accountFile=path.join(output,'private-accounts.json'),accounts=await readJson(accountFile);
  if(accounts.accounts.length!==players+1)throw Error('Private account count differs');
  // Production grants GM only to its named administrator. Keep all diagnostic
  // identities random ordinary players; initialize the isolated map settings
  // before the server loads them instead of borrowing a real GM identity.
  const map='sander-garpai-rock-pvp';if(!config.before.maps.some(row=>row.id===map))throw Error('Diagnostic map is unavailable');
  await mkdir(path.join(output,'accounts'));
  await save(path.join(output,'accounts/online-maps.json'),{schemaVersion:1,maps:Object.fromEntries(config.before.maps.map(row=>[row.id,row.id===map]))});
  const cfg={root:config.root,assets:config.assets,output,accountFile,roomWorkers:true,roomCapacity:{maxRoomsByMode:{'1v1':3,'2v2':3,'3v3':2}},
   capture:{seconds:0,afterSeconds:30,every:12},serverCpuProfile:false,map:null};
  const configFile=path.join(output,'server-config.json');await save(configFile,cfg);
  server=fork(path.join(output,'tools/measure-network-rooms-v5.mjs'),['--worker=server','--config='+configFile],
   {cwd:config.root,detached:true,execArgv:[],stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RF_ACCOUNT_ROOT:path.join(output,'accounts')}});
  children.add(server);server.stdout.pipe(createWriteStream(path.join(output,'server.stdout.log'),{mode:0o600}));
  server.stderr.pipe(createWriteStream(path.join(output,'server.stderr.log'),{mode:0o600}));
  serverExit=new Promise(resolve=>server.once('exit',(code,signal)=>{resolve({code,signal});send({type:'server-exit',code,signal});if(!stopping)void stop('unexpected-server-exit').catch(fatal);}));
  server.once('error',fatal);
  server.on('message',message=>{if(message?.ready&&!ready){ready=true;clearDeadlines();send({type:'ready',port:message.port,pid:server.pid,fixedRelease:config.root});}});
  hostTimer=setInterval(()=>{const cpus=os.cpus();let idle=0,total=0;for(let i=0;i<cpus.length;i++)for(const [key,value]of Object.entries(cpus[i].times)){
   const delta=value-(previous[i]?.times[key]??value);total+=delta;if(key==='idle')idle+=delta;}
   previous=cpus;hostSamples.push({atWallMs:Date.now(),cpuPercent:total?(1-idle/total)*100:0,logicalCpus:cpus.length,freeMemoryBytes:os.freemem(),loadAverage:os.loadavg()});
  },1000);
  lifeTimer=setTimeout(()=>void stop('cloud-hard-deadline',true).catch(fatal),(value.seconds+480)*1000);
  void timeout(120000,'Cloud server startup timeout').catch(fatal);
 }
 async function fatal(error){send({type:'fatal',message:error.message});await stop('fatal',true).catch(()=>{killChildren('SIGKILL');process.exit(1);});}
 heartbeatTimer=setInterval(()=>{if(performance.now()-lastHeartbeat>25000)void stop('heartbeat-lost',true).catch(fatal);},5000);
 const input=createInterface({input:process.stdin,crlfDelay:Infinity});let chain=Promise.resolve();
 input.on('line',line=>{let value;try{if(line.length>32768)throw Error('Bridge command too large');value=JSON.parse(line);}catch(e){void fatal(e);return;}
  if(value.type==='heartbeat'){lastHeartbeat=performance.now();return;}
  chain=chain.then(()=>value.type==='inspect'?start(value):value.type==='launch'?launch(value):value.type==='stop'?stop():value.type==='cleanup'?cleanup():Promise.reject(Error('Unknown bridge command'))).catch(fatal);
 });
 input.on('close',()=>void stop('stdin-closed',true).catch(fatal));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void stop(signal,true).catch(fatal));
 send({type:'bridge-ready',pid:process.pid});
}else if(args.role==='peers'){
 const config=await readJson(args.config),plan=parseRoomPlan(config.rooms),root=path.resolve(config.root),assets=path.resolve(config.assets);
 if(process.platform!=='win32'||config.localPriorityPolicy!=='above-normal'||config.localLauncherPid!==process.ppid)throw Error('Expected this experiment\'s Windows launcher and above-normal local policy');
 // Only the launcher that created this supervisor and children created below
 // belong to this experiment. The Linux cloud role never calls this helper.
 const processPriorities=[{name:'ssh-forwarding-coordinator',...setCapacityProcessPriority('above-normal',config.localLauncherPid)},
  {name:'native-peer-coordinator',...setCapacityProcessPriority('above-normal')}];
 const before=await sourceSeal(root),measurementBefore=await toolSeal(path.dirname(path.dirname(self))),processes=[],exits=[],lifecycle=[],resourceReady=new Set();
 if(before.rawSha256!==config.expectedLocalSourceRawSha256)throw Error('Local source changed after cloud parity check');
 for(const [name,digest]of Object.entries(config.uploadedTools))if(measurementBefore.files['tools/'+name]!==digest)throw Error('Local/remote measurement tool differs: '+name);
 for(const [name,digest]of Object.entries(config.uploadedHelpers??{}))if(measurementBefore.files[name]!==digest)throw Error('Local/remote measurement helper differs: '+name);
 const direct=config.dataTransport==='direct-nginx';
 const dispatcherBefore=config.peerLocalAddress?await sealDispatcher(config.undiciModule):null;
 if(direct)createPrivateApiResolver(config.publicOrigin,config.pathPrefix);
 const gate=path.join(output,'all-peers-ready.gate');let released=false;
 const stop=()=>{for(const child of processes)if(child.exitCode===null)child.kill();};
 const starts=new Map(),finishGrace=[];let graceTimer=null;
 const fail=()=>{
  const deadline=released?peerFinishGrace({now:Date.now(),starts:[...starts.values()],players:plan.players,seconds:config.seconds}):null;
  if(deadline===null){stop();return;}
  if(!graceTimer){finishGrace.push({atWallMs:Date.now(),deadlineWallMs:deadline,reason:'retain-sibling-diagnostics-after-late-peer-failure'});graceTimer=setTimeout(stop,Math.max(0,deadline-Date.now()));}
 };
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop();process.exit(1);});
 // Parent loss must not leave native peers hitting the temporary cloud server.
 const control=createInterface({input:process.stdin,crlfDelay:Infinity});control.on('close',stop);control.on('line',line=>{if(line==='stop')stop();});
 try{
  for(let i=0;i<plan.players;i++){
   // SSH forwards bytes transparently. Origin must match the local URL Host
   // sent by fetch, not the destination server's private listening port.
   const peerBase=direct?config.publicOrigin:'http://127.0.0.1:'+config.ports[i];
   const child=fork(path.join(path.dirname(self),'network-room-peer-v5.mjs'),['--root='+root,'--assets='+assets,
    '--base='+peerBase,'--origin='+peerBase,...(direct?['--path-prefix='+config.pathPrefix]:[]),'--account-file='+config.accountFile,'--index='+(i+1),
    '--mode='+plan.peerModes[i],'--ready-file='+gate,'--skills=cycle','--seconds='+config.seconds,
    '--profession='+config.professions[i%config.professions.length],'--configure-loadout=true','--output='+path.join(output,`peer-${i}.json`)],
    {cwd:root,execArgv:config.peerLocalAddress?['--import='+pathToFileURL(path.join(path.dirname(self),'network-bound-egress-v5.mjs')).href]:[],
     env:{...process.env,...(config.peerLocalAddress?{RF_DIAGNOSTIC_LOCAL_ADDRESS:config.peerLocalAddress,RF_DIAGNOSTIC_UNDICI_MODULE:config.undiciModule}:{})},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});processes.push(child);
   processPriorities.push({name:'peer-'+i,...(Number.isSafeInteger(child.pid)?setCapacityProcessPriority('above-normal',child.pid):{policy:'above-normal',error:'Child PID unavailable',actualPriority:null})});
   child.stdout.pipe(createWriteStream(path.join(output,`peer-${i}.stdout.log`)));child.stderr.pipe(createWriteStream(path.join(output,`peer-${i}.stderr.log`)));
   child.on('message',message=>{if(!['resources-ready','simulation-started'].includes(message?.type))return;lifecycle.push({index:i,...message});send({type:'peer-progress',index:i,...message});
    if(message.type==='simulation-started')starts.set(i,message.atWallMs);
    if(message.type==='resources-ready'){resourceReady.add(message.playerId);if(resourceReady.size===plan.players&&!released){released=true;void writeFile(gate,'ready\n',{flag:'wx'}).then(()=>send({type:'all-ready-released'})).catch(error=>{send({type:'fatal',message:error.message});stop();});}}
   });
   exits.push(new Promise(resolve=>{child.once('error',error=>{send({type:'peer-error',index:i,message:error.message});resolve({name:'peer-'+i,code:1});stop();});
    child.once('exit',(code,signal)=>{resolve({name:'peer-'+i,code,signal});if(code!==0||!released)fail();});}));
  }
  await save(path.join(output,'local-priorities.json'),processPriorities);
  const peerExit=await Promise.race([Promise.all(exits),timeout((config.seconds+200)*1000,'Cloud peer run timed out')]);
  const after=await sourceSeal(root),measurementAfter=await toolSeal(path.dirname(path.dirname(self))),
   resourcesAfter=await verifyResources(root,assets,(await readJson(path.join(output,'local-before.json'))).resources);
  const dispatcherAfter=config.peerLocalAddress?await sealDispatcher(config.undiciModule):null;
  await save(path.join(output,'local-final.json'),{localEgress:{address:config.peerLocalAddress??null,dispatcherBefore,dispatcherAfter,unchanged:dispatcherBefore?.sha256===dispatcherAfter?.sha256},peerExit,lifecycle,finishGrace,processPriorities,sourceBefore:before,sourceAfter:after,resourcesAfter,
   sourceUnchanged:before.rawSha256===after.rawSha256,measurementBefore,measurementAfter,measurementUnchanged:measurementBefore.sha256===measurementAfter.sha256});
  send({type:'peers-complete',peerExit});if(peerExit.some(row=>row.code!==0))process.exitCode=1;
 }finally{clearTimeout(graceTimer);stop();control.close();process.stdin.destroy();clearDeadlines();}
}else if(args.role==='summary'){
 const config=await readJson(path.join(output,'experiment.json')),local=await readJson(path.join(output,'local-final.json')),
  cloud=await readJson(path.join(output,'cloud-final.json')),before=await readJson(path.join(output,'cloud-before.json')),
  server=await readJson(path.join(output,'server.json')),direct=config.dataTransport==='direct-nginx',
  tunnel=direct?null:await readJson(path.join(output,'tunnel.json')),plan=parseRoomPlan(config.rooms),peers=[];
 for(let i=0;i<plan.players;i++)try{peers.push(await readJson(path.join(output,`peer-${i}.json`)));}catch(e){peers.push({error:e.message});}
 const generated=new Map(peers.flatMap(p=>p.generatedReports??[]).map(row=>[`${row.playerId}/${row.epoch}/${row.frameSeq}`,row.generatedAtWallMs]));
 const rows=[];for(const peer of peers)for(const row of peer.receivedReports??[]){const at=generated.get(`${row.playerId}/${row.epoch}/${row.frameSeq}`);if(at!==undefined)rows.push({
  source:row.playerId,sink:peer.playerId,epoch:row.epoch,frameSeq:row.frameSeq,generatedAtWallMs:at,acceptedAtWallMs:row.acceptedAtWallMs,ms:row.acceptedAtWallMs-at,applied:row.applied});}
 const concurrency=summarizeRoomOverlap({plan,peers,receiveRows:rows,minimumOverlapSeconds:Math.max(0,config.seconds-15)});
 // Server-time phase selection uses only server samples and server incoming
 // timestamps; never join the cloud's wall clock to Windows timestamps.
 const first=server.incoming.filter(r=>r.accepted&&!r.ignored).reduce((m,r)=>Math.min(m,r.receivedAtWallMs),Infinity);
 const last=server.incoming.filter(r=>r.accepted&&!r.ignored).reduce((m,r)=>Math.max(m,r.receivedAtWallMs),-Infinity);
 const samples=server.samples.filter(s=>s.atWallMs>=first&&s.atWallMs<=last),workers=s=>s.transport?.roomWorkers?.workers??[];
 const integrity=assessMeasurementIntegrity({concurrency,peers,peerExit:local.peerExit,drops:server.drops,
  sourceUnchanged:local.sourceUnchanged&&cloud.sourceUnchanged,measurementUnchanged:local.measurementUnchanged&&cloud.measurementUnchanged&&config.remoteToolsVerified&&config.launcherUnchanged});
 if(config.peerLocalAddress&&!local.localEgress?.unchanged){integrity.passed=false;integrity.failures.push('diagnostic-dispatcher-changed');}
 if(tunnel?.errors.length){integrity.passed=false;integrity.failures.push('ssh-forwarding-errors');}
 if(direct){
  const route=await readJson(path.join(output,'direct-route.json')),transfer=await readJson(path.join(output,'transfer.json'));
  if(config.sshDataTransportCount!==0||config.sshControlTransportSeparate!==true||route.installed?.phase!=='active'
   ||route.removed?.phase!=='removed'||!route.removed?.exactMarkerRemoved||!route.removed?.routeFileDisabled
   ||route.removed?.markerResiduePresent!==false||!route.verified?.installed?.diagnosticMarkerPresent||route.verified?.removed?.diagnosticMarkerPresent!==false){
   integrity.passed=false;integrity.failures.push('direct-route-lifecycle-not-confirmed');
  }
  if(!transfer.complete||!transfer.files?.length||transfer.files.some(row=>!row.verified)){
   integrity.passed=false;integrity.failures.push('diagnostic-transfer-not-verified');
  }
 }
 if(cloud.reason!=='requested'){integrity.passed=false;integrity.failures.push('cloud-server-not-stopped-normally');}
 if(cloud.currentReleaseNow!==cloud.fixedRelease){integrity.passed=false;integrity.failures.push('public-release-changed-during-run');}
 if(cloud.errors?.length){integrity.passed=false;integrity.failures.push('cloud-final-seal-error');}
 if(!local.resourcesAfter?.unchanged||!cloud.resourcesAfter?.unchanged){integrity.passed=false;integrity.failures.push('combat-resources-changed-during-run');}
 const priorityNames=['ssh-forwarding-coordinator','native-peer-coordinator',...Array.from({length:plan.players},(_,i)=>'peer-'+i)],
  processPriorities=local.processPriorities??[];
 if(config.localPriorityPolicy!=='above-normal'||processPriorities.length!==priorityNames.length||priorityNames.some(name=>{
  const rows=processPriorities.filter(row=>row.name===name);return rows.length!==1||rows[0].policy!=='above-normal'||rows[0].error
   ||!Number.isSafeInteger(rows[0].requestedPriority)||rows[0].actualPriority!==rows[0].requestedPriority;
 })){integrity.passed=false;integrity.failures.push('local-above-normal-priority-not-confirmed');}
 const sshDataTransports=direct?null:config.sshDataTransports??'1',separateSsh=direct||sshDataTransports==='players',
  dataTransportCount=direct?0:separateSsh?plan.players:1;
 // Old single-SSH receipts predate explicit topology metadata. Never relabel
 // them as independent transports; new runs must carry matching evidence.
 if(!direct&&(!['1','players'].includes(sshDataTransports)||config.sshDataTransports!==undefined
  &&(config.sshDataTransportCount!==dataTransportCount||config.sshControlTransportSeparate!==separateSsh
   ||tunnel.topology?.dataTransportCount!==dataTransportCount||tunnel.topology?.controlSharesDataTransport!==!separateSsh))){
  integrity.passed=false;integrity.failures.push('ssh-data-topology-mismatch');
 }
 const sharedWire=direct?null:summarizeSharedWire(tunnel.bins,concurrency.startWallMs,concurrency.endWallMs);
 if(sharedWire)sharedWire.scope='SSH channel payload observed on Windows; includes HTTP/SSE/WebSocket framing, excludes SSH encryption/TCP/IP/retransmission overhead';
 const result={schema:direct?'cloud-network-rooms-v5-direct-nginx-native-peers':'cloud-network-rooms-v5-ssh-isolated-native-peers',integrity,concurrency,sharedWire,
  method:{rooms:config.rooms,players:config.players,seconds:config.seconds,professions:config.professions,host:config.host,
   sshDataTransports,sshDataTransportCount:dataTransportCount,sshControlTransportSeparate:separateSsh,
   localEgress:local.localEgress??null,dataTransport:direct?'direct-nginx':'ssh',sshTotalConnectionCount:direct?1:separateSsh?plan.players+1:1,sshTopologyReceipt:tunnel?.topology??null,
   sharedWireMeasurement:direct?'Not measured: direct HTTP/SSE/WS have no SSH payload byte observer. Server generated bytes are not NIC wire throughput.':'SSH channel observer',
   localPriorityPolicy:config.localPriorityPolicy,cloudPriorityPolicy:'unchanged; no nice or process-priority adjustment',
   expectedRelease:config.expectedRelease,expectedBuildSha256:config.expectedBuildSha256,
   deployedHostProgramSha256:config.deployedHostProgramSha256,inputParity:config.inputParity,
   realCloudServer:true,realSshWan:!direct,realPublicNginx:direct,normalGameRules:true,rendered:false,rtc:false,
   clock:'all end-to-end source and receiver times originate on the same Windows host; cloud CPU uses only cloud-local intervals',
   limitations:['All peers originate from one Windows machine and network.',direct
    ?'Normal independent HTTP/SSE/WS TCP connections traverse a temporary public Nginx API route to the isolated server; SSH carries control only.'
    :separateSsh
    ?'Each player has a separate pinned SSH TCP data connection and control uses another connection. That player\'s HTTP/SSE/WS channels still share its encrypted TCP stream; per-player head-of-line blocking and encryption differ from direct Nginx traffic.'
    :'SSH channels share one encrypted TCP connection; added head-of-line blocking and encryption differ from direct Nginx traffic.',
    direct?'No rendering, RTC/NAT, independent regional routes, or resource downloads are measured.':'No Nginx, CDN, cold-browser downloads, rendering, RTC/NAT, or independent regional routes are measured.',
    'No synthetic delay or bandwidth cap; actual cloud uplink and live neighboring processes remain part of this experiment.',
    'Cloud CPU/RSS are ordinary temporary processes, not the production systemd cgroup; host totals include the live service and SSH.',
    'Integrity pass is not a latency acceptance threshold.']},
  seals:{localSourceBefore:local.sourceBefore.rawSha256,localSourceAfter:local.sourceAfter.rawSha256,
   cloudSourceBefore:before.source.rawSha256,cloudSourceAfter:cloud.sourceAfter?.rawSha256,
   localToolsBefore:local.measurementBefore.sha256,localToolsAfter:local.measurementAfter.sha256,
   cloudToolsBefore:cloud.measurementBefore.sha256,cloudToolsAfter:cloud.measurementAfter?.sha256},
  resourceSeals:{local:local.resourcesAfter,cloud:cloud.resourcesAfter},
  localProcessPriorities:processPriorities,
  endToEndMs:distribution(rows.map(r=>r.ms)),actuallyAppliedEndToEndMs:distribution(rows.filter(r=>r.applied).map(r=>r.ms)),
  activity:{hits:peers.reduce((n,p)=>n+(p.stats?.hits??0),0),skills:peers.reduce((n,p)=>n+(p.stats?.skillStarted??0),0),validOwnerReports:server.validOwnerReports},
  cloudServer:{sampleScope:'first to last cloud-accepted owner report; may include non-overlapping room warmup or logout tails',
   hostCpuPercent:distribution(cloud.hostSamples?.filter(s=>s.atWallMs>=first&&s.atWallMs<=last).map(s=>s.cpuPercent)??[]),
   hostFreeMemoryBytes:distribution(cloud.hostSamples?.filter(s=>s.atWallMs>=first&&s.atWallMs<=last).map(s=>s.freeMemoryBytes)??[]),
   parentCpuPercent:distribution(samples.map(s=>s.cpuPercent)),parentAndRoomCpuPercent:distribution(samples.map(s=>s.cpuPercent+workers(s).reduce((n,w)=>n+(w.cpuPercent??0),0))),
   parentAndRoomRssBytes:distribution(samples.map(s=>s.rssBytes+workers(s).reduce((n,w)=>n+(w.rssBytes??0),0))),
   parentEventLoopP95Ms:distribution(samples.map(s=>s.eventLoopP95Ms)),activeRoomWorkers:distribution(samples.map(s=>workers(s).length)),
   workerRpcMs:distribution(server.incoming.filter(r=>r.accepted&&!r.ignored).map(r=>r.resolvedAtWallMs-r.receivedAtWallMs)),drops:server.drops},
  peers:peers.map(p=>({playerId:p.playerId,seconds:p.seconds,errors:p.errors,stats:p.stats,sourceCadence:p.sourceCadence,transport:p.transport})),evidenceSha256:{}};
 for(const file of ['server.json','cloud-before.json','cloud-final.json','local-final.json',...(direct?['direct-route.json','transfer.json','transfer-manifest.json']:['tunnel.json']),...peers.map((_,i)=>`peer-${i}.json`)]){
  try{result.evidenceSha256[file]=sha(await readFile(path.join(output,file)));}catch(e){if(e.code!=='ENOENT')throw e;result.evidenceSha256[file]=null;}
 }
 await save(path.join(output,'result.json'),result);send({output,integrity,concurrency,cloudServer:result.cloudServer});if(!integrity.passed)process.exitCode=1;
}else throw Error('Unknown cloud bridge role');
