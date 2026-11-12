/** One headless native peer for a real browser on another network address.
 * This is simulation/transport evidence; this peer has no GPU or browser RTC.
 * Credentials are read from a private file, never printed or saved in results.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createPeerInputController,createFightFileGate} from './network-peer-controls.mjs';
import {createNodeOnlineSocketClass} from './node-online-socket.mjs';
import {createHttpEventSourceClass} from './http-event-source-peer.mjs';

/** Build from the selected server asset closure just like the room driver.
 * createSimulation is supplied by --root; do not bind this diagnostic tool to
 * its own checkout's executor or weaken the snapshot's identity checks. */
export async function createNetworkPeerSimulation({assets,createSimulation,match,snapshot,localPlayerId}){
  const selected=await assets.forScene(match.sceneId),{native,samplers}=await selected.createRuntime();
  const sim=createSimulation({profile:selected.profile,profiles:selected.profiles,map:selected.map,
    preset:{...selected.preset,onlineMatch:true},
    presets:Object.fromEntries(Object.entries(selected.presets).map(([id,preset])=>[id,{...preset,onlineMatch:true}])),
    commonBuffs:selected.commonBuffs,seed:match.seed,networkOwnerId:localPlayerId,
    actors:snapshot.actors.map(actor=>({id:actor.id,team:actor.team,position:[actor.x,actor.y,actor.z],
      lineId:actor.lineId,facing:actor.facing,loadout:actor.loadout,professionId:actor.professionId,profileId:actor.profileId})),...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:snapshot.versions});
  sim.restore(snapshot);return sim;
}

export async function runNetworkMatchPeer(argv=process.argv.slice(2)){
const args=Object.fromEntries(argv.map(arg=>{const cut=arg.indexOf('=');if(!arg.startsWith('--')||cut<0)throw Error('Use --name=value');return [arg.slice(2,cut),arg.slice(cut+1)];}));
const root=path.resolve(args.root??fileURLToPath(new URL('../',import.meta.url)));
const base=args.base??'http://127.0.0.1:4228',origin=args.origin??base;
const seconds=Number(args.seconds??75),index=Number(args.index??-1);
if(!args['account-file']||!Number.isFinite(seconds)||seconds<10||seconds>600)throw Error('Private account-file and 10–600 seconds required');
const mode=args.mode??'1v1';if(!['1v1','2v2','3v3'].includes(mode))throw Error('Mode must be 1v1, 2v2 or 3v3');
const skills=args.skills??(mode!=='1v1'?'cycle':'off');if(!['cycle','off'].includes(skills))throw Error('Skills must be cycle or off');
const eventTransport=args.events??'sse';if(!['sse','poll'].includes(eventTransport))throw Error('Events must be sse or poll');
const transportDiagnostics=args['transport-diagnostics']==='on'?{failedResponses:[],requestErrors:[]}:null;
const fightFile=args['fight-file']?path.resolve(args['fight-file']):null;
const readyFile=args['ready-file']?path.resolve(args['ready-file']):null;
const controls=createPeerInputController({mode,skills:skills==='cycle'});
const contents=JSON.parse((await readFile(args['account-file'],'utf8')).replace(/^\uFEFF/,''));
const credential=index>=0?contents.accounts[index]:contents;
if(!credential?.username||!credential?.password)throw Error('Account index not present');
const moduleFor=relative=>import(pathToFileURL(path.join(root,relative)).href);
const [{loadServerCombatAssets},{createSimulation},{createLocalOwnershipSync},{createOnlineClient}]=await Promise.all([
  moduleFor('packages/combat-assets/server-assets.mjs'),moduleFor('packages/combat-core/index.mjs'),
  moduleFor('apps/web/input-prediction.mjs'),moduleFor('apps/web/online-client.mjs')]);
const assets=await loadServerCombatAssets({root,assetRoot:path.resolve(args.assets??path.join(root,'artifacts'))});
let cookie,match=null,sim=null,room=null,client,done=false,startedAt=null,fightStartedAt=null,heartbeat=null,lastTick=null,nextTickAt=null,finalTransport=null;
let gate={open:true,close(){}},readyGate={open:true,close(){}},readyTask=Promise.resolve();
const sync=createLocalOwnershipSync(),samples=[],errors=[],requests=[],progress=[],tickWork=[],receiveWork=[],parseWork=[],generatedReports=[],receivedReports=[],lifecycle=[];
let configuredLoadout=null;
const loopDelay=monitorEventLoopDelay({resolution:10});loopDelay.enable();let cpuAt=process.cpuUsage(),cpuTimeAt=performance.now();
const stats={ticks:0,reports:0,retainedPoseReports:0,states:0,hits:0,bytesSent:0,maxRequestBytes:0,maxTickGapMs:0,maxStateGapMs:0,
  ownerActionPackets:0,ownerActionSamples:0,skillInputs:0,skillStarted:0,skillRejected:0,inputPresses:{},startedSkills:{},rejectedSkills:{}};
let lastStateAt=null,lastProgressAt=performance.now(),lastRequestIndex=0;
async function transport(url,options={}){
  const started=performance.now(),bytes=Buffer.byteLength(options.body??'');
  let response;
  try{response=await fetch(base+url,{...options,headers:{Origin:origin,Host:new URL(origin).host,...options.headers,...(cookie?{Cookie:cookie}:{})}});}
  catch(error){if(transportDiagnostics&&url.startsWith('/api/online/poll'))transportDiagnostics.requestErrors.push({atMs:performance.now(),route:url.split('?')[0],error:error.message,cause:error.cause?.code??null});throw error;}
  if(transportDiagnostics&&!response.ok&&url.startsWith('/api/online/poll')){
    let code;try{code=(await response.clone().json()).error;}catch{code='unreadable-error-response';}
    transportDiagnostics.failedResponses.push({atMs:performance.now(),route:url.split('?')[0],status:response.status,error:code});
  }
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  if(url==='/api/online/input'){stats.bytesSent+=bytes;stats.maxRequestBytes=Math.max(stats.maxRequestBytes,bytes);requests.push({atMs:started,ms:performance.now()-started,bytes,status:response.status});}
  return response;
}
async function api(url,method='GET',body){const response=await transport(url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok){const error=Error(url+': '+response.status+' '+value.error);error.status=response.status;throw error;}return value;}
function recordError(error){errors.push({atMs:performance.now(),atWallMs:Date.now(),message:error.message});console.error(error.message);if(error.status===401)done=true;}
const HttpEventSource=createHttpEventSourceClass({request:transport,onParseCpu:ms=>parseWork.push(ms)});
async function event(type,value){
  if(type==='match'){match=value;await client.setMatch(match,credential.username);console.log('Headless peer assigned to '+mode+'; waiting for browser resources.');}
  if(type==='owner-actions'&&match&&value.matchId===match.id){
    sync.receiveActions(value.playerId,value.actions,value.epoch,value.frameSeq);stats.ownerActionPackets++;stats.ownerActionSamples+=value.actions.length;
  }
  if(type==='peer-owned-state'&&sim&&match){const applied=sync.receivePeer(sim,value.playerId,value.report,credential.username);
    receivedReports.push({playerId:value.playerId,epoch:value.report.epoch,frameSeq:value.report.frameSeq,acceptedAtWallMs:Date.now(),applied});}
  if(type==='state'){
    const now=performance.now();stats.states++;if(lastStateAt!==null)stats.maxStateGapMs=Math.max(stats.maxStateGapMs,now-lastStateAt);lastStateAt=now;room=value.pvp;
    if(!sim){sim=await createNetworkPeerSimulation({assets,createSimulation,match,snapshot:value.snapshot,localPlayerId:credential.username});
      sync.reconcile(sim,value,credential.username);
      readyTask=(async()=>{while(!readyGate.open&&!done){sampleProgress(performance.now(),'ready-gate');await readyGate.wait(5000);}if(!done)await client.ready(match.id);})().catch(recordError);
    }else sync.reconcile(sim,value,credential.username);
    if(room.phase==='fight'&&fightStartedAt===null){fightStartedAt=performance.now();console.log(mode+' room fight started'+(gate.open?'.':'; waiting for browser launch file.'));}
  }
  if(['disconnect','result','server-error'].includes(type))lifecycle.push({type,value,atWallMs:Date.now()});
  if(type==='disconnect'&&value.playerId===credential.username)done=true;
  if(type==='result'&&match&&value.matchId===match.id){done=true;console.log(mode+' result received.');}
}
let stateChain=Promise.resolve();
const percentile=(rows,p)=>rows.length?[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.floor(rows.length*p))]:null;
function sampleProgress(now,waiting=null){
  if(now-lastProgressAt<5000)return;
  const posts=requests.slice(lastRequestIndex),history=sync.actionDiagnostics??null;
  const usage=process.cpuUsage(cpuAt),cpuElapsed=now-cpuTimeAt;cpuAt=process.cpuUsage();cpuTimeAt=now;
  const row={elapsedMs:startedAt===null?null:now-startedAt,waiting,phase:room?.phase??null,ticks:stats.ticks,
    completedUploads:{count:posts.length,bytes:posts.reduce((sum,row)=>sum+row.bytes,0),p50Bytes:percentile(posts.map(row=>row.bytes),.5),maxBytes:posts.length?Math.max(...posts.map(row=>row.bytes)):0,p95Ms:percentile(posts.map(row=>row.ms),.95)},
    upload:client?.performance?.()??null,history,body:sync.bodyDiagnostics??null,tickCpu:{samples:tickWork.length,p50Ms:percentile(tickWork,.5),p95Ms:percentile(tickWork,.95),maxMs:tickWork.length?Math.max(...tickWork):0},
    receiveCpu:{samples:receiveWork.length,p95Ms:percentile(receiveWork,.95),maxMs:receiveWork.length?Math.max(...receiveWork):0},
    parseCpu:{samples:parseWork.length,p95Ms:percentile(parseWork,.95),maxMs:parseWork.length?Math.max(...parseWork):0},
    process:{cpuPercent:(usage.user+usage.system)/1000/cpuElapsed*100,rssBytes:process.memoryUsage().rss,eventLoopP95Ms:loopDelay.percentile(95)/1e6,eventLoopMaxMs:loopDelay.max/1e6},
    eventSources:HttpEventSource.instances.map(source=>({...source.metrics})),
    skillInputs:stats.skillInputs,skillStarted:stats.skillStarted,skillRejected:stats.skillRejected,inputPresses:{...stats.inputPresses},effects:sim?.state.effects.length??0};
  progress.push(row);console.log(JSON.stringify({peerProgress:row}));tickWork.length=0;receiveWork.length=0;parseWork.length=0;loopDelay.reset();lastRequestIndex=requests.length;lastProgressAt=now;
}
try{
  gate=await createFightFileGate(fightFile);
  readyGate=await createFightFileGate(readyFile);
  await api('/api/login','POST',credential);
  if(args.profession)await api('/api/preferences/profession','POST',{professionId:args.profession});
  if(args['configure-loadout']==='true'){
    const professionId=args.profession??'RF',profile=assets.profiles[professionId],preset=assets.presets[professionId],{normalize}=await moduleFor('apps/server/skill-preferences.mjs');
    const preferred=professionId==='RF'?[24008,24027,24009,24204,24217,24219,24203,24206]:[];let loadout=Array(8).fill(null),slot=0;
    for(const skillId of [...preferred,...profile.skillCatalog.map(row=>row.skillId)]){
      if(slot===8)break;const candidate=[...loadout];candidate[slot]={skillId,branchId:'none'};
      try{loadout=normalize({loadout:candidate,branchChoices:{}},profile,preset).loadout;slot++;}catch(error){if(!(error instanceof RangeError))throw error;}
    }
    if(!slot)throw Error('No legal active skills found for diagnostic player');
    await api('/api/skill-preferences','PUT',{schemaVersion:1,professionId,loadout,branchChoices:{}});configuredLoadout=loadout;
    console.log(JSON.stringify({configuredSkills:loadout.map(row=>row?.skillId??null)}));
  }
  client=createOnlineClient({fetch:transport,EventSource:HttpEventSource,eventTransport,RTCPeerConnection:null,
    WebSocket:args.relay==='off'?null:createNodeOnlineSocketClass({base,origin,cookie:()=>cookie}),onError:recordError,
    onEvent:(type,value)=>{const receivedAtWallMs=Date.now();stateChain=stateChain.then(async()=>{const began=performance.now(),countBefore=receivedReports.length;await event(type,value);receiveWork.push(performance.now()-began);
      if(type==='peer-owned-state'&&receivedReports.length>countBefore)receivedReports.at(-1).dispatchedAtWallMs=receivedAtWallMs;
    }).catch(error=>{recordError(error);done=true;});}});
  await client.open();await client.join(mode);heartbeat=setInterval(()=>api('/api/heartbeat','POST').catch(recordError),5000);
  console.log('Native headless peer queued at '+base+'; no browser RTC.');
  const deadline=performance.now()+Math.max(180,seconds+60)*1000;
  while(!done&&(startedAt!==null||performance.now()<deadline)){
    const now=performance.now();if(startedAt!==null&&now-startedAt>=seconds*1000)break;
    if(!sim||fightStartedAt===null){sampleProgress(now,'queue-or-loading');await new Promise(resolve=>setTimeout(resolve,1000));continue;}
    if(!gate.open){sampleProgress(now,'browser-launch-file');await gate.wait(5000);continue;}
    if(startedAt===null){startedAt=performance.now();lastTick=null;nextTickAt=null;console.log(mode+' peer simulation started; skills '+skills+'.');}
    if(sim&&startedAt!==null&&['fight','slow'].includes(room?.phase)){
      try{
        const cpuStart=performance.now();
        if(lastTick!==null)stats.maxTickGapMs=Math.max(stats.maxTickGapMs,now-lastTick);lastTick=now;
        const {input,skillAttempt}=controls.next(sim,credential.username,{phase:room.phase,elapsed:(now-startedAt)/1000});
        for(const key of input.pressed)stats.inputPresses[key]=(stats.inputPresses[key]??0)+1;
        if(skillAttempt)stats.skillInputs++;
        sync.beforeStep(sim,credential.username);sim.step(room.phase==='slow'?1/300:1/60,{[credential.username]:input},{snapshot:false});
        const events=sim.drainEvents();stats.hits+=events.filter(event=>event.type==='hit').length;
        for(const e of events)if(e.actorId===credential.username){
          if(e.type==='skillStarted'){stats.skillStarted++;stats.startedSkills[e.skillId]=(stats.startedSkills[e.skillId]??0)+1;}
          if(e.type==='skillRejected'){stats.skillRejected++;const key=e.reason??'unknown';stats.rejectedSkills[key]=(stats.rejectedSkills[key]??0)+1;}
        }
        const report=sync.afterStep(sim,credential.username,events);if(report){const generatedAtWallMs=Date.now(),wireFrame=client.send(input,report);stats.reports++;
          generatedReports.push({playerId:credential.username,epoch:report.epoch,frameSeq:wireFrame,generatedAtWallMs});
          if(report.actor.presentationTransition?.retainedPose)stats.retainedPoseReports++;}stats.ticks++;tickWork.push(performance.now()-cpuStart);
        if(stats.ticks%60===0)samples.push({elapsedMs:now-startedAt,phase:room.phase,actors:sim.state.actors.map(row=>({id:row.id,x:row.x,y:row.y,state:row.state,hp:row.hp})),effects:sim.state.effects.length});
      }catch(error){recordError(error);break;}
    }
    sampleProgress(performance.now());
    nextTickAt=(nextTickAt??performance.now())+1000/60;
    if(performance.now()-nextTickAt>100)nextTickAt=performance.now();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextTickAt-performance.now())));
  }
  if(startedAt===null)recordError(Error(mode+' peer did not start before the queue/loading/launch deadline'));
}catch(error){recordError(error);throw error;}finally{
  const simulationSeconds=startedAt===null?0:(performance.now()-startedAt)/1000;
  done=true;gate.close();readyGate.close();clearInterval(heartbeat);loopDelay.disable();finalTransport=client?.performance?.()??null;client?.close();await readyTask;await stateChain;if(cookie)await api('/api/logout','POST').catch(recordError);
  const report={schemaVersion:1,evidenceClass:'headless-native-authenticated-socket-with-http-sse-fallback-peer',originalClientMeasured:false,rendered:false,rtc:false,
    address:base,origin,sourceMachine:args.label??process.platform,seconds:startedAt===null?0:(performance.now()-startedAt)/1000,
    matchMode:match?.mode,requestedMode:mode,skillPolicy:skills,eventTransport,browserLaunchGate:!!fightFile,readyGate:!!readyFile,roomFightWaitSeconds:fightStartedAt===null||startedAt===null?null:(startedAt-fightStartedAt)/1000,
    tickCpuScope:'tick covers ownership history + native simulation step + drain + report encode/send; receiveCpu separately includes async reconciliation, parseCpu includes synchronous production dispatch; process CPU includes all work',
    sceneId:match?.sceneId,versions:match?.versions,stats,errors,samples,progress,history:sync.actionDiagnostics??null,body:sync.bodyDiagnostics??null,
    playerId:credential.username,configuredLoadout,sourceCadence:{normalStepSeconds:1/60,simulationSeconds,nativeSteps:stats.ticks,sourceReports:stats.reports,
      observedNativeStepsPerSecond:simulationSeconds?stats.ticks/simulationSeconds:0,observedSourceReportsPerSecond:simulationSeconds?stats.reports/simulationSeconds:0},
    generatedReports,receivedReports,lifecycle,eventSources:HttpEventSource.instances.map(source=>({...source.metrics})),
    transport:finalTransport,...(transportDiagnostics?{transportDiagnostics}:{}),upload:{count:requests.length,p50Ms:percentile(requests.map(row=>row.ms),.5),p95Ms:percentile(requests.map(row=>row.ms),.95),maxBytes:stats.maxRequestBytes}};
  const defaultOutput=mode==='1v1'?'runtime/network-match-peer.json':`runtime/network-match-peer-2v2-${index>=0?index:process.pid}.json`;
  const output=path.resolve(args.output??path.join(root,defaultOutput));await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,stats,errors,seconds:report.seconds}));if(errors.length)process.exitCode=1;
}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runNetworkMatchPeer();
