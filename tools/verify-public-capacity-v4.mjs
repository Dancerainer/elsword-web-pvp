/** One explicitly selected ordinary account; no matching, input or persistent writes. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createNodeOnlineSocketClass} from './node-online-socket.mjs';
import {ONLINE_SOCKET_PROTOCOL} from '../apps/server/websocket-stream.mjs';
import {PROFESSION_IDS} from '../packages/professions/catalog.mjs';

const DEFAULT_SAMPLES=Object.freeze(['rf/manifest.json','lk/manifest.json','lk/fx/index.json',
  'vc/manifest.json','vc/runtime-pose.json','vc/fx/index.json','common-buffs/manifest.json',
  'native/manifest.json','scene/sander-garpai-rock-pvp/manifest.json','map-mechanics/index.json']);
const MAP_INDEX='map-mechanics/index.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireValue=(condition,code)=>{if(!condition)throw Error(code);};
const parseJson=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const assetPath=name=>typeof name==='string'&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes(':')
  &&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function mapRuntimeDependencies(index,expected){
  requireValue(index?.schemaVersion===1&&record(index.templates)&&record(index.audio), 'probe-map-index-invalid');
  const templates=Object.values(index.templates),audio=Object.values(index.audio);
  requireValue(templates.length>0&&templates.length<=1024&&audio.length>0&&audio.length<=64,'probe-map-index-invalid');
  const categories={glb:new Set(),pose:new Set(),texture:new Set(),audio:new Set()},all=new Set();
  const add=(kind,file,extension)=>{
    requireValue(assetPath(file)&&file.length<=512&&!/[%?#\u0000-\u001f\u007f]/.test(file)
      &&file.split('/').every(part=>!part.startsWith('.')&&!/^(?:sources?|proofs?|evidence|receipts?|contracts|superseded|generated)(?:$|[-_])/i.test(part))
      &&extension.test(file),'probe-map-dependency-path-invalid');
    const name='map-mechanics/'+file;
    requireValue(Object.hasOwn(expected,name),'probe-map-dependency-missing:'+name);
    categories[kind].add(name);all.add(name);
    requireValue(all.size<=4096,'probe-map-dependency-limit');
  };
  for(const template of templates){
    requireValue(record(template)&&record(template.textures),'probe-map-index-invalid');
    if(Object.hasOwn(template,'glb'))add('glb',template.glb,/\.glb$/i);
    if(Object.hasOwn(template,'poseData'))add('pose',template.poseData,/\.json$/i);
    const textures=Object.values(template.textures);requireValue(textures.length<=256,'probe-map-index-invalid');
    for(const texture of textures){requireValue(record(texture),'probe-map-index-invalid');add('texture',texture.file,/\.png$/i);}
  }
  for(const clip of audio){requireValue(record(clip),'probe-map-index-invalid');add('audio',clip.file,/\.(?:ogg|wav)$/i);}
  const sorted=Object.fromEntries(Object.entries(categories).map(([kind,names])=>[kind,[...names].sort()]));
  requireValue(Object.values(sorted).every(names=>names.length>0),'probe-map-runtime-category-missing');
  return {dependencies:[...all].sort(),categories:sorted,samples:Object.values(sorted).map(names=>names[0])};
}

export async function verifyPublicCapacity({base,origin=base,credentials,deployment,timeoutMs=15000,
  samples=DEFAULT_SAMPLES,professions=['RF','LK','VC'],ownedDelta=2,roomCapacity=null,
  fetch:requestFetch=globalThis.fetch,SocketFactory=createNodeOnlineSocketClass}={}) {
  const baseUrl=new URL(base),originUrl=new URL(origin);
  requireValue(['http:','https:'].includes(baseUrl.protocol)&&baseUrl.origin===base
    &&['http:','https:'].includes(originUrl.protocol)&&originUrl.origin===origin,'invalid-probe-origin');
  requireValue(typeof credentials?.username==='string'&&credentials.username.length>0
    &&typeof credentials.password==='string'&&credentials.password.length>0,'explicit-private-credentials-required');
  requireValue(credentials.role===undefined||credentials.role==='player','ordinary-probe-account-required');
  requireValue(deployment?.schemaVersion===1&&/^[a-f0-9]{64}$/.test(deployment.bundleSha256)
    &&deployment.files&&typeof deployment.files==='object'&&!Array.isArray(deployment.files),'invalid-probe-deployment');
  const expected=deployment.files,entries=Object.entries(expected);
  requireValue(Array.isArray(professions)&&professions.length>0&&professions.every(id=>PROFESSION_IDS.includes(id))
    &&[2,3].includes(ownedDelta),'invalid-probe-professions-or-protocol');
  requireValue(entries.length>0&&entries.every(([name,digest])=>assetPath(name)&&/^[a-f0-9]{64}$/.test(digest)),
    'invalid-probe-asset-inventory');
  requireValue(Object.hasOwn(expected,MAP_INDEX),'probe-map-index-missing');
  requireValue(Array.isArray(samples)&&samples.length>0&&samples.length<=32&&samples.every(name=>assetPath(name)&&expected[name]),
    'invalid-probe-asset-samples');
  requireValue(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'invalid-probe-timeout');
  let cookie=null,reader=null,controller=null,socket=null,loggedIn=false,probeFailure=null;
  const verificationAbort=new AbortController(),heartbeatAbort=new AbortController();
  let heartbeatTimer=null,heartbeatTask=null,heartbeatStopped=false,heartbeatFailure=null,heartbeatIntervalMs=null,heartbeatCount=0;
  const requests=[];
  const request=async(relative,{method='GET',body,signal}={})=>{
    // Only transient authentication is writable. Even an accidental caller
    // cannot use this wrapper for matching, input, preferences or GM changes.
    requireValue(method==='GET'||method==='HEAD'||method==='POST'&&['/api/login','/api/logout'].includes(relative),
      'probe-method-denied');
    requireValue(relative.startsWith('/')&&!relative.startsWith('//'),'probe-resource-denied');
    const response=await requestFetch(base+relative,{method,redirect:'error',headers:{Origin:origin,'Accept-Encoding':'gzip',
      ...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:relative==='/api/logout'?(signal??AbortSignal.timeout(timeoutMs))
        :AbortSignal.any([verificationAbort.signal,signal??AbortSignal.timeout(timeoutMs)])});
    requests.push({resource:relative.split('?')[0],method,status:response.status});return response;
  };
  const json=async relative=>{const response=await request(relative);requireValue(response.status===200,'probe-api-status:'+relative);
    return response.json();};
  const startHeartbeat=session=>{
    heartbeatIntervalMs=Math.floor(Math.min(5000,(session.heartbeatSeconds??5)*1000,(session.heartbeatTimeoutSeconds??20)*500));
    requireValue(Number.isFinite(heartbeatIntervalMs)&&heartbeatIntervalMs>=1,'probe-heartbeat-config-invalid');
    const tick=()=>{
      heartbeatTask=(async()=>{
        // Authenticated status reads refresh lastSeen without mutating page
        // generation, matchmaking or preferences. Download chunks do not.
        const response=await request('/api/online/status',{signal:AbortSignal.any([heartbeatAbort.signal,
          AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,heartbeatIntervalMs*2)))])});
        requireValue(response.status===200,'probe-heartbeat-http-failed:'+response.status);
        const status=await response.json();
        requireValue(status.available===true&&!status.match&&!status.queued&&!status.locked,'probe-heartbeat-status-not-idle');
        heartbeatCount++;
      })().catch(error=>{
        if(heartbeatStopped&&heartbeatAbort.signal.aborted&&error?.name==='AbortError')return;
        heartbeatFailure=/^probe-heartbeat-/.test(error.message)?error:Error('probe-heartbeat-request-failed',{cause:error});
        verificationAbort.abort(heartbeatFailure);
      }).finally(()=>{heartbeatTask=null;if(!heartbeatStopped&&!heartbeatFailure)heartbeatTimer=setTimeout(tick,heartbeatIntervalMs);});
    };
    heartbeatTimer=setTimeout(tick,heartbeatIntervalMs);
  };
  const stopHeartbeat=async()=>{
    heartbeatStopped=true;clearTimeout(heartbeatTimer);heartbeatAbort.abort();await heartbeatTask;
  };
  try {
    const login=await request('/api/login',{method:'POST',body:{username:credentials.username,password:credentials.password}});
    requireValue(login.status!==409,'selected-account-already-active');requireValue(login.status===200,'probe-login-failed');
    cookie=login.headers.get('set-cookie')?.split(';')[0];requireValue(/^rf_session=[A-Za-z0-9_-]+$/.test(cookie??''),'probe-session-cookie-missing');
    loggedIn=true;const identity=await login.json();requireValue(identity.role==='player','ordinary-probe-account-required');
    const session=await json('/api/session');requireValue(session.role==='player','probe-session-role-mismatch');
    requireValue(session.username===credentials.username,'probe-session-identity-mismatch');
    requireValue(session.buildVersion===deployment.bundleSha256,'probe-browser-build-mismatch');
    requireValue(session.online?.available===true&&session.onlineEventTransport==='sse','probe-online-sse-unavailable');
    requireValue(!session.online?.match&&!session.online?.queued&&!session.online?.locked,'probe-account-must-be-idle');
    startHeartbeat(session);
    const bundlePath='/game/game.js',bundleResponse=await request(bundlePath+'?v='+deployment.bundleSha256);
    requireValue(bundleResponse.status===200,'probe-browser-bundle-http-failed');
    const bundleBytes=Buffer.from(await bundleResponse.arrayBuffer());
    requireValue(bundleBytes.length<=32*1024*1024,'probe-browser-bundle-too-large');
    requireValue(sha(bundleBytes)===deployment.bundleSha256,'probe-browser-bundle-body-mismatch');
    const browserBundle={path:bundlePath,bytes:bundleBytes.length,sha256:deployment.bundleSha256};
    for(const id of professions)requireValue(session.professions?.[id]===true,'probe-profession-unavailable:'+id);
    const status=await json('/api/online/status');requireValue(status.available===true&&!status.match&&!status.queued&&!status.locked,'probe-status-not-idle');
    if(roomCapacity){
      if(Object.hasOwn(roomCapacity,'maxRoomsByMode')){
        for(const mode of ['1v1','2v2','3v3']){
          const expectedLimit=roomCapacity.maxRoomsByMode?.[mode];
          requireValue(Number.isSafeInteger(expectedLimit)&&expectedLimit>=0&&expectedLimit<=20,'probe-room-capacity-invalid:'+mode);
          requireValue(status.roomCapacity?.maxRoomsByMode?.[mode]===expectedLimit,'probe-room-capacity-mismatch:'+mode);
        }
        for(const key of ['maxActivePlayers','maxActiveRooms'])requireValue(status.roomCapacity?.[key]===null,'probe-room-capacity-global-limit:'+key);
      }else for(const key of ['maxActivePlayers','maxActiveRooms'])requireValue(status.roomCapacity?.[key]===roomCapacity[key],'probe-room-capacity-mismatch:'+key);
    }
    for(const id of professions){const config=await json('/api/skill-preferences?professionId='+id);
      requireValue(config.professionId===id,'probe-profession-preferences-mismatch:'+id);}
    const inventory=await json('/api/asset-versions');requireValue(inventory.schemaVersion===1&&inventory.files,'probe-asset-inventory-missing');
    requireValue(Object.keys(inventory.files).length===entries.length,'probe-asset-inventory-count-mismatch');
    for(const [name,digest]of entries)requireValue(inventory.files[name]===digest,'probe-asset-digest-mismatch:'+name);
    const sampled=[],sampledNames=new Set();let manifest=null,pose=null;
    const sampleAsset=async name=>{
      if(sampledNames.has(name))return null;
      const response=await request('/assets/'+name.split('/').map(encodeURIComponent).join('/')+'?v='+expected[name]);
      requireValue(response.status===200,'probe-asset-http-failed:'+name);
      const bytes=Buffer.from(await response.arrayBuffer());requireValue(bytes.length<=32*1024*1024,'probe-asset-sample-too-large');
      requireValue(sha(bytes)===expected[name],'probe-asset-body-mismatch:'+name);sampled.push({path:name,bytes:bytes.length,sha256:expected[name]});
      sampledNames.add(name);return bytes;
    };
    // The map index is mandatory even when a caller narrows ordinary samples.
    // Source/declaration metadata is evidence, not another runtime dependency.
    const mapBytes=await sampleAsset(MAP_INDEX);requireValue(mapBytes.length<=2*1024*1024,'probe-map-index-too-large');
    const mapClosure=mapRuntimeDependencies(parseJson(mapBytes),expected);
    for(const name of mapClosure.samples)await sampleAsset(name);
    for(const name of samples){
      const bytes=await sampleAsset(name);if(bytes===null)continue;
      if(name==='vc/manifest.json')manifest=parseJson(bytes);if(name==='vc/runtime-pose.json')pose=parseJson(bytes);
    }
    const retainedAnimations=['Fatal','DamageRevenge','SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK'];
    if(manifest&&pose)for(const name of retainedAnimations){
      requireValue(manifest.sharedCharacterAnimations?.clips?.includes(name),'probe-vc-manifest-union-missing:'+name);
      requireValue(pose.sharedClips?.includes(name),'probe-vc-pose-union-missing:'+name);
    }
    await stopHeartbeat();if(heartbeatFailure)throw heartbeatFailure;
    // Keep the authenticated downstream open while negotiating WS. No owner
    // report or synthetic input is sent merely to obtain an ACK.
    controller=new AbortController();const deadline=setTimeout(()=>controller.abort(),timeoutMs);
    let sseGzip=false,proxyBuffering=null;
    try {
      const events=new URL('/api/online/events',base);if(session.pageInitToken)events.searchParams.set('pageInitToken',session.pageInitToken);
      const stream=await request(events.pathname+events.search,{signal:controller.signal});requireValue(stream.status===200,'probe-sse-open-failed');
      requireValue(/^text\/event-stream/.test(stream.headers.get('content-type')??''),'probe-sse-content-type');
      sseGzip=stream.headers.get('content-encoding')==='gzip';proxyBuffering=stream.headers.get('x-accel-buffering');
      requireValue(sseGzip,'probe-sse-gzip-not-negotiated');
      reader=stream.body.getReader();const decoder=new TextDecoder();let text='',data;
      // A network chunk may end halfway through a JSON data line. Only a
      // complete SSE record can establish the authenticated idle status.
      while(data===undefined){const part=await reader.read();requireValue(!part.done,'probe-sse-ended-before-status');
        text+=decoder.decode(part.value,{stream:true});requireValue(text.length<256000,'probe-sse-status-limit');
        const blocks=text.split('\n\n');text=blocks.pop();
        const block=blocks.find(row=>/^event: status$/m.test(row));
        if(block!==undefined){data=block.match(/^data: (.*)$/m)?.[1];requireValue(data,'probe-sse-status-body-missing');}}
      requireValue(data,'probe-sse-status-body-missing');const streamedStatus=JSON.parse(data);
      requireValue(streamedStatus.available===true&&!streamedStatus.match&&!streamedStatus.queued&&!streamedStatus.locked,'probe-sse-status-not-idle');
      const Socket=SocketFactory({base,origin,cookie:()=>cookie});
      const websocket=new URL('/api/online/socket',base);websocket.searchParams.set('textAck','1');websocket.searchParams.set('ownedDelta',String(ownedDelta));
      if(session.pageInitToken)websocket.searchParams.set('pageInitToken',session.pageInitToken);
      const transport=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('probe-ws-transport-deadline')),timeoutMs);
        const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
        socket=new Socket(websocket.pathname+websocket.search,ONLINE_SOCKET_PROTOCOL);
        socket.onerror=()=>finish(Error('probe-ws-handshake-failed'));
        socket.onclose=()=>finish(Error('probe-ws-closed-before-transport'));
        socket.onmessage=event=>{try{const textFrame=typeof event.data==='string';
          const value=JSON.parse(textFrame?event.data:gunzipSync(Buffer.from(event.data),{maxOutputLength:128*1024}).toString('utf8'));
          requireValue(value.type==='transport'&&value.data?.connected===true&&value.data.kind==='websocket','probe-ws-transport-invalid');
          requireValue(textFrame,'probe-ws-text-capability-not-negotiated');finish(null,{handshake:true,textFrame:true});
        }catch{finish(Error('probe-ws-transport-invalid'));}};
      });
      return {schemaVersion:1,verified:true,publicOrigin:origin,buildVersion:session.buildVersion,role:'player',professions,roomCapacity:status.roomCapacity??null,
        browserBundle,
        assetCount:entries.length,allAssetDigestsMatched:true,sampledAssets:sampled,
        mapMechanics:{index:MAP_INDEX,indexSha256:expected[MAP_INDEX],dependencyCount:mapClosure.dependencies.length,
          dependencyInventoryMatched:true,categoryCounts:Object.fromEntries(Object.entries(mapClosure.categories).map(([kind,names])=>[kind,names.length])),
          sampledDependencies:mapClosure.samples},
        vcAnimationUnionChecked:Boolean(manifest&&pose),sse:{namedIdleStatus:true,gzip:sseGzip,proxyBuffering},
        resourceHeartbeat:{method:'GET',resource:'/api/online/status',intervalMs:heartbeatIntervalMs,completed:heartbeatCount},
        websocket:{...transport,protocol:ONLINE_SOCKET_PROTOCOL,requestedCapabilities:{textAck:1,ownedDelta}},
        matchingWrites:0,inputWrites:0,historyWrites:0,preferenceWrites:0,gmWrites:0,requests};
    }finally{clearTimeout(deadline);}
  }catch(error){probeFailure=heartbeatFailure??error;throw probeFailure;
  }finally{
    await stopHeartbeat();const cleanupErrors=[];
    try{socket?.close();}catch(error){cleanupErrors.push(error);}
    controller?.abort();await reader?.cancel().catch(()=>{});
    if(loggedIn)try{const logout=await request('/api/logout',{method:'POST'});requireValue(logout.status===200,'probe-session-cleanup-failed');}
      catch(error){cleanupErrors.push(error);}
    const primary=probeFailure??heartbeatFailure;
    if(cleanupErrors.length)throw new AggregateError(primary?[primary,...cleanupErrors]:cleanupErrors,
      primary?.message??'probe-session-cleanup-failed',{cause:primary??cleanupErrors[0]});
    if(!probeFailure&&heartbeatFailure)throw heartbeatFailure;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);if(args.includes('--help')){
      console.log('Usage: node tools/verify-public-capacity-v4.mjs --base ORIGIN [--origin PUBLIC_ORIGIN] --deployment DEPLOYMENT_JSON --credential-file PRIVATE_SELECTED_PLAYER_JSON');
    }else{
      const options={};for(let i=0;i<args.length;i+=2){requireValue(['--base','--origin','--deployment','--credential-file'].includes(args[i])
        &&args[i+1]&&!Object.hasOwn(options,args[i]),'invalid-probe-arguments');options[args[i]]=args[i+1];}
      requireValue(options['--base']&&options['--deployment']&&options['--credential-file'],'explicit-probe-arguments-required');
      const deployment=parseJson(await readFile(options['--deployment'])),credentials=parseJson(await readFile(options['--credential-file']));
      const result=await verifyPublicCapacity({base:options['--base'],origin:options['--origin']??options['--base'],deployment,credentials});
      console.log(JSON.stringify(result));
    }
  }catch(error){
    // JSON/parser/IO errors may include private input fragments. Only our own
    // fixed diagnostic codes can enter CLI output.
    const code=/^(?:probe-|invalid-probe-|explicit-private-|ordinary-probe-|selected-account-|explicit-probe-)/.test(error.message)
      ?error.message:'probe-unexpected-failure';
    console.error(JSON.stringify({verified:false,error:code}));process.exitCode=1;
  }
}
