import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';

function fixture(){
  const calls=[],tail=new Set();
  const ids=['RF','LK','VC','RS','IS','BM','GM','BH','CA','LP','MM','DE'];
  const views=Object.fromEntries(ids.map(id=>[id,{
    hasPendingWork:()=>tail.has(id),event:e=>{if(e.type==='effectStarted')tail.add(id);},
    step:(_dt,state)=>calls.push({kind:'step',id,actors:state.actors,effects:state.effects}),
    render:()=>calls.push({kind:'render',id}),clear:()=>tail.delete(id),hasEffect:()=>false,
  }]));
  return {calls,tail,effects:createProfessionEffects(views)};
}

test('twelve loaded libraries update only the actual roster and preserve departing tails',()=>{
  const {calls,tail,effects}=fixture(),state={actors:[{id:'a',professionId:'LP'},{id:'b',professionId:'RS'}],effects:[]};
  effects.step(1/60,state);effects.render();
  assert.deepEqual(calls.map(c=>c.id),['RS','LP','RS','LP']);
  effects.event({type:'effectStarted',actorId:'a',effectId:1},state);
  state.actors=[state.actors[1]];calls.length=0;
  effects.step(1/60,state);effects.render();
  assert.deepEqual(calls.map(c=>c.id),['RS','LP','RS','LP']);
  assert.equal(calls.find(c=>c.kind==='step'&&c.id==='LP').actors.length,0);
  tail.clear();effects.step(1/60,state);effects.render();calls.length=0;
  effects.step(1/60,state);effects.render();
  assert.deepEqual(calls.map(c=>c.id),['RS','RS']);
});

test('reflection source overrides and events before a step awaken their actual library',()=>{
  const {calls,effects}=fixture(),a={id:'vc',professionId:'VC'},state={actors:[a],effects:[{id:1,ownerId:a.id,sourceProfessionId:'RS'}]};
  effects.step(1/60,state);effects.render();
  const rs=calls.find(c=>c.kind==='step'&&c.id==='RS');assert.deepEqual(rs.actors,[a]);assert.deepEqual(rs.effects,state.effects);
  assert.equal(calls.some(c=>c.id==='LP'),false);
  calls.length=0;effects.clear();
  effects.event({type:'effectStarted',actorId:a.id,effectId:2,sourceProfessionId:'DE'},state);effects.render();
  assert.deepEqual(calls.map(c=>c.id),['DE']);
});

test('a disappearing idle owner receives one empty cleanup packet, then its renderer sleeps',()=>{
  const {calls,effects}=fixture(),state={actors:[{id:'a',professionId:'MM'}],effects:[]};
  effects.step(1/60,state);effects.render();calls.length=0;state.actors=[];
  effects.step(1/60,state);effects.render();
  assert.deepEqual(calls,[{kind:'step',id:'MM',actors:[],effects:[]}]);
  calls.length=0;effects.step(1/60,state);effects.render();assert.deepEqual(calls,[]);
});
