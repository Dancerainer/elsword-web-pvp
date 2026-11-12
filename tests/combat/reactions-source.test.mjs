import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  REACTION_REFERENCE,isDamagedReaction,createKnockdownGauge,forceDownContribution,reserveKnockdown,
  knockdownStateStarted,commitKnockdown,advanceKnockdown,requestKnockdown,
  consumeKnockdown,resetAttackerKnockdown,nextFlyCount,reactionLocalBackSpeed,
  attackerIsFront,selectHitReaction,airSmallStartFuture,knockdownThresholdReaction,airborneReactionNext,
  deathState,createDeathPresentation,advanceDeathPresentation,nativeBodyOverlap,nativeBodyPushCandidate,nativeBodyPassBlocked,
} from '../../packages/combat-core/reaction-policy.mjs';
const evidence=JSON.parse(readFileSync(new URL('../../contracts/rf-reaction-source.json',import.meta.url)));

test('source policy candidate retains fixed V5 provenance separate from target enums',()=>{
  assert.equal(REACTION_REFERENCE.evidence,'reference-v5; target2016 runtime unmeasured');
  assert.equal(evidence.referenceCommit,REACTION_REFERENCE.commit);
  assert.equal(evidence.targetEnums.RT_UP,4);assert.equal(evidence.targetEnums.RT_FLY,5);
  assert.equal(evidence.targetStates.RSI_DIE_FRONT.raw.ANIM_NAME,'DamageDownFront');
  assert.equal(evidence.targetStates.RSI_DIE_BACK.raw.CAN_PASS_UNIT,1);
});

test('IsDamagedReaction checks independently extracted target enum names, including dummy and guard',()=>{
  const excluded=new Set(['RT_NO_DAMAGE','RT_SENSOR','RT_REVENGE','RT_REFLECT','RT_THROW','RT_CREATE_DAMAGE_EFFECT']);
  for(const [name,type] of Object.entries(evidence.targetEnums)){
    assert.equal(isDamagedReaction({REACT_TYPE:type}),!excluded.has(name),name);
  }
  assert.equal(evidence.targetEnums.RT_REFLECT,17);
  assert.equal(evidence.targetEnums.RT_FLIP_SAME_DIR,18);
  assert.equal(isDamagedReaction({REACT_TYPE:evidence.targetEnums.RT_REFLECT},{reflectExcluded:false}),true);
  assert.equal(isDamagedReaction({REACT_TYPE:evidence.targetEnums.RT_CREATE_DAMAGE_EFFECT},{createDamageEffectExcluded:false}),true);
  assert.equal(isDamagedReaction(null),false);
  // NO_DAMAGE is a separate reserve gate; neither dummy nor guard is excluded.
  assert.equal(isDamagedReaction({REACT_TYPE:evidence.targetEnums.RT_SMALL_DAMAGE,NO_DAMAGE:true}),true);
});

test('2011 reference patch takes maximum hit contribution in batch, not sum',()=>{
  // Literal max(8.5,11.63) from target Z2/Z3 data and source reserve branch.
  let g=createKnockdownGauge();
  g=reserveKnockdown(g,8.5);g=reserveKnockdown(g,11.63);
  assert.equal(g.now,0);assert.equal(g.pending,11.63);
  g=commitKnockdown(g);assert.equal(g.now,11.63);assert.equal(g.pending,null);
  g=commitKnockdown(reserveKnockdown(g,8.5));assert.ok(Math.abs(g.now-20.13)<1e-12); // JS double representation of the transcribed decimal equation.
});

test('pending-only state-start latch reset follows source sentinel condition',()=>{
  const pending=reserveKnockdown(createKnockdownGauge(),8.5);
  assert.equal(knockdownStateStarted(pending).addedThisState,false);
  const committed=commitKnockdown(pending);
  assert.equal(knockdownStateStarted(committed).addedThisState,true);
  assert.equal(commitKnockdown(reserveKnockdown(committed,-14)).now,0);
  assert.equal(commitKnockdown(reserveKnockdown({...committed,now:95},13.88)).now,100);
  // DamageReact reserves first; direct StateChange starts Future afterwards.
  // A subsequent lower contribution therefore overwrites the pending reserve.
  const stateStarted=knockdownStateStarted(reserveKnockdown(createKnockdownGauge(),20));
  assert.equal(reserveKnockdown(stateStarted,10).pending,10);
});

test('source threshold checks old gauge before pending contribution commit',()=>{
  const pending=reserveKnockdown({...createKnockdownGauge(),now:95},8.5);
  assert.equal(requestKnockdown(pending).triggered,false);
  const after=commitKnockdown(pending);
  const requested=requestKnockdown(after);assert.equal(requested.triggered,true);
  assert.equal(requested.gauge.now,100);assert.equal(requested.gauge.activated,true);
  assert.equal(consumeKnockdown(requested.gauge,'RSI_DAMAGE_AIR_DOWN').consumed,false);
  const applied=consumeKnockdown(requested.gauge,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');
  assert.equal(applied.consumed,true);assert.equal(applied.gauge.now,0);
  assert.equal(requestKnockdown(after,{deferred:false}).gauge.now,0);
});

test('damage age waits two seconds and decays full simulation step crossing boundary',()=>{
  const g={...createKnockdownGauge(),now:30,lastDamageSeconds:1.9};
  assert.equal(advanceKnockdown(g,.05).now,30);
  assert.equal(advanceKnockdown(g,.1).now,29); // timer becomes2; full0.1*10.
  assert.equal(advanceKnockdown({...g,lastDamageSeconds:3},4).now,0);
  assert.equal(commitKnockdown(reserveKnockdown({...g,lastDamageSeconds:20},0)).lastDamageSeconds,0);
  assert.equal(resetAttackerKnockdown(g).now,0);
  assert.equal(resetAttackerKnockdown(g).lastDamageSeconds,1.9);
});

test('force-down adjustment preserves negatives and explicit penetration modifiers',()=>{
  assert.equal(forceDownContribution({FORCE_DOWN:8.5,DECREASE_FORCE_DOWN:3}),5.5);
  assert.equal(forceDownContribution({FORCE_DOWN:8.5},{penetrating:true}),-10);
  assert.equal(forceDownContribution({FORCE_DOWN:-14},{penetrating:true}),-24);
  assert.equal(forceDownContribution({FORCE_DOWN:8.5,DECREASE_FORCE_DOWN:3},{skillNote:false,penetrating:true}),8.5);
  assert.equal(commitKnockdown(reserveKnockdown(createKnockdownGauge(),20,{pvp:false})).now,0);
});

test('target FORCE_FLY resets count while the user V53 rule removes repeated-launch height division',()=>{
  const target=evidence.targetStates.RSI_COMBO_ZZXX.raw.DAMAGE_DATA;
  assert.equal(target.REACT_TYPE,4);assert.equal(target.FORCE_FLY,1);
  assert.equal(nextFlyCount(8,target),0);
  let n=0;const result=[];
  for(let i=0;i<4;i++){
    n=nextFlyCount(n,{REACT_TYPE:5});
    result.push(selectHitReaction({REACT_TYPE:5,BACK_SPEED_Y:800},{flyCount:n}).vy);
  }
  assert.deepEqual(result,[800,800,800,800]);
  assert.equal(nextFlyCount(8,{REACT_TYPE:1},{superArmor:true}),0);
  assert.equal(nextFlyCount(3,{REACT_TYPE:1}),3);
});

test('RT_UP uses distinct original airborne up/fall animations',()=>{
  const target=evidence.targetStates.RSI_COMBO_ZZXX.raw.DAMAGE_DATA;
  const r=selectHitReaction(target,{grounded:true,flyCount:0,fromFront:false});
  assert.equal(r.state,'RSI_DAMAGE_AIR_UP');assert.equal(r.vy,1800);assert.equal(r.grounded,false);
  assert.equal(airborneReactionNext(r.state,{grounded:false,vy:-1}),'RSI_DAMAGE_AIR_FALL');
  assert.equal(airborneReactionNext('RSI_DAMAGE_AIR_FALL',{grounded:false,vy:1}),'RSI_DAMAGE_AIR_UP');
  assert.equal(airborneReactionNext('RSI_DAMAGE_AIR_UP',{grounded:false,vy:0}),null);
});

test('UP and FLY clear native foot-on-line before the later threshold test',()=>{
  // User:11697/11744 call ResetOnSomethingFuture before User:12009-12058.
  for(const type of [evidence.targetEnums.RT_UP,evidence.targetEnums.RT_FLY]){
    const ordinary=selectHitReaction({REACT_TYPE:type,BACK_SPEED_Y:1000},{grounded:true});
    const threshold=knockdownThresholdReaction(ordinary);
    assert.equal(ordinary.grounded,false);
    assert.equal(threshold.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');
    assert.equal(threshold.vy,0);
  }
});

test('air small native entry adds 700 vertical and walk speed .33 horizontal adjustment',()=>{
  const r=selectHitReaction({REACT_TYPE:1,BACK_SPEED_X:725,BACK_SPEED_Y:200},
    {grounded:false,fromFront:true,heightAboveLand:200,walkSpeed:500});
  assert.equal(r.state,'RSI_DAMAGE_AIR_SMALL');assert.equal(r.vy,200);assert.equal(r.localVx,-725);
  const start=airSmallStartFuture({...r,fromFront:true,walkSpeed:500});
  assert.equal(start.vy,900);assert.equal(start.localVx,-890);
  const near=selectHitReaction({REACT_TYPE:1,BACK_SPEED_Y:200},{heightAboveLand:149,vy:50});
  assert.equal(near.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(near.vy,0);
  assert.equal(selectHitReaction({REACT_TYPE:2},{heightAboveLand:150,attackerUnitHeightAboveLand:90}).state,'RSI_DAMAGE_AIR_SMALL');
  assert.equal(selectHitReaction({REACT_TYPE:2},{heightAboveLand:200,attackerUnitHeightAboveLand:89}).state,'RSI_DAMAGE_BIG_FRONT');
});

test('air down and fly preserve distinct grounded successors and source invulnerability',()=>{
  assert.equal(airborneReactionNext('RSI_DAMAGE_AIR_FLY_BACK',{grounded:true,vy:0}),'RSI_DAMAGE_DOWN_FRONT');
  assert.equal(airborneReactionNext('RSI_DAMAGE_AIR_FLY_BACK',{grounded:true,vy:0,held:true}),null);
  assert.equal(airborneReactionNext('RSI_DAMAGE_AIR_DOWN',{grounded:true,vy:0}),'RSI_DAMAGE_AIR_DOWN_LANDING');
  assert.equal(knockdownThresholdReaction({grounded:false,vy:800}).state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');
  assert.equal(knockdownThresholdReaction({grounded:false,vy:800}).vy,0);
  assert.deepEqual(evidence.targetStates.RSI_DAMAGE_AIR_DOWN_INVINCIBLE.raw.INVINCIBLE,{'1':0,'2':100});
  assert.equal(REACTION_REFERENCE.standupInvincibleSeconds,.3);
});

test('reaction origin and facing use native 3D lane dot rather than owner world x',()=>{
  assert.equal(attackerIsFront([0,0,0],[0,0,10],[0,0,1],true),true);
  assert.equal(attackerIsFront([0,0,0],[0,0,10],[0,0,1],false),false);
  assert.equal(attackerIsFront([0,0,0],[0,0,0],[1,0,0],false),false);
  assert.equal(reactionLocalBackSpeed({BACK_SPEED_X:725},true),-725);
  assert.equal(reactionLocalBackSpeed({BACK_SPEED_X:725},false),725);
  // Target unknown FORCE_DIRECTION_FLY is not automatically adopted from V5 2026 patch.
  assert.equal(reactionLocalBackSpeed({BACK_SPEED_X:725,FORCE_DIRECTION_FLY:2},true),-725);
});

test('fatal airborne hit waits for landing before front/back death starts',()=>{
  assert.equal(deathState({hp:0,grounded:false}),null);
  assert.equal(deathState({hp:0,grounded:true,fromFront:false}),'RSI_DIE_BACK');
  assert.equal(deathState({hp:1,grounded:true}),null);
  assert.equal(REACTION_REFERENCE.deathAnimationSpeed,.5);
});

test('death fade begins after animation end and hides only after alpha was nonpositive',()=>{
  let s=createDeathPresentation();
  assert.equal(advanceDeathPresentation(s,.5,{animationEnded:false}).alpha,1);
  s=advanceDeathPresentation(s,.5,{animationEnded:true});assert.equal(s.alpha,.25);assert.equal(s.visible,true);
  s=advanceDeathPresentation(s,.5,{animationEnded:true});assert.equal(s.alpha,-.5);assert.equal(s.visible,true);
  s=advanceDeathPresentation(s,1/60,{animationEnded:true});assert.equal(s.visible,false);assert.equal(s.phase,'complete');
});

test('native body uses horizontal x/z width and inclusive vertical span, not render mesh bounds',()=>{
  const a={position:[0,0,0],width:70,height:150};
  assert.equal(nativeBodyOverlap(a,{...a,position:[69,150,0]}).overlaps,true);
  assert.equal(nativeBodyOverlap(a,{...a,position:[0,151,0]}).overlaps,false);
  assert.equal(nativeBodyOverlap(a,{...a,position:[0,0,70]}).overlaps,false);
  assert.equal(nativeBodyOverlap(a,{...a,position:[0,0,69]}).overlaps,true);
  assert.deepEqual(nativeBodyPushCandidate(a,{...a,position:[0,0,60]},{direction:[0,0,1]}),[0,0,-10]);
  assert.deepEqual(nativeBodyPushCandidate(a,{...a,position:[0,0,60]},{direction:[0,0,1],marginMax:4}),[0,0,-4]);
});

test('unknown reaction kinds are explicit unsupported and corrupt scalar values are rejected',()=>{
  assert.equal(selectHitReaction({REACT_TYPE:15}).supported,false);
  assert.throws(()=>forceDownContribution({FORCE_DOWN:NaN}),/finite/);
  assert.throws(()=>advanceKnockdown(createKnockdownGauge(),-.1),/nonnegative/);
  assert.throws(()=>nextFlyCount(-1,{REACT_TYPE:5}),/nonnegative/);
});

test('native body pass rejects a full step crossing while retaining backup/future side tests',()=>{
  const a={position:[0,0,0],width:70,height:150};
  const b={...a,position:[50,0,0]};
  assert.equal(nativeBodyPassBlocked(a,b,{position:[100,0,0]}),true);
  assert.equal(nativeBodyPassBlocked(a,b,{position:[40,0,0]}),false);
  assert.equal(nativeBodyPassBlocked(a,b,{position:a.position}),false);
  assert.equal(nativeBodyPassBlocked(a,{...b,position:[50,200,0]},{position:[100,0,0]}),false);
  assert.equal(nativeBodyPassBlocked(a,b,{position:[100,0,0],backupPosition:[-50,0,0]}),false);
});
