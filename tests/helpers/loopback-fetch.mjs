/** Direct HTTP test client: OS-assigned loopback ports can be Fetch bad ports.
 * Uses real HTTP requests and Response parsing, without bypassing app checks. */
import {request} from 'node:http';
export function loopbackFetch(input,{method='GET',headers={},body,signal}={}){
  const url=new URL(input);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new TypeError('Only HTTP loopback fixtures supported');
  if(body!=null&&typeof body!=='string'&&!ArrayBuffer.isView(body))throw new TypeError('Unsupported fixture body');
  return new Promise((resolve,reject)=>{
    const outgoing=request(url,{method,headers:Object.fromEntries(new Headers(headers)),signal},incoming=>{
      const chunks=[];
      incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject);
      incoming.on('end',()=>{
        const responseHeaders=new Headers();
        for(let i=0;i<incoming.rawHeaders.length;i+=2)responseHeaders.append(incoming.rawHeaders[i],incoming.rawHeaders[i+1]);
        resolve(new Response([204,205,304].includes(incoming.statusCode)?null:Buffer.concat(chunks),
          {status:incoming.statusCode,statusText:incoming.statusMessage,headers:responseHeaders}));
      });
    });
    outgoing.on('error',reject);outgoing.end(body);
  });
}
