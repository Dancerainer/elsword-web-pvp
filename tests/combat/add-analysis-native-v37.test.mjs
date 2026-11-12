/** Production MM input dispatch, source WASM, authored Garpai collision and
 * original character/effect poses. These prove the current Web execution;
 * the qualified target-selection/attachment adapters are not PvP goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {STARFALL_CARRIER,STARFALL_ATTACK_MESH,STARFALL_ATTACK_SET,CHASER_ATTACKER,CHASER_SETS}
 from '../../packages/combat-core/add-analysis-skills.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction}
 from '../../packages/online/owned-state.mjs';

const dt=1/60,blast='DAMAGE_EFFECT_Star_Fall_Explode',chaserMain='DamageEffect_AMM_Shooting_Chaser_Attack',
 chaserBullet='DamageEffect_AMM_Shooting_Chaser_Buff_Dummy_Attack';
const step=(f,input={})=>f.sim.step(dt,input,{snapshot:false});
const control=(f,kind)=>f.a.sourceAddNative?.find(row=>row.kind===kind);
const diagnostic=f=>JSON.stringify({state:f.a.state,animation:f.a.animationTime,position:[f.a.x,f.a.y,f.a.z],
 target:[f.b.x,f.b.y,f.b.z],dp:f.a.sourceAdd.dp,mp:f.a.mp,available:f.sim.skillAvailability(f.a.id,0),
 controllers:f.a.sourceAddNative,effects:f.sim.state.effects.filter(e=>e.skillId===f.skillId).map(e=>({id:e.id,name:e.name,
  time:e.elapsed,active:e.active,position:e.currentAnchor?.position,counts:e.childCounts,reason:e.endReason})),
 notes:f.sim.state.unsupported.slice(-8),events:f.sim.state.events.slice(-8)});
function until(f,predicate,frames,label){
 for(let i=0;i<frames&&!predicate();i++)step(f);
 assert.ok(predicate(),label+': '+diagnostic(f));
}
function press(f,key){step(f,{add:{pressed:[key],held:[key]}});}
function prepare(skillId,facing,formed,distance=250){
 const f={...originalAddFixture('MM',{skillId}),skillId};
 f.a.sourceAdd.dp=8000;f.a.mp=f.a.mpMax;f.b.x=distance*facing;f.a.facing=facing;
 until(f,()=>f.sim.skillAvailability(f.a.id,0).available,180,'natural idle reaches a valid skill-input boundary');
 if(formed){
  press(f,'AWAKEN');
  until(f,()=>f.a.sourceAdd.formation&&!f.a.sourceAdd.formationPending&&f.sim.skillAvailability(f.a.id,0).available,
   240,'actual awakening input reaches formed MM with an available skill');
 }
 f.a.sourceAdd.mutation=3;
 assert.equal(f.sim.skillAvailability(f.a.id,0).mode,'generator-select');
 const before=f.a.mp;press(f,'A');
 assert.equal(f.a.sourceAdd.generator?.skillId,skillId,'first actual input selects this original Dynamo mode');
 assert.equal(f.a.mp,before,'selection pays DP rather than the firing MP cost');
 assert.equal(f.a.sourceAddNative?.length??0,0,'selection does not manufacture an attack controller');
 until(f,()=>f.sim.skillAvailability(f.a.id,0).available,300,'source selection cooldown/action completes');
 assert.equal(f.sim.skillAvailability(f.a.id,0).mode,'generator-fire');
 const firingMp=f.a.mp,cost=f.sim.skillAvailability(f.a.id,0).mpCost;
 press(f,'A');assert.ok(Math.abs(f.a.mp-(firingMp-cost))<.01,'second actual input pays the declared firing MP');
 assert.ok(f.sim.state.events.some(e=>e.type==='addGeneratorFired'&&e.actorId===f.a.id&&e.skillId===skillId));
 return f;
}
function ownerRoundtrip(f,kind){
 const packet=JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:2,frameSeq:f.sim.state.step}))),saved=structuredClone(packet);
 const context={actors:f.sim.state.actors,profiles:f.sim.profiles};
 const validate=p=>{const report=validateOwnedState(p);validateOwnedReferences(report,f.a,f.profile,f.sim.map,context);return report;};
 validate(packet);
 const action=encodeCriticalAction(packet,{id:1,effectIds:new Set()});
 const row=action.actor.sourceAddNative.find(r=>r.kind===kind);assert.ok(row);
 for(const id of row.handles)assert.ok(action.effects.some(e=>e.id===id),'critical samples carry actual live controller handles');
 validate({...packet,actions:[action]});
 // Exercise a receiver's independent ID allocation without replacing any
 // producer, original pose sampler, collision or resource consumer.
 f.sim.state.effects=f.sim.state.effects.filter(e=>e.ownerId!==f.a.id);f.sim.state.nextEffectId+=10000;
 applyOwnedState(f.sim,f.a.id,validate(packet));
 const restored=control(f,kind);assert.ok(restored);
 for(const [i,id] of row.handles.entries()){
  const e=f.sim.state.effects.find(e=>e.networkId===id);assert.ok(e);assert.equal(restored.handles[i],e.id);
 }
 assert.deepEqual(packet,saved,'reference validation and handle remapping do not mutate the source packet');
 validate(JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:2,frameSeq:f.sim.state.step+1}))));
}
function nativeAttackShape(f,e){
 const shapes=f.sim.effectSampler(e,f.a,{profile:f.profile});
 return shapes.some(s=>s.kind==='sphere'&&s.radius>0&&s.center.every(Number.isFinite)||
  s.kind==='line'&&s.start?.every(Number.isFinite)&&s.end?.every(Number.isFinite));
}
function finish(f,kind,names,frames=900){
 for(let i=0;i<frames;i++)step(f);
 assert.equal(control(f,kind),undefined,'the original controller timer reclaims its owned handles');
 assert.equal(f.sim.state.effects.some(e=>e.ownerId===f.a.id&&names.has(e.name)),false,
  'the finite original attack/carrier lifetimes eventually retire all related collision records');
 const report=validateOwnedState(JSON.parse(JSON.stringify(encodeOwnedState(f.sim,f.a.id,{epoch:2,frameSeq:f.sim.state.step}))));
 validateOwnedReferences(report,f.a,f.profile,f.sim.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});
}

for(const formed of [false,true])for(const facing of [1,-1])test(
 `MM Starfall actual source input, ${formed?'three-point formation':'ordinary'}, facing ${facing}, attacks and reclaims Native carriers`,()=>{
 const f=prepare(29016,facing,formed);
 until(f,()=>control(f,'starfall')?.rows.every(row=>f.sim.state.effects.some(e=>e.id===row.carrierId&&e.active&&e.sourceShadowMesh)),
  240,'original 1.2 animation event activates the real source Starfall carrier');
 const r=control(f,'starfall');assert.equal(r.rows.length,formed?2:1);
 assert.equal(f.a.sourceAdd.mutation,formed?0:3,'only the formed secondary carrier consumes the original three points');
 const expected=formed?[7.4,3.7]:[7.4];
 for(const [i,row] of r.rows.entries()){
  assert.ok(row.remaining<=expected[i]&&row.remaining>expected[i]-.05);
  const e=f.sim.state.effects.find(e=>e.id===row.carrierId);assert.equal(e.name,STARFALL_CARRIER);
  assert.deepEqual(e.sourceShadowMesh.position,e.currentAnchor.position);
 }
 ownerRoundtrip(f,'starfall');
 until(f,()=>f.sim.state.effects.some(e=>e.name===blast&&e.active&&nativeAttackShape(f,e)),
  180,'real original Starfall attack box has a usable posed attack helper');
 const attack=f.sim.state.effects.find(e=>e.name===blast&&e.active&&nativeAttackShape(f,e));
 assert.equal(attack.damage.DAMAGE_DATA.DAMAGE.MAGIC,5.36);
 assert.equal(attack.damage.ATTACK_TIME_START,.97);assert.equal(attack.damage.ATTACK_TIME_END,1.1);
 const mesh=f.sim.state.effects.find(e=>e.name===STARFALL_ATTACK_MESH&&e.setName===STARFALL_ATTACK_SET);
 assert.ok(mesh?.sourceBoneEffectSetId);
 assert.ok(f.sim.state.effects.some(e=>e.sourceBoneTargetMeshId===mesh.id),'real Attack mesh owns its original Dummy01/02 visual children');
 until(f,()=>f.sim.state.events.some(e=>e.type==='hit'&&e.targetId===f.b.id&&e.origin?.skillId===29016&&e.amount>0),
  300,'authored Starfall payload must deal actual nonzero Native contact damage');
 const started=f.sim.state.events.find(e=>e.type==='addStarfallAttackCreated');
 assert.equal(started.targetId,f.b.id);assert.ok(Math.abs(started.position[0])>100,'selected-target blast does not spawn at owner feet');
 finish(f,'starfall',new Set([STARFALL_CARRIER,STARFALL_ATTACK_MESH,blast]));
});

for(const formed of [false,true])for(const facing of [1,-1])test(
 `MM Shooting Chaser actual source input, ${formed?'formed':'ordinary'}, facing ${facing}, emits real nested attacks and expires`,()=>{
 const f=prepare(29018,facing,formed);
 until(f,()=>control(f,'chaser')&&f.sim.state.effects.some(e=>e.name===CHASER_ATTACKER&&e.active&&e.sourceShadowMesh),
  180,'original .4 animation event emits a real source Chaser attacker');
 assert.equal(f.a.sourceAdd.mutation,3,'Shooting Chaser has no invented mutation consumption');
 const e=f.sim.state.effects.find(e=>e.name===CHASER_ATTACKER);assert.equal(e.damage.DAMAGE_DATA.NO_DAMAGE,1);
 ownerRoundtrip(f,'chaser');
 until(f,()=>f.sim.state.events.some(e=>e.type==='addChaserContactRecorded'&&e.targetId===f.b.id),
  120,'the original attacker helper must naturally contact the forward target');
 until(f,()=>f.sim.state.effects.some(e=>e.name===chaserMain&&e.active),
  180,'retained source contacts allocate the original target-traced Chaser attack set');
 const main=f.sim.state.effects.find(e=>e.name===chaserMain&&e.active);
 assert.ok(CHASER_SETS.includes(main.setName));assert.equal(main.traceActorId,f.b.id);assert.equal(main.traceUnitDieDelete,true);
 assert.equal(main.lifeTimeSeconds,4.1);assert.equal(main.damage.CREATE_DAMAGE_EFFECT0.LOOP_END_COUNT,22);
 until(f,()=>f.sim.state.effects.some(e=>e.name===chaserBullet&&e.active&&nativeAttackShape(f,e)),
  180,'the original 1s/.5s child producer emits a usable real Dummy01 attack box');
 const bullet=f.sim.state.effects.find(e=>e.name===chaserBullet&&e.active&&nativeAttackShape(f,e));
 assert.equal(bullet.parentEffectId,main.id);assert.equal(bullet.lifeTimeSeconds,.2);assert.equal(bullet.damage.DAMAGE_DATA.DAMAGE.PHYSIC,1.36);
 assert.equal(bullet.skillId,29018);assert.equal(bullet.powerMultiplier,main.powerMultiplier);
 until(f,()=>f.sim.state.events.some(e=>e.type==='hit'&&e.targetId===f.b.id&&e.origin?.skillId===29018&&e.amount>0),
  180,'real generated Chaser boxes must produce nonzero Native contact damage');
 finish(f,'chaser',new Set([CHASER_ATTACKER,chaserMain,chaserBullet,'DamageEffect_Shooting_Chaser_Drone_FX','DamageEffect_Shooting_Chaser_Beam_FX']));
});

for(const distance of [100,200])for(const facing of [1,-1])test(
 `single-enemy Chaser at native ${distance} gap, facing ${facing}, cannot become an unsupported empty allocation`,()=>{
 const f=prepare(29018,facing,false,distance);
 until(f,()=>f.sim.state.events.some(e=>e.type==='addChaserContactRecorded'&&e.targetId===f.b.id),
  180,'a naturally close enemy is geometrically contacted by the real attacker');
 until(f,()=>f.sim.state.events.some(e=>e.type==='addChaserAllocated'&&e.targetId===f.b.id),
  180,'retention must produce an actual allocation for the sole close enemy');
 const contacts=f.sim.state.events.filter(e=>e.type==='addChaserContactRecorded'&&e.targetId===f.b.id);
 assert.ok(contacts.length>0&&contacts.at(-1).count>=1,'the allocation is backed by real source contacts');
 assert.equal(f.sim.state.unsupported.some(n=>n.id==='add-chaser-count-fallback'),false,
  'ordinary close-range input cannot depend on the unresolved native count>=5 selection helper');
 until(f,()=>f.sim.state.events.some(e=>e.type==='hit'&&e.targetId===f.b.id&&e.origin?.skillId===29018&&e.amount>0),
  240,'retained close contact must generate real nonzero Native attack damage');
 finish(f,'chaser',new Set([CHASER_ATTACKER,chaserMain,chaserBullet]));
});
