import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {MAXIMUM_STRIKE_SHOT} from '../../packages/combat-core/add-maximum-strike.mjs';
import {startAddPrismEndpoints,addPrismEndpointSpheres,prismHitTargets} from '../../packages/combat-core/add-prism-endpoints-2016.mjs';
import {claimSourceEffectGroupHit2016} from '../../packages/combat-core/effect-group-damage.mjs';
import {orientLiteralMesh} from '../../packages/combat-core/shadow-mesh.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

// Current Web collision regressions for original post-hit straight flight.
// Both targets use original Prism declarations/poses/stored spheres;
// their co-location is an explicit fixture input, not an original cast trace.
function fixture(){
 const f=originalAddFixture('DE',{skillId:29022}),{sim,a,b}=f;
 b.x=5000;
 const shot=sim.createEffect({...a,skillId:29022,skillScale:1},{NAME:MAXIMUM_STRIKE_SHOT},
  {birthAnchor:{position:[a.x,a.y+150,a.z],rotation:[0,0,0],facing:1}});
 sim.tickEffects(0);
 const shape=sim.effectSampler(shot,a,{profile:sim.profileFor(a)}).find(s=>s.kind==='sphere');
 assert.ok(shape,'the actual original Maximum mesh supplies its attack sphere');
 assert.equal(startAddPrismEndpoints(sim,b,[0,0,0],[0,0,0]),true);
 const endpoints=b.sourceAddPrismEndpoints;
 assert.equal(endpoints.length,2);
 for(const [i,npc]of endpoints.entries()){
  const sphere=addPrismEndpointSpheres(npc)[0];assert.ok(sphere);
  npc.position=shape.center.map((n,axis)=>n-sphere.center[axis]+(axis===0?i:0));
 }
 const targets=prismHitTargets(sim);
 assert.ok(targets.every(target=>target.spheres.some(sphere=>sim.hitPoint(shape,sphere))),
  'one unchanged original Maximum attack sphere covers both actual NPC targets');
 assert.ok(targets.every(target=>target.actor.sourceHittedType===1),
  'both original Prism INIT_COMPONENT declarations explicitly select material1');
 sim.drainEvents();
 return {...f,shot,endpoints};
}

for(const protectedFirst of [false,true])test(`Maximum penetrates accepted Prism targets with one explosion/sound per target; protected first=${protectedFirst}`,()=>{
 const {sim,a,shot,endpoints}=fixture(),before=endpoints.map(n=>n.hp),contacts=[];
 const apply=sim.applySummonHit.bind(sim);
 sim.applySummonHit=(attacker,target,data,origin)=>{
  let result;
  if(protectedFirst&&target.sourcePrismEndpointId===endpoints[0].id){
   // Prism has no declared invulnerability state. Inject this boundary result
   // explicitly to prove a rejected first contact cannot terminate a shot;
   // do not invent an original NPC flag or bypass the second real hit path.
   target.invincible=true;result={accepted:false,reason:'dead-or-invincible'};
  }else result=apply(attacker,target,data,origin);
  contacts.push({id:target.sourcePrismEndpointId,accepted:result.accepted});return result;
 };
 sim.tickEffects(0);
 const expected=protectedFirst?1:2;
 assert.equal(contacts.filter(row=>row.accepted).length,expected);
 assert.deepEqual(contacts.map(row=>row.id),endpoints.map(n=>n.id));
 assert.notEqual(shot.dead,true);assert.equal(shot.endReason,undefined);
 assert.equal(shot.hitCount,expected);assert.equal(sim.state.effects.includes(shot),true);
 if(protectedFirst)assert.equal(endpoints[0].hp,before[0]);else assert.ok(endpoints[0].hp<before[0]);
 assert.ok(endpoints[1].hp<before[1]);
 const children=sim.state.events.filter(e=>e.type==='damageSecondaryCreated'&&e.parentEffectId===shot.id);
 assert.equal(children.length,expected);assert.ok(children.every(e=>e.name==='DamageEffect_ATT_Maximum_Strike_Bullet_Explosion'));
 const sounds=sim.state.events.filter(e=>e.type==='sound'&&e.origin?.id===shot.id);
 assert.equal(sounds.length,expected);assert.equal(sounds[0].name,'HitPlasma1.wav');
 assert.equal(sounds[0].attackerId,a.id);assert.equal(sounds[0].soundPositionSource,'npc-target');
 assert.deepEqual(sounds[0].sourcePosition,endpoints[protectedFirst?1:0].position);
 sim.tickEffects(0);
 assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.origin?.id===shot.id).length,expected,
  'the continuing projectile retains each target receipt');
});

test('actual Maximum explosion shared gaps on Prism expire on target updates before another explosion can hit',()=>{
 const {sim,a,shot,endpoints}=fixture();sim.tickEffects(0);
 const name='DamageEffect_ATT_Maximum_Strike_Bullet_Explosion';
 const first=sim.state.effects.find(e=>e.parentEffectId===shot.id&&e.name===name);assert.ok(first);
 assert.equal(first.damage.GROUP_DAMAGE,1);assert.equal(first.damage.DAMAGE_DATA.HIT_GAP,.2);
 const anchor=structuredClone(first.birthAnchor);
 const another=()=>sim.createEffect({...a,skillId:29022,skillScale:1},{NAME:name},{birthAnchor:structuredClone(anchor)});
 sim.tickEffects(0);assert.equal(first.hitCount,2,'the real explosion hits both original endpoint spheres');
 const second=another();sim.tickEffects(0);assert.equal(second.hitCount,0,'a different carrier cannot bypass the shared name gap');
 first.dead=true;second.dead=true;sim.step(.21,{}, {snapshot:false});
 assert.equal(sim.state.effectGroupHits.filter(row=>endpoints.some(n=>row.targetId==='target:prism:'+n.id)).length,0);
 const third=another();sim.tickEffects(0);assert.equal(third.hitCount,2,'both native target vectors expire and admit the later explosion');
});

test('removed Prism containers retire their group vectors while dead actors and retained DYING endpoints keep theirs',()=>{
 const {sim,a,b,shot,endpoints}=fixture();shot.dead=true;
 // Explicit long-gap lifecycle input isolates object destruction from TTL.
 // It is not a claim that Maximum's original .2-second gap equals10seconds.
 const targetIds=[b.id,...endpoints.map(n=>b.id+':prism:'+n.id)];
 for(const targetId of targetIds)assert.equal(claimSourceEffectGroupHit2016(sim.state,
  {ownerIdentity:a.id,ownerKind:0,targetId,name:'explicit-container-lifecycle',gap:10}).allowed,true);
 b.hp=0;
 for(let i=0;i<3;i++)sim.step(.01,{}, {snapshot:false});
 assert.ok(endpoints.every(n=>n.state==='DYING'));assert.equal(sim.state.effectGroupHits.length,3);
 for(let i=0;i<100;i++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(b.sourceAddPrismEndpoints.length,0);
 assert.deepEqual(sim.state.effectGroupHits.map(row=>row.targetId),[b.id],
  'character HP0 is not object destruction and never stands in for source5fde');
});

for(const version of [0,1])test(`receiver v${version} preserves Maximum straight-flight receipts across owner replacements and later targets`,()=>{
 const {sim,a,b,shot,endpoints}=fixture();sim.networkOwnerId=b.id;
 let life=0;const epochFor=id=>id===a.id?life:0;sim.networkEpochFor=epochFor;
 shot.networkId=shot.id;shot.networkEpoch=0;shot.networkFrameSeq=1;
 const consumer=createRemoteActionConsumer({combatPlaybackVersion:version});consumer.bind(sim,b.id,epochFor);
 try{
  const wire=validateOwnedState(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:1}));
  wire.effects[0].sourceAddLockOn={targetId:b.id,manualDirDegree:[0,90,0],useManualDir:false};
  validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
  endpoints[1].position[0]+=5000;
  const hp=endpoints.map(n=>n.hp);sim.tickEffects(0);assert.notEqual(shot.dead,true);
  assert.ok(endpoints[0].hp<hp[0]);assert.equal(endpoints[1].hp,hp[1]);
  endpoints[0].position[0]+=5000;endpoints[1].position[0]-=5000;
  let afterSecond;
  for(const [frameSeq,stage]of [[2,0],[3,1],[4,2]]){
   if(stage)assert.ok(shot.damage[stage===1?'DAMAGE_DATA_NEXT':'DAMAGE_DATA_NEXT2'],'the actual original NEXT table is present');
   wire.frameSeq=frameSeq;wire.effects[0].stage=stage;
   const phase=stage?Math.fround(shot.damage.DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME[stage]+.001):0;
   wire.effects[0].elapsed=phase;wire.effects[0].sourceShadowMesh.globalTime=phase;
   orientLiteralMesh(wire.effects[0].sourceShadowMesh,[0,1,0]);
   validateOwnedReferences(validateOwnedState(wire),a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
   applyOwnedState(sim,a.id,wire);sim.tickEffects(0);
   const live=sim.state.effects.find(e=>e.networkId===shot.networkId);
   assert.notEqual(live?.dead,true);assert.equal(live?.sourceAddLockOn,undefined);
   assert.deepEqual(live.sourceShadowMesh.basis[0],shot.sourceShadowMesh.basis[0],
     'the accepted receiver direction survives a later owner steering projection');
   assert.ok(endpoints[1].hp<hp[1],'the travelling shot can accept a later target');
   if(afterSecond)assert.deepEqual(endpoints.map(n=>n.hp),afterSecond,'replacement/NEXT cannot repeat an already accepted target');
   afterSecond=endpoints.map(n=>n.hp);
  }
  assert.equal(sim.state.events.filter(e=>e.type==='sound'&&e.name==='HitPlasma1.wav'&&e.origin?.id===shot.id).length,2);
  assert.equal(Object.hasOwn(wire.effects[0],'maximumStrikeAccepted'),false,'the terminal receipt never becomes peer authority');
  orientLiteralMesh(wire.effects[0].sourceShadowMesh,[1,0,0]);
  wire.frameSeq=5;wire.effects[0].id+=1000;wire.effects[0].endReason='maximum-strike-accepted-hit';
  applyOwnedState(sim,a.id,wire);sim.tickEffects(0);
  assert.ok(endpoints[1].hp<hp[1],'a different ID remains a distinct shot; a peer endReason cannot create the private accepted receipt');
  const nextLifeHp=endpoints[1].hp;life=1;wire.epoch=1;wire.frameSeq=1;wire.effects[0].id=shot.networkId;
  applyOwnedState(sim,a.id,wire);sim.tickEffects(0);
  assert.ok(endpoints[1].hp<nextLifeHp,'the next owner epoch has its own receipt domain');
 }finally{consumer.clear();}
});
