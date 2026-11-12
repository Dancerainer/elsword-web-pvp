import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';

test('six profession routing keeps explicit source owners, first-owner resolution, absent-owner fallback and source order',()=>{
  const ids=['RF','LK','VC','RS','IS','BM'],received=new Map();
  const views=Object.fromEntries(ids.map(id=>[id,{step:(_dt,state)=>received.set(id,state)}]));
  const state={actors:[{id:'r',professionId:'RF'},{id:'s',professionId:'RS'},
    {id:'duplicate',professionId:'LK'},{id:'duplicate',professionId:'BM'},
    {id:'legacy'},{id:'foreign',professionId:'VC'}],effects:[
      {id:1,ownerId:'r'},{id:2,ownerId:'s'},
      {id:3,ownerId:'foreign',sourceProfessionId:'IS'},
      {id:4,ownerId:'duplicate'},
      {id:5,ownerId:'duplicate',sourceProfessionId:'RS'},
      {id:6,ownerId:'absent'},
      {id:7,ownerId:'legacy'},
      {id:8,ownerId:'s',sourceProfessionId:'unavailable'},
    ],packetMarker:42};
  const original=structuredClone(state),expected=new Map(ids.map(id=>[id,{
    actors:state.actors.filter(a=>(a.professionId??'RF')===id||state.effects.some(e=>e.ownerId===a.id&&e.sourceProfessionId===id)),
    effects:state.effects.filter(e=>(e.sourceProfessionId??state.actors.find(a=>a.id===e.ownerId)?.professionId??'RF')===id),
  }]));
  // A crowded packet must be classified once. An attachment/source override
  // must not require per-profession scans of the entire effect list.
  state.actors.find=()=>{throw Error('repeated owner scan');};
  state.effects.some=()=>{throw Error('repeated source scan');};
  const wrapper=createProfessionEffects(views);wrapper.step(1/60,state);
  for(const id of ids){
    const result=received.get(id);assert.deepEqual(result.actors,expected.get(id).actors,id+' actors');
    assert.deepEqual(result.effects,expected.get(id).effects,id+' effects');assert.equal(result.packetMarker,42);
    for(const actor of result.actors)assert.ok(state.actors.includes(actor),'original actor identities stay shared');
    for(const effect of result.effects)assert.ok(state.effects.includes(effect),'original effect identities stay shared');
  }
  delete state.actors.find;delete state.effects.some;assert.deepEqual(state,original,'routing never mutates packet data');
});

test('changing the local profession refreshes unknown-owner routing on the next packet',()=>{
  const calls=[],views=Object.fromEntries(['RF','RS'].map(id=>[id,{step:(_dt,s)=>calls.push([id,s.actors.map(a=>a.id),s.effects.map(e=>e.id)])}]));
  const wrapper=createProfessionEffects(views),state={actors:[{id:'legacy'}],effects:[{id:1,ownerId:'absent'}]};
  wrapper.step(1/60,state);wrapper.setLocalProfession('RS');wrapper.step(1/60,state);
  assert.deepEqual(calls,[['RF',['legacy'],[1]],['RS',[],[]],['RF',[],[]],['RS',['legacy'],[1]]]);
});

test('one batch shares one lookup across professions and same-size mutable membership refreshes in the next batch',()=>{
  const state={actors:[{id:'owner',professionId:'RF',x:1}],effects:[{id:1,ownerId:'owner',phase:0}]},received=[],begins=[];
  let actorScans=0,effectScans=0;
  const actorIterator=state.actors[Symbol.iterator],effectIterator=state.effects[Symbol.iterator];
  state.actors[Symbol.iterator]=function(){actorScans++;return actorIterator.call(this);};
  state.effects[Symbol.iterator]=function(){effectScans++;return effectIterator.call(this);};
  state.actors.find=()=>{throw Error('owner scanned again inside batch');};
  const views=Object.fromEntries(['RF','RS'].map(id=>[id,{
    beginEventBatch:(s,lookup)=>{assert.equal(s,state);begins.push(lookup);},endEventBatch(){},
    event:(event,s)=>received.push([id,event,s.actors,s.effects]),
  }])),wrapper=createProfessionEffects(views),events=Array.from({length:50},(_,effectId)=>({type:'effectStarted',actorId:'owner',effectId}));
  wrapper.eventBatch(events,state);assert.equal(actorScans,1);assert.equal(effectScans,1);assert.equal(begins[0],begins[1]);
  assert.equal(begins[0].actors.get('owner'),state.actors[0]);assert.equal(begins[0].effects.get(1),state.effects[0]);
  for(let i=0;i<events.length;i++){assert.equal(received[i][0],'RF');assert.equal(received[i][1],events[i]);assert.equal(received[i][2],state.actors);assert.equal(received[i][3],state.effects);}
  const oldActor=state.actors[0],oldEffect=state.effects[0];
  state.actors[0]={id:'owner',professionId:'RS',x:300};state.effects[0]={id:1,ownerId:'owner',phase:2};
  wrapper.eventBatch([{type:'effectStarted',actorId:'owner',effectId:80}],state);
  assert.equal(actorScans,2);assert.equal(effectScans,2);assert.equal(received.at(-1)[0],'RS');
  assert.equal(begins[2],begins[3]);assert.notEqual(begins[2],begins[0]);
  assert.equal(begins[2].actors.get('owner'),state.actors[0]);assert.equal(begins[2].effects.get(1),state.effects[0]);
  assert.equal(begins[0].actors.get('owner'),oldActor);assert.equal(begins[0].effects.get(1),oldEffect);
});

test('batch dispatch preserves cross-profession cancellation before hit and owner routing after the actor is absent',()=>{
  const calls=[],state={actors:[{id:'r',professionId:'RF'},{id:'s',professionId:'RS'}],effects:[]};
  const views=Object.fromEntries(['RF','RS','BM'].map(id=>[id,{
    beginEventBatch:()=>calls.push(id+':begin'),endEventBatch:()=>calls.push(id+':end'),
    cancelDamagedOwner:actor=>calls.push(id+':cancel:'+actor),event:event=>calls.push(id+':'+event.type),
  }])),wrapper=createProfessionEffects(views);
  wrapper.eventBatch([{type:'effectStarted',actorId:'r',effectId:1},
    {type:'hit',actorId:'s',targetId:'r',deleteDamageReactEffects:true},
    {type:'effectEnded',effectId:1}],state);
  assert.deepEqual(calls,['RF:begin','RS:begin','BM:begin','RF:effectStarted',
    'RF:cancel:r','RS:cancel:r','BM:cancel:r','RS:hit','RF:effectEnded','RF:end','RS:end','BM:end']);
});

test('dispatch exceptions close every profession batch and standalone events refresh mutable owner routing',()=>{
  const calls=[],state={actors:[{id:'owner',professionId:'RF'}],effects:[]};
  const views=Object.fromEntries(['RF','RS'].map(id=>[id,{
    beginEventBatch:()=>calls.push(id+':begin'),endEventBatch:()=>calls.push(id+':end'),
    event:event=>{calls.push(id+':'+event.type);if(event.type==='injected')throw Error('injected presentation error');},
  }])),wrapper=createProfessionEffects(views);
  assert.throws(()=>wrapper.eventBatch([{type:'injected',actorId:'owner'}],state),/injected presentation error/);
  assert.deepEqual(calls,['RF:begin','RS:begin','RF:injected','RF:end','RS:end']);
  state.actors[0]={id:'owner',professionId:'RS'};wrapper.event({type:'effectStarted',actorId:'owner',effectId:1},state);
  assert.equal(calls.at(-1),'RS:effectStarted');
  const count=calls.length;wrapper.eventBatch([],state);assert.equal(calls.length,count,'empty bursts allocate no view scope');
});
