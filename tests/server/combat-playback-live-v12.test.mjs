/** Four real authenticated HTTP uplinks and SSE downstreams in a new 2v2
 * playback room. Source status/action clocks come from createLocalOwnershipSync.
 * The small map and empty collision samplers are explicit host fixtures;
 * this is not browser/GPU, full Native combat, P2P or WAN latency evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';

const profile=JSON.parse(await readFile(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const input={held:[],pressed:[],released:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,rows,label){
  for(let i=0;i<200;i++){
    if(predicate())return;
    const errors=rows.flatMap(row=>row.errors);if(errors.length)throw Error(label+': '+JSON.stringify(errors));
    await delay(5);
  }
  throw Error(label+': '+JSON.stringify(rows.map(row=>({id:row.id,errors:row.errors,
    uploads:row.uploads.map(value=>({frame:value.body.owner?.frameSeq,epoch:value.body.owner?.epoch,ack:value.ack})),
    status:row.sync?.statusDiagnostics}))));
}
async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'rf-playback-live-v12-')),root=fileURLToPath(new URL('../..',import.meta.url));
  const credentials=Array.from({length:4},(_,index)=>({username:'live-playback-'+index,password:'private-fixture-playback-'+index,role:'player'}));
  const rows=[];let now=10000,serverSimulation,driver,room;
  const factory=Object.assign(({match,emit,finish})=>{
    assert.equal(match.mode,'2v2');assert.equal(match.players.length,4);assert.equal(match.ownerStatusVersion,1);assert.equal(match.continuousAuraVersion,2);assert.equal(match.combatPlaybackVersion,1);room=match;
    const map={sceneId:match.sceneId,lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
      starts:match.players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*2000,0,0],lineId:0,facingRight:true}))};
    serverSimulation=createSimulation({profile,map,actors:match.players.map((player,index)=>({...player,position:[index*2000,0,0],lineId:0})),seed:2016});
    const templates=structuredClone(serverSimulation.state.actors);
    const pvp=new PvpMatch({mode:'2v2',players:match.players,map,seed:2016,
      versions:{referenceVersion:serverSimulation.versions.baseline,presetVersion:serverSimulation.versions.preset,programVersion:CORE_VERSION},
      onRespawn(id){const index=serverSimulation.state.actors.findIndex(actor=>actor.id===id);serverSimulation.state.actors[index]=structuredClone(templates[index]);return serverSimulation.state.actors[index];}});
    driver=createLocalOwnerBattleDriver({match,simulation:serverSimulation,pvp,emit,finish,manual:true});return driver;
  },{ownership:'local-owner-v1'});
  const context=await createDevServer({root,accountRoot:directory,credentials:credentials[0],additionalCredentials:credentials.slice(1),driverFactory:factory,now:()=>now});
  const base='http://127.0.0.1:'+await listenLoopback(context.server);
  t.after(async()=>{
    for(const row of rows){row.client.close();row.sync?.clear();for(const source of row.sources)source.close();}
    context.closeStreams();context.online.close();context.server.closeAllConnections();await new Promise(resolve=>context.server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});
  });
  for(const credential of credentials){
    const row={id:credential.username,events:[],errors:[],uploads:[],sources:[],simulation:null,sync:null,cookie:null,client:null};rows.push(row);
    row.request=async(url,options={})=>{
      const target=new URL(url,base),response=await fetch(target,{...options,headers:{Origin:base,...options.headers,...(row.cookie?{Cookie:row.cookie}:{})}});
      if(response.headers.get('set-cookie'))row.cookie=response.headers.get('set-cookie').split(';')[0];
      if(target.pathname==='/api/online/input'&&options.body)row.uploads.push({body:JSON.parse(options.body),ack:await response.clone().json(),status:response.status});
      return response;
    };
    const login=await row.request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credential)});assert.equal(login.status,200);await login.json();
    class Source{
      constructor(url){this.listeners=new Map();this.wireEvents=[];this.controller=new AbortController();row.sources.push(this);
        this.done=this.read(url).catch(error=>{if(error.name!=='AbortError')row.errors.push(error.message);});}
      addEventListener(type,listener){this.listeners.set(type,listener);}
      close(){this.controller.abort();}
      async read(url){
        const response=await row.request(url,{signal:this.controller.signal});assert.equal(response.status,200);
        const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
        for(;;){const part=await reader.read();if(part.done)return;text+=decoder.decode(part.value,{stream:true});let end;
          while((end=text.indexOf('\n\n'))>=0){const block=text.slice(0,end);text=text.slice(end+2);
            const type=block.match(/^event: (.*)$/m)?.[1],data=block.match(/^data: (.*)$/m)?.[1],lastEventId=block.match(/^id: (.*)$/m)?.[1];
            if(data){this.wireEvents.push({type,data:JSON.parse(data)});this.listeners.get(type)?.({data,lastEventId});}
          }
        }
      }
    }
    row.client=createOnlineClient({fetch:row.request,EventSource:Source,WebSocket:null,RTCPeerConnection:null,
      onError:error=>row.errors.push(error.message),onEvent(type,value){
        row.events.push({type,value});
        if(type==='match'){assert.equal(value.combatPlaybackVersion,1);void row.client.setMatch(value,row.id);return;}
        if(type==='state'){
          if(!row.simulation){row.simulation=createSimulation({profile,map:serverSimulation.map,networkOwnerId:row.id,seed:2016,
            collisionSampler:()=>[],effectSampler:()=>[],defenderSampler:()=>[],actors:value.snapshot.actors.map(actor=>({
              id:actor.id,team:actor.team,professionId:actor.professionId,loadout:actor.loadout,position:[actor.x,actor.y,actor.z],lineId:actor.lineId}))});
            row.sync=createLocalOwnershipSync({ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1});}
          return row.sync.reconcile(row.simulation,value,row.id);
        }
        if(!row.sync)return;
        if(type==='owner-status')return row.sync.receiveStatus(row.simulation,value.playerId,value.status,row.id);
        if(type==='owner-actions')return row.sync.receiveActions(value.playerId,value.actions,value.epoch,value.frameSeq);
        if(type==='peer-owned-state')return row.sync.receivePeerResult(row.simulation,value.playerId,value.report,row.id);
        if(type==='disconnect')return row.sync.disconnect(row.simulation,value.playerId);
      }});
    await row.client.open();
  }
  for(const row of rows){
    const response=await row.request('/api/online/queue',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode:'2v2',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1})});
    assert.equal(response.status,200);await response.json();
  }
  now+=11000;await context.online.tick();
  await until(()=>rows.every(row=>row.events.some(event=>event.type==='match')),rows,'four negotiated matches');
  for(const row of rows)await row.client.ready(room.id);driver.tick(10);
  await until(()=>rows.every(row=>row.events.some(event=>event.type==='state'&&event.value.pvp.phase==='fight')),rows,'four fight baselines');
  const step=row=>{
    row.sync.beforeStep(row.simulation,row.id);row.simulation.step(1/60,{[row.id]:input},{snapshot:false});
    const events=row.simulation.drainEvents(),report=row.sync.afterStep(row.simulation,row.id,events,input);return {report,events};
  };
  const send=async(row,report)=>{
    assert.ok(report,'real source producer must return a report');const before=row.uploads.length,frame=row.client.send(input,report);
    row.sync.recordSentFrame(row.simulation,row.id,frame);
    await until(()=>row.uploads.slice(before).some(value=>value.body.owner?.frameSeq===frame),rows,'actual HTTP owner acknowledgement');
    const upload=row.uploads.slice(before).find(value=>value.body.owner?.frameSeq===frame);assert.equal(upload.status,200);assert.equal(upload.ack.accepted,true);return upload;
  };
  return {rows,context,get driver(){return driver;},get serverSimulation(){return serverSimulation;},room,step,send};
}

test('four authenticated playback owners receive starts and independent protection over FIFO SSE while legacy attacks and old lives are rejected',async t=>{
  const f=await fixture(t),source=f.rows[0],others=f.rows.slice(1),actor=source.simulation.actor(source.id);
  const initial=await f.send(source,f.step(source).report);
  await until(()=>others.every(row=>row.events.some(event=>event.type==='peer-owned-state'&&event.value.report.frameSeq===initial.body.owner.frameSeq)),f.rows,'initial shared source body');
  const oldX=f.serverSimulation.actor(source.id).x,ownBefore=others.map(row=>structuredClone(row.simulation.actor(row.id)));
  source.simulation.enter(actor,'RSI_OVER_TAKER_COMBO_XXfrontXX','frozen-armored-command-fixture');actor.x+=120;assert.equal(actor.superArmor,true);
  let attack;
  for(let i=0;i<60;i++){const value=f.step(source);if(value.report?.actions.some(action=>action.playback?.version===1&&action.playback.start===true)){attack=value.report;break;}}
  assert.ok(attack,'the actual local action transition must produce a canonical playback start');assert.equal(attack.actor.superArmor,true);
  assert.ok(attack.actions.every(action=>action.playback?.version===1),'a negotiated producer never mixes historical collision records into playback');
  const held=await f.send(source,{...attack,actionFrontierComplete:false});
  assert.equal(held.ack.ignored,'actions-pending');assert.deepEqual(held.ack.consumedActionIds,held.body.owner.actions.map(action=>action.id));
  assert.equal(f.serverSimulation.actor(source.id).x,oldX);assert.equal(f.driver.snapshot().ownership.actors[source.id].frameSeq,initial.body.owner.frameSeq);
  const revision=held.body.owner.actor.sourceStatusClock.revision;
  await until(()=>others.every(row=>row.events.some(event=>event.type==='owner-status'&&event.value.playerId===source.id&&event.value.status.actor.sourceStatusClock.revision===revision)),f.rows,'priority status over SSE');
  await until(()=>others.every(row=>row.events.some(event=>event.type==='owner-actions'&&event.value.playerId===source.id&&event.value.actions.some(action=>held.ack.consumedActionIds.includes(action.id)))),f.rows,'independent canonical action delivery');
  assert.equal(f.driver.snapshot().ownership.combatPlaybackVersion,1);
  for(const row of others){
    const received=row.events.filter(event=>event.type==='owner-actions'&&event.value.playerId===source.id).flatMap(event=>event.value.actions);
    assert.ok(received.some(action=>action.playback?.version===1&&action.playback.start===true));
    const ordered=row.sources.flatMap(stream=>stream.wireEvents).filter(event=>event.type==='owner-status'||event.type==='input');
    const statusIndex=ordered.findIndex(event=>event.type==='owner-status'&&event.data.playerId===source.id&&event.data.status.actor.sourceStatusClock.revision===revision);
    const actionIndex=ordered.findIndex(event=>event.type==='input'&&event.data.playerId===source.id&&event.data.frameSeq===held.body.owner.frameSeq);
    assert.ok(statusIndex>=0&&actionIndex>statusIndex,'the source status and canonical action remain ordered on the same SSE stream');
  }
  for(const [index,row]of others.entries()){
    assert.equal(row.simulation.actor(source.id).superArmor,true);assert.equal(row.simulation.actor(source.id).x,oldX);
    assert.deepEqual(row.simulation.actor(row.id),ownBefore[index],'another owner status cannot replace local combat results');
  }
  assert.equal(source.sources.flatMap(stream=>stream.wireEvents).some(event=>event.type==='owner-status'&&event.data.playerId===source.id),false,'server never echoes protection authority back to its owner');
  // A false-frontier receipt can schedule another upload without a new source
  // step. Wait for every real HTTP upload to finish, then choose the next wire
  // sequence so this probe reaches playback validation rather than replay
  // rejection. sentPosts/samples count dispatches/completions in this fixture.
  await until(()=>{const value=source.client.performance();return value.pendingFrames===0&&value.sentPosts===value.samples;},f.rows,'idle HTTP source before historical-action probe');
  const historical=structuredClone(held.body);historical.sequence=Math.max(...source.uploads.map(row=>row.body.sequence))+1;
  for(const action of historical.owner.actions)delete action.playback;
  const eventCount=others.map(row=>row.events.filter(event=>event.type==='owner-actions'&&event.value.playerId===source.id).length);
  const rejected=await source.request('/api/online/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(historical)});
  assert.equal(rejected.status,400);assert.equal((await rejected.json()).error,'invalid-request');
  assert.deepEqual(others.map(row=>row.events.filter(event=>event.type==='owner-actions'&&event.value.playerId===source.id).length),eventCount,'a historical packet cannot escape into this room');
  const receiver=others[0],observed=receiver.events.find(event=>event.type==='owner-status'&&event.value.status.actor.sourceStatusClock.revision===revision).value.status;
  const localBefore=structuredClone(actor);assert.equal(source.sync.receiveStatus(source.simulation,source.id,observed,source.id),false);assert.deepEqual(actor,localBefore);
  let releaseReport;for(let i=0;i<6&&!releaseReport;i++)releaseReport=f.step(source).report;
  assert.ok(releaseReport,'a later real source step releases the normal body frontier');
  const released=await f.send(source,releaseReport);assert.equal(released.ack.ignored,undefined);assert.equal(f.serverSimulation.actor(source.id).x,released.body.owner.actor.x);
  await until(()=>others.every(row=>row.events.some(event=>event.type==='peer-owned-state'&&event.value.report.frameSeq===released.body.owner.frameSeq)),f.rows,'released body frontier');
  source.simulation.enter(actor,'RSI_WAIT','local-armor-ended');const ended=await f.send(source,{...f.step(source).report,actionFrontierComplete:false});
  await until(()=>others.every(row=>row.simulation.actor(source.id).superArmor===false),f.rows,'current armor end');
  for(const row of others){assert.equal(row.sync.receiveStatus(row.simulation,source.id,observed,row.id),false);assert.equal(row.simulation.actor(source.id).superArmor,false);}
  const corpse=source.simulation.actor(source.id);corpse.hp=0;source.simulation.enter(corpse,'RSI_DIE_FRONT','completed-death-fixture');corpse.deathComplete=true;corpse.hidden=true;
  await f.send(source,f.step(source).report);f.driver.tick(.1);f.driver.tick(13);
  await until(()=>f.rows.every(row=>row.sync.epoch(source.id)===2),f.rows,'real driver-issued shared respawn');
  const revived=await f.send(source,f.step(source).report);assert.equal(revived.body.owner.epoch,2);
  await until(()=>others.every(row=>row.events.some(event=>event.type==='owner-status'&&event.value.playerId===source.id&&event.value.status.epoch===2)),f.rows,'new-life source status');
  for(const row of others){const before=structuredClone(row.simulation.actor(source.id));assert.equal(row.sync.receiveStatus(row.simulation,source.id,observed,row.id),false);assert.deepEqual(row.simulation.actor(source.id),before);}
  // Replay bytes from the real old-life upload under the same authenticated
  // session. No new clock or actor state is manufactured for this check.
  const stale=await source.request('/api/online/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...held.body,sequence:revived.body.sequence+1})});
  assert.equal(stale.status,200);const staleAck=await stale.json();assert.equal(staleAck.ignored,'old-life');assert.deepEqual(staleAck.consumedActionIds,[]);
  assert.equal(f.driver.snapshot().owners[source.id].status.epoch,2);
  const newest=others[0].events.filter(event=>event.type==='owner-status'&&event.value.playerId===source.id&&event.value.status.epoch===2).at(-1).value.status;
  const logout=await source.request('/api/logout',{method:'POST'});assert.equal(logout.status,200);await logout.json();source.client.close();
  await until(()=>others.every(row=>row.simulation.actor(source.id).pvpDisconnected),others,'authenticated logout retires the shared actor');
  assert.equal(f.driver.snapshot().owners[source.id],undefined);
  for(const row of others){const before=structuredClone(row.simulation.actor(source.id));assert.equal(row.sync.receiveStatus(row.simulation,source.id,newest,row.id),false);assert.deepEqual(row.simulation.actor(source.id),before);assert.equal(row.simulation.actor(source.id).hidden,true);}
  assert.ok(ended.body.owner.actor.sourceStatusClock.revision>revision);for(const row of others)assert.deepEqual(row.errors,[]);
});
