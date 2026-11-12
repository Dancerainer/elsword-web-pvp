/** Mode lifecycle regressions using independently listed Garpai team starts.
 * These validate the Web adaptation, not an original-client runtime replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PvpMatch,chooseTeamSpawns,DEFAULT_PVP_RULES} from '../../packages/pvp/index.mjs';

const map={lines:[{lineId:0},{lineId:6}],spawns:[
  {kind:'SetTeamStartPos',index:0,teamFlag:false,position:[2022.98,2840,0],facingRight:false,lineId:6},
  {kind:'SetTeamStartPos',index:1,teamFlag:false,position:[1858.11,2840,0],facingRight:false,lineId:6},
  {kind:'SetTeamStartPos',index:2,teamFlag:false,position:[1707.95,2840,0],facingRight:false,lineId:6},
  {kind:'SetTeamStartPos',index:4,teamFlag:true,position:[-2082.55,2840,0],facingRight:true,lineId:0},
  {kind:'SetTeamStartPos',index:5,teamFlag:true,position:[-1952.1,2840,0],facingRight:true,lineId:0},
  {kind:'SetTeamStartPos',index:6,teamFlag:true,position:[-1831.57,2840,0],facingRight:true,lineId:0},
  {kind:'AddStartPos',index:0,position:[-1265.74,3080,0],facingRight:false,lineId:6},
]};
function settle(f){if(f.pvp.state.phase!=='slow')return;for(const a of f.sim.state.actors)if(a.hp<=0)a.deathComplete=true;f.pvp.advance(1.5,f.sim);}
const versions={referenceVersion:'fixture-reference',presetVersion:'fixture-preset',programVersion:'fixture-program'};
const roster=size=>[0,1].flatMap(team=>Array.from({length:size},(_,index)=>({id:`${team?'b':'r'}${index}`,team,level:99})));
function fixture(mode,{players=roster(Number(mode[0])),rules={}}={}){
  const actors=players.map(player=>({...player,hp:100,hpMax:100,mp:150,mpMax:300,awakening:{orbs:3,gauge:90},deathComplete:false,inputLock:0,forceInvincible:0}));
  const sim={state:{actors,effects:[]}};
  let respawns=0;
  const pvp=new PvpMatch({players,map,mode,seed:41,versions,rules,onRespawn(){respawns++;}});
  return {sim,pvp,actor:id=>actors.find(actor=>actor.id===id),get respawns(){return respawns;},
    fight(){pvp.start(sim);pvp.advance(4.5,sim);pvp.drainEvents();}};
}

test('1v1 uses the first authored team slot; 3v3 uses three distinct authored slots per team',()=>{
  const duel=chooseTeamSpawns(map,roster(1));
  assert.deepEqual(duel.map(spawn=>[spawn.sourceSpawnIndex,spawn.position,spawn.lineId,spawn.facing]),[
    [4,[-2082.55,2840,0],0,1],[0,[2022.98,2840,0],6,-1],
  ]);
  assert.deepEqual(chooseTeamSpawns(map,roster(3)).map(spawn=>[spawn.sourceSpawnIndex,spawn.position[0]]),[
    [4,-2082.55],[5,-1952.1],[6,-1831.57],[0,2022.98],[1,1858.11],[2,1707.95],
  ]);
  assert.throws(()=>chooseTeamSpawns({...map,spawns:map.spawns.filter(spawn=>spawn.index!==6)},roster(3)),/Missing authored team spawn/);
});

test('mode validates exact team sizes and default 2v2 remains four players / four points / 420 seconds',()=>{
  const defaults=new PvpMatch({players:roster(2),map,versions});
  assert.equal(defaults.snapshot().mode,'2v2');assert.equal(defaults.snapshot().scoreLimit,4);
  assert.equal(defaults.rules.duration,420);assert.equal(DEFAULT_PVP_RULES.duration,420);
  for(const mode of ['1v1','2v2','3v3']){
    const count=Number(mode[0]);
    assert.throws(()=>new PvpMatch({players:roster(count+1),map,mode,versions}),/distinct players required/);
    const unbalanced=roster(count);unbalanced[0].team=1;
    assert.throws(()=>new PvpMatch({players:unbalanced,map,mode,versions}),/players per team required/);
  }
  assert.throws(()=>new PvpMatch({players:roster(2),map,mode:'4v4',versions}),/Unsupported PvP mode/);
});

test('1v1 first death resolves a single life, never schedules revival, and exposes mode in result',()=>{
  const f=fixture('1v1');f.fight();
  assert.equal(f.pvp.rules.duration,300);assert.equal(f.pvp.snapshot().scoreLimit,1);
  assert.equal(f.actor('r0').mp,0);assert.equal(f.actor('r0').awakening.gauge,50);
  f.pvp.recordHit({attackerId:'r0',targetId:'b0',damage:100});f.actor('b0').hp=0;f.actor('b0').deathComplete=true;
  f.pvp.advance(1/60,f.sim);
  assert.equal(f.pvp.state.phase,'slow');assert.equal(f.pvp.player('b0').respawnAt,null);
  settle(f);assert.equal(f.pvp.state.result.winnerTeam,0);assert.equal(f.pvp.state.result.mode,'1v1');assert.equal(f.pvp.state.result.scoreLimit,1);
  assert.equal(f.pvp.player('r0').kills,1);assert.equal(f.pvp.player('b0').deaths,1);
  assert.equal(f.pvp.respawn(f.pvp.player('b0'),f.sim),false);
  const death=f.pvp.drainEvents().find(event=>event.type==='death');assert.equal(death.respawnSeconds,null);
  f.pvp.advance(30,f.sim);assert.equal(f.pvp.state.phase,'result');assert.equal(f.actor('b0').hp,0);assert.equal(f.respawns,0);
});

test('1v1 times out at 300 seconds and compares HP percentage, then lower level, then red',()=>{
  const hp=fixture('1v1');hp.fight();hp.actor('r0').hpMax=1000;hp.actor('r0').hp=500;hp.actor('b0').hp=60;
  hp.pvp.advance(299.99,hp.sim);assert.equal(hp.pvp.state.phase,'fight');hp.pvp.advance(.01,hp.sim);
  settle(hp);assert.equal(hp.pvp.state.result.reason,'timeout');assert.equal(hp.pvp.state.result.winnerTeam,1);assert.equal(hp.pvp.state.result.tieBreak,'hp-percent');
  const low=fixture('1v1',{players:[{id:'r0',team:0,level:99},{id:'b0',team:1,level:98}]});low.fight();low.pvp.advance(300,low.sim);
  settle(low);assert.equal(low.pvp.state.result.winnerTeam,1);assert.equal(low.pvp.state.result.tieBreak,'average-level');
  const tie=fixture('1v1');tie.fight();tie.pvp.advance(300,tie.sim);
  settle(tie);assert.equal(tie.pvp.state.result.winnerTeam,0);assert.equal(tie.pvp.state.result.tieBreak,'v5-first-team');
});

test('same-step 1v1 double death batches both victims and counts actual remaining HP as zero',()=>{
  const f=fixture('1v1',{players:[{id:'r0',team:0,level:99},{id:'b0',team:1,level:98}]});f.fight();
  for(const actor of f.sim.state.actors){actor.hp=0;actor.deathComplete=true;}
  f.pvp.advance(1/60,f.sim);assert.deepEqual(f.pvp.state.score,[1,1]);
  assert.equal(f.pvp.hpTieMetric(f.sim,0),0);assert.equal(f.pvp.hpTieMetric(f.sim,1),0);
  settle(f);assert.equal(f.pvp.state.result.winnerTeam,1);assert.equal(f.pvp.state.result.tieBreak,'average-level');
  assert.ok(f.pvp.state.players.every(player=>player.respawnAt===null));
});

test('3v3 keeps deathmatch revival until the sixth point, with all six KDA rows in result',()=>{
  const f=fixture('3v3');f.fight();assert.equal(f.pvp.state.remaining,420);assert.equal(f.pvp.snapshot().scoreLimit,6);
  f.pvp.state.score=[3,0];f.actor('b2').hp=0;f.actor('b2').deathComplete=true;
  f.pvp.recordHit({attackerId:'r2',targetId:'b2',damage:100});f.pvp.advance(.1,f.sim);
  assert.deepEqual(f.pvp.state.score,[4,0]);assert.equal(f.pvp.state.phase,'fight');assert.equal(f.pvp.player('b2').respawnAt,3.1);
  f.pvp.advance(3,f.sim);assert.equal(f.pvp.player('b2').alive,true);assert.equal(f.actor('b2').hp,100);assert.equal(f.respawns,1);
  f.pvp.state.score=[5,0];f.actor('b1').hp=0;f.pvp.advance(.1,f.sim);
  assert.equal(f.pvp.state.phase,'slow');assert.equal(f.pvp.state.result,null);settle(f);assert.equal(f.pvp.state.result.winnerTeam,0);assert.equal(f.pvp.state.result.mode,'3v3');
  settle(f);assert.equal(f.pvp.state.result.scoreLimit,6);assert.equal(f.pvp.state.result.players.length,6);
});

test('3v3 handles three missing teammates and team elimination without awarding disconnect kills',()=>{
  const f=fixture('3v3');f.fight();
  f.pvp.disconnect('r0',f.sim);f.pvp.disconnect('r1',f.sim);
  assert.equal(f.actor('r2').pvpModifiers.outnumbered,2);assert.equal(f.actor('r2').pvpModifiers.hitMpBonus,6);
  assert.equal(f.actor('r2').pvpModifiers.receivedMpBonus,4);assert.deepEqual(f.pvp.state.score,[0,0]);
  f.pvp.disconnect('r2',f.sim);settle(f);assert.equal(f.pvp.state.result.winnerTeam,1);assert.equal(f.pvp.state.result.reason,'disconnect');
  settle(f);assert.deepEqual(f.pvp.state.result.score,[0,0]);assert.ok(f.pvp.state.result.players.every(player=>player.kills===0&&player.deaths===0));
});

test('snapshot restore rejects a mismatched mode or score limit even for matching roster and rules',()=>{
  const f=fixture('1v1'),same=fixture('1v1');f.fight();same.pvp.restore(f.pvp.snapshot());
  assert.deepEqual(same.pvp.snapshot(),f.pvp.snapshot());
  for(const [field,value] of [['mode','2v2'],['scoreLimit',4]]){
    const bad=f.pvp.snapshot();bad[field]=value;assert.throws(()=>same.pvp.restore(bad),/Incompatible PvP snapshot/);
  }
});
