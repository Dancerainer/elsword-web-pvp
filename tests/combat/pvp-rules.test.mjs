import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpMatch,chooseTeamSpawns,pvpModifiers,respawnSeconds,respawnResourceRetention,DEFAULT_PVP_RULES} from '../../packages/pvp/index.mjs';
import source from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};

// Four small, legal authored spawn records from the independently parsed target
// Garpai map. Tests do not derive expected positions/scores from the controller.
const map={lines:[{lineId:0},{lineId:6}],spawns:[
  {kind:'SetTeamStartPos',index:0,teamFlag:false,position:[2022.98,2840,0],facingRight:false,lineId:6},
  {kind:'SetTeamStartPos',index:1,teamFlag:false,position:[1858.11,2840,0],facingRight:false,lineId:6},
  {kind:'SetTeamStartPos',index:4,teamFlag:true,position:[-2082.55,2840,0],facingRight:true,lineId:0},
  {kind:'SetTeamStartPos',index:5,teamFlag:true,position:[-1952.1,2840,0],facingRight:true,lineId:0},
]};
const players=[{id:'r0',team:0},{id:'r1',team:0},{id:'b0',team:1},{id:'b1',team:1}];
function settle(f){if(f.pvp.state.phase!=='slow')return;for(const a of f.sim.state.actors)if(a.hp<=0)a.deathComplete=true;f.pvp.advance(1.5,f.sim);}
const versions={referenceVersion:'NA2016-resources-V5-source',presetVersion:'test-preset',programVersion:'test-program'};
function fixture({seed=123,roster=players,rules={},specialResourcePools=[]}={}){
  const actors=roster.map(p=>({id:p.id,hp:100,hpMax:100,mp:80,mpMax:300,x:0,y:0,z:0,grounded:true,deathComplete:false,inputLock:0,forceInvincible:0}));
  const sim={state:{actors,effects:[]}};
  const originals=structuredClone(actors);
  const pvp=new PvpMatch({players:roster,map,seed,versions,rules,specialResourcePools,onRespawn(id){
    const actor=structuredClone(originals.find(a=>a.id===id));
    sim.state.actors[sim.state.actors.findIndex(a=>a.id===id)]=actor;return actor;
  }});
  const actor=id=>sim.state.actors.find(a=>a.id===id);
  return {sim,pvp,actor,fight(){pvp.start(sim);pvp.advance(4.5,sim);pvp.drainEvents();}};
}

test('pending final death survives JSON continuation, validates its victim set, and includes later opposing death',()=>{
  const f=fixture();f.fight();f.pvp.state.score=[3,3];f.actor('b0').hp=0;f.pvp.advance(.1,f.sim);
  const snapshot=JSON.parse(JSON.stringify(f.pvp.snapshot())),q=fixture();q.sim.state=structuredClone(f.sim.state);q.pvp.restore(snapshot);
  for(const run of [f,q]){
    run.actor('r0').hp=0;run.pvp.advance(.2,run.sim);assert.deepEqual(run.pvp.state.score,[4,4]);assert.equal(run.pvp.state.result,null);
    for(const id of ['b0','r0'])run.actor(id).deathComplete=true;
    run.pvp.advance(1.5,run.sim);assert.equal(run.pvp.state.result.winnerTeam,0);
    assert.equal(run.pvp.state.result.tieBreak,'v5-first-team');
  }
  assert.deepEqual(f.pvp.snapshot(),q.pvp.snapshot());
  const bad=structuredClone(snapshot);bad.pendingEnd.deathIds.push('missing-player');assert.throws(()=>fixture().pvp.restore(bad),/pending PvP end/);
});

test('frozen rule selection uses deathmatch4/420 and records the server reference score limit of 8 separately',()=>{
  assert.equal(DEFAULT_PVP_RULES.scoreLimit,4);assert.equal(DEFAULT_PVP_RULES.duration,420);
  assert.deepEqual(source.match.v5,{scoreLimit:4,duration:420});
  assert.deepEqual(source.match.serverReference,{scoreLimit:8,duration:420});
  assert.equal(source.targetClientMeasured,false);
  assert.equal(source.v5.commit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
});

test('red/blue choose their own authored native positions; malformed maps fail closed',()=>{
  assert.deepEqual(chooseTeamSpawns(map,players).map(p=>p.position),[
    [-2082.55,2840,0],[-1952.1,2840,0],[2022.98,2840,0],[1858.11,2840,0],
  ]);
  assert.deepEqual(chooseTeamSpawns(map,players).map(p=>p.facing),[1,1,-1,-1]);
  assert.throws(()=>chooseTeamSpawns({lines:[{lineId:0}],spawns:map.spawns},players),/unknown line/);
  assert.throws(()=>chooseTeamSpawns({lines:[],spawns:[]},players),/Missing authored/);
});

test('target pose lottery is reproducible; intro waits4.5 and emits fight-start once',()=>{
  const a=fixture({seed:1}),b=fixture({seed:1});
  a.pvp.start(a.sim);b.pvp.start(b.sim);
  assert.deepEqual(a.pvp.snapshot(),b.pvp.snapshot());
  assert.deepEqual(source.poses.start.map(p=>[p.state,p.weight]),[['RSI_RRF_START',80],['RSI_ROT_START',15],['RSI_START',5]]);
  a.pvp.advance(4.49,a.sim);assert.equal(a.pvp.state.phase,'intro');assert.equal(a.pvp.canControl('r0'),false);
  assert.equal(a.pvp.state.remaining,420);
  a.pvp.advance(.01,a.sim);assert.equal(a.pvp.state.phase,'fight');assert.equal(a.pvp.canControl('r0'),true);
  assert.equal(a.pvp.drainEvents().filter(e=>e.type==='fight-start').length,1);
  a.pvp.advance(.1,a.sim);assert.equal(a.pvp.drainEvents().filter(e=>e.type==='fight-start').length,0);
});
test('user-selected match start is MP0 with half of one charge bar and preserves nickname through snapshots/results',()=>{
  const roster=players.map((p,i)=>({...p,name:'account-'+i,nickname:'Battle nickname'+i}));
  const f=fixture({roster});
  for(const a of f.sim.state.actors)a.awakening={orbs:3,gauge:80,remaining:20,full:true,pendingOrbs:2,pendingAvailableOrbs:3};
  f.pvp.start(f.sim);
  for(const [i,a]of f.sim.state.actors.entries()){
    assert.equal(a.mp,0);assert.equal(a.nickname,'Battle nickname'+i);
    assert.deepEqual(a.awakening,{orbs:0,gauge:50,remaining:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0});
  }
  assert.equal(f.pvp.snapshot().players[0].name,'Battle nickname0');
  assert.equal(f.pvp.snapshot().players[0].nickname,'Battle nickname0');
  f.pvp.finish(0,'test',f.sim);settle(f);assert.equal(f.pvp.snapshot().result.players[0].nickname,'Battle nickname0');
  assert.equal(DEFAULT_PVP_RULES.initialMp,0);assert.equal(DEFAULT_PVP_RULES.initialAwakeningOrbs,0);assert.equal(DEFAULT_PVP_RULES.initialAwakeningGauge,50);
});

test('loading-stage disconnected actor stays removed across intro/start',()=>{
  const f=fixture();f.sim.state.effects=[{ownerId:'r0'},{ownerId:'r1'}];
  f.pvp.disconnect('r0',f.sim);f.pvp.start(f.sim);f.pvp.advance(4.5,f.sim);
  assert.equal(f.actor('r0').hidden,true);assert.equal(f.actor('r0').hp,0);
  assert.equal(f.actor('r0').deathComplete,true);assert.equal(f.pvp.canControl('r0'),false);
  assert.equal(f.actor('r0').pvpPresentation,undefined);assert.deepEqual(f.sim.state.effects,[{ownerId:'r1'}]);
  assert.deepEqual(f.actor('r0').onlineBuffs,[]);
});

test('revive delay clamps score difference, without unimplemented ring effect',()=>{
  assert.equal(respawnSeconds(0,0),15);assert.equal(respawnSeconds(2,3),12);
  assert.equal(respawnSeconds(3,2),18);assert.equal(respawnSeconds(8,0),30);
  assert.equal(respawnSeconds(0,8),0);assert.throws(()=>respawnSeconds(NaN,1),/finite/);
});

test('revenge derives original target factors and roster MP compensation adds no damage buff',()=>{
  assert.deepEqual(pvpModifiers([0,0],0,[1,2]),{
    revengeLevel:0,damageMultiplier:1,receivedMultiplier:1,receivedMpMultiplier:1,outnumbered:1,hitMpBonus:3,receivedMpBonus:2,
  });
  const one=pvpModifiers([0,1],0,[2,2]);
  assert.equal(one.damageMultiplier,1.1);assert.equal(one.receivedMultiplier,.9);assert.equal(one.receivedMpMultiplier,1.1);
  const three=pvpModifiers([0,6],0,[1,2]);
  assert.equal(three.revengeLevel,3);assert.equal(three.damageMultiplier,1.3);
  assert.equal(three.receivedMultiplier,.7);assert.equal(three.hitMpBonus,3);
  assert.deepEqual(source.revenge.levels.map(l=>l.templateId),[130,131,132]);
});

test('only authoritative hp0 scores; max damage other contributor counts one assist',()=>{
  const f=fixture();f.fight();
  f.pvp.recordHit({attackerId:'r1',targetId:'b0',amount:60});
  f.pvp.recordHit({attackerId:'r0',targetId:'b0',damage:40});
  assert.deepEqual(f.pvp.recordDeaths([{victimId:'b0',killerId:'r0'}],f.sim),[]);
  f.actor('b0').hp=0;
  f.pvp.advance(1/60,f.sim);
  assert.deepEqual(f.pvp.state.score,[1,0]);
  assert.equal(f.pvp.player('r0').kills,1);assert.equal(f.pvp.player('r1').assists,1);
  assert.equal(f.pvp.player('b0').deaths,1);assert.equal(f.pvp.player('b0').alive,false);
  assert.equal(f.actor('b1').onlineBuffs[0].id,'130');
  f.pvp.advance(1/60,f.sim);assert.deepEqual(f.pvp.state.score,[1,0]);
  assert.equal(f.pvp.recordHit({attackerId:'b1',targetId:'b0',damage:10}),false);
});

test('same-step final deaths and timeout both use source HP then lower level then red',()=>{
  const f=fixture();f.fight();f.pvp.state.score=[3,3];
  f.actor('r0').hp=0;f.actor('b0').hp=0;f.actor('r1').hp=50;f.actor('b1').hp=80;
  f.pvp.advance(1/60,f.sim);
  settle(f);assert.deepEqual(f.pvp.state.score,[4,4]);assert.equal(f.pvp.state.result.winnerTeam,1);
  assert.equal(f.pvp.state.result.tieBreak,'hp-percent');
  // V5 dead deathmatch players count next-life100%, so metrics are150/180.
  assert.equal(f.pvp.hpTieMetric(f.sim,0),150);assert.equal(f.pvp.hpTieMetric(f.sim,1),180);
  const low=fixture({roster:players.map(p=>({...p,level:p.team===0?99:98}))});low.fight();
  low.pvp.advance(420,low.sim);settle(low);assert.equal(low.pvp.state.result.winnerTeam,1);
  settle(low);assert.equal(low.pvp.state.result.tieBreak,'average-level');
  const equal=fixture();equal.fight();equal.pvp.advance(420,equal.sim);
  settle(equal);assert.equal(equal.pvp.state.result.winnerTeam,0);assert.equal(equal.pvp.state.result.tieBreak,'v5-first-team');
});

test('timeout compares score first, then literal HP percentage rather than raw hitpoints',()=>{
  const f=fixture();f.fight();f.actor('r0').hpMax=200;f.actor('r0').hp=100;
  f.actor('r1').hp=50;f.actor('b0').hp=60;f.actor('b1').hp=60;
  f.pvp.advance(420,f.sim);settle(f);assert.equal(f.pvp.state.result.winnerTeam,1);
  assert.equal(f.pvp.state.finishReason,'timeout');assert.equal(f.pvp.state.remaining,0);
  const score=fixture();score.fight();score.pvp.state.score=[1,0];score.actor('r0').hp=1;score.actor('r1').hp=1;
  score.pvp.advance(420,score.sim);settle(score);assert.equal(score.pvp.state.result.winnerTeam,0);
});

test('final kill trade uses source lower-average-level and red fallback rather than draw or fresh randomness',()=>{
  const lower=fixture({roster:players.map(p=>({...p,level:p.team===0?99:98}))}),equal=fixture();
  for(const f of [lower,equal]){
    f.fight();f.pvp.state.score=[3,3];f.actor('r0').hp=0;f.actor('b0').hp=0;
    f.pvp.advance(1/60,f.sim);assert.equal(f.pvp.state.result,null);
    settle(f);assert.deepEqual(f.pvp.state.score,[4,4]);
  }
  assert.equal(lower.pvp.state.result.winnerTeam,1);assert.equal(lower.pvp.state.result.tieBreak,'average-level');
  assert.equal(equal.pvp.state.result.winnerTeam,0);assert.equal(equal.pvp.state.result.tieBreak,'v5-first-team');
});

test('score finish keeps result pending through slow motion and until corpse disappears',()=>{
  const f=fixture();f.fight();f.pvp.state.score=[3,0];f.actor('b0').hp=0;
  f.pvp.recordHit({attackerId:'r0',targetId:'b0',damage:100});f.pvp.advance(.1,f.sim);
  assert.equal(f.pvp.state.phase,'slow');assert.equal(f.pvp.timeScale,.2);assert.equal(f.pvp.snapshot().timeScale,.2);
  assert.equal(f.actor('r0').forceInvincible,0);
  const result=structuredClone(f.pvp.state.result),fightTime=f.pvp.state.fightTime;
  f.pvp.advance(1.49,f.sim);assert.equal(f.pvp.state.phase,'slow');
  assert.equal(f.pvp.state.fightTime,fightTime);assert.deepEqual(f.pvp.state.result,result);
  f.pvp.advance(.01,f.sim);assert.equal(f.pvp.state.phase,'slow');assert.equal(f.pvp.state.result,null);
  f.actor('b0').deathComplete=true;f.pvp.advance(0,f.sim);assert.equal(f.pvp.state.phase,'result');assert.equal(f.pvp.timeScale,0);
  assert.ok(f.actor('r0').pvpPresentation.state.includes('WIN'));
  f.pvp.advance(.5,f.sim);assert.equal(f.actor('r0').pvpPresentation.time,.5);
});

test('revival waits death completion, copies teammate air position, locks action and grants5sec flash',()=>{
  const f=fixture();f.fight();f.actor('b0').mp=80;f.actor('b0').hp=0;f.pvp.advance(.1,f.sim);
  assert.equal(f.pvp.player('b0').respawnAt,12.1);
  f.actor('b1').x=123;f.actor('b1').y=3000;f.actor('b1').z=0;f.actor('b1').lineId=null;f.actor('b1').grounded=false;
  f.pvp.advance(12,f.sim);assert.equal(f.pvp.player('b0').alive,false);
  f.actor('b0').deathComplete=true;f.pvp.advance(0,f.sim);
  assert.equal(f.pvp.player('b0').alive,true);assert.equal(f.actor('b0').hp,100);
  assert.deepEqual([f.actor('b0').x,f.actor('b0').y,f.actor('b0').z],[123,3000,0]);
  assert.equal(f.actor('b0').lineId,null);assert.equal(f.actor('b0').grounded,false);
  assert.equal(f.actor('b0').lastTouchLineId,f.actor('b1').lastTouchLineId);
  assert.deepEqual(f.actor('b0').landPosition,f.actor('b1').landPosition);
  assert.equal(f.actor('b0').mp,80);assert.equal(f.actor('b0').forceInvincible,5);
  assert.equal(f.pvp.canControl('b0'),false);assert.ok(Math.abs(f.actor('b0').pvpInvincibleRemaining-5)<1e-9);
  f.pvp.advance(1.4,f.sim);assert.equal(f.pvp.canControl('b0'),true);
  assert.equal(f.actor('b0').pvpPresentation,null);
  f.pvp.advance(3.61,f.sim);assert.equal(f.actor('b0').pvpInvincibleRemaining,0);assert.equal(f.actor('b0').pvpWhiteFlash,false);
});

test('both teammates dead revive at authored starts; leader MP clears or halves by final score gap',()=>{
  const f=fixture();f.fight();f.actor('b0').hp=0;f.actor('b1').hp=0;
  f.actor('b0').deathComplete=true;f.actor('b1').deathComplete=true;
  f.pvp.advance(.1,f.sim);f.pvp.advance(9,f.sim);
  assert.deepEqual([f.actor('b0').x,f.actor('b0').y,f.actor('b0').z],[2022.98,2840,0]);
  for(const [enemyScore,expected]of [[0,0],[1,40],[2,80]]){
    const lead=fixture();lead.fight();lead.pvp.state.score=[3,enemyScore];
    lead.actor('r0').mp=80; // Fixed pre-death balance tests revive retention, independent of initial MP0.
    lead.actor('r0').hp=0;lead.actor('r0').deathComplete=true;
    lead.pvp.advance(.1,lead.sim);lead.pvp.advance(respawnSeconds(3,enemyScore+1),lead.sim);
    assert.equal(lead.actor('r0').mp,expected);
  }
});

test('resurrection deducts only registered resource pools by the score at revival, once',()=>{
  for(const [score,retention]of [[[1,3],1],[[2,2],1],[[3,2],.5],[[3,1],0]]){
    let writes=0;
    const pool={id:'test-energy',read:a=>a.id==='r0'?a.testEnergy:null,write(a,value){a.testEnergy=value;writes++;}};
    const f=fixture({specialResourcePools:[pool]});f.fight();
    const dead=f.actor('r0');dead.mp=80;dead.testEnergy=7;dead.awakening={orbs:2,gauge:23,remaining:8,full:true,pendingOrbs:1,pendingAvailableOrbs:2};
    dead.hp=0;dead.deathComplete=true;f.pvp.advance(.1,f.sim);
    // The death-time score was0:1. Change it while waiting: the requested
    // resource penalty must use the eventual revival score, not that history.
    f.pvp.state.score=score;f.pvp.advance(12,f.sim);
    const revived=f.actor('r0');assert.notEqual(revived,dead);
    assert.equal(revived.mp,80*retention);assert.equal(revived.testEnergy,7*retention);
    assert.deepEqual(revived.awakening,{orbs:2,gauge:23,remaining:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0});
    const events=f.pvp.drainEvents().filter(e=>e.type==='respawn');
    assert.equal(events.length,1);assert.equal(events[0].resourceRetention,retention);assert.equal(writes,1);
    assert.equal(f.pvp.respawn(f.pvp.player('r0'),f.sim),false);
    f.pvp.advance(1.5,f.sim);assert.equal(writes,1);assert.equal(f.actor('r0').mp,80*retention);
  }
  assert.deepEqual([-2,0,1,2,3].map(lead=>respawnResourceRetention(3+lead,3)),[1,1,.5,0,0]);
  assert.throws(()=>respawnResourceRetention(NaN,0),/finite/);
});

test('resource registration is explicit, frozen and snapshot-compatible; RF defaults to none',()=>{
  const f=fixture();assert.deepEqual(f.pvp.snapshot().specialResourcePoolIds,[]);
  const custom={id:'test-energy',read:a=>a.testEnergy??null,write(a,n){a.testEnergy=n;}};
  const pools=[custom],a=fixture({specialResourcePools:pools});
  pools.push({...custom,id:'other'});custom.id='changed';
  assert.deepEqual(a.pvp.snapshot().specialResourcePoolIds,['test-energy']);
  assert.equal(Object.isFrozen(a.pvp.specialResourcePools),true);assert.equal(Object.isFrozen(a.pvp.specialResourcePoolIds),true);
  assert.throws(()=>{a.pvp.specialResourcePools[0].id='changed';},TypeError);
  const same=fixture({specialResourcePools:[{...custom,id:'test-energy'}]});same.pvp.restore(a.pvp.snapshot());
  assert.throws(()=>f.pvp.restore(a.pvp.snapshot()),/Different PvP special resource pools/);
  for(const id of ['mp','awakening','core','__proto__','invalid.id'])assert.throws(()=>fixture({specialResourcePools:[{...custom,id}]}),/Invalid special resource pool id/);
  assert.throws(()=>fixture({specialResourcePools:[{...custom,id:'valid'} ,{...custom,id:'valid'}]}),/Duplicate/);
  assert.throws(()=>fixture({specialResourcePools:[{id:'valid',read:custom.read}]}),/read\/write/);
  assert.throws(()=>fixture({specialResourcePools:{}}),/must be an array/);
  assert.throws(()=>fixture({specialResourcePools:[{...custom,id:'valid',retain:1}]}),/retention must be a callback/);
});

test('profession retention receives frozen revival scores and invalid results fail before replacing the corpse',()=>{
  for(const value of [-1,NaN,Infinity,undefined,'100']){
    let writes=0,context;
    const f=fixture({specialResourcePools:[{id:'test-energy',read:()=>7,retain(balance,row){assert.equal(balance,7);context=row;return value;},write(){writes++;}}]});
    f.fight();const dead=f.actor('b0');dead.hp=0;dead.deathComplete=true;f.pvp.advance(.1,f.sim);
    f.pvp.state.score=[0,1];f.pvp.state.fightTime=100;f.pvp.player('b0').respawnAt=100;
    assert.throws(()=>f.pvp.respawn(f.pvp.player('b0'),f.sim),/Invalid retained special resource/);
    assert.equal(f.actor('b0'),dead);assert.equal(writes,0);assert.equal(Object.isFrozen(context),true);
    assert.deepEqual(context,{ownScore:1,enemyScore:0,scoreDifference:1,retention:.5});
  }
});

test('unsupported pools skip writes and malformed balances fail before replacing the corpse',()=>{
  for(const balance of [undefined,-1,NaN,Infinity,'50']){
    let writes=0;
    const f=fixture({specialResourcePools:[{id:'test-energy',read:()=>balance,write(){writes++;}}]});f.fight();
    const dead=f.actor('b0');dead.hp=0;dead.deathComplete=true;f.pvp.advance(.1,f.sim);
    assert.throws(()=>f.pvp.advance(12,f.sim),/Invalid special resource balance/);
    assert.equal(f.actor('b0'),dead);assert.equal(f.pvp.player('b0').alive,false);assert.equal(writes,0);
  }
  let writes=0;
  const f=fixture({specialResourcePools:[{id:'future-only',read:()=>null,write(){writes++;}}]});f.fight();
  f.actor('b0').hp=0;f.actor('b0').deathComplete=true;f.pvp.advance(.1,f.sim);f.pvp.advance(12,f.sim);
  assert.equal(f.pvp.player('b0').alive,true);assert.equal(writes,0);
});

test('team eliminated by disconnect wins without kill score; repeated disconnect is idempotent',()=>{
  const f=fixture();f.fight();f.pvp.disconnect('r0',f.sim);
  assert.equal(f.actor('r1').pvpModifiers.hitMpBonus,3);assert.equal(f.actor('r1').pvpModifiers.damageMultiplier,1);
  assert.equal(f.pvp.disconnect('r0',f.sim),false);
  f.pvp.disconnect('r1',f.sim);settle(f);assert.equal(f.pvp.state.result.winnerTeam,1);
  settle(f);assert.equal(f.pvp.state.result.reason,'disconnect');assert.deepEqual(f.pvp.state.score,[0,0]);
  settle(f);assert.deepEqual(f.pvp.state.result.players.map(p=>[p.kills,p.deaths,p.assists]),Array(4).fill([0,0,0]));
});

test('frozen versions required; snapshot restore continues seeded trajectory and rejects incompatible data',()=>{
  assert.throws(()=>new PvpMatch({players,map}),/referenceVersion required/);
  const a=fixture(),b=fixture();a.fight();a.pvp.advance(2,a.sim);
  b.pvp.restore(a.pvp.snapshot());b.sim.state=structuredClone(a.sim.state);
  a.pvp.disconnect('b0',a.sim);b.pvp.disconnect('b0',b.sim);
  a.pvp.advance(.25,a.sim);b.pvp.advance(.25,b.sim);
  assert.deepEqual(a.pvp.snapshot(),b.pvp.snapshot());assert.deepEqual(a.sim.state,b.sim.state);
  const bad=a.pvp.snapshot();bad.versions.programVersion='other';assert.throws(()=>b.pvp.restore(bad),/Incompatible/);
  bad.versions.programVersion='test-program';bad.clock=NaN;assert.throws(()=>b.pvp.restore(bad),/clock/);
});
