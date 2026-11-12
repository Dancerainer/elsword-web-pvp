import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
const dt=1/60;
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.001},REACT_TYPE:7,ATTACK_TYPE:0,HIT_GAP:.1,RE_ATTACK:1,NO_MISS:1};
// Synthetic collision volume isolates source clock/phase contracts. Neither
// these shapes nor the resulting Web frames are original-client trajectories.
function fixture(networkOwnerId=null){
 const f=addFixture('LP',{networkOwnerId}),{sim,a,b}=f;
 sim.effectSampler=()=>[{kind:'sphere',center:[b.x,b.y+100,b.z],radius:300}];
 const e=sim.createEffect(a,{NAME:'DamageEffect_SI_SA_AN_Energy_Boom_Projectile'},{clock:'custom',birthAnchor:{position:[a.x,a.y+100,a.z],rotation:[0,0,0],facing:a.facing}});
 sim.tickEffects(0);sim.drainEvents();
 e.damage={DAMAGE_DATA:{...data},USE_GLOBAL_TIME:1,ATTACK_TIME_START:0,ATTACK_TIME_END:2,DAMAGE_TIME:9999};
 e.lifeTimeSeconds=2;if(e.sourceShadowMesh)e.sourceShadowMesh.maxLifeTime=2;
 return {...f,e};
}
const hitSteps=sim=>sim.state.events.filter(e=>e.type==='hit').map(e=>Math.round(e.time*60));
test('actual effect callbacks use float32 birth-gap TTL rather than wall-clock epsilon',()=>{
 const {sim}=fixture();for(let i=0;i<15;i++)sim.step(dt,{}, {snapshot:false});
 assert.deepEqual(hitSteps(sim),[1,8,15]);
});
for(const version of [0,1])test(`receiver v${version} keeps the same native list across replacement and expires on the local callback`,()=>{
 const {sim,a,b,e}=fixture('target'),consumer=createRemoteActionConsumer({combatPlaybackVersion:version});
 e.networkId=77;e.networkEpoch=0;e.networkFrameSeq=1;consumer.bind(sim,b.id,()=>0);
 sim.step(dt,{}, {snapshot:false});const list=e.sourceHitMemory2016;assert.equal(list.length,1);
 const replacement={...e,hits:{},hitGaps:{},sourceHitMemory2016:[]};sim.state.effects[sim.state.effects.indexOf(e)]=replacement;
 for(let i=0;i<14;i++)sim.step(dt,{}, {snapshot:false});
 assert.equal(replacement.sourceHitMemory2016,list);assert.deepEqual(hitSteps(sim),[1,8,15]);
 consumer.clear();
});
test('generic NEXT collision uses old DD/list on the threshold frame and clears only after it',()=>{
 const {sim,e}=fixture();e.damage={...e.damage,DAMAGE_DATA:{...data,RE_ATTACK:0},DAMAGE_DATA_NEXT:{...data,RE_ATTACK:0},
  DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME:.05,CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE:1};
 for(let i=0;i<4;i++)sim.step(dt,{}, {snapshot:false});
 assert.equal(e.stage,1);assert.deepEqual(hitSteps(sim),[1]);
 sim.step(dt,{}, {snapshot:false});assert.deepEqual(hitSteps(sim),[1,5]);
 const stage=e.stage;sim.tickEffects(0);assert.equal(e.stage,stage,'historical collision does not create another native frame');
});

test('native receiver list stays local and cannot be forged in an owner effect packet',()=>{
 const {sim,a}=fixture();sim.step(dt,{}, {snapshot:false});
 const report=encodeOwnedState(sim,a.id,{epoch:0,frameSeq:1});
 assert.ok(report.effects.length);assert.ok(report.effects.every(e=>!Object.hasOwn(e,'sourceHitMemory2016')));
 validateOwnedState(report);report.effects[0].sourceHitMemory2016=[];
 assert.throws(()=>validateOwnedState(report),/invalid-owner-effect/);
});
