import test from 'node:test';
import assert from 'node:assert/strict';
import {make,frames,profile,preset} from '../helpers/rf-passive-fixture-v12.mjs';
import {evaluateStateProtection} from '../../packages/combat-core/state-protection.mjs';
import {damageTimedParticleEntries} from '../../packages/combat-core/damage-start-particles.mjs';
import {advanceLiteralMeshClock,firstGlobalDamageStageCrossed} from '../../packages/combat-core/literal-mesh-clock.mjs';

function tick(s,command={}){s.step(1/60,command,{snapshot:false});}

test('explicit user MegaDrill rule grants armor at entry and each frame, keeps hit damage and red-outline flag, ends without leaking',async()=>{
 const s=await make({skillId:24203,positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf'),b=s.actor('target');
 const original=structuredClone(profile.states.RSI_A_RF_MEGADRILL_BREAK.raw);
 tick(s,{pressed:['A'],held:['A']});assert.equal(a.superArmor,true);assert.equal(a.superArmorNotRed,false);
 frames(s,8);const before=a.hp,state=a.state;
 const hit=s.applyHit(b,a,{DAMAGE:{PHYSIC:100},DAMAGE_TYPE:0,REACT_TYPE:2,BACK_SPEED_X:150,FORCE_DOWN:2},{kind:'controlled-armor-verification'});
 assert.equal(hit.accepted,true);assert.ok(a.hp<before);assert.equal(a.state,state);assert.equal(a.superArmor,true);
 frames(s,240);assert.equal(a.skillId,null);assert.equal(a.superArmor,false);
 assert.deepEqual(profile.states.RSI_A_RF_MEGADRILL_BREAK.raw,original);
 assert.equal(evaluateStateProtection(original,.6).superArmor,false,'source declarations remain separate');
});

test('Pulse Nova retains actual target DCES_CUSTOM_STATE fire and charge handles until their dash-entry stop',async()=>{
 const s=await make({skillId:24009,positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
 tick(s,{pressed:['A'],held:['A']});
 for(let i=0;i<120&&a.state!=='RSI_SA_RRF_WILD_CHARGING';i++)tick(s,{held:['A']});
 assert.equal(a.state,'RSI_SA_RRF_WILD_CHARGING');tick(s,{held:['A']});
 const remembered=structuredClone(a.sourceCustomStateEffectGroup);assert.equal(remembered.length,2);
 assert.ok(remembered.every(e=>e.setName==='EffectSet_SA_RRF_WildCharge_Charge'));
 assert.ok(remembered.every(p=>s.state.effects.some(e=>p.id===e.id)),'cleanup-owned presentation handles remain available for network remapping');
 tick(s,{released:['A']});assert.equal(a.state,'RSI_SA_RRF_WILD_CHARGE_DASH');assert.equal(a.sourceCustomStateEffectGroup,undefined);
 const ended=s.state.events.filter(e=>e.type==='effectEnded'&&e.reason==='original-custom-state-delete');
 assert.deepEqual(ended.map(e=>e.effectId),remembered.map(e=>e.id));
 assert.ok(!s.state.effects.some(e=>remembered.some(p=>p.id===e.id)),'the original custom-state stop removes every retained handle');
});

test('real XCrash SPEED_TIME2 launches with source positive Y and launches in both directions and source end selects air or the actual upper platform',async()=>{
 for(const facing of [-1,1]){
  const s=await make({skillId:24010,positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');a.facing=facing;
  tick(s,{pressed:['A'],held:['A']});let launched=false,ended=false;
  for(let i=0;i<200;i++){
   const prior=a.state,priorY=a.y;tick(s);const events=s.drainEvents();
   if(events.some(e=>e.type==='velocityEvent'&&e.field==='SPEED_TIME2')&&a.state==='SI_SA_RRF_X_CRASH'){
    launched=true;assert.equal(a.grounded,false);assert.ok(a.y>priorY);
   }
   if(prior==='SI_SA_RRF_X_CRASH'&&a.state!=='SI_SA_RRF_X_CRASH'){
    if(facing===1){assert.equal(a.state,'RSI_JUMP_DOWN');assert.equal(a.grounded,false);assert.ok(a.y>2840);}else{assert.equal(a.state,'RSI_WAIT');assert.equal(a.grounded,true);assert.equal(a.y,3080);}ended=true;break;
   }
  }
  assert.ok(launched);assert.ok(ended);
 }
});

test('XCrash timed flames are emitted once at their literal global times and survive JSON round-trip without re-firing',async()=>{
 const s=await make({skillId:24010,positions:[[2022.98,2840,0],[1000,2840,0]]});
 tick(s,{pressed:['A'],held:['A']});let observed=[];
 for(let i=0;i<220;i++){tick(s);observed.push(...s.drainEvents().filter(e=>e.type==='effectTimedParticles'));
  if(i===80){const saved=JSON.parse(JSON.stringify(s.snapshot()));s.restore(saved);}
 }
 const fire=observed.filter(e=>e.name==='DamageEffect_SA_RRF_XCrash_Fire_FX');
 const keys=fire.flatMap(e=>e.entries.map(x=>x.key));
 assert.deepEqual([...keys].sort((a,b)=>+a.slice(13)-+b.slice(13)),Array.from({length:17},(_,i)=>'TIME_PARTICLE'+i));
 assert.equal(new Set(keys).size,17);assert.ok(fire.every(e=>e.entries.every(x=>x.entry.PARTICLE_NAME==='Raven_Hand_Fire05')));
});

test('time-particle query respects separate clocks and rejects malformed events',()=>{
 const raw={TIME_PARTICLE0:{EVENT_TIME:.2,USE_GLOBAL_TIME:1},TIME_PARTICLE1:{EVENT_TIME:.4},TIME_PARTICLE2:{EVENT_TIME:-1}};
 const entries=damageTimedParticleEntries(raw,[],{beforeGlobal:.1,afterGlobal:.3,beforeAnimation:.1,afterAnimation:.3});
 assert.deepEqual(entries.map(x=>x.key),['TIME_PARTICLE0']);
 assert.deepEqual(damageTimedParticleEntries(raw,['TIME_PARTICLE0'],{beforeGlobal:.3,afterGlobal:.5,beforeAnimation:.3,afterAnimation:.5}).map(x=>x.key),['TIME_PARTICLE1']);
 const exact=Math.fround(.2);
 assert.equal(damageTimedParticleEntries({TIME_PARTICLE0:{EVENT_TIME:.2,USE_GLOBAL_TIME:1}},[],{beforeGlobal:.1,afterGlobal:exact}).length,0);
 assert.equal(damageTimedParticleEntries({TIME_PARTICLE0:{EVENT_TIME:.2,USE_GLOBAL_TIME:1}},[],{beforeGlobal:exact,afterGlobal:.3}).length,1);
 assert.equal(damageTimedParticleEntries({TIME_PARTICLE0:{EVENT_TIME:.2}},[],{beforeAnimation:exact,afterAnimation:.3}).length,0);
});

test('real keyboard XXX retains compiled .16/7MP payment once and replaces old smoke with the documented target-resource owner candidate',async()=>{
 const s=await make({passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
 s.drainEvents();let particles=[],cost=null,entered=false,started=[];
 for(let i=0;i<95;i++){
  const beforeMp=a.mp;tick(s,[0,12,26].includes(i)?{pressed:['X'],held:['X']}:{});
  const events=s.drainEvents(),requested=events.filter(e=>e.type==='originalRecoveredParticle');
  if(a.state==='RSI_COMBO_XXX')entered=true;
  particles.push(...requested);started.push(...events.filter(e=>e.type==='effectStarted'&&e.setName==='EffectSet_A_RF_XXX'));
  if(events.some(e=>e.type==='xxxCandidatePayment'&&e.accepted)){cost=beforeMp-a.mp;assert.ok(a.animationTime>=.16);}
 }
 assert.equal(entered,true);assert.equal(cost,7);
 assert.equal(particles.length,0,'old presentation is suppressed');
 assert.deepEqual(started.map(p=>p.name),['Raven_Hand_FireSM','DamageEffect_RF_XXX']);
 assert.ok(started.every(p=>p.sourceCandidate?.evidenceClass==='target2016-resource-owner-candidate-unverified'));
 assert.ok(a.unsupported.some(n=>n.id==='xxx-target-owner-candidate'),'the unavailable owner remains explicitly identified');
});

test('XXX with less than source 7MP uses magic-fail path and creates no explosion sequences',async()=>{
 const s=await make({passives:[]}),a=s.actor('rf');s.enter(a,'RSI_COMBO_XXX','bounded-source-callback-test');a.mp=6;s.drainEvents();
 const events=[];for(let i=0;i<35;i++){tick(s);events.push(...s.drainEvents());}
 assert.equal(a.mp,6);assert.equal(events.filter(e=>e.type==='nativeCommandMagicFail').length,1);
 assert.equal(events.filter(e=>e.type==='originalRecoveredParticle').length,0);
});

test('Nuclear / Chinese Ion skill emits all 3 missile and 9 explosion timed sequences with a detached world birth',async()=>{
 const s=await make({skillId:24007,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');s.drainEvents();
 tick(s,{pressed:['A'],held:['A']});assert.equal(a.state,'RSI_A_ROT_NUCLEAR');
 const events=[],parents=new Map(),stages=[];for(let i=0;i<240;i++){tick(s);for(const e of s.state.effects)if(e.name==='DamageEffect_ROT_NUCLEAR_NEW_EXPLOSION')stages.push({elapsed:e.sourceMeshGlobalTime,stage:e.stage,animation:e.animationTime});const emitted=s.drainEvents();events.push(...emitted);for(const e of emitted.filter(e=>e.type==='effectStarted')){const parent=s.state.effects.find(p=>p.id===e.effectId);if(parent)parents.set(e.effectId,structuredClone(parent));}}
 const starts=events.filter(e=>e.type==='effectStarted'&&e.name.startsWith('DamageEffect_ROT_NUCLEAR_NEW'));
 assert.equal(starts.length,3);assert.ok(starts.every(e=>e.definition.TRACE===undefined));
 const missile=starts.find(e=>e.name==='DamageEffect_ROT_NUCLEAR_NEW_Missile'),explosion=starts.find(e=>e.name==='DamageEffect_ROT_NUCLEAR_NEW_EXPLOSION');
 const missileParent=parents.get(missile.effectId),explosionParent=parents.get(explosion.effectId);
 assert.equal(missile.birthAnchor.position[0],missileParent.birthActorPose.x-270);assert.equal(explosion.birthAnchor.position[0],explosionParent.birthActorPose.x-250);
 assert.deepEqual(explosionParent.currentAnchor.position,explosion.birthAnchor.position);
 assert.equal(explosion.definition.SCALE_X,1.04);
 assert.ok(stages.some(e=>e.elapsed<Math.fround(.8)&&e.stage===0));
 assert.ok(stages.some(e=>e.elapsed>Math.fround(.8)&&e.stage===1),'global .8 enables the original final damage stage');
 assert.ok(stages.filter(e=>e.stage===1).every(e=>e.elapsed>Math.fround(.8)),'fast mesh animation cannot trigger global damage early');
 const timed=events.filter(e=>e.type==='effectTimedParticles');
 assert.equal(timed.filter(e=>e.name==='DamageEffect_ROT_NUCLEAR_NEW_Missile').flatMap(e=>e.entries).length,3);
 assert.equal(timed.filter(e=>e.name==='DamageEffect_ROT_NUCLEAR_NEW_EXPLOSION').flatMap(e=>e.entries).length,9);
});

test('literal Nuclear mesh rates use source global RunEvent before skin update, and do not reset .3 change back to initial 3',()=>{
 const e={elapsed:0,animationTime:0},t=profile.effectTemplates.NUCLEAR_Effect_Nuclear;
 advanceLiteralMeshClock(e,t,.1);assert.equal(e.sourceMeshAnimationSpeed,3);assert.equal(e.animationTime,Math.fround(Math.fround(.1)*3));
 advanceLiteralMeshClock(e,t,.1);advanceLiteralMeshClock(e,t,.1);assert.equal(e.sourceMeshAnimationSpeed,Math.fround(1.15));
 const before=e.animationTime;advanceLiteralMeshClock(e,t,.1);assert.equal(e.sourceMeshAnimationSpeed,Math.fround(1.15));
 assert.equal(e.animationTime,Math.fround(before+Math.fround(Math.fround(.1)*Math.fround(1.15))));
 assert.equal(advanceLiteralMeshClock({elapsed:0,animationTime:0},{events:[{property:'AniSpeed',start:0,value:{random:[1,2]}}]},.1).supported,false);
});

test('actual XCrash main-mesh Dummy01 and a child attack helper rotate by source -45 roll around the same fixed birth pivot',async()=>{
 const s=await make({passives:[]}),a=s.actor('rf');a.facing=1;
 const definition=profile.effectSets.EffectSet_SA_RRF_XCrash.raw.EFFECT1;
 assert.equal(definition.ROTATE_Z,-45);
 const anchor=s.effectAnchorSampler({definition},a);assert.deepEqual(anchor.rotation,[0,0,-45]);
 const e={name:definition.NAME,definition,damage:profile.damageEffects[definition.NAME].raw,animationTime:.4,
  birthAnchor:{position:[100,200,0],facing:1,rotation:[0,0,0]}};
 const base=s.effectBoneSampler(e,a,'Dummy01');assert.ok(base);
 const helper={...e,damage:profile.damageEffects.DamageEffect_SA_RRF_XCrash1_Damage.raw};
 const helperBefore=s.effectSampler(helper,a);assert.ok(helperBefore.length);
 e.birthAnchor.rotation=[0,0,-45];const rotated=s.effectBoneSampler(e,a,'Dummy01'),c=Math.SQRT1_2;
 const point=p=>[100+(p[0]-100)*c+(p[1]-200)*c,200-(p[0]-100)*c+(p[1]-200)*c,p[2]];
 point(base).forEach((n,i)=>assert.ok(Math.abs(n-rotated[i])<1e-8));
 const helperAfter=s.effectSampler(helper,a);
 for(let i=0;i<helperBefore.length;i++)if(helperBefore[i].center){
  const expected=point(helperBefore[i].center);expected.forEach((n,j)=>assert.ok(Math.abs(n-helperAfter[i].center[j])<1e-8));
 }
});

test('first global damage change uses its own strict float crossing and rejects malformed time',()=>{
 const raw={USE_GLOBAL_TIME:0,DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME:{'1':.8}};
 const eventTime=Math.fround(.8);
 assert.equal(firstGlobalDamageStageCrossed(raw,.7,eventTime),false);
 assert.equal(firstGlobalDamageStageCrossed(raw,eventTime,.81),true);
 assert.equal(firstGlobalDamageStageCrossed(raw,.81,.9),false);
 assert.equal(firstGlobalDamageStageCrossed({DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME:{'1':-1}},0,1),false);
 assert.equal(firstGlobalDamageStageCrossed({DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME:{'1':'0.8'}},0,1),false);
});

test('effect-start events omit absent buff ownership and preserve complete JSON snapshot equality',async()=>{
 const s=await make({skillId:24007,passives:[]});tick(s,{pressed:['A']});frames(s,85);
 const events=s.state.events.filter(e=>e.type==='effectStarted');assert.ok(events.length);
 assert.ok(events.every(e=>!Object.hasOwn(e,'buffTemplateId')));
 const saved=s.snapshot();assert.deepEqual(JSON.parse(JSON.stringify(saved)),saved);
});
