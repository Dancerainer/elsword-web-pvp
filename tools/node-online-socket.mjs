/** Node test-peer WebSocket adapter, authenticated with the existing private
 * cookie and exact Origin. No installation, credential output or auth bypass.
 * Browser production code continues to use the browser's own RFC6455 client. */
import http from 'node:http';
import https from 'node:https';
import {randomBytes,createHash} from 'node:crypto';
function frame(bytes,opcode=2){
 bytes=Buffer.from(bytes);const length=bytes.length,header=Buffer.alloc(length<126?2:length<=65535?4:10),mask=randomBytes(4);
 header[0]=128|opcode;header[1]=128|(length<126?length:length<=65535?126:127);
 if(length>=126&&length<=65535)header.writeUInt16BE(length,2);if(length>65535)header.writeBigUInt64BE(BigInt(length),2);
 const result=Buffer.alloc(bytes.length);for(let i=0;i<bytes.length;i++)result[i]=bytes[i]^mask[i%4];return Buffer.concat([header,mask,result]);
}
export function createNodeOnlineSocketClass({base,origin=base,cookie=()=>null}={}){
 return class NodeOnlineSocket{
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;socket=null;request=null;input=Buffer.alloc(0);fragments=[];fragmentBytes=0;fragmentOpcode=null;closeTimer=null;
  constructor(relative,protocol){
   const url=new URL(relative,base);url.protocol=url.protocol==='https:'?'wss:':url.protocol==='http:'?'ws:':url.protocol;
   if(!['ws:','wss:'].includes(url.protocol))throw Error('Unsupported peer socket protocol');
   const key=randomBytes(16).toString('base64'),client=url.protocol==='wss:'?https:http;
   const expected=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
   const target=new URL(url);target.protocol=target.protocol==='wss:'?'https:':'http:';
   this.request=client.request(target,{method:'GET',headers:{Host:new URL(origin).host,Origin:origin,Connection:'Upgrade',Upgrade:'websocket',
    'Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key,'Sec-WebSocket-Protocol':protocol,...(cookie()?{Cookie:cookie()}:{})}});
   this.request.once('upgrade',(response,socket,head)=>{
    if(this.readyState!==0){socket.destroy();return;}
    if(response.headers['sec-websocket-accept']!==expected||response.headers['sec-websocket-protocol']!==protocol||response.headers['sec-websocket-extensions']){socket.destroy();this.failure();return;}
    this.socket=socket;this.readyState=1;socket.on('data',bytes=>this.read(bytes));socket.on('error',()=>this.failure());socket.once('close',()=>this.finish());
    this.onopen?.();if(head.length)this.read(head);
   });
   this.request.once('response',response=>{response.resume();this.failure();});this.request.once('error',()=>this.failure());this.request.end();
  }
  get bufferedAmount(){return this.socket?.writableLength??0;}
  failure(){if(this.readyState===3)return;this.onerror?.({message:'peer-socket-connection-failed'});this.socket?.destroy();this.request?.destroy();this.finish();}
  finish(){if(this.readyState===3)return;this.readyState=3;clearTimeout(this.closeTimer);this.input=Buffer.alloc(0);this.fragments=[];this.fragmentBytes=0;this.onclose?.({});}
  send(bytes){if(this.readyState!==1)throw Error('Peer socket is not open');if(typeof bytes==='string')this.socket.write(frame(Buffer.from(bytes),1));else this.socket.write(frame(bytes,2));}
  close(){if(this.readyState===3)return;if(this.readyState===0){this.request?.destroy();this.finish();return;}if(this.readyState===2)return;
   this.readyState=2;this.socket.end(frame(Buffer.from([3,232]),8));this.closeTimer=setTimeout(()=>this.socket?.destroy(),1000);this.closeTimer.unref?.();}
  read(chunk){
   if(this.readyState!==1&&this.readyState!==2)return;this.input=Buffer.concat([this.input,chunk]);
   while(this.input.length>=2){const first=this.input[0],second=this.input[1],opcode=first&15,fin=!!(first&128);let length=second&127,offset=2;
    if(first&112||second&128||![0,1,2,8,9,10].includes(opcode)){this.failure();return;}
    if(length===126){if(this.input.length<4)return;length=this.input.readUInt16BE(2);offset=4;if(length<126){this.failure();return;}}
    else if(length===127){if(this.input.length<10)return;const big=this.input.readBigUInt64BE(2);if(big<65536n||big>1048576n){this.failure();return;}length=Number(big);offset=10;}
    if(length>1024*1024||this.fragmentBytes+length>1024*1024||opcode>=8&&(!fin||length>125)){this.failure();return;}
    if(this.input.length<offset+length)return;const bytes=Buffer.from(this.input.subarray(offset,offset+length));this.input=this.input.subarray(offset+length);
    if(opcode>=8){if(opcode===8){if(length===1){this.failure();return;}if(this.readyState===1)this.socket.end(frame(bytes,8));this.finish();return;}
     if(opcode===9)this.socket.write(frame(bytes,10));continue;}
    if(opcode===0){if(this.fragmentOpcode===null){this.failure();return;}}else if(this.fragmentOpcode!==null){this.failure();return;}else this.fragmentOpcode=opcode;
    this.fragments.push(bytes);this.fragmentBytes+=length;if(this.fragments.length>256){this.failure();return;}
    if(fin){const payload=Buffer.concat(this.fragments,this.fragmentBytes),kind=this.fragmentOpcode;this.fragments=[];this.fragmentBytes=0;this.fragmentOpcode=null;
     try{this.onmessage?.({data:kind===1?new TextDecoder('utf-8',{fatal:true}).decode(payload):payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.byteLength)});}catch{this.failure();return;}}
   }
  }
 };
}
