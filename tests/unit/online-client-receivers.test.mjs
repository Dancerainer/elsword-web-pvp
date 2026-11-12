import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const response=value=>({ok:true,status:200,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const match={id:'m',players:[{id:'a'},{id:'b'}]};

/** Browser native methods reject the wrong receiver. Ordinary arrow mocks do
 * not reproduce Window.setTimeout copied onto another object's property. */
function installWindowApis(){
  const names=['fetch','setTimeout','clearTimeout','setInterval','clearInterval'],saved=new Map(names.map(name=>[name,globalThis[name]]));
  const calls=[],timeouts=new Map(),intervals=new Map(),opens=[],polls=[],signals=[];let serial=0;
  const requireWindow=(receiver,name)=>{if(receiver!==globalThis)throw new TypeError(name+': Illegal invocation');calls.push(name);};
  class WindowApis {
    setTimeout(callback,ms){requireWindow(this,'setTimeout');const id=++serial;timeouts.set(id,{callback,ms});return id;}
    clearTimeout(id){requireWindow(this,'clearTimeout');timeouts.delete(id);}
    setInterval(callback,ms){requireWindow(this,'setInterval');const id=++serial;intervals.set(id,{callback,ms});return id;}
    clearInterval(id){requireWindow(this,'clearInterval');intervals.delete(id);}
    async fetch(url,options){
      requireWindow(this,'fetch');
      if(url==='/api/online/signal')signals.push(JSON.parse(options.body));
      if(url==='/api/online/poll/open'||url.startsWith('/api/online/poll?')){
        const item={...deferred(),url,options};(url.endsWith('/open')?opens:polls).push(item);return item.promise;
      }
      return response(url==='/api/online/status'?{queued:false}:{ok:true});
    }
  }
  for(const name of names)globalThis[name]=WindowApis.prototype[name];
  return {calls,timeouts,intervals,opens,polls,signals,
    runTimeout(ms){const found=[...timeouts].find(([,task])=>task.ms===ms);assert.ok(found,'expected Window timeout '+ms);timeouts.delete(found[0]);found[1].callback.call(globalThis);},
    restore(){for(const [name,value]of saved)globalThis[name]=value;}};
}

test('default browser timer/fetch receivers survive open, empty polling, retry, watchdog and close',async()=>{
  const runtime=installWindowApis(),errors=[],events=[];
  const client=createOnlineClient({eventTransport:'poll',RTCPeerConnection:null,onError:error=>errors.push(error),onEvent:(type,data)=>events.push({type,data})});
  try{
    assert.deepEqual(await client.api('/api/probe'),{ok:true},'default fetch must receive Window');
    const opening=client.open();assert.equal(runtime.opens.length,1);
    runtime.opens[0].resolve(response({connectionId:'browser-lease',cursor:0}));await opening;await settle();assert.equal(runtime.polls.length,1);
    runtime.polls[0].resolve(response({events:[{id:1,type:'status',data:{queued:false}}],cursor:1}));await settle();assert.equal(events.length,1);
    runtime.polls[1].resolve(response({events:[],cursor:1}));await settle();runtime.runTimeout(25);await settle();assert.equal(runtime.polls.length,3);
    runtime.polls[2].reject(Error('temporary disconnect'));await settle();assert.equal(errors[0].message,'connection-retrying');
    runtime.runTimeout(250);await settle();assert.equal(runtime.polls.length,4);
    const held=runtime.polls[3];runtime.runTimeout(11000);assert.equal(held.options.signal.aborted,true);
    held.reject(new DOMException('Aborted','AbortError'));await settle();runtime.runTimeout(500);await settle();assert.equal(runtime.polls.length,5);
    client.close();await settle();assert.equal(runtime.polls[4].options.signal.aborted,true);
    assert.equal(runtime.timeouts.size,0);assert.equal(runtime.intervals.size,0);
    for(const name of ['fetch','setTimeout','clearTimeout','setInterval','clearInterval'])assert.ok(runtime.calls.includes(name),name+' was exercised with its required Window receiver');
  }finally{client.close();await settle();runtime.restore();}
});

test('SSE constructors, RTC instance methods and channel methods retain their browser receivers',async()=>{
  const runtime=installWindowApis(),events=[],errors=[],sources=[],peers=[];
  class Source {
    constructor(url){assert.equal(url,'/api/online/events?ownedDelta=3');this.listeners=new Map();sources.push(this);}
    addEventListener(type,callback){assert.ok(this instanceof Source);this.listeners.set(type,callback);}
    close(){assert.ok(this instanceof Source);this.closed=true;}
  }
  class Channel {
    constructor(){this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){assert.ok(this instanceof Channel);this.sent.push(JSON.parse(value));}
  }
  class Connection {
    constructor(){this.connectionState='connected';this.channel=new Channel();peers.push(this);}
    createDataChannel(){assert.ok(this instanceof Connection);return this.channel;}
    async createOffer(){assert.ok(this instanceof Connection);return {type:'offer'};}
    async createAnswer(){assert.ok(this instanceof Connection);return {type:'answer'};}
    async setLocalDescription(value){assert.ok(this instanceof Connection);this.localDescription={toJSON(){assert.equal(this.owner,'local-description');return value;},owner:'local-description'};}
    async setRemoteDescription(value){assert.ok(this instanceof Connection);this.remoteDescription=value;}
    async addIceCandidate(value){assert.ok(this instanceof Connection);this.candidate=value;}
    close(){assert.ok(this instanceof Connection);this.connectionState='closed';}
  }
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Connection,onError:error=>errors.push(error),onEvent:(type,data)=>events.push({type,data})});
  try{
    await client.open();await client.setMatch(match,'a');await settle();
    assert.equal(client.send({held:['Z'],pressed:['Z'],released:[]}),1);assert.equal(peers[0].channel.sent[0].packet.frameSeq,1);
    const proof={signalVersion:1,sourceEpoch:1,generation:1,offerId:runtime.signals.find(row=>row.type==='offer').offerId};
    sources[0].listeners.get('signal')({data:JSON.stringify({matchId:'m',from:'b',type:'answer',payload:{type:'answer',sdp:'receiver-answer'},...proof})});await settle();
    sources[0].listeners.get('signal')({data:JSON.stringify({matchId:'m',from:'b',type:'candidate',payload:{candidate:'receiver-test'},...proof})});await settle();
    assert.equal(peers[0].remoteDescription.type,'answer');assert.equal(peers[0].candidate.candidate,'receiver-test');
    await [...runtime.intervals.values()][0].callback.call(globalThis);assert.deepEqual(errors,[]);assert.equal(events[0].type,'status');
    client.close();assert.equal(sources[0].closed,true);assert.equal(peers[0].connectionState,'closed');assert.equal(runtime.intervals.size,0);
  }finally{client.close();await settle();runtime.restore();}
});

test('injected timer adapters keep their own receiver rather than being rebound to Window',async()=>{
  const runtime=installWindowApis();let ownTimerCalls=0;
  class Timers {
    constructor(){this.tasks=new Map();this.serial=0;}
    setTimeout(callback,ms){assert.ok(this instanceof Timers);ownTimerCalls++;const id=++this.serial;this.tasks.set(id,{callback,ms});return id;}
    clearTimeout(id){assert.ok(this instanceof Timers);ownTimerCalls++;this.tasks.delete(id);}
  }
  const timers=new Timers(),client=createOnlineClient({eventTransport:'poll',timers,RTCPeerConnection:null});
  try{
    const opening=client.open();runtime.opens[0].resolve(response({connectionId:'injected-lease',cursor:0}));await opening;await settle();
    runtime.polls[0].resolve(response({events:[],cursor:0}));await settle();
    assert.ok([...timers.tasks.values()].some(task=>task.ms===25));client.close();await settle();
    assert.ok(ownTimerCalls>0);assert.equal(timers.tasks.size,0);assert.equal(runtime.timeouts.size,0);
  }finally{client.close();await settle();runtime.restore();}
});
