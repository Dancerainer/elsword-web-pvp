import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Real native collisions across a controlled600ms HTTP-only transport.
 * Network timing and hit policy are Web regressions, not target-client goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {ION_BLACK_HOLE_NAME} from '../../packages/combat-core/black-hole.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
const players=['sender','ally','receiver','enemy'].map((id,index)=>({id,username:id,team:index<2?0:1}));
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function simulation(skillId,owner){
  const {native,samplers}=await assets.createRuntime();
  const sim=createSimulation({profile:assets.profile,map:assets.map,seed:2016,networkOwnerId:owner,
    preset:{...authoredEquipmentPreset(assets.preset),onlineMatch:true,loadout:[{skillId},null,null,null,null,null,null,null]},
    actors:players.map((player,index)=>({...player,position:[index===0?2022.98:index===2?1920:10000+index*1000,2840,0],lineId:6,facing:index===0?-1:1})),...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
  return sim;
}
for(const action of [{key:'Z',skillId:24025},{key:'A',skillId:24204}])test(`600ms HTTP-only ${action.key} history reaches an independent native victim, with no victim replay or duplicate damage`,async t=>{
  const host=await simulation(action.skillId,null),sender=await simulation(action.skillId,'sender'),victim=await simulation(action.skillId,'receiver');
  const senderSync=createLocalOwnershipSync(),victimSync=createLocalOwnershipSync(),pvp=new PvpMatch({players,map:assets.map,seed:2016,versions:host.versions});
  let frame=0;const delivered=[],posts=[],jobs=[],receivedHits=[],wire=[];
  const driver=createLocalOwnerBattleDriver({match:{id:'delayed-native',players},simulation:host,pvp,manual:true,clock:()=>frame*1000/60,
    finish:()=>{},emit:(type,data)=>{
      if(type==='input'){delivered.push(structuredClone(data));victimSync.receiveActions(data.playerId,data.actions,data.epoch,data.frameSeq);}
      if(type==='state')victimSync.reconcile(victim,data,'receiver');
    }});t.after(()=>driver.stop());
  for(const p of players)driver.ready(p.id);driver.tick(10);
  // Fixture vitals and close positions are deliberate. The rule start values
  // and map starts have separate source-derived tests.
  for(const sim of [host,sender,victim])for(const id of ['sender','receiver']){
    const a=sim.actor(id);a.x=id==='sender'?2022.98:1920;a.y=2840;a.z=0;a.lineId=6;a.grounded=true;a.landPosition=[a.x,a.y,0];a.facing=id==='sender'?-1:1;a.mp=a.mpMax;a.inputLock=0;sim.enter(a,'RSI_WAIT','latency-fixture');
  }
  const initial=driver.snapshot();senderSync.reconcile(sender,initial,'sender');victimSync.reconcile(victim,initial,'receiver');
  const hp=victim.actor('receiver').hp;victim.restore=()=>{throw Error('must not replay the victim');};
  const originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval;const callbacks=[];
  globalThis.setInterval=callback=>{callbacks.push(callback);return 1;};globalThis.clearInterval=()=>{};
  class Source{addEventListener(){}close(){}}
  const errors=[];const client=createOnlineClient({EventSource:Source,RTCPeerConnection:null,onError:e=>errors.push(e),fetch:async(url,options)=>{
    if(url!=='/api/online/input')return {ok:true,json:async()=>({})};
    const body=JSON.parse(options.body);validateOwnedState(body.owner);posts.push(body);
    return new Promise(resolve=>jobs.push({body,resolve,arrive:frame+18,respond:frame+36,submitted:false}));
  }});
  t.after(()=>{client.close();for(const job of jobs)job.resolve({ok:true,json:async()=>({})});globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;});
  await client.open();await client.setMatch({id:'delayed-native',ownership:'local-owner-v1',players},'sender');
  for(frame=1;frame<=180;frame++){
    senderSync.beforeStep(sender,'sender');sender.step(1/60,frame===7?{sender:{held:[action.key],pressed:[action.key]}}:{},{snapshot:false});
    const sample=senderSync.afterStep(sender,'sender',sender.drainEvents());if(sample)client.send({held:[],pressed:[],released:[]},sample);
    victimSync.beforeStep(victim,'receiver');victim.step(1/60,{}, {snapshot:false});receivedHits.push(...victim.drainEvents().filter(e=>e.type==='hit'&&e.targetId==='receiver'));
    for(const job of jobs){
      if(!job.submitted&&frame>=job.arrive){job.submitted=true;driver.submitInput('sender',job.body);wire.push({frame,owner:job.body.owner});}
      if(frame>=job.respond){job.resolve({ok:true,json:async()=>({accepted:true})});job.respond=Infinity;}
    }
    if(frame%6===0)driver.tick(.1);if(frame%3===0){void callbacks[0]();await settle();}
  }
  assert.equal(sender.state.step,180);assert.equal(victim.state.step,180);
  assert.ok(posts.length<=6,'one latest upload remains pending instead of sixty-Hz input FIFO');
  assert.ok(delivered.some(data=>data.actions.length),'critical histories actually traversed production room relay');
  assert.ok(receivedHits.length>0,'delayed native collision must damage the receiving owner');
  assert.ok(victim.actor('receiver').hp<hp);assert.equal(sender.actor('receiver').hp,hp,'sender never owns victim HP');
  if(action.key==='Z'){assert.equal(receivedHits.length,1);assert.equal(wire[1].owner.actor.state,'RSI_WAIT','short attack ended before the next replaceable upload');}
  const before=victim.actor('receiver').hp;
  for(const data of delivered)victimSync.receiveActions(data.playerId,data.actions,data.epoch,data.frameSeq);
  for(let i=0;i<10;i++){victimSync.beforeStep(victim,'receiver');victim.step(1/60,{}, {snapshot:false});victim.drainEvents();}
  assert.equal(victim.actor('receiver').hp,before,'repeated named histories must not deal damage again');
  assert.ok(!errors.length,errors.map(e=>e.message).join(', '));
});

test('late histories expire by source sixty-Hz frame age, local receipt age and life epoch',async()=>{
  const source=await simulation(24025,'sender'),victim=await simulation(24025,'receiver');let now=0;
  for(let frame=1;frame<=20;frame++)source.step(1/60,frame===1?{sender:{held:['Z'],pressed:['Z']}}:{},{snapshot:false});
  const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq:20}),action=encodeCriticalAction(report,{id:20});
  const consumer=createRemoteActionConsumer({clock:()=>now}),hp=victim.actor('receiver').hp;
  consumer.receive('sender',[action],1,81);assert.equal(consumer.pending,0,'61source frames is over one second');
  consumer.receive('sender',[{...action,id:21}],1,20);now=1001;assert.equal(consumer.consume(victim,'receiver',()=>1),0);
  consumer.receive('sender',[{...action,id:22}],1,20);assert.equal(consumer.consume(victim,'receiver',()=>2),0);
  assert.equal(victim.actor('receiver').hp,hp);assert.equal(victim.state.step,0);
});

test('temporary native Nuclear history leaves no black-hole control identity after restoring newest effects',async()=>{
  const source=await simulation(24007,'sender'),victim=await simulation(24007,'receiver');
  for(let frame=1;frame<=47;frame++)source.step(1/60,frame===1?{sender:{held:['A'],pressed:['A']}}:{},{snapshot:false});
  const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq:47});
  assert.ok(report.effects.some(effect=>effect.name===ION_BLACK_HOLE_NAME),'actual native source produced the black-hole mesh');
  const action=encodeCriticalAction(report,{id:47,effectIds:new Set(report.effects.map(effect=>effect.id))}),consumer=createRemoteActionConsumer({clock:()=>0});
  const original=victim.state.effects;consumer.receive('sender',[action],1,50);assert.equal(consumer.consume(victim,'receiver',()=>1),1);
  assert.deepEqual(victim.actor('receiver').effectiveBlackHoleIds,[]);assert.deepEqual(victim.state.effects,original);
  victim.step(1/60,{}, {snapshot:false});assert.notEqual(victim.skillAvailability('receiver','A').reason,'black-hole-held');
});
