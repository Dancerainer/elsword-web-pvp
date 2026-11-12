/** Production HTTP upload coalescing -> strict server owner consumer -> remote
 * playback. Explicit original reaction state entry isolates wire semantics;
 * this is not a fabricated original-client hit trajectory or WAN evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation,CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {consumeLocalOwnerWorkerInput} from '../../packages/online/service.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url))),input={held:[],pressed:[],released:[]};
const players=['a','b','c','d'].map((id,index)=>({id,username:id,team:index<2?0:1,loadout:Array(8).fill(null)}));
const map={sceneId:'merged-relay-v33',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((player,index)=>({index,kind:'SetTeamStartPos',teamFlag:player.team===0,position:[index*1000,0,0],lineId:0,facingRight:true}))};
const make=owner=>createSimulation({profile,map,preset:{passives:[],guildPassives:[]},networkOwnerId:owner,
  actors:players.map((player,index)=>({...player,position:[index*1000,0,0],lineId:0,passives:[],guildPassives:[]})),seed:2016});
const settle=async()=>{for(let n=0;n<60;n++)await Promise.resolve();};
const response=value=>({ok:true,status:200,json:async()=>value});

test('a replaced HTTP body cannot erase an earlier action launch, STOP or direct reaction ramp in relay-only mode',async t=>{
  t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});
  const server=make(null),source=make('a'),receiver=make('c'),events=[],posts=[],errors=[],sourceSync=createLocalOwnershipSync(),sync=createLocalOwnershipSync();
  const pvp=new PvpMatch({players,map,mode:'2v2',seed:2016,versions:{referenceVersion:server.versions.baseline,presetVersion:server.versions.preset,programVersion:CORE_VERSION}}),
    match={id:'merged-relay-v33',players,ownership:'local-owner-v1',ownerStatusVersion:1,continuousAuraVersion:2,combatPlaybackVersion:1},
    driver=createLocalOwnerBattleDriver({match,simulation:server,pvp,manual:true,clock:()=>0,emit:(type,data)=>events.push({type,data}),finish(){}});
  t.after(()=>{driver.stop();sync.clear();sourceSync.clear();});for(const player of players)driver.ready(player.id);driver.tick(10);
  const baseline=driver.snapshot();assert.equal(baseline.pvp.phase,'fight');sourceSync.reconcile(source,baseline,'a');sync.reconcile(receiver,baseline,'c');events.length=0;
  class Source{addEventListener(){}close(){}}
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:null,WebSocket:null,clock:()=>0,onError:error=>errors.push(error),
    fetch:async(url,options)=>{if(url!=='/api/online/input')return response({accepted:true});
      return new Promise(resolve=>posts.push({body:JSON.parse(options.body),resolve}));}});
  t.after(async()=>{client.close();for(const post of posts)post.resolve(response({accepted:false}));await settle();});
  await client.open();await client.setMatch(match,'a');
  function report(frame){
    const value=encodeOwnedState(source,'a',{epoch:baseline.ownership.actors.a.epoch,frameSeq:frame});
    value.actor.forceInvincible=source.actor('a').forceInvincible;
    value.actor.sourceStatusClock={version:1,revision:1,frameSeq:frame};
    const action=encodeCriticalAction(value,{id:frame});action.playback={version:1,start:true,held:[]};value.actions=[action];return validateOwnedState(value);
  }
  source.enter(source.actor('a'),'RSI_WAIT','explicit-relay-initial');client.send(input,report(1));await settle();assert.equal(posts.length,1);
  const actor=source.actor('a');source.advanceAnimation(actor,profile.states[actor.state],.5);
  Object.assign(actor,{vx:-420,vy:730,vz:18,grounded:false,lineId:null,lastAttackerFront:false});
  source.enter(actor,'RSI_DAMAGE_SMALL_FRONT','explicit-original-reaction',{directChange:true});actor.hitStop=.12;
  const reaction=report(2);client.send(input,reaction);
  source.enter(actor,'RSI_WAIT','explicit-following-controller');Object.assign(actor,{hitStop:0,vx:0,vy:0,vz:0,grounded:true,lineId:0});
  client.send(input,report(3));await settle();assert.equal(posts.length,1,'only the first HTTP request is in flight');
  function deliver(post,{newestBodyFirst=false}={}){
    const result=consumeLocalOwnerWorkerInput(driver,'a',post.body),batch=events.splice(0);
    if(newestBodyFirst)batch.sort((a,b)=>(a.type==='owned-state'?-1:0)-(b.type==='owned-state'?-1:0));
    for(const event of batch){if(event.type==='input'&&event.data.playerId==='a')sync.receiveActions('a',event.data.actions,event.data.epoch,event.data.frameSeq);
      if(event.type==='owned-state'&&event.data.playerId==='a')assert.equal(sync.receivePeerResult(receiver,'a',event.data.report,'c').validated,true);}
    post.resolve(response(result));return result;
  }
  deliver(posts[0]);await settle();assert.equal(posts.length,2);
  sync.beforeStep(receiver,'c');receiver.step(1/60,sync.remoteInputs(receiver,'c'),{snapshot:false});sync.afterStep(receiver,'c',receiver.drainEvents(),input);
  const merged=posts[1].body.owner;assert.equal(merged.frameSeq,3);assert.equal(merged.actor.hitStop,0);
  assert.deepEqual(merged.actions.map(action=>action.frameSeq),[2,3]);assert.equal(merged.actions[0].actor.hitStop,.12);
  assert.equal(merged.actions[0].actor.presentationTransition.enabled,false);assert.equal(merged.actions[0].actor.animationSpeedRamp,null);
  const accepted=deliver(posts[1],{newestBodyFirst:true});await settle();assert.deepEqual(accepted.consumedActionIds,[2,3]);
  const local=structuredClone(receiver.actor('c'));sync.beforeStep(receiver,'c');const remote=receiver.actor('a');
  assert.equal(remote.state,reaction.actor.state);assert.equal(remote.vx,reaction.actor.vx);assert.equal(remote.vy,reaction.actor.vy);assert.equal(remote.vz,18);
  assert.equal(remote.hitStop,.12);assert.equal(remote.grounded,false);assert.equal(remote.animationSpeedRamp,null);assert.equal(remote.presentationTransition.enabled,false);
  assert.deepEqual(receiver.actor('c'),local,'relay admission cannot rewrite any local-owner field');
  receiver.step(1/60,sync.remoteInputs(receiver,'c'),{snapshot:false});sync.afterStep(receiver,'c',receiver.drainEvents(),input);sync.beforeStep(receiver,'c');
  assert.equal(remote.state,'RSI_WAIT');assert.equal(remote.hitStop,0);assert.equal(sync.combatPlaybackDiagnostics.receiver.pending,0);assert.deepEqual(errors,[]);
  const corrupt=structuredClone(merged);corrupt.actions[0].actor.animationSpeedRamp={elapsedSeconds:0,durationSeconds:'bad'};
  assert.throws(()=>consumeLocalOwnerWorkerInput(driver,'a',{...posts[1].body,sequence:99,owner:corrupt}),/invalid-owner-state/);
});
