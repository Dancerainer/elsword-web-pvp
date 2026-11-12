import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';

const initial=()=>({protocol:'local-owner-v1',epoch:1,frameSeq:1,
 actor:{x:0,mp:10,state:'WAIT',core:{phase:'idle',phaseTime:0,helper:{scale:1,offset:[0,0,0]}},
 cooldowns:{one:0,two:0},buffs:[{id:10,remaining:1}],temporary:{active:true}},effects:[],hits:[]});
function transfer(producer,consumer,report){
 const packet=producer.encodeSplit('other',report);
 if(packet.baseline)assert.equal(consumer.decode(packet.baseline),null);
 return {packet,report:consumer.decode(packet.value)};
}

test('split relay keeps new effect templates reliable while every dynamic body remains replaceable',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=initial();
 assert.deepEqual(transfer(p,c,start).report,start);
 const one={...start,frameSeq:2,actor:{...start.actor,x:2,mp:20},effects:[{id:1,name:'one',elapsed:0,anchor:{position:[0,0,0],facing:1}}]};
 const a=p.encodeSplit('other',one);assert.equal(a.baseline.actorBaseline,undefined);
 assert.deepEqual(a.baseline.effectBaselines.map(e=>e.id),[1]);assert.equal(a.value.full,false);c.decode(a.baseline);
 // Drop this entire replaceable clock report, then receive another birth.
 const two={...one,frameSeq:3,actor:{...one.actor,x:4},effects:[{...one.effects[0],elapsed:.1},{id:2,name:'two',elapsed:0}]};
 const b=p.encodeSplit('other',two);assert.deepEqual(b.baseline.effectBaselines.map(e=>e.id),[2]);c.decode(b.baseline);
 const newest={...two,frameSeq:4,actor:{...two.actor,x:9},effects:[{...two.effects[1],elapsed:.2}]};
 const d=p.encodeSplit('other',newest);assert.equal(d.baseline,null);assert.deepEqual(c.decode(d.value),newest);
});

test('nested clocks, deleted optional state, arrays and resource protection reconstruct exactly',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=initial();transfer(p,c,start);
 const actor={...start.actor,core:{...start.actor.core,phaseTime:.125},cooldowns:{...start.actor.cooldowns,one:.5},buffs:[],protection:null};delete actor.temporary;
 const report={...start,frameSeq:2,actor},row=p.encodeSplit('other',report);
 assert.deepEqual(row.value.actor.nested.core,{fields:{phaseTime:.125},removed:[]});
 assert.deepEqual(row.value.actor.nested.cooldowns,{fields:{one:.5},removed:[]});
 assert.deepEqual(row.value.actor.removed,['temporary']);assert.deepEqual(c.decode(row.value),report);
 assert.deepEqual(c.decode(p.encodeSplit('other',{...start,frameSeq:3}).value),{...start,frameSeq:3});
});

test('one new effect never retransmits all old birth templates or a second actor baseline',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=initial();
 start.effects=Array.from({length:50},(_,id)=>({id,name:'existing',elapsed:0,anchor:{position:[id,0,0],facing:1},sourceName:'x'.repeat(150)}));
 transfer(p,c,start);
 const next={...start,frameSeq:2,effects:[...start.effects.map(e=>({...e,elapsed:.05})),{id:51,name:'new',elapsed:0}]};
 const row=p.encodeSplit('other',next);
 assert.deepEqual(row.baseline.effectBaselines,[next.effects.at(-1)]);
 assert.equal(row.baseline.actorBaseline,undefined);
 assert.ok(JSON.stringify(row.baseline).length<500);
 c.decode(row.baseline);assert.deepEqual(c.decode(row.value),next);
});

test('synchronous room fanout reuses one encoding while a resumed lease gets its own current baseline',()=>{
 const encoders=Array.from({length:5},()=>createOwnedRelayDelta()),decoders=Array.from({length:5},()=>createOwnedRelayDelta()),start=initial();
 const birthKey={};const first=encoders.map(p=>p.encodeSplit('other',start,{cacheKey:birthKey}));
 for(let i=0;i<5;i++){assert.equal(first[i],first[0]);decoders[i].decode(first[i].baseline);assert.deepEqual(decoders[i].decode(first[i].value),start);}
 const next={...start,frameSeq:2,actor:{...start.actor,x:3},effects:[{id:1,name:'first',elapsed:0}]},key={};
 const rows=encoders.map(p=>p.encodeSplit('other',next,{cacheKey:key}));
 for(let i=0;i<5;i++){assert.equal(rows[i],rows[0]);decoders[i].decode(rows[i].baseline);assert.deepEqual(decoders[i].decode(rows[i].value),next);}
 const restarted=createOwnedRelayDelta(),newDecoder=createOwnedRelayDelta();
 const resumed=restarted.encodeSplit('other',next,{cacheKey:key});assert.notEqual(resumed,rows[0]);
 newDecoder.decode(resumed.baseline);assert.deepEqual(newDecoder.decode(resumed.value),next);
});

test('new life and new connection require independent actor and effect baselines',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=initial();transfer(p,c,start);
 const oldPatch=p.encodeSplit('other',{...start,frameSeq:2}).value;
 const life={...start,epoch:2,frameSeq:0,actor:{...start.actor,x:50,mp:0}};transfer(p,c,life);
 assert.throws(()=>c.decode(oldPatch),/baseline-required/);
 const fresh=createOwnedRelayDelta(),freshProducer=createOwnedRelayDelta();
 const resumed={...life,frameSeq:60,actor:{...life.actor,x:100,mp:25}};
 assert.deepEqual(transfer(freshProducer,fresh,resumed).report,resumed);
 assert.throws(()=>createOwnedRelayDelta().decode(freshProducer.encodeSplit('other',{...resumed,frameSeq:61}).value),/baseline-required/);
});

test('split decoder rejects corrupt baselines, unknown versions and prototype keys',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta(),start=initial(),a=p.encodeSplit('other',start);c.decode(a.baseline);
 assert.throws(()=>c.decode({...a.value,deltaVersion:9}),/version/);
 const bad=JSON.parse(JSON.stringify(a.value));bad.actor.fields=JSON.parse('{"__proto__":{"polluted":true}}');
 assert.throws(()=>c.decode(bad),/key/);assert.equal({}.polluted,undefined);
 assert.throws(()=>c.decode({...a.baseline,actorBaseline:{...start.actor,x:99}}),/conflict/);
 assert.throws(()=>c.decode({...a.baseline,effectBaselines:[{id:1},{id:1}]}),/effect-baseline/);
 assert.throws(()=>c.decode({...a.value,effects:[{id:99,fields:{},removed:[]}]}),/effect-baseline-required/);
 const nested={...a.value,actor:{fields:{},removed:[],nested:{missing:{fields:{},removed:[]}}}};
 assert.throws(()=>c.decode(nested),/nested-baseline-required/);
});

test('long effect histories remain bounded without losing the final living effect',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();let last;
 for(let id=0;id<700;id++){
  last={...initial(),frameSeq:id,effects:[{id,name:'living',elapsed:0}]};
  assert.deepEqual(transfer(p,c,last).report,last);assert.ok(p.baselineCount<=513);assert.ok(c.baselineCount<=513);
 }
 assert.deepEqual(transfer(p,c,{...last,frameSeq:701,effects:[{...last.effects[0],elapsed:1}]}).report,
  {...last,frameSeq:701,effects:[{...last.effects[0],elapsed:1}]});
});

test('healthy direct state may suppress every dynamic relay without accumulating unbounded reliable birth templates',()=>{
 const p=createOwnedRelayDelta(),c=createOwnedRelayDelta();let newest;
 for(let id=0;id<700;id++){
  const report={...initial(),frameSeq:id,effects:[{id,name:'living',elapsed:0}]};
  newest=p.encodeSplit('other',report);assert.equal(c.decode(newest.baseline),null);
  assert.ok(c.baselineCount<=513);
 }
 assert.deepEqual(c.decode(newest.value).effects,[{id:699,name:'living',elapsed:0}]);
 assert.throws(()=>c.decode({...newest.baseline,liveEffectIds:[699,699]}),/baseline/);
 assert.throws(()=>c.decode({...newest.baseline,liveEffectIds:[-1]}),/baseline/);
});
