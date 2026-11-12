/** Current implementation regressions with original helpers; no client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dashZxFixture,dashZxFrame} from '../helpers/authored-command-fixture.mjs';
import {downZFixture} from '../helpers/authored-command-fixture.mjs';
import {orderedPlatformAttack,releasePlatformAttack} from '../../packages/combat-core/platform-attack-input.mjs';
import {XXX_CANDIDATE} from '../../packages/combat-core/xxx-candidate.mjs';

const json=s=>JSON.parse(JSON.stringify(s.snapshot()));
const advance=(f,n,input={})=>{for(let i=0;i<n;i++)dashZxFrame(f,input);};
const ordered=(keys=['DOWN','Z'],times=[.001,.002])=>({pressed:keys,held:keys,
  edges:keys.map((key,i)=>({key,down:true,time:times[i]}))});
async function xxx(facing=1,gap=70){
  const f=await dashZxFixture({facing,gap,position:[0,3080,0],lineId:2});
  for(let i=0;i<180;i++)dashZxFrame(f,[0,12,26].includes(i)?{pressed:['X'],held:['X']}:{});
  return f;
}

for(const facing of [-1,1])for(const gap of [70,120,250])
test(`complete actual XXX input produces finite original target blast hits, facing ${facing} gap ${gap}`,async()=>{
  const f=await xxx(facing,gap),{s,a}=f;
  const events=s.drainEvents(),queued=events.filter(e=>e.type==='xxxCandidateQueued');
  const starts=events.filter(e=>e.type==='effectStarted'&&e.name===XXX_CANDIDATE.damageName);
  const hits=events.filter(e=>e.type==='hit'&&e.origin?.sourceCandidate?.damageName===XXX_CANDIDATE.damageName);
  assert.equal(queued.length,1);assert.equal(starts.length,1);assert.ok(hits.length>0);
  assert.ok(hits.every(e=>e.amount>0&&e.data.DAMAGE.MAGIC===1.2&&e.origin.sourceCandidate.evidenceClass===XXX_CANDIDATE.evidenceClass));
  assert.ok(hits.length<=18,'original accepted-hit ceiling, not eighteen synthetic hits');
  assert.equal(starts[0].definition.START_TIME,.25);assert.equal(queued[0].setEpochAnimation,0);
  assert.equal(events.filter(e=>e.type==='xxxCandidatePayment'&&e.accepted).length,1);
  assert.equal(events.filter(e=>e.type==='originalRecoveredParticle').length,0,'old smoke/flare cannot duplicate the target blast');
  assert.ok(events.some(e=>e.type==='effectEnded'&&e.name===XXX_CANDIDATE.damageName&&e.reason==='template-life-time'));
  assert.equal(s.state.effects.filter(e=>e.setName===XXX_CANDIDATE.setName).length,0);
  assert.equal(a.xxxCandidate,undefined);assert.equal(a.state,'RSI_WAIT');
});

test('XXX uses original raw target fields, reference MP failure denies queued target damage',async()=>{
  const f=await dashZxFixture(),{s,a}=f;
  const source=JSON.parse(readFileSync(new URL('../../contracts/rf-hits-source-v14.json',import.meta.url)));
  assert.deepEqual(s.profile.effectSets[XXX_CANDIDATE.setName].raw,source.targetXxxResources.effectSet.raw);
  assert.deepEqual(s.profile.damageEffects[XXX_CANDIDATE.damageName].raw,source.targetXxxResources.damageEffect.raw);
  s.enter(a,'RSI_COMBO_XXX','bounded-mp-guard');a.mp=6;s.drainEvents();advance(f,180);
  const events=s.drainEvents();
  assert.ok(Math.abs(a.mp-(6+180/60))<1e-4,'failed early payment leaves MP intact; three unfrozen seconds naturally restore3, with native float accumulation');
  assert.equal(events.filter(e=>e.type==='xxxCandidatePayment'&&!e.accepted).length,1);
  assert.equal(events.filter(e=>e.type==='effectStarted'&&e.setName===XXX_CANDIDATE.setName).length,0);
  assert.equal(events.filter(e=>e.type==='hit'&&e.origin?.sourceCandidate).length,0);
  assert.equal(s.state.effects.length,0);
});

for(const when of ['before-payment','after-payment-before-birth','after-birth'])
test(`XXX explicit action cancellation ${when} cleans requests/particle owner and preserves only born finite blast`,async()=>{
  const f=await dashZxFixture({gap:150}),{s,a}=f;
  s.enter(a,'RSI_COMBO_XXX','bounded-cancel-lifecycle');s.drainEvents();
  if(when!=='before-payment'){
    while(!a.xxxCandidate.paymentResolved)dashZxFrame(f);
    if(when==='after-birth')while(!s.state.events.some(e=>e.type==='effectStarted'&&e.name===XXX_CANDIDATE.damageName))dashZxFrame(f);
  }
  const prior=s.state.effects.filter(e=>e.name===XXX_CANDIDATE.damageName&&e.active).length;
  s.enter(a,'RSI_WAIT','controlled-state-exit');advance(f,90);
  const events=s.drainEvents();
  const born=events.filter(e=>e.type==='effectStarted'&&e.name===XXX_CANDIDATE.damageName);
  assert.equal(born.length,prior);assert.equal(s.state.effects.length,0);
  assert.ok(events.some(e=>e.type==='effectEnded'&&e.name==='Raven_Hand_FireSM'&&e.reason==='xxx-candidate-owner-exit'));
  assert.equal(a.xxxCandidate,undefined);
});

test('XXX actual helpers reject rear and distant bodies while a forward nearby body receives damage',async()=>{
  for(const facing of [-1,1])for(const gap of [-150,150,800]){
    const f=await dashZxFixture({facing,gap:Math.abs(gap)}),{s,a,b}=f;
    b.x=a.x+facing*gap;s.enter(a,'RSI_COMBO_XXX','bounded-original-helper-boundary');s.drainEvents();advance(f,100);
    const hits=s.drainEvents().filter(e=>e.type==='hit'&&e.origin?.sourceCandidate);
    assert.equal(hits.length>0,gap===150,`facing ${facing}, gap ${gap}`);
  }
});

test('XXX nearby two-target fixture uses distinct original body helpers and ends within original lifetime',async()=>{
  const f=await dashZxFixture({gap:130}),{s,a,b}=f;
  const c=structuredClone(b);c.id='second-target';c.x+=70;c.landPosition=[c.x,c.y,c.z];s.state.actors.push(c);
  s.enter(a,'RSI_COMBO_XXX','bounded-multi-target-source-helper');s.drainEvents();advance(f,120);
  const hits=s.drainEvents().filter(e=>e.type==='hit'&&e.origin?.sourceCandidate);
  assert.ok(hits.length>0);assert.ok(new Set(hits.map(e=>e.targetId)).size>1);
  assert.ok(hits.length<=18);assert.equal(s.state.effects.length,0);
});

for(const phase of ['pending-payment','active-blast'])
test(`XXX full JSON snapshot restores ${phase} and remains identical for 120 packets`,async()=>{
  const f=await dashZxFixture({gap:150}),g=await dashZxFixture({gap:150});
  f.s.enter(f.a,'RSI_COMBO_XXX','bounded-restore');
  if(phase==='active-blast')while(!f.s.state.events.some(e=>e.type==='effectStarted'&&e.name===XXX_CANDIDATE.damageName))dashZxFrame(f);
  g.s.restore(json(f.s));advance(f,120);advance(g,120);assert.deepEqual(json(f.s),json(g.s));
});

for(const facing of [-1,1])for(const dash of [false,true])
test(`distinct Down-before-Z within one web packet retains original 2Z consumer, facing ${facing} dash ${dash}`,async()=>{
  const f=await downZFixture({facing,gap:70,targetFloor:'same'}),{s,a}=f;
  if(dash){const key=facing===1?'RIGHT':'LEFT';dashZxFrame(f,{pressed:[key],held:[key]});dashZxFrame(f,{released:[key]});dashZxFrame(f,{pressed:[key],held:[key]});}
  dashZxFrame(f,ordered());assert.equal(a.state,dash?'RSI_DASH_JUMP':'RSI_JUMP_DOWN');
  assert.equal(a.platformAttackInput.key,'Z');dashZxFrame(f,{held:['DOWN']});
  assert.equal(a.state,dash?'RSI_DASH_JUMP_COMBO_Z':'RSI_JUMP_COMBO_Z');
  assert.equal(a.platformAttackInput,undefined);advance(f,120,{held:['DOWN']});
  assert.ok(s.drainEvents().some(e=>e.type==='hit'&&e.origin?.kind==='character'));
});

for(const [label,input] of [['same-time',ordered(['DOWN','Z'],[.001,.001])],
  ['reverse',ordered(['Z','DOWN'])],['unordered',{pressed:['DOWN','Z'],held:['DOWN','Z']}],
  ['Up-Down-Z',ordered(['UP','DOWN','Z'],[.001,.002,.003])]])
test(`platform input ${label} retains existing ordinary attack priority`,async()=>{
  const f=await downZFixture();dashZxFrame(f,input);assert.equal(f.a.state,'RSI_COMBO_Z');assert.equal(f.a.platformAttackInput,undefined);
});

test('rejected original CanDown cannot swallow a same-packet attack or manufacture a platform drop',async()=>{
  const f=await dashZxFixture({gap:70,position:[1700,2600,0],lineId:7});
  dashZxFrame(f,ordered());assert.equal(f.a.state,'RSI_COMBO_Z');assert.equal(f.a.platformAttackInput,undefined);
  assert.ok(f.s.state.events.some(e=>e.type==='dropRejected'));
});

test('ordered platform attack survives exact JSON restore, but gets discarded on interrupted/dead/blocked state',async()=>{
  const f=await downZFixture(),g=await downZFixture();dashZxFrame(f,ordered());g.s.restore(json(f.s));
  advance(f,120,{held:['DOWN']});advance(g,120,{held:['DOWN']});assert.deepEqual(json(f.s),json(g.s));
  const keys=()=>({pressed:new Set(),held:new Set()});
  for(const change of [{hp:0},{stateSerial:4},{canNotAttackTime:.1},{inputLock:.1},{buffControls:{inputBlock:true}},{state:'RSI_DAMAGE_AIR_SMALL'}]){
    const a={hp:100,state:'RSI_JUMP_DOWN',stateSerial:3,platformAttackInput:{key:'Z',stateSerial:3},...change},k=keys();
    releasePlatformAttack(a,k);assert.equal(k.pressed.size,0);assert.equal(a.platformAttackInput,undefined);
  }
});

test('ordered drop selection rejects absent/unordered device timestamps without changing key sets',()=>{
  const a={state:'RSI_WAIT',grounded:true,hp:100},k={pressed:new Set(['DOWN','Z']),edges:[{key:'DOWN',down:true,time:NaN},{key:'Z',down:true,time:.2}]};
  assert.equal(orderedPlatformAttack(a,k),null);assert.deepEqual([...k.pressed],['DOWN','Z']);
});
