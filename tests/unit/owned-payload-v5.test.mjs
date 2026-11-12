import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
const buff=(templateId=545,remaining=9)=>({schemaVersion:1,templateId,factorId:1,skillLevel:1,sourceActorId:'source',targetActorId:'target',
 accumulationLimit:1,resistance:0,durationMultiplier:1,behaviors:[{type:1,kind:'mpInterval',value:-4,changeType:1,interval:1,sum:0}],
 finalizers:[{kind:'time',sourceDuration:10,remaining}],displayer:{BDT_EFFECT_SET:['original-buff-display']}});
const effect=(id=1,elapsed=0)=>({id,name:'original-effect',setName:'original-set',elapsed,animationTime:elapsed,
 birthAnchor:{position:[1,2,3],facing:1},sourceGeometry:{size:[4,5,6],rotation:[0,0,0]},active:true});
const actor=()=>({x:10,y:0,state:'ATTACK',stateSerial:1,stateTime:0,animationTime:0,hp:100,mp:50,buffs:[buff()],
 core:{phase:'idle',gauge:10,phaseTime:0},cooldowns:{one:0,two:1}});
const report=(frameSeq=1,epoch=1)=>({protocol:'local-owner-v1',epoch,frameSeq,actor:actor(),effects:[effect()],hits:[]});
const event=(frameSeq=1,epoch=1)=>({playerId:'source',matchId:'fixture-match',epoch,frameSeq,actions:[{id:frameSeq,frameSeq,actor:actor(),effects:[effect()]}]});
function transfer(p,c,r){const packet=p.encodeSplit('source',r,{deltaVersion:3});if(packet.baseline)c.decode(packet.baseline);return {packet,value:c.decode(packet.value)};}

test('v3 buff templates are reliable once and timer changes survive missing intermediates and exact empty-list removal',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=report();assert.deepEqual(transfer(p,c,start).value,start);
 const mid=report(2);mid.actor.buffs[0].finalizers[0].remaining=8;p.encodeSplit('source',mid,{deltaVersion:3});
 const next=report(3);next.actor.buffs[0].finalizers[0].remaining=2;next.actor.buffs.push(buff(52,1));
 const packet=p.encodeSplit('source',next,{deltaVersion:3});assert.deepEqual(packet.baseline.buffBaselines.map(b=>b.templateId),[52]);
 c.decode(packet.baseline);assert.deepEqual(c.decode(packet.value),next);
 const gone=report(4);gone.actor.buffs=[];const removed=transfer(p,c,gone);assert.equal(removed.packet.baseline,null);assert.deepEqual(removed.value,gone);
 const reapply=report(5);reapply.actor.buffs[0].behaviors[0].value=-8;reapply.actor.buffs[0].finalizers[0].remaining=10;
 assert.deepEqual(transfer(p,c,reapply).value,reapply);
});

test('v2 remains unchanged while v3 rejects unknown, duplicate and substituted buff identities',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=report();
 assert.equal(p.encodeSplit('legacy',start).value.deltaVersion,2);
 const first=transfer(p,c,start),bad=structuredClone(first.packet.value);
 bad.buffs.push(structuredClone(bad.buffs[0]));assert.throws(()=>c.decode(bad),/buff-identity/);
 bad.buffs=[{id:999,fields:{},removed:[]}];assert.throws(()=>c.decode(bad),/buff-baseline-required/);
 bad.buffs=[{id:545,fields:{templateId:52},removed:[]}];assert.throws(()=>c.decode(bad),/buff-identity/);
 assert.deepEqual(c.decode(first.packet.value),start);
 const next=report(0,2);transfer(p,c,next);assert.throws(()=>c.decode(first.packet.value),/baseline-required/);
 const fresh=createOwnedRelayDelta();assert.throws(()=>fresh.decode(p.encodeSplit('source',report(2,2),{deltaVersion:3}).value),/baseline-required/);
});

test('v3 bounded buff history retains current identities even if all dynamic packets are suppressed by RTC',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();let latest,last;
 for(let id=1;id<=600;id++){
  last=report(id);last.actor.buffs=[buff(id)];latest=p.encodeSplit('source',last,{deltaVersion:3});
  c.decode(latest.baseline);assert.ok(p.baselineCount<=514);assert.ok(c.baselineCount<=514);
 }
 assert.deepEqual(c.decode(latest.value),last);
 const bad={...latest.baseline,liveBuffIds:[600,600]};assert.throws(()=>c.decode(bad),/buff-baseline/);
});

test('ordinary baselines reject old lives and corrupted next-life definitions atomically',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),old=report(1,1);
 const initial=p.encodeSplit('source',old,{deltaVersion:3});c.decode(initial.baseline);c.decode(initial.value);
 const next=report(1,2);next.actor.hp=77;const life=p.encodeSplit('source',next,{deltaVersion:3});
 for(const mutate of [
  value=>{value.effectBaselines.push(structuredClone(value.effectBaselines[0]));},
  value=>{value.buffBaselines.push(structuredClone(value.buffBaselines[0]));},
  value=>{value.effectBaselines[0].id=-1;},
 ]){const bad=structuredClone(life.baseline);mutate(bad);assert.throws(()=>c.decode(bad),/baseline/);
  assert.deepEqual(c.decode(initial.value),old,'bad new life preserves the last healthy actor/effect/buff table');}
 c.decode(life.baseline);assert.deepEqual(c.decode(life.value),next);
 assert.throws(()=>c.decode(initial.baseline),/old-life/);assert.deepEqual(c.decode(life.value),next);
 // A conflicting same-life birth cannot partially insert a preceding new ID.
 const conflict=structuredClone(life.baseline);conflict.effectBaselines.unshift(effect(999));conflict.buffBaselines[0].skillLevel=9;
 assert.throws(()=>c.decode(conflict),/baseline-conflict/);
 const absent=structuredClone(life.value);absent.effects=[{id:999,fields:{},removed:[]}];
 assert.throws(()=>c.decode(absent),/effect-baseline-required/);assert.deepEqual(c.decode(life.value),next);
 for(const epoch of [2,1]){
  const reportValue=report(1,epoch);if(epoch===2)assert.deepEqual(c.decode({playerId:'legacy',full:true,report:reportValue}),reportValue);
  else assert.throws(()=>c.decode({playerId:'legacy',full:true,report:reportValue}),/old-life/);
 }
});

test('reliable action deltas restore exact multi-sample actors, effects, buffs, absent fields and rebirths',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=event();
 assert.deepEqual(c.decodeActions(p.encodeActions('source',start)),start);
 const next=event(8);next.actions=[3,6,8].map(n=>({id:n,frameSeq:n,actor:{...actor(),animationTime:n/60,
  buffs:n===3?[]:[buff(545,10-n/60)],temporary:n},effects:[effect(1,n/60),effect(2,n/60)]}));
 delete next.actions[2].actor.temporary;delete next.actions[1].actor.core;
 const encoded=p.encodeActions('source',next);assert.equal(encoded.actionActorBaseline,undefined);
 assert.deepEqual(encoded.actionEffectBaselines.map(e=>e.id),[2]);assert.deepEqual(c.decodeActions(encoded),next);
 assert.deepEqual(c.decodeActions(encoded),next,'reliable replay leaves collision deduplication to existing consumer');
 const life=event(0,2);life.actions[0].actor.hp=77;const newer=p.encodeActions('source',life);
 assert.deepEqual(c.decodeActions(newer),life);assert.throws(()=>c.decodeActions(encoded),/old-life/);
 assert.deepEqual(c.decodeActions(newer),life,'stale previous life cannot erase current baseline');
});

test('each critical action is independently based on reliable birth rather than previous action patch',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();c.decodeActions(p.encodeActions('source',event()));
 const middle=event(2);middle.actions[0].actor.mp=10;p.encodeActions('source',middle);
 const newest=event(3);newest.actions[0].actor.mp=20;newest.actions[0].effects[0].elapsed=1;
 assert.deepEqual(c.decodeActions(p.encodeActions('source',newest)),newest);
});

test('corrupt action patches, prototype keys, baseline conflicts and identity substitution fail without cache poisoning',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=event();c.decodeActions(p.encodeActions('source',start));
 const next=event(2);next.actions[0].effects=[effect(2,.1)];const packet=p.encodeActions('source',next);
 for(const alter of [
  v=>{v.actions[0].effects[0].fields.id=44;},
  v=>{v.actions[0].actor.fields=JSON.parse('{"__proto__":{"polluted":true}}');},
  v=>{v.actions[0].actor.nested={missing:{fields:{x:1},removed:[]}};},
  v=>{v.actionEffectBaselines.push({...effect(2),name:'conflict'});},
  v=>{v.actions[0].buffs.push(structuredClone(v.actions[0].buffs[0]));},
 ]){const bad=structuredClone(packet);alter(bad);assert.throws(()=>c.decodeActions(bad),/action-delta/);assert.equal({}.polluted,undefined);}
 assert.deepEqual(c.decodeActions(packet),next);
 const conflict=structuredClone(packet);conflict.actionEffectBaselines[0].name='changed';assert.throws(()=>c.decodeActions(conflict),/conflict/);
 assert.deepEqual(c.decodeActions(packet),next);
});

test('critical event cache fanout is explicit, reset leases restore their own baselines, and retired histories stay bounded',()=>{
 const encoders=Array.from({length:5},()=>createOwnedRelayDelta()),decoders=Array.from({length:5},()=>createOwnedRelayDelta()),start=event(),key={};
 const packets=encoders.map(p=>p.encodeActions('source',start,{cacheKey:key}));
 for(let i=0;i<5;i++){assert.equal(packets[i],packets[0]);assert.deepEqual(decoders[i].decodeActions(packets[i]),start);}
 for(let i=2;i<620;i++){const next=event(i);next.actions[0].effects=[effect(i)];next.actions[0].actor.buffs=[buff(i)];
  assert.deepEqual(decoders[0].decodeActions(encoders[0].encodeActions('source',next)),next);assert.ok(encoders[0].baselineCount<=1025);assert.ok(decoders[0].baselineCount<=1025);}
 decoders[0].clear();assert.throws(()=>decoders[0].decodeActions(encoders[0].encodeActions('source',event(621))),/baseline-required/);
 encoders[0].clear();assert.deepEqual(decoders[0].decodeActions(encoders[0].encodeActions('source',event(622))),event(622));
});

test('browser dispatch restores v3 reliable actions before consumers and a new relay lease cannot inherit old action baselines',async t=>{
 const sources=[],events=[],errors=[];
 class Source{constructor(){this.handlers=new Map();sources.push(this);}addEventListener(type,fn){this.handlers.set(type,fn);}close(){}
  emit(type,data){this.handlers.get(type)?.({data:JSON.stringify(data)});}}
 const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:null,
  fetch:async()=>({ok:true,json:async()=>({available:true})}),onEvent:(type,data)=>events.push({type,data}),onError:error=>errors.push(error)});
 t.after(()=>client.close());await client.open();await client.setMatch({id:'fixture-match',ownership:'local-owner-v1',players:[{id:'local'},{id:'source'}]},'local');
 const p=createOwnedRelayDelta(),first=event(),deliver=(packet,relayToken)=>sources[0].emit('input',{...packet,relayToken});
 deliver(p.encodeActions('source',first),'lease-1');
 assert.deepEqual(events.filter(row=>row.type==='owner-actions').at(-1).data,{...first,relayToken:'lease-1'});
 const later=event(2),patch=p.encodeActions('source',later);deliver(patch,'lease-1');
 assert.deepEqual(events.filter(row=>row.type==='owner-actions').at(-1).data,{...later,relayToken:'lease-1'});
 const before=events.length;deliver(patch,'lease-2');assert.equal(events.length,before);assert.match(errors.at(-1).message,/baseline-required/);
 const fresh=createOwnedRelayDelta();deliver(fresh.encodeActions('source',event(3)),'lease-2');
 assert.deepEqual(events.filter(row=>row.type==='owner-actions').at(-1).data,{...event(3),relayToken:'lease-2'});
});
