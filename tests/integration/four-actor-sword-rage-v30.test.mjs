/** Actual native Web fixtures and a sealed Web baseline; no original-client
 * equivalence or GPU FPS claim. Clone optimization must preserve the full
 * isolated consumer and all real authority, not just its outward damage text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeRemoteDamage} from '../../packages/combat-core/observed-damage.mjs';
import {observeRemoteDamage as baselineObserve} from '../fixtures/observed-damage-baseline-v30.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {loadFourActorSwordAssets,createFourActorSwordFixture,traceFourActorSwordFixture,seededOwnerRageProbe,snapshotReplayProbe} from '../../tools/audit-four-actor-sword-rage-v30.mjs';

const assets=await loadFourActorSwordAssets();
const ordinary=PROFESSION_PROFILES.LK.states.RSI_COMBO_Z.raw.DAMAGE_DATA;

function contactCase(kind){
  const roster=kind==='luna'?['LK','RS','LK','LK']:kind==='reflection'?['LK','RS','RS','LK']:
    kind==='elesis'?['LK','LK','BH','CA']:['LK','LK','LK','LK'];
  const sim=createFourActorSwordFixture(assets,{roster,ownerId:'p0',prepare:false}),attacker=sim.actor('p1'),defender=sim.actor('p2');
  delete sim.rng; // Exercise the real isolated RNG stream, not the trace's fixed draw.
  let data=ordinary,origin={kind:'character',id:'state-'+attacker.stateSerial,state:attacker.state,powerMultiplier:1,impactPoint:[defender.x,defender.y+80,defender.z]};
  if(kind==='rage'){sim.prepareWayOfSword(defender.id,-2);defender.superArmor=false;}
  if(kind==='counter'){sim.enter(defender,'ESSI_REVENGE_WAIT','baseline-counter');defender.animationTime=.1;}
  if(kind==='elesis'){sim.prepareWayOfSword(defender.id,-2);defender.sourceElesisBreakCharge=2000;defender.manaBreak.charge=100;}
  if(kind==='luna'){
    attacker.skillId=21017;defender.hp=defender.hpMax=100000000;defender.mp=defender.mpMax;
    const effect=sim.createEffect(attacker,{NAME:'DamageEffect_SA_ERS_LunaBlade_ExposionFinal'},
      {birthAnchor:{position:[defender.x,defender.y+80,defender.z],facing:1,rotation:[0,0,0]}});
    data=effect.damage.DAMAGE_DATA;origin={...origin,kind:'effect',id:effect.id,skillId:21017};
  }
  if(kind==='reflection'){
    sim.enter(defender,'ESSI_ERS_COUNTER_GUARD','baseline-reflection');defender.animationTime=.5;
    const effect=sim.createEffect(attacker,{NAME:'FIREBALL_SMALL_DOWN_ELSWORD'},
      {birthAnchor:{position:[defender.x-30,defender.y+100,defender.z],facing:1,rotation:[0,0,0],customPosition:true}});
    data=effect.damage.DAMAGE_DATA;origin={...origin,kind:'effect',id:effect.id};
  }
  // Existing source effects and already-emitted events must remain isolated.
  for(let i=0;i<16;i++)sim.createEffect(attacker,{NAME:'ELSWORD_ANGRY_WIND'},
    {birthAnchor:{position:[attacker.x,attacker.y+80,attacker.z],facing:1}});
  sim.drainEvents();for(let i=0;i<40;i++)sim.emit('prior-contact','p3',{data:ordinary,origin,marker:i});
  const isolated=[];
  for(const method of ['applyParticipantHit','acceptedSkillHit','advanceActorBuffs']){
    const original=sim[method];
    sim[method]=function(...args){const result=original.apply(this,args);if(this.observationOnly)isolated.push({method,state:structuredClone(this.state),result});return result;};
  }
  return {sim,attacker,defender,data,origin,isolated};
}

for(const kind of ['ordinary','rage','counter','elesis','reflection'])test('observer clone optimization preserves exact baseline '+kind+' result and full shadow state',()=>{
  const before=contactCase(kind),after=contactCase(kind),initial=structuredClone(after.sim.state);
  const expected=baselineObserve(before.sim,before.attacker,before.defender,before.data,before.origin);
  const actual=observeRemoteDamage(after.sim,after.attacker,after.defender,after.data,after.origin);
  assert.deepEqual(actual,expected,'identical accepted/damage/guard/reaction result');
  assert.deepEqual(after.isolated,before.isolated,'identical full isolated state, not just final cosmetics');
  assert.deepEqual(after.sim.state,before.sim.state,'identical outward cosmetic events and identities');
  const final=structuredClone(after.sim.state);final.events=initial.events;final.nextEventId=initial.nextEventId;
  assert.deepEqual(final,initial,'all real actor HP/MP/buff/RNG/effect/control/ownership state untouched');
  assert.equal(after.sim.networkOwnerId,'p0');
  if(kind==='counter')assert.equal(actual.countered,true);
  if(kind==='reflection')assert.equal(actual.reflected,true);
  const participant=after.isolated.find(row=>row.method==='applyParticipantHit');
  // The observer's existing early return keeps reaction eligibility's damage
  // reduction, while only the participant owner's consumer starts the burst.
  // Equipment additional-attack damage is applied after the original rage
  // reduction. Preserve its baseline amount rather than asserting zero final HP damage.
  if(kind==='rage')assert.equal(participant.state.actors.find(a=>a.id==='p2').destructionRageRemaining,0);
  if(kind==='elesis'){assert.equal(actual.amount,0);assert.equal(participant.state.actors.find(a=>a.id==='p2').sourceElesisBreakCharge,2000);}
});

test('four-player Luna observation uses V62 quota and original117 without any foreign owner-state write',()=>{
  // Frozen Web V30 called acceptedSkillHit to inject a blade burn. V56 uses
  // the original explosion DD instead; retain that old fixture unchanged and
  // check the current declared route independently of its superseded policy.
  const {sim,attacker,defender,data,origin,isolated}=contactCase('luna'),before=structuredClone(sim.state);
  assert.equal(data.BUFF_FACTOR_ID?.['1'],117);
  const actual=observeRemoteDamage(sim,attacker,defender,data,origin);
  assert.equal(actual.accepted,true);assert.equal(actual.buffContactAllowed,true);
  const mp=sim.state.events.filter(e=>e.type==='observedBuffMpChanged');assert.equal(mp.length,1);
  assert.equal(mp[0].resourceNumber.style,'red');assert.equal(mp[0].resourceNumber.percent,-30);
  assert.ok(Math.abs(mp[0].delta+defender.mpMax*.3)<.001);
  assert.deepEqual(isolated.map(row=>row.method),['applyParticipantHit','advanceActorBuffs']);
  const after=structuredClone(sim.state);after.events=before.events;after.nextEventId=before.nextEventId;delete after.localRuneLunaHitReceipts;
  assert.deepEqual(after,before);assert.equal(sim.networkOwnerId,'p0');
});

test('observer clones no discarded event history and clones participant replacements only once',()=>{
  const fixture=contactCase('ordinary'),nativeClone=globalThis.structuredClone;
  let wholeStateCopies=0,discardedEvents=0,participantCopies=0;
  try{
    globalThis.structuredClone=function(value,...options){
      if(value?.effects===fixture.sim.state.effects&&Array.isArray(value?.actors)){wholeStateCopies++;discardedEvents+=value.events.length;}
      if(value===fixture.attacker||value===fixture.defender)participantCopies++;
      return nativeClone(value,...options);
    };
    observeRemoteDamage(fixture.sim,fixture.attacker,fixture.defender,fixture.data,fixture.origin);
  }finally{globalThis.structuredClone=nativeClone;}
  assert.ok(wholeStateCopies<=1,'at most one platform copy when plain-state fast copy is unavailable');assert.equal(discardedEvents,0);assert.equal(participantCopies,0);
});

for(const roster of [['LK','LK','LK','LK'],['LK','LK','RS','IS'],['LK','LK','BH','CA']])test('four-player authored command contacts create bounded real sword-rage chain '+roster.join('/'),()=>{
  const fixture=traceFourActorSwordFixture(assets,{roster,attackerId:roster[2]==='BH'?'p2':'p0'});
  assert.equal(fixture.report.rageEvents.length,roster[2]==='BH'?2:4);
  assert.equal(new Set(fixture.report.rageEvents.map(e=>e.actorId)).size,fixture.report.rageEvents.length);
  assert.ok(fixture.events.some(e=>e.type==='hit'&&e.origin.kind==='character'),'ordinary Z uses actual native helpers');
  assert.ok(fixture.events.some(e=>e.type==='hit'&&e.origin.kind==='effect'&&e.data.FORCE_FLY===1),'source rage attack box creates actual launch contacts');
  assert.equal(fixture.sim.state.effects.filter(e=>e.name==='ELSWORD_ANGRY_WIND').length,0,'original .3s attack boxes finish');
});

test('remote predicted reactions repeat one entry serial while local defender authority starts its rage only once',()=>{
  const attacking=seededOwnerRageProbe(assets,{ownerId:'p0'}),receiving=seededOwnerRageProbe(assets,{ownerId:'p2'});
  assert.deepEqual(attacking.report.rows.map(r=>r.rageEvents),[1,1,1,1]);
  assert.deepEqual(attacking.report.rows.map(r=>r.authoritativeTargetRage),[0,0,0,0]);
  assert.deepEqual(receiving.report.rows.map(r=>r.rageEvents),[1,0,0,0]);
  assert.deepEqual(receiving.report.rows.map(r=>r.authoritativeTargetRage),[6,6,6,6]);
  assert.equal(new Set(attacking.sim.auditRageEntries.map(row=>row.entered.stateSerial)).size,1);
  const replay=snapshotReplayProbe(receiving.sim,createFourActorSwordFixture(assets,{ownerId:'p0'}));
  assert.deepEqual(replay.map(r=>r.rageStarted),[0,0,0],'owner snapshots do not replay pure rage events');
  assert.equal(replay[0].windStarted,1);assert.deepEqual(replay.slice(1).map(r=>r.effectStarted),[0,0],'canonical parent birth is emitted only once');
  assert.equal(new Set(replay.map(r=>r.effects)).size,1,'no effect identity growth on repeated snapshots');
});
