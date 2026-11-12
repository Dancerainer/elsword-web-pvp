/** Optional self-hosted browser STUN discovery sidecar. Importing never binds.
 * It receives no game/session data and performs no TURN allocation or forwarding.
 */
import dgram from 'node:dgram';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStunBindingResponse,createStunRateLimiter} from '../../packages/online/stun-binding.mjs';

export function createStunBindingServer({host='127.0.0.1',port=0,family,
  ipv6Only=false,rateLimits={},maxPendingSends=64}={}){
  const hostFamily=typeof host==='string'?isIP(host.split('%')[0]):0;
  family??=hostFamily===6?'udp6':'udp4';
  if(!hostFamily||!['udp4','udp6'].includes(family)
    ||(family==='udp4'?hostFamily!==4:hostFamily!==6)||typeof ipv6Only!=='boolean'
    ||!Number.isInteger(port)||port<0||port>65535||!Number.isSafeInteger(maxPendingSends)||maxPendingSends<1||maxPendingSends>128)
    throw new TypeError('invalid-stun-listen-options');
  const limiter=createStunRateLimiter(rateLimits),counts={received:0,invalid:0,replied:0,responseBytes:0,sendErrors:0,socketErrors:0,sendCapacityLimited:0};
  let socket=null,startPromise=null,closePromise=null,closed=false,pending=0,boundAddress=null;
  return {
    start(){
      if(closed)return Promise.reject(Error('stun-server-closed'));
      if(startPromise)return startPromise;
      socket=dgram.createSocket({type:family,ipv6Only});
      socket.on('error',()=>{counts.socketErrors++;});
      socket.on('message',(message,remote)=>{
        if(closed)return;counts.received++;
        if(!limiter.allow(remote.address))return;
        const response=createStunBindingResponse(message,remote);
        if(!response){counts.invalid++;return;}
        if(pending>=maxPendingSends){counts.sendCapacityLimited++;return;}
        pending++;
        try{socket.send(response,remote.port,remote.address,error=>{
          pending--;if(error){counts.sendErrors++;return;}counts.replied++;counts.responseBytes+=response.length;
        });}catch{pending--;counts.sendErrors++;}
      });
      startPromise=new Promise((resolveStart,reject)=>{
        const failed=error=>{socket.off('listening',listening);reject(error);};
        const listening=()=>{socket.off('error',failed);boundAddress={...socket.address()};resolveStart({...boundAddress});};
        socket.once('error',failed);socket.once('listening',listening);
        try{socket.bind({address:host,port});}catch(error){socket.off('error',failed);socket.off('listening',listening);reject(error);}
      });
      return startPromise;
    },
    close(){
      if(closePromise)return closePromise;
      closed=true;limiter.clear();
      closePromise=(async()=>{
        if(!socket)return;
        // Let an in-flight bind finish before closing its handle, including a
        // failed bind. No timer or background worker outlives this lifecycle.
        try{await startPromise;}catch{}
        await new Promise(resolveClose=>{try{socket.close(resolveClose);}catch{resolveClose();}});
        socket.removeAllListeners();boundAddress=null;
      })();
      return closePromise;
    },
    address(){return boundAddress?{...boundAddress}:null;},
    stats(){return {...counts,pending,rateLimits:limiter.stats(),listening:boundAddress!==null,closed};},
  };
}

export function stunOptionsFromEnvironment(env=process.env){
  const value=env.RF_RTC_STUN_PORT;
  if(value===undefined||value==='')return null;
  if(!/^\d+$/.test(String(value))||Number(value)<1||Number(value)>65535)throw new TypeError('invalid-stun-env-port');
  return {host:env.RF_RTC_STUN_HOST||'127.0.0.1',port:Number(value)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options=stunOptionsFromEnvironment();
  if(!options)console.log('STUN sidecar disabled; set RF_RTC_STUN_PORT explicitly to enable local discovery.');
  else{
    const server=createStunBindingServer(options);
    const stop=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);void server.close();};
    try{const address=await server.start();console.log(JSON.stringify({service:'stun-binding-udp',...address}));
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    }catch(error){await server.close();console.error('STUN sidecar failed: '+error.message);process.exitCode=1;}
  }
}
