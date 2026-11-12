import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPublicCapacity} from '../../tools/verify-public-capacity-v4.mjs';

function fixture({loginStatus=200,wsText=true,professions=['RF','LK','VC'],ownedDelta=2,roomCapacity=null}={}){
  const credentials={username:'synthetic-selected-player',password:'synthetic-private-fixture',role:'player'},requests=[],sent=[];
  const names=['Fatal','DamageRevenge','SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK'];
  const samples={'vc/manifest.json':Buffer.from(JSON.stringify({sharedCharacterAnimations:{clips:names}})),
    'vc/runtime-pose.json':Buffer.from(JSON.stringify({sharedClips:names})),
    'map-mechanics/meshes/portal.glb':Buffer.from('fixture map GLB bytes'),
    'map-mechanics/meshes/portal.pose.json':Buffer.from(JSON.stringify({clips:[],helpers:{RETURN_POINT:'retained'}})),
    'map-mechanics/textures/a.png':Buffer.from('fixture sampled map texture bytes'),
    'map-mechanics/textures/z.png':Buffer.from('fixture other declared map texture bytes'),
    'map-mechanics/audio/a.ogg':Buffer.from('fixture sampled map OGG bytes'),
    'map-mechanics/audio/z.wav':Buffer.from('fixture other declared map WAV bytes')};
  const mapIndex={schemaVersion:1,version:'fixture-map-not-client-golden',templates:{portal:{
    glb:'meshes/portal.glb',poseData:'meshes/portal.pose.json',textures:{first:{file:'textures/a.png'},other:{file:'textures/z.png'}},
    source:{rawPath:'../native-d3dx/source-proof.json'}}},audio:{first:{file:'audio/a.ogg'},other:{file:'audio/z.wav'}}};
  samples['map-mechanics/index.json']=Buffer.from(JSON.stringify(mapIndex));
  const bundle=Buffer.from('fixture authenticated browser entry bytes');
  const deployment={schemaVersion:1,bundleSha256:createHash('sha256').update(bundle).digest('hex'),files:Object.fromEntries(Object.entries(samples)
    .map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]))};
  const status={available:true,queued:false,locked:false,queue:{size:2,eligibleSize:2},match:null,...(roomCapacity?{roomCapacity}:{})};
  const fetch=async(url,options)=>{
    const pathname=new URL(url).pathname;requests.push({pathname,method:options.method});
    if(pathname==='/api/login')return new Response(JSON.stringify({role:'player'}),{status:loginStatus,headers:{'set-cookie':'rf_session=synthetic_private_cookie'}});
    if(pathname==='/api/logout')return Response.json({ok:true});
    if(pathname==='/api/session')return Response.json({username:credentials.username,role:'player',buildVersion:deployment.bundleSha256,
      professions:Object.fromEntries(professions.map(id=>[id,true])),onlineEventTransport:'sse',online:status});
    if(pathname==='/game/game.js'){
      assert.equal(new URL(url).searchParams.get('v'),deployment.bundleSha256);
      assert.equal(options.headers.Cookie,'rf_session=synthetic_private_cookie');return new Response(bundle);
    }
    if(pathname==='/api/online/status')return Response.json(status);
    if(pathname==='/api/skill-preferences')return Response.json({professionId:new URL(url).searchParams.get('professionId')});
    if(pathname==='/api/asset-versions')return Response.json({schemaVersion:1,files:deployment.files});
    if(pathname==='/api/online/events')return new Response('event: status\ndata: '+JSON.stringify(status)+'\n\n',{headers:{'content-type':'text/event-stream','content-encoding':'gzip'}});
    if(pathname.startsWith('/assets/'))return new Response(samples[pathname.slice(8)]);
    throw Error('Unexpected probe request');
  };
  const SocketFactory=({cookie})=>class{
    constructor(url,protocol){assert.equal(cookie(),'rf_session=synthetic_private_cookie');const target=new URL(url,'https://fixture.invalid');
      assert.equal(target.searchParams.get('textAck'),'1');assert.equal(target.searchParams.get('ownedDelta'),String(ownedDelta));assert.equal(protocol,'rf-online-gzip-v1');
      queueMicrotask(()=>this.onmessage?.({data:wsText?JSON.stringify({type:'transport',data:{connected:true,kind:'websocket'}}):'invalid'}));}
    send(value){sent.push(value);}close(){}
  };
  const setMapIndex=value=>{samples['map-mechanics/index.json']=Buffer.from(JSON.stringify(value));
    deployment.files['map-mechanics/index.json']=createHash('sha256').update(samples['map-mechanics/index.json']).digest('hex');};
  return {requests,sent,mapIndex,samples,bundle,setMapIndex,options:{base:'https://fixture.invalid',credentials,deployment,
    samples:['vc/manifest.json','vc/runtime-pose.json'],professions,ownedDelta,roomCapacity,fetch,SocketFactory}};
}

test('combined release probe verifies RS availability, v3 request and production room slots',async()=>{
  const f=fixture({professions:['RF','LK','VC','RS'],ownedDelta:3,roomCapacity:{maxActivePlayers:12,maxActiveRooms:3}});
  const result=await verifyPublicCapacity(f.options);
  assert.deepEqual(result.professions,['RF','LK','VC','RS']);
  assert.deepEqual(result.roomCapacity,{maxActivePlayers:12,maxActiveRooms:3});
  assert.equal(result.websocket.requestedCapabilities.ownedDelta,3);
  f.options.roomCapacity={maxActivePlayers:18,maxActiveRooms:3};
  await assert.rejects(verifyPublicCapacity(f.options),/probe-room-capacity-mismatch:maxActivePlayers/);
});

test('six-profession release probe checks IS preferences without matching or persistent writes',async()=>{
  const professions=['RF','LK','VC','RS','BM','IS'],f=fixture({professions,ownedDelta:3});
  const result=await verifyPublicCapacity(f.options);
  assert.deepEqual(result.professions,professions);
  assert.equal(f.requests.filter(r=>r.pathname==='/api/skill-preferences').length,6);
  assert.deepEqual(f.requests.filter(r=>r.method==='POST').map(r=>r.pathname),['/api/login','/api/logout']);
  assert.equal(result.preferenceWrites,0);assert.equal(result.gmWrites,0);assert.equal(f.sent.length,0);
});

test('per-mode release probe accepts independent mode slots with no global cap, including a disabled mode',async()=>{
  for(const maxRoomsByMode of [{'1v1':3,'2v2':3,'3v3':2},{'1v1':0,'2v2':20,'3v3':1}]){
    const actual={maxRoomsByMode,activeRoomsByMode:{'1v1':0,'2v2':2,'3v3':1},activeRooms:3,activePlayers:14,
      maxActivePlayers:null,maxActiveRooms:null,waitingForCapacity:false};
    const f=fixture({roomCapacity:actual});f.options.roomCapacity={maxRoomsByMode};
    const result=await verifyPublicCapacity(f.options);assert.deepEqual(result.roomCapacity,actual);
    assert.equal(f.sent.length,0);
  }
});

test('per-mode release probe rejects changed or missing mode limits',async()=>{
  for(const mode of ['1v1','2v2','3v3'])for(const missing of [false,true]){
    const maxRoomsByMode={'1v1':3,'2v2':3,'3v3':2},actual={maxRoomsByMode:{...maxRoomsByMode},maxActivePlayers:null,maxActiveRooms:null};
    if(missing)delete actual.maxRoomsByMode[mode];else actual.maxRoomsByMode[mode]++;
    const f=fixture({roomCapacity:actual});f.options.roomCapacity={maxRoomsByMode};
    await assert.rejects(verifyPublicCapacity(f.options),error=>error.message==='probe-room-capacity-mismatch:'+mode);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  }
});

test('matching per-mode slots cannot conceal a leftover global player or room cap',async()=>{
  for(const key of ['maxActivePlayers','maxActiveRooms'])for(const limit of [12,undefined]){
    const maxRoomsByMode={'1v1':3,'2v2':3,'3v3':2},actual={maxRoomsByMode,maxActivePlayers:null,maxActiveRooms:null};
    actual[key]=limit;
    const f=fixture({roomCapacity:actual});f.options.roomCapacity={maxRoomsByMode};
    await assert.rejects(verifyPublicCapacity(f.options),error=>error.message==='probe-room-capacity-global-limit:'+key);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  }
});

test('an incomplete or invalid per-mode expectation cannot silently omit its assertion',async()=>{
  for(const value of [undefined,null,-1,1.5,21,'3']){
    const maxRoomsByMode={'1v1':value,'2v2':3,'3v3':2},f=fixture({roomCapacity:{maxRoomsByMode,maxActivePlayers:null,maxActiveRooms:null}});
    f.options.roomCapacity={maxRoomsByMode};
    await assert.rejects(verifyPublicCapacity(f.options),/probe-room-capacity-invalid:1v1/);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  }
});

test('read-only public probe uses one explicit player and validates API, digest bodies, SSE and negotiated WS without inputs',async()=>{
  const f=fixture(),result=await verifyPublicCapacity(f.options);assert.equal(result.verified,true);assert.equal(result.vcAnimationUnionChecked,true);
  assert.equal(result.websocket.textFrame,true);assert.equal(result.sse.namedIdleStatus,true);assert.equal(result.assetCount,9);
  assert.deepEqual(result.browserBundle,{path:'/game/game.js',bytes:f.bundle.length,sha256:f.options.deployment.bundleSha256});
  assert.deepEqual(result.mapMechanics,{index:'map-mechanics/index.json',indexSha256:f.options.deployment.files['map-mechanics/index.json'],
    dependencyCount:6,dependencyInventoryMatched:true,categoryCounts:{glb:1,pose:1,texture:2,audio:2},
    sampledDependencies:['map-mechanics/meshes/portal.glb','map-mechanics/meshes/portal.pose.json','map-mechanics/textures/a.png','map-mechanics/audio/a.ogg']});
  assert.equal(result.sampledAssets.length,7);
  assert.ok(result.sampledAssets.some(row=>row.path==='map-mechanics/index.json'));
  for(const name of result.mapMechanics.sampledDependencies)assert.ok(result.sampledAssets.some(row=>row.path===name&&row.sha256===f.options.deployment.files[name]));
  assert.equal(f.requests.some(row=>row.pathname.includes('native-d3dx')),false);
  assert.equal(f.sent.length,0);assert.deepEqual(f.requests.filter(row=>row.method==='POST').map(row=>row.pathname),['/api/login','/api/logout']);
  const output=JSON.stringify(result);for(const secret of ['synthetic-selected-player','synthetic-private-fixture','synthetic_private_cookie'])assert.equal(output.includes(secret),false);
});

test('map index remains mandatory when ordinary asset samples are narrowed and omission stops before authentication',async()=>{
  const f=fixture();delete f.options.deployment.files['map-mechanics/index.json'];
  await assert.rejects(verifyPublicCapacity(f.options),/probe-map-index-missing/);
  assert.deepEqual(f.requests,[]);assert.equal(f.sent.length,0);
});

test('all map dependencies must be present in the digest inventory, including an unsampled texture',async()=>{
  const f=fixture();delete f.options.deployment.files['map-mechanics/textures/z.png'];
  await assert.rejects(verifyPublicCapacity(f.options),/probe-map-dependency-missing:map-mechanics\/textures\/z\.png/);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  assert.equal(f.requests.some(row=>row.pathname.endsWith('/portal.glb')),false);
});

test('map dependencies reject traversal, external, encoded or proof paths before a dependency request',async()=>{
  for(const file of ['../native-d3dx/a.glb','/meshes/a.glb','https://other.invalid/a.glb','meshes\\a.glb',
    'meshes/%2e%2e/a.glb','meshes/a.glb?secret','proofs/a.glb']){
    const f=fixture(),index=structuredClone(f.mapIndex);index.templates.portal.glb=file;f.setMapIndex(index);
    await assert.rejects(verifyPublicCapacity(f.options),/probe-map-dependency-path-invalid/);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
    assert.deepEqual(f.requests.filter(row=>row.pathname.startsWith('/assets/')).map(row=>row.pathname),['/assets/map-mechanics/index.json']);
  }
});

test('actual map index and each representative GLB, pose, texture and audio response must match the sealed body hash',async()=>{
  for(const name of ['map-mechanics/index.json','map-mechanics/meshes/portal.glb','map-mechanics/meshes/portal.pose.json',
    'map-mechanics/textures/a.png','map-mechanics/audio/a.ogg']){
    const f=fixture(),fetch=f.options.fetch;f.options.fetch=async(url,options)=>{
      const response=await fetch(url,options);return new URL(url).pathname==='/assets/'+name?new Response('changed map runtime bytes'):response;
    };
    await assert.rejects(verifyPublicCapacity(f.options),error=>error.message==='probe-asset-body-mismatch:'+name);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  }
});

test('malformed or incomplete map runtime categories cannot pass as a published map closure',async()=>{
  for(const [index,error]of [[null,/probe-map-index-invalid/],[{schemaVersion:1,templates:[],audio:{}},/probe-map-index-invalid/],
    [{schemaVersion:1,templates:{portal:{textures:{first:{file:'textures/a.png'}}}},audio:{jump:{file:'audio/a.ogg'}}},/probe-map-runtime-category-missing/]]){
    const f=fixture();f.setMapIndex(index);await assert.rejects(verifyPublicCapacity(f.options),error);
    assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  }
});

test('an already active selected account stops after one login attempt without choosing another account or logging it out',async()=>{
  const f=fixture({loginStatus:409});await assert.rejects(verifyPublicCapacity(f.options),/selected-account-already-active/);
  assert.deepEqual(f.requests,[{pathname:'/api/login',method:'POST'}]);
});

test('a mismatched published build is rejected and the probe-owned session is cleaned up',async()=>{
  const f=fixture(),fetch=f.options.fetch;f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(new URL(url).pathname!=='/api/session')return response;
    const session=await response.json();return Response.json({...session,buildVersion:'b'.repeat(64)});
  };
  await assert.rejects(verifyPublicCapacity(f.options),/probe-browser-build-mismatch/);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
});

test('a matching backend build cannot hide a stale or tampered authenticated browser entry body',async()=>{
  const f=fixture(),fetch=f.options.fetch;f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options);return new URL(url).pathname==='/game/game.js'?new Response('stale browser entry bytes'):response;
  };
  await assert.rejects(verifyPublicCapacity(f.options),/probe-browser-bundle-body-mismatch/);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
  assert.equal(f.requests.some(row=>row.pathname==='/api/online/events'),false);
});

test('the capacity probe rejects an uncompressed SSE despite explicitly requesting gzip',async()=>{
  const f=fixture(),fetch=f.options.fetch;f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(new URL(url).pathname!=='/api/online/events')return response;
    return new Response(response.body,{headers:{'content-type':'text/event-stream'}});
  };
  await assert.rejects(verifyPublicCapacity(f.options),/probe-sse-gzip-not-negotiated/);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
});

test('public SSE status can span network chunks, UTF8 bytes and its record delimiter',async()=>{
  const f=fixture(),fetch=f.options.fetch,bytes=new TextEncoder().encode(': ready\n\n'
    +'event: status\ndata: {"available":true,"queued":false,"locked":false,"match":null,"note":"\uac35\uac08\uac0b\uac2e"}\n\n');
  const jsonStart=Buffer.from(bytes).indexOf(Buffer.from('{"available"'));
  const unicodeStart=Buffer.from(bytes).indexOf(Buffer.from('\uac35'));
  const boundaries=[0,jsonStart+20,unicodeStart+1,bytes.length-1,bytes.length];let pulled=0;
  f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(new URL(url).pathname!=='/api/online/events')return response;
    return new Response(new ReadableStream({pull(controller){
      if(pulled===boundaries.length-1)return controller.close();
      controller.enqueue(bytes.slice(boundaries[pulled],boundaries[++pulled]));
    }}),{headers:{'content-type':'text/event-stream','content-encoding':'gzip'}});
  };
  const result=await verifyPublicCapacity(f.options);
  assert.equal(result.sse.namedIdleStatus,true);assert.equal(pulled,boundaries.length-1);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
});

test('public SSE ending before a complete status record is rejected and logged out',async()=>{
  const f=fixture(),fetch=f.options.fetch;
  f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options);if(new URL(url).pathname!=='/api/online/events')return response;
    return new Response('event: status\ndata: {"available":true,"queued":false,"locked":false,"match":null}\n',
      {headers:{'content-type':'text/event-stream','content-encoding':'gzip'}});
  };
  await assert.rejects(verifyPublicCapacity(f.options),/probe-sse-ended-before-status/);
  assert.equal(f.requests.at(-1).pathname,'/api/logout');assert.equal(f.sent.length,0);
});

function downloadHeartbeatFixture(onHeartbeat){
  const f=fixture(),fetch=f.options.fetch;let downloading=false,releaseBody,bodySignal;
  const bodyFinished=new Promise(resolve=>{releaseBody=resolve;});
  f.options.timeoutMs=500;
  f.options.fetch=async(url,options)=>{
    const pathname=new URL(url).pathname;
    if(pathname==='/api/online/status'&&downloading)return onHeartbeat({f,url,options,fetch,finish:releaseBody});
    const response=await fetch(url,options);
    if(pathname==='/api/session')return Response.json({...await response.json(),heartbeatSeconds:.01,heartbeatTimeoutSeconds:20});
    if(pathname==='/assets/vc/runtime-pose.json'){
      bodySignal=options.signal;downloading=true;
      response.arrayBuffer=()=>new Promise((resolve,reject)=>{
        const abort=()=>{downloading=false;reject(bodySignal.reason);};
        bodySignal.addEventListener('abort',abort,{once:true});
        bodyFinished.then(()=>{bodySignal.removeEventListener('abort',abort);downloading=false;resolve(f.samples['vc/runtime-pose.json']);});
      });
    }
    return response;
  };
  return f;
}

test('authenticated read-only heartbeats keep a simulated 45-second resource body alive beyond the 20-second session limit',async()=>{
  let elapsed=0,lastSeen=0,heartbeats=0;
  const f=downloadHeartbeatFixture(async({url,options,fetch,finish})=>{
    assert.equal(options.method,'GET');assert.equal(options.headers.Cookie,'rf_session=synthetic_private_cookie');
    elapsed+=10000;assert.ok(elapsed-lastSeen<20000,'authenticated session is still alive');lastSeen=elapsed;
    const response=await fetch(url,options);
    if(++heartbeats===3){elapsed+=15000;finish();}
    return response;
  });
  const fetch=f.options.fetch;f.options.fetch=async(url,options)=>{
    const pathname=new URL(url).pathname;
    if(!['/api/login','/api/logout'].includes(pathname)){
      if(elapsed-lastSeen>=20000)return new Response(null,{status:401});lastSeen=elapsed;
    }
    return fetch(url,options);
  };
  const result=await verifyPublicCapacity(f.options);
  assert.equal(elapsed,45000);assert.equal(result.verified,true);assert.equal(result.resourceHeartbeat.completed,3);
  assert.deepEqual(result.resourceHeartbeat,{method:'GET',resource:'/api/online/status',intervalMs:10,completed:3});
  assert.deepEqual(f.requests.filter(row=>row.method==='POST').map(row=>row.pathname),['/api/login','/api/logout']);
  assert.equal(f.requests.filter(row=>row.pathname==='/api/session').length,1);assert.equal(f.sent.length,0);
  const completed=f.requests.length;await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.requests.length,completed);
});

test('a resource-heartbeat authentication failure aborts the pending body, fails verification and logs out without another heartbeat',async()=>{
  let heartbeats=0;
  const f=downloadHeartbeatFixture(async({url,options,fetch})=>{heartbeats++;await fetch(url,options);return new Response(null,{status:401});});
  await assert.rejects(verifyPublicCapacity(f.options),/probe-heartbeat-http-failed:401/);
  assert.equal(heartbeats,1);assert.equal(f.requests.at(-1).pathname,'/api/logout');
  assert.equal(f.requests.some(row=>row.pathname==='/api/online/events'),false);
  const completed=f.requests.length;await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.requests.length,completed);
});

test('finishing asset verification cancels and joins a pending heartbeat before SSE and logout',async()=>{
  let heartbeats=0,heartbeatAborted=false;
  const f=downloadHeartbeatFixture(async({url,options,fetch,finish})=>{
    heartbeats++;await fetch(url,options);finish();
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{heartbeatAborted=true;reject(options.signal.reason);},{once:true}));
  });
  const result=await verifyPublicCapacity(f.options);
  assert.equal(result.verified,true);assert.equal(heartbeats,1);assert.equal(heartbeatAborted,true);
  assert.equal(result.resourceHeartbeat.completed,0);assert.equal(f.requests.at(-1).pathname,'/api/logout');
});

test('logout failure preserves the primary asset verification error and exposes cleanup failure separately',async()=>{
  const f=fixture(),fetch=f.options.fetch;
  f.options.fetch=async(url,options)=>{
    const response=await fetch(url,options),pathname=new URL(url).pathname;
    if(pathname==='/assets/vc/runtime-pose.json')return new Response('wrong runtime bytes');
    if(pathname==='/api/logout')return new Response(null,{status:503});
    return response;
  };
  await assert.rejects(verifyPublicCapacity(f.options),error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.message,'probe-asset-body-mismatch:vc/runtime-pose.json');
    assert.equal(error.errors[0].message,error.message);assert.equal(error.errors[1].message,'probe-session-cleanup-failed');
    assert.equal(error.cause,error.errors[0]);return true;
  });
  assert.equal(f.requests.at(-1).pathname,'/api/logout');
});
