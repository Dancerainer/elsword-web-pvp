import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalAssetRequest} from '../server/asset-path-aliases.mjs';
import {updateLocalClient} from './updater.mjs';
import {resolveServerOrigin} from './server-config.mjs';
import {fullClientRequiredMessage} from './update-messages.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary',
  '.png':'image/png','.ttf':'font/ttf','.ogg':'audio/ogg','.wav':'audio/wav'};
const safe=name=>typeof name==='string'&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')
  &&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};

export async function verifyClientFiles(root,manifest){
  if(manifest?.schemaVersion!==1||!manifest.files||!manifest.assets||! /^[a-f0-9]{64}$/.test(manifest.buildSha256))throw Error('invalid-client-manifest');
  for(const [name,expected] of Object.entries(manifest.files)){
    if(!safe(name)||! /^[a-f0-9]{64}$/.test(expected))throw Error('invalid-client-file');
    const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(root,name)))hash.update(chunk);
    if(hash.digest('hex')!==expected)throw Error('Client file damaged. Extract the package again: '+name);
  }
  for(const [name,expected]of Object.entries(manifest.assets))if(!safe(name)||manifest.files['assets/'+name]!==expected)throw Error('invalid-client-asset');
  if(manifest.files['dist/game.js']!==manifest.buildSha256)throw Error('invalid-client-build');
}

export async function createLocalClient({root=ROOT,manifest,remoteOrigin,configPath=path.join(root,'server-config.json'),verify=true,updateState=null}={}){
  manifest??=JSON.parse(await readFile(path.join(root,'client-manifest.json'),'utf8'));
  if(verify)await verifyClientFiles(root,manifest);
  const remote=new URL(await resolveServerOrigin({remoteOrigin,configPath,manifest}));
  // Browsers share loopback cookies across ports. Isolate logins when the player switches servers.
  const sessionName='rf_session_'+createHash('sha256').update(remote.origin).digest('hex');
  const sessionPattern=new RegExp('(?:^|;\\s*)'+sessionName+'=([A-Za-z0-9_-]+)(?=;|$)');
  const sessionToken=req=>req.headers.cookie?.match(sessionPattern)?.[1];
  const transport=remote.protocol==='https:'?https:http;
  const agent=new transport.Agent({keepAlive:true,maxSockets:64});
  let inventoryReady=false;
  const sockets=new Set(),upstreams=new Set();
  const track=request=>{upstreams.add(request);request.once('close',()=>upstreams.delete(request));return request;};
  function allowed(req){
    const local='127.0.0.1:'+server.address().port;
    return req.headers.host===local&&(!req.headers.origin||req.headers.origin==='http://'+local)
      &&req.headers['sec-fetch-site']!=='cross-site';
  }
  function headers(req,intercept=false){
    const value={...req.headers,host:remote.host};
    const token=sessionToken(req);
    if(token)value.cookie='rf_session='+token;
    else delete value.cookie;
    for(const key of ['x-real-ip','x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip','proxy-authorization'])delete value[key];
    if(req.headers.origin)value.origin=remote.origin;
    if(intercept)value['accept-encoding']='identity';
    return value;
  }
  function responseHeaders(res){
    const result={...res.headers};
    if(result['set-cookie'])result['set-cookie']=result['set-cookie'].filter(cookie=>cookie.startsWith('rf_session='))
      .map(cookie=>cookie.replace(/^rf_session=/,sessionName+'=').replace(/;\s*Secure\b/ig,'').replace(/;\s*Domain=[^;]+/ig,''));
    return result;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!allowed(req))return json(res,403,{error:'local-origin-denied'});
    try{
      const url=new URL(req.url,'http://local'),pathname=decodeURIComponent(url.pathname);
      if(pathname==='/api/local-client')return json(res,200,{schemaVersion:1,localResourceClient:true,buildSha256:manifest.buildSha256,assetCount:Object.keys(manifest.assets).length,updateState});
      if(updateState?.status==='full-client-required'){
        if(pathname==='/'&&req.method==='GET'){
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
          return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Full client update required</title><style>body{background:#101722;color:#f4e8d3;font:18px sans-serif;max-width:680px;margin:12vh auto;padding:24px;line-height:1.8}</style><h1>Download the latest full client</h1><p>${fullClientRequiredMessage(updateState)}</p><p>Close the launcher, download and extract the full client package, then run Start-Client.bat.</p></html>`);
        }
        return json(res,409,{error:'full-client-required',message:'Download the full client package to update this version.'});
      }
      let name;
      if(pathname.startsWith('/assets/')){
        if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'method-not-allowed'});
        if(!sessionToken(req))return json(res,401,{error:'login-required'});
        if(!inventoryReady)return json(res,409,{error:'local-inventory-not-verified'});
        const asset=canonicalAssetRequest(pathname.slice(8));
        if(!safe(asset)||!Object.hasOwn(manifest.assets,asset))return json(res,404,{error:'local-resource-missing',message:'A local asset is missing. Update the client.'});
        if(url.searchParams.has('v')&&url.searchParams.get('v')!==manifest.assets[asset])return json(res,409,{error:'local-resource-version-mismatch'});
        name='assets/'+asset;
      }else if(pathname==='/'&&req.method==='GET')name='apps/web/index.html';
      else if(['/login.mjs','/login.css'].includes(pathname)&&req.method==='GET')name='apps/web'+pathname;
      else if(pathname.startsWith('/game/')&&['GET','HEAD'].includes(req.method)){
        const file=pathname.slice(6),version=url.searchParams.get('v');
        if(safe(file)&&Object.hasOwn(manifest.files,'dist/'+file)&&(!['game.js','game.css'].includes(file)||version===manifest.buildSha256))name='dist/'+file;
      }
      if(name){
        if(!Object.hasOwn(manifest.files,name))return json(res,404,{error:'local-file-missing'});
        const tag='"'+manifest.files[name]+'"';
        const cache=name.startsWith('assets/')?'private, max-age=31536000, immutable':'no-cache';
        if(req.headers['if-none-match']===tag){res.writeHead(304,{ETag:tag,'Cache-Control':cache});return res.end();}
        res.writeHead(200,{'Content-Type':TYPES[path.extname(name)]??'application/octet-stream',ETag:tag,'Cache-Control':cache});
        if(req.method==='HEAD')return res.end();
        return pipeline(createReadStream(path.join(root,name)),res,error=>{if(error)res.destroy();});
      }
      // Missing resources NEVER fall back to the bandwidth-limited game host.
      if(pathname.startsWith('/game/'))return json(res,409,{error:'client-program-outdated',message:'The game version has changed. Restart the client to check for updates.'});
      if(!pathname.startsWith('/api/'))return json(res,404,{error:'not-found'});
      const intercept=['/api/session','/api/asset-versions'].includes(pathname)&&req.method==='GET';
      const upstream=track(transport.request(remote.origin+url.pathname+url.search,{method:req.method,headers:headers(req,intercept),agent},async response=>{
        try{
          if(intercept&&response.statusCode===200){
            const chunks=[];let size=0;
            for await(const chunk of response){size+=chunk.length;if(size>4*1024*1024)throw Error('upstream-json-too-large');chunks.push(chunk);}
            const value=JSON.parse(Buffer.concat(chunks));
            if(pathname==='/api/session'){
              if(value.buildVersion&&value.buildVersion!==manifest.buildSha256)return json(res,409,{error:'client-program-outdated',message:'The server has been updated. Restart the client to check for updates.'});
              value.localResourceClient=true;value.traceExport='download';
            }
            else{
              const mismatches=value.schemaVersion!==1||!value.files?['invalid-inventory']:Object.entries(value.files).filter(([file,digest])=>manifest.assets[file]!==digest).map(([file])=>file);
              inventoryReady=mismatches.length===0;
              if(!inventoryReady)return json(res,409,{error:'local-resources-outdated',message:'Local assets do not match the server. Download the latest client package.',files:mismatches.slice(0,8)});
            }
            const result=responseHeaders(response);delete result['content-length'];delete result['content-encoding'];delete result['transfer-encoding'];
            res.writeHead(200,{...result,'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(value));
          }
          res.writeHead(response.statusCode,responseHeaders(response));pipeline(response,res,()=>{});
        }catch{if(!res.headersSent)json(res,502,{error:'remote-response-invalid'});else res.destroy();}
      }));
      if(pathname!=='/api/online/events')upstream.setTimeout(30_000,()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)json(res,502,{error:'remote-unavailable',message:'Unable to connect to the game server. Try again later.'});else res.destroy();});
      req.once('aborted',()=>upstream.destroy());res.once('close',()=>{if(!res.writableFinished)upstream.destroy();});req.pipe(upstream);
    }catch{if(!res.headersSent)json(res,400,{error:'invalid-local-request'});else res.destroy();}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('upgrade',(req,socket,head)=>{
    if(!allowed(req)||new URL(req.url,'http://local').pathname!=='/api/online/socket'){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    const url=new URL(req.url,'http://local');
    const request=track(transport.request(remote.origin+url.pathname+url.search,{headers:headers(req),agent:false}));
    request.on('upgrade',(response,peer,remoteHead)=>{
      sockets.add(peer);peer.once('close',()=>sockets.delete(peer));
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');
      if(head.length)peer.write(head);if(remoteHead.length)socket.write(remoteHead);
      socket.pipe(peer);peer.pipe(socket);socket.once('close',()=>peer.destroy());peer.once('close',()=>socket.destroy());
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
    });
    request.on('response',response=>{response.resume();socket.end('HTTP/1.1 '+response.statusCode+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
    request.on('error',()=>socket.destroy());socket.once('close',()=>request.destroy());request.end();
  });
  return {server,close:async()=>{for(const request of upstreams)request.destroy();for(const socket of sockets)socket.destroy();agent.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let updateState;
  console.log('Checking for client updates…');
  try{updateState=await updateLocalClient({root:ROOT});}
  catch(error){console.error('Update failed: '+error.message+'. The previous files have been kept. Restart to try again.');process.exit(1);}
  if(updateState.status==='updated'){console.log('Update verified and saved. Restarting the client…');process.exit(75);}
  if(updateState.status==='full-client-required')console.log(fullClientRequiredMessage(updateState));
  console.log('Verifying local assets…');
  const client=await createLocalClient({updateState});
  const port=Number(process.env.EL_CLIENT_PORT??4376);
  client.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'The client is already running or its port is in use. Close the other window and try again.':error.message);process.exitCode=1;});
  client.server.listen(port,'127.0.0.1',()=>console.log('Client running at http://127.0.0.1:'+port+'\nClose this window to stop the client.'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await client.close();process.exit();});
}
