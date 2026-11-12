/** Real Add inputs, source WASM and original attack/defender poses over the
 * production owner encoder and reliable-action consumer. Ordinary body/status
 * reports are deliberately withheld. These are Web adapter regressions, not
 * original-client network goldens or measurements of WAN latency. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {advanceActorStops} from '../../packages/combat-core/source-stop-queues-v53.mjs';

const dt=1/60,skillId=29000;
const projectileName='DamageEffect_SI_SA_AN_Energy_Boom_Projectile';
const captures=new Map();
const room=sim=>({snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,
  actors:Object.fromEntries(sim.state.actors.map(actor=>[actor.id,{epoch:1,frameSeq:0}]))},owners:{}});
const clean=report=>validateOwnedState({...report,actions:report.actions.map(({ageFrames,...action})=>action)});
// Independent original STOP_OTHER_UNIT0=[.03,.6]. Historical age conversion
// remains the existing Web delivery input; User appends its float result and
// does not update the scalar cache until the next outer queue update.
function expectedStopRequest(before,source){
 const remaining=.6-Math.max(0,source.animationTime-.03)/Math.max(.01,source.animationPlaybackSpeed??1);
 const actor=structuredClone(before);
 if(remaining>0){actor.sourceStopQueues??={hit:[],world:[]};actor.sourceStopQueues.world.push({remaining:Math.fround(remaining),sourceId:'add'});}
 return {remaining,actor};
}

function capturedProjectile(profession){
  if(captures.has(profession))return captures.get(profession);
  const {sim,profile}=originalAddFixture(profession,{skillId,networkOwnerId:'add'});
  let now=0;
  const sync=createLocalOwnershipSync({reportEvery:1,clock:()=>now});
  sync.reconcile(sim,room(sim),'add');
  // Reconcile installs a new life and replaces actor identities. Always get
  // the current actor after that boundary, rather than a retired fixture ref.
  const actor=sim.actor('add');actor.mp=actor.mpMax;actor.sourceAdd.dp=8000;
  // configureLoadout promotes requested base nodes to their actual maximum
  // replacement. Observe that equipped node, not the requested ancestor ID.
  const equippedSkillId=actor.loadout[0]?.skillId;
  assert.equal(profile.skillCatalog.find(skill=>skill.skillId===equippedSkillId)?.executor,'EnergyBoom');
  sim.actor('target').x=1200;sim.drainEvents();
  let captured=null,lastReport=null,observedCast=false;
  try{
    let warmup=0;
    // Natural idle packets settle initial geometry/ground transitions and
    // input gates. Never force the actor into a skill or synthesize a mesh.
    while(warmup<180&&(warmup<2||!sim.skillAvailability('add',0).available)){
      now=++warmup*1000/60;sync.beforeStep(sim,'add');sim.step(dt,{},{snapshot:false});
      sync.afterStep(sim,'add',sim.drainEvents());
    }
    const available=sim.skillAvailability('add',0);
    assert.equal(available.available,true,JSON.stringify({state:actor.state,grounded:actor.grounded,inputLock:actor.inputLock,
      equippedSkillId,mp:actor.mp,mpMax:actor.mpMax,available}));
    for(let frame=1;frame<=360;frame++){
      now=(warmup+frame)*1000/60;sync.beforeStep(sim,'add');
      sim.step(dt,frame===1?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
      const events=sim.drainEvents();
      observedCast ||= events.some(event=>event.type==='skillStarted'&&event.actorId==='add'&&event.skillId===equippedSkillId);
      const raw=sync.afterStep(sim,'add',events);assert.ok(raw,'reportEvery=1 retains the actual source frontier');
      lastReport=raw;
      if(captured)continue;
      const effect=sim.state.effects.find(effect=>effect.ownerId==='add'&&effect.name===projectileName&&effect.active&&!effect.dead&&
        effect.elapsed>effect.damage.ATTACK_TIME_START);
      if(!effect||!raw.actions.some(action=>action.effects.some(wire=>wire.id===effect.id)))continue;
      const report=clean(raw);
      validateOwnedReferences(report,actor,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
      const action=report.actions.find(action=>action.effects.some(wire=>wire.id===effect.id));
      const wire=action.effects.find(wire=>wire.id===effect.id);
      assert.equal(effect.damage.DAMAGE_DATA.DAMAGE.MAGIC,14.2,'the authored payload has a real nonzero attack');
      assert.equal(Object.hasOwn(effect,'sourceBoneTargetMeshId'),false,'the real damage callback is independent of visual-set carriers');
      assert.equal(wire.active,true);assert.equal(Object.hasOwn(wire,'damage'),false);
      const shapes=sim.effectSampler(effect,actor,{profile});
      const sphere=shapes.find(shape=>shape.kind==='sphere'&&shape.radius>0&&shape.center?.length===3&&shape.center.every(Number.isFinite));
      assert.ok(sphere,'the original projectile mesh supplies a Native attack helper');
      captured={report:structuredClone(report),action:structuredClone(action),attack:structuredClone(sphere)};
    }
    assert.equal(observedCast,true,'the actual input dispatch enters the configured original skill');
    assert.ok(captured,'a real production critical action captures the active Native projectile');
    assert.equal(sim.state.effects.some(effect=>effect.ownerId==='add'&&effect.name===projectileName),false,'positive source ticks retire the original projectile lifetime');
    assert.equal(sync.sampledEffectCount,0,'retired attack identities do not accumulate in the sampling throttle');
    assert.equal(lastReport.actions.length,0,'the completed cast leaves no reliable work at the final source frame');
    captured.sourceFinalFrame=lastReport.frameSeq;captures.set(profession,captured);return captured;
  }finally{sync.clear();}
}

function recipient(profession,captured,protection,{worldStop=protection==='invincible' ? .8 : 0}={}){
  const {sim}=originalAddFixture(profession,{skillId,networkOwnerId:'target'});
  const sync=createLocalOwnershipSync({clock:()=>captured.report.frameSeq*1000/60});
  sync.reconcile(sim,room(sim),'target');
  const actor=sim.actor('target');actor.inputLock=0;sim.enter(actor,'RSI_WAIT','native-owner-history-regression');
  actor.hp=actor.hpMax*.75;actor.mp=40;
  // Translate the real posed Native defender sphere into a real captured
  // attack sphere. Neither attack shapes nor damage routines are replaced.
  const defender=sim.defenderSampler(actor,{profile:sim.profileFor(actor),role:'defender'})
    .find(shape=>shape.kind==='sphere'&&shape.center?.length===3&&shape.radius>0);
  assert.ok(defender,'the receiving actor has an original Native defender helper');
  for(const [index,key]of ['x','y','z'].entries())actor[key]+=captured.attack.center[index]-defender.center[index];
  assert.equal(sim.intersects(captured.attack,actor),true,'the actual Native narrowphase confirms a nonempty contact');
  Object.assign(actor,{invincible:protection==='invincible',forceInvincible:protection==='invincible' ? .7 : 0,
    superArmor:protection==='armor',superArmorNotRed:false,worldStop});
  sim.drainEvents();return {sim,sync,actor};
}

for(const profession of ['LP','MM','DE'])for(const protection of ['none','invincible','armor'])test(
  `${profession} actual Energy Boom reliable-only Native history retains current owner ${protection} and drains once`,t=>{
    const captured=capturedProjectile(profession),f=recipient(profession,captured,protection);
    t.after(()=>f.sync.clear());
    const currentOwner=structuredClone(f.actor),remoteBefore=structuredClone(f.sim.actor('add'));
    const effectsBefore=f.sim.state.effects.length;
    // This entry point is the reliable lane. No receivePeer/reconcile with the
    // source report occurs, so a body packet cannot supply missing collision.
    assert.equal(f.sync.receiveActions('add',[structuredClone(captured.action)],1,captured.report.frameSeq),true);
    assert.equal(f.sync.actionDiagnostics.pending,1);f.sync.beforeStep(f.sim,'target');
    const hits=f.sim.drainEvents().filter(event=>event.type==='hit'&&event.actorId==='add'&&event.targetId==='target'&&event.origin?.kind==='effect');
    assert.equal(f.sim.actor('target'),f.actor,'historical source substitution never replaces the real owner');
    assert.deepEqual(f.sim.actor('add'),remoteBefore,'temporary history restores the newest remote actor after collision');
    assert.equal(f.sync.actionDiagnostics.pending,0);
    assert.equal(f.sim.state.effects.length,effectsBefore,'temporary historical meshes cannot become permanent scene parents');
    if(protection==='invincible'){
      assert.equal(hits.length,0);assert.equal(f.actor.worldStop,.8,'a newly appended request leaves the current cache unchanged until its outer update');
      assert.deepEqual(f.actor,expectedStopRequest(currentOwner,captured.action.actor).actor,'current local invulnerability rejects stale combat changes; only the authored STOP request is appended');
    }else{
      assert.equal(hits.length,1);assert.ok(hits[0].amount>0,'Native contact must commit nonzero receiving-owner damage');
      assert.ok(f.actor.hp<currentOwner.hp);
      if(protection==='armor'){
        for(const key of ['state','stateSerial','animationName','animationTime','x','y','z'])assert.equal(f.actor[key],currentOwner[key],key);
        assert.equal(f.actor.superArmor,true,'current local armor still rejects the attack reaction');
      }else assert.notEqual(f.actor.stateSerial,currentOwner.stateSerial,'unprotected Native contact keeps its original reaction');
    }
    const settled=structuredClone(f.actor),consumed=f.sync.actionDiagnostics.totalConsumed;
    assert.equal(f.sync.receiveActions('add',[structuredClone(captured.action)],1,captured.report.frameSeq),true);
    f.sync.beforeStep(f.sim,'target');assert.equal(f.sync.actionDiagnostics.totalConsumed,consumed,'same reliable identity is delivered only once');
    const repeated={...structuredClone(captured.action),id:captured.action.id+1};
    assert.equal(f.sync.receiveActions('add',[repeated],1,captured.report.frameSeq),true);f.sync.beforeStep(f.sim,'target');
    assert.equal(f.sync.actionDiagnostics.totalConsumed,consumed+1,'another action identity still consults the same per-effect hit receipt');
    assert.deepEqual(f.actor,settled);assert.equal(f.sim.drainEvents().some(event=>event.type==='hit'&&event.targetId==='target'),false);
    assert.equal(f.sync.actionDiagnostics.pending,0);assert.equal(f.sim.state.effects.length,effectsBefore);
    assert.equal(f.sync.actionDiagnostics.overflowed,0);assert.equal(f.sync.actionDiagnostics.expired,0);
    f.sync.clear();assert.equal(f.sync.actionDiagnostics.pending,0);assert.equal(f.sync.actionDiagnostics.effectReceipts,0);
    assert.ok(captured.sourceFinalFrame>captured.report.frameSeq);
  });

for(const profession of ['LP','MM','DE'])test(`${profession} invulnerability admits the authored STOP request before the next cache update without combat changes`,t=>{
  const captured=capturedProjectile(profession),f=recipient(profession,captured,'invincible',{worldStop:0});
  t.after(()=>f.sync.clear());
  const before=structuredClone(f.actor),source=captured.action.actor;
  const stop=f.sim.profileFor(f.sim.actor('add')).states[source.state].raw.STOP_OTHER_UNIT0;
  assert.deepEqual(stop,{'1':.03,'2':.6},'the original Energy Boom declares a distinct external skill-stop event');
  assert.ok(source.fired.includes('STOP_OTHER_UNIT0'));
  const distance=Math.hypot(before.x-source.x,before.y-source.y,before.z-source.z);
  assert.ok(distance<1300,'the actual posed target is inside the full original stop range');
  const {remaining,actor:queued}=expectedStopRequest(before,source);
  assert.ok(remaining>0&&remaining<.8,'the captured authored stop is still live but shorter than the previous case local stop');
  assert.equal(f.sync.receiveActions('add',[structuredClone(captured.action)],1,captured.report.frameSeq),true);
  f.sync.beforeStep(f.sim,'target');
  const events=f.sim.drainEvents(),stops=events.filter(event=>event.type==='worldStop'&&event.actorId==='add');
  assert.equal(stops.length,1);assert.ok(Math.abs(stops[0].duration-remaining)<1e-12);
  assert.equal(f.actor.worldStop,before.worldStop,'the original setter appends without immediately projecting the cache');
  assert.equal(events.some(event=>event.type==='hit'&&event.targetId==='target'),false);
  // Preserve any earlier source queues instead of treating their existence as
  // an unrelated combat mutation. This exact queue is the one admitted delta.
  assert.deepEqual(f.actor,queued);
  assert.equal(advanceActorStops(f.actor,0),0);
  assert.equal(f.actor.worldStop,Math.fround(remaining),'the next User queue update projects the last original float request');
  assert.deepEqual(f.actor,{...queued,worldStop:Math.fround(remaining)});
  assert.equal(f.sim.actor('target'),f.actor);assert.equal(f.sync.actionDiagnostics.pending,0);
  assert.equal(f.sim.state.effects.some(effect=>effect.ownerId==='add'),false);
});
