/** Explicit V62 project rules against the real original DD/numeric consumers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cast,steps,profile} from '../helpers/rs-fixture.mjs';
import {runeSlayerEffectDamage} from '../../packages/combat-core/rs-skills.mjs';
import {observeRemoteDamage} from '../../packages/combat-core/observed-damage.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
const blade='DamageEffect_SA_ERS_LunaBlade',blast='DamageEffect_SA_ERS_LunaBlade_ExposionFinal';
const burns=sim=>sim.state.events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98);
function make(options={}){
 const f=fixture({skillId:21017,...options});f.a.skillId=21017;f.b.hp=f.b.hpMax=1e8;f.b.mp=f.b.mpMax;
 return f;
}
function contact(f,name,serial=f.a.stateSerial){
 f.a.skillId=21017;const e=f.sim.createEffect(f.a,{NAME:name});e.ownerStateSerial=serial;
 return {effect:e,data:runeSlayerEffectDamage(profile,e,e.damage.DAMAGE_DATA),origin:{kind:'effect',id:e.id,skillId:21017}};
}
function hit(f,c){return f.sim.applyHit(f.a,f.b,c.data,c.origin);}
function flush(f){f.sim.advanceActorBuffs(f.b,1/60);}
function captureBlast(f,samples){
 for(const e of f.sim.state.effects)if(e.name===blast&&e.active&&!e.dead&&e.elapsed>=e.damage.ATTACK_TIME_START){
  const shapes=f.sim.effectSampler(e,f.a,{profile:f.sim.profileFor(f.a)})??[];
  const bodies=f.sim.defenderSampler(f.b,{profile:f.sim.profileFor(f.a),role:'defender'})??[];
  samples.push({step:f.sim.state.step,elapsed:e.elapsed,anchor:e.currentAnchor?.position,target:[f.b.x,f.b.y,f.b.z],state:f.b.state,
   invincible:f.b.invincible,overlap:shapes.some(s=>bodies.some(b=>f.sim.hitPoint(s,b)!==null))});
 }
}
for(const facing of [-1,1])test(`real cast/${facing}: original blade+die-chain blast have two reactions but one HP settlement/MP loss`,t=>{
 // Use the original central3200-unit Garpai line, equally clear of its ends.
 // Default line6 spawn puts a right-facing target12.15 units from a solid wall.
 const f=make({facing,position:[0,3080,0],lineId:2}),samples=[];cast(f);
 for(let n=0;n<180&&!f.sim.state.events.some(e=>e.type==='hit'&&e.actorId==='rs');n++)steps(f.sim,1);
 steps(f.sim,1);assert.equal(burns(f.sim).length,1,'first actual blade contact already consumes the one MP application');
 for(let n=0;n<200;n++){steps(f.sim,1);captureBlast(f,samples);}
 t.diagnostic(JSON.stringify({scope:'original central Garpai line2 native geometry',facing,samples}));
 const names=new Map(f.sim.state.events.filter(e=>e.type==='effectStarted').map(e=>[e.effectId,e.name]));
 const hits=f.sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='rs'&&[blade,blast].includes(names.get(e.origin.id)));
 assert.deepEqual(hits.map(e=>names.get(e.origin.id)),[blade,blast]);assert.ok(hits[0].amount>0);assert.equal(hits[1].amount,0);
 assert.equal(hits[1].hp,hits[0].hp);assert.equal(burns(f.sim).length,1);
 assert.ok(Math.abs(burns(f.sim)[0].delta+Math.fround(f.b.mpMax*Math.fround(.3)))<.001);
 assert.equal(f.sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===f.b.id&&e.reason==='hit-reaction').length,2);
 // Retired effects can be swept; the birth/secondary event independently keeps
 // the production ancestry, while the receipt is keyed by the original cast.
 const r=f.b.sourceRuneSlayerHitReceipts?.rs;assert.ok(r?.casts,'V62 owns the cast quota on the defender');
 assert.equal(Object.keys(r.casts).length,1);assert.deepEqual(Object.values(r.casts),[{hp:true,mp:true}]);
});
test('original line6 wall-side cast records actual blast geometry without forcing a second contact',t=>{
 const f=make({facing:1}),samples=[],names=new Map();cast(f);
 for(let n=0;n<250;n++){
  steps(f.sim,1);
  captureBlast(f,samples);
 }
 for(const e of f.sim.state.events)if(e.type==='effectStarted')names.set(e.effectId,e.name);
 const hits=f.sim.state.events.filter(e=>e.type==='hit'&&e.actorId===f.a.id);
 t.diagnostic(JSON.stringify({scope:'current Web/native geometry; original line6 source wall at2200',samples,hits:hits.map(h=>({name:names.get(h.origin.id),amount:h.amount}))}));
 assert.ok(samples.length,'actual original blast reaches its attack window');
 assert.equal(hits.filter(h=>h.amount>0).length,1);assert.equal(burns(f.sim).length,1);
 assert.equal(hits[0]&&names.get(hits[0].origin.id),blade);
});
test('blade misses original helpers; standalone original blast box can deliver the one HP hit and burn',()=>{
 const f=make({distance:300});const c=contact(f,blast),hp=f.b.hp;
 for(let n=0;n<60&&!f.sim.state.events.some(e=>e.type==='hit'&&e.origin.id===c.effect.id);n++)steps(f.sim,1);
 const h=f.sim.state.events.find(e=>e.type==='hit'&&e.origin.id===c.effect.id);assert.ok(h?.amount>0);assert.ok(f.b.hp<hp);
 steps(f.sim,2);assert.equal(burns(f.sim).length,1);assert.equal(h.data.REACT_TYPE,2);
});
test('first blast followed by delayed blade still settles only once for that cast',()=>{
 const f=make(),first=contact(f,blast,11),second=contact(f,blade,11);
 assert.ok(hit(f,first).amount>0);flush(f);const hp=f.b.hp;
 assert.equal(hit(f,second).amount,0);flush(f);assert.equal(f.b.hp,hp);assert.equal(burns(f.sim).length,1);
});
test('accepted shield zero consumes HP attempt; shield expiry does not make the second stage damage',()=>{
 const f=make(),first=contact(f,blade,12),second=contact(f,blast,12),hp=f.b.hp;
 f.a.stats.additionalAttackPercent=0;if(f.a.equipmentAttributes)f.a.equipmentAttributes.additionalAttackRatio=0;
 f.b.skillDamageReducePercent=100;assert.equal(hit(f,first).amount,0);flush(f);
 f.b.skillDamageReducePercent=0;assert.equal(hit(f,second).amount,0);flush(f);
 assert.equal(f.b.hp,hp);assert.equal(burns(f.sim).length,1);
});
test('invincible first contact consumes neither quota; later blast succeeds',()=>{
 const f=make(),first=contact(f,blade,13),second=contact(f,blast,13);
 f.b.forceInvincible=1;assert.equal(hit(f,first).accepted,false);assert.equal(f.b.sourceRuneSlayerHitReceipts,undefined);
 f.b.forceInvincible=0;assert.ok(hit(f,second).amount>0);flush(f);assert.equal(burns(f.sim).length,1);
});
test('actual recovered Miss gate consumes neither quota; unavoided blast later settles once',()=>{
 const f=make(),first=contact(f,blade,15),second=contact(f,blast,15);
 f.b.buffs.push({behaviors:[{kind:'stat',type:15,stat:'avoidance',changeType:0,value:3}]});
 assert.equal(hit(f,first).miss,true);assert.equal(f.b.sourceRuneSlayerHitReceipts,undefined);
 f.b.buffs=[];assert.ok(hit(f,second).amount>0);flush(f);assert.equal(burns(f.sim).length,1);
});
for(const gate of ['reflection','absorption'])test(`controlled CAN_REFLEX early ${gate} return does not reserve Luna resources`,()=>{
 // Original Luna does not declare reflectability. Set this one field only to
 // independently regress the common early-return contract, not to claim the
 // original Luna projectile can actually be reflected/absorbed.
 const f=make(),first=contact(f,blade,16),second=contact(f,blast,16);first.data={...first.data,CAN_REFLEX:1};
 if(gate==='reflection'){f.sim.enter(f.b,'ESSI_ERS_COUNTER_GUARD','controlled-reflection-gate');f.b.animationTime=.5;}
 else f.b.buffs.push({behaviors:[{kind:'absorbMagicProjectile',mp:10}]});
 const result=hit(f,first);assert.equal(result[gate==='reflection'?'reflected':'absorbed'],true);
 assert.equal(f.b.sourceRuneSlayerHitReceipts,undefined);f.b.buffs=[];f.sim.enter(f.b,'RSI_WAIT','controlled-gate-end');
 assert.ok(hit(f,second).amount>0);flush(f);assert.equal(burns(f.sim).length,1);
});
test('project MP application at0 MP is spent once and does not burn subsequent MP recovery',()=>{
 const f=make(),first=contact(f,blade,14),second=contact(f,blast,14);f.b.mp=0;
 hit(f,first);flush(f);assert.equal(burns(f.sim).length,1);f.b.mp=f.b.mpMax;
 hit(f,second);flush(f);assert.equal(burns(f.sim).length,1);assert.equal(f.b.mp,f.b.mpMax);
});
test('independent overlapping casts, out-of-order stages, and two targets do not overwrite each other',()=>{
 const f=make(),c1=contact(f,blade,20),c2=contact(f,blast,24),later=contact(f,blast,20);
 assert.ok(hit(f,c1).amount>0);assert.ok(hit(f,c2).amount>0);assert.equal(hit(f,later).amount,0);flush(f);assert.equal(burns(f.sim).length,2);
 const other=structuredClone(f.b);other.id='another-target';other.sourceRuneSlayerHitReceipts=undefined;other.hp=other.hpMax;
 assert.ok(f.sim.applyHit(f.a,other,c1.data,c1.origin).amount>0);f.sim.advanceActorBuffs(other,1/60);
 assert.equal(burns(f.sim).filter(e=>e.actorId===other.id).length,1);
 assert.equal(Object.keys(f.b.sourceRuneSlayerHitReceipts.rs.casts).length,2);
});
test('same serial from a new attacker life is a different cast; current owner state never substitutes carrier identity',()=>{
 const f=make();let epoch=0;f.sim.networkEpochFor=id=>id===f.a.id?epoch:0;
 const c=contact(f,blade,40);hit(f,c);flush(f);f.a.stateSerial=200;
 assert.equal(hit(f,contact(f,blast,40)).amount,0);epoch=1;
 assert.ok(hit(f,contact(f,blast,40)).amount>0);flush(f);assert.equal(burns(f.sim).length,2);
});
test('two simultaneous Rune Slayers with the same cast serial retain independent target quotas',()=>{
 const f=make(),other=structuredClone(f.a);other.id='rs2';f.sim.state.actors.push(other);
 const first=contact(f,blade,45),second=contact({...f,a:other},blast,45);
 assert.ok(hit(f,first).amount>0);assert.ok(f.sim.applyHit(other,f.b,second.data,second.origin).amount>0);
 assert.equal(hit(f,contact(f,blast,45)).amount,0);
 const later=contact({...f,a:other},blade,45);assert.equal(f.sim.applyHit(other,f.b,later.data,later.origin).amount,0);
 flush(f);assert.equal(burns(f.sim).length,2);assert.deepEqual(Object.keys(f.b.sourceRuneSlayerHitReceipts).sort(),['rs','rs2']);
});
test('JSON combat restore replays a pending first-stage MP application and the second stage without a second HP/MP charge',()=>{
 const f=make(),peer=make(),first=contact(f,blade,48),second=contact(f,blast,48);hit(f,first);
 peer.sim.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));
 // restore replaces actors; keep the references from the actual restored pool.
 peer.a=peer.sim.actor('rs');peer.b=peer.sim.actor('target');
 const hp=f.b.hp;
 for(const q of [f,peer]){flush(q);assert.equal(hit(q,second).amount,0);flush(q);}
 assert.equal(peer.b.hp,hp);assert.equal(peer.b.hp,f.b.hp);assert.equal(peer.b.mp,f.b.mp);
 assert.deepEqual(peer.b.sourceRuneSlayerHitReceipts,f.b.sourceRuneSlayerHitReceipts);
 assert.equal(burns(peer.sim).length,1);assert.equal(burns(f.sim).length,1);
});
test('owned+critical defender ledger and pending original immediate buff survive restore before blast',()=>{
 const f=make(),peer=make();hit(f,contact(f,blade,51));
 const packet=encodeOwnedState(f.sim,f.b.id,{epoch:0,frameSeq:1});validateOwnedState(packet);
 assert.ok(packet.actor.sourceRuneSlayerHitReceipts?.rs?.casts,'defender report carries actual first-stage receipt');
 const bad=structuredClone(packet);bad.actor.sourceRuneSlayerHitReceipts.rs.serial=50;assert.throws(()=>validateOwnedState(bad));
 assert.deepEqual(encodeCriticalAction(packet,{id:1}).actor.sourceRuneSlayerHitReceipts,packet.actor.sourceRuneSlayerHitReceipts);
 const wire=decodeNetworkBinary(encodeNetworkBinary(packet));assert.deepEqual(wire.actor.sourceRuneSlayerHitReceipts,packet.actor.sourceRuneSlayerHitReceipts);
 applyOwnedState(peer.sim,peer.b.id,wire);flush(peer);
 const hp=peer.b.hp;assert.equal(hit(peer,contact(peer,blast,51)).amount,0);flush(peer);
 assert.equal(peer.b.hp,hp);assert.equal(burns(peer.sim).length,1);
});
test('source reports replayed repeatedly execute one HP/MP settlement only on defender owner',()=>{
 const source=make({facing:-1,networkOwnerId:'rs'}),peer=make({facing:-1,networkOwnerId:'target'});cast(source);
 const hp=peer.b.hp;for(let n=0;n<200;n++){
  steps(source.sim,1);const p=encodeOwnedState(source.sim,'rs',{epoch:0,frameSeq:n});
  applyOwnedState(peer.sim,'rs',p);applyOwnedState(peer.sim,'rs',p);steps(peer.sim,1);
 }
 const hits=peer.sim.state.events.filter(e=>e.type==='hit'&&e.targetId===peer.b.id&&e.origin.skillId===21017);
 assert.ok(hits.length>=2);assert.equal(hits.filter(e=>e.amount>0).length,1);assert.ok(peer.b.hp<hp);assert.equal(burns(peer.sim).length,1);
 const predicted=source.sim.state.events.filter(e=>e.type==='observedBuffMpChanged');assert.equal(predicted.length,1);
});
test('third-party isolated observation deduplicates two stages without mutating foreign gameplay',()=>{
 const f=make(),first=contact(f,blade,61),second=contact(f,blast,61),actors=structuredClone(f.sim.state.actors),seed=f.sim.state.seed;
 const one=observeRemoteDamage(f.sim,f.a,f.b,first.data,first.origin),two=observeRemoteDamage(f.sim,f.a,f.b,second.data,second.origin);
 assert.ok(one.amount>0);assert.equal(two.amount,0);assert.equal(f.sim.state.events.filter(e=>e.type==='observedBuffMpChanged').length,1);
 assert.deepEqual(f.sim.state.actors,actors);assert.equal(f.sim.state.seed,seed);assert.ok(f.sim.state.localRuneLunaHitReceipts);
});
test('both frozen1784% declarations and original final-only BF117 remain byte-for-byte source rows',()=>{
 for(const name of [blade,blast])assert.equal(profile.damageEffects[name].raw.DAMAGE_DATA.DAMAGE.MAGIC,17.84);
 assert.equal(profile.damageEffects[blade].raw.DAMAGE_DATA.BUFF_FACTOR_ID,undefined);
 assert.deepEqual(profile.damageEffects[blast].raw.DAMAGE_DATA.BUFF_FACTOR_ID,{'1':117});
 assert.equal(profile.damageEffects[blast].raw.DAMAGE_DATA.NO_DAMAGE,undefined);
});
