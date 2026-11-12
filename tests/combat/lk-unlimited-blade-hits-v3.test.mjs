/** Independent six target windows + real original posed collision helpers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {lordKnightCharacterAttackStage} from '../../packages/combat-core/lk-skills.mjs';
import {encodeOwnedState,encodeCriticalAction,ownedAttackKey,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
const preset=JSON.parse(readFileSync(new URL('../../config/lk-preset.json',import.meta.url)));
const windows=[[.166,.233],[.433,.5],[.666,.733],[.966,1.033],[1.3,1.366],[1.5,1.566]];
async function fixture(facing=1,multiplier=1){const f=await lkCommandFixture({facing,gap:85,preset:{...preset,passives:[],guildPassives:[],speedAttributeSemantics:null,
 attributes:{...preset.attributes,animationSpeedMultiplier:multiplier}}});f.sim.configureLoadout([{skillId:21028},...Array(7).fill(null)],'lk');
 // Original Iron Body fixes target posture for this collision test. It does
 // not change the source sword helper, windows, damage or per-swing receipts.
 f.sim.grantBuff(f.target,f.target,714,1);f.sim.drainEvents();return f;}
for(const facing of [-1,1])for(const awake of [false,true])for(const speed of [1,1.4,1.5])test(`Unlimited Blade ${facing}/${awake}/${speed}: six source sword collisions and separate finisher`,async()=>{
 const f=await fixture(facing,speed);if(awake)f.actor.awakening.remaining=30;const events=[];
 for(let i=0;i<300;i++){f.sim.step(1/60,{lk:i===0?{pressed:['A']}:{}});events.push(...f.sim.drainEvents());}
 const slashes=events.filter(e=>e.type==='hit'&&e.actorId==='lk'&&e.origin.kind==='character');assert.equal(slashes.length,6);
 slashes.forEach((e,i)=>{assert.ok(e.origin.animationTime>windows[i][0]&&e.origin.animationTime<windows[i][1]);assert.equal(e.data.REACT_TYPE,i<3?1:2);});
 assert.equal(events.filter(e=>e.type==='characterDamageDataChanged'&&e.actorId==='lk').length,6);
 assert.ok(events.some(e=>e.type==='hit'&&e.actorId==='lk'&&e.origin.kind==='effect'),'original independent finisher still hits');
});
test('strict boundaries never expand character attack windows and the sixth normal reset precedes its target hit window',async()=>{
 const f=await fixture();f.sim.enter(f.actor,'ESSI_SI3_ES_UNLIMITED_BLADE','source-boundaries');f.sim.drainEvents();
 for(const [start,end]of windows)for(const clock of [start,end]){f.actor.animationTime=clock;f.actor.presentationTransition=null;f.sim.checkCharacterAttack(f.actor,clock,clock);
  assert.equal(f.sim.drainEvents().filter(e=>e.type==='hit').length,0);}
 for(let i=0;i<6;i++){f.actor.animationTime=windows[i][0]+.001;assert.equal(lordKnightCharacterAttackStage(f.profile,f.actor),i+1);}
});
test('live and historical packets share per-swing receipts: six legitimate hits, delayed duplicate packets never charge again',async()=>{
 const source=await fixture(),receiver=await fixture(),consumer=createRemoteActionConsumer({clock:()=>0});receiver.sim.networkOwnerId='target';
 consumer.remember(receiver.sim,'target',()=>1);source.sim.step(1/60,{lk:{pressed:['A']}});source.sim.drainEvents();
 const packets=[];
 for(let i=0;i<160;i++){source.sim.step(1/60,{});const events=source.sim.drainEvents();if(events.some(e=>e.type==='hit'&&e.actorId==='lk'&&e.origin.kind==='character'))
  packets.push(encodeOwnedState(source.sim,'lk',{epoch:1,frameSeq:i+2}));}
 assert.equal(packets.length,6);assert.equal(new Set(packets.map(p=>ownedAttackKey(source.profile,p.actor))).size,6);
 const received=[];
 for(const p of packets){consumer.receive('lk',[encodeCriticalAction(p,{id:p.frameSeq})],1,p.frameSeq);consumer.consume(receiver.sim,'target',()=>1);
  received.push(...receiver.sim.drainEvents().filter(e=>e.type==='hit'&&e.actorId==='lk'));
  applyOwnedState(receiver.sim,'lk',p);receiver.sim.checkCharacterAttack(receiver.actor,receiver.actor.animationTime,receiver.actor.animationTime);
  assert.equal(receiver.sim.drainEvents().filter(e=>e.type==='hit'&&e.actorId==='lk').length,0,'same live pose cannot repeat a historical hit');}
 assert.equal(received.length,6);const hp=receiver.target.hp;
 for(const p of [packets[0],packets[4],packets[1]]){applyOwnedState(receiver.sim,'lk',p);receiver.sim.checkCharacterAttack(receiver.actor,receiver.actor.animationTime,receiver.actor.animationTime);}
 assert.equal(receiver.target.hp,hp);consumer.clear();
});
