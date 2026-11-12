/** Four real coordinator/ownership consumers with controlled RTC wires.
 * This exercises Web protocol repair, not SCTP congestion or real WAN. */
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createBuffFromFactor} from '../../packages/combat-core/buffs.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'buff-four-v38',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const f=Math.fround,dt=f(1/60),input={held:[],pressed:[],released:[]};
const nativeValues={buffFixed:(v,r)=>f(f(v)*f(1-r)),buffRelation:(a,m,r)=>f(f(f(a)*f(m))*f(1-r)),buffPercent:(v,r)=>f(f(v)*f(1-r)),
  buffInterval(sum,interval,elapsed){const n=f(f(sum)+f(elapsed));return n>=f(interval)?{sum:0,triggered:true}:{sum:n,triggered:false};}};
export const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
export async function buffRoom(t,{ids=['a','b','c','d'],phase='fight',clientFactory=createOnlineClient}={}){
  const wire=[],history=[],endpoints={},intervals=new Map(),errors=[];let now=0,serial=0;
  t.mock.method(globalThis,'setInterval',fn=>{const token=++serial;intervals.set(token,fn);return token;});
  t.mock.method(globalThis,'clearInterval',token=>intervals.delete(token));
  const match={id:'buff-four-v38',status:'playing',ownership:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1,
    players:ids.map((id,index)=>({id,team:index%2}))};
  const epochs=Object.fromEntries(ids.map(id=>[id,1]));
  class Channel{
    constructor(from,to,label){Object.assign(this,{from,to,label,readyState:'open',bufferedAmount:0});}
    send(text){const value=JSON.parse(text),row={from:this.from,to:this.to,label:this.label,text,value,at:now};wire.push(row);history.push(row);}
    close(){this.readyState='closed';}
  }
  for(const id of ids){
    const e=endpoints[id]={channels:new Map(),connections:new Map(),events:[],timeouts:new Map(),frame:0,statusClock:createOwnerStatusClock()};
    e.sim=createSimulation({profile,map,networkOwnerId:id,seed:2016,
      preset:{buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
      actors:ids.map((actorId,index)=>({id:actorId,professionId:'RF',team:index%2,position:[index*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
    e.sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>now});
    class Source{constructor(){e.source=this;this.listeners=new Map();}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
      emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}}
    let construction=0;
    class Peer{constructor(){this.to=ids.filter(x=>x!==id)[construction++%(ids.length-1)];this.connectionState='connected';e.connections.set(this.to,this);}
      createDataChannel(label){const channel=new Channel(id,this.to,label);e.channels.set(`${this.to}:${label}`,channel);return channel;}
      async createOffer(){return {type:'offer',sdp:'controlled-four-v38'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
      close(){this.connectionState='closed';}}
    e.client=clientFactory({EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,rtcOptions:{enabled:false,networkBinary:false},clock:()=>now,
      timers:{setTimeout(fn,ms){const token=++serial;e.timeouts.set(token,{fn,at:now+ms});return token;},clearTimeout(token){e.timeouts.delete(token);}},
      fetch:async()=>({ok:true,json:async()=>({accepted:true})}),onError:error=>errors.push(error.message),onEvent(type,data){
        e.events.push({type,data,at:now});
        if(type==='state')return e.sync.reconcile(e.sim,data,id);
        if(type==='owner-buffs')return e.sync.receiveBuffs(e.sim,data.playerId,data.snapshot,id);
        if(type==='owner-protection')return e.sync.receiveProtection(e.sim,data.playerId,data.status,id,data.buffRevision);
        if(type==='owner-status')return e.sync.receiveStatus(e.sim,data.playerId,data.status,id);
        if(type==='owner-motion')return e.sync.receiveMotion(e.sim,data.playerId,data.motion,id);
        if(type==='owner-actions')return true;
        if(type==='peer-owned-state')return {validated:true,applied:true,playerId:data.playerId,epoch:data.report.epoch,frameSeq:data.report.frameSeq};
        return true;
      }});
    t.after(()=>{e.client.close();e.sync.clear();});await e.client.open();await e.client.setMatch(match,id);await settle();
  }
  function connect(){for(const from of ids)for(const to of ids)if(from>to)for(const label of ['input','control']){
    const channel=new Channel(from,to,label);endpoints[from].channels.set(`${to}:${label}`,channel);endpoints[from].connections.get(to).ondatachannel({channel});
  }for(const e of Object.values(endpoints))for(const channel of e.channels.values())if(channel.label==='control')channel.onopen?.();}
  let stateSeq=0;
  function state(nextPhase=phase){phase=nextPhase;stateSeq++;
    for(const id of ids){const e=endpoints[id];e.source.emit('state',{matchId:match.id,sequence:stateSeq,snapshot:e.sim.snapshot(),pvp:{phase},owners:{},
      ownership:{mode:'local-owner-v1',ownerStatusVersion:1,combatPlaybackVersion:1,actors:Object.fromEntries(ids.map(actorId=>[actorId,{epoch:epochs[actorId],frameSeq:0}]))}});}}
  const deliver=async row=>{endpoints[row.to].channels.get(`${row.from}:${row.label}`)?.onmessage?.({data:row.text});await settle();};
  const drain=async(predicate=()=>true)=>{for(let i=0;i<2000;i++){await settle();const at=wire.findIndex(predicate);if(at<0)return;await deliver(wire.splice(at,1)[0]);}throw Error('four-player-wire-loop');};
  connect();state();await drain();
  const send=async(id,n=1)=>{const e=endpoints[id];
    for(let i=0;i<n;i++){e.frame++;for(const b of e.sim.actor(id).buffs)for(const finalizer of b.finalizers)if(finalizer.kind==='time')finalizer.remaining=f(finalizer.remaining-dt);}
    const report=encodeOwnedState(e.sim,id,{epoch:epochs[id],frameSeq:e.frame});report.actor=e.statusClock.encode(report.actor,epochs[id],e.frame).actor;
    e.client.send(input,report);await settle();return report;};
  const advance=async ms=>{now+=ms;for(const fn of intervals.values())void fn();await settle();};
  const addBuff=(id,sourceId=id)=>{const e=endpoints[id],created=createBuffFromFactor(profile,{factor:42,sourceActor:e.sim.actor(sourceId),targetActor:e.sim.actor(id),roll:0,nativeValues});
    if(!created.supported||!created.accepted)throw Error('test-buff-factor-unavailable');e.sim.actor(id).buffs=[created.buff];return structuredClone(created.buff);};
  const bootstrap=async()=>{for(let round=0;round<2;round++){for(const id of ids)await send(id);await drain();}};
  return {ids,match,epochs,endpoints,wire,history,errors,send,deliver,drain,advance,state,addBuff,bootstrap,now:()=>now,
    async reconnect(){await drain();for(const id of ids){await endpoints[id].client.setMatch(match,id);await settle();}connect();await drain();}};
}
