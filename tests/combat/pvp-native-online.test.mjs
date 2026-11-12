import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Four real actors, authored Garpai collision, original pose/effect samplers
 * and sealed native WASM. These are implementation regressions against stated
 * source rules/fixed inputs, not target-client measured golden trajectories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {PvpMatch,chooseTeamSpawns} from '../../packages/pvp/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:process.env.RF_ASSET_ROOT??path.join(root,'artifacts')});
const players=[{id:'r0',team:0},{id:'r1',team:0},{id:'b0',team:1},{id:'b1',team:1}];
const dt=1/60;
const near=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be ${expected} ±${tolerance}`);
async function fixture(seed=2016,{passives=[],guildPassives=[],attributes={}}={}){
  const {native,samplers}=await assets.createRuntime();
  const spawns=chooseTeamSpawns(assets.map,players);
  const sim=createSimulation({profile:assets.profile,map:assets.map,seed,
    // Explicit neutral equipment and disabled RF/guild defaults isolate the
    // source PvP rules. Individual integration cases opt into sourced passives;
    // production speed, map, damage data and all native modules stay unchanged.
    preset:{...authoredEquipmentPreset(assets.preset),onlineMatch:true,passives,guildPassives,
      attributes:{...authoredEquipmentPreset(assets.preset).attributes,damageReduction:0,awakeningChargeBonus:0,...attributes},loadout:Array(8).fill(null)},
    actors:players.map((p,i)=>({...p,...spawns[i],passives,guildPassives,loadout:Array(8).fill(null)})),...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,
    versions:{...native.versions,...assets.versions}});
  const originals=structuredClone(sim.state.actors);
  const pvp=new PvpMatch({players,map:assets.map,seed,versions:sim.versions,onRespawn(id){
    const actor=structuredClone(originals.find(a=>a.id===id)),index=sim.state.actors.findIndex(a=>a.id===id);
    sim.state.actors[index]=actor;sim.state.effects=sim.state.effects.filter(e=>e.ownerId!==id);
    sim.enter(actor,'RSI_WAIT','pvp-respawn');return actor;
  }});
  const consume=()=>{const events=sim.drainEvents();
    for(const e of events)if(e.type==='hit')pvp.recordHit({attackerId:e.actorId,targetId:e.targetId,damage:e.amount});
    return events;};
  const tick=(inputs={})=>{
    if(pvp.timeScale>0)sim.step(dt*pvp.timeScale,inputs,{snapshot:false});
    const events=consume();pvp.advance(dt,sim);return [...events,...pvp.drainEvents()];
  };
  const frames=(count,inputs={})=>{const events=[];for(let i=0;i<count;i++)events.push(...tick(inputs));return events;};
  pvp.start(sim);sim.drainEvents();pvp.drainEvents();
  let guard=0;while(pvp.state.phase==='intro'){assert.ok(guard++<300);tick();}
  const place=(id,x,lineId=0)=>{
    const a=sim.actor(id),line=assets.map.lines.find(l=>l.lineId===lineId);
    a.x=x;a.y=line.start[1];a.z=line.start[2];a.lineId=lineId;a.lastTouchLineId=lineId;a.landPosition=[a.x,a.y,a.z];
    a.grounded=true;a.vx=0;a.vy=0;a.vz=0;a.facing=1;a.inputLock=0;
    sim.enter(a,'RSI_WAIT','fixed-online-test-position');
  };
  // Independently frozen target66X first punch: PHYSIC1.52, HIT_ADD_MP2.5.
  const hitData=structuredClone(assets.profile.states.RSI_DASH_COMBO_X.raw.DAMAGE_DATA);
  assert.equal(hitData.DAMAGE.PHYSIC,1.52);assert.equal(hitData.HIT_ADD_MP,2.5);
  return {sim,pvp,tick,frames,place,consume,hitData,initialActors:originals};
}

test('four-player headless host really binds sealed native modules and authored team/map geometry',async()=>{
  const f=await fixture();assert.equal(f.sim.state.actors.length,4);
  for(const field of ['geometryRuntime','commandRuntime','skillRuntime','nasodRuntime','criticalRuntime','manaBreakRuntime'])assert.equal(f.sim.versions[field],'original-cpp-wasm',field);
  assert.deepEqual(f.sim.state.actors.map(a=>[a.x,a.y,a.z]),[
    [-2082.55,2840,0],[-1952.1,2840,0],[2022.98,2840,0],[1858.11,2840,0],
  ]);
  assert.equal(assets.map.lines.length,11);
  const support=f.sim.nativeGeometry.support({position:[-2050,2840,0],lastLineId:0,radius:30});
  assert.equal(support.found,true);assert.equal(support.lineId,0);near(support.point[1],2840);
});
test('four native actors start MP0 with gauge50 and zero orbs; one more half bar fills exactly one orb',async()=>{
  const f=await fixture();
  for(const a of f.sim.state.actors){assert.equal(a.mp,0);assert.equal(a.awakening.orbs,0);assert.equal(a.awakening.gauge,50);}
  const actor=f.sim.actor('r0');
  f.sim.addCharge(actor,49,'hit');assert.equal(actor.awakening.orbs,0);assert.equal(actor.awakening.gauge,99);
  f.sim.addCharge(actor,1,'hit');assert.equal(actor.awakening.orbs,1);assert.equal(actor.awakening.gauge,0);
});

test('fixed RIGHT input crosses a same-team actor but original enemy body width blocks crossing',async()=>{
  const friend=await fixture();friend.place('r0',-2050);friend.place('r1',-1900);
  friend.frames(36,{r0:{held:['RIGHT']}});
  assert.ok(friend.sim.actor('r0').x>-1900,'red0 must walk through red1');
  near(friend.sim.actor('r1').x,-1900);
  const enemy=await fixture();enemy.place('r0',-2050);enemy.place('r1',-1500);enemy.place('b0',-1900);
  enemy.frames(36,{r0:{held:['RIGHT']}});
  const a=enemy.sim.actor('r0'),b=enemy.sim.actor('b0');
  assert.ok(a.x<b.x,'red0 must remain on starting side of blue0');
  near(b.x-a.x,70,.01); // Target UNIT_WIDTH70, source horizontal overlap sum/2.
  assert.equal(a.lineId,0);assert.equal(b.lineId,0);
});

test('actual applyHit rejects friendly damage and uses revenge attack/defence and received MP',async()=>{
  const f=await fixture();f.pvp.state.score=[0,1];f.pvp.refreshModifiers(f.sim);
  for(const a of f.sim.state.actors){a.mp=0;assert.equal(a.stats.physicalAttack,1000);}
  const friendly=f.sim.injectHit({attackerId:'r0',targetId:'r1',damageData:f.hitData});
  assert.equal(friendly.accepted,false);assert.equal(friendly.reason,'same-team');
  const outgoing=f.sim.injectHit({attackerId:'r0',targetId:'b0',damageData:f.hitData});
  assert.equal(outgoing.accepted,true);near(outgoing.amount,1000*1.52*1.1);
  near(f.sim.actor('b0').mp,3);near(f.sim.actor('r0').mp,2.5);
  const incoming=f.sim.injectHit({attackerId:'b1',targetId:'r1',damageData:f.hitData});
  assert.equal(incoming.accepted,true);near(incoming.amount,1000*1.52*.9);
  near(f.sim.actor('r1').mp,3*1.1);
  assert.deepEqual(f.sim.actor('r1').onlineBuffs.map(b=>b.templateId),[130]);
});

test('disconnect removes the real core actor/effects and adds source MP compensation to actual hits',async()=>{
  const f=await fixture();
  f.sim.createEffect(f.sim.actor('r0'),{NAME:'DamageEffect_RRF_ExplosiveHand_Impact_NEW'});
  assert.ok(f.sim.state.effects.some(e=>e.ownerId==='r0'),'real target66X impact effect must exist before disconnect');
  f.pvp.disconnect('r0',f.sim);
  assert.equal(f.sim.state.effects.some(e=>e.ownerId==='r0'),false);
  const removed=f.sim.actor('r0');assert.equal(removed.hidden,true);assert.equal(removed.hp,0);assert.equal(removed.deathComplete,true);
  for(const a of f.sim.state.actors)a.mp=0;
  const outgoing=f.sim.injectHit({attackerId:'r1',targetId:'b0',damageData:f.hitData});
  assert.equal(outgoing.accepted,true);near(outgoing.amount,1520); // No invented attack damage bonus.
  near(f.sim.actor('r1').mp,2.5+3);near(f.sim.actor('b0').mp,3);
  const incoming=f.sim.injectHit({attackerId:'b1',targetId:'r1',damageData:f.hitData});
  assert.equal(incoming.accepted,true);near(f.sim.actor('r1').mp,2.5+3); // First attack consumed the shared MP/soul frame gate.
  f.place('r1',-2050);f.place('r0',-1900);
  // place() deliberately changes pose only; disconnected deathComplete remains
  // authoritative even with coordinates across the moving teammate's path.
  f.frames(36,{r1:{held:['RIGHT']}});assert.ok(f.sim.actor('r1').x>-1900);
  assert.equal(removed.hidden,true);assert.ok(removed.deathComplete);
});

test('native four-player hits compose RF/guild MP and revenge within one shared attack/receive frame',async()=>{
  // Independently declared inputs: target66X HIT_ADD_MP2.5; V5 roster deficit
  // adds3 on attack and2 to receive base3; RF24404 +10%, guild504 x1.5,
  // guild505 x1.05, target revenge Lv1 receiveMP x1.1. No original-client trace.
  const f=await fixture(2016,{passives:[24404],guildPassives:[504,505]});
  f.pvp.state.score=[0,1];f.pvp.disconnect('r0',f.sim);
  for(const actor of f.sim.state.actors)actor.mp=0;
  const lone=f.sim.actor('r1'),blue=f.sim.actor('b0');
  assert.equal(lone.pvpModifiers.hitMpBonus,3);assert.equal(lone.pvpModifiers.receivedMpBonus,2);
  assert.equal(lone.pvpModifiers.receivedMpMultiplier,1.1);
  assert.equal(lone.guild.levels[504],5);assert.equal(lone.guild.levels[505],5);
  assert.equal(lone.passivePolicy.skillLevels[24404],3);
  // Hand-evaluated target multipliers; near() allows only float32 rounding.
  const expectedAttack=(2.5+3)*1.05;
  const expectedReceive=(3+2)*1.1*1.5*1.1;
  const blueReceive=3*1.1*1.5;
  const outgoing=f.sim.injectHit({attackerId:'r1',targetId:'b0',damageData:f.hitData});
  assert.equal(outgoing.accepted,true);near(lone.mp,expectedAttack);near(blue.mp,blueReceive);
  const incoming=attackerId=>f.sim.injectHit({attackerId,targetId:'r1',damageData:f.hitData});
  assert.equal(incoming('b1').accepted,true);near(lone.mp,expectedAttack);
  const receivedAt=f.sim.state.step;assert.equal(lone.lastCombatResourceStep,receivedAt);
  assert.equal(incoming('b0').accepted,true);near(lone.mp,expectedAttack);
  assert.equal(lone.lastCombatResourceStep,receivedAt,'attacking and either received attacker share one source gate');
  f.tick();const before=lone.mp;
  assert.ok(f.sim.state.step>receivedAt);assert.equal(incoming('b1').accepted,true);
  near(lone.mp-before,expectedReceive);
  assert.equal(incoming('b0').accepted,true);near(lone.mp-before,expectedReceive);
  // Excluded contacts must not consume the guard, so a valid contact later in
  // that same packet still grants its one combined receive gain.
  for(const excluded of [{NO_DAMAGE:true},{REACT_TYPE:0}]){
    f.tick();const mpBefore=lone.mp,lastReceived=lone.lastCombatResourceStep;
    const contact=f.sim.injectHit({attackerId:'b1',targetId:'r1',damageData:{...f.hitData,...excluded}});
    assert.equal(contact.accepted,true);near(lone.mp,mpBefore);
    assert.equal(lone.lastCombatResourceStep,lastReceived);
    assert.equal(incoming('b0').accepted,true);near(lone.mp-mpBefore,expectedReceive);
  }
  // RT_DUMMY_DAMAGE is included by original IsDamagedReaction. It is not a
  // receive-resource exclusion; this accepted hit consumes the shared gate.
  f.tick();const beforeDummy=lone.mp;
  assert.equal(f.sim.injectHit({attackerId:'b1',targetId:'r1',damageData:{...f.hitData,REACT_TYPE:7}}).accepted,true);
  near(lone.mp-beforeDummy,expectedReceive);assert.equal(lone.lastCombatResourceStep,f.sim.state.step);
  assert.equal(incoming('b0').accepted,true);near(lone.mp-beforeDummy,expectedReceive);
  // The normal damage formula deliberately does not reinterpret Buff type6
  // as physical damage. Rejection must not reserve the resource frame.
  f.tick();const beforeUnsupported=lone.mp,priorGate=lone.lastCombatResourceStep;
  assert.equal(f.sim.injectHit({attackerId:'b1',targetId:'r1',damageData:{...f.hitData,DAMAGE_TYPE:6,REACT_TYPE:0}}).accepted,false);
  near(lone.mp,beforeUnsupported);assert.equal(lone.lastCombatResourceStep,priorGate);
  assert.equal(incoming('b0').accepted,true);near(lone.mp-beforeUnsupported,expectedReceive);
});

test('native/core death actually completes, respawns WAIT at teammate, locks input and grants5sec invincibility',async()=>{
  const f=await fixture(2016,{guildPassives:[504,505,508,510]}),original=f.sim.actor('b0');
  // Match-start gauge50 is a one-time initial bonus. Fixed V5 preserves stored
  // awakening charge/orbs through revival, while active time and core reset.
  const template=structuredClone(f.initialActors.find(actor=>actor.id==='b0'));
  // A real target437/408 native Buff changes critical stats before death;
  // revival must restore the complete initialized v20 template, not corpse stats.
  assert.ok(f.sim.grantBuff(original,original,437,3,null));assert.equal(original.stats.criticalRate,100);
  original.awakening.gauge=23;original.awakening.orbs=2;original.hp=1;
  const kill=f.sim.injectHit({attackerId:'r0',targetId:'b0',damageData:f.hitData});assert.equal(kill.accepted,true);
  const storedCharge={orbs:original.awakening.orbs,gauge:original.awakening.gauge};
  f.consume();f.pvp.advance(0,f.sim);f.pvp.drainEvents();
  assert.deepEqual(f.pvp.state.score,[1,0]);assert.equal(f.pvp.player('b0').respawnAt,12);
  f.frames(11*60);assert.equal(f.pvp.player('b0').alive,false);
  assert.equal(original.deathComplete,true,'real death/fade loop must finish before revival');
  let guard=0;while(!f.pvp.player('b0').alive){assert.ok(guard++<65);f.tick();}
  const revived=f.sim.actor('b0'),teammate=f.sim.actor('b1');
  assert.notEqual(revived,original);assert.equal(revived.state,'RSI_WAIT');assert.equal(revived.hp,800000);
  assert.deepEqual(revived.guild,template.guild);assert.notEqual(revived.guild,original.guild);
  assert.notEqual(revived.guild.levels,teammate.guild.levels);
  assert.deepEqual(revived.stats,template.stats);assert.deepEqual(revived.buffBaseStats,template.buffBaseStats);
  assert.deepEqual(revived.buffs,[]);assert.deepEqual(revived.awakening,{...template.awakening,...storedCharge});
  assert.equal(revived.core.level,0);assert.equal(revived.core.gauge,0);assert.equal(revived.awakening.remaining,0);
  assert.deepEqual([revived.x,revived.y,revived.z],[teammate.x,teammate.y,teammate.z]);
  near(revived.inputLock,6560/4800);near(revived.forceInvincible,5);
  assert.equal(f.pvp.canControl('b0'),false);
  const protectedHit=f.sim.injectHit({attackerId:'r0',targetId:'b0',damageData:f.hitData});
  assert.equal(protectedHit.accepted,false,'respawn invincibility must protect first frame before actor update ordering');
  const x=revived.x;f.frames(60,{b0:{held:['RIGHT','Z'],pressed:['Z']}});
  assert.equal(revived.state,'RSI_WAIT');near(revived.x,x);assert.equal(revived.invincible,true);
  f.frames(25);assert.equal(f.pvp.canControl('b0'),true);
  f.frames(220);assert.equal(revived.invincible,false);assert.equal(revived.pvpWhiteFlash,false);
  const vulnerable=f.sim.injectHit({attackerId:'r0',targetId:'b0',damageData:f.hitData});assert.equal(vulnerable.accepted,true);
});

test('real four-actor resurrection halves or clears leading MP, preserves charge and never re-applies the penalty',async()=>{
  for(const [enemyBeforeDeath,retention]of [[1,.5],[0,0]]){
    const f=await fixture(),dead=f.sim.actor('r0');
    f.pvp.state.score=[3,enemyBeforeDeath];f.pvp.refreshModifiers(f.sim);
    dead.mp=80;dead.awakening.orbs=2;dead.awakening.gauge=23;dead.hp=1;
    const hit=f.sim.injectHit({attackerId:'b0',targetId:'r0',damageData:f.hitData});assert.equal(hit.accepted,true);
    f.consume();f.pvp.advance(0,f.sim);f.pvp.drainEvents();
    assert.deepEqual(f.pvp.state.score,[3,enemyBeforeDeath+1]);
    const storedCharge={orbs:dead.awakening.orbs,gauge:dead.awakening.gauge};
    let attempts=0;while(!f.pvp.player('r0').alive){assert.ok(attempts++<1300);f.tick();}
    const revived=f.sim.actor('r0');assert.notEqual(revived,dead);assert.equal(revived.state,'RSI_WAIT');
    near(revived.mp,dead.mp*retention);assert.deepEqual({orbs:revived.awakening.orbs,gauge:revived.awakening.gauge},storedCharge);
    assert.equal(revived.core.level,0);assert.equal(revived.core.gauge,0);assert.equal(revived.awakening.remaining,0);
    const atRevival=revived.mp;assert.equal(f.pvp.respawn(f.pvp.player('r0'),f.sim),false);
    f.frames(1);near(revived.mp,atRevival+dt); // Target MP_CHANGE_RATE1; one unfrozen frame, no repeated revival penalty.
  }
});

test('separate native WASM instances replay identical four-actor fixed inputs and seeded snapshots',async()=>{
  const a=await fixture(481516),b=await fixture(481516);
  for(const f of [a,b]){f.place('r0',-2050);f.place('b0',-1800);f.place('r1',-1500);}
  const observed=[];
  for(let frame=0;frame<180;frame++){
    const inputs={r0:frame<20?{held:['RIGHT']}:frame===20?{pressed:['Z'],held:['Z']}:frame<40?{held:['Z']}:frame===60?{pressed:['X'],held:['X']}:frame<80?{held:['X']}:{},
      b0:frame<10?{held:['LEFT']}:frame===45?{pressed:['Z'],held:['Z']}:frame<60?{held:['Z']}:{} };
    const actual=a.tick(inputs);observed.push(...actual);
    assert.deepEqual(actual,b.tick(inputs),`event replay diverged at frame${frame}`);
  }
  const hits=observed.filter(e=>e.type==='hit');assert.ok(hits.length>0,'fixed contact-range inputs must execute real native attacks and posed collisions');
  assert.ok(hits.every(e=>e.actorId[0]!==e.targetId[0]),'all real attacks in this trace must target enemies');
  assert.deepEqual(a.sim.snapshot(),b.sim.snapshot());assert.deepEqual(a.pvp.snapshot(),b.pvp.snapshot());
  const checkpoint=a.sim.snapshot(),rulesCheckpoint=a.pvp.snapshot(),restored=await fixture(481516);
  restored.sim.restore(checkpoint);restored.pvp.restore(rulesCheckpoint);
  for(let frame=0;frame<30;frame++){const input={r1:{held:['LEFT']}};a.tick(input);restored.tick(input);}
  assert.deepEqual(restored.sim.snapshot(),a.sim.snapshot());assert.deepEqual(restored.pvp.snapshot(),a.pvp.snapshot());
});
