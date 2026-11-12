import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {emitDamageNumber} from '../../apps/web/damage-number-layout.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:7,HIT_TYPE:1,HIT_ADD_MP:0,FORCE_DOWN:0};
function fixture(){return createSimulation({profile,map,seed:2016,networkOwnerId:'me',observeRemoteDamage:true,
  actors:[{id:'me',team:0,position:[0,0,0]},{id:'other',team:0,position:[100,0,0]},{id:'enemy',team:1,position:[200,0,0]}],
  effectAnchorSampler:()=>({position:[200,240,0]})});}
test('other players display estimated damage without HP/MP/passive/RNG changes or outgoing hit receipts',()=>{
  const s=fixture();s.drainEvents();const before=structuredClone(s.state),sync=createLocalOwnershipSync({reportEvery:1});
  const result=s.applyHit(s.actor('other'),s.actor('enemy'),data,{kind:'character'});
  assert.equal(result.accepted,true);assert.ok(result.amount>0);const events=s.drainEvents();
  assert.equal(s.state.nextEventId,before.nextEventId+1);before.nextEventId=s.state.nextEventId;
  assert.deepEqual(s.state,before);assert.equal(events.length,1);assert.equal(events[0].type,'observedHit');
  const report=sync.afterStep(s,'me',events);assert.deepEqual(report.hits,[]);
  let digits=0;const emitted=emitDamageNumber({particles:new Map(),emitParticle(){digits++;return true;}},
    {styles:{normal:{template:'normal',width:20}},templates:{normal:{fields:{NumParticles:200}}},glyphs:Object.fromEntries('0123456789'.split('').map(n=>[n,{}]))},events[0]);
  assert.equal(emitted,String(Math.trunc(result.amount)).length);assert.equal(digits,emitted);
});
test('remote estimate rejects invulnerability/dead/friendly targets; local participant keeps normal damage authority',()=>{
  const s=fixture();s.drainEvents();s.actor('enemy').forceInvincible=1;
  assert.equal(s.applyHit(s.actor('other'),s.actor('enemy'),data,{kind:'character'}).accepted,false);assert.equal(s.drainEvents().length,0);
  s.actor('enemy').forceInvincible=0;s.actor('enemy').hp=0;assert.equal(s.applyHit(s.actor('other'),s.actor('enemy'),data).accepted,false);
  assert.equal(s.applyHit(s.actor('other'),s.actor('me'),data).accepted,false);
  s.actor('enemy').hp=s.actor('enemy').hpMax;const before=s.actor('me').hp;
  s.applyHit(s.actor('enemy'),s.actor('me'),data,{kind:'character'});assert.ok(s.actor('me').hp<before);assert.ok(s.drainEvents().some(e=>e.type==='hit'));
});
